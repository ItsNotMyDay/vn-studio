import base64
import inspect
import io
import json
import os
import glob
import shutil
import threading
import uuid
import re
import time
import signal
import urllib.error
import urllib.request
from typing import Optional, Literal

_BOOT_STARTED = time.perf_counter()

def _boot_mark(stage: str) -> None:
    print(f"[startup +{time.perf_counter() - _BOOT_STARTED:.2f}s] {stage}", flush=True)

_boot_mark("Python standard imports ready")

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0")
if os.name != "nt":
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
_boot_mark("FastAPI and Pydantic imported")

from compatibility import build_compatibility_report, get_hardware_report
from audio_runtime import AUDIO_RUNTIME
_boot_mark("VN Studio server modules imported")

MODEL_ID_DEFAULT = os.environ.get("VN_MODEL_ID", "qwen_image_2.1_turbo_int8_convrot")
MODEL_PATH_DEFAULT = os.environ.get("VN_MODEL_PATH", "")
SEARCH_DIRS = [os.environ.get("VN_MODELS_DIR", "C:\\models"), os.path.join(os.path.dirname(__file__), "models")]
LOW_VRAM_GB = float(os.environ.get("VN_LOW_VRAM_GB", "10"))
TOKENIZER_FALLBACK_REPO = os.environ.get("VN_TOKENIZER_REPO", "Qwen/Qwen-Image")
LLM_PATH_DEFAULT = os.environ.get("VN_LLM_PATH", "C:\\models\\qwen3-14b")

