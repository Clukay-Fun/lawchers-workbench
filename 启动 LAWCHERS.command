#!/bin/bash
# 启动 LAWCHERS.command — 双击运行启动服务
cd "$(dirname "$0")"
exec bash scripts/start-app.sh
