#!/usr/bin/env python3
"""
FastAPI REST API server for OmniVoice.

Endpoints:
  GET  /api/health                — Health check + model status
  GET  /api/languages             — List of all 600+ supported languages
  GET  /api/voice-design-options  — Voice design attribute categories
  POST /api/generate              — Generate speech (WAV response)

Usage:
    # Via Python directly:
    python -m backend.server --port 8080

    # Via uvicorn (env-based config):
    OMNIVOICE_MODEL=k2-fsa/OmniVoice uvicorn backend.server:app --host 0.0.0.0 --port 8080

    # Via Docker Compose (recommended):
    docker compose up
"""

import argparse
import io
import logging
import os
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Dict, Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from omnivoice import OmniVoice, OmniVoiceGenerationConfig
from omnivoice.utils.lang_map import LANG_NAMES, lang_display_name

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configurable via env (useful when running with `uvicorn api.server:app`)
# ---------------------------------------------------------------------------
_model_id: str = os.environ.get("OMNIVOICE_MODEL", "k2-fsa/OmniVoice")
_device: Optional[str] = os.environ.get("OMNIVOICE_DEVICE", None)
_model: Optional[OmniVoice] = None
_is_reloading: bool = False
_reload_lock = threading.Lock()  # prevents concurrent reload requests

# ---------------------------------------------------------------------------
# Async job queue
# ---------------------------------------------------------------------------
_inference_sem = threading.Semaphore(1)  # one inference at a time


@dataclass
class JobResult:
    status: str           # "queued" | "processing" | "done" | "error"
    audio: Optional[bytes] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)


_jobs: Dict[str, JobResult] = {}
_jobs_lock = threading.Lock()


def _cleanup_old_jobs() -> None:
    """Remove completed/errored jobs older than 1 hour to free memory."""
    cutoff = time.time() - 3600
    with _jobs_lock:
        stale = [
            jid for jid, j in _jobs.items()
            if j.created_at < cutoff and j.status in ("done", "error")
        ]
        for jid in stale:
            del _jobs[jid]


def _run_inference(job_id: str, kw: dict, tmp_audio_path: Optional[str]) -> None:
    """Background thread: run OmniVoice inference and store the result."""
    with _inference_sem:
        # Guard: model may have been unloaded during a device switch
        if _model is None:
            with _jobs_lock:
                _jobs[job_id].status = "error"
                _jobs[job_id].error = "Model unavailable — a device switch is in progress. Please retry."
            return
        try:
            audio = _model.generate(**kw)
            buf = io.BytesIO()
            sf.write(buf, audio[0], _model.sampling_rate, format="WAV")
            buf.seek(0)
            with _jobs_lock:
                _jobs[job_id].status = "done"
                _jobs[job_id].audio = buf.read()
        except Exception as exc:
            logger.exception("Inference error for job %s", job_id)
            with _jobs_lock:
                _jobs[job_id].status = "error"
                _jobs[job_id].error = f"{type(exc).__name__}: {exc}"
        finally:
            if tmp_audio_path and os.path.exists(tmp_audio_path):
                try:
                    os.unlink(tmp_audio_path)
                except OSError:
                    pass
    _cleanup_old_jobs()


# ---------------------------------------------------------------------------
# Device management
# ---------------------------------------------------------------------------

def get_available_devices() -> list:
    """Return a list of devices available on this machine."""
    devices = ["cpu"]
    if torch.cuda.is_available():
        devices.append("cuda")
    if torch.backends.mps.is_available():
        devices.append("mps")
    return devices


def _do_reload_model(new_device: str) -> None:
    """Background thread: wait for any running inference, then reload on new device."""
    global _model, _device, _is_reloading
    # Acquire inference semaphore so we wait for any running job to finish
    # and block new ones from starting during the reload.
    with _inference_sem:
        try:
            _model = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            resolved = new_device if new_device not in ("auto", None) else get_best_device()
            _model, _device = load_model(_model_id, resolved)
            logger.info("Model reloaded on device: %s", _device)
        except Exception:
            logger.exception("Failed to reload model on device '%s'", new_device)
        finally:
            _is_reloading = False