app = FastAPI(title="VN Studio local AI server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Transformers can take several seconds to initialize. Defer that cost until
# a model/embedding feature is requested, but keep the first import serialized:
# Transformers' lazy Auto classes are not thread-safe during first access.
_TRANSFORMERS_INIT_LOCK = threading.Lock()
_TRANSFORMERS_INIT_ATTEMPTED = False

def _ensure_transformers_ready():
    global _TRANSFORMERS_INIT_ATTEMPTED
    with _TRANSFORMERS_INIT_LOCK:
        if _TRANSFORMERS_INIT_ATTEMPTED:
            return
        _TRANSFORMERS_INIT_ATTEMPTED = True
        try:
            import transformers as _transformers
            for _auto_name in (
                "AutoTokenizer", "AutoProcessor", "AutoModel", "AutoModelForCausalLM",
                "AutoModelForSeq2SeqLM", "AutoModelForMultimodalLM",
                "AutoModelForImageTextToText", "AutoModelForVision2Seq",
            ):
                getattr(_transformers, _auto_name, None)
        except Exception as _pre:
            # Keep the API available even when optional AI dependencies are broken.
            print("[warn] transformers initialization:", _pre)

LOCK = threading.Lock()
JOBS: dict = {}
QUEUE: list = []
WAKE = threading.Event()

STATE = {"loaded": False, "model_id": None, "device": "cpu", "pipe": None, "error": None,
         "path": None, "strategy": None, "quant": None, "vram_gb": 0.0,
         "index_keys": [], "required": [], "explicit": [], "supports_alpha": False}

LLM_LOCK = threading.Lock()
LLM_STATE = {"model": None, "tokenizer": None, "processor": None, "loaded": False,
             "path": None, "device": None, "adapter": None, "profile": None, "error": None}

EMBED_PATH_DEFAULT = os.environ.get("VN_EMBED_PATH", "C:\\models\\e5-small")
EMBED_INDEX_DIR = os.path.join(os.path.dirname(__file__), "embeddings")
os.makedirs(EMBED_INDEX_DIR, exist_ok=True)
EMBED_LOCK = threading.RLock()
EMBED_STATE = {"model": None, "tokenizer": None, "loaded": False, "error": None}
EMBED_DIM = 384

def load_embed(path: str):
    _ensure_transformers_ready()
    import torch
    with EMBED_LOCK:
        if EMBED_STATE["loaded"]:
            return
        from transformers import AutoTokenizer, AutoModel
        tokenizer = AutoTokenizer.from_pretrained(path)
        model = AutoModel.from_pretrained(path).to("cuda" if torch.cuda.is_available() else "cpu")
        model.eval()
        EMBED_STATE.update(model=model, tokenizer=tokenizer, loaded=True, error=None)

def embed_texts(texts: list[str]) -> list[list[float]]:
    import torch
    with EMBED_LOCK:
        if not EMBED_STATE["loaded"]:
            load_embed(EMBED_PATH_DEFAULT)
        model = EMBED_STATE["model"]
        tokenizer = EMBED_STATE["tokenizer"]
        if model is None:
            raise RuntimeError("embedding model is not loaded")
        device = next(model.parameters()).device
        batch = tokenizer(texts, padding=True, truncation=True, max_length=512, return_tensors="pt").to(device)
        with torch.no_grad():
            out = model(**batch)
        emb = out.last_hidden_state.mean(dim=1)
        emb = torch.nn.functional.normalize(emb, p=2, dim=1)
        return emb.cpu().numpy().tolist()

def cosine_sim(a, b):
    s = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    return s / (na * nb) if na and nb else 0.0

def save_index(chapter_id: str, chunks: list[dict]):
    p = os.path.join(EMBED_INDEX_DIR, f"{chapter_id}.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=False)

def load_index(chapter_id: str):
    p = os.path.join(EMBED_INDEX_DIR, f"{chapter_id}.json")
    if not os.path.exists(p):
        return []
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def list_indexes():
    out = []
    for f in os.listdir(EMBED_INDEX_DIR):
        if f.endswith(".json"):
            out.append(f.replace(".json", ""))
    return out

class IndexReq(BaseModel):
    chapter_id: str
    chunks: list  # [{text, meta}]

class SearchReq(BaseModel):
    query: str
    top_k: int = 5
    exclude_chapter: str = ""

@app.post("/embeddings/load")
def embeddings_load(req: Optional[dict] = None):
    path = ((req or {}).get("model_path") or EMBED_PATH_DEFAULT)
    try:
        load_embed(path)
        return {"ok": True}
    except Exception as e:
        with EMBED_LOCK:
            EMBED_STATE.update(error=str(e))
        return {"ok": False, "error": str(e)}

@app.get("/embeddings/health")
def embeddings_health():
    with EMBED_LOCK:
        return {"loaded": EMBED_STATE["loaded"], "indexes": list_indexes(), "error": EMBED_STATE["error"]}

@app.post("/embeddings/unload")
def embeddings_unload():
    import gc
    with EMBED_LOCK:
        EMBED_STATE.update(loaded=False, model=None, tokenizer=None, error=None)
        gc.collect()
    return {"ok": True}

@app.post("/embeddings/index")
def embeddings_index(req: IndexReq):
    # Keep indexing atomic with respect to the clear operation.
    with EMBED_LOCK:
        texts = [c["text"] for c in req.chunks]
        vecs = embed_texts(texts)
        chunks = [{"text": c["text"], "meta": c.get("meta", {}), "vec": v} for c, v in zip(req.chunks, vecs)]
        save_index(req.chapter_id, chunks)
        return {"ok": True, "count": len(chunks)}

@app.post("/embeddings/clear")
def embeddings_clear():
    """Delete every persisted chapter index without unloading the embedding model."""
    with EMBED_LOCK:
        indexes = list_indexes()
        deleted = 0
        for chapter_id in indexes:
            path = os.path.join(EMBED_INDEX_DIR, f"{chapter_id}.json")
            try:
                if os.path.isfile(path):
                    os.remove(path)
                    deleted += 1
            except OSError as exc:
                raise HTTPException(500, f"Не удалось удалить индекс главы {chapter_id}: {exc}")
        return {"ok": True, "deleted": deleted, "indexes": indexes}


@app.post("/embeddings/search")
def embeddings_search(req: SearchReq):
    with EMBED_LOCK:
        q_vec = embed_texts([req.query])[0]
        results = []
        for cid in list_indexes():
            if cid == req.exclude_chapter:
                continue
            chunks = load_index(cid)
            for ch in chunks:
                score = cosine_sim(q_vec, ch["vec"])
                results.append({"chapter_id": cid, "text": ch["text"], "meta": ch.get("meta", {}), "score": score})
        results.sort(key=lambda x: x["score"], reverse=True)
        return {"results": results[:req.top_k]}

def _llm_load_with_progress(job):
    import contextlib
    import re
    import io as _io
    buf = _io.StringIO()
    stop = threading.Event()

    def monitor():
        while not stop.is_set():
            txt = buf.getvalue()
            if txt:
                last = txt.strip().split("\r")[-1].split("\n")[-1]
                m = re.search(r"(\d+)%.*?(\d+)/(\d+)", last)
                if m:
                    job["progress"] = min(0.99, int(m.group(1)) / 100.0)
                    job["stage"] = last.strip()[:140]
                elif last.strip():
                    job["stage"] = last.strip()[:140]
            stop.wait(0.4)

    t = threading.Thread(target=monitor, daemon=True)
    t.start()
    try:
        with contextlib.redirect_stderr(buf):
            ok = load_llm(job["req"].model_path or LLM_PATH_DEFAULT, job["req"].quantization)
    finally:
        stop.set()
        t.join()
    if not ok:
        raise RuntimeError(LLM_STATE.get("error") or "LLM load failed")
    job["progress"] = 1.0
    job["stage"] = "Ready"

class LoadReq(BaseModel):
    model_id: str = MODEL_ID_DEFAULT
    model_path: Optional[str] = None
    quantization: Literal["int4", "fp16", "none"] = "none"

class GenReq(BaseModel):
    model_id: str = MODEL_ID_DEFAULT
    model_path: Optional[str] = None
    quantization: Literal["int4", "fp16", "none"] = "none"
    prompt: str
    negative_prompt: str = ""
    width: int = 512
    height: int = 768
    steps: int = 6
    guidance: float = 1.0
    seed: int = -1
    transparent: bool = True

class LlmChatReq(BaseModel):
    messages: list
    max_tokens: int = 512
    temperature: float = 0.7
    thinking: bool = False

class LlmSuggestReq(BaseModel):
    context: dict
    max_tokens: int = 320
    temperature: float = 0.85
    count: int = 3

class OpenAiConnectionReq(BaseModel):
    base_url: str
    api_key: str = ''
    project_id: str = ''

class OpenAiChatReq(OpenAiConnectionReq):
    model: str
    messages: list
    max_tokens: int = 512
    temperature: float = 0.7

class AudioGenerateReq(BaseModel):
    prompt: str = Field(min_length=3, max_length=2000)
    lyrics: str = Field(default="", max_length=12000)
    duration: float = Field(default=30, ge=10, le=600)
    bpm: Optional[int] = Field(default=None, ge=30, le=300)
    instrumental: bool = True
    mode: Literal["music", "effect"] = "music"

class ModelDownloadReq(BaseModel):
    repo_id: str
    kind: str = 'llm'

class ModelCompatibilityReq(BaseModel):
    model_kind: str
    model_path: Optional[str] = None
    model_id: Optional[str] = None

# ============================================================
# Common helpers
# ============================================================

def cuda_info():
    # Called only by actual model loading, never by the lightweight health probe.
    try:
        import torch
        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            return "cuda", round(p.total_memory / 1024 ** 3, 2), torch.cuda.get_device_name(0)
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps", 0.0, "Apple Metal"
        if hasattr(torch, "xpu") and torch.xpu.is_available():
            try:
                return "xpu", 0.0, torch.xpu.get_device_name(0)
            except Exception:
                return "xpu", 0.0, "Intel XPU"
    except Exception:
        pass
    return "cpu", 0.0, "CPU"

def _fp(cls, path, **kw):
    """from_pretrained с новым ключом dtype и откатом на torch_dtype."""
    try:
        return cls.from_pretrained(path, **kw)
    except TypeError:
        if "dtype" in kw:
            kw["torch_dtype"] = kw.pop("dtype")
        return cls.from_pretrained(path, **kw)

# ============================================================
# Image generation (diffusers)
# ============================================================

def resolve_path(raw: Optional[str], model_id: str) -> str:
    cands = []
    if raw:
        cands.append(raw)
    if MODEL_PATH_DEFAULT:
        cands.append(MODEL_PATH_DEFAULT)
    for d in SEARCH_DIRS:
        if d and os.path.isdir(d):
            cands.append(os.path.join(d, model_id))
            cands += glob.glob(os.path.join(d, f"*{model_id}*"))
    for p in cands:
        if p and os.path.isdir(p) and os.path.exists(os.path.join(p, "model_index.json")):
            return p
    for p in cands:
        if p and os.path.isdir(p):
            return p
    raise FileNotFoundError("Need a diffusers FOLDER with model_index.json. Checked: "
                            + ", ".join([c for c in cands if c]))

def read_index(path):
    with open(os.path.join(path, "model_index.json"), "r", encoding="utf-8") as f:
        return json.load(f)

def index_declares(index, name):
    v = index.get(name)
    return isinstance(v, list) and len(v) == 2 and bool(v[0]) and bool(v[1])

KNOWN_COMPONENTS = {"tokenizer", "processor", "feature_extractor", "image_encoder",
                    "image_processor", "scheduler", "text_encoder", "transformer",
                    "vae", "unet", "controlnet", "safety_checker"}

def pipeline_all_params(pipe_cls):
    sig = inspect.signature(pipe_cls.__init__)
    out = []
    for n, p in sig.parameters.items():
        if n == "self" or n.startswith("_"):
            continue
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        out.append(n)
    return out

def pipeline_required(pipe_cls):
    sig = inspect.signature(pipe_cls.__init__)
    out = []
    for n, p in sig.parameters.items():
        if n == "self" or n.startswith("_"):
            continue
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        if p.default is not inspect.Parameter.empty:
            continue
        if n not in KNOWN_COMPONENTS:
            continue
        out.append(n)
    return out

def load_component(path, name, index, dtype, quant_config=None):
    folder = os.path.join(path, name)
    if name == "tokenizer":
        from transformers import AutoTokenizer
        return AutoTokenizer.from_pretrained(folder)
    if name == "processor":
        from transformers import AutoProcessor
        return AutoProcessor.from_pretrained(folder)
    lib, cls_name = (index.get(name) or [None, None])[:2]
    kw = {"dtype": dtype if dtype is not None else "auto"}
    if quant_config is not None:
        kw["quantization_config"] = quant_config
    if lib == "transformers" or name in ("text_encoder",):
        import transformers
        cls = getattr(transformers, cls_name, None) if cls_name else None
        if cls is None:
            from transformers import AutoModel
            cls = AutoModel
        return _fp(cls, folder, **kw)
    if lib == "diffusers":
        import diffusers
        cls = getattr(diffusers, cls_name, None) if cls_name else None
        if cls is not None:
            return _fp(cls, folder, **kw)
    raise RuntimeError(f"Cannot load component '{name}' from {folder}")

def pipeline_optional_overrides(pipe_cls, path, index):
    """Return None overrides for optional or explicitly disabled pipeline components."""
    params = set(pipeline_all_params(pipe_cls))
    optional = set(getattr(pipe_cls, "_optional_components", ()) or ())
    overrides = {}
    for name in params:
        config = index.get(name)
        explicitly_disabled = (
            isinstance(config, list)
            and len(config) == 2
            and config[0] is None
            and config[1] is None
        )
        missing_optional = (
            name in optional
            and name not in index
            and not os.path.isdir(os.path.join(path, name))
        )
        if explicitly_disabled or missing_optional:
            overrides[name] = None
    return overrides


def ensure_disk_components(path, required, job, optional_components=None):
    optional_components = set(optional_components or ())
    for name in required:
        if os.path.isdir(os.path.join(path, name)):
            continue
        # Some Diffusers constructor parameters are optional pipeline components.
        # They can be deliberately disabled in model_index.json and need no folder.
        if name in optional_components:
            continue
        if name == "tokenizer":
            job["stage"] = "Repairing missing tokenizer folder"
            proc = os.path.join(path, "processor")
            tok_files = ("tokenizer.json", "tokenizer_config.json", "vocab.json", "merges.txt")
            if os.path.isdir(proc) and any(f in tok_files for f in os.listdir(proc)):
                shutil.copytree(proc, os.path.join(path, "tokenizer"), dirs_exist_ok=True)
            else:
                from huggingface_hub import snapshot_download
                snapshot_download(TOKENIZER_FALLBACK_REPO, allow_patterns=["tokenizer/*"], local_dir=path)
        elif name == "processor":
            continue
        else:
            raise RuntimeError(f"Missing component folder '{name}' in {path}. Re-download the full repository.")

def check_alpha_support(path):
    """Проверяет, поддерживает ли модель нативную прозрачность."""
    try:
        idx = read_index(path)
        cls_name = str(idx.get("_class_name", "")).lower()
        # Qwen-Image и некоторые другие модели поддерживают RGBA
        if "qwen" in cls_name or "flux" in cls_name:
            return True
        # Проверяем конфиг VAE
        vae_cfg = os.path.join(path, "vae", "config.json")
        if os.path.exists(vae_cfg):
            with open(vae_cfg, "r") as f:
                cfg = json.load(f)
            if cfg.get("latents_channels", 4) == 4 or cfg.get("in_channels", 3) == 4:
                return True
    except Exception:
        pass
    return False

def _compatibility_profile_is_reliable(report: dict) -> bool:
    status = report.get("diagnostic_status", report.get("status"))
    return status not in ("blocked", "unsupported", "unknown")


def _compatibility_warnings(report: dict) -> list[str]:
    warnings = [str(item) for item in (report.get("warnings") or []) if item]
    status = report.get("diagnostic_status", report.get("status"))
    if status in ("blocked", "unsupported", "unknown"):
        warnings.insert(
            0,
            "Предварительная проверка выявила ограничения, но загрузка не запрещена. Выполняется пробная загрузка.",
        )
        warnings.extend(str(item) for item in (report.get("reasons") or []) if item)
    return list(dict.fromkeys(warnings))


def load_model(model_id: str, raw_path: str, job: dict, quantization_mode: str = "none"):
    _ensure_transformers_ready()
    import torch
    from diffusers import DiffusionPipeline

    path = resolve_path(raw_path, model_id)
    compatibility = build_compatibility_report(path, "image")
    profile_is_reliable = _compatibility_profile_is_reliable(compatibility)
    job["warnings"] = _compatibility_warnings(compatibility)
    if job["warnings"]:
        job["stage"] = "⚠️ Предупреждение диагностики; пробуем загрузить модель"

    device, vram, gpu_name = cuda_info()
    profile = compatibility.get("profile") or {}
    planned_device = profile.get("device") if profile_is_reliable else None
    if planned_device == "cpu" and device != "cpu" and quantization_mode != "int4":
        gpu_name = f"CPU fallback (GPU detected: {gpu_name})"
        device, vram = "cpu", 0.0
    if quantization_mode not in ("int4", "fp16", "none"):
        raise ValueError(f"Неизвестный режим квантования: {quantization_mode}")
    if device == "cuda":
        torch.cuda.set_device(0)
        try:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
        except Exception:
            pass
    # Preserve checkpoint precision in "none" mode; explicitly convert to FP16 otherwise.
    dtype = torch.float16 if quantization_mode in ("int4", "fp16") else "auto"
    index = read_index(path)
    pipe_cls = DiffusionPipeline
    cls_name = str(index.get("_class_name", ""))
    if cls_name:
        try:
            import diffusers
            pipe_cls = getattr(diffusers, cls_name)
        except Exception:
            pipe_cls = DiffusionPipeline
    required = pipeline_required(pipe_cls)
    all_params = pipeline_all_params(pipe_cls)
    optional_overrides = pipeline_optional_overrides(pipe_cls, path, index)
    job["stage"] = f"{gpu_name} | {vram} GB | {cls_name or 'DiffusionPipeline'}"
    job["progress"] = 0.05
    ensure_disk_components(path, required, job, optional_overrides.keys())
    undeclared = [n for n in all_params
                  if n in KNOWN_COMPONENTS and n not in optional_overrides
                  and not index_declares(index, n)
                  and os.path.isdir(os.path.join(path, n))]
    with LOCK:
        STATE.update(device=device, path=path, vram_gb=vram,
                     index_keys=[k for k in index.keys() if not k.startswith("_")],
                     required=required, explicit=undeclared,
                     supports_alpha=check_alpha_support(path))
    explicit = {}
    for name in undeclared:
        job["stage"] = f"Loading undeclared component: {name}"
        explicit[name] = load_component(path, name, index, dtype)
    # Pass None for disabled/missing optional components (e.g. Stable Diffusion
    # safety_checker in tiny checkpoints) instead of requiring an on-disk folder.
    component_kwargs = {**explicit, **optional_overrides}
    quant = "none"
    pipe = None
    if quantization_mode == "int4":
        if device != "cuda":
            raise RuntimeError("Режим INT4 сейчас поддерживается для локальной загрузки только через NVIDIA CUDA.")
        if not os.path.isdir(os.path.join(path, "transformer")):
            raise RuntimeError("Эта Diffusers-модель не содержит transformer, который можно загрузить в INT4.")
        try:
            from diffusers import BitsAndBytesConfig as DBnB
            from transformers import BitsAndBytesConfig as TBnB
            job["stage"] = "Квантование transformer в INT4 (NF4)"
            job["progress"] = 0.2
            t_cfg = DBnB(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                         bnb_4bit_compute_dtype=torch.float16, bnb_4bit_use_double_quant=True)
            kw = dict(component_kwargs)
            kw["transformer"] = load_component(path, "transformer", index, torch.float16, t_cfg)
            if os.path.isdir(os.path.join(path, "text_encoder")):
                try:
                    e_cfg = TBnB(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                 bnb_4bit_compute_dtype=torch.float16)
                    kw["text_encoder"] = load_component(path, "text_encoder", index, torch.float16, e_cfg)
                except Exception as exc:
                    job["warnings"].append("Текстовый энкодер оставлен в исходной точности: " + str(exc)[:180])
            job["progress"] = 0.7
            job["stage"] = "Сборка INT4 pipeline"
            if not compatibility.get("hardware", {}).get("software", {}).get("accelerate", {}).get("available"):
                raise RuntimeError("Для INT4-квантования Diffusers требуется пакет accelerate.")
            # Assemble without a forced device_map. The VRAM-aware placement
            # below decides between full-GPU execution and model CPU offload.
            pipe = _fp(pipe_cls, path, dtype=torch.float16, **kw)
            quant = "int4-nf4"
        except Exception as exc:
            raise RuntimeError(
                "Не удалось загрузить Diffusers-модель в INT4. Проверьте совместимость transformer и bitsandbytes: "
                + f"{type(exc).__name__}: {str(exc)[:300]}"
            ) from exc
    elif quantization_mode == "fp16":
        job["stage"] = "Загрузка модели в FP16"
        job["progress"] = 0.4
        pipe = _fp(pipe_cls, path, dtype=torch.float16, **component_kwargs)
        quant = "fp16"
    else:
        job["stage"] = "Загрузка без дополнительного квантования (точность весов модели)"
        job["progress"] = 0.4
        pipe = _fp(pipe_cls, path, dtype="auto", **component_kwargs)
        quant = "none"
    job["progress"] = 0.88
    if device == "cuda":
        model_weight_bytes = int(((compatibility.get("model") or {}).get("weight_bytes") or 0))
        estimated_memory_pressure = (
            not profile_is_reliable
            and model_weight_bytes > 0
            and vram > 0
            and model_weight_bytes > int(vram * (1024 ** 3) * 0.78)
        )
        use_offload = (
            (profile_is_reliable and bool(profile.get("offload")))
            or vram < LOW_VRAM_GB
            or estimated_memory_pressure
        )
        if use_offload and quant == "fp16":
            job["stage"] = "Enabling sequential CPU offload"
            pipe.enable_sequential_cpu_offload()
            strategy = "sequential_offload"
        elif use_offload:
            job["stage"] = "Enabling model CPU offload"
            try:
                pipe.enable_model_cpu_offload()
                strategy = "model_offload"
            except Exception:
                pipe.enable_sequential_cpu_offload()
                strategy = "sequential_offload"
        else:
            pipe.to("cuda")
            strategy = "full_gpu"
    else:
        job["stage"] = "Placing pipeline on " + device
        pipe.to(device)
        strategy = "cpu" if device == "cpu" else "full_" + device
    # VAE slicing/tiling are memory safeguards. Do not enable attention slicing
    # unconditionally: modern PyTorch SDPA is already efficient, and combining
    # both can cause severe inference slowdowns.
    for fn in ("enable_vae_slicing", "enable_vae_tiling"):
        try:
            getattr(pipe, fn)()
        except Exception:
            pass
    if device == "cuda":
        torch.cuda.empty_cache()
    with LOCK:
        STATE.update(loaded=True, model_id=model_id, pipe=pipe, error=None,
                     device=device, strategy=strategy, quant=quant, compatibility=compatibility)
    job["progress"] = 1.0
    job["stage"] = f"Ready | {quant} | {strategy}"

def _ensure_image_model_for_request(req, job: dict, force_quantization: bool = False):
    requested_path = resolve_path(getattr(req, "model_path", None) or "", req.model_id)
    requested_mode = {"int4": "int4-nf4", "fp16": "fp16", "none": "none"}.get(req.quantization, req.quantization)
    with LOCK:
        same_model = (
            STATE["loaded"]
            and STATE.get("model_id") == req.model_id
            and os.path.normcase(os.path.abspath(STATE.get("path") or "")) == os.path.normcase(os.path.abspath(requested_path))
        )
        same_mode = STATE.get("quant") == requested_mode
        if same_model and (not force_quantization or same_mode):
            job["progress"] = 1.0
            job["stage"] = f"Already loaded | {STATE.get('quant') or 'unknown'}"
            return
        STATE.update(loaded=False, pipe=None, strategy=None, quant=None, error=None)

    import gc
    gc.collect()
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:
        pass
    load_model(req.model_id, requested_path, job, req.quantization)


def run_generate(req: GenReq, job: dict):
    import torch
    from PIL import Image

    with LOCK:
        pipe = STATE["pipe"]
        strategy = STATE["strategy"]
        supports_alpha = STATE["supports_alpha"]
    if pipe is None:
        raise RuntimeError("Model is not loaded")
    seed = req.seed if req.seed >= 0 else int.from_bytes(os.urandom(4), "little") % (2 ** 31)
    runtime_device = STATE.get("device", "cpu")
    gen_device = "cpu" if strategy in ("sequential_offload", "model_offload") or runtime_device in ("cpu", "mps") else runtime_device
    generator = torch.Generator(device=gen_device).manual_seed(seed)
    total = max(1, req.steps)

    def cb(p, i, t, kw):
        if job.get("cancel"):
            raise InterruptedError("cancelled")
        job["progress"] = min(0.99, (i + 1) / total)
        job["stage"] = f"Diffusion step {i + 1}/{total}"
        return kw

    # Улучшаем промпт для прозрачности, если модель поддерживает
    prompt = req.prompt
    if req.transparent and supports_alpha:
        if "transparent" not in prompt.lower() and "alpha" not in prompt.lower():
            prompt = f"{prompt}, transparent background, isolated subject, no background"

    desired = {
        "prompt": prompt,
        "negative_prompt": req.negative_prompt or None,
        "width": req.width,
        "height": req.height,
        "num_inference_steps": req.steps,
        "generator": generator,
        "guidance_scale": req.guidance,
        "true_cfg_scale": req.guidance if req.guidance > 1 else 1.0,
        "callback_on_step_end": cb,
        "num_images_per_prompt": 1,
    }
    allowed = set(inspect.signature(pipe.__call__).parameters)
    kwargs = {k: v for k, v in desired.items() if k in allowed}
    if "callback_on_step_end" not in allowed:
        job["stage"] = "Diffusion (no step callback)"
        job["progress"] = 0.5
    out = pipe(**kwargs)
    image: Image.Image = out.images[0]

    # Обработка прозрачности
    if req.transparent:
        # Если модель вернула RGBA - используем как есть
        if image.mode == "RGBA":
            job["stage"] = "Using native alpha channel"
        # Иначе пробуем rembg как fallback
        else:
            try:
                from rembg import remove
                job["stage"] = "Removing background with rembg"
                image = remove(image)
            except Exception:
                # Простой конверт в RGBA (без реального удаления фона)
                image = image.convert("RGBA")
                job["stage"] = "Converted to RGBA (no background removal)"

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    job["result"] = {
        "image_base64": base64.b64encode(buf.getvalue()).decode("ascii"),
        "mime": "image/png", "seed": seed,
        "width": image.width, "height": image.height, "model_id": STATE["model_id"],
    }
    job["progress"] = 1.0
    job["stage"] = "Done"
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

# ============================================================
# LLM via transformers (same torch/CUDA stack as image gen)
# ============================================================

def _extract_json(text: str):
    s = text.find("{")
    e = text.rfind("}")
    if s == -1 or e == -1 or e <= s:
        return None
    try:
        return json.loads(text[s:e + 1])
    except Exception:
        return None

def _select_llm_adapter(path: str, model_info: dict):
    import transformers

    adapter = model_info.get("adapter")
    if adapter == "transformers_multimodal":
        model_cls = getattr(transformers, "AutoModelForMultimodalLM", None)
        if model_cls is None:
            model_cls = getattr(transformers, "AutoModelForImageTextToText", None)
        if model_cls is None:
            model_cls = getattr(transformers, "AutoModelForVision2Seq", None)
        if model_cls is None:
            raise RuntimeError(
                "Текущая версия Transformers не содержит подходящего AutoModel для этой мультимодальной архитектуры. "
                "Обновите Transformers или выберите поддерживаемый вариант модели."
            )
        processor_cls = getattr(transformers, "AutoProcessor", None)
        if processor_cls is None:
            raise RuntimeError("В установленной Transformers отсутствует AutoProcessor.")
        return model_cls, processor_cls, "transformers_multimodal"

    if adapter == "transformers_seq2seq":
        model_cls = getattr(transformers, "AutoModelForSeq2SeqLM", None)
        if model_cls is None:
            raise RuntimeError("В установленной Transformers отсутствует AutoModelForSeq2SeqLM.")
        return model_cls, None, "transformers_seq2seq"

    model_cls = getattr(transformers, "AutoModelForCausalLM", None)
    if model_cls is None:
        raise RuntimeError("В установленной Transformers отсутствует AutoModelForCausalLM.")
    return model_cls, None, "transformers_causal_lm"


def _llm_max_memory(compatibility: dict) -> Optional[dict]:
    hardware = compatibility.get("hardware") or {}
    memory = hardware.get("memory") or {}
    max_memory = {}
    for accelerator in hardware.get("accelerators") or []:
        if accelerator.get("backend") == "cuda":
            free = accelerator.get("free_vram_gb")
            if free is None:
                free = accelerator.get("total_vram_gb")
            if free:
                max_memory[int(accelerator.get("index", 0))] = f"{max(1, int(free * 0.78))}GiB"
    ram = memory.get("ram_available_gb")
    if ram:
        max_memory["cpu"] = f"{max(2, int(ram * 0.65))}GiB"
    return max_memory or None


def load_llm(path: str, quantization_mode: str = "none"):
    _ensure_transformers_ready()
    import torch
    from transformers import AutoTokenizer

    if not os.path.isdir(path):
        raise FileNotFoundError(f"LLM folder not found: {path}")
    if quantization_mode not in ("int4", "fp16", "none"):
        raise ValueError(f"Неизвестный режим квантования: {quantization_mode}")

    compatibility = build_compatibility_report(path, "llm")
    profile_is_reliable = _compatibility_profile_is_reliable(compatibility)
    model_info = compatibility.get("model") or {}
    model_cls, processor_cls, adapter = _select_llm_adapter(path, model_info)
    processor = None
    tokenizer = None
    if processor_cls is not None or model_info.get("processor_present"):
        try:
            from transformers import AutoProcessor
            processor = AutoProcessor.from_pretrained(path)
            tokenizer = getattr(processor, "tokenizer", None)
        except Exception as exc:
            if adapter == "transformers_multimodal":
                raise RuntimeError(
                    "Не удалось загрузить AutoProcessor мультимодальной модели: "
                    + f"{type(exc).__name__}: {str(exc)[:300]}"
                ) from exc
    if tokenizer is None:
        tokenizer = AutoTokenizer.from_pretrained(path)

    profile = dict(compatibility.get("profile") or {})
    if not profile_is_reliable:
        device, _, _ = cuda_info()
        strategy = "best_effort_" + device
    else:
        device = str(profile.get("device") or "cpu")
        strategy = str(profile.get("strategy") or "cpu_fp32")

    if quantization_mode == "int4":
        detected_device, _, _ = cuda_info()
        if detected_device != "cuda":
            raise RuntimeError("Режим INT4 сейчас поддерживается для локальной LLM только на NVIDIA CUDA.")
        device = "cuda"
        strategy = "cuda_int4_nf4"

    use_prequantized = bool(model_info.get("quantized"))
    quant_method = str(model_info.get("quant_method") or "native")
    if use_prequantized:
        if quantization_mode != "int4":
            raise RuntimeError(
                f"Эта модель уже сохранена в квантованном формате ({quant_method}). "
                "Выбрать FP16 или отключить квантование без скачивания не квантованной версии нельзя."
            )
        # A GPTQ/AWQ/BitsAndBytes checkpoint already carries its own quantization.
        # Do not attempt to quantize it a second time.
        applied_quantization = f"pre-quantized-{quant_method}"
    else:
        applied_quantization = quantization_mode

    dtype = torch.float16 if quantization_mode in ("int4", "fp16") else "auto"
    compute_dtype = torch.float16
    if quantization_mode == "int4":
        try:
            if torch.cuda.is_bf16_supported():
                compute_dtype = torch.bfloat16
        except Exception:
            pass

    accelerate_available = bool(
        compatibility.get("hardware", {}).get("software", {}).get("accelerate", {}).get("available")
    )
    kwargs = {
        "low_cpu_mem_usage": accelerate_available,
        "dtype": dtype,
    }

    if device == "cuda":
        if not accelerate_available:
            if quantization_mode == "int4":
                raise RuntimeError("Для INT4 требуется установленный accelerate.")
        else:
            kwargs["device_map"] = "auto"
            max_memory = _llm_max_memory(compatibility)
            if max_memory and profile_is_reliable and quantization_mode != "int4":
                kwargs["max_memory"] = max_memory
    elif device in ("mps", "xpu"):
        # Load in host RAM and transfer explicitly on non-CUDA accelerators.
        pass
    elif accelerate_available:
        kwargs["device_map"] = "cpu"

    if quantization_mode == "int4" and not use_prequantized:
        try:
            from transformers import BitsAndBytesConfig
            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=compute_dtype,
                bnb_4bit_use_double_quant=True,
            )
        except Exception as exc:
            raise RuntimeError(
                "Не удалось включить INT4: установите совместимую версию bitsandbytes. "
                + f"{type(exc).__name__}: {str(exc)[:240]}"
            ) from exc

    profile.update(
        device=device,
        dtype="float16" if quantization_mode in ("int4", "fp16") else "auto",
        quantization=applied_quantization,
    )

    try:
        try:
            model = model_cls.from_pretrained(path, **kwargs)
        except TypeError:
            if "dtype" in kwargs:
                kwargs["torch_dtype"] = kwargs.pop("dtype")
            model = model_cls.from_pretrained(path, **kwargs)
        if device in ("cpu", "cuda", "mps", "xpu") and "device_map" not in kwargs:
            model = model.to(device)
        model.eval()
        with LLM_LOCK:
            LLM_STATE.update(
                model=model, tokenizer=tokenizer, processor=processor, loaded=True,
                path=path, device=strategy, adapter=adapter, profile=profile,
                error=None, compatibility=compatibility,
            )
        return True
    except Exception as exc:
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
        message = f"{type(exc).__name__}: {str(exc)[:500]}"
        with LLM_LOCK:
            LLM_STATE.update(error=message, loaded=False)
        return False

def _apply_template(template_source, messages, thinking):
    apply_template = getattr(template_source, "apply_chat_template", None)
    has_chat_template = bool(
        getattr(template_source, "chat_template", None)
        or getattr(getattr(template_source, "tokenizer", None), "chat_template", None)
    )
    if callable(apply_template) and has_chat_template:
        try:
            return apply_template(
                messages, tokenize=False, add_generation_prompt=True, enable_thinking=thinking
            )
        except TypeError:
            return apply_template(messages, tokenize=False, add_generation_prompt=True)

    # Encoder-decoder and base text models often ship without a chat template.
    # Keep the role boundaries explicit instead of failing after a successful load.
    labels = {"system": "System", "user": "User", "assistant": "Assistant"}
    turns = []
    for message in messages:
        role = labels.get(str(message.get("role", "user")), "User")
        content = str(message.get("content", "")).strip()
        turns.append(f"{role}:\n{content}")
    turns.append("Assistant:")
    return "\n\n".join(turns)

def _llm_generate(messages, max_tokens, temperature, thinking=False, on_chunk=None, cancel_check=None):
    import torch
    from transformers import TextIteratorStreamer, StoppingCriteria, StoppingCriteriaList

    with LOCK:
        model = LLM_STATE["model"]
        tokenizer = LLM_STATE["tokenizer"]
        processor = LLM_STATE.get("processor")
    if model is None:
        raise RuntimeError("LLM not loaded. Call /llm/load first.")

    clean = [{"role": m.get("role", "user"), "content": str(m.get("content", ""))} for m in messages]
    template_source = processor if processor is not None and hasattr(processor, "apply_chat_template") else tokenizer
    prompt = _apply_template(template_source, clean, thinking)
    if processor is not None:
        try:
            inputs = processor(text=prompt, return_tensors="pt")
        except TypeError:
            inputs = processor(prompt, return_tensors="pt")
    else:
        inputs = tokenizer(prompt, return_tensors="pt")

    try:
        input_device = model.get_input_embeddings().weight.device
        if str(input_device) == "meta":
            input_device = model.device
    except Exception:
        input_device = getattr(model, "device", "cpu")
    inputs = inputs.to(input_device)

    gen_kw = dict(max_new_tokens=max_tokens, do_sample=temperature > 0,
                  pad_token_id=tokenizer.eos_token_id)
    if temperature > 0:
        gen_kw["temperature"] = temperature
        gen_kw["top_p"] = 0.9

    # Добавляем stopping criteria для отмены
    if cancel_check is not None:
        class _CancelStop(StoppingCriteria):
            def __call__(self, input_ids, scores, **kwargs):
                return bool(cancel_check())
        gen_kw["stopping_criteria"] = StoppingCriteriaList([_CancelStop()])

    if on_chunk is None:
        with LLM_LOCK, torch.no_grad():
            out = model.generate(**inputs, **gen_kw)
        is_encoder_decoder = bool(getattr(getattr(model, "config", None), "is_encoder_decoder", False))
        new = out[0] if is_encoder_decoder else out[0][inputs["input_ids"].shape[1]:]
        decoder = processor if processor is not None and hasattr(processor, "decode") else tokenizer
        return decoder.decode(new, skip_special_tokens=True).strip()

    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    gen_kw["streamer"] = streamer
    holder = {}

    def _run():
        try:
            with LLM_LOCK, torch.no_grad():
                model.generate(**inputs, **gen_kw)
        except Exception as e:
            holder["err"] = e

    t = threading.Thread(target=_run)
    t.start()
    full = []
    for chunk in streamer:
        full.append(chunk)
        on_chunk("".join(full))
        if cancel_check and cancel_check():
            break
    t.join()
    if holder.get("err"):
        raise holder["err"]
    return "".join(full).strip()

def _suggest_impl(req: LlmSuggestReq, cancel_check=None):
    ctx = req.context
    n = max(1, min(6, req.count))

    # История событий
    history = ctx.get("event_history", [])
    history_txt = "\n".join(f"  {h['meta'].get('speaker', '[событие]')}: {h['text']}" for h in history) or "  (нет)"

    # Другие персонажи
    others = ctx.get("other_characters_present", [])
    others_txt = ""
    if others:
        others_txt = "\n".join(
            f"  - {o['name']} ({o['personality'][:60]}...): последние реплики: {'; '.join(o['recent_lines'][-2:])}"
            for o in others
        )

    # Атмосфера
    atm = ctx.get("scene_atmosphere", {})
    atm_txt = ""
    if atm.get("backgrounds"):
        atm_txt += f"Фоны: {', '.join(atm['backgrounds'])}. "
    if atm.get("tracks"):
        atm_txt += f"Музыка: {', '.join(atm['tracks'])}."

    # RAG-контекст из предыдущих глав
    rag = ctx.get("rag_context", [])
    rag_txt = ""
    if rag:
        rag_txt = "\nСвязанные моменты из предыдущих глав:\n" + "\n".join(f"  - {r}" for r in rag)

    current_node = ctx.get("current_node") or {}
    requested_emotion = str(current_node.get("emotion") or "neutral").strip().lower()
    emotion_profiles = {
        "neutral": ("спокойствие", "говори ровно и сдержанно, без сильной радости, раздражения, печали или удивления"),
        "smile": ("улыбка", "передай дружелюбие, теплоту и лёгкую радость; допустимы мягкий юмор и доброжелательная игривость, но не злость и не уныние"),
        "angry": ("злость", "передай раздражение, гнев или напряжение через резкость, короткие фразы и твёрдую интонацию; не смягчай реплику до дружелюбной или весёлой"),
        "sad": ("грусть", "передай печаль, подавленность или уязвимость через тихую, сдержанную интонацию; не превращай реплику в весёлую, дерзкую или воодушевлённую"),
        "surprised": ("удивление", "передай неожиданность, изумление или растерянность через реакцию, вопросы, паузы или уточнения; не подменяй удивление злостью или радостью"),
    }
    emotion = requested_emotion if requested_emotion in emotion_profiles else "neutral"
    emotion_label, emotion_guidance = emotion_profiles[emotion]

    system = ("Ты - опытный сценарист визуальных новелл с глубоким пониманием психологии персонажей. "
              "Пиши живые, характерные реплики на русском языке, которые звучат естественно. "
              "Учитывай характер говорящего, его отношения с другими персонажами, атмосферу сцены и предыдущие события. "
              "Выбранное настроение реплики - обязательное ограничение для КАЖДОГО варианта: не меняй эмоцию ради разнообразия. "
              "Разнообразие допускается только в формулировке и речевом приёме внутри заданного настроения. "
              "Отвечай ТОЛЬКО валидным JSON без пояснений.")

    user = (
        f"Сцена: {ctx.get('chapter_title', '?')}\n"
        f"История событий до этого момента:\n{history_txt}\n"
        f"Говорит: {current_node.get('character_name', '?')}\n"
        f"Характер: {current_node.get('character_personality', 'не указан')}\n"
        f"Внешность: {current_node.get('character_appearance', 'не указана')}\n"
        f"ЦЕЛЕВОЕ НАСТРОЕНИЕ КАЖДОЙ РЕПЛИКИ: {emotion_label} (expression={emotion}).\n"
        f"Как его передать: {emotion_guidance}.\n"
        f"Отношения (переменные): {current_node.get('character_vars', {})}\n"
    )
    if others_txt:
        user += f"Другие персонажи в сцене:\n{others_txt}\n"
    if atm_txt:
        user += f"Атмосфера: {atm_txt}\n"
    if rag_txt:
        user += rag_txt + "\n"
    user += (
        f"Предложи ровно {n} варианта следующей реплики ЭТОГО персонажа. "
        "ВСЕ варианты обязаны сохранять заданное настроение. Различай их только формулировкой, ритмом и речевым приёмом внутри этой эмоции. "
        "Не предлагай альтернативные эмоции: например, не делай один вариант весёлым, а другой грустным или злым. "
        "Поле tone может описывать только стиль внутри заданного настроения. Учитывай характер и контекст.\n"
        '{"suggestions": [{"text": "...", "tone": "..."}]}'
    )

    raw = _llm_generate([{"role": "system", "content": system}, {"role": "user", "content": user}],
                        req.max_tokens, req.temperature, thinking=False, cancel_check=cancel_check)
    parsed = _extract_json(raw)
    if parsed and isinstance(parsed.get("suggestions"), list) and parsed["suggestions"]:
        return parsed
    return {"suggestions": [{"text": raw, "tone": "free"}], "raw": raw}

# ============================================================
# Worker and job queue
# ============================================================

def _download_hf_model(req: ModelDownloadReq, job: dict):
    repo_id = req.repo_id.strip()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo_id):
        raise ValueError('Укажите корректный Hugging Face repo ID: owner/model')
    if req.kind not in ('llm', 'image'):
        raise ValueError('Тип модели должен быть llm или image')
    model_root = SEARCH_DIRS[0] or os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(model_root, exist_ok=True)
    folder = repo_id.replace('/', '--')
    target = os.path.abspath(os.path.join(model_root, folder))
    if os.path.commonpath([os.path.abspath(model_root), target]) != os.path.abspath(model_root):
        raise ValueError('Недопустимый путь для сохранения модели')

    job['stage'] = 'Получение списка файлов модели…'
    job['progress'] = 0.02
    from huggingface_hub import HfApi, snapshot_download
    from tqdm.auto import tqdm

    # Get a stable denominator before downloading. snapshot_download discovers
    # files concurrently, so using its growing total directly can make the
    # displayed percentage jump or move backwards while more files are queued.
    total_bytes = 0
    existing_bytes = 0
    try:
        repo_info = HfApi().model_info(repo_id=repo_id, files_metadata=True)
        files = list(getattr(repo_info, 'siblings', None) or [])
        total_bytes = sum(int(getattr(item, 'size', 0) or 0) for item in files)
        for item in files:
            size = int(getattr(item, 'size', 0) or 0)
            relative_path = str(getattr(item, 'rfilename', '') or '')
            if size <= 0 or not relative_path:
                continue
            local_file = os.path.join(target, *relative_path.split('/'))
            try:
                if os.path.isfile(local_file) and os.path.getsize(local_file) >= size:
                    existing_bytes += size
            except OSError:
                pass
    except Exception:
        # snapshot_download remains the source of truth for access/download
        # errors. If metadata is unavailable, its own tqdm total is our fallback.
        total_bytes = 0
        existing_bytes = 0

    progress_lock = threading.Lock()
    progress_state = {"fraction": 0.0}

    def human_size(value: int) -> str:
        amount = float(max(0, value))
        for unit in ("Б", "КиБ", "МиБ", "ГиБ", "ТиБ"):
            if amount < 1024 or unit == "ТиБ":
                return f"{amount:.1f} {unit}" if unit != "Б" else f"{amount:.0f} {unit}"
            amount /= 1024
        return f"{amount:.1f} ТиБ"

    def publish_progress(downloaded_bytes: int, bar_total: int = 0):
        denominator = total_bytes or int(bar_total or 0)
        downloaded = max(0, int(downloaded_bytes or 0))
        already_present = existing_bytes if total_bytes else 0
        current = min(denominator, already_present + downloaded) if denominator else downloaded
        fraction = min(1.0, current / denominator) if denominator > 0 else 0.0
        with progress_lock:
            # A multi-file download discovers file sizes while workers start.
            # Keep the UI monotonic if the Hub has not supplied a full total.
            fraction = max(progress_state["fraction"], fraction)
            progress_state["fraction"] = fraction
            next_progress = min(0.98, 0.02 + fraction * 0.96)
            job["progress"] = max(float(job.get("progress", 0.02)), next_progress)
            if denominator > 0:
                job["stage"] = (
                    f"Скачивание {repo_id}: "
                    f"{human_size(current)} / {human_size(denominator)}"
                )
            else:
                job["stage"] = f"Скачивание {repo_id}: получено {human_size(downloaded)}"

    if total_bytes > 0:
        publish_progress(0, total_bytes)

    class DownloadProgressTqdm(tqdm):
        """Route Hugging Face byte progress to the background job, without console bars."""

        def __init__(self, *args, **kwargs):
            self._vn_track_bytes = str(kwargs.get("unit", "")).lower() in ("b", "byte", "bytes")
            # Hugging Face adds a diagnostic "name" kwarg that tqdm itself
            # does not accept. The name is only used internally by the Hub.
            kwargs.pop("name", None)
            # The server is not attached to a TTY. Keep tqdm's counters active,
            # but send its output to an in-memory stream instead of stderr.
            kwargs["disable"] = False
            kwargs["leave"] = False
            kwargs["file"] = io.StringIO()
            super().__init__(*args, **kwargs)
            if self._vn_track_bytes:
                publish_progress(self.n, self.total or 0)

        def update(self, n=1):
            result = super().update(n)
            if self._vn_track_bytes:
                publish_progress(self.n, self.total or 0)
            return result

        def update_transfer(self, n=1):
            # Some Hugging Face/Xet versions expose network-transfer bytes
            # through this optional tqdm hook.
            return self.update(n)

    job['stage'] = 'Подготовка загрузки с Hugging Face…'
    snapshot_download(
        repo_id=repo_id,
        local_dir=target,
        tqdm_class=DownloadProgressTqdm,
    )
    if req.kind == 'llm' and not os.path.isfile(os.path.join(target, 'config.json')):
        raise RuntimeError('В репозитории нет config.json. Для локальной LLM нужна модель формата Transformers; GGUF пока не поддерживается.')
    if req.kind == 'image' and not os.path.isfile(os.path.join(target, 'model_index.json')):
        raise RuntimeError('В репозитории нет model_index.json. Это не Diffusers-модель.')
    job['progress'] = 1.0
    job['stage'] = 'Загрузка завершена'
    return {'id': folder, 'path': target, 'kind': req.kind}

