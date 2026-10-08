# QA03 new-composite Sub2API API package scope (draft, NOT_RUN)

State: `DRAFT_SCOPE_ONLY_NO_STAGE_NO_SIGN_NO_RUN`. This is the proposed scope for a **new**, separately reviewed QA package. It grants no permission to copy inputs, generate contracts, start a service, migrate a database, call an API, or consume an approval. The previously signed local stage and its OpenAPI generation result remain exact-version historical evidence.

## Source identity and admission gates

| Input | Identity / status |
|---|---|
| MGR01 LOCAL edit policy | `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260929-local-sub2api-stage-plan-1\LOCAL-EDIT-POLICY-QA.md`; SHA-256 `54C28AE671F3FDB2D838B505AB4035E5E8ECD2EB94871D18A11C22F3CF06C1A2` |
| QA03 v2 condition matrix | `QA03-SUB2API-SAME-VERSION-API-MATRIX-v2.md`; SHA-256 `A102B1586654DCF72C54A00F17C10537AC105EBDDFE2A0787CF45420B7A49E7A` |
| QA03 v3 consumer addendum | `QA03-SUB2API-SAME-VERSION-API-MATRIX-v3.md`; SHA-256 `3B6EA3B7E39DAD5A8FC680A4A768E618BA289670B89D7B2ACBF01A48D602BE57`. E06/E07 are desktop timeout simulations and are outside S/G/backend API scope. |
| DEV05 owner candidate | `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp\work\dev05-b31-local-gates-20260929\MANIFEST.json`; SHA-256 `56E09F7BE264316474FEA6F78EF7560D53266AE394C0DA314803BA34E40FDF24`; patch SHA-256 `342A4106E2F0F3BEAE503F0513C4AFCA39586FAA5A2195D5A109175139DC63A8` |
| New MGR04 composite | `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260929-local-sub2api-composition-3\COMPOSITION-INPUTS-v3.json`; SHA-256 `648AC433988F82A97935BB2AB5F2A5F21388ED8EBC1CF1822978715B32C36912`; 24 selected source files, zero physical owner overlaps, `stage_exists=false`, state `STATIC_INPUTS_ONLY_NEW_DEV05_POLICY_UNTESTED`. Its input-hash review does not grant a writer window. |
| New generated contracts | **PENDING**: owner decision on generatable schema; new isolated OpenAPI/TypeScript generation package and independent approval if outputs change. No manual `generated.ts` edit. |
| DEV01 schema 32/33 fixture | **PENDING independent migration gate**. The later API/DB behavior package may start only from a frozen, independently evidenced schema-v33 isolated DB fixture; S copy and G offline generation do not run or require migrations. |

DEV05's manifest has 11 source files. Relative to the prior composite, the policy change affects `services/api/src/aijian_api/provider_connection_routes.py` SHA-256 `155CB21B02BCB1B4A7790E21D959787450AA00ED55B42D1B034D91EA3A1C9D37` and `provider_connections.py` SHA-256 `D02727B3102B27478B22659470956A922BC973364C41B81F52D9FCA9C50BE83F`. These hashes describe the author candidate, not an independently accepted QA stage. DEV04's selected `apps/studio-web/src/api/studio.ts` is its frozen handoff `.after` SHA-256 `E70D8E2ED484340DC656AB6D0E1952F097E49AC41BEC9C225F21CC941570F286`; the live author file observed at `86557FBDF9598EEA5CF22316896B7E5940129806AF6CA9C80BFD5CDBDEC8A16B` must not be substituted. Package construction must read back every input against the new composite, detect duplicates/overwrites, and record a post-copy tree manifest before any runtime call.

## Separate stage-copy and generation packets

**Packet S (physical copy only):** MGR01 must fix the exact scope and MGR02 must sign a new unique one-call packet before any stage write. Proposed target is MGR04's `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-source-01`; it must be absent before the call. Reuse the frozen W0-v3 source manifest SHA-256 `CDF2C999AFBB77195E2FAF4F6EBA5BC89A8EC619FE3A4843330D26DAF0D67C28` (13,681 regular files and 771 internal links), the isolated S2 input manifest SHA-256 `A10A8E8266296C269BF02AB72603FFDCF8196B0B6B0C04FBA899BF4696BEB914` (187 selected backend source files and 596 dependency files), and the new 24-file composite overlay (23 replacements, one addition). Pin the QA-local exporter `scripts/export_openapi.py` SHA-256 `C0707D4C719C347667113222FF7211AC4EA00132A89D6F4EB19A2159300F3F5E`. The expected pre-generation tree is 13,870 regular source files, 771 internal links and 596 dependency files. Require byte/hash and link-target readback of the entire copied tree plus all original inputs after copy. Stop at the first mismatch. No generator, import, service or network call in S.

