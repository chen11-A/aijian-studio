$ErrorActionPreference = "Stop"

$workspacePath = Split-Path -Parent $PSScriptRoot
$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:USERPROFILE\.local\bin;$env:Path"

function Assert-Command {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$VersionArguments
    )

    $commandInfo = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $commandInfo) {
        throw "Missing required command: $Name"
    }

    $versionText = & $Name @VersionArguments 2>&1 | Select-Object -First 1
    Write-Host "[OK] $Name - $versionText"
}

Assert-Command -Name "git" -VersionArguments @("--version")
Assert-Command -Name "node" -VersionArguments @("--version")
Assert-Command -Name "npm" -VersionArguments @("--version")
Assert-Command -Name "uv" -VersionArguments @("--version")
Assert-Command -Name "ffmpeg" -VersionArguments @("-version")
Assert-Command -Name "ffprobe" -VersionArguments @("-version")

$repositories = @(
    @{ Name = "lumenx"; Commit = "7a1213a0db73ab90ca976f5c4b4ca680e1ae1d2d"; Artifact = "frontend\.next" },
    @{ Name = "wind-comic"; Commit = "b669de64f871f5a96f50d4c7afca341662e13683"; Artifact = ".next" },
    @{ Name = "ViMax"; Commit = "05a48943878312d88fe5a016c12a9654940ecc43"; Artifact = "web\dist" },
    @{ Name = "printfilm"; Commit = "b5ed4b840b048a921e801accc253a0d4549137df"; Artifact = "dist" }
)

foreach ($repository in $repositories) {
    $repositoryPath = Join-Path $workspacePath "upstreams\$($repository.Name)"
    if (-not (Test-Path $repositoryPath)) {
        throw "Missing repository: $repositoryPath"
    }

    $actualCommit = (& git -C $repositoryPath rev-parse HEAD).Trim()
    if ($actualCommit -ne $repository.Commit) {
        throw "$($repository.Name) commit mismatch: $actualCommit"
    }

    $sourceChanges = & git -C $repositoryPath status --porcelain
    if ($sourceChanges) {
        Write-Warning "$($repository.Name) has local source changes."
    }

    $artifactPath = Join-Path $repositoryPath $repository.Artifact
    if (-not (Test-Path $artifactPath)) {
        throw "Missing build artifact: $artifactPath"
    }

    Write-Host "[OK] $($repository.Name) - $actualCommit"
}

$lumenPython = Join-Path $workspacePath "upstreams\lumenx\.venv\Scripts\python.exe"
$vimaxPython = Join-Path $workspacePath "upstreams\ViMax\.venv\Scripts\python.exe"

& $lumenPython -c "import fastapi, dashscope, demucs, uvicorn"
if ($LASTEXITCODE -ne 0) { throw "LumenX Python import check failed." }
Write-Host "[OK] LumenX Python imports"

& $vimaxPython -c "import cv2, faiss, langchain, openai"
if ($LASTEXITCODE -ne 0) { throw "ViMax Python import check failed." }
Write-Host "[OK] ViMax Python imports"

Write-Host "Environment verification passed. API credentials are intentionally not checked."
