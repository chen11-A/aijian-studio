param(
  [Parameter(Mandatory=$true)][string]$Repo,
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$builds = @(
  @{name='studio-web'; filter='@aijian/studio-web'},
  @{name='desktop'; filter='@aijian/desktop'}
)
$records = New-Object System.Collections.Generic.List[object]
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($build in $builds) {
  $stdout = Join-Path $EvidenceDirectory ($build.name + '.stdout.raw')
  $stderr = Join-Path $EvidenceDirectory ($build.name + '.stderr.raw')
  if ([IO.File]::Exists($stdout) -or [IO.File]::Exists($stderr)) {
    throw "Build output already exists: $($build.name)"
  }
  $buildArgs = @('--filter', $build.filter, 'build')
  $started = [DateTime]::UtcNow.ToString('o')
  $process = Start-Process -FilePath $pnpm -ArgumentList $buildArgs -WorkingDirectory $Repo -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $record = [ordered]@{
    name = $build.name
    executable = $pnpm
    arguments = $buildArgs
    pid = $process.Id
    started_utc = $started
    finished_utc = $null
    exit_code = $null
    stdout = $stdout
    stderr = $stderr
  }
  $records.Add($record)
  [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'build-runs.json'), ($records | ConvertTo-Json -Depth 5), $utf8)
  Write-Output ("BUILD_STARTED $($build.name) PID=$($process.Id)")
  $process.WaitForExit()
  $process.Refresh()
  $record.finished_utc = [DateTime]::UtcNow.ToString('o')
  $record.exit_code = $process.ExitCode
  [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'build-runs.json'), ($records | ConvertTo-Json -Depth 5), $utf8)
  Write-Output ("BUILD_EXIT $($build.name) $($process.ExitCode)")
  if ($process.ExitCode -ne 0) { exit $process.ExitCode }
}