# ---------------------------------------------------------------------------
# Voice design attribute categories (mirrored from demo.py)
# ---------------------------------------------------------------------------
VOICE_DESIGN_CATEGORIES = {
    "Gender": {
        "info": None,
        "options": ["Male", "Female"],
    },
    "Age": {
        "info": None,
        "options": ["Child", "Teenager", "Young Adult", "Middle-aged", "Elderly"],
    },
    "Pitch": {
        "info": None,
        "options": [
            "Very Low Pitch",
            "Low Pitch",
            "Moderate Pitch",
            "High Pitch",
            "Very High Pitch",
        ],
    },
    "Style": {
        "info": None,
        "options": ["Whisper"],
    },
    "English Accent": {
        "info": "Only effective for English speech.",
        "options": [
            "American Accent",
            "Australian Accent",
            "British Accent",
            "Chinese Accent",
            "Canadian Accent",
            "Indian Accent",
            "Korean Accent",
            "Portuguese Accent",
            "Russian Accent",
            "Japanese Accent",
        ],
    },
    "Chinese Dialect": {
        "info": "Only effective for Chinese speech.",
        "options": [
            "河南话",
            "陕西话",
            "四川话",
            "贵州话",
            "云南话",
            "桂林话",
            "济南话",
            "石家庄话",
            "甘肃话",
            "宁夏话",
            "青岛话",
            "东北话",
        ],
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_best_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_model(model_id: str, device: Optional[str]) -> tuple:
    """Load OmniVoice and return (model, resolved_device)."""
    dev = get_best_device() if (not device or device == "auto") else device
    dtype = torch.float16 if dev != "cpu" else torch.float32
    logger.info(f"Loading OmniVoice from '{model_id}' on {dev} (dtype={dtype}) …")
    model = OmniVoice.from_pretrained(model_id, device_map=dev, dtype=dtype)
    logger.info("Model loaded successfully.")
    return model, dev


# ---------------------------------------------------------------------------
# Lifespan — loads the model once at startup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model, _device
    _model, _device = load_model(_model_id, _device)
    yield


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="OmniVoice API",
    description="REST API for OmniVoice — massively multilingual zero-shot TTS.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["status"])
def health():
    """Return server and model status."""
    return {
        "status": "ok",
        "model": _model_id,
        "device": _device or get_best_device(),
        "model_loaded": _model is not None,
        "is_reloading": _is_reloading,
        "available_devices": get_available_devices(),
    }


@app.get("/api/languages", tags=["info"])
def get_languages():
    """Return the full list of supported language names."""
    languages = sorted(lang_display_name(n) for n in LANG_NAMES)
    return {"languages": ["Auto"] + languages}


@app.get("/api/voice-design-options", tags=["info"])
def get_voice_design_options():
    """Return the voice design attribute categories and their options."""
    return {"categories": VOICE_DESIGN_CATEGORIES}


@app.get("/api/device", tags=["device"])
def get_device():
    """Return current device, available devices, and reload status."""
    return {
        "current": _device or get_best_device(),
        "available": get_available_devices(),
        "is_reloading": _is_reloading,
        "model_loaded": _model is not None,
    }


@app.post("/api/device", status_code=202, tags=["device"])
def set_device(device: str = Body(..., embed=True)):
    """
    Switch the inference device (cpu / cuda / mps / auto).

    The model reloads in the background. Poll GET /api/device or GET /api/health
    until model_loaded=true and is_reloading=false.
    """
    global _is_reloading
    VALID = {"cpu", "cuda", "mps", "auto"}
    if device not in VALID:
        raise HTTPException(status_code=400, detail=f"device must be one of: {', '.join(sorted(VALID))}")
    if device == "cuda" and not torch.cuda.is_available():
        raise HTTPException(status_code=400, detail="CUDA is not available on this machine.")
    if device == "mps" and not torch.backends.mps.is_available():
        raise HTTPException(status_code=400, detail="MPS is not available on this machine.")
    if _is_reloading:
        raise HTTPException(status_code=409, detail="A device switch is already in progress.")

    _is_reloading = True
    threading.Thread(target=_do_reload_model, args=(device,), daemon=True).start()
    return {"status": "reloading", "device": device}


@app.post("/api/generate", status_code=202, tags=["tts"])
async def generate(
    text: str = Form(..., description="Text to synthesize."),
    mode: str = Form("auto", description="Generation mode: 'clone' | 'design' | 'auto'."),
    language: Optional[str] = Form(None, description="Language name, e.g. 'English'. Null for auto-detect."),
    instruct: Optional[str] = Form(None, description="Voice design instruction string, e.g. 'female, british accent'."),
    ref_text: Optional[str] = Form(None, description="Transcript of the reference audio (for voice cloning). Leave empty to auto-transcribe."),
    num_step: int = Form(32, ge=4, le=64, description="Diffusion inference steps."),
    guidance_scale: float = Form(2.0, ge=0.0, le=4.0, description="Classifier-free guidance scale."),
    speed: float = Form(1.0, ge=0.5, le=2.0, description="Speed factor (1.0 = normal)."),
    duration: Optional[float] = Form(None, ge=0.1, description="Fixed output duration in seconds (overrides speed)."),
    denoise: bool = Form(True, description="Apply denoising post-process."),
    preprocess_prompt: bool = Form(True, description="Apply silence removal / trimming to reference audio."),
    postprocess_output: bool = Form(True, description="Remove long silences from generated audio."),
    ref_audio: Optional[UploadFile] = File(None, description="Reference audio file for voice cloning."),
):
    """
    Start a TTS generation job.

    Returns 202 Accepted with a job_id. Poll GET /api/jobs/{job_id} for status,
    then GET /api/jobs/{job_id}/audio to download the WAV when done.
    """
    if _model is None:
        raise HTTPException(status_code=503, detail="Model is still loading. Please retry in a moment.")
    if _is_reloading:
        raise HTTPException(status_code=503, detail="Device switch in progress. Please wait and retry.")

    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="'text' field cannot be empty.")

    gen_config = OmniVoiceGenerationConfig(
        num_step=num_step,
        guidance_scale=guidance_scale,
        denoise=denoise,
        preprocess_prompt=preprocess_prompt,
        postprocess_output=postprocess_output,
    )

    lang = language if (language and language.strip() and language != "Auto") else None

    kw: dict = dict(text=text, language=lang, generation_config=gen_config)

    if speed != 1.0:
        kw["speed"] = speed
    if duration and duration > 0:
        kw["duration"] = duration

    # ----- Voice cloning -----
    tmp_audio_path: Optional[str] = None
    if mode == "clone":
        if ref_audio is None:
            raise HTTPException(status_code=400, detail="'ref_audio' is required for clone mode.")
        suffix = os.path.splitext(ref_audio.filename or "audio.wav")[1] or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await ref_audio.read())
            tmp_audio_path = tmp.name

        kw["voice_clone_prompt"] = _model.create_voice_clone_prompt(
            ref_audio=tmp_audio_path,
            ref_text=ref_text.strip() if ref_text and ref_text.strip() else None,
        )

    # ----- Voice design instruct -----
    if instruct and instruct.strip():
        kw["instruct"] = instruct.strip()

    job_id = str(uuid.uuid4())
    with _jobs_lock:
        _jobs[job_id] = JobResult(status="queued")

    thread = threading.Thread(
        target=_run_inference,
        args=(job_id, kw, tmp_audio_path),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}", tags=["tts"])
def get_job_status(job_id: str):
    """Poll the status of a generation job."""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"job_id": job_id, "status": job.status, "error": job.error}


@app.get("/api/jobs/{job_id}/audio", tags=["tts"])
def get_job_audio(job_id: str):
    """Download the generated WAV for a completed job."""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status == "error":
        raise HTTPException(status_code=500, detail=job.error or "Inference failed.")
    if job.status != "done":
        raise HTTPException(status_code=400, detail=f"Job not ready (status: {job.status}).")
    return Response(
        content=job.audio,
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=omnivoice-output.wav"},
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    import uvicorn

    logging.basicConfig(
        format="%(asctime)s %(levelname)s [%(filename)s:%(lineno)d] %(message)s",
        level=logging.INFO,
    )

    parser = argparse.ArgumentParser(
        prog="omnivoice-api",
        description="Launch the OmniVoice FastAPI REST server.",
    )
    parser.add_argument("--model", default="k2-fsa/OmniVoice", help="Model checkpoint or HF repo id.")
    parser.add_argument("--device", default=None, help="Device: cuda / mps / cpu (auto-detected if omitted).")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    global _model_id, _device
    _model_id = args.model
    _device = args.device

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
