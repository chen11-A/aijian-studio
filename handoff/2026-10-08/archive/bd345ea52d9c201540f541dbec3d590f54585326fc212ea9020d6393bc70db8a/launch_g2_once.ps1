$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath))
$PacketPath = Join-Path $Root 'PACKET.json'
$LaunchPacketPath = Join-Path $Root 'LAUNCH-PACKET.json'
$RunnerPath = Join-Path $Root 'g2_once.py'
$GrantPath = Join-Path $Root 'GRANT.json'
$ProfileRoot = Join-Path $Root 'profile-01'
$LaunchRoot = Join-Path $Root 'launch-01'
$RunRoot = Join-Path $Root 'run-01'
$ExpectedRunnerSha = 'A27780579CE10C4972DAF877DBEAEB6E509AA0093C5C7BF21672E365D3F1606C'
$ExpectedShellPath = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe'
$ExpectedShellSha = '362A356CE7F0940EC74F73A8FC2C990A2CC24A38A11C90BBD8ECA947110AD139'
$ExpectedShellVersion = '7.6.5'
$Utf8 = [Text.UTF8Encoding]::new($false)
function Require([bool]$Condition, [string]$Reason) { if (-not $Condition) { throw $Reason } }
function Sha256([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant() }
function WriteTextOnce([string]$Path, [string]$Value) {
    $Stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $Bytes = $Utf8.GetBytes($Value); $Stream.Write($Bytes, 0, $Bytes.Length); $Stream.Flush($true) }
    finally { $Stream.Dispose() }
}
function WriteJsonOnce([string]$Path, [object]$Value) { WriteTextOnce $Path (($Value | ConvertTo-Json -Depth 15) + "`n") }
function InvokeHidden([System.Diagnostics.ProcessStartInfo]$Info, [int]$TimeoutMs, [string]$Tag) {
    $OutPath = Join-Path $LaunchRoot ($Tag + '-STDOUT.bin')
    $ErrPath = Join-Path $LaunchRoot ($Tag + '-STDERR.bin')
    $OutFile = [IO.FileStream]::new($OutPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read, 4096, [IO.FileOptions]::Asynchronous)
    $ErrFile = [IO.FileStream]::new($ErrPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read, 4096, [IO.FileOptions]::Asynchronous)
    $Process = [Diagnostics.Process]::new()
    $OutTask = $null; $ErrTask = $null
    $Result = [ordered]@{pid=$null;exit_code=$null;timed_out=$false;kill_sent=$false;kill_error=$null;process_has_exited=$false;stdout_complete=$false;stderr_complete=$false;stream_wait_error=$null;process_error=$null;stdout_error=$null;stderr_error=$null;stdout_path=$OutPath;stderr_path=$ErrPath}
    try {
        $Process.StartInfo = $Info
        Require ($Process.Start()) 'PROCESS_START_FALSE'
        $Result.pid = $Process.Id
        $OutTask = $Process.StandardOutput.BaseStream.CopyToAsync($OutFile)
        $ErrTask = $Process.StandardError.BaseStream.CopyToAsync($ErrFile)
        $Exited = $Process.WaitForExit($TimeoutMs)
        $Result.timed_out = -not $Exited
        if (-not $Exited) {
            try { $Process.Kill($true); $Result.kill_sent = $true }
            catch { $Result.kill_error = $_.Exception.ToString() }
            $Exited = $Process.WaitForExit(5000)
        }
        $Result.process_has_exited = $Exited
        if ($Exited) { $Result.exit_code = $Process.ExitCode }
        try { [void][Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($OutTask,$ErrTask),5000) }
        catch { $Result.stream_wait_error = $_.Exception.ToString() }
    } catch { $Result.process_error = $_.Exception.ToString() }
    finally {
        if ($null -ne $Result.pid) {
            try {
                if (-not $Process.HasExited) {
                    try { $Process.Kill($true); $Result.kill_sent = $true }
                    catch { $Result.kill_error = $_.Exception.ToString() }
                    [void]$Process.WaitForExit(5000)
                }
                $Result.process_has_exited = $Process.HasExited
                if ($Result.process_has_exited) { $Result.exit_code = $Process.ExitCode }
            } catch { $Result.process_error = $_.Exception.ToString() }
        }
        $Process.Dispose()
        foreach ($Task in @($OutTask,$ErrTask)) {
            if ($null -ne $Task -and -not $Task.IsCompleted) {
                try { [void]$Task.Wait(1000) } catch { }
            }
        }
        if ($null -ne $OutTask) {
            $Result.stdout_complete = $OutTask.IsCompletedSuccessfully
            if ($OutTask.IsFaulted) { $Result.stdout_error = $OutTask.Exception.ToString() }
        }
        if ($null -ne $ErrTask) {
            $Result.stderr_complete = $ErrTask.IsCompletedSuccessfully
            if ($ErrTask.IsFaulted) { $Result.stderr_error = $ErrTask.Exception.ToString() }
        }
        try { $OutFile.Dispose() } catch { $Result.stdout_error = $_.Exception.ToString() }
        try { $ErrFile.Dispose() } catch { $Result.stderr_error = $_.Exception.ToString() }
        $Result.unreaped_after_kill = $Result.kill_sent -and -not $Result.process_has_exited
        $Result.stdout_bytes = (Get-Item -LiteralPath $OutPath).Length
        $Result.stderr_bytes = (Get-Item -LiteralPath $ErrPath).Length
        $Result.stdout_sha256 = if ($Result.stdout_complete) { Sha256 $OutPath } else { $null }
        $Result.stderr_sha256 = if ($Result.stderr_complete) { Sha256 $ErrPath } else { $null }
    }
    return $Result
}
$AttemptPath = Join-Path $Root 'ATTEMPT-USED.json'
$AttemptRedPath = Join-Path $Root 'ATTEMPT-RED.json'
if (-not (Test-Path -LiteralPath $GrantPath -PathType Leaf)) { throw 'NO_APPROVED_GRANT; B31_G2_NOT_STARTED' }
if (Test-Path -LiteralPath $AttemptPath) { throw 'ATTEMPT_ALREADY_EXISTS; NO_RETRY' }
if (Test-Path -LiteralPath $AttemptRedPath) { throw 'ATTEMPT_RED_ALREADY_EXISTS; NO_RETRY' }
$Child = $null; $HashProbe = $null; $AttemptMarkerSha = $null
$ClaimStream = $null; $Claimed = $false; $ClaimComplete = $false; $Phase = 'ATTEMPT_CLAIM'
try {
    $ClaimStream = [IO.FileStream]::new($AttemptPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $Claimed = $true
    $Marker = [ordered]@{state='ATTEMPT_USED_NO_RETRY';claim_version=2;claim_complete=$true;scope='B31_G2_13_STEP_ROLLBACK_ONLY';at_utc=[DateTimeOffset]::UtcNow.ToString('o');launcher_pid=$PID;grant_path=$GrantPath}
    $MarkerBytes = $Utf8.GetBytes(($Marker | ConvertTo-Json -Depth 15) + "`n")
    $ClaimStream.Write($MarkerBytes, 0, $MarkerBytes.Length)
    $ClaimStream.Flush($true)
    $ClaimStream.Dispose()
    $ClaimStream = $null
    $ClaimComplete = $true
    $AttemptMarkerSha = Sha256 $AttemptPath
    $MarkerReadback = Get-Content -LiteralPath $AttemptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Require ($MarkerReadback.claim_version -eq 2 -and $MarkerReadback.claim_complete -eq $true -and $MarkerReadback.scope -eq 'B31_G2_13_STEP_ROLLBACK_ONLY') 'ATTEMPT_MARKER_READBACK'
    $Phase = 'PREFLIGHT'
    Require ($args.Count -eq 0) 'NO_ARGUMENTS_ALLOWED'
    Require (-not (Test-Path -LiteralPath $LaunchRoot)) 'LAUNCH_01_ALREADY_EXISTS; NO_RETRY'
    Require (-not (Test-Path -LiteralPath $RunRoot)) 'RUN_01_ALREADY_EXISTS; NO_RETRY'
    [IO.Directory]::CreateDirectory($LaunchRoot) | Out-Null
    $Grant = Get-Content -LiteralPath $GrantPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Require ((Sha256 $PacketPath) -eq $Grant.packet_sha256) 'PACKET_CHANGED'
    $ExpectedPacketSha = $Grant.packet_sha256
    $Packet = Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $LaunchPacket = Get-Content -LiteralPath $LaunchPacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $LauncherSha = Sha256 $PSCommandPath
    $ActualShellPath = [IO.Path]::GetFullPath([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
    Require ($ActualShellPath -eq $ExpectedShellPath) 'LAUNCHER_SHELL_PATH'
    Require ((Sha256 $ActualShellPath) -eq $ExpectedShellSha) 'LAUNCHER_SHELL_HASH'
    Require ($PSVersionTable.PSVersion.ToString() -eq $ExpectedShellVersion -and $null -ne [Diagnostics.ProcessStartInfo].GetProperty('ArgumentList')) 'LAUNCHER_SHELL_API'
    Require ($Packet.launcher_shell.path -eq $ExpectedShellPath -and $Packet.launcher_shell.sha256 -eq $ExpectedShellSha -and $Packet.launcher_shell.version -eq $ExpectedShellVersion -and $Packet.launcher_shell.requires_process_start_info_argument_list -eq $true) 'PACKET_SHELL_BINDING'
    Require ((Sha256 $Packet.shell_probe.path) -eq $Packet.shell_probe.sha256) 'SHELL_PROBE_CHANGED'
    Require ((Sha256 $Packet.qa_shell_selftest.path) -eq $Packet.qa_shell_selftest.sha256) 'QA_SHELL_SELFTEST_CHANGED'
    Require ((Sha256 $Packet.previous_consumed_attempt.path) -eq $Packet.previous_consumed_attempt.sha256 -and (Sha256 $Packet.previous_consumed_attempt.shell_addendum_path) -eq $Packet.previous_consumed_attempt.shell_addendum_sha256) 'PREVIOUS_FAILURE_CHANGED'
    Require ($Packet.state -eq 'READY_FOR_B31_G2_ONE_SHOT_GRANT' -and $Packet.scope -eq 'B31_G2_13_STEP_ROLLBACK_ONLY' -and $Packet.attempt_claim_version -eq 2) 'PACKET_SCOPE'
    Require ($Packet.runner_path -eq $RunnerPath -and $Packet.run_root -eq $RunRoot -and $Packet.runner_sha256 -eq $ExpectedRunnerSha -and $Packet.attempt_marker_path -eq $AttemptPath -and $Packet.launcher_path -eq $PSCommandPath -and $Packet.launch_packet_path -eq $LaunchPacketPath) 'PACKET_PATHS'
    Require ($Grant.state -eq 'APPROVED_SINGLE_RUN' -and $Grant.approved_by -eq 'MGR02' -and $Grant.mgr01_scope_reviewed -eq $true) 'GRANT_OWNER'
    Require ($Grant.scope -eq $Packet.scope -and $Grant.one_shot_run -eq 'run-01' -and $Grant.launcher_one_shot -eq 'launch-01') 'GRANT_SCOPE'
    Require ($Grant.no_provider_approved -eq $true -and $Grant.allowed_writes_approved -eq $true -and $Grant.clean_environment_approved -eq $true) 'GRANT_BOUNDARIES'
    Require ($Grant.packet_sha256 -eq $ExpectedPacketSha -and $Grant.runner_sha256 -eq $ExpectedRunnerSha -and $Grant.launcher_sha256 -eq $LauncherSha -and $Grant.launcher_shell_path -eq $ExpectedShellPath -and $Grant.launcher_shell_sha256 -eq $ExpectedShellSha) 'GRANT_EXECUTABLE_HASHES'
    Require ((Sha256 $LaunchPacketPath) -eq $Grant.launch_packet_sha256) 'LAUNCH_PACKET_CHANGED'
    Require ($LaunchPacket.packet_sha256 -eq $ExpectedPacketSha -and $LaunchPacket.runner_sha256 -eq $ExpectedRunnerSha -and $LaunchPacket.launcher_sha256 -eq $LauncherSha -and $LaunchPacket.profile_path -eq $ProfileRoot -and $LaunchPacket.launch_evidence_root -eq $LaunchRoot -and $LaunchPacket.attempt_marker_path -eq $AttemptPath -and $LaunchPacket.g1_receipt_sha256 -eq $Grant.g1_receipt_sha256 -and $LaunchPacket.launcher_shell_path -eq $ExpectedShellPath -and $LaunchPacket.launcher_shell_sha256 -eq $ExpectedShellSha -and $LaunchPacket.launcher_shell_version -eq $ExpectedShellVersion) 'LAUNCH_PACKET_BINDING'
    Require (Test-Path -LiteralPath $Packet.g1_receipt.path -PathType Leaf) 'G1_PASS_MISSING'
    Require ((Sha256 $Packet.g1_receipt.path) -eq $Grant.g1_receipt_sha256 -and $Grant.g1_receipt_sha256 -eq $Packet.g1_receipt.sha256) 'G1_RECEIPT_NOT_GRANTED'
    $G1 = Get-Content -LiteralPath $Packet.g1_receipt.path -Raw -Encoding UTF8 | ConvertFrom-Json
    Require ($G1.state -eq 'PASS_B31_G1_EMPTY_AND_V30_MIGRATION_ONLY' -and $G1.packet_sha256 -eq $Packet.g1_packet_sha256) 'G1_STATE'
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
    $HashProbe = InvokeHidden $HashInfo 30000 'HASH'
    WriteJsonOnce (Join-Path $LaunchRoot 'HASH-EXIT.json') $HashProbe
    Require ($HashProbe.process_has_exited -and $HashProbe.stdout_complete -and $HashProbe.stderr_complete -and -not $HashProbe.timed_out -and $null -eq $HashProbe.process_error -and $null -eq $HashProbe.stream_wait_error -and $HashProbe.exit_code -eq 0 -and $HashProbe.stderr_bytes -eq 0) 'HASH_PROBE_RED_OR_INCOMPLETE'
    Require (([IO.File]::ReadAllText($HashProbe.stdout_path,[Text.Encoding]::UTF8).Trim()) -eq $ExpectedRunnerSha) 'RUNNER_CHANGED'
    Require (@(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse).Count -eq 4) 'PROFILE_CHANGED_BY_HASH_PROBE'
    $Info = [Diagnostics.ProcessStartInfo]::new()
    $Info.FileName = $Packet.python_path; $Info.WorkingDirectory = $Root; $Info.UseShellExecute = $false; $Info.CreateNoWindow = $true; $Info.RedirectStandardOutput = $true; $Info.RedirectStandardError = $true
    foreach ($Arg in @('-I','-B',$RunnerPath)) { $Info.ArgumentList.Add($Arg) }
    $Info.Environment.Clear(); foreach ($Entry in $CleanEnv.GetEnumerator()) { $Info.Environment[$Entry.Key] = $Entry.Value }
    Require (@($Info.Environment.Keys).Count -eq 8) 'ENV_COUNT'
    [IO.Directory]::CreateDirectory($RunRoot) | Out-Null
    WriteJsonOnce (Join-Path $LaunchRoot 'PREPARED.json') ([ordered]@{at_utc=[DateTimeOffset]::UtcNow.ToString('o');approval_id=$Grant.approval_id;grant_sha256=(Sha256 $GrantPath);attempt_marker_sha256=$AttemptMarkerSha;g1_receipt_sha256=$Grant.g1_receipt_sha256;packet_sha256=$ExpectedPacketSha;runner_sha256=$ExpectedRunnerSha;launcher_sha256=$LauncherSha;launcher_shell_path=$ActualShellPath;launcher_shell_sha256=$ExpectedShellSha;launcher_shell_version=$ExpectedShellVersion;launch_packet_sha256=(Sha256 $LaunchPacketPath);hash_probe=$HashProbe;command=@($Info.FileName,'-I','-B',$RunnerPath);environment=$CleanEnv;profile_files=0})
    $Phase = 'G2_CHILD'
    $Child = InvokeHidden $Info 180000 'G2'
    WriteJsonOnce (Join-Path $LaunchRoot 'PROCESS-OBSERVED.json') ([ordered]@{observed_at_utc=[DateTimeOffset]::UtcNow.ToString('o');pid=$Child.pid;process_has_exited=$Child.process_has_exited;approval_id=$Grant.approval_id})
    $ProfileAfter = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
    $Files = @($ProfileAfter | Where-Object { -not $_.PSIsContainer }).Count
    $Links = @($ProfileAfter | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count
    WriteJsonOnce (Join-Path $LaunchRoot 'EXIT.json') ([ordered]@{at_utc=[DateTimeOffset]::UtcNow.ToString('o');child=$Child;receipt_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RECEIPT.json'));red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RED.json'));post_profile_file_count=$Files;post_profile_link_count=$Links;post_profile_dir_count=@($ProfileAfter | Where-Object { $_.PSIsContainer }).Count})
    Require ($Files -eq 0 -and $Links -eq 0 -and $ProfileAfter.Count -eq 4) 'PROFILE_POST'
    Require ($Child.process_has_exited -and $Child.stdout_complete -and $Child.stderr_complete -and -not $Child.timed_out -and $null -eq $Child.process_error -and $null -eq $Child.stream_wait_error -and $Child.exit_code -eq 0 -and $Child.stderr_bytes -eq 0) 'B31_G2_RED_OR_INCOMPLETE'
    Write-Output 'B31_G2_LAUNCH_EXIT_ZERO; REVIEW_RUN_RECEIPT'
} catch {
    $OriginalError = $_.Exception.ToString()
    if ($null -ne $ClaimStream) { try { $ClaimStream.Dispose() } catch { [Console]::Error.WriteLine('CLAIM_CLOSE_FAILED ' + $_.Exception.ToString()) } }
    $Red = [ordered]@{state='RED_STOP_NO_RETRY';at_utc=[DateTimeOffset]::UtcNow.ToString('o');phase=$Phase;marker_claimed=$Claimed;marker_complete=$ClaimComplete;attempt_marker_sha256=$AttemptMarkerSha;error=$OriginalError}
    try { WriteJsonOnce $AttemptRedPath $Red } catch { [Console]::Error.WriteLine('ATTEMPT_RED_WRITE_FAILED ' + $_.Exception.ToString()) }
    try {
        if (Test-Path -LiteralPath $LaunchRoot -PathType Container) {
            $LaunchRed = [ordered]@{state='RED_STOP_NO_RETRY';at_utc=[DateTimeOffset]::UtcNow.ToString('o');phase=$Phase;error=$OriginalError;hash_probe=$HashProbe;child=$Child;receipt_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RECEIPT.json'));red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RED.json'))}
            WriteJsonOnce (Join-Path $LaunchRoot 'RED.json') $LaunchRed
        }
    } catch { [Console]::Error.WriteLine('LAUNCH_RED_WRITE_FAILED ' + $_.Exception.ToString()) }
    throw
}
