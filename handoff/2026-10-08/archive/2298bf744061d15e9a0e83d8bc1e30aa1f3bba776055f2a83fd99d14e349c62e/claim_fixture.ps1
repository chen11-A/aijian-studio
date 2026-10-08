$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$FixtureRoot = Split-Path -Parent $PSCommandPath
$PrepRoot = Join-Path (Split-Path -Parent $FixtureRoot) 'b31-g2-rollback-prep-03'
$Launcher = Join-Path $PrepRoot 'launch_g2_once.ps1'
$ResultsPath = Join-Path $FixtureRoot 'CLAIM-FIXTURE-RESULT.json'
if (Test-Path -LiteralPath $ResultsPath) { throw 'EVIDENCE_EXISTS' }
$Source = [IO.File]::ReadAllText($Launcher, [Text.Encoding]::UTF8)
$ExpectedLauncherSha = '760AD43B38FA1AF7F01FAFF362E8A047DB342C5A9DB11DD469C518667A7C1AF4'
function HashFile([string]$Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant() }
function HashText([string]$Value) { $b=[Text.UTF8Encoding]::new($false).GetBytes($Value); [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($b)) }
if ((HashFile $Launcher) -ne $ExpectedLauncherSha) { throw 'LAUNCHER_DRIFT' }
$tokens=$null; $parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Launcher,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'LAUNCHER_PARSE_RED' }
foreach ($name in @('Require','Sha256','WriteTextOnce','WriteJsonOnce')) {
    $fn=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true))
    if ($fn.Count -ne 1) { throw ('FUNCTION_EXTRACT_RED '+$name) }
    . ([scriptblock]::Create($fn[0].Extent.Text))
}
$Start=$Source.IndexOf("    `$ClaimStream = [IO.FileStream]::new(`$AttemptPath")
$EndToken="    `$Phase = 'PREFLIGHT'"
$End=$Source.IndexOf($EndToken,$Start)
$Catch=$Source.LastIndexOf('} catch {')
if ($Start -lt 0 -or $End -le $Start -or $Catch -le $End) { throw 'CLAIM_EXTRACT_RED' }
$ClaimSource=$Source.Substring($Start,$End+$EndToken.Length-$Start)
$CatchSource=$Source.Substring($Catch)
$Utf8=[Text.UTF8Encoding]::new($false)
class QaFaultStream {
    [string]$Path
    [string]$Mode
    QaFaultStream([string]$path,[string]$mode) {
        $this.Path=$path; $this.Mode=$mode
        [IO.File]::WriteAllBytes($path,[byte[]]@())
    }
    [void] Write([byte[]]$bytes,[int]$offset,[int]$count) {
        if ($this.Mode -eq 'write') { throw 'QA_INJECT_WRITE' }
        $part=[byte[]]::new($count)
        [Array]::Copy($bytes,$offset,$part,0,$count)
        [IO.File]::WriteAllBytes($this.Path,$part)
    }
    [void] Flush([bool]$durable) {
        if ($this.Mode -eq 'flush') { throw 'QA_INJECT_FLUSH' }
    }
    [void] Dispose() {
        if ($this.Mode -eq 'dispose') { throw 'QA_INJECT_DISPOSE' }
    }
}
$Results=@()
foreach ($Case in @('create_new','write','flush','dispose','readback')) {
    $Root=Join-Path $FixtureRoot ('case-'+$Case)
    if (Test-Path -LiteralPath $Root) { throw ('CASE_EXISTS '+$Case) }
    [IO.Directory]::CreateDirectory($Root) | Out-Null
    $AttemptPath=Join-Path $Root 'ATTEMPT-USED.json'
    $AttemptRedPath=Join-Path $Root 'ATTEMPT-RED.json'
    $GrantPath=Join-Path $Root 'DUMMY-GRANT-NOT-AUTHORIZED.json'
    $LaunchRoot=Join-Path $Root 'launch-01'
    $RunRoot=Join-Path $Root 'run-01'
    $Child=$null; $HashProbe=$null; $AttemptMarkerSha=$null
    $ClaimStream=$null; $Claimed=$false; $ClaimComplete=$false; $Phase='ATTEMPT_CLAIM'
    if ($Case -eq 'create_new') { [IO.File]::WriteAllText($AttemptPath,'QA_SENTINEL',[Text.UTF8Encoding]::new($false)) }
    $Body=$ClaimSource
    if ($Case -in @('write','flush','dispose')) {
        $constructor='    $ClaimStream = [IO.FileStream]::new($AttemptPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)'
        if ($Body.Split($constructor).Count -ne 2) { throw 'CONSTRUCTOR_INJECTION_RED' }
        $Body=$Body.Replace($constructor,'    $ClaimStream = [QaFaultStream]::new($AttemptPath, '''+$Case+''')')
    }
    if ($Case -eq 'readback') {
        function Get-Content { param([string]$LiteralPath,[switch]$Raw,[string]$Encoding) throw 'QA_INJECT_READBACK' }
    }
    $Block=[scriptblock]::Create("try {`n"+$Body+"`n    throw 'QA_UNEXPECTED_CLAIM_SUCCESS'`n"+$CatchSource)
    $Thrown=$null
    try { . $Block } catch { $Thrown=$_.Exception.ToString() }
    if ($Case -eq 'readback') { Remove-Item Function:\Get-Content -ErrorAction SilentlyContinue }
    if ($null -eq $Thrown -or -not (Test-Path -LiteralPath $AttemptRedPath)) { throw ('NO_RED '+$Case) }
    $Red=Get-Content -LiteralPath $AttemptRedPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $Expected=if($Case -eq 'create_new'){'already exists'}else{'QA_INJECT_'+$Case.ToUpperInvariant()}
    if ($Red.state -ne 'RED_STOP_NO_RETRY' -or $Red.phase -ne 'ATTEMPT_CLAIM' -or $Red.error -notmatch [regex]::Escape($Expected)) { throw ('RED_CONTENT '+$Case) }
    if ($Case -eq 'create_new' -and [IO.File]::ReadAllText($AttemptPath) -ne 'QA_SENTINEL') { throw 'SENTINEL_CHANGED' }
    if (Test-Path -LiteralPath $RunRoot) { throw ('RUN_CREATED '+$Case) }
    $Results += [ordered]@{case=$Case;injected_constructor=($Case -in @('write','flush','dispose'));error=$Red.error;thrown=$Thrown;red_sha256=(HashFile $AttemptRedPath);marker_present=(Test-Path -LiteralPath $AttemptPath);marker_sha256=$(if(Test-Path -LiteralPath $AttemptPath){HashFile $AttemptPath}else{$null});run_absent=$true}
}
$Proof=[ordered]@{state='B31_G2_PREP03_EXTRACTED_CLAIM_FIXTURE_PASS_NO_PRODUCT';at_utc=[DateTimeOffset]::UtcNow.ToString('o');launcher_path=$Launcher;launcher_sha256=(HashFile $Launcher);shell_path=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName;shell_sha256=(HashFile ([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName));shell_version=$PSVersionTable.PSVersion.ToString();claim_source_sha256=(HashText $ClaimSource);catch_source_sha256=(HashText $CatchSource);method='exact claim/catch source; write/flush/dispose replace only FileStream constructor with QA fault stream; readback shadows Get-Content';cases=$Results;product_imported=$false;launcher_executed=$false;g2_runner_executed=$false;test_db_created=$false}
$Json=($Proof|ConvertTo-Json -Depth 20)+"`n"
$EvidenceStream=[IO.FileStream]::new($ResultsPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try { $Bytes=$Utf8.GetBytes($Json);$EvidenceStream.Write($Bytes,0,$Bytes.Length);$EvidenceStream.Flush($true) } finally { $EvidenceStream.Dispose() }
Write-Output ('CLAIM_FIXTURE_SHA256 '+(HashFile $ResultsPath))