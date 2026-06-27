#!/usr/bin/env bash
# setup-engine.sh — install legal-desens engine into .venv
# macOS / Linux only. Not tested on Windows.
# Called by setup-app.sh. Handles only: venv + pip install.
# npm install and NER model are handled by setup-app.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"
REQUIREMENTS="$REPO_ROOT/requirements-engine.txt"

echo "=== Creating Python virtual environment ==="
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
  echo "Created $VENV_DIR"
else
  echo "Using existing $VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

echo ""
echo "=== Installing legal-desens engine (pdf,ocr extras) ==="
WHEELS_DIR="$REPO_ROOT/vendor/wheels"
if [ -d "$WHEELS_DIR" ] && ls "$WHEELS_DIR"/legal_desens-*.whl &>/dev/null; then
  echo "检测到 vendor/wheels —— 离线安装（无需联网）..."
  pip install --no-index --find-links "$WHEELS_DIR" pip setuptools wheel -q || true
  pip install --no-index --find-links "$WHEELS_DIR" "legal-desens[pdf,ocr]" -q
else
  echo "This may take several minutes on first run..."
  pip install --upgrade pip -q
  pip install -r "$REQUIREMENTS" -q
fi

echo ""
echo "=== legal-desens self-check ==="
"$VENV_DIR/bin/legal-desens" --help 2>&1 | head -3
SMOKE_INPUT=$(mktemp /tmp/smoke_engine_XXXXXX.txt)
echo "张三于2024年1月1日入职，月薪15000元。" > "$SMOKE_INPUT"
SMOKE_MANIFEST=$(mktemp /tmp/smoke_engine_manifest_XXXXXX.json)
SMOKE_PREVIEW=$(mktemp /tmp/smoke_engine_preview_XXXXXX.md)
SMOKE_MAP=$(mktemp /tmp/smoke_engine_map_XXXXXX.json)
"$VENV_DIR/bin/legal-desens" prepare "$SMOKE_INPUT" \
  --level strict --regex-only \
  --preview-md "$SMOKE_PREVIEW" \
  --manifest "$SMOKE_MANIFEST" \
  --map "$SMOKE_MAP" 2>&1
rm -f "$SMOKE_INPUT" "$SMOKE_MANIFEST" "$SMOKE_PREVIEW" "$SMOKE_MAP"
echo "--- Smoke test passed ---"
