#!/usr/bin/env bash
# setup-engine.sh — install legal-desens engine + NER model into .venv
# macOS / Linux only. Not tested on Windows.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"
REQUIREMENTS="$REPO_ROOT/requirements-engine.txt"

echo "=== [1/7] Installing Node dependencies ==="
cd "$REPO_ROOT"
npm install

echo ""
echo "=== [2/7] Creating Python virtual environment ==="
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
  echo "Created $VENV_DIR"
else
  echo "Using existing $VENV_DIR"
fi

# Activate for subsequent steps
source "$VENV_DIR/bin/activate"

echo ""
echo "=== [3/7] Installing legal-desens engine (pdf,ocr extras) ==="
echo "This may take several minutes on first run..."
pip install --upgrade pip -q
pip install -r "$REQUIREMENTS" -q

echo ""
echo "=== [4/7] Downloading local NER model ==="
echo "This may take several minutes on first run..."
bash "$(dirname "$0")/install-ner-model.sh"

echo ""
echo "=== [5/7] Initializing SQLite database ==="
mkdir -p "$REPO_ROOT/backend/data"
# The backend auto-creates the DB on first start; just ensure the dir exists.

echo ""
echo "=== [6/7] legal-desens self-check ==="
echo "--- Version ---"
"$VENV_DIR/bin/legal-desens" --version
echo "--- Smoke test (prepare) ---"
SMOKE_INPUT=$(mktemp /tmp/smoke_XXXXXX.txt)
echo "张三于2024年1月1日入职，月薪15000元。" > "$SMOKE_INPUT"
SMOKE_MANIFEST=$(mktemp /tmp/smoke_manifest_XXXXXX.json)
SMOKE_PREVIEW=$(mktemp /tmp/smoke_preview_XXXXXX.md)
SMOKE_MAP=$(mktemp /tmp/smoke_map_XXXXXX.json)
"$VENV_DIR/bin/legal-desens" prepare "$SMOKE_INPUT" \
  --level strict --regex-only \
  --preview-md "$SMOKE_PREVIEW" \
  --manifest "$SMOKE_MANIFEST" \
  --map "$SMOKE_MAP" 2>&1
rm -f "$SMOKE_INPUT" "$SMOKE_MANIFEST" "$SMOKE_PREVIEW" "$SMOKE_MAP"
echo "--- Smoke test passed ---"

echo ""
echo "=== [7/7] Setup complete ==="
echo "Run the application with:"
echo "  npm run dev"
