# c19 R1 protection: B31 desktop bridge integration audit

State: `READ_ONLY_C19_NOT_INTEGRATED_NOT_EMITTED_NOT_QA`. This is a hunk map,
not an approval to edit c19. Re-read every hash before an authorized write.

## Source identity

| Item | Author SHA-256 | c19 SHA-256 / status | Patch SHA-256 |
| --- | --- | --- | --- |
| `main.ts` | `A1359F9EBC54090AD882C12B85E5CFB36917060D20D6B2DE245D9E364EA04C32` | `BDAB4361B5D0671735253C8A57258FC48005165F07969DCD9D56C3BDC5636DAC` | `E3FE883A19F89730E5FDF67D709A9D617DDB85D180129DA84ED28834E4343793` |
| `preload.ts` | `77C06E152301829A2C46C3786BA6BA5F727AB189A2078D761C78993F16CD04F9` | `794006467A751EA1AE1F438EAE392BB7CE6082ADAE73C8D601A376EDF81340B1` | `CBB53A0F94787C222D2D9B72FFF6A8C7C276BB099F0FD8B15B0C23723A61C993` |
| `api-client.ts` | `BA060B639EF67B5EB9906D0F83746270C8F44CF902E95E7E031C7B313E8AFC61` | `D694B1B1C6EF96D55DB941ABF221214634F45065DB07C99207A5C48660E7EA3C` | `19F2D06A4F8605911C41B06B0D82FDE68B656835098E2CEE840B9215F3970AC1` |
| `provider-connection-contract.ts` | `B69804B482B58F35785525EC3348BB9569D181D8BA80B689C95DD92497582952` | `1BAD7DF94F2C5ABC4758A2887CE92AB69D4DA8E075CCAA14051DB6413BD4A5F3` | `97A878EDDA1FB482363523329E5C2F5DE82E6F5E6482F9D9486D8E59DE7C49CB` |
| `sub2api-connection-mutation-contract.ts` | `85F0D1FC41ED3CF5BF839335F63FFA2D0A27B86EAC79ED5B0D095B878CF3A844` | absent | `6F3D23CB2CFE0772A26BA079AB322958F5B8B5039029AE8C60FD81A97EC836B3` against author pre-edit only |
| `sub2api-connection-mutation-ipc.ts` | `D77C508700AA28B00B7B334E5F533028E997F55528E20290BF6040E8B659D0AC` | absent | no DEV07 edit patch |

The author tree also has `sub2api-configured-readiness-contract.ts`
`F8843BAFAEACA506D530E4E71161D2294C03770244D58CE9584BDC9241BD3411`
and `sub2api-configured-readiness-ipc.ts`
`4803184751A847EE3F6A7E9913FC4DD526825ADAD260060570793D6C1B63A030`;
both are absent in c19 and are separate readiness dependencies. The existing
`api-contract-guards.ts` is present in c19; its author SHA is
`7573C6CA20B1E6D6C8E2F7AE59E321B068544ACE99994A1AF301C94C86F41945`.

## Hunk-by-hunk overlap with c19

Read-only `git apply --check` of each `main.ts`, `preload.ts`, and
`api-client.ts` author patch against c19 failed at its first hunk. The
`provider-connection-contract.ts` patch *does* pass `git apply --check`
against c19's pinned old SHA; no patch was applied.

