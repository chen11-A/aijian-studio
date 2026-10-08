$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath))
$PacketPath = Join-Path $Root 'PACKET.json'
$LaunchPacketPath = Join-Path $Root 'LAUNCH-PACKET.json'
$RunnerPath = Join-Path $Root 'g0_once.py'
$GrantPath = Join-Path $Root 'GRANT.json'
$ProfileRoot = Join-Path $Root 'profile-01'
$LaunchRoot = Join-Path $Root 'launch-01'
$RunRoot = Join-Path $Root 'run-01'
$ExpectedPacketSha = '4C22073EE795E9623BEFF917AB1AD3C267BCCCA1A5B27E4ACDE1F9F0FF4B11C8'
$ExpectedRunnerSha = 'A3BD1B2B1301B1EAA680ADB2A2C02A22C823E2F6EBF1FA98514616C819B2382B'
$Utf8 = [Text.UTF8Encoding]::new($false)
function Require([bool]$Condition, [string]$Reason) { if (-not $Condition) { throw $Reason } }
function Sha256([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant() }
function WriteTextOnce([string]$Path, [string]$Value) {
    $Stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $Bytes = $Utf8.GetBytes($Value); $Stream.Write($Bytes, 0, $Bytes.Length); $Stream.Flush($true) }
    finally { $Stream.Dispose() }
}
function WriteJsonOnce([string]$Path, [object]$Value) { WriteTextOnce $Path (($Value | ConvertTo-Json -Depth 15) + "`n") }
function InvokeHidden([System.Diagnostics.ProcessStartInfo]$Info, [int]$TimeoutMs) {
    $Process = [Diagnostics.Process]::new()
    try {
        $Process.StartInfo = $Info
        Require ($Process.Start()) 'PROCESS_START_FALSE'
        $PidValue = $Process.Id
        $OutTask = $Process.StandardOutput.ReadToEndAsync()
        $ErrTask = $Process.StandardError.ReadToEndAsync()
        $Exited = $Process.WaitForExit($TimeoutMs)
        if (-not $Exited) { $Process.Kill($true); $Process.WaitForExit() }
        $OutTask.Wait(); $ErrTask.Wait()
        return [ordered]@{pid=$PidValue;exit_code=$Process.ExitCode;timed_out=(-not $Exited);stdout=$OutTask.Result;stderr=$ErrTask.Result;process_has_exited=$Process.HasExited}
    } finally { $Process.Dispose() }
}
Require ($args.Count -eq 0) 'NO_ARGUMENTS_ALLOWED'
Require (Test-Path -LiteralPath $GrantPath -PathType Leaf) 'NO_APPROVED_GRANT; B31_G0_NOT_STARTED'
Require (-not (Test-Path -LiteralPath $LaunchRoot)) 'LAUNCH_01_ALREADY_EXISTS; NO_RETRY'
Require (-not (Test-Path -LiteralPath $RunRoot)) 'RUN_01_ALREADY_EXISTS; NO_RETRY'
Require ((Sha256 $PacketPath) -eq $ExpectedPacketSha) 'PACKET_CHANGED'
$Packet = Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Grant = Get-Content -LiteralPath $GrantPath -Raw -Encoding UTF8 | ConvertFrom-Json
$LaunchPacket = Get-Content -LiteralPath $LaunchPacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
$LauncherSha = Sha256 $PSCommandPath
Require ($Packet.state -eq 'READY_FOR_B31_G0_ONE_SHOT_GRANT' -and $Packet.scope -eq 'B31_G0_CONSUMER_IDENTITY_EXACT3') 'PACKET_SCOPE'
Require ($Packet.runner_path -eq $RunnerPath -and $Packet.run_root -eq $RunRoot -and $Packet.runner_sha256 -eq $ExpectedRunnerSha) 'PACKET_PATHS'
Require ($Grant.state -eq 'APPROVED_SINGLE_RUN' -and $Grant.approved_by -eq 'MGR02' -and $Grant.mgr01_scope_reviewed -eq $true) 'GRANT_OWNER'
Require ($Grant.scope -eq $Packet.scope -and $Grant.one_shot_run -eq 'run-01' -and $Grant.launcher_one_shot -eq 'launch-01') 'GRANT_SCOPE'
Require ($Grant.no_provider_approved -eq $true -and $Grant.allowed_writes_approved -eq $true -and $Grant.clean_environment_approved -eq $true) 'GRANT_BOUNDARIES'
Require ($Grant.packet_sha256 -eq $ExpectedPacketSha -and $Grant.runner_sha256 -eq $ExpectedRunnerSha -and $Grant.launcher_sha256 -eq $LauncherSha) 'GRANT_EXECUTABLE_HASHES'
Require ((Sha256 $LaunchPacketPath) -eq $Grant.launch_packet_sha256) 'LAUNCH_PACKET_CHANGED'
Require ($LaunchPacket.packet_sha256 -eq $ExpectedPacketSha -and $LaunchPacket.runner_sha256 -eq $ExpectedRunnerSha -and $LaunchPacket.launcher_sha256 -eq $LauncherSha -and $LaunchPacket.profile_path -eq $ProfileRoot -and $LaunchPacket.launch_evidence_root -eq $LaunchRoot) 'LAUNCH_PACKET_BINDING'
Require ((Sha256 $Packet.python_path) -eq $Packet.python_sha256) 'PYTHON_CHANGED'
$ProfileItems = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
Require ($ProfileItems.Count -eq 4 -and @($ProfileItems | Where-Object { -not $_.PSIsContainer }).Count -eq 0 -and @($ProfileItems | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -eq 0) 'PROFILE_PRE'
$WindowsRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
$CleanEnv = [ordered]@{SYSTEMROOT=$WindowsRoot;WINDIR=$WindowsRoot;USERPROFILE=$ProfileRoot;APPDATA=(Join-Path $ProfileRoot 'AppData\Roaming');LOCALAPPDATA=(Join-Path $ProfileRoot 'AppData\Local');TEMP=(Join-Path $ProfileRoot 'Temp');TMP=(Join-Path $ProfileRoot 'Temp');HOME=$ProfileRoot}
$HashInfo = [Diagnostics.ProcessStartInfo]::new()
$HashInfo.FileName = $Packet.python_path; $HashInfo.WorkingDirectory = $Root; $HashInfo.UseShellExecute = $false; $HashInfo.CreateNoWindow = $true; $HashInfo.RedirectStandardOutput = $true; $HashInfo.RedirectStandardError = $true
foreach ($Arg in @('-I','-B','-c','import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest().upper())',$RunnerPath)) { $HashInfo.ArgumentList.Add($Arg) }
$HashInfo.Environment.Clear(); foreach ($Entry in $CleanEnv.GetEnumerator()) { $HashInfo.Environment[$Entry.Key] = $Entry.Value }
Require (@($HashInfo.Environment.Keys).Count -eq 8) 'HASH_ENV_COUNT'
$HashProbe = InvokeHidden $HashInfo 30000
Require (-not $HashProbe.timed_out -and $HashProbe.exit_code -eq 0 -and [string]::IsNullOrEmpty($HashProbe.stderr) -and $HashProbe.stdout.Trim() -eq $ExpectedRunnerSha) 'RUNNER_CHANGED_OR_HASH_PROBE_RED'
Require (@(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse).Count -eq 4) 'PROFILE_CHANGED_BY_HASH_PROBE'
$Info = [Diagnostics.ProcessStartInfo]::new()
$Info.FileName = $Packet.python_path; $Info.WorkingDirectory = $Root; $Info.UseShellExecute = $false; $Info.CreateNoWindow = $true; $Info.RedirectStandardOutput = $true; $Info.RedirectStandardError = $true
foreach ($Arg in @('-I','-B',$RunnerPath)) { $Info.ArgumentList.Add($Arg) }
$Info.Environment.Clear(); foreach ($Entry in $CleanEnv.GetEnumerator()) { $Info.Environment[$Entry.Key] = $Entry.Value }
Require (@($Info.Environment.Keys).Count -eq 8) 'ENV_COUNT'
[IO.Directory]::CreateDirectory($LaunchRoot) | Out-Null
WriteJsonOnce (Join-Path $LaunchRoot 'PREPARED.json') ([ordered]@{at_utc=[DateTimeOffset]::UtcNow.ToString('o');approval_id=$Grant.approval_id;grant_sha256=(Sha256 $GrantPath);packet_sha256=$ExpectedPacketSha;runner_sha256=$ExpectedRunnerSha;launcher_sha256=$LauncherSha;launch_packet_sha256=(Sha256 $LaunchPacketPath);hash_probe=$HashProbe;command=@($Info.FileName,'-I','-B',$RunnerPath);environment=$CleanEnv;profile_files=0})
$Child = $null
try {
    $Child = InvokeHidden $Info 120000
    WriteJsonOnce (Join-Path $LaunchRoot 'PROCESS-OBSERVED.json') ([ordered]@{observed_at_utc=[DateTimeOffset]::UtcNow.ToString('o');pid=$Child.pid;process_has_exited=$Child.process_has_exited;approval_id=$Grant.approval_id})
    WriteTextOnce (Join-Path $LaunchRoot 'STDOUT.txt') $Child.stdout
    WriteTextOnce (Join-Path $LaunchRoot 'STDERR.txt') $Child.stderr
    $ProfileAfter = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
    $Files = @($ProfileAfter | Where-Object { -not $_.PSIsContainer }).Count
    $Links = @($ProfileAfter | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count
    WriteJsonOnce (Join-Path $LaunchRoot 'EXIT.json') ([ordered]@{at_utc=[DateTimeOffset]::UtcNow.ToString('o');pid=$Child.pid;exit_code=$Child.exit_code;timed_out=$Child.timed_out;process_has_exited=$Child.process_has_exited;pid_still_present_after_exit=($null -ne (Get-Process -Id $Child.pid -ErrorAction SilentlyContinue));stdout_sha256=(Sha256 (Join-Path $LaunchRoot 'STDOUT.txt'));stderr_sha256=(Sha256 (Join-Path $LaunchRoot 'STDERR.txt'));receipt_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RECEIPT.json'));red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RED.json'));post_profile_file_count=$Files;post_profile_link_count=$Links;post_profile_dir_count=@($ProfileAfter | Where-Object { $_.PSIsContainer }).Count})
    Require ($Files -eq 0 -and $Links -eq 0 -and $ProfileAfter.Count -eq 4) 'PROFILE_POST'
    Require (-not $Child.timed_out -and $Child.exit_code -eq 0) 'B31_G0_RED'
    Write-Output 'B31_G0_LAUNCH_EXIT_ZERO; REVIEW_RUN_RECEIPT'
} catch {
    $Red = [ordered]@{state='RED_STOP_NO_RETRY';at_utc=[DateTimeOffset]::UtcNow.ToString('o');pid=if($null -eq $Child){$null}else{$Child.pid};error=$_.Exception.ToString();receipt_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RECEIPT.json'));red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RED.json'))}
    try { WriteJsonOnce (Join-Path $LaunchRoot 'RED.json') $Red } catch { Write-Error ('RED_EVIDENCE_WRITE_FAILED ' + $_.Exception.Message) }
    throw
}
