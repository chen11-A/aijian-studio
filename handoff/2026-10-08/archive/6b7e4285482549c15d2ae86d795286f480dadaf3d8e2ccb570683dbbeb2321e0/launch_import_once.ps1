$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath))
$PacketPath = Join-Path $Root 'PACKET.json'
$GrantPath = Join-Path $Root 'GRANT.json'
$RunnerPath = Join-Path $Root 'run_once.py'
$ProfileRoot = Join-Path $Root 'profile-import-01'
$LaunchRoot = Join-Path $Root 'launch-01'
$ImportRoot = Join-Path $Root 'run-01'
$ExpectedPacketSha = '953F40DBA8C9B9314513844C35C353B63A7115DF40853309629B6B56ADB668E5'
$ExpectedRunnerConsumerSha = '17D8F9FE1817A1362700576BD8DF938CCFCC3413E03F8C554A3DB61BB22BB5B2'
$ExpectedPythonSha = 'F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602'
$ExpectedCopyReceiptSha = '06F94B6B635C38B864B339AB3FA934BA7F7D07071EEE5C84902BF93975A5EB22'
$Utf8 = [System.Text.UTF8Encoding]::new($false)

function Require([bool]$Condition, [string]$Reason) {
    if (-not $Condition) { throw $Reason }
}

function Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function WriteTextOnce([string]$Path, [string]$Value) {
    $Stream = [System.IO.FileStream]::new($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $Bytes = $Utf8.GetBytes($Value)
        $Stream.Write($Bytes, 0, $Bytes.Length)
        $Stream.Flush($true)
    } finally {
        $Stream.Dispose()
    }
}

function WriteJsonOnce([string]$Path, [object]$Value) {
    WriteTextOnce $Path (($Value | ConvertTo-Json -Depth 20) + "`n")
}

Require ($args.Count -eq 0) 'NO_ARGUMENTS_ALLOWED'
Require (Test-Path -LiteralPath $GrantPath -PathType Leaf) 'NO_APPROVED_GRANT; IMPORT_LAUNCH_NOT_STARTED'
Require (-not [System.IO.File]::Exists($LaunchRoot) -and -not [System.IO.Directory]::Exists($LaunchRoot)) 'LAUNCH_01_ALREADY_EXISTS; NO_RETRY'
Require (-not [System.IO.File]::Exists($ImportRoot) -and -not [System.IO.Directory]::Exists($ImportRoot)) 'IMPORT_RUN_01_ALREADY_EXISTS; NO_RETRY'
Require ((Sha256 $PacketPath) -eq $ExpectedPacketSha) 'PACKET_SHA_CHANGED'
Require ((Sha256 $RunnerPath) -eq 'C2BAD233790017410BE0EC90A8154C36DD3E3A14E54E875C2CE7961A7FC12B16') 'RUNNER_POWERSHELL_VIEW_CHANGED'
$Packet = Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Grant = Get-Content -LiteralPath $GrantPath -Raw -Encoding UTF8 | ConvertFrom-Json
$LauncherSha = Sha256 $PSCommandPath
Require ($Packet.state -eq 'READY_AFTER_QA_DEPENDENCY_COPY') 'PACKET_NOT_READY'
Require ($Packet.runner_sha256 -eq $ExpectedRunnerConsumerSha) 'RUNNER_CONSUMER_SHA_CHANGED'
Require ($Packet.python_sha256 -eq $ExpectedPythonSha) 'PYTHON_SHA_CHANGED'
Require ($Packet.qa_dependency_copy_receipt_sha256 -eq $ExpectedCopyReceiptSha) 'COPY_RECEIPT_SHA_CHANGED'
Require ((Sha256 $Packet.python_path) -eq $ExpectedPythonSha) 'PYTHON_EXE_CHANGED'
Require ((Sha256 $Packet.qa_dependency_copy_receipt_path) -eq $ExpectedCopyReceiptSha) 'COPY_RECEIPT_CHANGED'
Require ($Packet.runner_path -eq $RunnerPath) 'RUNNER_PATH_CHANGED'
Require ($Packet.evidence_root -eq $ImportRoot) 'IMPORT_EVIDENCE_PATH_CHANGED'
Require ($Grant.state -eq 'APPROVED_SINGLE_RUN' -and $Grant.approved_by -eq 'MGR02' -and $Grant.mgr01_scope_reviewed -eq $true) 'GRANT_OWNER_REVIEW'
Require ($Grant.scope -eq 'CORE153_CONSUMER_IMPORT_9_ONLY' -and $Grant.one_shot_run -eq 'run-01' -and $Grant.launcher_one_shot -eq 'launch-01') 'GRANT_SCOPE'
Require (-not [string]::IsNullOrWhiteSpace($Grant.approval_id)) 'GRANT_ID'
Require ($Grant.qa_dependency_copy_scope_approved -eq $true -and $Grant.compiled_extension_boundary_approved -eq $true -and $Grant.allowed_write_policy_approved -eq $true) 'GRANT_IMPORT_BOUNDARIES'
Require ($Grant.clean_environment_approved -eq $true -and $Grant.qa_isolated_profile_approved -eq $true) 'GRANT_LAUNCH_BOUNDARIES'
Require ($Grant.packet_sha256 -eq $ExpectedPacketSha -and $Grant.runner_sha256 -eq $ExpectedRunnerConsumerSha -and $Grant.launcher_sha256 -eq $LauncherSha) 'GRANT_EXECUTABLE_HASHES'
Require ($Grant.dependency_candidate_sha256 -eq $Packet.dependency_candidate_sha256 -and $Grant.qa_dependency_copy_receipt_sha256 -eq $ExpectedCopyReceiptSha) 'GRANT_DEPENDENCY_HASHES'

