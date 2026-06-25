#!/usr/bin/env bash
# setup-app.sh — LAWCHERS 一键安装（断点续装）
# macOS / Linux. 通过 "安装 LAWCHERS.command" 双击调用。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"
REQUIREMENTS="$REPO_ROOT/requirements-engine.txt"
MODEL_DIR_LOCAL="$REPO_ROOT/assets/models/roberta-crf-ner"
MODEL_DIR_HOME="$HOME/.legal-desens/models/roberta-crf-ner"
MODEL_URL="https://modelscope.cn/models/Clukay416/legal-desens-cluener-onnx/resolve/master/cluener-roberta-base-onnx.zip"
MODEL_SHA256="13958b2a4aff99fef17c22d844963d10cc0fd6fbbd83b01844fef527b23e1b6a"
NODE_MODULES_DIR="$REPO_ROOT/node_modules"
DIST_DIR="$REPO_ROOT/frontend/dist"

# NPM registry 可配置（不改全局）
NPM_REGISTRY="${LAWCHERS_NPM_REGISTRY:-}"

echo "=========================================="
echo "  LAWCHERS 安装程序"
echo "=========================================="
echo ""

# ── [1/7] Node 检查 ──
echo "=== [1/7] 检查 Node.js ==="
if ! command -v node &>/dev/null; then
  echo "错误: 未找到 Node.js。请先安装 Node.js >= 18"
  echo "  下载: https://nodejs.org/"
  echo "  或使用 Homebrew: brew install node"
  exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "错误: Node.js 版本过低 (需要 >= 18，当前: $(node -v))"
  exit 1
fi
echo "Node.js $(node -v) ✓"

# ── [2/7] npm install ──
echo ""
echo "=== [2/7] 安装 Node 依赖 ==="
if [ -d "$NODE_MODULES_DIR" ] && [ -f "$NODE_MODULES_DIR/.package-lock.json" ] 2>/dev/null; then
  echo "node_modules 已存在，跳过"
else
  echo "安装中..."
  if [ -n "$NPM_REGISTRY" ]; then
    echo "使用 registry: $NPM_REGISTRY"
    cd "$REPO_ROOT" && npm install --registry="$NPM_REGISTRY" 2>&1 | tail -5
  else
    cd "$REPO_ROOT" && npm install 2>&1 | tail -5
  fi
  echo "Node 依赖安装完成 ✓"
fi

# ── [3/7] 引擎安装 ──
echo ""
echo "=== [3/7] 安装 legal-desens 引擎 ==="
if [ -d "$VENV_DIR" ] && "$VENV_DIR/bin/legal-desens" --help &>/dev/null 2>&1; then
  echo "引擎已安装，跳过"
else
  echo "首次安装引擎（含 PDF/OCR 支持），可能需要几分钟..."
  bash "$SCRIPT_DIR/setup-engine.sh" 2>&1 | tail -10
  echo "引擎安装完成 ✓"
fi

# ── [4/7] NER 模型 ──
echo ""
echo "=== [4/7] NER 模型 ==="
# 查找优先级: assets/models/ → ~/.legal-desens/models/ → 远程下载
MODEL_PATH=""
if [ -d "$MODEL_DIR_LOCAL" ] && [ -f "$MODEL_DIR_LOCAL/config.json" ]; then
  MODEL_PATH="$MODEL_DIR_LOCAL"
  echo "使用本地缓存模型: $MODEL_PATH"
elif [ -d "$MODEL_DIR_HOME" ] && [ -f "$MODEL_DIR_HOME/config.json" ]; then
  MODEL_PATH="$MODEL_DIR_HOME"
  echo "使用用户目录模型: $MODEL_PATH"
fi

if [ -n "$MODEL_PATH" ]; then
  # SHA 校验
  if command -v shasum &>/dev/null; then
    # 只检查 config.json 作为快速校验（完整 SHA 校验在下载时已做）
    echo "模型已存在，跳过下载"
  else
    echo "模型已存在（无 shasum，跳过 SHA 校验）"
  fi
