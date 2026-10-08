# QA03 Sub2API same-version API and consumer condition matrix (preparation only)

State: `MATRIX_ONLY_NOT_RUN`. This is a source-grounded acceptance design for the new local stage after offline OpenAPI generation. It does not invoke FastAPI, a database migration, a credential vault, a provider, Electron, or the generated client. No API call is approved by this document.

Revision v2 records MGR01's LOCAL edit decision from `LOCAL-EDIT-POLICY-QA.md` SHA-256 `54C28AE671F3FDB2D838B505AB4035E5E8ECD2EB94871D18A11C22F3CF06C1A2`. The prior matrix remains at `QA03-SUB2API-SAME-VERSION-API-MATRIX.md` SHA-256 `6742C35161631E15194EA5044D453051893D338354AE1EBD2A9E0E95D4D55DD2` as the before-decision record. Pinned old source hashes below are historical generation inputs, not a claim that the new rule is implemented.

## Fixed version and gate boundaries

Stage: `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-stage-01`. Offline generation run `QA03-LOCAL-OPENAPI-GENERATE-03` returned `PASS_OFFLINE_GENERATION_ONLY`; `run-01/result.json` SHA-256 `74E3A6B2A3D6449C9E65849ED93EB8A0F8B3D64B3DC250907D4EFF4B23D27E3E`. Pin the following stage files before a future API run:

| File under stage `source/` | SHA-256 |
|---|---|
| `services/api/src/aijian_api/provider_contracts.py` | `E904C154E0527DB6F1548048DBE58EADD89E591CA559225A9F5D643395C6FD49` |
| `services/api/src/aijian_api/provider_connection_routes.py` | `677C2268A07FB8989C196F5514A4329D851B9D3F12C58A6FFAF60FD9826A53EA` |
| `services/api/src/aijian_api/provider_connections.py` | `D25D9CC675A6D3BC0AF66D75D533FA6F328D9C962ACE7CF7E9035DEC86365D7D` |
| `services/api/src/aijian_api/provider_connection_repository.py` | `A1E73830FBCCF52335D59249A48290C8836B89AA46AD9D98A000AE690619FB57` |
| `services/api/src/aijian_api/main.py` | `ECD229676AB58DCBF569730996C7D2B74CE7CC350D23CDA9505E3046D262947A` |
| `packages/contracts/openapi.json` | `5DB5480A7CDFC5AADECECD9D9F6835148B289ED32427289250AAAEE3623C8AFE` |
| `packages/contracts/src/generated.ts` | `DE2B2F58314658A21576AE7E850CB93016A8A419F021E8E294F026FD95EAE8A0` |

The future API gate needs its own reviewed package and independent single-call approval. Use an isolated profile and a pinned fresh schema-v33 test database fixture; migration 32/33 belongs to a separate gate. Successful Sub2API create requires an API key and the service writes to its Vault. Any proposed success fixture must therefore inject an explicitly reviewed in-memory test Vault and a synthetic marker, with zero OS Vault and provider calls. This matrix does not authorize that fixture. Do not put a real key or even the test marker in result artifacts. Capture HTTP request/response status, request ID, safe response fields, SQLite revision/mode, Vault spy counts, PID/image and post-close readback. Stop at the first RED/UNKNOWN; no automatic resubmit.

## Proposed API cases, in order

All rows use the same pinned stage and isolated test database. “No change” means the provider row count, revision and `origin_mode` are byte/SQL-readback unchanged. API authentication and local request boundary must be established by a separately signed fixture; an auth failure is a harness failure, not the expected validation result.

