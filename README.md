# OmniVoice Docker Wrapper

This repository contains the container and interface stack for running the official OmniVoice model as a self-hosted service.

> This project is a wrapper for the official OmniVoice repository: [k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice).
> The core model and original code are provided by that upstream repository.

## What this repo provides

- `backend/` — FastAPI backend and Dockerfile for the REST API server.
- `frontend/` — Browser-based UI served by Nginx and its Dockerfile.
- `docker-compose.yml` — Docker composition for backend + frontend.
- `.dockerignore` — Docker build ignore rules.
- `.gitignore` — ignores the official OmniVoice source files that are copied in.

This repo does not attempt to rewrite OmniVoice. It provides the deployment layer, web interface and container orchestration needed to serve the official model.

## Installation guide

Follow these steps to install and run the wrapper together with the official OmniVoice project:

1. Clone this wrapper repository:

```bash
git clone <YOUR_INTERFACE_REPO_URL> OmniVoice
cd OmniVoice
```

2. Clone the official OmniVoice repository separately:

```bash
git clone https://github.com/k2-fsa/OmniVoice.git OmniVoice-core
```

3. Copy the official OmniVoice source into this wrapper's root:

```bash
cp -r ../OmniVoice-core/omnivoice ./
cp -r ../OmniVoice-core/docs ./
cp -r ../OmniVoice-core/examples ./
cp -r ../OmniVoice-core/.github ./
cp ../OmniVoice-core/pyproject.toml ./
cp ../OmniVoice-core/uv.lock ./
```

4. Verify that your repository now has the following structure:

```
OmniVoice/
├── .dockerignore
├── .gitignore
├── .github/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── server.py
├── docker-compose.yml
├── frontend/
│   ├── Dockerfile
│   ├── app.js
│   ├── index.html
│   ├── nginx.conf
│   └── styles.css
├── omnivoice/
├── pyproject.toml
├── uv.lock
├── docs/
└── examples/
```

5. Build and start the containers:

```bash
docker compose up --build
```

6. Open the UI:

```text
http://localhost:8500
```

7. Check the backend API docs:

```text
http://localhost:8501/docs
```

## Docker notes

- The backend uses `backend/Dockerfile` and the frontend uses `frontend/Dockerfile`.
- The official OmniVoice source must be present in this repo root so the backend can import it.
- This wrapper is designed to work with the official model repository but provides the container deployment and interface layer itself.

## GPU support

For NVIDIA GPU inference, use the official NVIDIA Container Toolkit and run the stack with:

```bash
docker compose up --build
```

If you want CPU only, use:

```bash
TORCH_VARIANT=cpu docker compose build && docker compose up
```

## License

This repository is distributed under the **Apache License 2.0**.

The container stack, frontend, and backend code are licensed under Apache 2.0, which is compatible with the official OmniVoice upstream project.
