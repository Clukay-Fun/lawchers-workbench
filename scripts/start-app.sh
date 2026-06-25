#!/usr/bin/env bash
# start-app.sh — LAWCHERS 单服务启动（前台运行，关终端即停）
# macOS / Linux. 通过 "启动 LAWCHERS.command" 双击调用。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"

# 端口配置（start-app.sh 暴露 APP_PORT，导出为 PORT 给 Node）
export PORT="${APP_PORT:-3000}"

echo "=========================================="
echo "  LAWCHERS 启动中..."
echo "=========================================="
echo ""

# 检查是否已安装
if [ ! -d "$REPO_ROOT/node_modules" ]; then
  echo "错误: 尚未安装，请先运行「安装 LAWCHERS.command」"
  read -p "按回车退出..."
  exit 1
fi

# 检查前端 dist
if [ ! -f "$REPO_ROOT/frontend/dist/index.html" ]; then
  echo "错误: 前端未构建，请先运行「安装 LAWCHERS.command」"
  read -p "按回车退出..."
  exit 1
fi

# 设置 NODE_ENV=production（禁用 CORS 开发模式）
export NODE_ENV=production

echo "端口: $PORT"
echo "地址: http://localhost:$PORT"
echo ""
echo "按 Ctrl+C 停止服务"
echo ""

# 自动打开浏览器（macOS）
if command -v open &>/dev/null; then
  (sleep 2 && open "http://localhost:$PORT") &
fi

# Linux 也可以打开浏览器
if command -v xdg-open &>/dev/null && ! command -v open &>/dev/null; then
  (sleep 2 && xdg-open "http://localhost:$PORT") &
fi

# 启动 backend（前台运行）
cd "$REPO_ROOT" && node backend/src/index.js
