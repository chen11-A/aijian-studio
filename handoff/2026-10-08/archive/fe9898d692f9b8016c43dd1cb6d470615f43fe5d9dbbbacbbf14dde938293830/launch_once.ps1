param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PacketPath = Join-Path $Root 'PACKET.json'
$GrantPath = Join-Path $Root 'GRANT.json'
$Runner = Join-Path $Root 'copy_once.py'
$AttemptPath = Join-Path $Root 'ATTEMPT-USED.json'
$FallbackRedPath = Join-Path $Root 'LAUNCH-RED-STOP.json'
$Utf8 = [Text.UTF8Encoding]::new($false)

function Require([bool]$Condition, [string]$Code) { if (-not $Condition) { throw $Code } }
function Sha256([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash }
function WriteTextOnce([string]$Path, [string]$Value) {
    $Stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $Bytes = $Utf8.GetBytes($Value)
        $Stream.Write($Bytes, 0, $Bytes.Length)
        $Stream.Flush($true)
    } finally { $Stream.Dispose() }
}
function WriteJsonOnce([string]$Path, [object]$Value) { WriteTextOnce $Path (($Value | ConvertTo-Json -Depth 12) + "`n") }
function ProfileInventory([string]$Profile) {
    $Items = @(Get-ChildItem -LiteralPath $Profile -Force -Recurse)
    return [ordered]@{
        directories = @($Items | Where-Object { $_.PSIsContainer }).Count
        files = @($Items | Where-Object { -not $_.PSIsContainer }).Count
        links = @($Items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count
    }
}
function InvokeCleanChild([string]$Python, [string[]]$Arguments, [System.Collections.IDictionary]$CleanEnv, [int]$TimeoutMs) {
    $Info = [Diagnostics.ProcessStartInfo]::new()
    $Info.FileName = $Python
    $Info.WorkingDirectory = $Root
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true
    $Info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $Info.RedirectStandardOutput = $true
    $Info.RedirectStandardError = $true
    foreach ($Argument in $Arguments) { $Info.ArgumentList.Add($Argument) }
    $Info.Environment.Clear()
    foreach ($Entry in $CleanEnv.GetEnumerator()) { $Info.Environment[$Entry.Key] = $Entry.Value }
    Require (@($Info.Environment.Keys).Count -eq 8) 'ENV_KEY_COUNT'
    $Process = [Diagnostics.Process]::new()
    try {
        $Process.StartInfo = $Info
        Require ($Process.Start()) 'PROCESS_START_FALSE'
        $PidValue = $Process.Id
        $StdoutTask = $Process.StandardOutput.ReadToEndAsync()
        $StderrTask = $Process.StandardError.ReadToEndAsync()
        $ExitedInBudget = $Process.WaitForExit($TimeoutMs)
        $KillError = $null
        if (-not $ExitedInBudget) {
            try { $Process.Kill($true) } catch { $KillError = $_.ToString() }
            [void]$Process.WaitForExit(5000)
        }
        $StdoutComplete = $StdoutTask.Wait(5000)
        $StderrComplete = $StderrTask.Wait(5000)
        return [ordered]@{
            pid = $PidValue
            timeout_ms = $TimeoutMs
            timed_out = (-not $ExitedInBudget)
            kill_error = $KillError
            process_has_exited = $Process.HasExited
            stdout_complete = $StdoutComplete
            stderr_complete = $StderrComplete
            stdout = $(if ($StdoutComplete) { $StdoutTask.Result } else { $null })
            stderr = $(if ($StderrComplete) { $StderrTask.Result } else { $null })
            exit_code = $(if ($Process.HasExited) { $Process.ExitCode } else { $null })
        }
    } finally { $Process.Dispose() }
}

Require (Test-Path -LiteralPath $GrantPath -PathType Leaf) 'NO_GRANT_NO_ATTEMPT'
Require (-not (Test-Path -LiteralPath $AttemptPath)) 'ATTEMPT_ALREADY_USED_NO_RETRY'
WriteJsonOnce $AttemptPath ([ordered]@{ state = 'ONE_SHOT_ATTEMPT_CONSUMED'; at_utc = [DateTimeOffset]::UtcNow.ToString('o'); grant_path = $GrantPath })
$Launch = $null
$Main = $null
try {
    Require (Test-Path -LiteralPath $PacketPath -PathType Leaf) 'PACKET_MISSING'
    Require (Test-Path -LiteralPath $Runner -PathType Leaf) 'RUNNER_MISSING'
    $Packet = Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $Grant = Get-Content -LiteralPath $GrantPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $Launch = [string]$Packet.launch_root
    Require ($Packet.schema -eq 'qa02.core154.copy.packet.v1') 'PACKET_SCHEMA'
    Require ($Packet.status -eq 'PREPARED_NOT_GRANTED_NOT_COPIED') 'PACKET_STATUS'
    Require ($Grant.status -eq 'APPROVED_SINGLE_RUN' -and $Grant.approval_id -eq $Packet.approval_id) 'GRANT_STATUS_OR_ID'
    Require ($Grant.mgr01_scope_reviewed -eq $true -and $Grant.clean_environment_approved -eq $true) 'GRANT_SCOPE_OR_ENV'
    Require ($Grant.packet_sha256 -eq (Sha256 $PacketPath)) 'PACKET_CHANGED'
    Require ($Grant.runner_sha256 -eq $Packet.runner_sha256) 'RUNNER_BINDING'
    Require ($Grant.launcher_sha256 -eq $Packet.launcher_sha256 -and $Grant.launcher_sha256 -eq (Sha256 $PSCommandPath)) 'LAUNCHER_BINDING'
    Require ($Packet.timeout_ms -eq 120000 -and $Packet.hash_probe_timeout_ms -eq 30000) 'TIMEOUT_BINDING'
    Require ((Sha256 $Packet.python_path) -eq $Packet.python_sha256) 'PYTHON_CHANGED'
    Require (-not (Test-Path -LiteralPath $Launch) -and -not (Test-Path -LiteralPath $Packet.run_root) -and -not (Test-Path -LiteralPath $Packet.target_root)) 'SINGLE_RUN_OUTPUT_ALREADY_EXISTS'
    $Profile = [string]$Packet.profile_root
    Require ($Profile -eq (Join-Path $Root 'profile-01')) 'PROFILE_PATH'
    Require (-not ((Get-Item -LiteralPath $Profile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'PROFILE_ROOT_REPARSE'
    foreach ($Dir in @($Profile,(Join-Path $Profile 'AppData'),(Join-Path $Profile 'AppData\Roaming'),(Join-Path $Profile 'AppData\Local'),(Join-Path $Profile 'Temp'))) {
        Require (Test-Path -LiteralPath $Dir -PathType Container) ('PROFILE_DIR_MISSING:' + $Dir)
        Require (-not ((Get-Item -LiteralPath $Dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) ('PROFILE_DIR_REPARSE:' + $Dir)
    }
    $Inventory = ProfileInventory $Profile
    Require ($Inventory.directories -eq 4 -and $Inventory.files -eq 0 -and $Inventory.links -eq 0) 'PROFILE_PRE_INVENTORY'
    $WindowsRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
    Require (Test-Path -LiteralPath (Join-Path $WindowsRoot 'System32') -PathType Container) 'WINDOWS_ROOT'
    $CleanEnv = [ordered]@{
        SYSTEMROOT = $WindowsRoot
        WINDIR = $WindowsRoot
        USERPROFILE = $Profile
        APPDATA = (Join-Path $Profile 'AppData\Roaming')
        LOCALAPPDATA = (Join-Path $Profile 'AppData\Local')
        TEMP = (Join-Path $Profile 'Temp')
        TMP = (Join-Path $Profile 'Temp')
        HOME = $Profile
    }
    Require (@($CleanEnv.Keys).Count -eq 8) 'CLEAN_ENV_KEYS'
    [IO.Directory]::CreateDirectory($Launch) | Out-Null
    $ProbeCode = 'import hashlib,json,os,sys; p=sys.argv[1]; print(json.dumps({"runner_sha256":hashlib.sha256(open(p,"rb").read()).hexdigest().upper(),"environment_keys":sorted(os.environ),"isolated":sys.flags.isolated,"dont_write_bytecode":sys.dont_write_bytecode}))'
    $Probe = InvokeCleanChild $Packet.python_path @('-I','-B','-c',$ProbeCode,$Runner) $CleanEnv 30000
    WriteTextOnce (Join-Path $Launch 'HASH-PROBE-STDOUT.txt') ([string]$Probe.stdout)
    WriteTextOnce (Join-Path $Launch 'HASH-PROBE-STDERR.txt') ([string]$Probe.stderr)
    WriteJsonOnce (Join-Path $Launch 'HASH-PROBE.json') ([ordered]@{ pid = $Probe.pid; exit_code = $Probe.exit_code; timed_out = $Probe.timed_out; stdout_complete = $Probe.stdout_complete; stderr_complete = $Probe.stderr_complete; process_has_exited = $Probe.process_has_exited; kill_error = $Probe.kill_error })
    Require (-not $Probe.timed_out -and $Probe.process_has_exited -and $Probe.stdout_complete -and $Probe.stderr_complete -and $Probe.exit_code -eq 0 -and [string]::IsNullOrEmpty($Probe.stderr)) 'HASH_PROBE_RED'
    $ProbeValue = $Probe.stdout | ConvertFrom-Json
    Require ($ProbeValue.runner_sha256 -eq $Packet.runner_sha256 -and $ProbeValue.isolated -eq 1 -and $ProbeValue.dont_write_bytecode -eq $true) 'HASH_PROBE_MISMATCH'
    Require ((@($ProbeValue.environment_keys) -join '|') -eq ((@($CleanEnv.Keys) | Sort-Object) -join '|')) 'HASH_PROBE_ENV_MISMATCH'
    $Inventory = ProfileInventory $Profile
    Require ($Inventory.directories -eq 4 -and $Inventory.files -eq 0 -and $Inventory.links -eq 0) 'HASH_PROBE_PROFILE_CHANGED'
    WriteJsonOnce (Join-Path $Launch 'PREPARED.json') ([ordered]@{ at_utc = [DateTimeOffset]::UtcNow.ToString('o'); approval_id = $Grant.approval_id; packet_sha256 = $Grant.packet_sha256; runner_sha256 = $ProbeValue.runner_sha256; launcher_sha256 = $Grant.launcher_sha256; python_sha256 = $Packet.python_sha256; environment = $CleanEnv; profile_pre = $Inventory; command = @($Packet.python_path,'-I','-B',$Runner,'APPROVED_SINGLE_RUN'); timeout_ms = 120000 })
    $Main = InvokeCleanChild $Packet.python_path @('-I','-B',$Runner,'APPROVED_SINGLE_RUN') $CleanEnv 120000
    WriteTextOnce (Join-Path $Launch 'STDOUT.txt') ([string]$Main.stdout)
    WriteTextOnce (Join-Path $Launch 'STDERR.txt') ([string]$Main.stderr)
    $Inventory = ProfileInventory $Profile
    $State = $(if (-not $Main.timed_out -and $Main.process_has_exited -and $Main.stdout_complete -and $Main.stderr_complete -and $Main.exit_code -eq 0 -and $Inventory.directories -eq 4 -and $Inventory.files -eq 0 -and $Inventory.links -eq 0) { 'PROCESS_EXIT_ZERO' } else { 'RED_STOP_NO_RETRY' })
    WriteJsonOnce (Join-Path $Launch 'EXIT.json') ([ordered]@{ state = $State; at_utc = [DateTimeOffset]::UtcNow.ToString('o'); pid = $Main.pid; exit_code = $Main.exit_code; timeout_ms = 120000; timed_out = $Main.timed_out; kill_error = $Main.kill_error; process_has_exited = $Main.process_has_exited; stdout_complete = $Main.stdout_complete; stderr_complete = $Main.stderr_complete; profile_post = $Inventory; stdout_sha256 = (Sha256 (Join-Path $Launch 'STDOUT.txt')); stderr_sha256 = (Sha256 (Join-Path $Launch 'STDERR.txt')); receipt_present = (Test-Path -LiteralPath (Join-Path $Packet.run_root 'RECEIPT.json')) })
    Require ($State -eq 'PROCESS_EXIT_ZERO') 'COPY_RED_STOP_NO_RETRY'
    Write-Output 'PASS_LAUNCH_EXIT_ZERO_REVIEW_RECEIPT'
} catch {
    $RawError = $_.ToString()
    if ($Launch -and (Test-Path -LiteralPath $Launch -PathType Container)) {
        if (-not (Test-Path -LiteralPath (Join-Path $Launch 'STDOUT.txt'))) { WriteTextOnce (Join-Path $Launch 'STDOUT.txt') '' }
        if (-not (Test-Path -LiteralPath (Join-Path $Launch 'STDERR.txt'))) { WriteTextOnce (Join-Path $Launch 'STDERR.txt') $RawError }
        if (-not (Test-Path -LiteralPath (Join-Path $Launch 'EXIT.json'))) { WriteJsonOnce (Join-Path $Launch 'EXIT.json') ([ordered]@{ state = 'RED_STOP_NO_RETRY'; at_utc = [DateTimeOffset]::UtcNow.ToString('o'); raw_error = $RawError; main_started = ($null -ne $Main); timeout_ms = 120000 }) }
    } else {
        if (-not (Test-Path -LiteralPath $FallbackRedPath)) { WriteJsonOnce $FallbackRedPath ([ordered]@{ state = 'RED_STOP_NO_RETRY'; at_utc = [DateTimeOffset]::UtcNow.ToString('o'); raw_error = $RawError; launch_root = $Launch }) }
    }
    throw
}
