#!/usr/bin/env bash
# install-ner-model.sh — download and install the NER ONNX model
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"
LEGAL_DESENS="$VENV_DIR/bin/legal-desens"

if [ ! -f "$LEGAL_DESENS" ]; then
  echo "Error: legal-desens not found at $LEGAL_DESENS — run npm run setup first"
  exit 1
fi

MODEL_DIR="$HOME/.legal-desens/models/roberta-crf-ner"
MODEL_URL="https://modelscope.cn/models/Clukay416/legal-desens-cluener-onnx/resolve/master/cluener-roberta-base-onnx.zip"
MODEL_SHA256="13958b2a4aff99fef17c22d844963d10cc0fd6fbbd83b01844fef527b23e1b6a"

# Check if already installed
if [ -d "$MODEL_DIR" ] && [ -f "$MODEL_DIR/config.json" ]; then
  echo "NER model already installed at $MODEL_DIR — skipping download."
  exit 0
fi

echo "Downloading NER model from ModelScope..."
TEMP_ZIP=$(mktemp /tmp/ner_model_XXXXXX.zip)
curl -fSL "$MODEL_URL" -o "$TEMP_ZIP"

echo "Verifying SHA-256..."
ACTUAL_SHA=$(shasum -a 256 "$TEMP_ZIP" | awk '{print $1}')
if [ "$ACTUAL_SHA" != "$MODEL_SHA256" ]; then
  echo "SHA-256 mismatch: expected $MODEL_SHA256, got $ACTUAL_SHA"
  rm -f "$TEMP_ZIP"
  exit 1
fi

echo "Extracting model..."
mkdir -p "$MODEL_DIR"
unzip -oq "$TEMP_ZIP" -d "$MODEL_DIR"
rm -f "$TEMP_ZIP"

echo "NER model installed to $MODEL_DIR"
