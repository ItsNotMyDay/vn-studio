"""Hardware and model compatibility checks for the VN Studio AI runtime.

The analyzer is deliberately conservative: it reports estimates and known adapter
support, but the final load plus a smoke generation is the only definitive test.
"""
from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import os
import platform
import shutil
import sys
from pathlib import Path
from typing import Any, Optional


WEIGHT_SUFFIXES = (".safetensors", ".bin", ".pt", ".pth", ".ckpt", ".gguf", ".ggml", ".onnx")
SKIP_DIRS = {".git", ".cache", "__pycache__", "node_modules"}


def _gb(value: Optional[int | float]) -> Optional[float]:
    if value is None:
        return None
    return round(float(value) / (1024 ** 3), 2)


def _memory_bytes() -> dict[str, Optional[int]]:
    """Return physical and currently available RAM without requiring psutil."""
    try:
        import psutil  # type: ignore
        mem = psutil.virtual_memory()
        return {"total": int(mem.total), "available": int(mem.available)}
    except Exception:
        pass

    if os.name == "nt":
        try:
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            state = MEMORYSTATUSEX()
            state.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(state)):
                return {"total": int(state.ullTotalPhys), "available": int(state.ullAvailPhys)}
        except Exception:
            pass

    try:
        page = os.sysconf("SC_PAGE_SIZE")
        total = os.sysconf("SC_PHYS_PAGES") * page
        available_pages = os.sysconf("SC_AVPHYS_PAGES")
        return {"total": int(total), "available": int(available_pages * page)}
    except Exception:
        return {"total": None, "available": None}


def _package_info(name: str) -> dict[str, Any]:
    try:
        version = importlib.metadata.version(name)
        return {"available": True, "version": version}
    except importlib.metadata.PackageNotFoundError:
        return {"available": False, "version": None}
    except Exception:
        return {"available": importlib.util.find_spec(name) is not None, "version": None}


def get_hardware_report(storage_path: Optional[str] = None) -> dict[str, Any]:
    """Collect system facts safely; Torch and optional packages are not mandatory."""
    ram = _memory_bytes()
    report: dict[str, Any] = {
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": sys.version.split()[0],
        },
        "cpu": {
            "name": platform.processor() or os.environ.get("PROCESSOR_IDENTIFIER") or platform.machine(),
            "logical_cores": os.cpu_count(),
        },
        "memory": {
            "ram_total_gb": _gb(ram.get("total")),
            "ram_available_gb": _gb(ram.get("available")),
            "ram_total_bytes": ram.get("total"),
            "ram_available_bytes": ram.get("available"),
        },
        "accelerators": [],
        "software": {
            "torch": _package_info("torch"),
            "transformers": _package_info("transformers"),
            "diffusers": _package_info("diffusers"),
            "accelerate": _package_info("accelerate"),
            "bitsandbytes": _package_info("bitsandbytes"),
            "gptqmodel": _package_info("gptqmodel"),
            "auto_gptq": _package_info("auto-gptq"),
            "autoawq": _package_info("autoawq"),
            "llama_cpp": _package_info("llama-cpp-python"),
            "safetensors": _package_info("safetensors"),
            "torchvision": _package_info("torchvision"),
        },
        "storage": None,
    }

    try:
        import torch

        report["software"]["torch"] = {
            "available": True,
            "version": str(torch.__version__),
            "cuda_runtime": getattr(getattr(torch, "version", None), "cuda", None),
        }
        try:
            report["software"]["torch"]["cudnn"] = torch.backends.cudnn.version()
        except Exception:
            report["software"]["torch"]["cudnn"] = None
        if torch.cuda.is_available():
            for index in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(index)
                try:
                    with torch.cuda.device(index):
                        free_bytes, total_bytes = torch.cuda.mem_get_info()
                except Exception:
                    free_bytes, total_bytes = None, int(props.total_memory)
                try:
                    capability = list(torch.cuda.get_device_capability(index))
                except Exception:
                    capability = None
                try:
                    bf16 = bool(torch.cuda.is_bf16_supported())
                except Exception:
                    bf16 = False
                report["accelerators"].append({
                    "backend": "cuda",
                    "index": index,
                    "name": props.name,
                    "total_vram_gb": _gb(int(props.total_memory)),
                    "free_vram_gb": _gb(free_bytes),
                    "total_vram_bytes": int(props.total_memory),
                    "free_vram_bytes": int(free_bytes) if free_bytes is not None else None,
                    "capability": capability,
                    "bf16": bf16,
                })
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            report["accelerators"].append({
                "backend": "mps",
                "index": 0,
                "name": "Apple Metal",
                "total_vram_gb": None,
                "free_vram_gb": None,
                "bf16": False,
            })
        elif hasattr(torch, "xpu") and torch.xpu.is_available():
            try:
                devices = range(torch.xpu.device_count())
            except Exception:
                devices = range(1)
            for index in devices:
                try:
                    name = torch.xpu.get_device_name(index)
                except Exception:
                    name = "Intel XPU"
                report["accelerators"].append({
                    "backend": "xpu", "index": index, "name": name,
                    "total_vram_gb": None, "free_vram_gb": None, "bf16": False,
                })
    except Exception as exc:
        report["software"]["torch"] = {
            "available": False,
            "version": None,
            "error": f"{type(exc).__name__}: {str(exc)[:240]}",
        }
        report["torch_error"] = f"{type(exc).__name__}: {str(exc)[:240]}"

    check_path = storage_path or os.path.dirname(__file__)
    try:
        original_path = Path(check_path).expanduser().absolute()
        disk_path = original_path
        while not disk_path.exists() and disk_path.parent != disk_path:
            disk_path = disk_path.parent
        usage = shutil.disk_usage(str(disk_path))
        report["storage"] = {
            "path": str(original_path),
            "free_gb": _gb(usage.free),
            "total_gb": _gb(usage.total),
            "free_bytes": usage.free,
        }
    except Exception:
        report["storage"] = {"path": os.path.abspath(check_path), "free_gb": None, "free_bytes": None}

    return report


