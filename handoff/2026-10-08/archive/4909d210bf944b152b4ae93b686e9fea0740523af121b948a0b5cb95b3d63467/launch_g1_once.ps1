$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath))
$PacketPath = Join-Path $Root 'PACKET.json'
$LaunchPacketPath = Join-Path $Root 'LAUNCH-PACKET.json'
$RunnerPath = Join-Path $Root 'g1_once.py'
$SeedRunnerPath = Join-Path $Root 'seed_v30_once.py'
$ExpectedSeedRunnerSha = 'FA3D7D4F70E694D27B52DD219C4603F896A91126E5274F3C362953E89BE03A38'
$GrantPath = Join-Path $Root 'GRANT.json'
$ProfileRoot = Join-Path $Root 'profile-01'
$LaunchRoot = Join-Path $Root 'launch-01'
$RunRoot = Join-Path $Root 'run-01'
$ExpectedPacketSha = '4A6C5059F4C2C7800DD0E843EA3B1C1519EEDBB3EB69CFC870874A1ECADB6526'
$ExpectedRunnerSha = '73C20A3495C1772611AEAD2253BC19179895BEAC9E82212347D9EA2482A6C939'
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
Require ($args.Count -eq 0) 'NO_ARGUMENTS_ALLOWED'
Require (Test-Path -LiteralPath $GrantPath -PathType Leaf) 'NO_APPROVED_GRANT; B31_G1_NOT_STARTED'
Require (-not (Test-Path -LiteralPath $LaunchRoot)) 'LAUNCH_01_ALREADY_EXISTS; NO_RETRY'
Require (-not (Test-Path -LiteralPath $RunRoot)) 'RUN_01_ALREADY_EXISTS; NO_RETRY'
Require ((Sha256 $PacketPath) -eq $ExpectedPacketSha) 'PACKET_CHANGED'
$Packet = Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Grant = Get-Content -LiteralPath $GrantPath -Raw -Encoding UTF8 | ConvertFrom-Json
$LaunchPacket = Get-Content -LiteralPath $LaunchPacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
$LauncherSha = Sha256 $PSCommandPath
Require ($Packet.state -eq 'READY_FOR_B31_G1_ONE_SHOT_GRANT_CONDITIONAL_G0_PASS' -and $Packet.scope -eq 'B31_G1_EMPTY_AND_V30_MIGRATION_EXACT3') 'PACKET_SCOPE'
Require ($Packet.runner_path -eq $RunnerPath -and $Packet.seed_runner_path -eq $SeedRunnerPath -and $Packet.run_root -eq $RunRoot -and $Packet.runner_sha256 -eq $ExpectedRunnerSha -and $Packet.seed_runner_sha256 -eq $ExpectedSeedRunnerSha) 'PACKET_PATHS'
Require ($Grant.state -eq 'APPROVED_SINGLE_RUN' -and $Grant.approved_by -eq 'MGR02' -and $Grant.mgr01_scope_reviewed -eq $true -and $Grant.scope -eq $Packet.scope -and $Grant.one_shot_run -eq 'run-01' -and $Grant.launcher_one_shot -eq 'launch-01') 'GRANT_OWNER_SCOPE'
Require ($Grant.no_provider_approved -eq $true -and $Grant.allowed_writes_approved -eq $true -and $Grant.clean_environment_approved -eq $true) 'GRANT_BOUNDARIES'
Require ($Grant.packet_sha256 -eq $ExpectedPacketSha -and $Grant.runner_sha256 -eq $ExpectedRunnerSha -and $Grant.seed_runner_sha256 -eq $ExpectedSeedRunnerSha -and $Grant.launcher_sha256 -eq $LauncherSha) 'GRANT_EXECUTABLE_HASHES'
Require ((Sha256 $LaunchPacketPath) -eq $Grant.launch_packet_sha256) 'LAUNCH_PACKET_CHANGED'
Require ($LaunchPacket.packet_sha256 -eq $ExpectedPacketSha -and $LaunchPacket.runner_sha256 -eq $ExpectedRunnerSha -and $LaunchPacket.seed_runner_sha256 -eq $ExpectedSeedRunnerSha -and $LaunchPacket.launcher_sha256 -eq $LauncherSha -and $LaunchPacket.profile_path -eq $ProfileRoot -and $LaunchPacket.launch_evidence_root -eq $LaunchRoot) 'LAUNCH_PACKET_BINDING'
Require (Test-Path -LiteralPath $Packet.g0_receipt_path -PathType Leaf) 'G0_PASS_MISSING'
Require ((Sha256 $Packet.g0_receipt_path) -eq $Grant.g0_receipt_sha256) 'G0_RECEIPT_NOT_GRANTED'
$G0 = Get-Content -LiteralPath $Packet.g0_receipt_path -Raw -Encoding UTF8 | ConvertFrom-Json
Require ($G0.state -eq 'PASS_B31_G0_CONSUMER_IDENTITY_IMPORT_ONLY' -and $G0.packet_sha256 -eq $Packet.g0_packet.sha256) 'G0_STATE'
Require ((Sha256 $Packet.python_path) -eq $Packet.python_sha256) 'PYTHON_CHANGED'
$ProfileItems = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
Require ($ProfileItems.Count -eq 4 -and @($ProfileItems | Where-Object { -not $_.PSIsContainer }).Count -eq 0 -and @($ProfileItems | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -eq 0) 'PROFILE_PRE'
$WindowsRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
$CleanEnv = [ordered]@{SYSTEMROOT=$WindowsRoot;WINDIR=$WindowsRoot;USERPROFILE=$ProfileRoot;APPDATA=(Join-Path $ProfileRoot 'AppData\Roaming');LOCALAPPDATA=(Join-Path $ProfileRoot 'AppData\Local');TEMP=(Join-Path $ProfileRoot 'Temp');TMP=(Join-Path $ProfileRoot 'Temp');HOME=$ProfileRoot}
$SeedHash = InvokeHidden (MakeInfo $SeedRunnerPath $true) 30000
$G1Hash = InvokeHidden (MakeInfo $RunnerPath $true) 30000
Require (-not $SeedHash.timed_out -and $SeedHash.exit_code -eq 0 -and [string]::IsNullOrEmpty($SeedHash.stderr) -and $SeedHash.stdout.Trim() -eq $ExpectedSeedRunnerSha) 'SEED_RUNNER_HASH_RED'
Require (-not $G1Hash.timed_out -and $G1Hash.exit_code -eq 0 -and [string]::IsNullOrEmpty($G1Hash.stderr) -and $G1Hash.stdout.Trim() -eq $ExpectedRunnerSha) 'G1_RUNNER_HASH_RED'
$ProfileAfterHash = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
Require ($ProfileAfterHash.Count -eq 4 -and @($ProfileAfterHash | Where-Object { -not $_.PSIsContainer }).Count -eq 0) 'HASH_PROBE_PROFILE_CHANGED'
[IO.Directory]::CreateDirectory($LaunchRoot) | Out-Null
[IO.Directory]::CreateDirectory($RunRoot) | Out-Null
WriteJsonOnce (Join-Path $LaunchRoot 'PREPARED.json') ([ordered]@{at_utc=[DateTimeOffset]::UtcNow.ToString('o');approval_id=$Grant.approval_id;grant_sha256=(Sha256 $GrantPath);packet_sha256=$ExpectedPacketSha;runner_sha256=$ExpectedRunnerSha;seed_runner_sha256=$ExpectedSeedRunnerSha;launcher_sha256=$LauncherSha;launch_packet_sha256=(Sha256 $LaunchPacketPath);g0_receipt_sha256=$Grant.g0_receipt_sha256;seed_hash_probe=$SeedHash;g1_hash_probe=$G1Hash;environment=$CleanEnv;child_order=@($SeedRunnerPath,$RunnerPath);profile_files=0})
$SeedChild = $null
$G1Child = $null
try {
    $SeedChild = InvokeHidden (MakeInfo $SeedRunnerPath $false) 180000
    WriteTextOnce (Join-Path $LaunchRoot 'SEED-STDOUT.txt') $SeedChild.stdout
    WriteTextOnce (Join-Path $LaunchRoot 'SEED-STDERR.txt') $SeedChild.stderr
    WriteJsonOnce (Join-Path $LaunchRoot 'SEED-EXIT.json') ([ordered]@{at_utc=[DateTimeOffset]::UtcNow.ToString('o');pid=$SeedChild.pid;exit_code=$SeedChild.exit_code;timed_out=$SeedChild.timed_out;process_has_exited=$SeedChild.process_has_exited;stdout_sha256=(Sha256 (Join-Path $LaunchRoot 'SEED-STDOUT.txt'));stderr_sha256=(Sha256 (Join-Path $LaunchRoot 'SEED-STDERR.txt'));seed_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'SEED.json'));red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'SEED-RED.json'))})
    Require (-not $SeedChild.timed_out -and $SeedChild.exit_code -eq 0 -and (Test-Path -LiteralPath (Join-Path $RunRoot 'SEED.json'))) 'B31_G1_SEED_RED_STOP'
    $G1Child = InvokeHidden (MakeInfo $RunnerPath $false) 180000
    WriteTextOnce (Join-Path $LaunchRoot 'G1-STDOUT.txt') $G1Child.stdout
    WriteTextOnce (Join-Path $LaunchRoot 'G1-STDERR.txt') $G1Child.stderr
    $ProfileAfter = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
    $Files = @($ProfileAfter | Where-Object { -not $_.PSIsContainer }).Count
    $Links = @($ProfileAfter | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count
    WriteJsonOnce (Join-Path $LaunchRoot 'EXIT.json') ([ordered]@{at_utc=[DateTimeOffset]::UtcNow.ToString('o');seed_pid=$SeedChild.pid;pid=$G1Child.pid;exit_code=$G1Child.exit_code;timed_out=$G1Child.timed_out;process_has_exited=$G1Child.process_has_exited;pid_still_present_after_exit=($null -ne (Get-Process -Id $G1Child.pid -ErrorAction SilentlyContinue));stdout_sha256=(Sha256 (Join-Path $LaunchRoot 'G1-STDOUT.txt'));stderr_sha256=(Sha256 (Join-Path $LaunchRoot 'G1-STDERR.txt'));receipt_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RECEIPT.json'));red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RED.json'));post_profile_file_count=$Files;post_profile_link_count=$Links;post_profile_dir_count=@($ProfileAfter | Where-Object { $_.PSIsContainer }).Count})
    Require ($Files -eq 0 -and $Links -eq 0 -and $ProfileAfter.Count -eq 4) 'PROFILE_POST'
    Require (-not $G1Child.timed_out -and $G1Child.exit_code -eq 0) 'B31_G1_RED_STOP'
    Write-Output 'B31_G1_LAUNCH_EXIT_ZERO; REVIEW_RUN_RECEIPT'
} catch {
    $Red = [ordered]@{state='RED_STOP_NO_RETRY';at_utc=[DateTimeOffset]::UtcNow.ToString('o');seed_pid=if($null -eq $SeedChild){$null}else{$SeedChild.pid};g1_pid=if($null -eq $G1Child){$null}else{$G1Child.pid};error=$_.Exception.ToString();seed_red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'SEED-RED.json'));g1_red_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RED.json'));receipt_present=(Test-Path -LiteralPath (Join-Path $RunRoot 'RECEIPT.json'))}
    try { WriteJsonOnce (Join-Path $LaunchRoot 'RED.json') $Red } catch { Write-Error ('RED_EVIDENCE_WRITE_FAILED ' + $_.Exception.Message) }
    throw
}