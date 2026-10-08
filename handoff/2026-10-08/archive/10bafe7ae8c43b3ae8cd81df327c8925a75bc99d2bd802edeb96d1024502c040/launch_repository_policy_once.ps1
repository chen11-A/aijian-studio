$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath))
$Packet = Join-Path $Root 'PACKET.json'
$Grant = Join-Path $Root 'GRANT.json'
$Attempt = Join-Path $Root 'ATTEMPT-USED.json'
$Run = Join-Path $Root 'run-01'
$Launch = Join-Path $Root 'launch-01'
$Profile = Join-Path $Root 'profile-01'
$Utf8 = [Text.UTF8Encoding]::new($false)
function Require([bool]$Condition, [string]$Reason) { if (-not $Condition) { throw $Reason } }
function WriteOnce([string]$Path, [object]$Value) {
    $Bytes = $Utf8.GetBytes(($Value | ConvertTo-Json -Depth 12) + "`n")
    $Stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $Stream.Write($Bytes, 0, $Bytes.Length); $Stream.Flush($true) } finally { $Stream.Dispose() }
}
Require (Test-Path -LiteralPath $Grant -PathType Leaf) 'NO_GRANT; NOT_STARTED'
Require (-not (Test-Path -LiteralPath $Attempt)) 'ATTEMPT_ALREADY_USED; NO_RETRY'
$Claimed = $false
$Phase = 'ATTEMPT_CLAIM'
$Child = $null
try {
    WriteOnce $Attempt ([ordered]@{state='ATTEMPT_USED_NO_RETRY';scope='ORIGIN_MODE_33_REPOSITORY_LOCAL_POLICY_ONLY';call_id='QA01-ORIGIN33-REPO-POLICY-20261008-01';time_utc=[DateTimeOffset]::UtcNow.ToString('o');launcher_pid=$PID})
    $Claimed = $true
    $Phase = 'PREFLIGHT'
    Require ($args.Count -eq 0) 'NO_ARGUMENTS'
    Require (-not (Test-Path -LiteralPath $Run)) 'RUN_ALREADY_EXISTS'
    Require (-not (Test-Path -LiteralPath $Launch)) 'LAUNCH_ALREADY_EXISTS'
    Require (-not (Test-Path -LiteralPath $Profile)) 'PROFILE_ALREADY_EXISTS'
    $P = Get-Content -LiteralPath $Packet -Raw -Encoding UTF8 | ConvertFrom-Json
    $G = Get-Content -LiteralPath $Grant -Raw -Encoding UTF8 | ConvertFrom-Json
    Require ($P.scope -eq 'ORIGIN_MODE_33_REPOSITORY_LOCAL_POLICY_ONLY') 'PACKET_SCOPE'
    Require ($P.call_id -eq 'QA01-ORIGIN33-REPO-POLICY-20261008-01') 'PACKET_CALL_ID'
    Require ($G.state -eq 'APPROVED_ONCE' -and $G.scope -eq $P.scope) 'GRANT_SCOPE'
    Require ($G.call_id -eq $P.call_id) 'GRANT_CALL_ID'
    Require ($G.packet_sha256 -eq (Get-FileHash -Algorithm SHA256 -LiteralPath $Packet).Hash) 'PACKET_CHANGED'
    Require ($G.runner_sha256 -eq $P.runner_sha256) 'RUNNER_GRANT_CHANGED'
    Require ($G.launcher_sha256 -eq $P.launcher_sha256) 'LAUNCHER_GRANT_CHANGED'
    Require ($G.launcher_sha256 -eq (Get-FileHash -Algorithm SHA256 -LiteralPath $PSCommandPath).Hash) 'LAUNCHER_FILE_CHANGED'
    Require ([IO.Path]::GetFullPath($P.runner_path) -eq (Join-Path $Root 'repository_policy_once.py')) 'RUNNER_PATH'
    Require ([IO.Path]::GetFullPath($P.python_path) -eq 'C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp\.venv\Scripts\python.exe') 'PYTHON_PATH'
    Require ((Get-FileHash -Algorithm SHA256 -LiteralPath $P.python_path).Hash -eq $P.python_sha256) 'PYTHON_CHANGED'
    Require ([IO.Path]::GetFullPath($P.shell_path) -eq [IO.Path]::GetFullPath((Get-Process -Id $PID).Path)) 'SHELL_PATH'
    Require ((Get-FileHash -Algorithm SHA256 -LiteralPath $P.shell_path).Hash -eq $P.shell_sha256) 'SHELL_CHANGED'
    [void](New-Item -ItemType Directory -Path $Run -ErrorAction Stop)
    [void](New-Item -ItemType Directory -Path $Launch -ErrorAction Stop)
    [void](New-Item -ItemType Directory -Path $Profile -ErrorAction Stop)
    foreach ($Name in @('appdata','localappdata','temp')) { [void](New-Item -ItemType Directory -Path (Join-Path $Profile $Name) -ErrorAction Stop) }
    $Phase = 'CHILD'
    $Info = [Diagnostics.ProcessStartInfo]::new()
    $Info.FileName = $P.python_path
    [void]$Info.ArgumentList.Add('-I')
    [void]$Info.ArgumentList.Add('-B')
    [void]$Info.ArgumentList.Add('-S')
    [void]$Info.ArgumentList.Add($P.runner_path)
    [void]$Info.ArgumentList.Add($Packet)
    $Info.WorkingDirectory = $Root
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true
    $Info.RedirectStandardOutput = $true
    $Info.RedirectStandardError = $true
    $Info.Environment['APPDATA'] = Join-Path $Profile 'appdata'
    $Info.Environment['LOCALAPPDATA'] = Join-Path $Profile 'localappdata'
    $Info.Environment['TEMP'] = Join-Path $Profile 'temp'
    $Info.Environment['TMP'] = Join-Path $Profile 'temp'
    $Info.Environment.Remove('PYTHONPATH') | Out-Null
    $Info.Environment.Remove('PYTHONHOME') | Out-Null
    $Child = [Diagnostics.Process]::new()
    $Child.StartInfo = $Info
    $Stdout = [IO.FileStream]::new((Join-Path $Launch 'STDOUT.bin'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    $Stderr = [IO.FileStream]::new((Join-Path $Launch 'STDERR.bin'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    $Started = $false
    try {
        Require ($Child.Start()) 'START_FALSE'
        $Started = $true
        $PidChild = $Child.Id
        $OutTask = $Child.StandardOutput.BaseStream.CopyToAsync($Stdout)
        $ErrTask = $Child.StandardError.BaseStream.CopyToAsync($Stderr)
        $Exited = $Child.WaitForExit(120000)
        $TimedOut = -not $Exited
        if (-not $Exited) { $Child.Kill($true); $Exited = $Child.WaitForExit(5000) }
        $StreamsComplete = [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($OutTask,$ErrTask),5000)
        $ExitCode = if ($Exited) { $Child.ExitCode } else { $null }
    } finally {
        if ($Started -and -not $Child.HasExited) { try { $Child.Kill($true); [void]$Child.WaitForExit(5000) } catch {} }
        $Stdout.Dispose(); $Stderr.Dispose()
    }
    $Result = [ordered]@{pid=$PidChild;exit_code=$ExitCode;timed_out=$TimedOut;process_exited=$Exited;streams_complete=$StreamsComplete;stdout_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Launch 'STDOUT.bin')).Hash;stderr_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Launch 'STDERR.bin')).Hash;stderr_bytes=(Get-Item -LiteralPath (Join-Path $Launch 'STDERR.bin')).Length;receipt_present=(Test-Path -LiteralPath (Join-Path $Run 'RECEIPT.json'))}
    WriteOnce (Join-Path $Launch 'EXIT.json') $Result
    Require ($Exited -and -not $TimedOut -and $StreamsComplete -and $ExitCode -eq 0 -and $Result.stderr_bytes -eq 0 -and $Result.receipt_present) 'CHILD_RED'
} catch {
    if ($Claimed) {
        $Red = [ordered]@{status='RED_NO_RETRY';phase=$Phase;error=$_.Exception.ToString();time_utc=[DateTimeOffset]::UtcNow.ToString('o')}
        try { WriteOnce (Join-Path $Root 'RED.json') $Red } catch {}
    }
    throw
} finally {
    if ($null -ne $Child) { $Child.Dispose() }
}
