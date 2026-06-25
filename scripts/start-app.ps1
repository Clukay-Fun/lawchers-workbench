# start-app.ps1 — LAWCHERS Windows 启动 (best-effort, 未实测)
# Windows support is best-effort and has not been verified on a Windows machine.

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$port = if ($env:APP_PORT) { $env:APP_PORT } else { 3000 }
$env:PORT = $port
$env:NODE_ENV = "production"

Write-Host "=========================================="
Write-Host "  LAWCHERS 启动中... (Windows best-effort)"
Write-Host "=========================================="
Write-Host ""
Write-Host "端口: $port"
Write-Host "地址: http://localhost:$port"
Write-Host ""
Write-Host "按 Ctrl+C 停止服务"
Write-Host ""

# 打开浏览器
Start-Process "http://localhost:$port"

# 启动 backend
Set-Location $RepoRoot
node backend/src/index.js
