# QA01: D 4-1 managed export and ART04 TEST static dependency matrix

Date: 2026-09-28. Scope: frozen source and direct dependency inspection only. No import, source execution, build, Win32 process launch, MLT, product edit, or c19 sync was performed for this review.

## Frozen identities

| Evidence | SHA-256 | Static result |
| --- | --- | --- |
| `20260928-d-managed-export-integration-candidate-4-1/SNAPSHOT.json` | `839074A0F355D42E5AAC2E309184524E10F90C14817EDECB544FC1AE7B6A6CA4` | Four source bytes independently matched the manifest below. |
| `product_export_windows_job.py` | `11A5762844F0C79471DFB46719E00ACC0D951A71FAC4E11F9C58202A2DBACFA2` | New managed Windows Job primitive and sidecar-owned manager. |
| `product_export_encoder.py` | `6DB31BA0542B074853A5F86833B2719AE2524B02ADCF95A5592DD3FA36EB59B8` | Replaces prior `26634F0C...` for this candidate; calls the Job manager. |
| `product_export_operation_coordinator.py` | `696754FFADE0FEA4235E28FD131DF9D6DAB6AE40A49C104A3A58E3F3057E3D09` | Same bytes as earlier coordinator candidate. |
| `product_export_single_video_service.py` | `C627B78393F0A1344A4DD21A43DDFF99A89C0C9AA379396D62A8D28FB00654DE` | New concrete service/executor, no route registration. |
| MGR04 `20260928-d-product-export-coordinator-dependency-audit-1/DEPENDENCY-AUDIT.json` | `D4878F7ACC489742EF8F4DF837543871AEFDECB5A50E6DB39CDF7CDCECB5840C` | All 17 listed frozen entity hashes independently matched. Audit is direct/first-layer only; its encoder `26634F0C...` is superseded in D 4-1. |
| `20260928-mlt-selected-test-entry-resolver-2-1/SNAPSHOT.json` | `31AD0998C79AAD637BD68F7AB69F55FE6900344B21FFE920B6871C8353D5C9A4` | New TEST entry `ECC6AAC0...` and resolver `8FC38278...` hashes matched. |
| `20260928-d-mlt-worker-revalidation-1/SNAPSHOT.json` | `4EC1448B57497A5EE59FFF400912E3BC0304D1DF108C30FBA17C64F705988C4A` | New worker `9E8E874A...` hash matched; old `1B262570...` is history. |

The c19 checkout inspected at this review remained HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`, with schema version 26. The four D 4-1 files, formal claim/schema files, and new TEST entry/resolver/worker were absent there. This is a point-in-time read; the release manager owns c19 synchronization.

## Interface and dependency matrix

| Boundary | Static evidence | Dependency / gate | Assessment |
| --- | --- | --- | --- |
| Formal service -> coordinator | Service lines 109-133 constructs `ProductExportOperationCoordinator` and `_SingleVideoExecutor`; `submit` passes executor to `submit_and_execute`. | No `main`/sidecar route or worker construction calls the service in the inspected author API tree. | Source interface connects; product entry is unwired. |
| Coordinator -> durable claim/state | Coordinator lines 124-172 calls `claim`, returns old same-key receipt, loads persisted `SINGLE_VERIFIED_VIDEO` plan, marks RUNNING, executes once, verifies/finalizes, and marks UNKNOWN on uncertain failure. | Frozen `product_export_claim.py` `A5EB43D6...`, store `58FBF5CB...`, contracts `080FA93C...`, render plan `74675F4E...`, output verifier `769B6EB6...`, schema `5FE02402...`, and repository `4032F9C2...` are outside D 4-1. Full recursive import closure has not been audited. | Static call shape matches the earlier direct audit. No durable QA from this review. |
| Concrete executor -> encoder | Service lines 51-106 checks RUNNING/plan/request/toolchain/source, output paths and cancellation; `run_local_encoder` writes a partial MP4, then `os.rename` publishes to target. | Requires managed imported source, rights/probe/assembly claim, output root identity, approved release toolchain and live worker. The claim's `_APPROVED_RELEASE_PROFILES` is empty (claim lines 37-40, 134-141), so new claims fail before ledger insert. | Single verified video only; D MLT plan is not accepted. No formal export can start with current release gate. |
| Encoder -> Windows Job | Encoder lines 161-169 calls `job_manager.spawn`; lines 224-232 stop, join readers and `release` on failure. Job lines 418-437 create suspended in a private kill-on-close Job before resume; manager lines 268-326 tracks and stops children. | No Win32 runtime check. Sidecar must construct one manager while holding workspace owner lock, block new launches, wait for workers and descendants, then release lock. That sequence is not wired in D 4-1 or the inspected `main`. | Static interface connected; orphan-prevention and shutdown behavior unproved. Job module header lines 4-5 still says it is not connected to the encoder, now stale documentation (FYI). |
| Schema and startup | Frozen repository SHA `4032F9C2...` declares schema 31 and ordered migrations 27 rights, 28 product export, 29 script confirmation, 30 probe, 31 credential ref (lines 819-826). Coordinator exposes `recover_interrupted_at_startup` (lines 63-69). | c19 remains schema 26; migrations and dependent source require coordinated merge and database upgrade QA. No inspected startup code calls recovery before accepting work. | Blocked for integrated durable/runtime claim. Never auto-retry CLAIMED/RUNNING/UNKNOWN. |
| ART04 TEST entry -> resolver/adapter/worker | Frozen entry `ECC6AAC00C28E550E587F0E2B0E6C45A25A8BFCEA3B7670ECAF6891032549C81` lines 76-112 checks runtime allowlist first, resolves selection, calls `selected.revalidate` before materialization, then passes the same callback to worker. Frozen resolver `8FC38278F13955526E9010475F8EE1189C15319362E9882B3B3D9E59F4D24BD3` lines 156-174 rebuilds fixture/bindings/selected authority/plan/resources. Frozen worker `9E8E874A983CB4CA98A6D44805570E111E796D031FCE202B7C18F026092D0EA0` lines 424-449 requires and calls callback immediately before render `Popen`; exceptions and non-`None` fail closed. | Entry's runtime allowlist is empty. Four real imported selected AssetVersions, latest human CLEARED rights, video probes, WAV inspection and REL02 MLT runtime remain unprovided. Resolver DB guard ends when callback returns; render launch and duration have a residual authority-change window. | New frozen callback wiring is statically coherent. It does not prove end-to-end execution or close the residual window. Old worker `1B262570...` and resolver `F394BC10...` must not be used as current verdicts. |

## Gates for the next review

1. MGR04/REL integration must pin the complete dependency closure and merge ordered schema 27-31, D 4-1 sources, TEST sources, sidecar owner-lock/Job lifetime, route/startup recovery, with exact post-sync hashes. The MGR04 audit above does not cover the new service/Job files or recursive closure.
2. With release approval still empty, validate old operation GET/replay behavior and preclaim rejection in an isolated profile before any real product claim. Do not turn an empty release gate into a test bypass.
3. For TEST, provide four imported selected versions and rights/probe/audio evidence plus a separately approved MLT runtime. Any authorized run needs its own identity, byte hashes, process/output, playable MP4 and receipt checks. Current static review is not native, media, durability or final acceptance.

## Review verdict

The frozen D 4-1 source forms a readable single-video service -> coordinator -> encoder -> Windows Job interface, and the new ART04 TEST entry passes the new pre-render revalidation callback statically. Integrated execution remains blocked by absent c19 source/schema/wiring, empty release/runtime allowlists, missing selected media authority, and untested Win32/MLT behavior. No source-level defect was proven by execution in this review.