| ID | Request / mode input | Expected HTTP and public data | Required state readback |
|---|---|---|---|
| A01 | `POST /api/v1/provider-connections`, `SUB2API`, public HTTPS base URL, explicit `origin_mode:null` | `422 VALIDATION_ERROR`; no provider ID | No row; test Vault `set/get/delete` counters 0 |
| A02 | Same `SUB2API` public HTTPS request with `origin_mode` omitted | `201`; response `data.origin_mode="PUBLIC_HTTPS"`, revision 1 | New row mode `PUBLIC_HTTPS`; list item mode non-null, revision 1 |
| A03 | `SUB2API`, explicit `origin_mode="LOCAL_LOOPBACK_HTTP"`, canonical literal `http://127.0.0.1:8317` and a port | `201`; response local mode, revision 1 | New row/list item local mode non-null; no network call to loopback |
| A04 | Explicit local mode with `localhost`, no port, out-of-range port, path/query, or trailing slash (separate requests) | Each `422 VALIDATION_ERROR` | No row or Vault call for each rejection |
| A05 | `SUB2API`, `origin_mode="PUBLIC_HTTPS"` with HTTP loopback base URL | `422 VALIDATION_ERROR` | No row or Vault call |
| A06 | `OLLAMA`, loopback base URL, `origin_mode` omitted, no API key | `201`; response `data.origin_mode=null`, revision 1 | Row/list item mode SQL `NULL` |
| A07 | `OLLAMA`, same valid request with explicit `origin_mode:null` | `201`; response mode `null`, revision 1 | Row/list item mode SQL `NULL` |
| A08 | `OLLAMA`, explicit `origin_mode="LOCAL_LOOPBACK_HTTP"` | `422 VALIDATION_ERROR` | No row |
| A09 | `PATCH /api/v1/provider-connections/{id}` on A02, `expected_revision=1`, switch to canonical local mode/base URL | `200`; response local mode, revision 2 | Same ID; SQL mode local, revision 2; list agrees |
| A10 | Repeat PATCH with stale `expected_revision=1` | `409 PROVIDER_CONNECTION_REVISION_CONFLICT` | No change from A09; list still local/revision 2 |
| A11 | PATCH A09 at `expected_revision=2` back to public HTTPS | `200`; response public mode, revision 3 | Same ID; SQL mode public, revision 3; list agrees |
| A12 | `GET /api/v1/provider-connections` after A02/A03/A06/A07/A11 | `200`; every `SUB2API` item has non-null mode matching SQL; non-Sub2API items have `null` | No credential value in response; no state change |

For A02/A03/A09/A11, confirm the returned response item is the available per-connection readback. Current `provider_connection_routes.py` declares **no** `GET /api/v1/provider-connections/{id}` detail route; a separate detail-GET acceptance row is `NOT_APPLICABLE_PENDING_ROUTE_DECISION`, not a fabricated 200. This does not prevent list and POST/PATCH response checks.

## Same-version consumer matrix (also NOT_RUN)

Pin the same generated artifacts above, plus these stage-local DEV07 desktop and DEV04 UI candidates. This list fixes identity for a future integration package; it does not approve running one.

| Owner | Stage `source/` path | SHA-256 |
|---|---|---|
| DEV07 | `apps/desktop/src/provider-connection-contract.ts` | `75E341279A7E787EE196940FB637D3534C7B66093D32B5E2A613AC7C37353DBF` |
| DEV07 | `apps/desktop/src/sub2api-connection-mutation-contract.ts` | `17392F8629550F1A6C495E68901721C528C05D6CCB538D49273959DC661151F7` |
| DEV07 | `apps/desktop/src/api-client.ts` | `7B4475800364301EDE5EA09AD9CAFD1A5E518F1BB54E5BF9D74AD7AF96D0AF3C` |
| DEV04 | `apps/studio-web/src/api/studio.ts` | `E70D8E2ED484340DC656AB6D0E1952F097E49AC41BEC9C225F21CC941570F286` |
| DEV04 | `apps/studio-web/src/domain/provider-settings-model.ts` | `D49E18FF2A1F01AD85CBF960B2349B04723C2958B0163B2D2CD8CF981B1AE0A7` |
| DEV04 | `apps/studio-web/src/domain/use-provider-connection-form.ts` | `E6F6403EC10E4B32B1F5A4E0CD29065C5AB804DBCC7D9B62E60557AE11D2EDDC` |
| DEV04 | `apps/studio-web/src/aivora/ProviderConnectionForm.tsx` | `AA9C9066EC87732604179F9C7931087268CB964024C33D14171F5FC41B88FA9F` |
| DEV04 | `apps/studio-web/src/aivora/Sub2APIConnectionManagement.tsx` | `9528A6384EFE5BF870EF0A27916CD2B28EF9D68B80CE4EC94013143ACB689CBA` |

