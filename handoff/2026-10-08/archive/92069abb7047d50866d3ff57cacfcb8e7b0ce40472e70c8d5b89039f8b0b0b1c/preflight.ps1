Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923'
$snapshot = 'C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-project-name-cas-c19-overlay-1'
$expected = [ordered]@{
  'apps/studio-web/src/aivora/StoryPages.tsx' = '34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60'
  'apps/studio-web/src/aivora/model.tsx' = '0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211'
  'apps/studio-web/src/api/studio.ts' = '7521270E03EF55B649E8B0EA150FE859CB04EADFD7D84C0886FD856FDD378679'
  'apps/studio-web/src/aivora/adapters/projectManagement.ts' = '7B549DCDBE7A4E3F4051FD815E98B013A07610D995C24BB135EDEBA656F8CD66'
}
$manifestSha = (Get-FileHash -LiteralPath (Join-Path $snapshot 'SNAPSHOT.json') -Algorithm SHA256).Hash
if ($manifestSha -ne 'EE77C4EEB6B75A20C776CE9CF5C7048B14DEA23441F5F8B1F5B3F892DF5AF312') {
  'RED0|SNAPSHOT_SHA_MISMATCH'
  exit 2
}
$snapStory = (Get-FileHash -LiteralPath (Join-Path $snapshot 'StoryPages.tsx') -Algorithm SHA256).Hash
if ($snapStory -ne $expected['apps/studio-web/src/aivora/StoryPages.tsx']) {
  'RED0|FROZEN_STORY_BYTES_MISMATCH'
  exit 2
}
$red = $false
foreach ($entry in $expected.GetEnumerator()) {
  $path = Join-Path $repo ($entry.Key.Replace('/', '\'))
  $actual = if (Test-Path -LiteralPath $path -PathType Leaf) {
    (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  } else { 'MISSING' }
  $state = if ($actual -eq $entry.Value) { 'MATCH' } else { 'RED' }
  "$state|$($entry.Key)|$actual|$($entry.Value)"
  if ($state -eq 'RED') { $red = $true }
}
if ($red) {
  'RED0|C19_NOT_SAME_SOURCE|STOP_BEFORE_VITEST'
  exit 2
}
'INPUT_MATCH_ONLY|NOT_APPROVAL_TO_RUN'
exit 0