def worker():
    while True:
        WAKE.wait()
        WAKE.clear()
        while True:
            with LOCK:
                if not QUEUE:
                    break
                jid = QUEUE.pop(0)
                job = JOBS[jid]
            job["state"] = "running"
            try:
                kind = job["kind"]
                if kind == "download":
                    job["result"] = _download_hf_model(job["req"], job)
                elif kind == "load":
                    _ensure_image_model_for_request(job["req"], job, force_quantization=True)
                elif kind == "llm_load":
                    _llm_load_with_progress(job)
                elif kind in ("llm_chat", "llm_suggest"):
                    job["stage"] = "Generating"
                    job["progress"] = 0.5
                    if not LLM_STATE["loaded"]:
                        _ensure_transformers_ready()
                        compatibility = build_compatibility_report(LLM_PATH_DEFAULT, "llm")
                        job["warnings"] = _compatibility_warnings(compatibility)
                        if not load_llm(LLM_PATH_DEFAULT, "none"):
                            raise RuntimeError(LLM_STATE.get("error") or "Не удалось загрузить локальную LLM.")
                    if kind == "llm_chat":
                        reply = _llm_generate(job["req"].messages, job["req"].max_tokens,
                                              job["req"].temperature, getattr(job["req"], "thinking", False),
                                              on_chunk=lambda txt: job.update(partial=txt),
                                              cancel_check=lambda: job.get("cancel"))
                        job["result"] = {"reply": reply}
                    else:
                        job["result"] = _suggest_impl(job["req"], cancel_check=lambda: job.get("cancel"))
                    job["progress"] = 1.0
                    job["stage"] = "Done"
                else:
                    _ensure_image_model_for_request(job["req"], job)
                    run_generate(job["req"], job)
                with LOCK:
                    job["state"] = "cancelled" if job.get("cancel") else "done"
            except InterruptedError:
                with LOCK:
                    job["state"] = "cancelled"
                    job["message"] = "Cancelled by user"
            except Exception as e:
                with LOCK:
                    job["state"] = "error"
                    job["message"] = f"{type(e).__name__}: {e}"
                STATE["error"] = str(e)