Generated TypeScript currently says `CreateProviderConnectionRequest.origin_mode?: (PUBLIC_HTTPS | LOCAL_LOOPBACK_HTTP) | null`, `EditSub2APIConnectionRequest.origin_mode` is required, and `ProviderConnectionData.origin_mode` is optional/nullable. The OpenAPI edit schema has a `PUBLIC_HTTPS` default; backend edit omission therefore has a runtime default even though generated TypeScript requires the field. These are different levels of evidence. DEV07 runtime validators must enforce provider-kind-dependent response shape and reject a Sub2API create `null` before transport.

| ID | Consumer action / backend pairing | Required result and evidence |
|---|---|---|
| C01 | SUB2API create: field omitted, public HTTPS origin | DEV07 accepts the command; current DEV04 public UI sends omission, not `null`; backend 201 and public mode. Read response and list through DEV07 validator. |
| C02 | SUB2API create: explicit `null` | Generated type may compile, but DEV07 must reject before HTTP; direct API negative A01 remains 422. No durable row or Vault call. Do not use a cast to hide this difference. |
| C03 | SUB2API create: explicit `PUBLIC_HTTPS` plus public origin | DEV07 accepts, API 201, response/list public and revision 1. Current UI readiness flag is `false`; this is a future integration case, not current UI PASS. |
| C04 | SUB2API create: explicit `LOCAL_LOOPBACK_HTTP` plus canonical literal loopback+port | DEV07 accepts paired input; current DEV04 UI blocks the POST while its readiness flag is false. After a separately reviewed enablement, 201/readback must preserve local mode without a network/provider call. |
| C05 | Non-SUB2API create: omitted and explicit `null` (separate OLLAMA examples) | DEV07 accepts both; backend 201, response/list origin mode `null`. A non-null mode is rejected before HTTP or 422 at API. |
| E01 | Existing LOCAL connection: change only name/models/enabled | **Required future UI behavior:** freshly GET authoritative list, match ID and read current LOCAL mode/revision, send PATCH with explicit LOCAL and unchanged canonical local base URL plus current revision. PATCH response, list after reload/reopen and durable SQL row must remain LOCAL; `base_url`, `credential_ref` and other unedited fields stay unchanged, and revision increments exactly once. No silent public switch. |
| E02 | Explicit LOCAL→PUBLIC or PUBLIC→LOCAL switch | UI must show the user's mode/origin intent, validate paired origin and mode, send explicit mode with current CAS revision, read back both. Any old approved extraction scope bound to prior mode/revision must become invalid; this needs its own source/operation evidence. |
| E03a | Legacy raw client edit on existing LOCAL: omit `origin_mode`, retain canonical loopback HTTP base URL | Backend edit model defaults to `PUBLIC_HTTPS`; expect `422 VALIDATION_ERROR` during origin validation before CAS. Verify unchanged revision/mode/base URL and zero Vault writes. Keep this separate from E01. |
| E03b | Legacy raw client edit on existing LOCAL: omit `origin_mode`, supply a valid public HTTPS base URL and current revision | **MGR01 target rule:** reject the request with zero CAS, no state/approval change and unchanged mode/base URL/revision after reopen. **Pinned current-source prediction:** the edit model defaults to `PUBLIC_HTTPS` and may atomically CAS to public mode. This is a known candidate mismatch, not target PASS evidence. Do not run this old version as acceptance of the new rule; wait for DEV05's separately reviewed candidate and signed QA gate. |
| E03c | Legacy raw client edit on existing PUBLIC: omit `origin_mode`, supply a valid public HTTPS base URL and current revision | **MGR01 target rule:** preserve backward compatibility for public mode. Verify normal CAS, public mode after reopen, and unchanged credential reference unless explicitly edited. This case also requires a reviewed DEV05 version and its own signed gate. |
| E04 | Edit explicit `null` or mismatched origin/mode | DEV07 rejects `null` before HTTP; direct API should return 422 for both invalid bodies, with no partial row/revision update. |
| E05 | Stale CAS revision on edit | API 409 `PROVIDER_CONNECTION_REVISION_CONFLICT`; UI preserves intended write identity and reads back current mode/revision; no auto-resubmit or partial state. |
| R01 | Create/PATCH response and GET list | SUB2API mode non-null; non-SUB2API mode null. Pass DEV07 response validators and match SQL. A detail GET is absent in this code version and remains untestable. |