**Packet G (offline OpenAPI/TypeScript generation only):** prepare only after S has a signed PASS receipt and the backend contract owner freezes a generatable schema decision. Migration 32/33 is **not** a prerequisite for this offline generation. G needs a separate MGR01 scope and MGR02 single-call signature. Pin the exact S tree, QA-local Python/dependencies, stage-local `openapi-typescript` binary and every import boundary; allow only `source/packages/contracts/openapi.json` and `source/packages/contracts/src/generated.ts` writes. Audit zero provider/network, OS Vault and process-spawn side effects beyond the approved generator. Record exit codes, raw stdout/stderr, output hashes, whole-tree after-readback and same-source input hashes. Any G source or output change requires a new package and signature; historical v3 generation approval does not carry forward. Both S and G remain `NOT_RUN` here.

## Proposed future package boundary

The future packet should have a unique operation ID, exact composite and generated-contract hashes, immutable local input directory, selected API entrypoint, isolated profile/DB location, fixed synthetic credentials, authentication fixture, approved in-memory test Vault implementation, and a network guard allowing only harness-to-API loopback HTTP. It must explicitly deny OS Vault, provider traffic (including loopback provider calls), other outbound traffic, Electron, migrations, and automatic retry/resubmit. Record process image/PID, listening endpoint, request ID, sanitized HTTP request/response bytes, DB SQL readback, fake Vault call counts, approval hash/consume count and normal shutdown/reopen. Keep raw RED/UNKNOWN outputs. A harness/auth/locator failure is not an expected product validation result.

The packet needs independent scope review and one-call signoff before physical staging or execution. Stop on the first RED/UNKNOWN; any guard/fixture repair gets a new packet and signature. The old `QA03-LOCAL-OPENAPI-GENERATE-03` signature does not extend to this composite.

## API and policy sample set

Use v2 matrix A01-A12 for create/list/edit, null/omission, canonical loopback, non-SUB2API, CAS and response shapes. No `GET /api/v1/provider-connections/{id}` is present in the pinned old route; on the new composite verify routes anew and use list by ID plus POST/PATCH response if still absent. Do not claim a detail GET result without a route.

| Policy ID | Required request and target result |
|---|---|
| P1 | Existing PUBLIC; omit `origin_mode`; valid public HTTPS; matching revision. Accept, remain PUBLIC, CAS r→r+1, credential reference unchanged. |
| L1 | Existing LOCAL; omit mode; retain loopback URL. Reject before CAS; mode/base URL/revision/ref unchanged. |
| L2 | Existing LOCAL; omit mode; supply valid public HTTPS URL. Reject before CAS; mode/base URL/revision/ref unchanged. This was the old candidate's contract gap. |
| L3 | Existing LOCAL; explicit `PUBLIC_HTTPS`; paired public HTTPS URL; matching revision. Accept one CAS to PUBLIC, ref unchanged; old approval bound to previous mode/revision cannot be consumed. |
| L4 | Existing LOCAL; explicit `LOCAL_LOOPBACK_HTTP`; unchanged canonical loopback URL; metadata-only edit. Accept one CAS and retain LOCAL, URL/ref; close/reopen the same profile and read back by ID. |

For **each** P1/L1/L2/L3/L4, preserve exact raw request field presence (including omission), HTTP status/error/receipt, authoritative DB before/after mode, base URL, revision and credential reference, approval hash and consumption count before/after, and post-close/reopen readback. Include a stale-revision negative case with zero partial mutation. For A01 explicit SUB2API create null, assert 422 and zero row/Vault calls; omitted mode defaults PUBLIC. For other providers, separately test omitted/null and response null. The generated TypeScript type alone is not evidence of these conditional runtime rules.

## Separate consumer and product gates

DEV07 desktop response validation and mutation contracts, DEV04 Web readiness/metadata-edit flow, API schema 32/33 migration, real Vault credential behavior, provider traffic, Electron and full S2 product acceptance remain separate. The pinned DEV04 source has `sub2apiOriginModeWritesReady=false` and builds metadata PATCH without a fresh pre-write authoritative read. DEV07 has since sealed a newer desktop consumer candidate, while MGR04 v3 still selects the older DEV07 files; v3 S/G must not be described as same-version desktop consumer acceptance. A later desktop integration package needs MGR04's deliberate new composition. This scope cannot mark consumer behavior PASS.