threading.Thread(target=worker, daemon=True).start()
_boot_mark("Background worker ready; registering HTTP routes")

def enqueue(kind, req, warnings: Optional[list[str]] = None) -> str:
    jid = uuid.uuid4().hex[:12]
    with LOCK:
        JOBS[jid] = {"kind": kind, "req": req, "state": "queued", "progress": 0.0,
                     "stage": "Queued", "cancel": False, "partial": "",
                     "warnings": list(warnings or [])}
        QUEUE.append(jid)
    WAKE.set()
    return jid

# ============================================================
# HTTP API: image generation
# ============================================================

@app.on_event("startup")
def _log_server_ready():
    _boot_mark("HTTP API ready and accepting requests")


@app.get("/health")
def health():
    # Readiness must not import PyTorch: its cold import can take several
    # seconds. GPU details are provided by /system/diagnostics when requested.
    with LOCK:
        loaded = STATE["loaded"]
        return {
            "ok": True, "service": "vn-studio-ai",
            "device": STATE["device"] if loaded else None,
            "gpu_name": None, "vram_gb": STATE["vram_gb"] if loaded else None,
            "model_loaded": loaded, "model_id": STATE["model_id"],
            "path": STATE["path"], "strategy": STATE["strategy"], "quant": STATE["quant"],
            "supports_alpha": STATE["supports_alpha"],
            "index_keys": STATE["index_keys"], "required": STATE["required"], "explicit": STATE["explicit"],
            "busy": bool(QUEUE) or any(j["state"] == "running" for j in JOBS.values()),
            "queue": len(QUEUE),
            "error": STATE["error"],
        }