$ExpectedProfileDirs = @(
    $ProfileRoot,
    (Join-Path $ProfileRoot 'AppData'),
    (Join-Path $ProfileRoot 'AppData\Roaming'),
    (Join-Path $ProfileRoot 'AppData\Local'),
    (Join-Path $ProfileRoot 'Temp')
)
foreach ($Path in $ExpectedProfileDirs) { Require (Test-Path -LiteralPath $Path -PathType Container) ('PROFILE_DIR_MISSING ' + $Path) }
$ProfileItems = @(Get-ChildItem -LiteralPath $ProfileRoot -Force -Recurse)
Require (@($ProfileItems | Where-Object { -not $_.PSIsContainer }).Count -eq 0) 'PROFILE_NOT_EMPTY'
Require (@($ProfileItems | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }).Count -eq 0) 'PROFILE_REPARSE_POINT'
Require ($ProfileItems.Count -eq 4) 'PROFILE_INVENTORY_CHANGED'
$WindowsRoot = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Windows)
Require (-not [string]::IsNullOrWhiteSpace($WindowsRoot) -and (Test-Path -LiteralPath (Join-Path $WindowsRoot 'System32') -PathType Container)) 'WINDOWS_ROOT_UNAVAILABLE'

$Environment = [ordered]@{
    SYSTEMROOT = $WindowsRoot
    WINDIR = $WindowsRoot
    USERPROFILE = $ProfileRoot
    APPDATA = (Join-Path $ProfileRoot 'AppData\Roaming')
    LOCALAPPDATA = (Join-Path $ProfileRoot 'AppData\Local')
    TEMP = (Join-Path $ProfileRoot 'Temp')
    TMP = (Join-Path $ProfileRoot 'Temp')
    HOME = $ProfileRoot
}
$StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
$StartInfo.FileName = $Packet.python_path
$StartInfo.WorkingDirectory = $Root
$StartInfo.UseShellExecute = $false
$StartInfo.CreateNoWindow = $true
$StartInfo.RedirectStandardOutput = $true
$StartInfo.RedirectStandardError = $true
$StartInfo.ArgumentList.Add('-I')
$StartInfo.ArgumentList.Add('-B')
$StartInfo.ArgumentList.Add($RunnerPath)
$StartInfo.Environment.Clear()
foreach ($Entry in $Environment.GetEnumerator()) { $StartInfo.Environment[$Entry.Key] = $Entry.Value }
Require (@($StartInfo.Environment.Keys).Count -eq 8) 'ENVIRONMENT_KEY_COUNT'

