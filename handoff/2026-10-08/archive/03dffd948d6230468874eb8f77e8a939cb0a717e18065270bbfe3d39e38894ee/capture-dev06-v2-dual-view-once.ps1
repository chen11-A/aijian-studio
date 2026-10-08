$ErrorActionPreference = 'Stop'

$sourceRoot = 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\dev06-resolver54-rights-chain-closure-20260928-v2'
$qaRoot = 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928'
$python = 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923\.venv\Scripts\python.exe'
$out = Join-Path $qaRoot 'DEV06-RESOLVER54-V2-DUAL-VIEW-READBACK.json'
$manifestPath = Join-Path $sourceRoot 'MANIFEST.json'
$expectedManifest = 'AE9379444336873DDF94D5A5DD92A0A7C851671BB1BCCF90D51C70889BD15595'
$expectedPython = '461D6E5F9A0DCB724798D2B6DBD57555A9EB3084522CC5DC5B2347934F5A4060'
if (Test-Path -LiteralPath $out) { throw 'READBACK_ALREADY_EXISTS' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash -ne $expectedManifest) { throw 'MANIFEST_DRIFT' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $python).Hash -ne $expectedPython) { throw 'PYTHON_DRIFT' }

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.files.Count -ne 54) { throw 'MANIFEST_COUNT_DRIFT' }
$code = @'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / 'MANIFEST.json').read_text(encoding='utf-8'))
items = []
for entry in manifest['files']:
    data = (root / entry['name']).read_bytes()
    items.append({'name': entry['name'], 'sha256': hashlib.sha256(data).hexdigest().upper(), 'head16_hex': data[:16].hex().upper(), 'length': len(data)})
print(json.dumps({'executable': sys.executable, 'files': items}, separators=(',', ':')))
'@
$pythonJson = & $python -I -B -c $code $sourceRoot
if ($LASTEXITCODE -ne 0) { throw 'PYTHON_READ_FAILED' }
$pythonView = $pythonJson | ConvertFrom-Json
if ($pythonView.files.Count -ne 54) { throw 'PYTHON_COUNT_DRIFT' }
$pythonByName = @{}
foreach ($entry in $pythonView.files) { $pythonByName[$entry.name] = $entry }

$rows = @()
foreach ($entry in $manifest.files) {
    $path = Join-Path $sourceRoot ($entry.name -replace '/', '\')
    $raw = [System.IO.File]::ReadAllBytes($path)
    $rawHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash
    $head = [BitConverter]::ToString($raw, 0, [Math]::Min(16, $raw.Length)).Replace('-', '')
    $py = $pythonByName[$entry.name]
    if ($null -eq $py) { throw "PYTHON_NAME_MISSING:$($entry.name)" }
    $rows += [pscustomobject]@{
        name = $entry.name
        declared_sha256 = $entry.sha256
        powershell_sha256 = $rawHash
        powershell_head16_hex = $head
        powershell_length = $raw.Length
        python_sha256 = $py.sha256
        python_head16_hex = $py.head16_hex
        python_length = $py.length
        powershell_matches_declared = ($rawHash -eq $entry.sha256)
        python_matches_declared = ($py.sha256 -eq $entry.sha256)
    }
}
$receipt = [pscustomobject]@{
    status = 'READ_ONLY_DUAL_VIEW_OBSERVATION_NO_PRODUCT_IMPORT_NO_C19_SYNC'
    source_root = $sourceRoot
    manifest_sha256 = $expectedManifest
    powershell_process_id = $PID
    python_executable = $pythonView.executable
    python_executable_sha256_powershell_view = $expectedPython
    file_count = $rows.Count
    powershell_match_count = @($rows | Where-Object powershell_matches_declared).Count
    python_match_count = @($rows | Where-Object python_matches_declared).Count
    files = $rows
}
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out -Encoding utf8
Write-Output ($receipt | Select-Object status,file_count,powershell_match_count,python_match_count | ConvertTo-Json -Compress)
