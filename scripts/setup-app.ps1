# setup-app.ps1 — LAWCHERS Windows 安装 (best-effort, 未实测)
# Windows support is best-effort and has not been verified on a Windows machine.

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$VenvDir = Join-Path $RepoRoot ".venv"

Write-Host "=========================================="
Write-Host "  LAWCHERS 安装程序 (Windows best-effort)"
Write-Host "=========================================="
Write-Host ""
Write-Host "注意: Windows 支持未经实测，不纳入已支持平台。"
Write-Host ""

# [1] Node 检查
Write-Host "=== [1/7] 检查 Node.js ==="
try {
    $nodeVer = node -v
    Write-Host "Node.js $nodeVer ✓"
} catch {
    Write-Host "错误: 未找到 Node.js。请先安装 Node.js >= 18"
    Write-Host "  下载: https://nodejs.org/"
    exit 1
}

# [2] npm install
Write-Host ""
Write-Host "=== [2/7] 安装 Node 依赖 ==="
$nodeModules = Join-Path $RepoRoot "node_modules"
if (Test-Path $nodeModules) {
    Write-Host "node_modules 已存在，跳过"
} else {
    Set-Location $RepoRoot
    npm install
    Write-Host "Node 依赖安装完成 ✓"
}

# [3] 引擎安装
Write-Host ""
Write-Host "=== [3/7] 安装 legal-desens 引擎 ==="
$legalDesens = Join-Path $VenvDir "Scripts" "legal-desens.exe"
if ((Test-Path $VenvDir) -and (Test-Path $legalDesens)) {
    Write-Host "引擎已安装，跳过"
} else {
    Write-Host "创建虚拟环境..."
    python -m venv $VenvDir
    Write-Host "安装引擎..."
    & "$VenvDir\Scripts\pip.exe" install --upgrade pip -q
    $requirements = Join-Path $RepoRoot "requirements-engine.txt"
    & "$VenvDir\Scripts\pip.exe" install -r $requirements -q
    Write-Host "引擎安装完成 ✓"
}

# [4] NER 模型
Write-Host ""
Write-Host "=== [4/7] NER 模型 ==="
$modelDir = Join-Path $RepoRoot "assets" "models" "roberta-crf-ner"
if (Test-Path (Join-Path $modelDir "config.json")) {
    Write-Host "模型已存在，跳过"
} else {
    Write-Host "下载 NER 模型..."
    $modelUrl = "https://modelscope.cn/models/Clukay416/legal-desens-cluener-onnx/resolve/master/cluener-roberta-base-onnx.zip"
    $tempZip = Join-Path $env:TEMP "ner_model.zip"
    Invoke-WebRequest -Uri $modelUrl -OutFile $tempZip
    New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
    Expand-Archive -Path $tempZip -DestinationPath $modelDir -Force
    Remove-Item $tempZip
    Write-Host "模型安装完成 ✓"
}

# [5] SQLite
Write-Host ""
Write-Host "=== [5/7] 初始化数据库 ==="
$dataDir = Join-Path $RepoRoot "backend" "data"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Write-Host "数据库目录就绪 ✓"

# [6] 前端构建
Write-Host ""
Write-Host "=== [6/7] 构建前端 ==="
$distDir = Join-Path $RepoRoot "frontend" "dist"
if ((Test-Path $distDir) -and (Test-Path (Join-Path $distDir "index.html"))) {
    Write-Host "前端已构建，跳过"
} else {
    Set-Location $RepoRoot
    npm run build -w frontend
    Write-Host "前端构建完成 ✓"
}

# [7] 自检
Write-Host ""
Write-Host "=== [7/7] 自检 ==="
if (Test-Path $legalDesens) {
    & $legalDesens --help 2>&1 | Select-Object -First 1
    Write-Host "legal-desens 可用 ✓"
} else {
    Write-Host "警告: legal-desens 不可用"
}

Write-Host ""
Write-Host "=========================================="
Write-Host "  安装完成！请运行 启动 LAWCHERS.bat"
Write-Host "=========================================="
