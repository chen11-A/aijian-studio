param(
  [Parameter(Mandatory=$true)][string]$HelperPath,
  [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($HelperPath, [ref]$tokens, [ref]$errors)
if (@($errors).Count -ne 0) { throw "Helper parse errors=$(@($errors).Count)" }
$found = @($ast.FindAll({ param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -eq 'Get-IdleMilliseconds'
}, $true))
if ($found.Count -ne 1) { throw "Idle function count=$($found.Count)" }
. ([scriptblock]::Create($found[0].Extent.Text))
$examples = @(
  [ordered]@{name='ordinary_10ms';now=[uint64]100;last=[uint32]90;expected=[uint32]10},
  [ordered]@{name='idle_floor_60000ms';now=[uint64]60000;last=[uint32]0;expected=[uint32]60000},
  [ordered]@{name='below_idle_floor_59999ms';now=[uint64]59999;last=[uint32]0;expected=[uint32]59999},
  [ordered]@{name='tick_wrap_11ms';now=[uint64]4294967301;last=[uint32]4294967290;expected=[uint32]11},
  [ordered]@{name='future_last_tick_unknown';now=[uint64]90;last=[uint32]100;expected=$null},
  [ordered]@{name='over_24h_unknown';now=[uint64]86400001;last=[uint32]0;expected=$null}
)
$cases = @($examples | ForEach-Object {
  $actual = Get-IdleMilliseconds $_.now $_.last
  [ordered]@{name=$_.name;expected=$_.expected;actual=$actual;pass=($actual -eq $_.expected)}
})
$passed = @($cases | Where-Object { $_.pass }).Count
$sha = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($HelperPath)
try { $helperHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
finally { $stream.Dispose(); $sha.Dispose() }
$record = [ordered]@{
  checked_utc=[DateTime]::UtcNow.ToString('o')
  ps_version=$PSVersionTable.PSVersion.ToString()
  helper_path=$HelperPath
  helper_sha256=$helperHash
  case_count=$cases.Count
  passed_count=$passed
  cases=$cases
}
if ([IO.File]::Exists($EvidencePath)) { throw 'Evidence already exists' }
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($EvidencePath, ($record | ConvertTo-Json -Depth 6), $utf8)
Write-Output "PASS=$passed/$($cases.Count)"
if ($passed -ne $cases.Count) { exit 1 }
