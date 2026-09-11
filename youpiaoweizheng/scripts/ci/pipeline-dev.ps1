# ============================================================
# 本地一键「开发版」流水线：校验 -> 部署云函数 -> 上传体验版
# 用法：npm run pipeline:dev
# 正式提审/发布请单独执行 npm run audit / npm run release（保留人工确认）
# ============================================================
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent | Split-Path -Parent)
Write-Host "==> 工作目录: $(Get-Location)" -ForegroundColor Cyan

# 1. 依赖检查
if (-not (Test-Path ".env")) {
  Write-Host "[中断] 未找到 .env，请先复制 .env.ci.example 为 .env 并填写" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path "node_modules")) {
  Write-Host "==> 安装依赖..." -ForegroundColor Cyan
  npm install
}

# 2. 主包体积粗检（小程序主包上限 2MB）
$size = (Get-ChildItem -Recurse -File -Path pages,app.js,app.json,app.wxss,components,custom-tab-bar,utils,images -ErrorAction SilentlyContinue |
  Measure-Object -Property Length -Sum).Sum
$sizeKB = [math]::Round($size/1KB,1)
Write-Host "==> 核心代码体积约: $sizeKB KB（主包上限 2048KB）" -ForegroundColor Cyan
if ($sizeKB -gt 2000) { Write-Host "[警告] 主包接近/超过上限，请分包或压缩" -ForegroundColor Yellow }

# 3. 部署云函数（如已配置腾讯云密钥；未配置则跳过）
$envContent = Get-Content .env -Raw
if ($envContent -match "TCB_SECRET_ID=(?!请填写).+") {
  Write-Host "==> 部署云函数..." -ForegroundColor Cyan
  node scripts/ci/deploy-fns.js
  if ($LASTEXITCODE -ne 0) { Write-Host "[中断] 云函数部署失败" -ForegroundColor Red; exit 1 }
} else {
  Write-Host "==> 未配置 TCB_SECRET_ID，跳过云函数部署" -ForegroundColor Yellow
}

# 4. 上传小程序代码（开发版/体验版）
Write-Host "==> 上传小程序代码..." -ForegroundColor Cyan
node scripts/ci/upload.js
if ($LASTEXITCODE -ne 0) { Write-Host "[中断] 上传失败" -ForegroundColor Red; exit 1 }

Write-Host "==> 流水线完成：可到公众平台设为体验版，或执行 npm run audit 提审" -ForegroundColor Green