@app.post("/models/download")
def models_download(req: ModelDownloadReq):
    return {"job_id": enqueue("download", req)}

@app.post("/models/compatibility")
def models_compatibility(req: ModelCompatibilityReq):
    if req.model_kind == "image":
        try:
            path = resolve_path(req.model_path or "", req.model_id or MODEL_ID_DEFAULT)
        except Exception:
            path = req.model_path or MODEL_PATH_DEFAULT
    elif req.model_kind == "llm":
        path = req.model_path or LLM_PATH_DEFAULT
    else:
        raise HTTPException(400, "model_kind должен быть llm или image")
    _ensure_transformers_ready()
    return build_compatibility_report(path, req.model_kind)


@app.get("/system/diagnostics")
def system_diagnostics():
    return get_hardware_report(SEARCH_DIRS[0] if SEARCH_DIRS else os.path.dirname(__file__))


@app.post("/model/load")
def model_load(req: LoadReq):
    try:
        path = resolve_path(req.model_path or "", req.model_id)
        _ensure_transformers_ready()
        compatibility = build_compatibility_report(path, "image")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(404, detail=str(exc))
    return {"job_id": enqueue("load", req, _compatibility_warnings(compatibility))}

@app.post("/generate")
def generate(req: GenReq):
    return {"job_id": enqueue("generate", req)}

