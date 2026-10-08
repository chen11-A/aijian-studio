param(
  [Parameter(Mandatory = $true)][string]$SyncReceiptPath,
  [Parameter(Mandatory = $true)][string]$OutputDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$qaRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repo = 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923'
$output = [IO.Path]::GetFullPath($OutputDir)
$qaPrefix = $qaRoot.TrimEnd('\') + '\'
if (-not $output.StartsWith($qaPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputDir must be a fresh directory under the QA03 external work directory'
}
if (Test-Path -LiteralPath $output) { throw 'OutputDir already exists; one run must not overwrite another' }
New-Item -ItemType Directory -Path $output -ErrorAction Stop | Out-Null

$expected = [ordered]@{
  head = '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2'
  panel = '61AFFCF1DEC5D555E6D94766DF68967196AFAC63277AA278BB45633089682A4B'
  adapter = '69FAC685BC3667CF3D29BEC480458450B7C4C08F40767AB5616801CD59E5646B'
  desktop = 'D694B1B1C6EF96D55DB941ABF221214634F45065DB07C99207A5C48660E7EA3C'
  fixture = 'B8570FE14FCF774BAAB7688AF5E4887E5307102BD468AEB4E6DBFCC4078F1251'
  test = 'E34B497CAE2ABAF205A09555EF1D43605580CC0D67DDDB6ECEF0C795988CF11D'
  config = 'C4C97E49A50810A210BC41E74CE3F63C87EB7A0889941A1B9C48FC6063853DDF'
  fingerprint = 'CA29296D62768C363578F4263F3201878F944917DF376245D8BBCBE41622C0FD'
  distHtmlBefore = '6D997E0C719E218B906ED733E39D7E3679272E034741D6033B6987EB1D2BDE62'
  snapshot = 'B89B0274BFD4D271884C3931DE3CCE3A6571B7043104D605A168E2B1886EF919'
  syncReceipt = 'F4A46BEC5919F1A4323715E636BC904878563053814395D46532A33A2CDE30C4'
}
$paths = [ordered]@{
  panel = Join-Path $repo 'apps\studio-web\src\aivora\SourceExtractionPanel.tsx'
  adapter = Join-Path $repo 'apps\studio-web\src\aivora\adapters\remoteSourceExtract.ts'
  desktop = Join-Path $repo 'apps\desktop\src\api-client.ts'
  fixture = Join-Path $qaRoot 'run-02-20260928\HTTP-CHAIN.run04-race.json'
  test = Join-Path $qaRoot 'ac05-auto-read.panel.test.mjs'
  config = Join-Path $qaRoot 'vitest.config.mjs'
  fingerprint = Join-Path $qaRoot 'fingerprint.mjs'
  distHtmlBefore = Join-Path $repo 'apps\studio-web\dist\index.html'
}
$receipt = [ordered]@{
  schema = 'qa03.ac05-panel-auto-read-once.v1'
  state = 'PREFLIGHT_PENDING'
  startedUtc = [DateTime]::UtcNow.ToString('o')
  finishedUtc = $null
  repo = $repo
  output = $output
  syncReceiptPath = [IO.Path]::GetFullPath($SyncReceiptPath)
  syncReceiptSha256 = $null
  expected = $expected
  preflight = $null
  steps = [ordered]@{}
  postflight = $null
  rawFiles = @()
  error = $null
}

function Get-Sha256([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing file: $path" }
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToUpperInvariant()
}
function Assert-Hash([string]$name, [string]$path) {
  $actual = Get-Sha256 $path
  if ($actual -ne $expected[$name]) { throw "SHA drift for $name`: $actual" }
}
function Get-RepoState {
  $head = (& git -C $repo rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'git HEAD read failed' }
  $status = @(& git -C $repo status --porcelain -uall | Where-Object { $_ })
  if ($LASTEXITCODE -ne 0) { throw 'git status read failed' }
  return [ordered]@{ head = $head; statusCount = $status.Count; status = $status }
}
function Get-RelatedProcesses {
  return @(
    Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -ne $PID -and $_.CommandLine -like '*c19-trim-211c9e8-qa-20260923*'
    } | ForEach-Object { [ordered]@{ pid = $_.ProcessId; name = $_.Name } }
  )
}
function Invoke-Captured([string]$name, [string]$exe, [string[]]$arguments,
    [int]$timeoutSeconds) {
  $stdout = Join-Path $output "$name.stdout.raw"
  $stderr = Join-Path $output "$name.stderr.raw"
  $code = 9009
  $timedOut = $false
  $toolError = $null
  $started = $false
  $createdPid = $null
  $cleanup = 'NOT_REQUIRED'
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo.FileName = $exe
  $process.StartInfo.WorkingDirectory = $repo
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  foreach ($argument in $arguments) { [void]$process.StartInfo.ArgumentList.Add($argument) }
  $outStream = [IO.File]::Open($stdout, [IO.FileMode]::CreateNew)
  $errStream = [IO.File]::Open($stderr, [IO.FileMode]::CreateNew)
  try {
    if (-not $process.Start()) { throw 'Native process did not start' }
    $started = $true
    $createdPid = $process.Id
    $outCopy = $process.StandardOutput.BaseStream.CopyToAsync($outStream)
    $errCopy = $process.StandardError.BaseStream.CopyToAsync($errStream)
    if (-not $process.WaitForExit($timeoutSeconds * 1000)) {
      $timedOut = $true
      $process.Kill($true)
      $cleanup = if ($process.WaitForExit(10000)) {
        'KILL_TREE_REQUESTED_ROOT_EXITED'
      } else { 'KILL_NOT_CONFIRMED' }
    }
    if (-not [System.Threading.Tasks.Task]::WaitAll(
        [System.Threading.Tasks.Task[]]@($outCopy, $errCopy), 10000)) {
      throw 'Native output streams did not close'
    }
    $code = if ($timedOut) { 124 } else { $process.ExitCode }
  } catch {
    $toolError = ($_ | Out-String).Trim()
    if ($started -and -not $process.HasExited) {
      try {
        $process.Kill($true)
        $cleanup = if ($process.WaitForExit(10000)) {
          'KILL_TREE_REQUESTED_ROOT_EXITED'
        } else { 'KILL_NOT_CONFIRMED' }
      } catch {
        $cleanup = "KILL_ERROR: $($_.Exception.Message)"
      }
    }
  } finally {
    $outStream.Dispose()
    $errStream.Dispose()
    $process.Dispose()
  }
  $wrapperErrorPath = $null
  if ($toolError) {
    $wrapperErrorPath = Join-Path $output "$name.wrapper-error.txt"
    Set-Content -LiteralPath $wrapperErrorPath -Value $toolError -Encoding utf8
  }
  $result = [ordered]@{ pid = $createdPid; exitCode = $code; timedOut = $timedOut;
    cleanup = $cleanup; wrapperErrorPath = $wrapperErrorPath;
    timeoutSeconds = $timeoutSeconds; executable = $exe; arguments = $arguments;
    stdout = $stdout; stderr = $stderr }
  if (Test-Path -LiteralPath $stdout) { $result.stdoutSha256 = Get-Sha256 $stdout }
  if (Test-Path -LiteralPath $stderr) { $result.stderrSha256 = Get-Sha256 $stderr }
  if ($wrapperErrorPath) { $result.wrapperErrorSha256 = Get-Sha256 $wrapperErrorPath }
  $receipt.steps[$name] = $result
  return $result
}
function Read-Fingerprint([string]$name, [string]$node, [string]$script) {
  $manifest = Join-Path $output "$name.json"
  $run = Invoke-Captured $name $node @($script, $manifest) 60
  if ($run.exitCode -ne 0 -or -not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "$name fingerprint failed"
  }
  $run.manifest = $manifest
  $run.manifestSha256 = Get-Sha256 $manifest
  return Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
}
function Comparable([object[]]$files) {
  return (@($files | ForEach-Object { "$($_.path)|$($_.bytes)|$($_.sha256)" } | Sort-Object) -join "`n")
}
function SourceOnly([object[]]$files) {
  return @($files | Where-Object { $_.path -notmatch '^apps/(studio-web|desktop)/dist/' })
}

try {
  $syncPath = $receipt.syncReceiptPath
  $receipt.syncReceiptSha256 = Get-Sha256 $syncPath
  if ($receipt.syncReceiptSha256 -ne $expected.syncReceipt) {
    throw 'Protected sync receipt SHA drift'
  }
  $sync = Get-Content -LiteralPath $syncPath -Raw | ConvertFrom-Json
  if ($sync.state -ne 'SYNCED_NOT_QA_ACCEPTED' -or
      $sync.path -ne 'apps/studio-web/src/aivora/SourceExtractionPanel.tsx' -or
      $sync.newSha256 -ne $expected.panel -or
      $sync.snapshotSha256 -ne $expected.snapshot -or
      $sync.headAfter -ne $expected.head -or
      $sync.runtimeProcessesAfter -ne 0) {
    throw 'Protected sync receipt does not match the frozen one-file Panel candidate'
  }
  foreach ($name in @('panel', 'adapter', 'desktop', 'fixture', 'test', 'config',
      'fingerprint', 'distHtmlBefore')) { Assert-Hash $name $paths[$name] }
  $state = Get-RepoState
  if ($state.head -ne $expected.head -or $sync.statusAfterCount -ne $state.statusCount) {
    throw 'c19 HEAD/status differs from the protected sync receipt'
  }
  $related = @(Get-RelatedProcesses)
  if ($related.Count -ne 0) { throw 'c19 has another related process; no exclusive execution' }
  $receipt.preflight = [ordered]@{ repo = $state; relatedProcesses = $related;
    pathSha256 = [ordered]@{} }
  foreach ($name in $paths.Keys) { $receipt.preflight.pathSha256[$name] = Get-Sha256 $paths[$name] }
  $receipt.state = 'PREFLIGHT_PASS'

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $pnpmShim = (Get-Command pnpm.cmd -ErrorAction Stop).Source
  $pnpmCli = Join-Path (Split-Path -Parent $pnpmShim) 'node_modules\corepack\dist\pnpm.js'
  if (-not (Test-Path -LiteralPath $pnpmCli -PathType Leaf)) {
    throw 'The installed pnpm shim does not point to an available Corepack CLI'
  }
  $before = Read-Fingerprint 'before' $node $paths.fingerprint

  $resultJson = Join-Path $output 'component.vitest.json'
  $previousFixture = [Environment]::GetEnvironmentVariable('AC05_RACE_HTTP_CHAIN', 'Process')
  try {
    [Environment]::SetEnvironmentVariable('AC05_RACE_HTTP_CHAIN', $paths.fixture, 'Process')
    $component = Invoke-Captured 'component' $node @(
      $pnpmCli,
      '--filter', '@aijian/studio-web', 'exec', 'vitest', 'run',
      '--config', $paths.config, '--environment', 'jsdom',
      '--reporter=json', "--outputFile=$resultJson", 'ac05-auto-read.panel.test.mjs'
    ) 600
  } finally {
    [Environment]::SetEnvironmentVariable('AC05_RACE_HTTP_CHAIN', $previousFixture, 'Process')
  }
  $afterComponent = Read-Fingerprint 'after-component' $node $paths.fingerprint
  if ($before.head -ne $afterComponent.head -or
      (Comparable $before.source) -ne (Comparable $afterComponent.source) -or
      (Comparable $before.dist) -ne (Comparable $afterComponent.dist)) {
    $receipt.state = 'COMPONENT_INPUT_DRIFT'
    throw 'Component invocation changed source or dist fingerprint'
  }
  if ($component.exitCode -ne 0 -or -not (Test-Path -LiteralPath $resultJson -PathType Leaf)) {
    $receipt.state = 'COMPONENT_RED'
    throw 'Component Vitest failed or did not emit JSON results; stop before build'
  }
  $result = Get-Content -LiteralPath $resultJson -Raw | ConvertFrom-Json
  $receipt.steps.component.resultJson = $resultJson
  $receipt.steps.component.resultJsonSha256 = Get-Sha256 $resultJson
  $receipt.steps.component.summary = [ordered]@{
    total = $result.numTotalTests; passed = $result.numPassedTests;
    failed = $result.numFailedTests; pending = $result.numPendingTests
  }
  if ($result.numTotalTests -ne 7 -or $result.numPassedTests -ne 7 -or
      $result.numFailedTests -ne 0 -or $result.numPendingTests -ne 0) {
    $receipt.state = 'COMPONENT_RED'
    throw 'Component result is not exactly 7/7 PASS; stop before build'
  }
  $receipt.state = 'COMPONENT_PASS'

  $typecheck = Invoke-Captured 'web-typecheck' $node @(
    $pnpmCli, '--filter', '@aijian/studio-web', 'typecheck') 600
  if ($typecheck.exitCode -ne 0) {
    $receipt.state = 'WEB_TYPECHECK_RED'
    throw 'Web typecheck failed; stop before build'
  }
  $build = Invoke-Captured 'web-build' $node @(
    $pnpmCli, '--filter', '@aijian/studio-web', 'build') 900
  $afterBuild = Read-Fingerprint 'after-build' $node $paths.fingerprint
  if ((Comparable (SourceOnly $before.source)) -ne
      (Comparable (SourceOnly $afterBuild.source))) {
    $receipt.state = 'SOURCE_DRIFT_AFTER_BUILD'
    throw 'Web build changed source fingerprint'
  }
  if ($build.exitCode -ne 0) {
    $receipt.state = 'WEB_BUILD_RED'
    throw 'Web build failed'
  }
  foreach ($name in @('panel', 'adapter', 'desktop', 'fixture', 'test', 'config', 'fingerprint')) {
    Assert-Hash $name $paths[$name]
  }
  $receipt.state = 'TARGETED_LOCAL_PASS'
} catch {
  $receipt.error = ($_ | Out-String).Trim()
  if ($receipt.state -in @('PREFLIGHT_PENDING', 'PREFLIGHT_PASS')) {
    $receipt.state = 'BLOCKED_OR_TOOL_ERROR'
  }
} finally {
  try {
    $receipt.postflight = [ordered]@{
      repo = Get-RepoState
      relatedProcesses = @(Get-RelatedProcesses)
      panelSha256 = Get-Sha256 $paths.panel
      adapterSha256 = Get-Sha256 $paths.adapter
      desktopSha256 = Get-Sha256 $paths.desktop
    }
    if ($receipt.state -eq 'TARGETED_LOCAL_PASS' -and
        ($receipt.postflight.repo.head -ne $expected.head -or
         $receipt.postflight.relatedProcesses.Count -ne 0 -or
         $receipt.postflight.panelSha256 -ne $expected.panel -or
         $receipt.postflight.adapterSha256 -ne $expected.adapter -or
         $receipt.postflight.desktopSha256 -ne $expected.desktop)) {
      $receipt.state = 'POSTFLIGHT_RED'
      $receipt.error = 'Postflight HEAD, process, or source SHA differs from the frozen input'
    }
  } catch {
    $receipt.postflight = [ordered]@{ error = ($_ | Out-String).Trim() }
    if ($receipt.state -eq 'TARGETED_LOCAL_PASS') {
      $receipt.state = 'POSTFLIGHT_RED'
      $receipt.error = 'Postflight could not be read'
    }
  }
  $receipt.rawFiles = @(
    Get-ChildItem -LiteralPath $output -File | ForEach-Object {
      [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = Get-Sha256 $_.FullName }
    }
  )
  $receipt.finishedUtc = [DateTime]::UtcNow.ToString('o')
  $receiptPath = Join-Path $output 'RECEIPT.json'
  $receipt | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $receiptPath -Encoding utf8
  Write-Output "Receipt: $receiptPath"
  Write-Output "State: $($receipt.state)"
}

if ($receipt.state -ne 'TARGETED_LOCAL_PASS') { exit 1 }
