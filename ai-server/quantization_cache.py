"""Persistent cache for locally quantized model checkpoints.

Cache entries are tied to the exact source model manifest and the runtime library
versions that serialize them. Writes are staged and atomically promoted so an
interrupted save is never mistaken for a usable cache.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Callable, Any

CACHE_MANIFEST = "vn-quantization-cache.json"
CACHE_FORMAT_VERSION = 1
WEIGHT_SUFFIXES = (".safetensors", ".bin", ".pt", ".pth", ".ckpt", ".gguf", ".ggml")


def model_fingerprint(model_path: str | os.PathLike[str]) -> str:
    root = Path(model_path).expanduser().resolve()
    digest = hashlib.sha256(str(root).casefold().encode("utf-8"))
    manifest: list[tuple[str, int, int]] = []
    for current, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in {
            ".git", ".cache", "__pycache__", "node_modules",
        })
        for filename in files:
            if not filename.lower().endswith(WEIGHT_SUFFIXES + ("config.json", "model_index.json")):
                continue
            path = Path(current) / filename
            try:
                stat = path.stat()
            except OSError:
                continue
            manifest.append((
                path.relative_to(root).as_posix(),
                int(stat.st_size),
                int(stat.st_mtime_ns),
            ))
    for relative, size, mtime_ns in sorted(manifest):
        digest.update(f"{relative}\0{size}\0{mtime_ns}\n".encode("utf-8"))
    return digest.hexdigest()


def build_cache_metadata(
    model_path: str | os.PathLike[str],
    model_kind: str,
    quantization: str,
    library_versions: dict[str, str | None],
) -> dict[str, Any]:
    return {
        "format_version": CACHE_FORMAT_VERSION,
        "source_path": str(Path(model_path).expanduser().resolve()),
        "source_fingerprint": model_fingerprint(model_path),
        "model_kind": model_kind,
        "quantization": quantization,
        "library_versions": dict(sorted(library_versions.items())),
    }


def cache_path(cache_root: str | os.PathLike[str], metadata: dict[str, Any]) -> Path:
    encoded = json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    key = hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:32]
    return Path(cache_root).expanduser().resolve() / metadata["model_kind"] / metadata["quantization"] / key


def _has_saved_weights(path: Path) -> bool:
    return any(
        item.is_file() and item.name.lower().endswith(WEIGHT_SUFFIXES)
        for item in path.rglob("*")
    )


def cache_is_valid(path: str | os.PathLike[str], expected: dict[str, Any]) -> bool:
    root = Path(path)
    try:
        stored = json.loads((root / CACHE_MANIFEST).read_text(encoding="utf-8"))
        if stored != expected or not _has_saved_weights(root):
            return False
        if expected["model_kind"] == "image":
            return (root / "model_index.json").is_file()
        if expected["model_kind"] == "llm":
            return (root / "config.json").is_file()
        return False
    except (OSError, ValueError, TypeError, KeyError):
        return False


def save_cache(
    destination: str | os.PathLike[str],
    metadata: dict[str, Any],
    writer: Callable[[Path], None],
) -> Path:
    final_path = Path(destination)
    final_path.parent.mkdir(parents=True, exist_ok=True)
    staging = final_path.with_name(final_path.name + ".tmp-" + uuid.uuid4().hex)
    try:
        staging.mkdir(parents=True, exist_ok=False)
        writer(staging)
        if not _has_saved_weights(staging):
            raise RuntimeError("The serialized model cache contains no weight files")
        if metadata["model_kind"] == "image" and not (staging / "model_index.json").is_file():
            raise RuntimeError("The serialized Diffusers cache has no model_index.json")
        if metadata["model_kind"] == "llm" and not (staging / "config.json").is_file():
            raise RuntimeError("The serialized LLM cache has no config.json")
        (staging / CACHE_MANIFEST).write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        if final_path.exists():
            shutil.rmtree(final_path)
        os.replace(staging, final_path)
        return final_path
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
