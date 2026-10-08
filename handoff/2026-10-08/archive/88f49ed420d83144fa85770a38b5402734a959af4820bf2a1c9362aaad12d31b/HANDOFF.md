# DEV04 Sub2API origin_mode Web transfer candidate

Author tree: `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`

| Relative path | Before SHA-256 | After SHA-256 | After bytes |
| --- | --- | --- | ---: |
| `apps/studio-web/src/api/studio.ts` | `0D8F6CF403A15A1CA73ADBBDD4BB671E61F27AF64DB73BB84C45F7B1F3F007A6` | `E70D8E2ED484340DC656AB6D0E1952F097E49AC41BEC9C225F21CC941570F286` | 59600 |
| `apps/studio-web/src/domain/provider-settings-model.ts` | `392601AA87F304524A72589E8E6D562626E16BD44FD880A02005CF31FC2BFC1A` | `D49E18FF2A1F01AD85CBF960B2349B04723C2958B0163B2D2CD8CF981B1AE0A7` | 2512 |
| `apps/studio-web/src/domain/use-provider-connection-form.ts` | `B325EEDEA20E9BF337E6BC9BD5C028041D899DEFB188265E0B54F88C96E713BD` | `E6F6403EC10E4B32B1F5A4E0CD29065C5AB804DBCC7D9B62E60557AE11D2EDDC` | 4632 |
| `apps/studio-web/src/aivora/ProviderConnectionForm.tsx` | `FAD464B1AD5AC4635D3410839CE676EDEB3C048E3F6CA6275AEFFEFE7D2C55EB` | `AA9C9066EC87732604179F9C7931087268CB964024C33D14171F5FC41B88FA9F` | 6269 |
| `apps/studio-web/src/aivora/Sub2APIConnectionManagement.tsx` | `D4ED5475E332E395F99DD1A69886CCE5273AF7826A92413C9BB847A3D79EC00F` | `9528A6384EFE5BF870EF0A27916CD2B28EF9D68B80CE4EC94013143ACB689CBA` | 16371 |

Each `*.before` and `*.after` file in this directory is a byte copy of its author-tree source at the named snapshot. The table hashes identify those copies and the physical author-tree files at handoff time.

## Scope and behavior

- `studio.ts` overlays the not-yet-regenerated OpenAPI types with optional `origin_mode` on create input, list and receipt data, plus the CAS command. The bridge and HTTP transport pass the field through unchanged.
- Creation validates the selected mode. A single write gate, `sub2apiOriginModeWritesReady: boolean = false`, prevents local creation while contracts, desktop bridge and migrations remain unaccepted. The existing public HTTPS create request continues to omit `origin_mode` until the gate is opened.
- CAS initializes its selected mode from the listed connection. A mode-enabled command carries `origin_mode`; reconciliation requires the same mode, full metadata and revision + 1 in an authoritative list readback. Legacy public requests can still reconcile with a missing public-mode field. An existing local-mode connection is read-only while the gate is closed.
- No generated files, backend, desktop, c19 or source-03 files were edited by DEV04 in this handoff.

## Verification boundary

Read back the five source files and SHA-256 values above. Tracked-file `git diff --check` showed no whitespace errors. The untracked management component is covered by byte snapshot and a separate no-index whitespace check. No build, test, provider call, deployment or real UI session was run, as directed by MGR01. The candidate is not an integrated or accepted local Sub2API flow. Migration 32/33, generated contract and credential rotation remain separate OPEN gates.

MGR04: the earlier composition draft recorded the pre-edit hook SHA and must be rebuilt from this handoff. Do not reuse its stale DEV04 row.
