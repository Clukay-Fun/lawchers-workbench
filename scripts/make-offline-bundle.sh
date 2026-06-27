#!/usr/bin/env bash
# make-offline-bundle.sh — 生成 macOS(arm64) 离线分发包
# 产物: dist-bundle/lawchers-offline-macos-arm64.tar.gz
# 对方: 解包 → 双击「安装 LAWCHERS.command」(无需联网) → 双击「启动 LAWCHERS.command」
#
# 包内含: 源码(git 跟踪) + node_modules + frontend/dist + assets/models(NER 模型)
#         + vendor/wheels(离线 Python 依赖)。不含 data/uploads/.venv/.git。
# 前提(目标机需有): macOS Apple Silicon、Node ≥ 18、Python ≥ 3.9。首次安装无需联网。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PLATFORM="macos-arm64"
OUT_DIR="$REPO_ROOT/dist-bundle"
STAGE="$OUT_DIR/lawchers-$PLATFORM"
TARBALL="$OUT_DIR/lawchers-offline-$PLATFORM.tar.gz"
MODEL_LOCAL="$REPO_ROOT/assets/models/roberta-crf-ner"
MODEL_HOME="$HOME/.legal-desens/models/roberta-crf-ner"
WHEELS="$REPO_ROOT/vendor/wheels"

echo "=========================================="
echo "  LAWCHERS 离线包构建 ($PLATFORM)"
echo "=========================================="

# 仅在 arm64 mac 上构建（wheel/原生模块平台绑定）
if [ "$(uname -sm)" != "Darwin arm64" ]; then
  echo "错误: 本脚本只能在 macOS Apple Silicon 上构建 $PLATFORM 包（当前: $(uname -sm)）"
  exit 1
fi

# ── [1/5] NER 模型 → assets/models ──
echo ""
echo "=== [1/5] 准备 NER 模型 ==="
if [ -f "$MODEL_LOCAL/config.json" ]; then
  echo "模型已在 assets/models，跳过"
elif [ -f "$MODEL_HOME/config.json" ]; then
  mkdir -p "$(dirname "$MODEL_LOCAL")"
  cp -R "$MODEL_HOME" "$MODEL_LOCAL"
  echo "已从 ~/.legal-desens 复制模型到 assets/models"
else
  echo "错误: 找不到 NER 模型（assets/models 或 ~/.legal-desens 都没有）。先跑一次在线安装下载模型。"
  exit 1
fi

# ── [2/5] 离线 Python wheels ──
echo ""
echo "=== [2/5] 构建离线 Python wheels → vendor/wheels ==="
mkdir -p "$WHEELS"
PIN=$(grep -E "^legal-desens" "$REPO_ROOT/requirements-engine.txt")
if [ -d "$REPO_ROOT/.venv" ]; then PYBIN="$REPO_ROOT/.venv/bin/python"; else PYBIN="python3"; fi
"$PYBIN" -m pip wheel "$PIN" -w "$WHEELS"
"$PYBIN" -m pip download pip setuptools wheel -d "$WHEELS"
echo "wheels: $(ls "$WHEELS" | wc -l | tr -d ' ') 个"

# ── [3/5] Node 依赖 + 前端构建 ──
echo ""
echo "=== [3/5] Node 依赖 + 前端构建 ==="
[ -d "$REPO_ROOT/node_modules" ] || npm install
npm run build -w frontend
echo "node_modules + frontend/dist 就绪"

# ── [4/5] 组装 staging（源码 + 运行所需缓存，排除隐私/不可搬迁物）──
echo ""
echo "=== [4/5] 组装离线包内容 ==="
rm -rf "$STAGE"; mkdir -p "$STAGE"
# 4a. git 跟踪的源码/脚本/启动器
git archive --format=tar HEAD | (cd "$STAGE" && tar -xf -)
# 4b. 运行所需、但 gitignore 的产物
cp -R "$REPO_ROOT/node_modules"   "$STAGE/node_modules"
cp -R "$REPO_ROOT/frontend/dist"  "$STAGE/frontend/dist"
mkdir -p "$STAGE/assets/models"
cp -R "$MODEL_LOCAL"              "$STAGE/assets/models/roberta-crf-ner"
mkdir -p "$STAGE/vendor"
cp -R "$WHEELS"                  "$STAGE/vendor/wheels"
# 显式不带: .venv(不可搬迁)、backend/data、uploads(隐私)、.git
echo "已排除: .venv / backend/data / uploads / .git"

# ── [5/5] 打包 ──
echo ""
echo "=== [5/5] 打包 tar.gz ==="
rm -f "$TARBALL"
tar -C "$OUT_DIR" -czf "$TARBALL" "lawchers-$PLATFORM"
rm -rf "$STAGE"
SIZE=$(du -sh "$TARBALL" | cut -f1)

echo ""
echo "=========================================="
echo "  完成: $TARBALL ($SIZE)"
echo "=========================================="
echo "对方使用: 解包 → 双击「安装 LAWCHERS.command」(无需联网) → 双击「启动 LAWCHERS.command」"
echo "前提: macOS Apple Silicon、Node ≥ 18、Python ≥ 3.9"