@app.get("/jobs")
def jobs_list():
    with LOCK:
        return {
            "queue": len(QUEUE),
            "jobs": [
                {"id": jid, "kind": j["kind"], "state": j["state"], "stage": j["stage"], "progress": j["progress"]}
                for jid, j in list(JOBS.items())[-12:]
            ],
        }

@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    with LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return {k: job.get(k) for k in ("state", "progress", "stage", "message", "result", "partial", "warnings")}

@app.post("/jobs/{job_id}/cancel")
def job_cancel(job_id: str):
    with LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    job["cancel"] = True
    return {"ok": True}

# ============================================================
# HTTP API: LLM
# ============================================================

@app.post("/llm/load")
def llm_load(req: Optional[LoadReq] = None):
    request = req or LoadReq()
    path = request.model_path or LLM_PATH_DEFAULT
    if not os.path.isdir(path):
        raise HTTPException(404, detail=f"LLM folder not found: {path}")
    _ensure_transformers_ready()
    compatibility = build_compatibility_report(path, "llm")
    with LLM_LOCK:
        current_quantization = (LLM_STATE.get("profile") or {}).get("quantization", "none")
        same_requested_mode = current_quantization == request.quantization
        native_int4_checkpoint = current_quantization.startswith("pre-quantized-") and request.quantization == "int4"
        if LLM_STATE["loaded"] and LLM_STATE["path"] == path and (same_requested_mode or native_int4_checkpoint):
            return {"job_id": None, "ok": True, "message": "already loaded", "device": LLM_STATE["device"]}
        if LLM_STATE["loaded"]:
            LLM_STATE.update(loaded=False, model=None, tokenizer=None, processor=None,
                             adapter=None, profile=None)
    import gc
    gc.collect()
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:
        pass
    load_request = LoadReq(model_path=path, quantization=request.quantization)
    return {"job_id": enqueue("llm_load", load_request, _compatibility_warnings(compatibility))}

