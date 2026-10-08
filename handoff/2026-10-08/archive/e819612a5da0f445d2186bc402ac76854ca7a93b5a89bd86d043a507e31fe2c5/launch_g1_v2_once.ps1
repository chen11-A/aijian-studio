$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath))
$PacketPath = Join-Path $Root 'PACKET-02.json'
$RunnerPath = Join-Path $Root 'g1_v2_once.py'
$GrantPath = Join-Path $Root 'GRANT-02.json'
$ProfileRoot = Join-Path $Root 'profile-02'
$LaunchRoot = Join-Path $Root 'launch-02'
$RunRoot = Join-Path $Root 'run-02'
$ExpectedPacketSha = '85BD6B5258526455C326F981767E4B68178FC3CD4A4E8C8A970F8750D6F21A50'
$ExpectedRunnerSha = '5F1D7F05536CCD1E9D5E0CAF8E32CF30F5B5317FDE12A784699CF3C6A07D120B'
$Utf8 = [Text.UTF8Encoding]::new($false)

function Require([bool]$Condition, [string]$Reason) {
    if (-not $Condition) { throw $Reason }
}

function Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Sha256Python([string]$PythonPath, [string]$Path) {
    $Digest = & $PythonPath -I -B -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest().upper())' $Path
    Require ($LASTEXITCODE -eq 0 -and $Digest -match '^[A-F0-9]{64}$') 'PYTHON_HASH_FAILED'
    return $Digest
}

function WriteTextOnce([string]$Path, [string]$Value) {
    $Stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $Bytes = $Utf8.GetBytes($Value)
        $Stream.Write($Bytes, 0, $Bytes.Length)
        $Stream.Flush($true)
    } finally {
        $Stream.Dispose()
    }
}

function WriteJsonOnce([string]$Path, [object]$Value) {
    WriteTextOnce $Path (($Value | ConvertTo-Json -Depth 15) + "`n")
}

Require ($args.Count -eq 0) 'NO_ARGUMENTS_ALLOWED'
Require (Test-Path -LiteralPath $GrantPath -PathType Leaf) 'NO_APPROVED_GRANT; G1_NOT_STARTED'
Require (-not (Test-Path -LiteralPath $LaunchRoot)) 'LAUNCH_02_ALREADY_EXISTS; NO_RETRY'
Require (-not (Test-Path -LiteralPath $RunRoot)) 'RUN_02_ALREADY_EXISTS; NO_RETRY'
Require ((Sha256 $PacketPath) -eq $ExpectedPacketSha) 'PACKET_CHANGED'
$Packet = Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
Require ((Sha256 $Packet.python_path) -eq $Packet.python_sha256) 'PYTHON_CHANGED'
Require ((Sha256Python $Packet.python_path $RunnerPath) -eq $ExpectedRunnerSha) 'RUNNER_CHANGED'
$Grant = Get-Content -LiteralPath $GrantPath -Raw -Encoding UTF8 | ConvertFrom-Json
$LauncherSha = Sha256 $PSCommandPath
Require ($Packet.state -eq 'READY_FOR_G1_ONE_SHOT_GRANT') 'PACKET_NOT_READY'
Require ($Packet.scope -eq 'CORE153_G1_REPO30_CURRENT_COMBINATION_V2') 'PACKET_SCOPE'
Require ($Packet.runner_path -eq $RunnerPath -and $Packet.run_root -eq $RunRoot) 'PACKET_PATHS'
Require ($Packet.runner_sha256 -eq $ExpectedRunnerSha) 'PACKET_RUNNER_HASH'
Require ($Grant.state -eq 'APPROVED_SINGLE_RUN' -and $Grant.approved_by -eq 'MGR02' -and $Grant.mgr01_scope_reviewed -eq $true) 'GRANT_OWNER'
Require ($Grant.scope -eq $Packet.scope -and $Grant.one_shot_run -eq 'run-02' -and $Grant.launcher_one_shot -eq 'launch-02') 'GRANT_SCOPE'
Require (-not [string]::IsNullOrWhiteSpace($Grant.approval_id)) 'GRANT_ID'
Require ($Grant.no_provider_approved -eq $true -and $Grant.historical_evidence_reuse_approved -eq $true -and $Grant.allowed_writes_approved -eq $true -and $Grant.clean_environment_approved -eq $true) 'GRANT_BOUNDARIES'
Require ($Grant.packet_sha256 -eq $ExpectedPacketSha -and $Grant.runner_sha256 -eq $ExpectedRunnerSha -and $Grant.launcher_sha256 -eq $LauncherSha) 'GRANT_EXECUTABLE_HASHES'
Require ($Grant.prior_import_receipt_sha256 -eq $Packet.prior_import_receipt.sha256 -and $Grant.historical_result_sha256 -eq $Packet.historical_result_sha256 -and $Grant.source_v26_sha256 -eq $Packet.source_v26_sha256 -and $Grant.calibration_sha256 -eq $Packet.calibration_sha256) 'GRANT_REUSED_INPUTS'


