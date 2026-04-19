# OmniVoice 🌍

<p align="center">
  <img width="200" height="200" alt="OmniVoice" src="https://zhu-han.github.io/omnivoice/pics/omnivoice.jpg" />
</p>

<p align="center">
  <a href="https://huggingface.co/k2-fsa/OmniVoice"><img src="https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-Model-FFD21E" alt="Hugging Face Model"></a>
  &nbsp;
  <a href="https://huggingface.co/spaces/k2-fsa/OmniVoice"><img src="https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-Space-blue" alt="Hugging Face Space"></a>
  &nbsp;
  <a href="https://arxiv.org/abs/2604.00688"><img src="https://img.shields.io/badge/arXiv-Paper-B31B1B.svg"></a>
  &nbsp;
  <a href="https://zhu-han.github.io/omnivoice"><img src="https://img.shields.io/badge/GitHub.io-Demo_Page-blue?logo=GitHub&style=flat-square"></a>
  &nbsp;
  <a href="https://colab.research.google.com/github/k2-fsa/OmniVoice/blob/master/docs/OmniVoice.ipynb"><img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open In Colab"></a>
</p>

> **🍴 This is a fork of [k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice)**
>
> This repository extends the original OmniVoice project with a self-hosted Docker stack, a
> REST API backend, and a browser-based web UI. The core `omnivoice/` library and all original
> capabilities are preserved unchanged. New additions are described in the section below.

---

OmniVoice is a state-of-the-art massively multilingual zero-shot text-to-speech (TTS) model
supporting over 600 languages. Built on a novel diffusion language model-style architecture, it
generates high-quality speech with superior inference speed, supporting voice cloning and voice
design.