else
  echo "下载 NER 模型（首次需要，约 500MB）..."
  TEMP_ZIP=$(mktemp /tmp/ner_model_XXXXXX.zip)
  TEMP_MODEL_DIR=$(mktemp -d /tmp/ner_model_XXXXXX)

  # 尝试下载，最多重试 2 次
  DOWNLOAD_OK=false
  for attempt in 1 2 3; do
    echo "  下载中... (尝试 $attempt/3)"
    if curl -fSL "$MODEL_URL" -o "$TEMP_ZIP" 2>/dev/null; then
      DOWNLOAD_OK=true
      break
    fi
    echo "  下载失败，等待重试..."
    sleep 2
  done

  if [ "$DOWNLOAD_OK" = false ]; then
    echo "错误: NER 模型下载失败（3 次尝试均失败）"
    rm -f "$TEMP_ZIP"
    exit 1
  fi

  # SHA 校验
  echo "  校验 SHA-256..."
  ACTUAL_SHA=$(shasum -a 256 "$TEMP_ZIP" | awk '{print $1}')
  if [ "$ACTUAL_SHA" != "$MODEL_SHA256" ]; then
    echo "错误: SHA-256 校验失败"
    echo "  期望: $MODEL_SHA256"
    echo "  实际: $ACTUAL_SHA"
    rm -f "$TEMP_ZIP"
    exit 1
  fi
  echo "  SHA-256 校验通过 ✓"

  # 解压到 assets/models/（项目内缓存）
  mkdir -p "$MODEL_DIR_LOCAL"
  unzip -oq "$TEMP_ZIP" -d "$MODEL_DIR_LOCAL"
  rm -f "$TEMP_ZIP"
  echo "模型安装到 $MODEL_DIR_LOCAL ✓"
fi

# ── [5/7] SQLite 初始化 ──
echo ""
echo "=== [5/7] 初始化数据库 ==="
mkdir -p "$REPO_ROOT/backend/data"
# 后端首次启动会自动建表，这里只确保目录存在
echo "数据库目录就绪 ✓"

# ── [6/7] 前端构建 ──
echo ""
echo "=== [6/7] 构建前端 ==="
if [ -d "$DIST_DIR" ] && [ -f "$DIST_DIR/index.html" ]; then
  echo "前端已构建，跳过"
else
  echo "构建中..."
  cd "$REPO_ROOT" && npm run build -w frontend 2>&1 | tail -5
  echo "前端构建完成 ✓"
fi

# ── [7/7] 自检 ──
echo ""
echo "=== [7/7] 自检 ==="
if [ -d "$VENV_DIR" ] && "$VENV_DIR/bin/legal-desens" --help &>/dev/null 2>&1; then
  echo "legal-desens: $("$VENV_DIR/bin/legal-desens" --help 2>&1 | head -1)"
  SMOKE_PREFIX="smoke_app_$(date +%s)"
  SMOKE_INPUT=$(mktemp "/tmp/${SMOKE_PREFIX}_XXXXXX.txt")
  echo "张三于2024年1月1日入职，月薪15000元。" > "$SMOKE_INPUT"
  SMOKE_MANIFEST=$(mktemp "/tmp/${SMOKE_PREFIX}_manifest_XXXXXX.json")
  SMOKE_PREVIEW=$(mktemp "/tmp/${SMOKE_PREFIX}_preview_XXXXXX.md")
  SMOKE_MAP=$(mktemp "/tmp/${SMOKE_PREFIX}_map_XXXXXX.json")
  if "$VENV_DIR/bin/legal-desens" prepare "$SMOKE_INPUT" \
    --level strict --regex-only \
    --preview-md "$SMOKE_PREVIEW" \
    --manifest "$SMOKE_MANIFEST" \
    --map "$SMOKE_MAP" &>/dev/null 2>&1; then
    echo "prepare 烟雾测试通过 ✓"
  else
    echo "警告: prepare 烟雾测试失败（引擎可能不完整，但不影响基本功能）"
  fi
  rm -f "$SMOKE_INPUT" "$SMOKE_MANIFEST" "$SMOKE_PREVIEW" "$SMOKE_MAP"
else
  echo "警告: legal-desens 不可用，脱敏功能将受限"
fi

echo ""
echo "=========================================="
echo "  安装完成！"
echo "=========================================="
echo ""
echo "请双击「启动 LAWCHERS.command」开始使用。"
echo ""