### MGR01 LOCAL edit policy samples for the next signed candidate

| Policy ID / matrix row | Initial state; request field presence | Target assertion |
|---|---|---|
| P1 / E03c | PUBLIC; omit `origin_mode`; valid public HTTPS URL; matching revision | Accept, remain PUBLIC, CAS r→r+1, `credential_ref` unchanged. |
| L1 / E03a | LOCAL; omit `origin_mode`; retain canonical loopback HTTP URL | Reject, zero CAS, mode/base URL/revision/ref unchanged. |
| L2 / E03b | LOCAL; omit `origin_mode`; replace with valid public HTTPS URL | Reject, zero CAS, mode/base URL/revision/ref unchanged. The pinned old backend may accept this; it cannot pass the target rule. |
| L3 / E02 | LOCAL; explicit `PUBLIC_HTTPS`; valid public HTTPS URL; matching revision | Accept, CAS to PUBLIC at r+1, ref unchanged, and old approved scope cannot be consumed. |
| L4 / E01 | LOCAL; explicit `LOCAL_LOOPBACK_HTTP`; same canonical loopback URL; metadata-only edit | Accept, remain LOCAL with same URL/ref, CAS r→r+1; same-profile close/reopen and ID-based authoritative list readback agree. |

For **each** P1/L1/L2/L3/L4, retain the raw request field-presence record (including whether `origin_mode` was omitted), HTTP status/error code and safe response receipt, authoritative database before/after mode/base URL/revision/`credential_ref`, approval hash and consumption count, and same-profile close/reopen readback. Keep concurrent CAS mismatch, invalid format, other-provider omitted/null, and create omitted/null as separate cases. Type checking alone cannot establish database or approval behavior. These assertions become runnable only after DEV05's new candidate, contract regeneration decision, review and independent single-call QA approval.

**Static readiness gaps:** `provider-settings-model.ts:8` has `sub2apiOriginModeWritesReady=false`. `Sub2APIConnectionManagement.tsx:148-187` builds the PATCH from the component's `connection` prop and does not call its `readCurrent()` before writing; that helper is currently used for reconciliation after the call. Consequently E01/E02 cannot be marked UI PASS from this source. A future implementation/review must resolve both before enabling local UI writes, then verify an isolated reload/reopen. The legacy omission cases E03a/E03b/E03c must remain separate client/API cases, not be conflated with current UI metadata edit. MGR01's new LOCAL omission rule supersedes the pinned backend's E03b behavior; this fixed-version matrix records the mismatch and does not claim acceptance.

## Contract discrepancy to carry into consumer review

Generated `CreateProviderConnectionRequest.origin_mode` is optional **and nullable**, so TypeScript permits `origin_mode: null`. The FastAPI model rejects that value specifically for `SUB2API` when it was explicitly supplied; omitting it selects public HTTPS through the service. A generated type alone cannot express that provider-kind-dependent runtime rule. Until an interface fix is accepted, a Sub2API consumer must omit the field for public HTTPS or send an explicit valid mode; it must never send `null`. This is a cross-layer contract gap, not a failure of the two-file offline generation gate.

Static evidence: `provider_contracts.py` lines 125-200 (create validation and explicit-null check), lines 203-242 (edit default); `provider_connection_routes.py` lines 31-48, 66-105 and 120-143 (list/create/PATCH responses); `provider_connections.py` lines 49-94 and 106-123 (default/public mode, Vault call, CAS); `provider_connection_repository.py` lines 107-195 and 374-377 (stored mode, revision CAS); `main.py` lines 411-418 and 891-900 (422/409 mapping). The next runtime API gate must prove these behaviors; this document does not.