def _read_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _measure_model(path: Path) -> dict[str, Any]:
    total_bytes = 0
    weight_bytes = 0
    weight_files = 0
    gguf_files = 0
    onnx_files = 0
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for filename in files:
            file_path = Path(root) / filename
            try:
                size = file_path.stat().st_size
            except OSError:
                continue
            total_bytes += size
            if filename.lower().endswith(WEIGHT_SUFFIXES):
                weight_bytes += size
                weight_files += 1
                if filename.lower().endswith((".gguf", ".ggml")):
                    gguf_files += 1
                if filename.lower().endswith(".onnx"):
                    onnx_files += 1
    return {
        "size_bytes": total_bytes,
        "weight_bytes": weight_bytes,
        "size_gb": _gb(total_bytes),
        "weight_gb": _gb(weight_bytes),
        "weight_files": weight_files,
        "gguf_files": gguf_files,
        "onnx_files": onnx_files,
    }


def inspect_local_model(model_path: str, requested_kind: str) -> dict[str, Any]:
    """Inspect local model metadata and choose a known runtime adapter family."""
    if requested_kind not in ("llm", "image"):
        raise ValueError("Тип модели должен быть llm или image")
    if not model_path or not str(model_path).strip():
        return {
            "exists": False, "kind": requested_kind, "path": None,
            "adapter": None, "status": "unknown",
            "reasons": ["Не указан путь к локальной модели."],
        }

    path = Path(model_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        return {
            "exists": False, "kind": requested_kind, "path": str(path),
            "adapter": None, "status": "blocked",
            "reasons": [f"Папка модели не найдена: {path}"],
        }

    model_index = _read_json(path / "model_index.json")
    config = _read_json(path / "config.json")
    size = _measure_model(path)
    if model_index:
        actual_kind = "image"
        architectures = [str(model_index.get("_class_name", "DiffusionPipeline"))]
        model_type = "diffusers"
        adapter = "diffusers_pipeline"
        multimodal = False
        quantized = False
        format_name = "Diffusers"
        processor_present = any((path / n).exists() for n in ("processor", "feature_extractor", "image_processor"))
        tokenizer_present = (path / "tokenizer").exists()
        architecture_supported = True
        architecture_note = None
    elif size["onnx_files"] and size["weight_files"] == size["onnx_files"]:
        actual_kind = "unknown"
        architectures = []
        model_type = "onnx"
        adapter = None
        multimodal = False
        quantized = False
        format_name = "ONNX"
        processor_present = False
        tokenizer_present = False
        architecture_supported = False
        architecture_note = "Обнаружены ONNX-веса, но ONNX Runtime для LLM/Diffusers ещё не подключён."
    elif size["gguf_files"]:
        actual_kind = "llm"
        architectures = []
        model_type = "gguf"
        adapter = "llama_cpp"
        multimodal = False
        quantized = True
        format_name = "GGUF"
        processor_present = False
        tokenizer_present = False
        architecture_supported = False
        architecture_note = "GGUF обнаружен, но встроенный llama.cpp backend ещё не подключён."
    elif config:
        actual_kind = "llm" if requested_kind == "llm" else "unknown"
        architectures = [str(x) for x in (config.get("architectures") or [])]
        model_type = str(config.get("model_type") or "unknown")
        has_vision = any(key in config for key in (
            "vision_config", "image_token_index", "video_token_index", "audio_token_index",
            "vision_tower", "mm_vision_tower", "perceiver_config",
        ))
        multimodal = bool(has_vision or any(
            token in " ".join(architectures).lower()
            for token in ("multimodal", "vision2seq", "image")
        ) or model_type.lower() in ("gemma4", "gemma4_text"))
        if multimodal:
            adapter = "transformers_multimodal"
            format_name = "Transformers multimodal"
        elif config.get("is_encoder_decoder"):
            adapter = "transformers_seq2seq"
            format_name = "Transformers seq2seq"
        else:
            adapter = "transformers_causal_lm"
            format_name = "Transformers causal LM"
        quant_config = config.get("quantization_config") or config.get("compression_config")
        quantized = bool(quant_config)
        quant_method = str((quant_config or {}).get("quant_method") or (quant_config or {}).get("quant_method_name") or "").lower()
        processor_present = any((path / n).exists() for n in (
            "processor_config.json", "preprocessor_config.json", "processor",
        ))
        tokenizer_present = any((path / n).exists() for n in (
            "tokenizer_config.json", "tokenizer.json", "tokenizer",
        ))
        architecture_supported = True
        architecture_note = None
        if requested_kind != "llm":
            actual_kind = "unknown"
    else:
        actual_kind = "unknown"
        architectures = []
        model_type = "unknown"
        adapter = None
        multimodal = False
        quantized = False
        format_name = "Неизвестный формат"
        processor_present = False
        tokenizer_present = False
        architecture_supported = False
        architecture_note = "Не найдены model_index.json или config.json."

    if actual_kind != requested_kind:
        architecture_supported = False
        architecture_note = "Содержимое папки не соответствует выбранному типу модели."
    if not size["weight_files"]:
        architecture_supported = False
        architecture_note = "В папке не обнаружены файлы весов модели."

    auto_map = config.get("auto_map") or {}
    custom_code = bool(auto_map)
    if custom_code:
        architecture_supported = False
        architecture_note = (
            "В config.json указан auto_map с пользовательским кодом. "
            "Автоматическое выполнение стороннего кода отключено в целях безопасности."
        )

    return {
        "exists": True,
        "kind": actual_kind,
        "requested_kind": requested_kind,
        "path": str(path),
        "format": format_name,
        "adapter": adapter,
        "model_type": model_type,
        "architectures": architectures,
        "multimodal": multimodal,
        "quantized": quantized,
        "quant_method": quant_method if "quant_method" in locals() else None,
        "processor_present": processor_present,
        "tokenizer_present": tokenizer_present,
        "custom_code_required": custom_code,
        "architecture_supported": architecture_supported,
        "architecture_note": architecture_note,
        **size,
    }


def _installed_software(hardware: dict[str, Any]) -> dict[str, bool]:
    packages = hardware.get("software") or {}
    return {name: bool(info.get("available")) for name, info in packages.items() if isinstance(info, dict)}


def build_compatibility_report(
    model_path: str,
    requested_kind: str,
    hardware: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Return an explainable estimate and a conservative runtime profile."""
    hardware = hardware or get_hardware_report(model_path or None)
    model = inspect_local_model(model_path, requested_kind)
    reasons: list[str] = []
    warnings: list[str] = []
    software = _installed_software(hardware)
    accelerators = hardware.get("accelerators") or []
    cuda_devices = [a for a in accelerators if a.get("backend") == "cuda"]
    cuda = cuda_devices[0] if cuda_devices else None
    other_accelerator = next((a for a in accelerators if a.get("backend") in ("mps", "xpu")), None)
    ram_total = ((hardware.get("memory") or {}).get("ram_total_gb") or 0) * (1024 ** 3)
    ram_free = ((hardware.get("memory") or {}).get("ram_available_gb") or 0) * (1024 ** 3)
    weight_bytes = int(model.get("weight_bytes") or 0)
    estimated_gpu_bytes = int(weight_bytes * (1.25 if requested_kind == "llm" else 1.55) + 1.5 * (1024 ** 3))
    estimated_cpu_bytes = int(weight_bytes * (2.15 if requested_kind == "llm" else 2.35) + 2 * (1024 ** 3))
    profile: dict[str, Any] = {
        "device": "cpu",
        "dtype": "float32",
        "quantization": "none",
        "device_map": "cpu",
        "offload": False,
        "estimated_vram_gb": _gb(estimated_gpu_bytes),
        "estimated_ram_gb": _gb(estimated_cpu_bytes),
    }
    status = "ready"

    if not model.get("exists"):
        status = model.get("status", "unknown")
        reasons.extend(model.get("reasons") or ["Модель не найдена."])
    elif not model.get("architecture_supported"):
        status = "unsupported"
        reasons.append(model.get("architecture_note") or "Формат или архитектура модели не поддерживается.")
    elif not software.get("torch"):
        status = "unsupported"
        reasons.append("Для локального запуска не установлен PyTorch.")
    elif requested_kind == "llm" and not software.get("transformers"):
        status = "unsupported"
        reasons.append("Для локальных LLM не установлен пакет Transformers.")
    elif requested_kind == "image" and not software.get("diffusers"):
        status = "unsupported"
        reasons.append("Для моделей генерации изображений не установлен пакет Diffusers.")
    elif model.get("quant_method") == "bitsandbytes" and not software.get("bitsandbytes"):
        status = "unsupported"
        reasons.append("Эта модель уже квантована через BitsAndBytes, но пакет bitsandbytes не установлен.")
    elif model.get("quant_method") == "gptq" and not (software.get("gptqmodel") or software.get("auto_gptq")):
        status = "unsupported"
        reasons.append("Для GPTQ-модели нужен совместимый backend GPTQModel или AutoGPTQ.")
    elif model.get("quant_method") == "awq" and not software.get("autoawq"):
        status = "unsupported"
        reasons.append("Для AWQ-модели нужен backend AutoAWQ.")
    elif requested_kind == "llm" and model.get("adapter") == "transformers_multimodal":
        # Do not misclassify a model as unsupported just because the older Auto class is missing.
        try:
            import transformers
            supports_mm = hasattr(transformers, "AutoModelForMultimodalLM") or hasattr(transformers, "AutoModelForImageTextToText")
        except Exception:
            supports_mm = False
        if not supports_mm:
            status = "unsupported"
            reasons.append(
                "Установленная версия Transformers не содержит совместимый мультимодальный AutoModel. "
                "Обновите Transformers до версии, поддерживающей архитектуру этой модели."
            )

    if status not in ("unsupported", "blocked", "unknown"):
        if requested_kind == "llm":
            if model.get("adapter") == "llama_cpp":
                status = "unsupported"
                reasons.append("Формат GGUF распознан, но backend llama.cpp пока не подключён.")
            elif cuda:
                available_vram = sum(
                    int(device.get("free_vram_bytes")
                        if device.get("free_vram_bytes") is not None
                        else device.get("total_vram_bytes") or 0)
                    for device in cuda_devices
                )
                safe_vram = int(available_vram * 0.82)
                dtype = "bfloat16" if all(device.get("bf16") for device in cuda_devices) else "float16"
                profile.update(device="cuda", dtype=dtype, device_map="auto")
                if model.get("quantized"):
                    profile["quantization"] = "pre-quantized"
                    profile["estimated_vram_gb"] = _gb(int(weight_bytes * 1.25 + 1.5 * (1024 ** 3)))
                if int(profile["estimated_vram_gb"] * (1024 ** 3)) <= safe_vram:
                    profile["strategy"] = "multi_gpu_auto" if len(cuda_devices) > 1 else "single_gpu"
                    if not software.get("accelerate"):
                        if ram_free >= estimated_cpu_bytes * 1.25:
                            status = "warning"
                            profile["strategy"] = "gpu_full_transfer"
                            warnings.append("Accelerate не установлен: веса сначала будут загружены в RAM, затем перенесены в GPU.")
                        else:
                            status = "blocked"
                            reasons.append("Без Accelerate модель нужно временно разместить в RAM; доступной оперативной памяти недостаточно.")
                elif software.get("bitsandbytes") and software.get("accelerate") and not model.get("quantized"):
                    quant_estimate = int(weight_bytes * 0.48 + 1.5 * (1024 ** 3))
                    if quant_estimate <= safe_vram:
                        profile.update(strategy="gpu_4bit", quantization="4bit-nf4",
                                       estimated_vram_gb=_gb(quant_estimate))
                        warnings.append("Будет применено 4-битное квантование; качество может немного измениться.")
                    elif ram_free >= estimated_cpu_bytes * 0.85 and software.get("accelerate"):
                        profile.update(strategy="gpu_cpu_offload", offload=True)
                        status = "warning"
                        warnings.append("Часть слоёв будет размещена в оперативной памяти. Скорость может заметно снизиться.")
                    elif ram_free >= estimated_cpu_bytes * 1.25:
                        profile.update(device="cpu", dtype="float32", strategy="cpu_fp32", device_map="cpu",
                                       quantization="none")
                        status = "warning"
                        warnings.append("Квантованный GPU-профиль не помещается; выбран резервный CPU FP32 режим.")
                    else:
                        status = "blocked"
                        reasons.append("Не хватает доступной VRAM и RAM для безопасной загрузки этой модели.")
                elif ram_free >= estimated_cpu_bytes * 0.85 and software.get("accelerate"):
                    profile.update(strategy="gpu_cpu_offload", offload=True)
                    status = "warning"
                    warnings.append("Модель не помещается целиком в VRAM; потребуется автоматическое размещение частей модели в RAM.")
                elif not model.get("quantized") and ram_free >= estimated_cpu_bytes * 1.25:
                    profile.update(device="cpu", dtype="float32", strategy="cpu_fp32", device_map="cpu",
                                   quantization="none")
                    status = "warning"
                    warnings.append("Модель не помещается в GPU; выбран CPU FP32 режим, который будет медленнее.")
                else:
                    status = "blocked"
                    reasons.append("Не хватает памяти GPU/CPU для безопасной загрузки с текущими библиотеками.")
            else:
                if other_accelerator:
                    backend = str(other_accelerator.get("backend"))
                    if ram_free >= estimated_cpu_bytes * 1.25:
                        profile.update(device=backend, dtype="float16" if backend == "mps" else "bfloat16",
                                       strategy=backend + "_full_transfer", device_map=backend)
                        status = "warning"
                        warnings.append("Обнаружен ускоритель без надёжной оценки VRAM; веса сначала разместятся в RAM, затем будут перенесены на ускоритель.")
                    else:
                        status = "blocked"
                        reasons.append("Недостаточно RAM для загрузки модели на обнаруженный ускоритель без device-map.")
                elif not model.get("quantized") and ram_free >= estimated_cpu_bytes * 1.25:
                    profile.update(device="cpu", dtype="float32", strategy="cpu_fp32", device_map="cpu")
                    status = "warning"
                    warnings.append("Модель будет работать на CPU. Генерация может быть очень медленной.")
                else:
                    status = "blocked"
                    reasons.append("Недостаточно свободной оперативной памяти для CPU-запуска LLM.")
        else:
            if cuda:
                free_vram = int(cuda.get("free_vram_bytes") or 0)
                total_vram = int(cuda.get("total_vram_bytes") or 0)
                available_vram = free_vram if cuda.get("free_vram_bytes") is not None else total_vram
                safe_vram = int(available_vram * 0.82)
                profile.update(device="cuda", dtype="float16", device_map="cuda")
                if estimated_gpu_bytes <= safe_vram:
                    profile.update(strategy="full_gpu")
                elif software.get("bitsandbytes") and software.get("accelerate") and os.path.isdir(os.path.join(model.get("path") or "", "transformer")):
                    quant_estimate = int(weight_bytes * 0.48 + 2 * (1024 ** 3))
                    if quant_estimate <= safe_vram:
                        profile.update(strategy="gpu_4bit", quantization="4bit-nf4",
                                       estimated_vram_gb=_gb(quant_estimate))
                        warnings.append("Трансформер будет загружен в 4-битном режиме.")
                    elif software.get("accelerate") and ram_free >= estimated_cpu_bytes * 0.85 and available_vram >= 2 * (1024 ** 3):
                        profile.update(strategy="sequential_cpu_offload", offload=True)
                        status = "warning"
                        warnings.append("Модель будет загружаться с последовательным CPU offload; генерация будет медленнее.")
                    elif ram_free >= estimated_cpu_bytes * 1.25:
                        profile.update(device="cpu", dtype="float32", strategy="cpu", device_map="cpu")
                        status = "warning"
                        warnings.append("GPU-памяти недостаточно; выбран CPU-режим, который будет значительно медленнее.")
                    else:
                        status = "blocked"
                        reasons.append("Недостаточно VRAM/RAM для безопасного запуска Diffusers-модели.")
                elif software.get("accelerate") and ram_free >= estimated_cpu_bytes * 0.85 and available_vram >= 2 * (1024 ** 3):
                    profile.update(strategy="sequential_cpu_offload", offload=True)
                    status = "warning"
                    warnings.append("Модель будет загружаться с последовательным CPU offload; генерация будет медленнее.")
                elif ram_free >= estimated_cpu_bytes * 1.25:
                    profile.update(device="cpu", dtype="float32", strategy="cpu", device_map="cpu")
                    status = "warning"
                    warnings.append("GPU-памяти недостаточно; выбран CPU-режим, который будет значительно медленнее.")
                else:
                    status = "blocked"
                    reasons.append("Недостаточно VRAM/RAM для безопасного запуска Diffusers-модели.")
            elif other_accelerator:
                backend = str(other_accelerator.get("backend"))
                profile.update(device=backend, dtype="float16" if backend == "mps" else "bfloat16",
                               strategy="full_" + backend, device_map=backend)
                status = "warning"
                warnings.append("Память этого ускорителя не удалось измерить; совместимость подтвердит только пробная загрузка.")
            elif ram_free >= estimated_cpu_bytes * 1.25:
                profile.update(device="cpu", dtype="float32", strategy="cpu", device_map="cpu")
                status = "warning"
                warnings.append("Генерация будет выполняться на CPU и может быть очень медленной.")
            else:
                status = "blocked"
                reasons.append("Недостаточно свободной оперативной памяти для CPU-запуска Diffusers-модели.")

    if model.get("exists") and model.get("size_gb") is not None:
        storage_free = (hardware.get("storage") or {}).get("free_gb")
        if storage_free is not None and storage_free < 1:
            warnings.append("На диске почти не осталось свободного места для временных файлов и offload.")

    if not reasons and status == "ready":
        reasons.append("Модель и подходящий runtime обнаружены. Запуск предварительно совместим с этим компьютером.")
    if status == "warning" and not reasons:
        reasons.append("Запуск возможен с ограничениями. Рекомендуется начать с небольшого теста.")
    if status == "unknown":
        reasons.append("Недостаточно данных для оценки совместимости.")

    return {
        "status": status,
        "can_load": status in ("ready", "warning"),
        "kind": requested_kind,
        "model": model,
        "hardware": hardware,
        "profile": profile,
        "reasons": reasons,
        "warnings": warnings,
        "requires_smoke_test": status in ("ready", "warning"),
        "limitations": [
            "Оценка памяти приблизительная и не гарантирует успешную генерацию.",
            "Фактический результат зависит от длины контекста, разрешения изображения и других процессов.",
            "Непроверенный пользовательский код модели не запускается автоматически.",
        ],
    }
