# =============================================================================
# OmniVoice — Backend (FastAPI + OmniVoice model)
# Build context: project root  (docker compose builds from .)
#
# Build args:
#   TORCH_VARIANT   cpu    — CPU-only wheel (default, lighter image)
#                   cu124  — CUDA 12.4 wheel (GPU inference)
# =============================================================================

ARG TORCH_VARIANT=cu124

# ---- Base image ----
FROM python:3.11-slim AS base

# ---- System dependencies ----
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Python: install PyTorch ----
# OmniVoice requires torch>=2.5 (flex_attention API).
# TORCH_VARIANT must be re-declared after FROM to be accessible at build time.
ARG TORCH_VARIANT=cu124
RUN if [ "$TORCH_VARIANT" = "cpu" ]; then \
        pip install --no-cache-dir \
            torch==2.8.0+cpu torchaudio==2.8.0+cpu \
            --index-url https://download.pytorch.org/whl/cpu; \
    else \
        pip install --no-cache-dir \
            torch torchaudio \
            --index-url https://download.pytorch.org/whl/${TORCH_VARIANT}; \
    fi

# ---- Install OmniVoice package ----
# Copy only what's needed for the package install step first so Docker can
# cache this heavy layer independently of backend source changes.
COPY pyproject.toml ./pyproject.toml
COPY README.md      ./README.md
COPY omnivoice/     ./omnivoice/

# Non-editable install — appropriate for a container (no live source editing needed)
RUN pip install --no-cache-dir .

# ---- Install API server dependencies ----
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# ---- Copy backend source ----
COPY backend/ ./backend/

# ---- Runtime config ----
ENV OMNIVOICE_MODEL=k2-fsa/OmniVoice
ENV OMNIVOICE_DEVICE=auto
# auto = CUDA > MPS > CPU (detected at model load time)

# HuggingFace cache — mount a named volume here to persist downloaded models
ENV HF_HOME=/cache/huggingface

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

CMD ["uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8080"]
