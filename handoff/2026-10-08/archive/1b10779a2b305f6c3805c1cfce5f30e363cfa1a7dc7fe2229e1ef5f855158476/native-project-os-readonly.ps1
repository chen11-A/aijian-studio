param(
    [Parameter(Mandatory = $true)][string]$RootPath,
    [Parameter(Mandatory = $true)][string]$ProfilePath,
    [int]$TargetLauncherPid = 0,
    [string]$TargetHwnd = '0',
    [switch]$CheckLocks
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Qa02NativeWindowRead {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
}
'@

$root = [IO.Path]::GetFullPath($RootPath).TrimEnd('\')
$profile = [IO.Path]::GetFullPath($ProfilePath)
if (-not $profile.StartsWith($root + '\.aijian-dev\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Profile is not a child of the product evidence root'
}

$foreground = [Qa02NativeWindowRead]::GetForegroundWindow()
$foregroundPid = [uint32]0
$null = [Qa02NativeWindowRead]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
$targetHandle = [IntPtr]::new([int64]::Parse($TargetHwnd))
$targetHwndPid = [uint32]0
if ($targetHandle -ne [IntPtr]::Zero) {
    $null = [Qa02NativeWindowRead]::GetWindowThreadProcessId($targetHandle, [ref]$targetHwndPid)
}
$lastInput = New-Object Qa02NativeWindowRead+LASTINPUTINFO
$lastInput.cbSize = [uint32][Runtime.InteropServices.Marshal]::SizeOf($lastInput)
$lastInputOk = [Qa02NativeWindowRead]::GetLastInputInfo([ref]$lastInput)
$snapshot = @(Get-CimInstance Win32_Process)
$byPid = @{}
foreach ($process in $snapshot) { $byPid[[int]$process.ProcessId] = $process }
$processes = @($snapshot | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) -or
    ($TargetLauncherPid -gt 0 -and $_.ProcessId -eq $TargetLauncherPid)
} | ForEach-Object {
    [pscustomobject]@{
        pid = [int]$_.ProcessId
        parentPid = [int]$_.ParentProcessId
        name = [string]$_.Name
        executablePath = [string]$_.ExecutablePath
    }
})
$targetProcessChain = @()
$cursor = [int]$targetHwndPid
$seen = @{}
for ($depth = 0; $cursor -gt 0 -and $depth -lt 12; $depth++) {
    if ($seen.ContainsKey($cursor) -or -not $byPid.ContainsKey($cursor)) { break }
    $seen[$cursor] = $true
    $current = $byPid[$cursor]
    $targetProcessChain += [pscustomobject]@{
        pid = [int]$current.ProcessId
        parentPid = [int]$current.ParentProcessId
        name = [string]$current.Name
        executablePath = [string]$current.ExecutablePath
    }
    if ($cursor -eq $TargetLauncherPid) { break }
    $cursor = [int]$current.ParentProcessId
}
$locks = @()
if (Test-Path -LiteralPath $profile) {
    $locks = @(Get-ChildItem -LiteralPath $profile -Force -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK') -or $_.Extension -eq '.lock' } |
        ForEach-Object {
            $exclusiveRead = $null
            if ($CheckLocks) {
                try {
                    $stream = [IO.File]::Open($_.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
                    $stream.Dispose()
                    $exclusiveRead = $true
                } catch {
                    $exclusiveRead = $false
                }
            }
            [pscustomobject]@{
                path = $_.FullName
                bytes = [int64]$_.Length
                exclusiveRead = $exclusiveRead
            }
        })
}

[pscustomobject]@{
    capturedUtc = [DateTime]::UtcNow.ToString('o')
    foregroundHwnd = $foreground.ToInt64().ToString()
    foregroundPid = [int]$foregroundPid
    lastInputTick = $(if ($lastInputOk) { [uint64]$lastInput.dwTime } else { $null })
    targetLauncherPid = $TargetLauncherPid
    targetHwnd = $TargetHwnd
    targetHwndPid = [int]$targetHwndPid
    targetProcessChain = $targetProcessChain
    profileExists = [bool](Test-Path -LiteralPath $profile)
    relatedProcesses = $processes
    lockFiles = $locks
} | ConvertTo-Json -Depth 6 -Compress
