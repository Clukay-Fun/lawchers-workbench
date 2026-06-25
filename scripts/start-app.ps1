# start-app.ps1 — LAWCHERS Windows 单服务启动（前台运行，关窗即停）
# 与 macOS 的 start-app.sh 等价。通过 "启动 LAWCHERS.bat" 双击调用。

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# 检查是否已安装
if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
    Write-Host "错误: 尚未安装，请先运行「安装 LAWCHERS.bat」"
    Read-Host "按回车退出"
    exit 1
}
if (-not (Test-Path (Join-Path $RepoRoot "frontend\dist\index.html"))) {
    Write-Host "错误: 前端未构建，请先运行「安装 LAWCHERS.bat」"
    Read-Host "按回车退出"
    exit 1
}

$port = if ($env:APP_PORT) { $env:APP_PORT } else { 3000 }
$env:PORT = $port
$env:NODE_ENV = "production"

# 项目内模型缓存优先 — 若 assets/models/ 有模型，让引擎实际使用它
$ModelDir = Join-Path $RepoRoot "assets\models\roberta-crf-ner"
if (Test-Path (Join-Path $ModelDir "config.json")) {
    $env:LEGAL_DESENS_MODEL_DIR = $ModelDir
}

Write-Host "=========================================="
Write-Host "  LAWCHERS 启动中..."
Write-Host "=========================================="
Write-Host ""
Write-Host "端口: $port"
Write-Host "地址: http://localhost:$port"
Write-Host ""
Write-Host "按 Ctrl+C 停止服务"
Write-Host ""

# 延迟打开浏览器
Start-Job -ScriptBlock { Start-Sleep -Seconds 2; Start-Process "http://localhost:$using:port" } | Out-Null

# 启动 backend（前台运行）
Set-Location $RepoRoot
node backend/src/index.js
