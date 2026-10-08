param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Packet = Get-Content -LiteralPath (Join-Path $Root 'PACKET.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Profile = [string]$Packet.profile_root
$WindowsRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
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
if (@($CleanEnv.Keys).Count -ne 8) { throw 'CLEAN_ENV_KEYS' }
$Pre = @(Get-ChildItem -LiteralPath $Profile -Force -Recurse)
if ($Pre.Count -ne 4 -or @($Pre | Where-Object { -not $_.PSIsContainer }).Count -ne 0 -or @($Pre | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -ne 0) { throw 'PROFILE_PRE' }
$Info = [Diagnostics.ProcessStartInfo]::new()
$Info.FileName = $Packet.python_path
$Info.WorkingDirectory = $Root
$Info.UseShellExecute = $false
$Info.CreateNoWindow = $true
$Info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$Info.RedirectStandardOutput = $true
$Info.RedirectStandardError = $true
$Code = 'import hashlib,json,os,sys; p=sys.argv[1]; print(json.dumps({"runner_sha256":hashlib.sha256(open(p,"rb").read()).hexdigest().upper(),"environment_keys":sorted(os.environ),"isolated":sys.flags.isolated,"dont_write_bytecode":sys.dont_write_bytecode}))'
foreach ($Argument in @('-I','-B','-c',$Code,(Join-Path $Root 'copy_once.py'))) { $Info.ArgumentList.Add($Argument) }
$Info.Environment.Clear()
foreach ($Entry in $CleanEnv.GetEnumerator()) { $Info.Environment[$Entry.Key] = $Entry.Value }
if (@($Info.Environment.Keys).Count -ne 8) { throw 'PROCESS_ENV_KEY_COUNT' }
$Process = [Diagnostics.Process]::new()
$Process.StartInfo = $Info
try {
    if (-not $Process.Start()) { throw 'PROBE_START_FALSE' }
    $StdoutTask = $Process.StandardOutput.ReadToEndAsync()
    $StderrTask = $Process.StandardError.ReadToEndAsync()
    $Exited = $Process.WaitForExit(30000)
    if (-not $Exited) { $Process.Kill($true); [void]$Process.WaitForExit(5000) }
    if (-not $StdoutTask.Wait(5000) -or -not $StderrTask.Wait(5000)) { throw 'PROBE_STREAM_TIMEOUT' }
    $Stdout = $StdoutTask.Result
    $Stderr = $StderrTask.Result
    if (-not $Exited -or $Process.ExitCode -ne 0 -or -not [string]::IsNullOrEmpty($Stderr)) { throw 'PROBE_PROCESS_RED' }
    $Value = $Stdout | ConvertFrom-Json
    if ($Value.runner_sha256 -ne $Packet.runner_sha256 -or $Value.isolated -ne 1 -or $Value.dont_write_bytecode -ne $true) { throw 'PROBE_HASH_OR_FLAGS' }
    if ((@($Value.environment_keys) -join '|') -ne ((@($CleanEnv.Keys) | Sort-Object) -join '|')) { throw 'PROBE_ENV_MISMATCH' }
    $Post = @(Get-ChildItem -LiteralPath $Profile -Force -Recurse)
    if ($Post.Count -ne 4 -or @($Post | Where-Object { -not $_.PSIsContainer }).Count -ne 0 -or @($Post | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -ne 0) { throw 'PROFILE_POST' }
    $Evidence = [ordered]@{ state = 'STATIC_CLEAN_HASH_PROBE_PASS_NO_COPY'; at_utc = [DateTimeOffset]::UtcNow.ToString('o'); packet_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Root 'PACKET.json')).Hash; runner_sha256 = $Value.runner_sha256; python_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Packet.python_path).Hash; environment = $CleanEnv; observed_environment_keys = $Value.environment_keys; isolated = $Value.isolated; dont_write_bytecode = $Value.dont_write_bytecode; pid = $Process.Id; exit_code = $Process.ExitCode; timed_out = $false; profile_pre_items = $Pre.Count; profile_post_items = $Post.Count; stdout = $Stdout; stderr = $Stderr; target_absent = (-not (Test-Path -LiteralPath $Packet.target_root)); grant_absent = (-not (Test-Path -LiteralPath (Join-Path $Root 'GRANT.json'))) }
    $Path = Join-Path $Root 'STATIC-HASH-PROBE.json'
    if (Test-Path -LiteralPath $Path) { throw 'PROBE_EVIDENCE_EXISTS' }
    [IO.File]::WriteAllText($Path,(($Evidence | ConvertTo-Json -Depth 8) + "`n"),[Text.UTF8Encoding]::new($false))
    Write-Output ('STATIC_CLEAN_HASH_PROBE_PASS ' + (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash)
} finally { $Process.Dispose() }