| Source patch hunk | c19 insertion point and conflict |
| --- | --- |
| `main.ts` `@@ -20,6 +20,7` import | c19 line 20 proceeds directly from media handlers to artifact/episode imports; it lacks the readiness and other later author imports. Insert only the mutation IPC import when its source file is present. Never copy the author import block wholesale. |
| `main.ts` `@@ -192,6 +193,11` registration | c19 has no readiness handler anchor. Its provider handlers end at lines 361-367; register the mutation handler near them with `mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame`. Preserve the c19 startup and resource sections. |
| `preload.ts` `@@ -39,6 +39,10` types | c19 type-only `./api-client` import closes at line 40 and has no readiness type. Add four B31 mutation types there after API client re-export exists. Keep the relative import type-only in sandbox preload. |
| `preload.ts` `@@ -430,6 +434,21` bridge | c19 has list/create/delete provider methods at lines 417-425 and no readiness method anchor. Add the three exact mutation channels near those methods; do not replace the exposure object. |
| `api-client.ts` `@@ -60,6 +60,20` import | c19 has no readiness import context; add mutation validators/types adjacent to its provider contract import, with `isSub2APIConnectionId` supplied by the new mutation contract or a pinned readiness dependency. |
| `api-client.ts` `@@ -234,6 +248,12` re-export | c19 provider type re-exports start near line 191; add the four mutation type re-exports without replacing later type exports. |
| `api-client.ts` `@@ -589,6 +609,15` interface | c19 `LocalApiClient` provider methods are lines 513-518; add the three method signatures there. |
| `api-client.ts` `@@ -2369,6 +2398,34` helper | c19 `createLocalApiClient` begins at line 2041 and already has `readJsonWithLimit` with deadline support. Place the bounded mutation HTTP helper inside this function, before its returned client object. Retain the existing canonical sidecar origin and session token guard. |
| `api-client.ts` `@@ -4339,6 +4396,68` methods | c19 returned object has `listProviderConnections` then `createProviderConnection` at lines 4063-4065. Add the three mutation methods at this seam; keep its existing create/delete implementations. |

The author `main.ts` has five direct relative imports absent in c19, and the
author `api-client.ts` has five more; only two mutation contract/IPC files
belong to this B31 bridge. The other absences are separate episode, source
acceptance, and readiness changes. Copying either whole author file into c19
would add unresolved imports and replace c19 R1 guards.

## R1 guards and new-version dependencies

Keep c19 `main.ts` lines 98-165 and 369-375: Windows packaged-only absolute
non-UNC resource root; no `..` and no symlink for root, sidecar, config lock,
EXE, renderer directory/index; renderer preflight before sidecar spawn; unique
sidecar extraction `TEMP`/`TMP`. Keep `sidecar-extraction-temp.ts` SHA
`6EA5A2BA8ACD40F46CEE5F8A6F035C824A5A3479D93DD1565FF0C550511F7821`
and `sidecar-process.ts` SHA
`DE5D46DCE9CEB276F67A968F0B271B37498814CECECAF7AD7712FB6DBE22710F`:
plain per-user extraction path, bounded child environment, no shell, process
close cleanup, and startup/shutdown deadlines. Keep
`sidecar-startup-diagnostic.ts` SHA
`2B2147A6480824B6FBBC0489CB7A74780D04FE994C6C2F285E76308533FDABA6`:
only complete untruncated stderr marker plus exit 73 classifies workspace Busy.
Those three R1 files currently match byte-for-byte in author and c19.

New QA requires a c19-integrated source revision with all required imports,
new TypeScript emit and loader closure, a renderer built from a B31 UI revision,
and a pinned sidecar EXE/backend source identity. The R2 sidecar EXE SHA is
`2F23AC50CEA16D60D3C2AA1013F11F7C7D00570767740C2026A9C4243468E692`
and source composite SHA is
`3A3DA222E44622DA5803AE80D9867FF69296BD394E7AC2132921F3C9C30FAE7B`;
its QA is R2 lock only, not B31 configuration behavior. The immutable 74-item
`20260929-packaged-isolated-readonly-plan-1/INPUTS.json` does not contain the
three current author hashes for main, preload, or api-client, and `GAPS.json`
still records eight missing packaging destinations. Neither is an approval to
assemble. The 9/28 c19 renderer and earlier QA02 desktop emit predate B31.
Later QA must bind exact source/emit/renderer/EXE/profile/PID hashes and run
metadata edit, rotation single POST/readback, top-frame rejection, origin
positive/negative cases, and the packaged R1 startup/TEMP/Busy/resource checks.