[System.IO.Directory]::CreateDirectory($LaunchRoot) | Out-Null
$StartedAt = [DateTimeOffset]::UtcNow.ToString('o')
WriteJsonOnce (Join-Path $LaunchRoot 'PREPARED.json') ([ordered]@{
    at_utc = $StartedAt
    approval_id = $Grant.approval_id
    grant_sha256 = (Sha256 $GrantPath)
    packet_sha256 = $ExpectedPacketSha
    runner_fixed_python_sha256 = $ExpectedRunnerConsumerSha
    runner_powershell_raw_sha256 = (Sha256 $RunnerPath)
    launcher_sha256 = $LauncherSha
    python_sha256 = $ExpectedPythonSha
    copy_receipt_sha256 = $ExpectedCopyReceiptSha
    working_directory = $Root
    file_name = $StartInfo.FileName
    arguments = @('-I', '-B', $RunnerPath)
    use_shell_execute = $false
    create_no_window = $true
    environment = $Environment
    profile_item_count = $ProfileItems.Count
    profile_file_count = 0
})

$Process = $null
$PidValue = $null
$Started = $false
try {
    $Process = [System.Diagnostics.Process]::new()
    $Process.StartInfo = $StartInfo
    $Started = $Process.Start()
    Require $Started 'PROCESS_START_FALSE'
    $PidValue = $Process.Id
    WriteJsonOnce (Join-Path $LaunchRoot 'START.json') ([ordered]@{ at_utc = [DateTimeOffset]::UtcNow.ToString('o'); pid = $PidValue; approval_id = $Grant.approval_id })
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
    WriteJsonOnce (Join-Path $LaunchRoot 'EXIT.json') ([ordered]@{
        at_utc = [DateTimeOffset]::UtcNow.ToString('o')
        pid = $PidValue
        exit_code = $ExitCode
        timed_out = (-not $Exited)
        process_has_exited = $Process.HasExited
        pid_still_present_after_exit = ($null -ne (Get-Process -Id $PidValue -ErrorAction SilentlyContinue))
        stdout_sha256 = (Sha256 (Join-Path $LaunchRoot 'STDOUT.txt'))
        stderr_sha256 = (Sha256 (Join-Path $LaunchRoot 'STDERR.txt'))
        import_receipt_present = (Test-Path -LiteralPath (Join-Path $ImportRoot 'RECEIPT.json') -PathType Leaf)
        import_red_present = (Test-Path -LiteralPath (Join-Path $ImportRoot 'RED.json') -PathType Leaf)
    })
    if (-not $Exited -or $ExitCode -ne 0) { throw ('IMPORT_PROCESS_RED exit=' + $ExitCode + ' timed_out=' + (-not $Exited)) }
    Write-Output 'PASS_IMPORT_LAUNCH_PROCESS_EXIT_ZERO; SEE_IMPORT_RECEIPT_FOR_GATE_RESULT'
} catch {
    $Red = [ordered]@{
        state = 'RED_STOP_NO_RETRY'
        at_utc = [DateTimeOffset]::UtcNow.ToString('o')
        pid = $PidValue
        error = $_.Exception.ToString()
        process_has_exited = if (-not $Started) { $null } else { $Process.HasExited }
        pid_still_present_after_exit = if ($null -eq $PidValue) { $null } else { $null -ne (Get-Process -Id $PidValue -ErrorAction SilentlyContinue) }
        import_receipt_present = (Test-Path -LiteralPath (Join-Path $ImportRoot 'RECEIPT.json') -PathType Leaf)
        import_red_present = (Test-Path -LiteralPath (Join-Path $ImportRoot 'RED.json') -PathType Leaf)
    }
    try { WriteJsonOnce (Join-Path $LaunchRoot 'RED.json') $Red } catch { Write-Error ('RED_EVIDENCE_WRITE_FAILED ' + $_.Exception.Message) }
    throw
} finally {
    if ($null -ne $Process) { $Process.Dispose() }
}
