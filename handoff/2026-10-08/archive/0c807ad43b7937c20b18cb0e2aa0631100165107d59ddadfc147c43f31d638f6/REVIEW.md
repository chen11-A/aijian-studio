# QA02 B31 desktop IPC isolated TS/mock review

State: `STATIC_PREPARED_NOT_GRANTED_NOT_RUN`. MGR04's fixed same-version input manifest is `B91EE1F989B73E23B4740224643B95F48517F006448DCFD375F91E67C11E35B9`; MGR01 independently reviewed that version. This QA-only author overlay is separate from c19 integration. No TS typecheck, mock behavior, Electron, backend, migration31, or provider run has occurred.

## Frozen packet and inputs

| File | SHA-256 |
| --- | --- |
| `B31-PACKET.json` | `1DF6AB30293D9293D69143887710B1ED24456ADF450F7C6D0F45E987E7461E92` |
| `STAGE-MANIFEST.json` | `1EF4C5A055A534D389339CE27B4BBBFDA0C8F008991A3F891CE3B2CC06DE861A` |
| `TOOLCHAIN-MANIFEST.json` | `3CCC3BAEB62F5321465CE966B5761AF95533D29E63B8424E9329379739F0BF4C` |
| `desktop_ipc_mock_once.cjs` | `38E31AA087AC0B5F4A3B4D463331DC4480A5BA5F32DA8CDF535283E2FEEACA9D` |
| `launch_b31_once.ps1` | `E85B6B27CB8D7728F9EE437969AD44EFA7671CFD4792FBB96198088A9996FE33` |
| `verify_stage_static.py` | `94B7A00E39980ADA617A9005625FADDE2A89C36E998854E728DA158FCB9FB428` |
| `verify_manifest_static.py` | `DB77D94787CF8B379D02552275AB22E43D034645D4A3390BB09A3AA5CDFA4435` |
| `B31-STATIC-INVENTORY.json` | `434E159D8D39C12AD7C43B442576A6F493FAFFD18FD544F61B993ABA571D09B5` |
| `B31-STATIC-SOURCE.json` | `99AD3DCCA51AD7B9FFBDD86CDEA3B81A916C27D00DF1AB9C1B2F58F606A1AD9D` |
| `B31-STATIC-LAUNCH-CHECK.json` | `F5BBBBBD9AE706D9B93A021C1E3FD39E71BCB8639284951E061D424AFF5AC2C0` |

The stage physically contains 92 project files: all 80 desktop TypeScript sources plus its JSON dependency, three workspace contracts sources, and eight package/config/lock files. It includes all 14 DEV07 selected desktop paths at the exact MGR04 hashes. A separate physical toolchain copy has 286 files: TypeScript 132, Node types 91, Electron types 9, undici types 48, and workspace contracts 6. The Node binary is fixed at SHA-256 `3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5`. There are no stage symlinks. The author paths, stage copy, all selected 50 files, backend 194, six c19 baselines, eight reference originals, and six supersession mappings passed current read-only hashes.

The packet binds a new B31 desktop-only scope and output root. It excludes c19 writes, Web UI acceptance, migration31/backend behavior, visible Electron, and provider calls. `B31-GRANT.json`, `B31-ATTEMPT-USED.json`, and `run-01` are absent; the isolated profile has four directories and zero files.

## Proposed one-shot gate

The launcher checks grant presence before consuming an exclusive attempt. All packet/source/toolchain/profile/environment checks, the 30-second hash child, 120-second no-emit TypeScript typecheck, and 60-second local mock child are in one try/catch. A failure writes RED/EXIT/stdout/stderr and stops without retry. Both child streams and process-tree termination are bounded. It rechecks input hashes after the children and rejects any compiler `--listFiles` path outside the physical QA stage, so an author-tree fallback cannot become a PASS.

The mock loads staged modules only. It checks the main registration/source frame guard; the three preload channels and IPC registration; unauthorized sender and malformed arguments before client calls; metadata PATCH success, definite 409/422 and transport/503/malformed/wrong-request-ID unknown; one rotation POST, no automatic retry after uncertainty, and GET with the original operation ID for PREPARED/APPLIED/CONFLICT/UNKNOWN. A synthetic canary is allowed only in the authorized rotation IPC request and POST body, never in responses/evidence. No actual network or sidecar is used. UI capability-button behavior remains QA03/Web scope; c19 packaged-resource/TEMP/window acceptance remains a later integration gate.

## Static evidence and review boundary

Python AST, PowerShell parse, and Node syntax checks passed. The independent source and stage inventories passed, and seven launcher structure checks plus four mutated packet negatives passed without launching. The first stage preparation had a static file-count assertion because it omitted one JSON file; `PREPARE-STAGE-ERROR.txt` preserves that raw failure and the corrected static copy. The frozen launcher and mock are **unexecuted**. MGR01 scope review and a separate MGR02 exact-hash single-run grant are required before `launch_b31_once.ps1` is invoked.
