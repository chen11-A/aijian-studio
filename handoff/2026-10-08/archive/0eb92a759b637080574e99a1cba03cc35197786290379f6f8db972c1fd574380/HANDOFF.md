# DEV04 Sub2API Web local-save and authoritative preflight candidate

Author root: `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`

State: `SOURCE_ONLY_INTEGRATION_HOLD`. This is the DEV04 source candidate for a later same-version composition. It is not part of MGR04's frozen v3 input and is not a runtime or QA acceptance receipt.

| Author-root-relative file | Before SHA-256 | After SHA-256 | After bytes |
| --- | --- | --- | ---: |
| `apps/studio-web/src/domain/provider-settings-model.ts` | `D49E18FF2A1F01AD85CBF960B2349B04723C2958B0163B2D2CD8CF981B1AE0A7` | `D4ED822CEFF78EC8CA635B5249160C2C1695EF679CD3486FEC6C2A3F9A35DAF8` | 2520 |
| `apps/studio-web/src/domain/use-provider-connection-form.ts` | `E6F6403EC10E4B32B1F5A4E0CD29065C5AB804DBCC7D9B62E60557AE11D2EDDC` | `E6F6403EC10E4B32B1F5A4E0CD29065C5AB804DBCC7D9B62E60557AE11D2EDDC` | 4632 |
| `apps/studio-web/src/domain/use-provider-settings.ts` | `661C3F0AEE478FCC60B3037225AECE41115FF734AA9AD82D56D68F3DDB662CB7` | `FAE5FB67F70A681F6CA85695AF522CBF3DDC9930E4471C5FC6CFD3751949E93C` | 5238 |
| `apps/studio-web/src/domain/sub2api-provider-journal.ts` | `C3A54F75D68DA55DA5E5A45B3081B25606C48774BAFEB3041C5DB02767D2BD99` | `AB38D8BE7AA8A8585DEB19925B22184EFD48F7FA54C3BF12488738B06ED75FA9` | 3778 |
| `apps/studio-web/src/aivora/ProviderConnectionForm.tsx` | `AA9C9066EC87732604179F9C7931087268CB964024C33D14171F5FC41B88FA9F` | `AA9C9066EC87732604179F9C7931087268CB964024C33D14171F5FC41B88FA9F` | 6269 |
| `apps/studio-web/src/aivora/Sub2APIConnectionManagement.tsx` | `9528A6384EFE5BF870EF0A27916CD2B28EF9D68B80CE4EC94013143ACB689CBA` | `AAC9B02A6534698760C779807E7457C734D90EC4EE39CB4AE1D12D1079BA7656` | 17965 |

Each `*.before` and `*.after` file in this directory is a byte copy. The unchanged form and create hook rows are included to fix the complete local-mode UI builder input. The shared Web API type/transport file is unchanged in this increment: `apps/studio-web/src/api/studio.ts` SHA-256 `86557FBDF9598EEA5CF22316896B7E5940129806AF6CA9C80BFD5CDBDEC8A16B`.

## Source behavior

- The local-mode UI gate is enabled in this **candidate source**. A SUB2API create sends a non-null explicit mode from the existing builder. For a local create, the settings hook requires the create receipt and an ID-matched connection-list GET to agree on LOCAL mode, URL, revision 1, display name, enabled state, models and configured credential status before presenting ready state. Any mismatch becomes UNKNOWN with a read-only refresh; there is no automatic resubmit.
- Before a metadata PATCH, the management panel fetches the authoritative list by connection ID and requires exactly one matching SUB2API row with a known mode and safe revision. It compares the fresh mode, revision, URL, name, enabled state and models with the displayed snapshot. A mismatch stops before persisting a write or sending PATCH and refreshes the list. A concurrent second click is blocked.
- A valid edit persists a single intent with the fresh revision and explicit selected mode, then sends one CAS PATCH. Mode choice and origin must match. The post-write list readback must match the same mode, revision + 1 and full metadata before clearing the journal lock. Reopen preserves a pending lock; malformed stored mode values are rejected by the journal reader.
- A missing or invalid mode disables metadata write and shows a warning. The save button is disabled when the edit bridge is absent. Mode switching clears the old origin field and tells the user existing extraction approvals need renewal.

## Boundaries for MGR04 / QA

DEV05's new source-only manifest `work/dev05-b31-local-gates-20260929/MANIFEST.json` was read at SHA-256 `56E09F7BE264316474FEA6F78EF7560D53266AE394C0DA314803BA34E40FDF24`. DEV07's latest desktop `apps/desktop/src/api-client.ts` was read at SHA-256 `07D2373EDF175773A5DFBB7B1661A9D05CF8147283FAC2D50B555BA2B7A70B52`. The author tree still has old generated contracts and repository/migration integration remains outside DEV04 ownership. The UI gate being true is **not** a release decision; v4 composition and independent same-version tests must validate the full create/CAS/list/reopen and old-approval behavior before deployment.

Static tracked `git diff --check` and per-snapshot no-index whitespace checks had no output. Source and snapshot hashes were read back. No TypeScript build, test, provider call, deployment, or real UI run was performed in this DEV04 increment.
