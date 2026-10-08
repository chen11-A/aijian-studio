param([Parameter(Mandatory=$true)][ValidateSet('G0','G1')][string]$Gate)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PacketPath = Join-Path $Root ($Gate + '-PACKET.json')
$Packet = Get-Content -LiteralPath $PacketPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Profile = [string]$Packet.profile_root
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
$Code = 'import hashlib,json,os,sys; from pathlib import Path; p=Path(sys.argv[1]); c=Path(sys.argv[2]); print(json.dumps({"runner_sha256":hashlib.sha256(p.read_bytes()).hexdigest().upper(),"common_sha256":hashlib.sha256(c.read_bytes()).hexdigest().upper(),"environment_keys":sorted(os.environ),"isolated":sys.flags.isolated,"no_site":sys.flags.no_site,"dont_write_bytecode":sys.dont_write_bytecode,"initial_sys_path":sys.path}))'
foreach ($Argument in @('-I','-B','-S','-c',$Code,$Packet.runner_path,(Join-Path $Root 'gate_common.py'))) { $Info.ArgumentList.Add($Argument) }
$Info.Environment.Clear()
foreach ($Entry in $Packet.environment.PSObject.Properties) { $Info.Environment[$Entry.Name] = [string]$Entry.Value }
if (@($Info.Environment.Keys).Count -ne 8) { throw 'ENV_COUNT' }
$Process = [Diagnostics.Process]::new()
$Process.StartInfo = $Info
try {
    if (-not $Process.Start()) { throw 'PROBE_START_FALSE' }
    $StdoutTask = $Process.StandardOutput.ReadToEndAsync()
    $StderrTask = $Process.StandardError.ReadToEndAsync()
    $Exited = $Process.WaitForExit(30000)
    if (-not $Exited) { $Process.Kill($true); [void]$Process.WaitForExit(5000) }
    if (-not $StdoutTask.Wait(5000) -or -not $StderrTask.Wait(5000)) { throw 'STREAM_TIMEOUT' }
    $Stdout = $StdoutTask.Result
    $Stderr = $StderrTask.Result
    if (-not $Exited -or $Process.ExitCode -ne 0 -or -not [string]::IsNullOrEmpty($Stderr)) { throw 'PROCESS_RED' }
    $Value = $Stdout | ConvertFrom-Json
    if ($Value.runner_sha256 -ne $Packet.runner_sha256 -or $Value.common_sha256 -ne $Packet.common_sha256 -or $Value.isolated -ne 1 -or $Value.no_site -ne 1 -or $Value.dont_write_bytecode -ne $true) { throw 'HASH_OR_FLAGS' }
    if ((@($Value.environment_keys) -join '|') -ne ((@($Packet.environment.PSObject.Properties.Name) | Sort-Object) -join '|')) { throw 'ENV_MISMATCH' }
    if ((@($Value.initial_sys_path) -join '|') -ne (@($Packet.initial_sys_path) -join '|')) { throw 'SYS_PATH_MISMATCH' }
    $Post = @(Get-ChildItem -LiteralPath $Profile -Force -Recurse)
    if ($Post.Count -ne 4 -or @($Post | Where-Object { -not $_.PSIsContainer }).Count -ne 0 -or @($Post | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -ne 0) { throw 'PROFILE_POST' }
    $Evidence = [ordered]@{ state = 'STATIC_CLEAN_HASH_PROBE_PASS_NO_PRODUCT_IMPORT'; gate = $Gate; at_utc = [DateTimeOffset]::UtcNow.ToString('o'); packet_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $PacketPath).Hash; runner_sha256 = $Value.runner_sha256; common_sha256 = $Value.common_sha256; environment_keys = $Value.environment_keys; initial_sys_path = $Value.initial_sys_path; isolated = $Value.isolated; no_site = $Value.no_site; dont_write_bytecode = $Value.dont_write_bytecode; profile_pre_items = $Pre.Count; profile_post_items = $Post.Count; pid = $Process.Id; exit_code = $Process.ExitCode; stderr = $Stderr; stdout = $Stdout; grant_absent = (-not (Test-Path -LiteralPath (Join-Path $Root ($Gate + '-GRANT.json')))); attempt_absent = (-not (Test-Path -LiteralPath (Join-Path $Root ($Gate + '-ATTEMPT-USED.json')))); run_absent = (-not (Test-Path -LiteralPath $Packet.run_root)); launch_absent = (-not (Test-Path -LiteralPath $Packet.launch_root)) }
    $Output = Join-Path $Root ($Gate + '-STATIC-HASH-PROBE.json')
    if (Test-Path -LiteralPath $Output) { throw 'EVIDENCE_EXISTS' }
    [IO.File]::WriteAllText($Output,(($Evidence | ConvertTo-Json -Depth 8) + "`n"),[Text.UTF8Encoding]::new($false))
    Write-Output ($Gate + '_STATIC_CLEAN_HASH_PROBE_PASS ' + (Get-FileHash -Algorithm SHA256 -LiteralPath $Output).Hash)
} finally { $Process.Dispose() }
