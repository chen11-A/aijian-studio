param(
  [Parameter(Mandatory = $true)][string]$ArtifactRoot,
  [switch]$Inspect
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$resolvedArtifact = (Resolve-Path -LiteralPath $ArtifactRoot).Path
$candidateRoot = Split-Path -Parent $PSScriptRoot
$allowedParent = [System.IO.Path]::GetFullPath((Join-Path $candidateRoot '.aijian-dev'))
if ((Split-Path -Parent $resolvedArtifact) -ne $allowedParent -or
    (Split-Path -Leaf $resolvedArtifact) -notlike 'app-ui-e1-*') {
  throw 'ArtifactRoot must be this candidate owned .aijian-dev/app-ui-e1-* directory.'
}
$electronPath = 'C:\Users\Administrator\Documents\sp\node_modules\.pnpm\electron@43.2.0_supports-color@10.2.2\node_modules\electron\dist\electron.exe'
$expectedElectron = '8593DB40C0C6E5E3C4B6B0A225B1DC9A549ECDF10F6CF2010CF5B6CE869CE07F'
if ((Get-FileHash -LiteralPath $electronPath -Algorithm SHA256).Hash -ne $expectedElectron) {
  throw 'Existing Electron executable does not match the verified local tool.'
}
$manifest = Get-Content -LiteralPath (Join-Path $resolvedArtifact 'build-manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
  $targetPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedArtifact $entry.relative))
  if (-not $targetPath.StartsWith($resolvedArtifact + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Artifact manifest path leaves its owned directory.'
  }
  if ((Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash -ne $entry.sha256) {
    throw ('Compiled artifact hash mismatch: ' + $entry.relative)
  }
}
$mainPath = Join-Path $resolvedArtifact 'build\desktop\main.js'
$rendererPath = Join-Path $resolvedArtifact 'build\renderer\app-ui\index.html'
if (-not (Test-Path -LiteralPath $mainPath) -or -not (Test-Path -LiteralPath $rendererPath)) {
  throw 'Compiled product main or App renderer is missing. This launcher never downloads or builds.'
}
$runName = 'launch-' + (Get-Date -Format 'yyyyMMddTHHmmss') + '-' + [guid]::NewGuid().ToString('N')
$runDirectory = Join-Path (Join-Path $resolvedArtifact 'logs') $runName
$null = New-Item -ItemType Directory -Path $runDirectory
$runTemp = Join-Path $runDirectory 'temp'
$null = New-Item -ItemType Directory -Path $runTemp
$env:TEMP = $runTemp
$env:TMP = $runTemp
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:\NODE_OPTIONS -ErrorAction SilentlyContinue
$arguments = @(('"' + $mainPath + '"'), '--aivora-app-ui')
if ($Inspect) { $arguments += '--remote-debugging-port=0' }
$stdout = Join-Path $runDirectory 'electron.stdout.log'
$stderr = Join-Path $runDirectory 'electron.stderr.log'
$startOptions = @{
  FilePath = $electronPath
  ArgumentList = $arguments
  WorkingDirectory = $candidateRoot
  WindowStyle = 'Hidden'
  PassThru = $true
  RedirectStandardOutput = $stdout
  RedirectStandardError = $stderr
}
$appProcess = Start-Process @startOptions
$record = [ordered]@{
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  processId = $appProcess.Id
  executable = $electronPath
  arguments = $arguments
  productMain = $mainPath
  renderer = $rendererPath
  artifactRoot = $resolvedArtifact
  runDirectory = $runDirectory
  stdout = $stdout
  stderr = $stderr
  inspect = $Inspect.IsPresent
  backend = 'not started; UI sample mode'
}
$recordPath = Join-Path $runDirectory 'launch.json'
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordPath -Encoding UTF8
Write-Output ('APP_UI_LAUNCH_RECORD=' + $recordPath)
$appProcess.WaitForExit()
$appProcess.Refresh()
[ordered]@{
  exitedAt = (Get-Date).ToUniversalTime().ToString('o')
  processId = $record.processId
  exitCode = $appProcess.ExitCode
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDirectory 'exit.json') -Encoding UTF8
exit $appProcess.ExitCode
