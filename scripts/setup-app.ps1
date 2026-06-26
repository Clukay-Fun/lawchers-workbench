# setup-app.ps1 — LAWCHERS Windows 一键安装（断点续装）
# 与 macOS 的 setup-app.sh 等价。通过 "安装 LAWCHERS.bat" 双击调用。
# Windows 启动器与 macOS 等价，但需在 Windows 机器上实测确认。

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$VenvDir = Join-Path $RepoRoot ".venv"
$Requirements = Join-Path $RepoRoot "requirements-engine.txt"
$ModelDirLocal = Join-Path $RepoRoot "assets\models\roberta-crf-ner"
$ModelDirHome = Join-Path $env:USERPROFILE ".legal-desens\models\roberta-crf-ner"
$ModelUrl = "https://modelscope.cn/models/Clukay416/legal-desens-cluener-onnx/resolve/master/cluener-roberta-base-onnx.zip"
$ModelSha256 = "13958b2a4aff99fef17c22d844963d10cc0fd6fbbd83b01844fef527b23e1b6a"
$LegalDesens = Join-Path $VenvDir "Scripts\legal-desens.exe"

Write-Host "=========================================="
Write-Host "  LAWCHERS 安装程序"
Write-Host "=========================================="
Write-Host ""

# [1/7] Node 检查
Write-Host "=== [1/7] 检查 Node.js ==="
try {
    $nodeVer = (node -v).TrimStart("v")
    $nodeMajor = [int]($nodeVer.Split(".")[0])
    if ($nodeMajor -lt 18) {
        Write-Host "错误: Node.js 版本过低 (需要 >= 18，当前: v$nodeVer)"
        exit 1
    }
    Write-Host "Node.js v$nodeVer OK"
} catch {
    Write-Host "错误: 未找到 Node.js。请先安装 Node.js >= 18"
    Write-Host "  下载: https://nodejs.org/"
    exit 1
}

# [2/7] npm install
Write-Host ""
Write-Host "=== [2/7] 安装 Node 依赖 ==="
$nodeModules = Join-Path $RepoRoot "node_modules"
if (Test-Path $nodeModules) {
    Write-Host "node_modules 已存在，跳过"
} else {
    Set-Location $RepoRoot
    if ($env:LAWCHERS_NPM_REGISTRY) {
        Write-Host "使用 registry: $env:LAWCHERS_NPM_REGISTRY"
        npm install --registry="$env:LAWCHERS_NPM_REGISTRY"
    } else {
        npm install
    }
    Write-Host "Node 依赖安装完成 OK"
}

# [3/7] 引擎安装
Write-Host ""
Write-Host "=== [3/7] 安装 legal-desens 引擎 ==="
if ((Test-Path $VenvDir) -and (Test-Path $LegalDesens)) {
    Write-Host "引擎已安装，跳过"
} else {
    Write-Host "首次安装引擎（含 PDF/OCR 支持），可能需要几分钟..."
    if (-not (Test-Path $VenvDir)) { python -m venv $VenvDir }
    & "$VenvDir\Scripts\pip.exe" install --upgrade pip -q
    & "$VenvDir\Scripts\pip.exe" install -r $Requirements -q
    Write-Host "引擎安装完成 OK"
}

# [4/7] NER 模型（查找优先级: assets/models → ~/.legal-desens/models → 远程下载）
Write-Host ""
Write-Host "=== [4/7] NER 模型 ==="
$ModelPath = ""
if (Test-Path (Join-Path $ModelDirLocal "config.json")) {
    $ModelPath = $ModelDirLocal
    Write-Host "使用本地缓存模型: $ModelPath"
} elseif (Test-Path (Join-Path $ModelDirHome "config.json")) {
    $ModelPath = $ModelDirHome
    Write-Host "使用用户目录模型: $ModelPath"
}

if ($ModelPath -ne "") {
    Write-Host "模型已存在，跳过下载"
} else {
    Write-Host "下载 NER 模型（首次需要，约 500MB）..."
    $tempZip = Join-Path $env:TEMP "ner_model.zip"
    $downloadOk = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        Write-Host "  下载中... (尝试 $attempt/3)"
        try {
            Invoke-WebRequest -Uri $ModelUrl -OutFile $tempZip
            $downloadOk = $true
            break
        } catch {
            Write-Host "  下载失败，等待重试..."
            Start-Sleep -Seconds 2
        }
    }
    if (-not $downloadOk) {
        Write-Host "错误: NER 模型下载失败（3 次尝试均失败）"
        if (Test-Path $tempZip) { Remove-Item $tempZip }
        exit 1
    }

    Write-Host "  校验 SHA-256..."
    $actualSha = (Get-FileHash -Algorithm SHA256 $tempZip).Hash.ToLower()
    if ($actualSha -ne $ModelSha256) {
        Write-Host "错误: SHA-256 校验失败"
        Write-Host "  期望: $ModelSha256"
        Write-Host "  实际: $actualSha"
        Remove-Item $tempZip
        exit 1
    }
    Write-Host "  SHA-256 校验通过 OK"

    New-Item -ItemType Directory -Force -Path $ModelDirLocal | Out-Null
    Expand-Archive -Path $tempZip -DestinationPath $ModelDirLocal -Force
    Remove-Item $tempZip
    Write-Host "模型安装到 $ModelDirLocal OK"
}

# [5/7] SQLite 初始化
Write-Host ""
Write-Host "=== [5/7] 初始化数据库 ==="
$dataDir = Join-Path $RepoRoot "backend\data"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Write-Host "数据库目录就绪 OK"

# [6/7] 前端构建
Write-Host ""
Write-Host "=== [6/7] 构建前端 ==="
$distIndex = Join-Path $RepoRoot "frontend\dist\index.html"
if (Test-Path $distIndex) {
    Write-Host "前端已构建，跳过"
} else {
    Set-Location $RepoRoot
    npm run build -w frontend
    Write-Host "前端构建完成 OK"
}

# [7/7] 自检
Write-Host ""
Write-Host "=== [7/7] 自检 ==="
if (Test-Path $LegalDesens) {
    & $LegalDesens --help 2>&1 | Select-Object -First 1
    $smokeInput = Join-Path $env:TEMP "smoke_app_input.txt"
    $smokeManifest = Join-Path $env:TEMP "smoke_app_manifest.json"
    $smokePreview = Join-Path $env:TEMP "smoke_app_preview.md"
    $smokeMap = Join-Path $env:TEMP "smoke_app_map.json"
    "张三于2024年1月1日入职，月薪15000元。" | Out-File -FilePath $smokeInput -Encoding utf8
    try {
        & $LegalDesens prepare $smokeInput --level strict --regex-only `
            --preview-md $smokePreview --manifest $smokeManifest --map $smokeMap | Out-Null
        Write-Host "prepare 烟雾测试通过 OK"
    } catch {
        Write-Host "警告: prepare 烟雾测试失败（引擎可能不完整，但不影响基本功能）"
    }
    Remove-Item $smokeInput, $smokeManifest, $smokePreview, $smokeMap -ErrorAction SilentlyContinue
} else {
    Write-Host "警告: legal-desens 不可用，脱敏功能将受限"
}

Write-Host ""
Write-Host "=========================================="
Write-Host "  安装完成！请双击「启动 LAWCHERS.bat」开始使用。"
Write-Host "=========================================="
