#!/bin/bash
# 安装 LAWCHERS.command — 双击运行一键安装
# 首次被 Gatekeeper 拦截时：右键 → 打开
cd "$(dirname "$0")"
exec bash scripts/setup-app.sh
