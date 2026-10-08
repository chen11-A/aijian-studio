# DEV04 Sub2API generated-contract consumer, 2026-10-08

State: `SOURCE_ONLY_INTEGRATION_HOLD`. Unique DEV04 author root: `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`. The primary cwd `C:\Users\Administrator\Documents\sp` is a different checkout; its `apps/studio-web/src/api/studio.ts` SHA-256 was `C3C16D705C4D4BB7227B916BC63AE8F5949D642D51801C0A9E257624BF0BAD85` and was not written.

## Handoff lineage and physical source

- The later LOCAL save handoff is `C:\Users\Administrator\Documents\AIVORA\work\dev04-sub2api-local-save-preflight-20260929\HANDOFF.md`, SHA-256 `0EB92A759B637080574E99A1CBA03CC35197786290379F6F8DB972C1FD574380`. Its six author files still matched every sealed after SHA at the start of this turn. Its source enables LOCAL create, verifies create receipt plus ID-matched list readback, and reads authoritative mode/revision before a single metadata CAS PATCH. No file from that six-file set was changed on 2026-10-08.
- The older mode-transfer handoff SHA-256 `88F49ED420D83144FA85770A38B5402734A959AF4820BF2A1C9362AAAD12D31B` belongs to `C:\Users\Administrator\Documents\AIVORA\work\dev04-sub2api-local-mode-transfer-20260929\HANDOFF.md`; it predates the LOCAL save changes and is not the current Web UI snapshot.
- Today's only author-source change: `apps/studio-web/src/api/studio.ts` before SHA-256 `86557FBDF9598EEA5CF22316896B7E5940129806AF6CA9C80BFD5CDBDEC8A16B` (60372 bytes), after SHA-256 `536C156C9FF37936759CDC20FC02366B7CFBFA949DA39E601C611217689BC9BD` (60692 bytes). `studio.ts.before` and `studio.ts.after` in this directory are byte snapshots with those hashes.

Current DEV04 source set for QA pickup (all paths relative to the author root):

| File | SHA-256 |
| --- | --- |
| `apps/studio-web/src/api/studio.ts` | `536C156C9FF37936759CDC20FC02366B7CFBFA949DA39E601C611217689BC9BD` |
| `apps/studio-web/src/domain/provider-settings-model.ts` | `D4ED822CEFF78EC8CA635B5249160C2C1695EF679CD3486FEC6C2A3F9A35DAF8` |
| `apps/studio-web/src/domain/use-provider-connection-form.ts` | `E6F6403EC10E4B32B1F5A4E0CD29065C5AB804DBCC7D9B62E60557AE11D2EDDC` |
| `apps/studio-web/src/domain/use-provider-settings.ts` | `FAE5FB67F70A681F6CA85695AF522CBF3DDC9930E4471C5FC6CFD3751949E93C` |
| `apps/studio-web/src/domain/sub2api-provider-journal.ts` | `AB38D8BE7AA8A8585DEB19925B22184EFD48F7FA54C3BF12488738B06ED75FA9` |
| `apps/studio-web/src/aivora/ProviderConnectionForm.tsx` | `AA9C9066EC87732604179F9C7931087268CB964024C33D14171F5FC41B88FA9F` |
| `apps/studio-web/src/aivora/Sub2APIConnectionManagement.tsx` | `AAC9B02A6534698760C779807E7457C734D90EC4EE39CB4AE1D12D1079BA7656` |

## Contract alignment

The QA03 offline generated TypeScript at `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-stage-01\source\packages\contracts\src\generated.ts` has SHA-256 `DE2B2F58314658A21576AE7E850CB93016A8A419F021E8E294F026FD95EAE8A0`; its OpenAPI has SHA-256 `5DB5480A7CDFC5AADECECD9D9F6835148B289ED32427289250AAAEE3623C8AFE`. The generated Edit schema requires a non-null `origin_mode`. Today's `studio.ts` change selects that generated Edit schema as the CAS command type when it is present. It uses the prior legacy command type only in the old author tree, whose generated file still lacks the schema. Create input already takes generated fields while narrowing SUB2API mode to a non-null enum; list/receipt data already take the generated field when available. Neither generated output was edited or copied by DEV04.

## QA boundary

The author tree's `packages/contracts/src/generated.ts` is still SHA-256 `EF283C663DEAA7CE90FF997A08B5186166F594C926A62F99611BEC15F91C3BA2`. The LOCAL save candidate must be composed with the exact QA generated contract, DEV01/DEV05/DEV07 compatible sources, migrations and independent QA before runtime acceptance or deployment. Existing author-tree changes remain uncommitted. The frozen MGR04 v3 composition does not absorb this live source increment automatically.

Readback confirmed both snapshots and the after source SHA. Tracked `git diff --check` and the before/after no-index whitespace check had no output. No build, test, provider, Electron, deployment or real UI action was run in this increment.

## QA pickup

Use this handoff together with the 2026-09-29 LOCAL save handoff and QA03's `QA03-SUB2API-SAME-VERSION-API-MATRIX-v2.md`. Pin every composite input and obtain the separate QA authority before any run. In a same-version test tree, first confirm generated Edit schema selection and TypeScript compatibility. Then use an isolated profile/DB/fake Vault to verify LOCAL create receipt plus ID-matched list mode/revision, metadata edit's pre-PATCH GET and single explicit-mode CAS, stale/mismatched preflight with zero PATCH, post-write list reconciliation, and close/reopen pending-journal behavior. Check approval invalidation and credential reference in the owned backend/QA gate; the Web DTO does not expose that reference. Preserve UNKNOWN outcomes without an automatic resubmit.

The source-preview red-box CSS was only read: author `apps/studio-web/src/aivora/v2-story.css` SHA-256 `D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E` still contains the low-height grid/scroll rules, and `StoryPages.tsx` SHA-256 `C70CE0F6F8518C4EE042FFFE94762ACC2BF7CA365A400719B193778F46876B91` renders the two actions visible in real review: refresh source status and confirm the source-review baseline. The third review action is conditional on fixture state and is not part of the user's red-box acceptance. No CSS/StoryPages edit or native Electron acceptance is claimed; QA must use its separately authorized same-source Electron gate for the two existing buttons in a small window. Only a new same-source failure warrants a targeted CSS change.
