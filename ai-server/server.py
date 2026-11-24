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
import urllib.error
import urllib.request
from typing import Optional

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0")
if os.name != "nt":
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from compatibility import build_compatibility_report, get_hardware_report

MODEL_ID_DEFAULT = os.environ.get("VN_MODEL_ID", "qwen_image_2.1_turbo_int8_convrot")
MODEL_PATH_DEFAULT = os.environ.get("VN_MODEL_PATH", "")
SEARCH_DIRS = [os.environ.get("VN_MODELS_DIR", "C:\\models"), os.path.join(os.path.dirname(__file__), "models")]
LOW_VRAM_GB = float(os.environ.get("VN_LOW_VRAM_GB", "10"))
TOKENIZER_FALLBACK_REPO = os.environ.get("VN_TOKENIZER_REPO", "Qwen/Qwen-Image")
LLM_PATH_DEFAULT = os.environ.get("VN_LLM_PATH", "C:\\models\\qwen3-14b")

app = FastAPI(title="VN Studio local AI server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Transformers lazy modules are NOT thread-safe on first import.
# Touch the supported Auto classes once, single-threaded, when the server starts.
try:
    import transformers as _transformers
    for _auto_name in (
        "AutoTokenizer", "AutoProcessor", "AutoModel", "AutoModelForCausalLM",
        "AutoModelForSeq2SeqLM", "AutoModelForMultimodalLM",
        "AutoModelForImageTextToText",
    ):
        getattr(_transformers, _auto_name, None)
except Exception as _pre:
    print("[warn] transformers pre-import:", _pre)

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
    texts = [c["text"] for c in req.chunks]
    vecs = embed_texts(texts)
    chunks = [{"text": c["text"], "meta": c.get("meta", {}), "vec": v} for c, v in zip(req.chunks, vecs)]
    save_index(req.chapter_id, chunks)
    return {"ok": True, "count": len(chunks)}

@app.post("/embeddings/search")
def embeddings_search(req: SearchReq):
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
            ok = load_llm(job["req"].model_path or LLM_PATH_DEFAULT)
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

class GenReq(BaseModel):
    model_id: str = MODEL_ID_DEFAULT
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

class OpenAiChatReq(OpenAiConnectionReq):
    model: str
    messages: list
    max_tokens: int = 512
    temperature: float = 0.7

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
    kw = {"dtype": dtype}
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

def ensure_disk_components(path, required, job):
    for name in required:
        if os.path.isdir(os.path.join(path, name)):
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

def load_model(model_id: str, raw_path: str, job: dict):
    import torch
    from diffusers import DiffusionPipeline

    path = resolve_path(raw_path, model_id)
    compatibility = build_compatibility_report(path, "image")
    if not compatibility.get("can_load"):
        detail = "; ".join(compatibility.get("reasons") or ["Модель несовместима с этим компьютером."])
        raise RuntimeError("Проверка совместимости не пройдена: " + detail)

    device, vram, gpu_name = cuda_info()
    planned_device = (compatibility.get("profile") or {}).get("device")
    if planned_device == "cpu" and device != "cpu":
        gpu_name = f"CPU fallback (GPU detected: {gpu_name})"
        device, vram = "cpu", 0.0
    if device == "cuda":
        torch.cuda.set_device(0)
        try:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
        except Exception:
            pass
        dtype = torch.float16
    elif device == "mps":
        dtype = torch.float16
    elif device == "xpu":
        dtype = torch.bfloat16 if hasattr(torch, "bfloat16") else torch.float32
    else:
        dtype = torch.float32
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
    job["stage"] = f"{gpu_name} | {vram} GB | {cls_name or 'DiffusionPipeline'}"
    job["progress"] = 0.05
    ensure_disk_components(path, required, job)
    all_params = pipeline_all_params(pipe_cls)
    undeclared = [n for n in all_params
                  if n in KNOWN_COMPONENTS and not index_declares(index, n)
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
    quant = None
    pipe = None
    planned_quant = (compatibility.get("profile") or {}).get("quantization")
    if device == "cuda" and planned_quant == "4bit-nf4" and os.path.isdir(os.path.join(path, "transformer")):
        try:
            job["stage"] = "Quantizing transformer to 4-bit nf4"
            job["progress"] = 0.2
            from diffusers import BitsAndBytesConfig as DBnB
            t_cfg = DBnB(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                         bnb_4bit_compute_dtype=dtype, bnb_4bit_use_double_quant=True)
            kw = dict(explicit)
            kw["transformer"] = load_component(path, "transformer", index, dtype, t_cfg)
            job["progress"] = 0.5
            job["stage"] = "Quantizing text encoder to 4-bit nf4"
            try:
                from transformers import BitsAndBytesConfig as TBnB
                e_cfg = TBnB(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=dtype)
                kw["text_encoder"] = load_component(path, "text_encoder", index, dtype, e_cfg)
            except Exception:
                pass
            job["progress"] = 0.75
            job["stage"] = "Assembling pipeline"
            pipe = _fp(pipe_cls, path, dtype=dtype, **kw)
            quant = "4bit-nf4"
        except Exception as e:
            pipe = None
            job["stage"] = f"4-bit failed ({type(e).__name__}: {str(e)[:120]}), trying 8-bit"
            try:
                from diffusers import BitsAndBytesConfig as DBnB
                t_cfg = DBnB(load_in_8bit=True)
                kw = dict(explicit)
                kw["transformer"] = load_component(path, "transformer", index, dtype, t_cfg)
                pipe = _fp(pipe_cls, path, dtype=dtype, **kw)
                quant = "8bit"
            except Exception:
                pipe = None
    if pipe is None:
        job["stage"] = "Loading float16 pipeline"
        job["progress"] = 0.4
        pipe = _fp(pipe_cls, path, dtype=dtype, **explicit)
        quant = "fp16"
    job["progress"] = 0.88
    if device == "cuda":
        use_offload = bool((compatibility.get("profile") or {}).get("offload")) or vram < LOW_VRAM_GB
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
    for fn in ("enable_vae_slicing", "enable_vae_tiling", "enable_attention_slicing"):
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
    gen_device = "cpu" if strategy in ("sequential_offload", "model_offload") else STATE.get("device", "cpu")
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
            raise RuntimeError(
                "Текущая версия Transformers не поддерживает мультимодальный AutoModel. "
                "Обновите Transformers и повторите проверку совместимости."
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
            free = accelerator.get("free_vram_gb") or accelerator.get("total_vram_gb")
            if free:
                max_memory[int(accelerator.get("index", 0))] = f"{max(1, int(free * 0.78))}GiB"
    ram = memory.get("ram_available_gb")
    if ram:
        max_memory["cpu"] = f"{max(2, int(ram * 0.65))}GiB"
    return max_memory or None


def load_llm(path: str):
    import torch
    from transformers import AutoTokenizer

    if not os.path.isdir(path):
        raise FileNotFoundError(f"LLM folder not found: {path}")

    compatibility = build_compatibility_report(path, "llm")
    if not compatibility.get("can_load"):
        detail = "; ".join(compatibility.get("reasons") or ["Модель несовместима с этим компьютером."])
        with LOCK:
            LLM_STATE.update(error=detail)
        return False

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

    profile = compatibility.get("profile") or {}
    device = str(profile.get("device") or "cpu")
    strategy = str(profile.get("strategy") or "cpu_fp32")
    dtype_name = str(profile.get("dtype") or "float32")
    if dtype_name == "bfloat16" and hasattr(torch, "bfloat16"):
        dtype = torch.bfloat16
    elif dtype_name == "float16":
        dtype = torch.float16
    else:
        dtype = torch.float32

    kwargs = {"torch_dtype": dtype, "low_cpu_mem_usage": bool(compatibility.get("hardware", {}).get("software", {}).get("accelerate", {}).get("available"))}
    if device == "cuda":
        if kwargs["low_cpu_mem_usage"]:
            kwargs["device_map"] = "auto"
            max_memory = _llm_max_memory(compatibility)
            if max_memory:
                kwargs["max_memory"] = max_memory
    elif device in ("mps", "xpu"):
        if kwargs["low_cpu_mem_usage"]:
            kwargs["device_map"] = "auto"
    elif kwargs["low_cpu_mem_usage"]:
        kwargs["device_map"] = "cpu"

    if profile.get("quantization") == "4bit-nf4":
        try:
            from transformers import BitsAndBytesConfig
            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=dtype,
                bnb_4bit_use_double_quant=True,
            )
        except Exception as exc:
            raise RuntimeError(
                "Диагностика выбрала 4-битный режим, но BitsAndBytes недоступен: "
                + f"{type(exc).__name__}: {str(exc)[:240]}"
            ) from exc

    try:
        try:
            model = model_cls.from_pretrained(path, **kwargs)
        except TypeError:
            # Compatibility with Transformers releases that still expect torch_dtype
            if "torch_dtype" in kwargs:
                kwargs["dtype"] = kwargs.pop("torch_dtype")
            model = model_cls.from_pretrained(path, **kwargs)
        if device in ("cpu", "cuda", "mps", "xpu") and "device_map" not in kwargs:
            model = model.to(device)
        model.eval()
        with LOCK:
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
        with LOCK:
            LLM_STATE.update(error=message, loaded=False)
        return False

def _apply_template(template_source, messages, thinking):
    try:
        return template_source.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=thinking
        )
    except TypeError:
        return template_source.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

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
        new = out[0][inputs["input_ids"].shape[1]:]
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

    system = ("Ты - опытный сценарист визуальных новелл с глубоким пониманием психологии персонажей. "
              "Пиши живые, характерные реплики на русском языке, которые звучат естественно. "
              "Учитывай характер говорящего, его отношения с другими персонажами, атмосферу сцены и предыдущие события. "
              "Отвечай ТОЛЬКО валидным JSON без пояснений.")

    user = (
        f"Сцена: {ctx.get('chapter_title', '?')}\n"
        f"История событий до этого момента:\n{history_txt}\n"
        f"Говорит: {ctx.get('current_node', {}).get('character_name', '?')}\n"
        f"Характер: {ctx.get('current_node', {}).get('character_personality', 'не указан')}\n"
        f"Внешность: {ctx.get('current_node', {}).get('character_appearance', 'не указана')}\n"
        f"Эмоция сейчас: {ctx.get('current_node', {}).get('emotion', 'neutral')}\n"
        f"Отношения (переменные): {ctx.get('current_node', {}).get('character_vars', {})}\n"
    )
    if others_txt:
        user += f"Другие персонажи в сцене:\n{others_txt}\n"
    if atm_txt:
        user += f"Атмосфера: {atm_txt}\n"
    if rag_txt:
        user += rag_txt + "\n"
    user += (
        f"Предложи ровно {n} вариант(а) следующей реплики ЭТОГО персонажа в заданной эмоции. "
        "Варианты должны различаться по тону (сдержанный, дерзкий, тёплый, ироничный и т.д.), "
        "но все оставаться в характере и учитывать контекст.\n"
        'Формат: {"suggestions": [{"text": "...", "tone": "..."}]}'
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
    job['stage'] = 'Подготовка загрузки с Hugging Face…'
    job['progress'] = 0.02
    from huggingface_hub import snapshot_download
    job['stage'] = 'Скачивание ' + repo_id + ' (возможна большая загрузка)…'
    snapshot_download(repo_id=repo_id, local_dir=target)
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
                    load_model(job["req"].model_id, job["req"].model_path or "", job)
                elif kind == "llm_load":
                    _llm_load_with_progress(job)
                elif kind in ("llm_chat", "llm_suggest"):
                    job["stage"] = "Generating"
                    job["progress"] = 0.5
                    if not LLM_STATE["loaded"] and not load_llm(LLM_PATH_DEFAULT):
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
                    if not STATE["loaded"]:
                        load_model(job["req"].model_id, job["req"].model_path or MODEL_PATH_DEFAULT, job)
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

def enqueue(kind, req) -> str:
    jid = uuid.uuid4().hex[:12]
    with LOCK:
        JOBS[jid] = {"kind": kind, "req": req, "state": "queued", "progress": 0.0,
                     "stage": "Queued", "cancel": False, "partial": ""}
        QUEUE.append(jid)
    WAKE.set()
    return jid

# ============================================================
# HTTP API: image generation
# ============================================================

@app.get("/health")
def health():
    device, vram, name = cuda_info()
    with LOCK:
        return {
            "ok": True, "service": "vn-studio-ai",
            "device": STATE["device"] if STATE["loaded"] else device,
            "gpu_name": name, "vram_gb": vram,
            "model_loaded": STATE["loaded"], "model_id": STATE["model_id"],
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
    return build_compatibility_report(path, req.model_kind)


@app.get("/system/diagnostics")
def system_diagnostics():
    return get_hardware_report(SEARCH_DIRS[0] if SEARCH_DIRS else os.path.dirname(__file__))


@app.post("/model/load")
def model_load(req: LoadReq):
    try:
        path = resolve_path(req.model_path or "", req.model_id)
        compatibility = build_compatibility_report(path, "image")
        if not compatibility.get("can_load"):
            raise HTTPException(422, detail={"message": "Модель несовместима с этим компьютером.", "report": compatibility})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(404, detail=str(exc))
    return {"job_id": enqueue("load", req)}

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
    return {k: job.get(k) for k in ("state", "progress", "stage", "message", "result", "partial")}

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
    path = (req.model_path if req and req.model_path else LLM_PATH_DEFAULT)
    compatibility = build_compatibility_report(path, "llm")
    if not compatibility.get("can_load"):
        raise HTTPException(422, detail={"message": "Модель несовместима с этим компьютером.", "report": compatibility})
    with LLM_LOCK:
        if LLM_STATE["loaded"] and LLM_STATE["path"] == path:
            return {"job_id": None, "ok": True, "message": "already loaded", "device": LLM_STATE["device"]}
    return {"job_id": enqueue("llm_load", LoadReq(model_path=path))}

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

def _openai_request(base_url: str, api_key: str, path: str, payload: Optional[dict] = None):
    base = base_url.strip().rstrip('/')
    if not base.startswith(('https://', 'http://')):
        raise HTTPException(400, 'Адрес OpenAI API должен начинаться с http:// или https://')
    headers = {'Accept': 'application/json'}
    if api_key.strip():
        headers['Authorization'] = 'Bearer ' + api_key.strip()
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
    with LOCK:
        return {"loaded": LLM_STATE["loaded"], "path": LLM_STATE["path"],
                "device": LLM_STATE["device"], "error": LLM_STATE["error"]}

@app.post("/openai/models")
def openai_models(req: OpenAiConnectionReq):
    return _openai_request(req.base_url, req.api_key, '/models')

@app.post("/openai/chat")
def openai_chat(req: OpenAiChatReq):
    payload = {
        'model': req.model,
        'messages': req.messages,
        'max_tokens': req.max_tokens,
        'temperature': req.temperature,
    }
    result = _openai_request(req.base_url, req.api_key, '/chat/completions', payload)
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