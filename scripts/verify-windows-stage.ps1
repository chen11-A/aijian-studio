# Read-only validation of a previously staged installer input directory.
# This does not invoke electron-builder, download tools, sign, or publish.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$StageDirectory,
    [Parameter(Mandatory = $true)] [string]$ExpectedStageReceiptSha256,
    [Parameter(Mandatory = $true)] [string]$ExpectedInputManifestSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-StageReceipt([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Windows staged input verification: $Message" }
}

function Resolve-PlainStageFile([string]$Root, [string]$RelativePath) {
    Assert-StageReceipt (-not [string]::IsNullOrWhiteSpace($RelativePath)) 'staged path is empty'
    Assert-StageReceipt (-not [System.IO.Path]::IsPathRooted($RelativePath)) "staged path is absolute: $RelativePath"
    $segments = @($RelativePath -split '[/\\]')
    Assert-StageReceipt (-not ($segments | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' })) "staged path has an unsafe segment: $RelativePath"
    $normalized = $segments -join '/'
    Assert-StageReceipt ($normalized.StartsWith('app/', [System.StringComparison]::Ordinal) -or $normalized.StartsWith('resources/', [System.StringComparison]::Ordinal) -or $normalized -in @('build/installer.nsh', 'build/electron-builder.json', 'STAGED-INPUTS.json')) "staged path is outside fixed roots: $RelativePath"
    $current = $Root
    foreach ($segment in $segments) {
        $current = Join-Path $current $segment
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        Assert-StageReceipt (-not (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) "staged path contains a link: $RelativePath"
    }
    Assert-StageReceipt (-not $item.PSIsContainer) "staged path is not a file: $RelativePath"
    return $current
}

Assert-StageReceipt ([System.IO.Path]::IsPathRooted($StageDirectory)) 'stage directory must be absolute'
Assert-StageReceipt ($ExpectedStageReceiptSha256 -match '^[0-9a-fA-F]{64}$') 'stage receipt SHA256 is invalid'
Assert-StageReceipt ($ExpectedInputManifestSha256 -match '^[0-9a-fA-F]{64}$') 'input manifest SHA256 is invalid'
$root = (Resolve-Path -LiteralPath $StageDirectory -ErrorAction Stop).Path
Assert-StageReceipt (Test-Path -LiteralPath $root -PathType Container) 'stage directory is missing'
$rootItem = Get-Item -LiteralPath $root -Force
Assert-StageReceipt (-not (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) 'stage directory is a link'

$receiptFile = Resolve-PlainStageFile $root 'STAGED-INPUTS.json'
$receiptHash = (Get-FileHash -LiteralPath $receiptFile -Algorithm SHA256).Hash
Assert-StageReceipt ($receiptHash -ieq $ExpectedStageReceiptSha256) 'stage receipt SHA256 drifted'
$receipt = Get-Content -LiteralPath $receiptFile -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-StageReceipt ($receipt.schema_version -eq 1 -and $receipt.stage_kind -ceq 'installer-input-only') 'stage receipt schema is unsupported'
Assert-StageReceipt ([string]$receipt.input_manifest_sha256 -ieq $ExpectedInputManifestSha256) 'input manifest SHA256 drifted'
Assert-StageReceipt (@($receipt.staged_files).Count -gt 0) 'stage receipt has no files'
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($entry in @($receipt.staged_files)) {
    $destination = [string]$entry.destination
    Assert-StageReceipt ($seen.Add($destination.Replace('\', '/'))) "duplicate staged destination: $destination"
    Assert-StageReceipt ([string]$entry.sha256 -match '^[0-9a-fA-F]{64}$') "invalid staged SHA256: $destination"
    $file = Resolve-PlainStageFile $root $destination
    Assert-StageReceipt ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ieq [string]$entry.sha256) "staged file SHA256 drifted: $destination"
}
$layoutDestination = 'resources/config/runtime-layout.json'
Assert-StageReceipt ($seen.Contains($layoutDestination)) 'runtime layout is missing from stage receipt'
$layoutFile = Resolve-PlainStageFile $root $layoutDestination
Assert-StageReceipt ((Get-FileHash -LiteralPath $layoutFile -Algorithm SHA256).Hash -ieq [string]$receipt.layout_sha256) 'runtime layout SHA256 drifted'
$layout = Get-Content -LiteralPath $layoutFile -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-StageReceipt ($layout.schema_version -eq 1 -and $layout.stage_kind -ceq 'installer-input-only') 'runtime layout schema is unsupported'
foreach ($required in $layout.required_destinations.PSObject.Properties) {
    Assert-StageReceipt ($seen.Contains([string]$required.Value)) "required staged file missing: $($required.Name)"
}
foreach ($item in @(Get-ChildItem -LiteralPath $root -Recurse -Force)) {
    Assert-StageReceipt (-not (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) 'stage tree contains a link'
    if ($item.PSIsContainer) { continue }
    $relative = $item.FullName.Substring($root.Length + 1).Replace('\', '/')
    Assert-StageReceipt ($relative -ceq 'STAGED-INPUTS.json' -or $seen.Contains($relative)) "unlisted staged file: $relative"
}

[pscustomobject]@{
    schema_version = 1
    result = 'PASS'
    stage_receipt_sha256 = $receiptHash
    input_manifest_sha256 = [string]$receipt.input_manifest_sha256
    staged_file_count = $seen.Count
    scope = 'stage-files-and-hashes-only; installer tooling and installed runtime are separate gates'
} | ConvertTo-Json -Depth 3
