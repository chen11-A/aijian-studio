$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$Packet=Get-Content -LiteralPath (Join-Path $Root 'B31-PACKET.json') -Raw -Encoding UTF8|ConvertFrom-Json
$Profile=[string]$Packet.profile_root
$Pre=@(Get-ChildItem -LiteralPath $Profile -Recurse -Force)
if($Pre.Count -ne 4 -or @($Pre|Where-Object {-not $_.PSIsContainer}).Count -ne 0) {throw 'PROFILE_PRE'}
if(Test-Path -LiteralPath (Join-Path $Root 'B31-GRANT.json')) {throw 'GRANT_PRESENT'}
if(Test-Path -LiteralPath (Join-Path $Root 'B31-ATTEMPT-USED.json')) {throw 'ATTEMPT_PRESENT'}
if(Test-Path -LiteralPath (Join-Path $Root 'run-01')) {throw 'RUN_PRESENT'}
function InvokeProbe([string]$Executable,[string[]]$Arguments,[int]$TimeoutMs) {
    $Info=[Diagnostics.ProcessStartInfo]::new()
    $Info.FileName=$Executable
    $Info.WorkingDirectory=$Root
    $Info.UseShellExecute=$false
    $Info.CreateNoWindow=$true
    $Info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    $Info.RedirectStandardOutput=$true
    $Info.RedirectStandardError=$true
    foreach($Argument in $Arguments){$Info.ArgumentList.Add($Argument)}
    $Info.Environment.Clear()
    foreach($Entry in $Packet.environment.PSObject.Properties){$Info.Environment[$Entry.Name]=[string]$Entry.Value}
    if(@($Info.Environment.Keys).Count -ne 8){throw 'ENV_COUNT'}
    $Process=[Diagnostics.Process]::new()
    try {
        $Process.StartInfo=$Info
        if(-not $Process.Start()){throw 'START_FALSE'}
        $Out=$Process.StandardOutput.ReadToEndAsync()
        $Err=$Process.StandardError.ReadToEndAsync()
        $Exited=$Process.WaitForExit($TimeoutMs)
        if(-not $Exited){$Process.Kill($true);[void]$Process.WaitForExit(5000)}
        $OutDone=$Out.Wait(5000);$ErrDone=$Err.Wait(5000)
        if(-not $Exited -or -not $Process.HasExited -or -not $OutDone -or -not $ErrDone -or
            $Process.ExitCode -ne 0 -or -not [string]::IsNullOrEmpty($Err.Result)){throw 'PROBE_RED'}
        return [ordered]@{pid=$Process.Id;exit_code=$Process.ExitCode;stdout=$Out.Result;stderr=$Err.Result}
    } finally {$Process.Dispose()}
}
$Python=InvokeProbe $Packet.python_path @('-I','-B','-S',(Join-Path $Root 'probe_python_sources.py')) 30000
$Node=InvokeProbe $Packet.node_path @((Join-Path $Root 'probe_node_sources.cjs')) 30000
$PyResult=$Python.stdout|ConvertFrom-Json
$NodeResult=$Node.stdout|ConvertFrom-Json
if($PyResult.state -ne 'FIXED_PYTHON_SOURCE_VIEW_PASS' -or
   $NodeResult.state -ne 'NODE_SOURCE_VIEW_PASS' -or
   $NodeResult.packet_sha256 -ne (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Root 'B31-PACKET.json')).Hash) {
    throw 'PROBE_RESULT'
}
$Post=@(Get-ChildItem -LiteralPath $Profile -Recurse -Force)
if($Post.Count -ne 4 -or @($Post|Where-Object {-not $_.PSIsContainer}).Count -ne 0) {throw 'PROFILE_POST'}
$Evidence=[ordered]@{
    state='B31_V2_STATIC_CONSUMER_PROBES_PASS_NO_TS_MOCK_RUN'
    packet_sha256=$NodeResult.packet_sha256
    python=$PyResult;node=$NodeResult
    python_pid=$Python.pid;node_pid=$Node.pid
    python_exit=$Python.exit_code;node_exit=$Node.exit_code
    python_stderr=$Python.stderr;node_stderr=$Node.stderr
    profile_pre_items=$Pre.Count;profile_post_items=$Post.Count
    grant_absent=$true;attempt_absent=$true;run_absent=$true
}
$Output=Join-Path $Root 'B31-V2-STATIC-CONSUMER.json'
if(Test-Path -LiteralPath $Output){throw 'EVIDENCE_EXISTS'}
[IO.File]::WriteAllText($Output,(($Evidence|ConvertTo-Json -Depth 12)+"`n"),[Text.UTF8Encoding]::new($false))
Write-Output ('STATIC_CONSUMER_PASS '+(Get-FileHash -Algorithm SHA256 -LiteralPath $Output).Hash)
