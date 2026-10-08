param([Parameter(Mandatory=$true)][string]$Approval,[Parameter(Mandatory=$true)][string]$ApprovalSha256)
$ErrorActionPreference='Stop'
$qa=Split-Path -Parent $PSCommandPath
$node='C:\Program Files\nodejs\node.exe'
$runner=Join-Path $qa 'run-once.cjs'
$marker=Join-Path $qa 'INVOKE-STARTED.json'
$receipt=Join-Path $qa 'INVOCATION.json'
$stdout=Join-Path $qa 'NODE.stdout.raw'
$stderr=Join-Path $qa 'NODE.stderr.raw'
function Sha([string]$p){(Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash}
if ((Sha $Approval) -ne $ApprovalSha256.ToUpperInvariant()) {throw 'Approval SHA drift'}
$a=Get-Content -LiteralPath $Approval -Raw | ConvertFrom-Json
if ($a.state -ne 'APPROVED_SINGLE_RUN' -or $a.schema -ne 'qa03.source-preview-three-button.one-shot.approval.v1') {throw 'Not signed approval'}
if ((Sha $PSCommandPath) -ne $a.wrapperSha256 -or (Sha $runner) -ne $a.runnerSha256 -or (Sha $node) -ne $a.nodeSha256) {throw 'Wrapper/runner/Node SHA drift'}
if ((Test-Path -LiteralPath $marker) -or (Test-Path -LiteralPath $receipt) -or (Test-Path -LiteralPath $stdout) -or (Test-Path -LiteralPath $stderr) -or (Test-Path -LiteralPath (Join-Path $qa 'run-01'))) {throw 'One-shot already started'}
@{at=[DateTime]::UtcNow.ToString('o');approvalSha256=$ApprovalSha256.ToUpperInvariant();wrapperSha256=(Sha $PSCommandPath)} | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding utf8
$psi=[System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName=$node
$psi.WorkingDirectory=$qa
$psi.UseShellExecute=$false
$psi.CreateNoWindow=$true
$psi.RedirectStandardOutput=$true
$psi.RedirectStandardError=$true
foreach($arg in @($runner,'--approval',$Approval,'--approval-sha256',$ApprovalSha256.ToUpperInvariant())){[void]$psi.ArgumentList.Add($arg)}
$p=[System.Diagnostics.Process]::new()
$p.StartInfo=$psi
$started=[DateTime]::UtcNow.ToString('o')
[void]$p.Start()
$outTask=$p.StandardOutput.ReadToEndAsync()
$errTask=$p.StandardError.ReadToEndAsync()
$timedOut=-not $p.WaitForExit(120000)
if($timedOut){$p.Kill($true);[void]$p.WaitForExit(10000)}
[System.IO.File]::WriteAllText($stdout,$outTask.GetAwaiter().GetResult(),[System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($stderr,$errTask.GetAwaiter().GetResult(),[System.Text.UTF8Encoding]::new($false))
$record=[ordered]@{schema='qa03.source-preview-three-button.invocation.v1';startedAt=$started;finishedAt=[DateTime]::UtcNow.ToString('o');pid=$p.Id;executable=$node;arguments=@($runner,'--approval',$Approval,'--approval-sha256',$ApprovalSha256.ToUpperInvariant());exitCode=$p.ExitCode;timedOut=$timedOut;stdoutPath=$stdout;stdoutSha256=(Sha $stdout);stderrPath=$stderr;stderrSha256=(Sha $stderr);productMutation='NOT_RUN'}
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding utf8
if($timedOut -or $p.ExitCode -ne 0){exit 1}