$ExpectedDirs = @(
    $ProfileRoot,
    (Join-Path $ProfileRoot 'AppData'),
    (Join-Path $ProfileRoot 'AppData\Roaming'),
    (Join-Path $ProfileRoot 'AppData\Local'),
    (Join-Path $ProfileRoot 'Temp')
)
foreach ($Path in $ExpectedDirs) { Require (Test-Path -LiteralPath $Path -PathType Container) ('PROFILE_MISSING ' + $Path) }
$ProfileItems = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
Require ($ProfileItems.Count -eq 4) 'PROFILE_INVENTORY'
Require (@($ProfileItems | Where-Object { -not $_.PSIsContainer }).Count -eq 0) 'PROFILE_FILES'
Require (@($ProfileItems | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -eq 0) 'PROFILE_REPARSE'
$WindowsRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
Require (Test-Path -LiteralPath (Join-Path $WindowsRoot 'System32') -PathType Container) 'WINDOWS_ROOT'
$CleanEnv = [ordered]@{
    SYSTEMROOT = $WindowsRoot
    WINDIR = $WindowsRoot
    USERPROFILE = $ProfileRoot
    APPDATA = (Join-Path $ProfileRoot 'AppData\Roaming')
    LOCALAPPDATA = (Join-Path $ProfileRoot 'AppData\Local')
    TEMP = (Join-Path $ProfileRoot 'Temp')
    TMP = (Join-Path $ProfileRoot 'Temp')
    HOME = $ProfileRoot
}
$Info = [Diagnostics.ProcessStartInfo]::new()
$Info.FileName = $Packet.python_path
$Info.WorkingDirectory = $Root
$Info.UseShellExecute = $false
$Info.CreateNoWindow = $true
$Info.RedirectStandardOutput = $true
$Info.RedirectStandardError = $true
$Info.ArgumentList.Add('-I')
$Info.ArgumentList.Add('-B')
$Info.ArgumentList.Add($RunnerPath)
$Info.Environment.Clear()
foreach ($Entry in $CleanEnv.GetEnumerator()) { $Info.Environment[$Entry.Key] = $Entry.Value }
Require (@($Info.Environment.Keys).Count -eq 8) 'ENV_KEY_COUNT'

[IO.Directory]::CreateDirectory($LaunchRoot) | Out-Null
WriteJsonOnce (Join-Path $LaunchRoot 'PREPARED.json') ([ordered]@{
    at_utc = [DateTimeOffset]::UtcNow.ToString('o')
    approval_id = $Grant.approval_id
    grant_sha256 = (Sha256 $GrantPath)
    packet_sha256 = $ExpectedPacketSha
    runner_sha256 = $ExpectedRunnerSha
    launcher_sha256 = $LauncherSha
    python_sha256 = $Packet.python_sha256
    historical_result_sha256 = $Packet.historical_result_sha256
    source_v26_sha256 = $Packet.source_v26_sha256
    calibration_sha256 = $Packet.calibration_sha256
    prior_import_receipt_sha256 = $Packet.prior_import_receipt.sha256
    cwd = $Root
    command = @($Info.FileName, '-I', '-B', $RunnerPath)
    use_shell_execute = $false
    create_no_window = $true
    environment = $CleanEnv
    profile_file_count = 0
})

$Process = $null
$Started = $false
$PidValue = $null
try {
    $Process = [Diagnostics.Process]::new()
    $Process.StartInfo = $Info
    $Started = $Process.Start()
    Require $Started 'PROCESS_START_FALSE'
    $PidValue = $Process.Id
    WriteJsonOnce (Join-Path $LaunchRoot 'START.json') ([ordered]@{
        at_utc = [DateTimeOffset]::UtcNow.ToString('o')
        pid = $PidValue
        approval_id = $Grant.approval_id
    })
    $StdoutTask = $Process.StandardOutput.ReadToEndAsync()
    $StderrTask = $Process.StandardError.ReadToEndAsync()
    $Exited = $Process.WaitForExit(180000)
    if (-not $Exited) {
        $Process.Kill($true)
        $Process.WaitForExit()
    }
    $StdoutTask.Wait()
    $StderrTask.Wait()
    WriteTextOnce (Join-Path $LaunchRoot 'STDOUT.txt') $StdoutTask.Result
    WriteTextOnce (Join-Path $LaunchRoot 'STDERR.txt') $StderrTask.Result
    $ExitCode = $Process.ExitCode
    $PostProfileItems = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
    $PostProfileFileCount = @($PostProfileItems | Where-Object { -not $_.PSIsContainer }).Count
    $PostProfileLinkCount = @($PostProfileItems | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count
    $PostProfileDirCount = @($PostProfileItems | Where-Object { $_.PSIsContainer }).Count
    WriteJsonOnce (Join-Path $LaunchRoot 'EXIT.json') ([ordered]@{
        at_utc = [DateTimeOffset]::UtcNow.ToString('o')
        pid = $PidValue
        exit_code = $ExitCode
        timed_out = (-not $Exited)
        process_has_exited = $Process.HasExited
        pid_still_present_after_exit = ($null -ne (Get-Process -Id $PidValue -ErrorAction SilentlyContinue))
        stdout_sha256 = (Sha256 (Join-Path $LaunchRoot 'STDOUT.txt'))
        stderr_sha256 = (Sha256 (Join-Path $LaunchRoot 'STDERR.txt'))
        receipt_present = (Test-Path -LiteralPath (Join-Path $RunRoot 'RECEIPT.json'))
        red_present = (Test-Path -LiteralPath (Join-Path $RunRoot 'RED.json'))
        post_profile_file_count = $PostProfileFileCount
        post_profile_link_count = $PostProfileLinkCount
        post_profile_dir_count = $PostProfileDirCount
    })
    if ($PostProfileFileCount -ne 0 -or $PostProfileLinkCount -ne 0 -or $PostProfileDirCount -ne 4) { throw ('PROFILE_POSTFLIGHT_CHANGED files=' + $PostProfileFileCount + ' links=' + $PostProfileLinkCount + ' dirs=' + $PostProfileDirCount) }
    if (-not $Exited -or $ExitCode -ne 0) { throw ('G1_RED exit=' + $ExitCode + ' timed_out=' + (-not $Exited)) }
    Write-Output 'PASS_G1_LAUNCH_EXIT_ZERO; REVIEW_RUN_RECEIPT'
} catch {
    $Red = [ordered]@{
        state = 'RED_STOP_NO_RETRY'
        at_utc = [DateTimeOffset]::UtcNow.ToString('o')
        pid = $PidValue
        error = $_.Exception.ToString()
        process_has_exited = if (-not $Started) { $null } else { $Process.HasExited }
        receipt_present = (Test-Path -LiteralPath (Join-Path $RunRoot 'RECEIPT.json'))
        red_present = (Test-Path -LiteralPath (Join-Path $RunRoot 'RED.json'))
    }
    try { WriteJsonOnce (Join-Path $LaunchRoot 'RED.json') $Red } catch { Write-Error ('RED_EVIDENCE_WRITE_FAILED ' + $_.Exception.Message) }
    throw
} finally {
    if ($null -ne $Process) { $Process.Dispose() }
}
