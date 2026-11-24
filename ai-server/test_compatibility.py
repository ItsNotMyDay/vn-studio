import json
import os
import tempfile
import unittest
from unittest import mock
from pathlib import Path

import compatibility as compatibility_module
from compatibility import build_compatibility_report, inspect_local_model


def fake_hardware(ram_gb=64):
    return {
        "memory": {"ram_total_gb": ram_gb, "ram_available_gb": ram_gb},
        "accelerators": [],
        "software": {
            "torch": {"available": True, "version": "test"},
            "transformers": {"available": True, "version": "test"},
            "diffusers": {"available": True, "version": "test"},
            "accelerate": {"available": True, "version": "test"},
            "bitsandbytes": {"available": False, "version": None},
            "gptqmodel": {"available": True, "version": "test"},
            "auto_gptq": {"available": False, "version": None},
            "autoawq": {"available": False, "version": None},
        },
        "storage": {"free_gb": 100},
    }


class CompatibilityTests(unittest.TestCase):
    def _make_llm(self, root, config):
        (root / "config.json").write_text(json.dumps(config), encoding="utf-8")
        (root / "model.safetensors").write_bytes(b"weights" * 1024)

    def test_detects_causal_transformers_model(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._make_llm(root, {"model_type": "llama", "architectures": ["LlamaForCausalLM"]})
            model = inspect_local_model(temp, "llm")
            self.assertEqual(model["adapter"], "transformers_causal_lm")
            self.assertTrue(model["architecture_supported"])

    def test_detects_multimodal_transformers_model(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._make_llm(root, {
                "model_type": "gemma4",
                "architectures": ["Gemma4ForConditionalGeneration"],
                "vision_config": {"hidden_size": 256},
            })
            model = inspect_local_model(temp, "llm")
            self.assertEqual(model["adapter"], "transformers_multimodal")
            self.assertTrue(model["multimodal"])

    def test_detects_diffusers_pipeline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "model_index.json").write_text(json.dumps({"_class_name": "StableDiffusionPipeline"}), encoding="utf-8")
            (root / "unet").mkdir()
            (root / "unet" / "diffusion_pytorch_model.safetensors").write_bytes(b"weights" * 1024)
            model = inspect_local_model(temp, "image")
            self.assertEqual(model["adapter"], "diffusers_pipeline")
            self.assertEqual(model["kind"], "image")

    def test_refuses_custom_code_by_default(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._make_llm(root, {
                "model_type": "custom",
                "architectures": ["CustomForCausalLM"],
                "auto_map": {"AutoModelForCausalLM": "modeling_custom.CustomModel"},
            })
            model = inspect_local_model(temp, "llm")
            self.assertFalse(model["architecture_supported"])
            self.assertTrue(model["custom_code_required"])

    def test_cpu_estimate_is_warning_when_memory_is_sufficient(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._make_llm(root, {"model_type": "llama", "architectures": ["LlamaForCausalLM"]})
            report = build_compatibility_report(temp, "llm", fake_hardware(64))
            self.assertTrue(report["can_load"])
            self.assertEqual(report["status"], "warning")
            self.assertEqual(report["profile"]["strategy"], "cpu_fp32")

    def test_blocks_when_cpu_memory_is_insufficient(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._make_llm(root, {"model_type": "llama", "architectures": ["LlamaForCausalLM"]})
            report = build_compatibility_report(temp, "llm", fake_hardware(1))
            self.assertFalse(report["can_load"])
            self.assertEqual(report["status"], "blocked")

    def test_detects_onnx_as_unsupported_instead_of_transformers(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "config.json").write_text(
                json.dumps({"model_type": "llama", "architectures": ["LlamaForCausalLM"]}),
                encoding="utf-8",
            )
            (root / "model.onnx").write_bytes(b"onnx-weights")
            model = inspect_local_model(temp, "llm")
            self.assertEqual(model["format"], "ONNX")
            self.assertFalse(model["architecture_supported"])

    def test_allows_auto_map_for_native_qwen3_architecture_without_remote_code(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._make_llm(root, {
                "model_type": "qwen3",
                "architectures": ["Qwen3ForCausalLM"],
                "auto_map": {"AutoModelForCausalLM": "modeling_qwen3.Qwen3ForCausalLM"},
            })
            model = inspect_local_model(temp, "llm")
            self.assertTrue(model["architecture_supported"])
            self.assertFalse(model["custom_code_required"])
            self.assertTrue(model["custom_code_present"])

    def test_unknown_custom_code_remains_blocked(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._make_llm(root, {
                "model_type": "not_a_builtin_model",
                "architectures": ["NotABuiltinForCausalLM"],
                "auto_map": {"AutoModelForCausalLM": "modeling_custom.CustomModel"},
            })
            model = inspect_local_model(temp, "llm")
            self.assertFalse(model["architecture_supported"])
            self.assertTrue(model["custom_code_required"])

    def test_large_14b_style_llm_can_use_four_bit_gpu_profile(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._make_llm(root, {"model_type": "qwen3", "architectures": ["Qwen3ForCausalLM"]})
            hardware = fake_hardware(64)
            vram = 12 * 1024 ** 3
            hardware["accelerators"] = [{
                "backend": "cuda", "index": 0, "name": "Test GPU",
                "total_vram_bytes": vram, "free_vram_bytes": vram,
                "total_vram_gb": 12, "free_vram_gb": 12, "bf16": True,
            }]
            hardware["software"]["bitsandbytes"] = {"available": True, "version": "test"}
            with mock.patch.object(compatibility_module, "_measure_model", return_value={
                "size_bytes": 28 * 1024 ** 3, "weight_bytes": 28 * 1024 ** 3,
                "size_gb": 28, "weight_gb": 28, "weight_files": 1,
                "gguf_files": 0, "onnx_files": 0,
            }):
                report = build_compatibility_report(temp, "llm", hardware)
            self.assertTrue(report["can_load"])
            self.assertEqual(report["status"], "ready")
            self.assertEqual(report["profile"]["quantization"], "4bit-nf4")

    def test_large_diffusers_pipeline_is_not_blocked_by_conservative_estimate(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "model_index.json").write_text(json.dumps({"_class_name": "QwenImagePipeline"}), encoding="utf-8")
            (root / "transformer").mkdir()
            (root / "transformer" / "diffusion_pytorch_model.safetensors").write_bytes(b"weights" * 1024)
            hardware = fake_hardware(64)
            vram = 24 * 1024 ** 3
            hardware["accelerators"] = [{
                "backend": "cuda", "index": 0, "name": "Test GPU",
                "total_vram_bytes": vram, "free_vram_bytes": vram,
                "total_vram_gb": 24, "free_vram_gb": 24, "bf16": True,
            }]
            with unittest.mock.patch.object(compatibility_module, "_measure_model", return_value={
                "size_bytes": 20 * 1024 ** 3, "weight_bytes": 20 * 1024 ** 3,
                "size_gb": 20, "weight_gb": 20, "weight_files": 1,
                "gguf_files": 0, "onnx_files": 0,
            }):
                report = build_compatibility_report(temp, "image", hardware)
            self.assertTrue(report["can_load"])
            self.assertEqual(report["status"], "warning")
            self.assertTrue(report["profile"]["offload"])

    def test_does_not_claim_cpu_fallback_for_prequantized_model(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._make_llm(root, {
                "model_type": "llama",
                "architectures": ["LlamaForCausalLM"],
                "quantization_config": {"quant_method": "gptq"},
            })
            report = build_compatibility_report(temp, "llm", fake_hardware(64))
            self.assertFalse(report["can_load"])
            self.assertEqual(report["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
