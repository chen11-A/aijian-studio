param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PacketPath = Join-Path $Root 'PACKET.json'
$GrantPath = Join-Path $Root 'GRANT.json'
if (-not (Test-Path -LiteralPath $PacketPath -PathType Leaf) -or -not (Test-Path -LiteralPath $GrantPath -PathType Leaf)) { throw 'PACKET_OR_GRANT_MISSING' }
$Packet = Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Grant = Get-Content -LiteralPath $GrantPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Grant.status -ne 'APPROVED_SINGLE_RUN' -or $Grant.approval_id -ne $Packet.approval_id) { throw 'GRANT_STATUS_OR_ID' }
$Runner = Join-Path $Root 'copy_once.py'
$Launch = [string]$Packet.launch_root
if ((Test-Path -LiteralPath $Launch) -or (Test-Path -LiteralPath $Packet.run_root) -or (Test-Path -LiteralPath $Packet.target_root)) { throw 'SINGLE_RUN_OUTPUT_ALREADY_EXISTS' }
if (-not (Test-Path -LiteralPath $Runner -PathType Leaf)) { throw 'RUNNER_MISSING' }
[IO.Directory]::CreateDirectory($Launch) | Out-Null
$Info = [Diagnostics.ProcessStartInfo]::new()
$Info.FileName = [string]$Packet.python_path
$Info.ArgumentList.Add('-I')
$Info.ArgumentList.Add('-B')
$Info.ArgumentList.Add($Runner)
$Info.ArgumentList.Add('APPROVED_SINGLE_RUN')
$Info.WorkingDirectory = $Root
$Info.UseShellExecute = $false
$Info.CreateNoWindow = $true
$Info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$Info.RedirectStandardOutput = $true
$Info.RedirectStandardError = $true
foreach ($Name in @('PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT','PYTHONUSERBASE')) { [void]$Info.Environment.Remove($Name) }
$Process = [Diagnostics.Process]::Start($Info)
$Stdout = $Process.StandardOutput.ReadToEnd()
$Stderr = $Process.StandardError.ReadToEnd()
$Process.WaitForExit()
$Utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $Launch 'stdout.txt'),$Stdout,$Utf8)
[IO.File]::WriteAllText((Join-Path $Launch 'stderr.txt'),$Stderr,$Utf8)
$Exit = [ordered]@{ state = $(if ($Process.ExitCode -eq 0) { 'PROCESS_EXIT_ZERO' } else { 'PROCESS_EXIT_RED_STOP' }); exit_code = $Process.ExitCode; process_id = $Process.Id; hidden = $true; arguments = @('-I','-B',$Runner,'APPROVED_SINGLE_RUN'); launch_root = $Launch }
[IO.File]::WriteAllText((Join-Path $Launch 'EXIT.json'),(($Exit | ConvertTo-Json -Depth 4) + "`n"),$Utf8)
if ($Process.ExitCode -ne 0) { throw "COPY_RED_STOP_EXIT_$($Process.ExitCode)" }
