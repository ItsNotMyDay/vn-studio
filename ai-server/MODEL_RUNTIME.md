# VN Studio model runtime

## Purpose

VN Studio runs an explicit preflight before loading a local model. The preflight
collects information about the machine, inspects the downloaded model metadata,
estimates memory requirements, chooses a conservative device/dtype profile, and
returns an explainable status.

Statuses:

- `ready`: recognized model/runtime and estimated resources are sufficient.
- `warning`: a CPU, offload, quantized, or otherwise constrained profile is proposed.
- `blocked`: the current machine does not have a safe estimated memory profile.
- `unsupported`: the format, architecture, required package, or backend is not implemented.
- `unknown`: model path or metadata is unavailable.

The estimate is not a guarantee. The actual model load is the next validation
step; the first real generation can still expose model-specific requirements.

## Current adapters

| Model family | Adapter | Status |
| --- | --- | --- |
| Transformers causal language models | `AutoModelForCausalLM` | Implemented |
| Transformers encoder-decoder language models | `AutoModelForSeq2SeqLM` | Implemented |
| Transformers multimodal models | `AutoModelForMultimodalLM` or `AutoModelForImageTextToText` plus `AutoProcessor` | Text-only chat path implemented; media inputs need UI/runtime work |
| Diffusers image pipelines | `DiffusionPipeline` / pipeline class in `model_index.json` | Implemented |
| GGUF / GGML | llama.cpp | Detected; backend not yet connected |
| ONNX-only model packages | ONNX Runtime | Detected; model execution adapter not yet connected |
| Models requiring `trust_remote_code=True` | User-provided code | Blocked by default for safety |

## API

- `GET /system/diagnostics` — hardware and installed runtime versions.
- `POST /models/compatibility` — inspect one local model and return the proposed profile.
  Body: `{"model_kind":"llm","model_path":"C:/models/model"}`.
- `POST /llm/load` and `POST /model/load` — repeat compatibility preflight server-side before enqueuing the load.

The client UI shows the diagnostics in Settings → AI models and checks
compatibility before starting a local model load.

## Safety and scope

- `auto_map` entries are treated as requiring custom remote code and are not
  executed automatically.
- Model metadata and file size are read locally. No model code is executed during
  inspection.
- Memory estimates use the model's on-disk weight size and conservative overhead
  factors. They cannot fully predict context length, requested resolution,
  fragmentation, other workloads, kernel availability, or model-specific behavior.
- The runtime does not claim support merely because a model has a
  `config.json`. A specialized adapter and dependencies are required.

## Adding another adapter

Implement a model inspector branch that returns a stable adapter id, then add a
loader for that adapter. Keep the same compatibility report contract and include
unit tests for metadata recognition, required packages, and resource constraints.
Never enable custom repository code implicitly.
