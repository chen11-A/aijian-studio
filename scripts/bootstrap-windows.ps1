[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$workspacePath = Split-Path -Parent $PSScriptRoot
$env:Path = "$env:APPDATA\Python\Python312\Scripts;$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:USERPROFILE\.local\bin;$env:Path"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Command,
        [Parameter(Mandatory = $true)][string]$Description
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

Set-Location $workspacePath

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
        throw "pnpm is missing and Corepack is unavailable. Install Node.js 24, then retry."
    }
    Invoke-Checked -Description "Corepack activation" -Command { corepack enable pnpm }
}

foreach ($commandName in @("git", "node", "pnpm", "uv")) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $commandName"
    }
}

$nodeMajor = [int]((& node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -ne 24) {
    throw "Aijian Studio currently requires Node.js 24.x; found $(& node --version)."
}

Invoke-Checked -Description "pnpm dependency installation" -Command { pnpm install --frozen-lockfile }
Invoke-Checked -Description "uv dependency installation" -Command { uv sync --frozen --python 3.12 }
Invoke-Checked -Description "OpenAPI contract verification" -Command { pnpm contracts:check }

Write-Host "Bootstrap passed. Start the full development stack with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\dev-windows.ps1"
