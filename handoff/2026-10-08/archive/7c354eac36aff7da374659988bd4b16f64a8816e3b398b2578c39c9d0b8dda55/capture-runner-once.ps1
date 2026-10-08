param(
  [Parameter(Mandatory=$true)][string]$OwnedRoot,
  [Parameter(Mandatory=$true)][string]$ScriptInput,
  [Parameter(Mandatory=$true)][string]$NovelInput,
  [Parameter(Mandatory=$true)][string]$Candidate,
  [Parameter(Mandatory=$true)][string]$CaptureDirectory
)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$runner = Join-Path $OwnedRoot 'run-native-source-qa.mjs'
$stdout = Join-Path $CaptureDirectory 'runner.stdout.raw'
$stderr = Join-Path $CaptureDirectory 'runner.stderr.raw'
$launchPath = Join-Path $CaptureDirectory 'launch.json'
if (-not [IO.Directory]::Exists($CaptureDirectory)) { throw 'Capture directory missing' }
if ([IO.File]::Exists($launchPath) -or [IO.File]::Exists($stdout) -or [IO.File]::Exists($stderr)) {
  throw 'Capture files already exist; refusing a second launch'
}
$arguments = @($runner, "--script=$ScriptInput", "--novel=$NovelInput", "--candidate=$Candidate")
$started = [DateTime]::UtcNow.ToString('o')
$process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $OwnedRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$record = [ordered]@{
  started_utc = $started
  launcher_pid = $PID
  runner_pid = $process.Id
  executable = $node
  arguments = $arguments
  capture_directory = $CaptureDirectory
  stdout = $stdout
  stderr = $stderr
  finished_utc = $null
  exit_code = $null
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($launchPath, ($record | ConvertTo-Json -Depth 5), $utf8)
Write-Output ('RUNNER_PID=' + $process.Id)
Write-Output ('CAPTURE=' + $CaptureDirectory)
$process.WaitForExit()
$process.Refresh()
$record.finished_utc = [DateTime]::UtcNow.ToString('o')
$record.exit_code = $process.ExitCode
[IO.File]::WriteAllText($launchPath, ($record | ConvertTo-Json -Depth 5), $utf8)
Write-Output ('RUNNER_EXIT=' + $process.ExitCode)
exit $process.ExitCode
