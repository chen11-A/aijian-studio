param(
  [Parameter(Mandatory = $true)][string]$ApprovalPath,
  [Parameter(Mandatory = $true)][string]$ApprovalSha256,
  [Parameter(Mandatory = $true)][string]$OutputDir
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$qaRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repo = 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923'
$fingerprint = 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa03-ac05-front-20260924\fingerprint.mjs'
$output = [IO.Path]::GetFullPath($OutputDir)
$approvalFull = [IO.Path]::GetFullPath($ApprovalPath)
$expectedFiles = [ordered]@{
  'apps/studio-web/src/aivora/StoryPages.tsx' = '34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60'
  'apps/studio-web/src/aivora/model.tsx' = '0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211'
  'apps/studio-web/src/api/studio.ts' = '7521270E03EF55B649E8B0EA150FE859CB04EADFD7D84C0886FD856FDD378679'
  'apps/studio-web/src/aivora/adapters/projectManagement.ts' = '7B549DCDBE7A4E3F4051FD815E98B013A07610D995C24BB135EDEBA656F8CD66'
}
$snapshotSha = 'EE77C4EEB6B75A20C776CE9CF5C7048B14DEA23441F5F8B1F5B3F892DF5AF312'
$syncSha = '6CB98F12620EEBCCC244ACEAD6DC1888B1E7302A403AAACEBAC63B22881B2ACF'
$qaPrefix = $qaRoot.TrimEnd('\') + '\'
if (-not $output.StartsWith($qaPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputDir must be under the external QA03 packet directory'
}
if (Test-Path -LiteralPath $output) { throw 'OutputDir already exists; a one-shot run cannot be reused' }
if (-not (Test-Path -LiteralPath $approvalFull -PathType Leaf)) { throw 'Missing signed approval envelope' }
if ($approvalFull -eq (Join-Path $qaRoot 'RUN-APPROVAL.template.json')) {
  throw 'Template is not an approval envelope'
}
if ($ApprovalSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'ApprovalSha256 is required' }
if ((Get-FileHash -LiteralPath $approvalFull -Algorithm SHA256).Hash -ne $ApprovalSha256.ToUpperInvariant()) {
  throw 'Approval envelope SHA mismatch'
}
$approval = Get-Content -LiteralPath $approvalFull -Raw | ConvertFrom-Json
if ($approval.schema -ne 'qa03.project-name-source.cas-overlay.one-shot.approval.v3' -or
    $approval.state -ne 'APPROVED_SINGLE_RUN' -or
    $approval.packetSha256 -notmatch '^[0-9a-fA-F]{64}$' -or
    -not $approval.runId -or $approval.runId -notmatch '^[a-z0-9-]{8,64}$' -or
    $approval.outputDir -ne $output -or
    $approval.c19Head -ne '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2') {
  throw 'Approval envelope is incomplete or does not name this exact run'
}
New-Item -ItemType Directory -Path $output -ErrorAction Stop | Out-Null
$receipt = [ordered]@{
  schema = 'qa03.project-name-source.component.v1'
  state = 'PREFLIGHT_PENDING'
  firstRed = $null
  startedUtc = [DateTime]::UtcNow.ToString('o')
  finishedUtc = $null
  approvalPath = $approvalFull
  approvalSha256 = $ApprovalSha256.ToUpperInvariant()
  repo = $repo
  output = $output
  preflight = [ordered]@{}
  steps = [ordered]@{}
  postflight = $null
  rawFiles = @()
  error = $null
}
function Sha([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing file: $path" }
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToUpperInvariant()
}
function StatusLines {
  $lines = @(& git -C $repo status --porcelain -uall | Where-Object { $_ })
  if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
  return $lines
}
function StatusSha([string[]]$lines) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
}
function RelatedProcesses {
  return @(Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -like '*c19-trim-211c9e8-qa-20260923*'
  } | ForEach-Object { [ordered]@{ pid = $_.ProcessId; name = $_.Name } })
}
function Invoke-Captured([string]$name, [string]$exe, [string[]]$commandArgs,
    [int]$timeoutSeconds) {
  $stdout = Join-Path $output "$name.stdout.raw"
  $stderr = Join-Path $output "$name.stderr.raw"
  $outStream = [IO.File]::Open($stdout, [IO.FileMode]::CreateNew)
  $errStream = [IO.File]::Open($stderr, [IO.FileMode]::CreateNew)
  $proc = [Diagnostics.Process]::new()
  $proc.StartInfo.FileName = $exe
  $proc.StartInfo.WorkingDirectory = $repo
  $proc.StartInfo.UseShellExecute = $false
  $proc.StartInfo.CreateNoWindow = $true
  $proc.StartInfo.RedirectStandardOutput = $true
  $proc.StartInfo.RedirectStandardError = $true
  foreach ($item in $commandArgs) { [void]$proc.StartInfo.ArgumentList.Add($item) }
  $pidCreated = $null
  $code = 9009
  $timedOut = $false
  $cleanup = 'NOT_REQUIRED'
  $nativeError = $null
  try {
    if (-not $proc.Start()) { throw 'Process did not start' }
    $pidCreated = $proc.Id
    $copyOut = $proc.StandardOutput.BaseStream.CopyToAsync($outStream)
    $copyErr = $proc.StandardError.BaseStream.CopyToAsync($errStream)
    if (-not $proc.WaitForExit($timeoutSeconds * 1000)) {
      $timedOut = $true
      $proc.Kill($true)
      $cleanup = if ($proc.WaitForExit(10000)) { 'KILL_TREE_ROOT_EXITED' }
        else { 'KILL_NOT_CONFIRMED' }
    }
    if (-not [Threading.Tasks.Task]::WaitAll(
        [Threading.Tasks.Task[]]@($copyOut, $copyErr), 10000)) {
      throw 'Output streams did not close'
    }
    $code = if ($timedOut) { 124 } else { $proc.ExitCode }
  } catch {
    $nativeError = ($_ | Out-String).Trim()
    if ($pidCreated -and -not $proc.HasExited) {
      try {
        $proc.Kill($true)
        $cleanup = if ($proc.WaitForExit(10000)) { 'KILL_TREE_ROOT_EXITED' }
          else { 'KILL_NOT_CONFIRMED' }
      } catch { $cleanup = "KILL_ERROR: $($_.Exception.Message)" }
    }
  } finally {
    $outStream.Dispose()
    $errStream.Dispose()
    $proc.Dispose()
  }
  $result = [ordered]@{ pid = $pidCreated; exitCode = $code; timedOut = $timedOut;
    cleanup = $cleanup; timeoutSeconds = $timeoutSeconds; executable = $exe;
    arguments = $commandArgs; stdout = $stdout; stderr = $stderr;
    stdoutSha256 = Sha $stdout; stderrSha256 = Sha $stderr; nativeError = $nativeError }
  $receipt.steps[$name] = $result
  return $result
}
function Read-Fingerprint([string]$name, [string]$node) {
  $path = Join-Path $output "$name.json"
  $step = Invoke-Captured $name $node @($fingerprint, $path) 60
  if ($step.exitCode -ne 0 -or $step.timedOut -or -not (Test-Path -LiteralPath $path)) {
    throw "$name fingerprint RED"
  }
  $step.manifest = $path
  $step.manifestSha256 = Sha $path
  return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}
function Comparable([object[]]$files) {
  return (@($files | ForEach-Object { "$($_.path)|$($_.bytes)|$($_.sha256)" } | Sort-Object) -join "`n")
}
function ValueSha([string]$value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($value)
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
}
try {
  if ((Sha (Join-Path $qaRoot 'PACKET.json')) -ne $approval.packetSha256) {
    throw 'RED0: packet SHA drift'
  }
  if (-not $approval.storySnapshotPath -or -not $approval.storySnapshotSha256 -or
      $approval.storySnapshotSha256 -ne $snapshotSha -or
      (Sha $approval.storySnapshotPath) -ne $snapshotSha) {
    throw 'RED0: DEV03 StoryPages frozen snapshot is missing or mismatched'
  }
  $snapshot = Get-Content -LiteralPath $approval.storySnapshotPath -Raw | ConvertFrom-Json
  if ($snapshot.status -ne 'FROZEN_C19_BASE_CAS_ONLY_NOT_SYNCED_NOT_QA_ACCEPTED' -or
      $snapshot.candidate_storypages_sha256 -ne $expectedFiles['apps/studio-web/src/aivora/StoryPages.tsx'] -or
      $snapshot.baseline_storypages_sha256 -ne '13998D8D7BBCA0CC857231469B5CD337352D37A60474253DEB5C1AF9EA834929' -or
      $snapshot.studio_dependency_sha256 -ne $expectedFiles['apps/studio-web/src/api/studio.ts'] -or
      $snapshot.project_management_dependency_sha256 -ne $expectedFiles['apps/studio-web/src/aivora/adapters/projectManagement.ts']) {
    throw 'RED0: frozen CAS-only manifest content mismatch'
  }
  $snapshotRoot = Split-Path -Parent $approval.storySnapshotPath
  if ((Sha (Join-Path $snapshotRoot 'StoryPages.tsx')) -ne $expectedFiles['apps/studio-web/src/aivora/StoryPages.tsx'] -or
      (Sha (Join-Path $snapshotRoot 'studio.c19-dependency.ts')) -ne $expectedFiles['apps/studio-web/src/api/studio.ts'] -or
      (Sha (Join-Path $snapshotRoot 'projectManagement.c19-dependency.ts')) -ne $expectedFiles['apps/studio-web/src/aivora/adapters/projectManagement.ts']) {
    throw 'RED0: frozen CAS-only file bytes mismatch'
  }
  if (-not $approval.syncReceiptPath -or -not $approval.syncReceiptSha256 -or
      $approval.syncReceiptSha256 -ne $syncSha -or
      (Sha $approval.syncReceiptPath) -ne $syncSha) {
    throw 'RED0: protected c19 sync receipt is missing or mismatched'
  }
  $sync = Get-Content -LiteralPath $approval.syncReceiptPath -Raw | ConvertFrom-Json
  if ($sync.status -ne 'SYNCED_NOT_QA_ACCEPTED' -or
      $sync.source_snapshot_sha256 -ne $snapshotSha -or
      $sync.before_target_sha256 -ne '13998D8D7BBCA0CC857231469B5CD337352D37A60474253DEB5C1AF9EA834929' -or
      $sync.after_target_sha256 -ne $expectedFiles['apps/studio-web/src/aivora/StoryPages.tsx'] -or
      $sync.c19_head -ne $approval.c19Head -or
      (@($sync.changed_paths).Count -ne 1) -or
      $sync.changed_paths[0] -ne 'apps/studio-web/src/aivora/StoryPages.tsx' -or
      $sync.other_scope_sha256_exact_match -ne $true -or
      $sync.dist_changed -ne $false -or
      $sync.qa -ne 'NOT_RUN') {
    throw 'RED0: protected c19 sync receipt content mismatch'
  }
  if ((Sha $fingerprint) -ne $approval.fingerprintSha256 -or
      (Sha (Join-Path $qaRoot 'project-name-source.test.mjs')) -ne $approval.testSha256 -or
      (Sha (Join-Path $qaRoot 'vitest.config.mjs')) -ne $approval.configSha256 -or
      (Sha $PSCommandPath) -ne $approval.runnerSha256) {
    throw 'RED0: QA script/config/fingerprint/runner SHA drift'
  }
  $actualInputs = [ordered]@{}
  foreach ($entry in $expectedFiles.GetEnumerator()) {
    $relative = $entry.Key.Replace('/', '\')
    $c19Sha = Sha (Join-Path $repo $relative)
    $actualInputs[$entry.Key] = [ordered]@{ c19 = $c19Sha }
    if ($c19Sha -ne $entry.Value) {
      throw "RED0: source mismatch $($entry.Key)"
    }
  }
  $head = (& git -C $repo rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $head -ne $approval.c19Head) { throw 'RED0: c19 HEAD drift' }
  $status = @(StatusLines)
  $statusSha = StatusSha $status
  if (-not $approval.c19StatusSha256 -or $statusSha -ne $approval.c19StatusSha256) {
    throw 'RED0: c19 status drift'
  }
  $related = @(RelatedProcesses)
  if ($related.Count -ne 0) { throw 'RED0: another c19 process is active' }
  $receipt.preflight = [ordered]@{ head = $head; status = $status;
    statusSha256 = $statusSha; sourceSha256 = $actualInputs;
    relatedProcesses = $related; distBefore = $null }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $vitest = Join-Path $repo 'apps\studio-web\node_modules\vitest\vitest.mjs'
  if (-not (Test-Path -LiteralPath $vitest -PathType Leaf)) { throw 'RED0: Vitest executable missing' }
  $before = Read-Fingerprint 'before' $node
  $sourceFingerprintSha = ValueSha (Comparable $before.source)
  $distFingerprintSha = ValueSha (Comparable $before.dist)
  if ($approval.sourceFingerprintSha256 -notmatch '^[0-9a-fA-F]{64}$' -or
      $approval.distFingerprintSha256 -notmatch '^[0-9a-fA-F]{64}$' -or
      $sourceFingerprintSha -ne $approval.sourceFingerprintSha256 -or
      $distFingerprintSha -ne $approval.distFingerprintSha256) {
    throw 'RED0: approved source/dist fingerprint differs before Vitest'
  }
  $receipt.preflight.sourceFingerprintSha256 = $sourceFingerprintSha
  $receipt.preflight.distFingerprintSha256 = $distFingerprintSha
  $receipt.preflight.distBefore = @($before.dist)
  $receipt.state = 'PREFLIGHT_PASS'

  $resultJson = Join-Path $output 'component.vitest.json'
  $component = Invoke-Captured 'component' $node @(
    $vitest, 'run', '--config', (Join-Path $qaRoot 'vitest.config.mjs'),
    '--reporter=json', "--outputFile=$resultJson", 'project-name-source.test.mjs'
  ) 600
  if ($component.exitCode -ne 0 -or $component.timedOut) {
    $receipt.state = 'COMPONENT_RED'
  }
  $after = Read-Fingerprint 'after-component' $node
  if ($component.exitCode -ne 0 -or $component.timedOut -or
      -not (Test-Path -LiteralPath $resultJson -PathType Leaf)) {
    $receipt.state = 'COMPONENT_RED'
    throw 'Component exit/timeout/JSON RED; stop'
  }
  if ($before.head -ne $after.head -or
      (Comparable $before.source) -ne (Comparable $after.source) -or
      (Comparable $before.dist) -ne (Comparable $after.dist)) {
    $receipt.state = 'POST_COMPONENT_DRIFT'
    throw 'Source or dist fingerprint drift after component test'
  }
  $result = Get-Content -LiteralPath $resultJson -Raw | ConvertFrom-Json
  $receipt.steps.component.resultJson = $resultJson
  $receipt.steps.component.resultJsonSha256 = Sha $resultJson
  $receipt.steps.component.summary = [ordered]@{
    total = $result.numTotalTests; passed = $result.numPassedTests;
    failed = $result.numFailedTests; pending = $result.numPendingTests }
  if ($result.numTotalTests -ne 5 -or $result.numPassedTests -ne 5 -or
      $result.numFailedTests -ne 0 -or $result.numPendingTests -ne 0) {
    $receipt.state = 'COMPONENT_RED'
    throw 'Exactly 5/5 is required'
  }
  $receipt.state = 'TARGETED_LOCAL_COMPONENT_PASS'
} catch {
  $receipt.error = ($_ | Out-String).Trim()
  $receipt.firstRed = $receipt.error
  if ($receipt.state -in @('PREFLIGHT_PENDING', 'PREFLIGHT_PASS')) {
    $receipt.state = 'PREFLIGHT_OR_TOOL_RED'
  }
} finally {
  try {
    $receipt.postflight = [ordered]@{
      head = (& git -C $repo rev-parse HEAD).Trim()
      statusSha256 = StatusSha @(StatusLines)
      relatedProcesses = @(RelatedProcesses)
      sourceSha256 = [ordered]@{}
    }
    foreach ($entry in $expectedFiles.GetEnumerator()) {
      $path = Join-Path $repo ($entry.Key.Replace('/', '\'))
      $receipt.postflight.sourceSha256[$entry.Key] = Sha $path
    }
    $sourceDrift = @($expectedFiles.GetEnumerator() | Where-Object {
      $receipt.postflight.sourceSha256[$_.Key] -ne $_.Value
    }).Count -ne 0
    if ($receipt.state -eq 'TARGETED_LOCAL_COMPONENT_PASS' -and
        ($receipt.postflight.head -ne $approval.c19Head -or
         $receipt.postflight.statusSha256 -ne $approval.c19StatusSha256 -or
         $receipt.postflight.relatedProcesses.Count -ne 0 -or $sourceDrift)) {
      $receipt.state = 'POSTFLIGHT_RED'
      $receipt.firstRed = 'Postflight HEAD/status/process/source drift'
    }
  } catch {
    $receipt.postflight = [ordered]@{ error = ($_ | Out-String).Trim() }
    if ($receipt.state -eq 'TARGETED_LOCAL_COMPONENT_PASS') {
      $receipt.state = 'POSTFLIGHT_RED'
      $receipt.firstRed = 'Postflight could not be read'
    }
  }
  $receipt.rawFiles = @(Get-ChildItem -LiteralPath $output -File | ForEach-Object {
    [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = Sha $_.FullName }
  })
  $receipt.finishedUtc = [DateTime]::UtcNow.ToString('o')
  $receiptPath = Join-Path $output 'RECEIPT.json'
  $receipt | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $receiptPath -Encoding utf8
  Write-Output "Receipt: $receiptPath"
  Write-Output "State: $($receipt.state)"
}
if ($receipt.state -ne 'TARGETED_LOCAL_COMPONENT_PASS') { exit 1 }