@app.post("/model/unload")
def model_unload():
    import gc
    import torch
    with LOCK:
        STATE.update(loaded=False, pipe=None, strategy=None, quant=None)
    gc.collect()
    try:
        torch.cuda.empty_cache()
    except Exception:
        pass
    return {"ok": True}

@app.post("/llm/unload")
def llm_unload():
    import gc
    import torch
    with LLM_LOCK:
        LLM_STATE.update(loaded=False, model=None, tokenizer=None, processor=None, adapter=None, profile=None)
    gc.collect()
    try:
        torch.cuda.empty_cache()
    except Exception:
        pass
    return {"ok": True}

@app.get("/models/list")
def models_list():
    image, llm, embed, seen = [], [], [], set()

    def classify(p):
        if os.path.exists(os.path.join(p, "model_index.json")):
            return "image"
        cfg_p = os.path.join(p, "config.json")
        if not os.path.exists(cfg_p):
            return None
        try:
            with open(cfg_p, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception:
            return None
        archs = cfg.get("architectures") or []
        mt = str(cfg.get("model_type", ""))
        if any(a.endswith("ForCausalLM") or a.endswith("LMHeadModel") or a.endswith("ForConditionalGeneration") for a in archs):
            return "llm"
        if mt in ("bert", "roberta", "xlm-roberta", "mpnet", "distilbert", "albert", "camembert", "electra") or \
           any(a in ("BertModel", "RobertaModel", "XLMRobertaModel", "MPNetModel", "DistilBertModel") for a in archs):
            return "embed"
        if os.path.exists(os.path.join(p, "tokenizer_config.json")) or os.path.exists(os.path.join(p, "tokenizer.json")):
            return "llm"
        return None

    for d in SEARCH_DIRS:
        if not d or not os.path.isdir(d):
            continue
        for entry in sorted(os.listdir(d)):
            p = os.path.join(d, entry)
            if not os.path.isdir(p) or p in seen:
                continue
            seen.add(p)
            kind = classify(p)
            item = {"id": entry, "path": p}
            if kind == "image":
                image.append(item)
            elif kind == "llm":
                llm.append(item)
            elif kind == "embed":
                embed.append(item)
    if LLM_PATH_DEFAULT and os.path.isdir(LLM_PATH_DEFAULT) and LLM_PATH_DEFAULT not in seen:
        llm.append({"id": os.path.basename(LLM_PATH_DEFAULT), "path": LLM_PATH_DEFAULT})
    if EMBED_PATH_DEFAULT and os.path.isdir(EMBED_PATH_DEFAULT) and EMBED_PATH_DEFAULT not in seen:
        embed.append({"id": os.path.basename(EMBED_PATH_DEFAULT), "path": EMBED_PATH_DEFAULT})
    return {"image": image, "llm": llm, "embed": embed}

def _openai_request(base_url: str, api_key: str, path: str, payload: Optional[dict] = None, project_id: str = ''):
    base = base_url.strip().rstrip('/')
    if not base.startswith(('https://', 'http://')):
        raise HTTPException(400, 'Адрес OpenAI API должен начинаться с http:// или https://')
    headers = {'Accept': 'application/json'}
    if api_key.strip():
        headers['Authorization'] = 'Bearer ' + api_key.strip()
    # The OpenAI SDK's project= parameter is sent as OpenAI-Project.
    # Yandex AI Studio uses it to scope requests to the target folder.
    if project_id.strip():
        headers['OpenAI-Project'] = project_id.strip()
    data = None
    method = 'GET'
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json'
        method = 'POST'
    request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace')[:1000]
        raise HTTPException(exc.code, detail or str(exc))
    except urllib.error.URLError as exc:
        raise HTTPException(502, 'Не удалось подключиться к OpenAI API: ' + str(exc.reason))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(502, 'OpenAI API вернул некорректный JSON: ' + str(exc))

@app.get("/llm/health")
def llm_health():
    with LLM_LOCK:
        profile = LLM_STATE.get("profile") or {}
        return {"loaded": LLM_STATE["loaded"], "path": LLM_STATE["path"],
                "device": LLM_STATE["device"], "quantization": profile.get("quantization"),
                "error": LLM_STATE["error"]}

@app.post("/openai/models")
def openai_models(req: OpenAiConnectionReq):
    return _openai_request(req.base_url, req.api_key, '/models', project_id=req.project_id)

@app.post("/openai/chat")
def openai_chat(req: OpenAiChatReq):
    payload = {
        'model': req.model,
        'messages': req.messages,
        'max_tokens': req.max_tokens,
        'temperature': req.temperature,
    }
    result = _openai_request(req.base_url, req.api_key, '/chat/completions', payload, project_id=req.project_id)
    try:
        content = result['choices'][0]['message']['content']
        if isinstance(content, list):
            content = ''.join(str(part.get('text', '')) for part in content if isinstance(part, dict))
        return {'reply': str(content or '')}
    except (KeyError, IndexError, TypeError):
        raise HTTPException(502, 'OpenAI API не вернул choices[0].message.content')

@app.post("/llm/chat")
def llm_chat(req: LlmChatReq):
    return {"job_id": enqueue("llm_chat", req)}

@app.post("/llm/suggest")
def llm_suggest(req: LlmSuggestReq):
    return {"job_id": enqueue("llm_suggest", req)}

# ============================================================
# HTTP API: isolated ACE-Step audio runtime
# ============================================================

@app.get("/audio/health")
def audio_health():
    return AUDIO_RUNTIME.health()


@app.post("/audio/install")
def audio_install():
    try:
        return {"job_id": AUDIO_RUNTIME.install()}
    except RuntimeError as exc:
        raise HTTPException(409, detail=str(exc))


@app.post("/audio/start")
def audio_start():
    try:
        return {"job_id": AUDIO_RUNTIME.start()}
    except RuntimeError as exc:
        raise HTTPException(409, detail=str(exc))


@app.post("/audio/stop")
def audio_stop():
    return AUDIO_RUNTIME.stop()


@app.get("/audio/jobs/{job_id}")
def audio_job_status(job_id: str):
    job = AUDIO_RUNTIME.get_job(job_id)
    if not job:
        raise HTTPException(404, "audio job not found")
    return job


@app.post("/audio/generate")
def audio_generate(req: AudioGenerateReq):
    try:
        return {"job_id": AUDIO_RUNTIME.generate(req)}
    except RuntimeError as exc:
        raise HTTPException(409, detail=str(exc))


@app.get("/audio/jobs/{job_id}/file")
def audio_job_file(job_id: str):
    path = AUDIO_RUNTIME.get_job_file(job_id)
    if path is None:
        job = AUDIO_RUNTIME.get_job(job_id)
        if not job:
            raise HTTPException(404, "audio job not found")
        if job.get("state") != "done":
            raise HTTPException(409, "audio generation is not finished")
        raise HTTPException(404, "generated audio file not found")
    return FileResponse(str(path), media_type="audio/wav", filename=path.name)


@app.post("/shutdown")
def shutdown_server(request: Request):
    # Only the local machine may stop its AI server. A client using a shared
    # network AI server must never be able to shut that remote process down.
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(403, "AI server shutdown is only allowed from localhost")

    def terminate_after_response():
        time.sleep(0.35)
        os.kill(os.getpid(), signal.SIGTERM)

    threading.Thread(target=terminate_after_response, daemon=True).start()
    return {"ok": True, "message": "AI server is shutting down"}


@app.on_event("shutdown")
def shutdown_audio_runtime():
    AUDIO_RUNTIME.shutdown()