**Contents**:
[What's New in This Fork](#whats-new-in-this-fork) |
[Docker Stack](#docker-stack) |
[Key Features](#key-features) |
[Installation](#installation) |
[Quick Start](#quick-start) |
[Python API](#python-api) |
[Command-Line Tools](#command-line-tools) |
[Training & Evaluation](#training--evaluation) |
[Discussion](#discussion--communication) |
[Citation](#citation)

---

## What's New in This Fork

This fork introduces a complete **deployment layer** on top of the original OmniVoice Python
library, making it straightforward to run OmniVoice as a self-hosted service accessible from
any browser.

| Addition | Description |
|---|---|
| **Docker Stack** | Two-container setup (FastAPI backend + Nginx frontend) with a ready-to-use `docker-compose.yml` |
| **REST API** | FastAPI backend exposing all OmniVoice generation modes via HTTP with interactive Swagger docs |
| **Web UI** | Browser-based interface for Voice Cloning, Voice Design, and Auto modes |
| **GPU / CPU Toggle** | Live device switching from the UI at runtime — no container restart required |
| **Async Job Queue** | Long inference jobs run in a background thread; the client polls for completion (no HTTP timeouts) |
| **CUDA 12.4 Support** | Full NVIDIA Container Toolkit integration with a `TORCH_VARIANT=cu124` build argument |

> **No changes were made to the core `omnivoice/` library.** The original CLI tools, Python API,
> and pre-trained model weights are fully compatible with the upstream project.

---

## Docker Stack

### Project structure

```
OmniVoice/
├── backend/          ← FastAPI REST API + OmniVoice inference engine
│   ├── server.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/         ← Web UI (Nginx · static HTML/CSS/JS)
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── nginx.conf
│   └── Dockerfile
├── omnivoice/        ← Original OmniVoice Python library (unchanged)
├── docker-compose.yml
└── .dockerignore
```

### Ports

| Service | Internal port | Host port | URL |
|---|---|---|---|
| **frontend** | 80 (Nginx) | **8500** | <http://localhost:8500> |
| **backend** | 8080 (uvicorn) | **8501** | <http://localhost:8501/docs> |

### REST API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Server and model status + available devices |
| `GET` | `/api/languages` | List of 600+ supported languages |
| `GET` | `/api/voice-design-options` | Voice design attribute categories |
| `POST` | `/api/generate` | Start a TTS job — returns `{job_id}` (HTTP 202) |
| `GET` | `/api/jobs/{job_id}` | Poll job status (`queued` / `processing` / `done` / `error`) |
| `GET` | `/api/jobs/{job_id}/audio` | Download the generated WAV when the job is done |
| `GET` | `/api/device` | Current inference device + available devices |
| `POST` | `/api/device` | Switch inference device (body: `{"device": "cuda"}`) |

Interactive Swagger docs are available at <http://localhost:8501/docs> while the backend is running.

### Quick start with Docker

> **Requires Linux** with the NVIDIA Container Toolkit installed for GPU inference.
> CPU-only mode works on any OS that runs Docker.

```bash
# 1. Clone this fork
git clone https://github.com/HexAbyss/OmniVoice.git
cd OmniVoice

# 2. Build and start both containers
docker compose up --build

# 3. Open the Web UI
#    http://localhost:8500

# 4. (Optional) Browse the API docs
#    http://localhost:8501/docs
```

> **First run note**: the OmniVoice model (~several GB) is downloaded from HuggingFace on startup.
> A named volume `omnivoice-hf-cache` persists the weights so subsequent starts are instant.
>
> If HuggingFace is unreachable, set the mirror before running:
> ```bash
> export HF_ENDPOINT="https://hf-mirror.com"
> docker compose up --build
> ```

### GPU inference (NVIDIA)

The stack auto-detects CUDA on startup (`OMNIVOICE_DEVICE=auto`). To enable GPU inference:

**Step 1 — Install the NVIDIA Container Toolkit** (Linux only, one-time setup):

```bash
# Add the NVIDIA repository
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

**Step 2 — Verify GPU access inside Docker**:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

**Step 3 — Start the stack** (GPU deploy is already enabled in `docker-compose.yml`):

```bash
docker compose up --build
```

The web UI shows a **CPU / GPU toggle** in the header. Switching devices reloads the model in the
background (~15–30 s on first switch). The status bar shows `Ready · cuda` when the GPU is active.

> **CPU-only build** (lighter image, no CUDA dependencies):
> ```bash
> TORCH_VARIANT=cpu docker compose build && docker compose up
> ```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OMNIVOICE_MODEL` | `k2-fsa/OmniVoice` | HuggingFace repo id or local checkpoint path |
| `OMNIVOICE_DEVICE` | `auto` | `auto` (CUDA → MPS → CPU) · `cuda` · `mps` · `cpu` |
| `TORCH_VARIANT` | `cu124` | PyTorch wheel variant: `cu124` (CUDA 12.4) or `cpu` |

> The active device can also be changed live from the web UI without restarting the container.

### Managing the stack

```bash
# Stop containers (keep volumes)
docker compose down

# Stop and remove the model cache volume (frees disk space)
docker compose down -v

# Rebuild only the backend after code changes
docker compose up --build backend

# Rebuild only the frontend
docker compose up --build frontend

# Follow logs
docker compose logs -f
```

---

## Key Features

> *Original OmniVoice capabilities — provided by [k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice), unchanged in this fork.*

- **600+ Languages Supported**: The broadest language coverage among zero-shot TTS models ([full list](docs/languages.md)).
- **Voice Cloning**: State-of-the-art voice cloning quality.
- **Voice Design**: Control voices via assigned speaker attributes (gender, age, pitch, dialect/accent, whisper, etc.).
- **Fine-grained Control**: Non-verbal symbols (e.g., `[laughter]`) and pronunciation correction via pinyin or phonemes.
- **Fast Inference**: RTF as low as 0.025 (40× faster than real-time).
- **Diffusion Language Model-style Architecture**: A clean, streamlined, and scalable design that delivers both quality and speed.

---

## Installation

> These instructions install the original OmniVoice Python library directly (without Docker).
> For the Docker-based deployment, see [Docker Stack](#docker-stack) above.

Choose **one** of the following methods: **pip** or **uv**.

### pip

> We recommend using a fresh virtual environment (e.g., `conda`, `venv`) to avoid conflicts.

**Step 1**: Install PyTorch

<details>
<summary>NVIDIA GPU</summary>

```bash
pip install torch==2.8.0+cu128 torchaudio==2.8.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128
```

> See the [PyTorch official site](https://pytorch.org/get-started/locally/) for other CUDA versions.

</details>

<details>
<summary>Apple Silicon</summary>

```bash
pip install torch==2.8.0 torchaudio==2.8.0
```

</details>

**Step 2**: Install OmniVoice (choose one)

```bash
# From PyPI (stable release)
pip install omnivoice

# From the latest source on GitHub (no need to clone)
pip install git+https://github.com/k2-fsa/OmniVoice.git

# For development (clone first, editable install)
git clone https://github.com/k2-fsa/OmniVoice.git
cd OmniVoice
pip install -e .
```

### uv

```bash
git clone https://github.com/k2-fsa/OmniVoice.git
cd OmniVoice
uv sync
```

> **Tip**: Use a mirror with `uv sync --default-index "https://mirrors.aliyun.com/pypi/simple"`

---

## Quick Start

Try OmniVoice without coding:

- Launch the local Gradio demo: `omnivoice-demo --ip 0.0.0.0 --port 8001`
- Or try it on [HuggingFace Space](https://huggingface.co/spaces/k2-fsa/OmniVoice)
- Or run it in Google Colab: [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/k2-fsa/OmniVoice/blob/master/docs/OmniVoice.ipynb)

> If you have trouble connecting to HuggingFace when downloading pre-trained models, set
> `export HF_ENDPOINT="https://hf-mirror.com"` before running.

For full usage, see [Python API](#python-api) and [Command-Line Tools](#command-line-tools).

---

## Python API

OmniVoice supports three generation modes. All features are also available via
[command-line tools](#command-line-tools).

### Voice Cloning

Clone a voice from a short reference audio. Provide `ref_audio` and optionally `ref_text`:

```python
from omnivoice import OmniVoice
import soundfile as sf
import torch

model = OmniVoice.from_pretrained(
    "k2-fsa/OmniVoice",
    device_map="cuda:0",
    dtype=torch.float16
)
# Apple Silicon users: use device_map="mps" instead

audio = model.generate(
    text="Hello, this is a test of zero-shot voice cloning.",
    ref_audio="ref.wav",
    ref_text="Transcription of the reference audio.",
)  # Returns a list of np.ndarray with shape (T,) at 24 kHz

# ref_text can be omitted — Whisper will auto-transcribe ref_audio.

sf.write("out.wav", audio[0], 24000)
```

> **Tips**
>
> - Use a 3–10 second reference audio clip. Longer audio slows down inference and may degrade quality.
> - For standard pronunciation, use a reference audio in the **same language** as the target speech.
>   Cross-lingual cloning works but will carry an accent from the reference language.
> - For better results with Arabic numerals, normalize them to words first (e.g., "123" → "one hundred twenty-three").
>
> For more tips, see [docs/tips.md](docs/tips.md).

### Voice Design

Describe the desired voice with speaker attributes — no reference audio needed.
Supported attributes: **gender** (male/female), **age** (child to elderly),
**pitch** (very low to very high), **style** (whisper), **English accent**
(American, British, etc.), and **Chinese dialect** (四川话, 陕西话, etc.).
Attributes are comma-separated and freely combinable across categories.

```python
audio = model.generate(
    text="Hello, this is a test of zero-shot voice design.",
    instruct="female, low pitch, british accent",
)
```

> **Note**: Voice design was trained on Chinese and English data only. Results may be unstable for
> some low-resource languages.

See [docs/voice-design.md](docs/voice-design.md) for the full attribute reference and usage tips.

### Auto Voice

Let the model choose a voice automatically:

```python
audio = model.generate(text="This is a sentence without any voice prompt.")
```

### Generation Parameters

All three modes share the same `model.generate()` API:

```python
audio = model.generate(
    text="...",
    num_step=32,   # diffusion steps (use 16 for faster inference)
    speed=1.0,     # speed factor (>1.0 faster, <1.0 slower)
    duration=10.0, # fixed output duration in seconds (overrides speed)
)
```

See [docs/generation-parameters.md](docs/generation-parameters.md) for all available options.

### Non-Verbal & Pronunciation Control

**Non-verbal symbols**: Insert tags directly in the text to add expressive sounds.

```python
audio = model.generate(text="[laughter] You really got me. I didn't see that coming at all.")
```

Supported tags: `[laughter]`, `[sigh]`, `[confirmation-en]`, `[question-en]`, `[question-ah]`,
`[question-oh]`, `[question-ei]`, `[question-yi]`, `[surprise-ah]`, `[surprise-oh]`,
`[surprise-wa]`, `[surprise-yo]`, `[dissatisfaction-hnn]`.

**Pronunciation control (Chinese)**: Use pinyin with tone numbers to correct character pronunciations.

```python
audio = model.generate(text="这批货物打ZHE2出售后他严重SHE2本了，再也经不起ZHE1腾了。")
```

**Pronunciation control (English)**: Use the [CMU pronunciation dictionary](https://svn.code.sf.net/p/cmusphinx/code/trunk/cmudict/cmudict.0.7a) (uppercase, in brackets) to override default pronunciations.

```python
audio = model.generate(text="He plays the [B EY1 S] guitar while catching a [B AE1 S] fish.")
```

---

## Command-Line Tools

Three CLI entry points are provided. All support voice cloning, voice design, auto voice, and
generation parameters.

| Command | Description | Source |
|---|---|---|
| `omnivoice-demo` | Interactive Gradio web demo | [omnivoice/cli/demo.py](omnivoice/cli/demo.py) |
| `omnivoice-infer` | Single-item inference | [omnivoice/cli/infer.py](omnivoice/cli/infer.py) |
| `omnivoice-infer-batch` | Batch inference across multiple GPUs | [omnivoice/cli/infer_batch.py](omnivoice/cli/infer_batch.py) |

### Demo

```bash
omnivoice-demo --ip 0.0.0.0 --port 8001
```

See `omnivoice-demo --help` for all options.

### Single Inference

```bash
# Voice Cloning (ref_text is optional — Whisper will auto-transcribe ref_audio)
omnivoice-infer \
    --model k2-fsa/OmniVoice \
    --text "This is a test for text to speech." \
    --ref_audio ref.wav \
    --ref_text "Transcription of the reference audio." \
    --output hello.wav

# Voice Design
omnivoice-infer \
    --model k2-fsa/OmniVoice \
    --text "This is a test for text to speech." \
    --instruct "male, British accent" \
    --output hello.wav

# Auto Voice
omnivoice-infer \
    --model k2-fsa/OmniVoice \
    --text "This is a test for text to speech." \
    --output hello.wav
```

### Batch Inference

`omnivoice-infer-batch` distributes batch inference across multiple GPUs for large-scale tasks.

```bash
omnivoice-infer-batch \
    --model k2-fsa/OmniVoice \
    --test_list test.jsonl \
    --res_dir results/
```

Each line in `test.jsonl` is a JSON object:

```json
{"id": "sample_001", "text": "Hello world", "ref_audio": "/path/to/ref.wav", "ref_text": "Reference transcript", "instruct": "female, british accent", "language_id": "en", "duration": 10.0, "speed": 1.0}
```

Only `id` and `text` are mandatory. `ref_audio`/`ref_text` enable voice cloning; `instruct`
enables voice design. If neither is provided, a random voice is used. `duration` (seconds) fixes
the output length and overrides `speed` when both are specified.

---

## Training & Evaluation

See [examples/](examples/) for the complete pipeline — from data preparation to training,
evaluation, and finetuning.

---

## Discussion & Communication

Discuss on [GitHub Issues](https://github.com/k2-fsa/OmniVoice/issues).

You can also scan the QR code to join the WeChat group or follow the official WeChat account.

| WeChat Group | WeChat Official Account |
| ------------ | ----------------------- |
|![wechat](https://k2-fsa.org/zh-CN/assets/pic/wechat_group.jpg) |![wechat](https://k2-fsa.org/zh-CN/assets/pic/wechat_account.jpg) |

---

## Community Projects

- **[omnivoice-server](https://github.com/maemreyo/omnivoice-server)** —
  OpenAI-compatible HTTP server for serving OmniVoice via `/v1/audio/speech`.
  Supports voice profiles for persistent cloning, sentence-level streaming,
  and optional Bearer auth.

- **[omnivoice-rs](https://github.com/FerrisMind/omnivoice-rs)** —
  GPU-first Rust workspace for OmniVoice inference, parity validation, CLI
  execution, and an OpenAI-compatible HTTP server built with Candle.

---

## Citation

```bibtex
@article{zhu2026omnivoice,
      title={OmniVoice: Towards Omnilingual Zero-Shot Text-to-Speech with Diffusion Language Models},
      author={Zhu, Han and Ye, Lingxuan and Kang, Wei and Yao, Zengwei and Guo, Liyong and Kuang, Fangjun and Han, Zhifeng and Zhuang, Weiji and Lin, Long and Povey, Daniel},
      journal={arXiv preprint arXiv:2604.00688},
      year={2026}
}
```
