$ErrorActionPreference = 'Stop'
$author = 'C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp'
$c19 = 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923'
$expected = [ordered]@{
  'apps/studio-web/src/aivora/StoryPages.tsx' = '3E59A3D1F9DF4818B7283013B4BB2EB2CD012AD2CCF73234ACEB897DDC94DE82'
  'apps/studio-web/src/aivora/model.tsx' = '4B6CCD357B481D772458EAE68B83B0A4BB7DA3574543109147EA4382FAA52A1B'
  'apps/studio-web/src/api/studio.ts' = '5598B535490C66107F9B4E35CC1EF6011552DD970A89663895AEF769228B1953'
  'apps/studio-web/src/aivora/adapters/projectManagement.ts' = '7B549DCDBE7A4E3F4051FD815E98B013A07610D995C24BB135EDEBA656F8CD66'
}
$red = $false
foreach ($entry in $expected.GetEnumerator()) {
  $relative = $entry.Key.Replace('/', '\')
  foreach ($tree in @(@{ name = 'author'; root = $author }, @{ name = 'c19'; root = $c19 })) {
    $path = Join-Path $tree.root $relative
    $actual = if (Test-Path -LiteralPath $path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash } else { 'MISSING' }
    $state = if ($actual -eq $entry.Value) { 'MATCH' } else { 'RED' }
    '{0}|{1}|{2}|{3}|{4}' -f $tree.name, $entry.Key, $state, $actual, $entry.Value
    if ($state -eq 'RED') { $red = $true }
  }
}
if ($red) {
  'RED_INPUT_MISMATCH: stop before Vitest, build, Electron, sidecar, or provider.'
  exit 2
}
'INPUTS_MATCH: this verifies source bytes only; it does not authorize the next gate.'
exit 0
