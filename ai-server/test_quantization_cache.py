import tempfile
import unittest
from pathlib import Path

from quantization_cache import (
    build_cache_metadata,
    cache_path,
    cache_is_valid,
    save_cache,
)


class QuantizationCacheTests(unittest.TestCase):
    def _source_model(self, root: Path) -> Path:
        model = root / "source-model"
        model.mkdir()
        (model / "config.json").write_text('{"model_type":"test"}', encoding="utf-8")
        (model / "model.safetensors").write_bytes(b"weights-v1")
        return model

    def _metadata(self, model: Path, version: str = "2.7.1"):
        return build_cache_metadata(
            model,
            "llm",
            "int4",
            {
                "torch": version,
                "transformers": "5.24.0",
                "bitsandbytes": "0.46.0",
            },
        )

    def test_saved_cache_is_valid_for_same_model_and_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = self._source_model(root)
            metadata = self._metadata(model)
            destination = cache_path(root / "cache", metadata)

            def writer(staging: Path):
                (staging / "config.json").write_text('{"quantization_config":{}}', encoding="utf-8")
                (staging / "model.safetensors").write_bytes(b"quantized-weights")

            save_cache(destination, metadata, writer)
            self.assertTrue(cache_is_valid(destination, metadata))

    def test_cache_key_changes_when_source_weights_change(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = self._source_model(root)
            first = self._metadata(model)
            first_path = cache_path(root / "cache", first)
            (model / "model.safetensors").write_bytes(b"weights-v2-with-different-size")
            second = self._metadata(model)
            second_path = cache_path(root / "cache", second)
            self.assertNotEqual(first_path, second_path)
            self.assertFalse(cache_is_valid(first_path, second))

    def test_cache_key_changes_when_runtime_library_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = self._source_model(root)
            first = self._metadata(model, "2.7.1")
            second = self._metadata(model, "2.8.0")
            self.assertNotEqual(
                cache_path(root / "cache", first),
                cache_path(root / "cache", second),
            )

    def test_incomplete_save_never_creates_valid_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = self._source_model(root)
            metadata = self._metadata(model)
            destination = cache_path(root / "cache", metadata)

            with self.assertRaises(RuntimeError):
                save_cache(destination, metadata, lambda staging: None)

            self.assertFalse(destination.exists())
            self.assertFalse(cache_is_valid(destination, metadata))


if __name__ == "__main__":
    unittest.main()
