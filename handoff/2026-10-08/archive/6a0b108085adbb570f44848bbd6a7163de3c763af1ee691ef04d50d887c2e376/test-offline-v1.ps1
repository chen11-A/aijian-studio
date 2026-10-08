param(
  [Parameter(Mandatory=$true)][string]$SenderPath,
  [Parameter(Mandatory=$true)][string]$FixturePath,
  [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
if ([IO.File]::Exists($EvidencePath)) { throw "Evidence already exists: $EvidencePath" }
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $SenderPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw "Sender parse errors=$($parseErrors.Count)" }
foreach ($name in @('Get-NativeRevisions', 'Assert-NativeRevisionMatches')) {
  $nodes = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $name
  }, $true))
  if ($nodes.Count -ne 1) { throw "Sender function $name count=$($nodes.Count)" }
  . ([ScriptBlock]::Create($nodes[0].Extent.Text))
}
$fixture = [IO.File]::ReadAllText($FixturePath, (New-Object System.Text.UTF8Encoding($false)))
$line = '当前修订：1；评审证据修订：0'
if (($fixture.Split([string[]]@($line), [StringSplitOptions]::None).Length - 1) -ne 1) {
  throw 'Frozen original native revision line count differs'
}
$cases = New-Object 'System.Collections.Generic.List[object]'
function Check-Case([string]$name, [string]$text, [int]$expected,
                    [bool]$shouldPass) {
  $errorText = $null
  $parsed = $null
  try {
    $parsed = Get-NativeRevisions $text
    Assert-NativeRevisionMatches $parsed.revision $expected
    if ($parsed.review_evidence_revision -ne 0) {
      throw 'Unexpected review evidence revision in frozen-source case'
    }
  } catch { $errorText = $_.Exception.Message }
  $pass = if ($shouldPass) { $null -eq $errorText } else { $null -ne $errorText }
  [void]$cases.Add([ordered]@{
    name = $name
    expected_accept = $shouldPass
    observed_accept = ($null -eq $errorText)
    pass = $pass
    revision = if ($null -eq $parsed) { $null } else { $parsed.revision }
    review_evidence_revision = if ($null -eq $parsed) { $null } else { $parsed.review_evidence_revision }
    error = $errorText
  })
}
Check-Case 'original_v2_native_visible_text' $fixture 1 $true
Check-Case 'crlf_variant' ($fixture -replace "`n", "`r`n") 1 $true
Check-Case 'missing_both_revision_fields' ($fixture.Replace($line, '')) 1 $false
Check-Case 'missing_review_evidence_revision' ($fixture.Replace($line, '当前修订：1')) 1 $false
Check-Case 'duplicate_complete_revision_line' ($fixture + "`n" + $line) 1 $false
Check-Case 'duplicate_current_revision_label' ($fixture + "`n当前修订：2") 1 $false
Check-Case 'malformed_review_evidence_revision' ($fixture.Replace($line, '当前修订：1；评审证据修订：x')) 1 $false
Check-Case 'independent_get_revision_mismatch' $fixture 2 $false
$report = [ordered]@{
  checked_utc = [DateTime]::UtcNow.ToString('o')
  sender_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $SenderPath).Hash
  fixture_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $FixturePath).Hash
  case_count = $cases.Count
  passed_count = @($cases | Where-Object pass).Count
  cases = @($cases)
}
[IO.File]::WriteAllText($EvidencePath, ($report | ConvertTo-Json -Depth 6),
  (New-Object System.Text.UTF8Encoding($false)))
if ($report.passed_count -ne $report.case_count) { throw 'Offline native revision cases failed' }
Write-Output ('EVIDENCE=' + $EvidencePath)
