[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$workspacePath = Split-Path -Parent $PSScriptRoot
$env:Path = "$env:APPDATA\Python\Python312\Scripts;$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:USERPROFILE\.local\bin;$env:Path"

Set-Location $workspacePath

foreach ($commandName in @("pnpm", "uv")) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $commandName. Run bootstrap-windows.ps1 first."
    }
}

& pnpm dev
if ($LASTEXITCODE -ne 0) {
    throw "Aijian Studio development stack exited with code $LASTEXITCODE."
}
