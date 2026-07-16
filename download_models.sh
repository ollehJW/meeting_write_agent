#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ROOT_DIR

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi
PYTHON_BIN="${PYTHON_BIN:-}"

if [[ -z "$PYTHON_BIN" ]]; then
  if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
    PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
  else
    PYTHON_BIN="python3"
  fi
fi

if [[ -z "${HF_TOKEN:-${HUGGINGFACE_HUB_TOKEN:-}}" ]]; then
  echo "WARN: HF_TOKEN/HUGGINGFACE_HUB_TOKEN is not set. Gated pyannote models may fail."
fi

echo "Using Python: $PYTHON_BIN"
echo "Downloading models into: $ROOT_DIR"

"$PYTHON_BIN" <<'PY'
from __future__ import annotations

import os
from pathlib import Path

from huggingface_hub import snapshot_download

root_dir = Path(os.environ.get("ROOT_DIR", ".")).resolve()
token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN")

model_dirs = {
    "Qwen/Qwen3-ASR-1.7B": root_dir / "qwen3-asr-1.7b",
    "pyannote/speaker-diarization-3.1": root_dir / "pyannote_diarization_local",
    "pyannote/segmentation-3.0": root_dir / "pyannote_segmentation_local",
    "pyannote/wespeaker-voxceleb-resnet34-LM": root_dir / "pyannote_embedding_local",
}

for repo_id, local_dir in model_dirs.items():
    print(f"\nDownloading {repo_id} -> {local_dir}")
    snapshot_download(
        repo_id=repo_id,
        local_dir=str(local_dir),
        token=token,
        local_dir_use_symlinks=False,
    )
    print(f"Done: {repo_id}")

config_path = model_dirs["pyannote/speaker-diarization-3.1"] / "config.yaml"
if not config_path.exists():
    raise FileNotFoundError(f"Missing diarization config: {config_path}")

text = config_path.read_text(encoding="utf-8")
text = text.replace(
    "embedding: pyannote/wespeaker-voxceleb-resnet34-LM",
    f"embedding: {model_dirs['pyannote/wespeaker-voxceleb-resnet34-LM'].resolve().as_posix()}",
)
text = text.replace(
    "segmentation: pyannote/segmentation-3.0",
    f"segmentation: {model_dirs['pyannote/segmentation-3.0'].resolve().as_posix()}",
)
config_path.write_text(text, encoding="utf-8")
print(f"\nPatched local model paths in {config_path}")
PY

echo "All models are ready."
