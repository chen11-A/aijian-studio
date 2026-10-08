$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath))
$PacketPath = Join-Path $Root 'PACKET.json'
$LaunchPacketPath = Join-Path $Root 'LAUNCH-PACKET.json'
$RunnerPath = Join-Path $Root 'g1_once.py'
$SeedRunnerPath = Join-Path $Root 'seed_v30_once.py'
$ExpectedSeedRunnerSha = 'AAE4649B081982283F27551830577C38F6104034FF2A96A97FEB0A717D421F11'
$GrantPath = Join-Path $Root 'GRANT.json'
$ProfileRoot = Join-Path $Root 'profile-01'
$LaunchRoot = Join-Path $Root 'launch-01'
$RunRoot = Join-Path $Root 'run-01'
$ExpectedPacketSha = '15E432BB60E4BA50B2F751304FDF4D4A5E858FF650BBA9683ECFC8778B0852E2'
$ExpectedRunnerSha = 'F7CF26F3F1108D2E94362E52CF0A75084B5D9DE4876A1F0A5156AF8CD0124374'
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
function MakeInfo([string]$ScriptPath, [bool]$HashOnly) {
    $Info = [Diagnostics.ProcessStartInfo]::new()
    $Info.FileName = $Packet.python_path
    $Info.WorkingDirectory = $Root
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true
    $Info.RedirectStandardOutput = $true
    $Info.RedirectStandardError = $true
    $Info.ArgumentList.Add('-I'); $Info.ArgumentList.Add('-B')
    if ($HashOnly) {
        $Info.ArgumentList.Add('-c')
        $Info.ArgumentList.Add('import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest().upper())')
    }
    $Info.ArgumentList.Add($ScriptPath)
    $Info.Environment.Clear()
    foreach ($Entry in $CleanEnv.GetEnumerator()) { $Info.Environment[$Entry.Key] = $Entry.Value }
    Require (@($Info.Environment.Keys).Count -eq 8) 'ENV_KEY_COUNT'
    return $Info
}
$AttemptPath = Join-Path $Root 'ATTEMPT-USED.json'
$AttemptRedPath = Join-Path $Root 'ATTEMPT-RED.json'
if (-not (Test-Path -LiteralPath $GrantPath -PathType Leaf)) { throw 'NO_APPROVED_GRANT; B31_G1_NOT_STARTED' }
WriteJsonOnce $AttemptPath ([ordered]@{state='ATTEMPT_USED_NO_RETRY';scope='B31_G1_EMPTY_AND_V30_MIGRATION_EXACT3';at_utc=[DateTimeOffset]::UtcNow.ToString('o');launcher_pid=$PID;grant_path=$GrantPath})
$SeedChild = $null; $G1Child = $null; $SeedHash = $null; $G1Hash = $null; $AttemptMarkerSha = $null
try {
    $AttemptMarkerSha = Sha256 $AttemptPath
    Require ($args.Count -eq 0) 'NO_ARGUMENTS_ALLOWED'
    Require (-not (Test-Path -LiteralPath $LaunchRoot)) 'LAUNCH_01_ALREADY_EXISTS; NO_RETRY'
    Require (-not (Test-Path -LiteralPath $RunRoot)) 'RUN_01_ALREADY_EXISTS; NO_RETRY'
    [IO.Directory]::CreateDirectory($LaunchRoot) | Out-Null
    Require ((Sha256 $PacketPath) -eq $ExpectedPacketSha) 'PACKET_CHANGED'
    $Packet = Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $Grant = Get-Content -LiteralPath $GrantPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $LaunchPacket = Get-Content -LiteralPath $LaunchPacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $LauncherSha = Sha256 $PSCommandPath
    Require ($Packet.state -eq 'READY_FOR_B31_G1_ONE_SHOT_GRANT_CONDITIONAL_G0_PASS' -and $Packet.scope -eq 'B31_G1_EMPTY_AND_V30_MIGRATION_EXACT3') 'PACKET_SCOPE'
    Require ($Packet.runner_path -eq $RunnerPath -and $Packet.seed_runner_path -eq $SeedRunnerPath -and $Packet.run_root -eq $RunRoot -and $Packet.runner_sha256 -eq $ExpectedRunnerSha -and $Packet.seed_runner_sha256 -eq $ExpectedSeedRunnerSha -and $Packet.attempt_marker_path -eq $AttemptPath -and $Packet.launcher_path -eq $PSCommandPath -and $Packet.launch_packet_path -eq $LaunchPacketPath) 'PACKET_PATHS'
    Require ($Grant.state -eq 'APPROVED_SINGLE_RUN' -and $Grant.approved_by -eq 'MGR02' -and $Grant.mgr01_scope_reviewed -eq $true -and $Grant.scope -eq $Packet.scope -and $Grant.one_shot_run -eq 'run-01' -and $Grant.launcher_one_shot -eq 'launch-01') 'GRANT_OWNER_SCOPE'
    Require ($Grant.no_provider_approved -eq $true -and $Grant.allowed_writes_approved -eq $true -and $Grant.clean_environment_approved -eq $true) 'GRANT_BOUNDARIES'
    Require ($Grant.packet_sha256 -eq $ExpectedPacketSha -and $Grant.runner_sha256 -eq $ExpectedRunnerSha -and $Grant.seed_runner_sha256 -eq $ExpectedSeedRunnerSha -and $Grant.launcher_sha256 -eq $LauncherSha) 'GRANT_EXECUTABLE_HASHES'
    Require ((Sha256 $LaunchPacketPath) -eq $Grant.launch_packet_sha256) 'LAUNCH_PACKET_CHANGED'
    Require ($LaunchPacket.packet_sha256 -eq $ExpectedPacketSha -and $LaunchPacket.runner_sha256 -eq $ExpectedRunnerSha -and $LaunchPacket.seed_runner_sha256 -eq $ExpectedSeedRunnerSha -and $LaunchPacket.launcher_sha256 -eq $LauncherSha -and $LaunchPacket.profile_path -eq $ProfileRoot -and $LaunchPacket.launch_evidence_root -eq $LaunchRoot -and $LaunchPacket.attempt_marker_path -eq $AttemptPath) 'LAUNCH_PACKET_BINDING'
    Require (Test-Path -LiteralPath $Packet.g0_receipt_path -PathType Leaf) 'G0_PASS_MISSING'
    Require ((Sha256 $Packet.g0_receipt_path) -eq $Grant.g0_receipt_sha256) 'G0_RECEIPT_NOT_GRANTED'
    $G0 = Get-Content -LiteralPath $Packet.g0_receipt_path -Raw -Encoding UTF8 | ConvertFrom-Json
    Require ($G0.state -eq 'PASS_B31_G0_CONSUMER_IDENTITY_IMPORT_ONLY' -and $G0.packet_sha256 -eq $Packet.g0_packet.sha256) 'G0_STATE'
    Require ((Sha256 $Packet.python_path) -eq $Packet.python_sha256) 'PYTHON_CHANGED'
    $ProfileItems = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
    Require ($ProfileItems.Count -eq 4 -and @($ProfileItems | Where-Object { -not $_.PSIsContainer }).Count -eq 0 -and @($ProfileItems | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -eq 0) 'PROFILE_PRE'
    $WindowsRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
    $CleanEnv = [ordered]@{SYSTEMROOT=$WindowsRoot;WINDIR=$WindowsRoot;USERPROFILE=$ProfileRoot;APPDATA=(Join-Path $ProfileRoot 'AppData\Roaming');LOCALAPPDATA=(Join-Path $ProfileRoot 'AppData\Local');TEMP=(Join-Path $ProfileRoot 'Temp');TMP=(Join-Path $ProfileRoot 'Temp');HOME=$ProfileRoot}
    $SeedHash = InvokeHidden (MakeInfo $SeedRunnerPath $true) 30000 'HASH-SEED'
    WriteJsonOnce (Join-Path $LaunchRoot 'HASH-SEED-EXIT.json') $SeedHash
    Require ($SeedHash.process_has_exited -and $SeedHash.stdout_complete -and $SeedHash.stderr_complete -and -not $SeedHash.timed_out -and $null -eq $SeedHash.process_error -and $null -eq $SeedHash.stream_wait_error -and $SeedHash.exit_code -eq 0 -and $SeedHash.stderr_bytes -eq 0) 'SEED_HASH_PROBE_RED_OR_INCOMPLETE'
    Require (([IO.File]::ReadAllText($SeedHash.stdout_path,[Text.Encoding]::UTF8).Trim()) -eq $ExpectedSeedRunnerSha) 'SEED_RUNNER_CHANGED'
    $G1Hash = InvokeHidden (MakeInfo $RunnerPath $true) 30000 'HASH-G1'
    WriteJsonOnce (Join-Path $LaunchRoot 'HASH-G1-EXIT.json') $G1Hash
    Require ($G1Hash.process_has_exited -and $G1Hash.stdout_complete -and $G1Hash.stderr_complete -and -not $G1Hash.timed_out -and $null -eq $G1Hash.process_error -and $null -eq $G1Hash.stream_wait_error -and $G1Hash.exit_code -eq 0 -and $G1Hash.stderr_bytes -eq 0) 'G1_HASH_PROBE_RED_OR_INCOMPLETE'
    Require (([IO.File]::ReadAllText($G1Hash.stdout_path,[Text.Encoding]::UTF8).Trim()) -eq $ExpectedRunnerSha) 'G1_RUNNER_CHANGED'
    $ProfileAfterHash = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
    Require ($ProfileAfterHash.Count -eq 4 -and @($ProfileAfterHash | Where-Object { -not $_.PSIsContainer }).Count -eq 0) 'HASH_PROBE_PROFILE_CHANGED'
    [IO.Directory]::CreateDirectory($RunRoot) | Out-Null
    WriteJsonOnce (Join-Path $LaunchRoot 'PREPARED.json') ([ordered]@{at_utc=[DateTimeOffset]::UtcNow.ToString('o');approval_id=$Grant.approval_id;grant_sha256=(Sha256 $GrantPath);attempt_marker_sha256=$AttemptMarkerSha;packet_sha256=$ExpectedPacketSha;runner_sha256=$ExpectedRunnerSha;seed_runner_sha256=$ExpectedSeedRunnerSha;launcher_sha256=$LauncherSha;launch_packet_sha256=(Sha256 $LaunchPacketPath);g0_receipt_sha256=$Grant.g0_receipt_sha256;seed_hash_probe=$SeedHash;g1_hash_probe=$G1Hash;environment=$CleanEnv;child_order=@($SeedRunnerPath,$RunnerPath);profile_files=0})
    $SeedChild = InvokeHidden (MakeInfo $SeedRunnerPath $false) 180000 'SEED'
    WriteJsonOnce (Join-Path $LaunchRoot 'SEED-EXIT.json') ([ordered]@{at_utc=[DateTimeOffset]::UtcNow.ToString('o');child=$SeedChild;seed_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'SEED.json'));red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'SEED-RED.json'))})
    Require ($SeedChild.process_has_exited -and $SeedChild.stdout_complete -and $SeedChild.stderr_complete -and -not $SeedChild.timed_out -and $null -eq $SeedChild.process_error -and $null -eq $SeedChild.stream_wait_error -and $SeedChild.exit_code -eq 0 -and $SeedChild.stderr_bytes -eq 0 -and (Test-Path -LiteralPath (Join-Path $RunRoot 'SEED.json'))) 'B31_G1_SEED_RED_OR_INCOMPLETE_STOP'
    $G1Child = InvokeHidden (MakeInfo $RunnerPath $false) 180000 'G1'
    $ProfileAfter = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
    $Files = @($ProfileAfter | Where-Object { -not $_.PSIsContainer }).Count
    $Links = @($ProfileAfter | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count
    WriteJsonOnce (Join-Path $LaunchRoot 'EXIT.json') ([ordered]@{at_utc=[DateTimeOffset]::UtcNow.ToString('o');seed_child=$SeedChild;child=$G1Child;receipt_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RECEIPT.json'));red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RED.json'));post_profile_file_count=$Files;post_profile_link_count=$Links;post_profile_dir_count=@($ProfileAfter | Where-Object { $_.PSIsContainer }).Count})
    Require ($Files -eq 0 -and $Links -eq 0 -and $ProfileAfter.Count -eq 4) 'PROFILE_POST'
    Require ($G1Child.process_has_exited -and $G1Child.stdout_complete -and $G1Child.stderr_complete -and -not $G1Child.timed_out -and $null -eq $G1Child.process_error -and $null -eq $G1Child.stream_wait_error -and $G1Child.exit_code -eq 0 -and $G1Child.stderr_bytes -eq 0) 'B31_G1_RED_OR_INCOMPLETE'
    Write-Output 'B31_G1_LAUNCH_EXIT_ZERO; REVIEW_RUN_RECEIPT'
} catch {
    $Red = [ordered]@{state='RED_STOP_NO_RETRY';at_utc=[DateTimeOffset]::UtcNow.ToString('o');attempt_marker_sha256=$AttemptMarkerSha;error=$_.Exception.ToString();seed_hash_probe=$SeedHash;g1_hash_probe=$G1Hash;seed_child=$SeedChild;g1_child=$G1Child;seed_red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'SEED-RED.json'));g1_red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RED.json'));receipt_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RECEIPT.json'))}
    try { WriteJsonOnce $AttemptRedPath $Red } catch { [Console]::Error.WriteLine('ATTEMPT_RED_WRITE_FAILED ' + $_.Exception.Message) }
    if (Test-Path -LiteralPath $LaunchRoot -PathType Container) { try { WriteJsonOnce (Join-Path $LaunchRoot 'RED.json') $Red } catch { [Console]::Error.WriteLine('LAUNCH_RED_WRITE_FAILED ' + $_.Exception.Message) } }
    throw
}
