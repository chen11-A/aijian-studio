# B31 `main.py` / `sidecar.py` consumer delta

Static source comparison on 2026-09-29. No c19 or author source edits were made. Recheck hashes before the sole c19 writer applies a patch.

| File | c19 SHA-256 | author SHA-256 | B31 action |
| --- | --- | --- | --- |
| `services/api/src/aijian_api/main.py` | `BBC596FDD33BDBD18A2ABEE96524CFDDCDA8A9D11AAFA76FC03FD11232D0900F` | `ECD229676AB58DCBF569730996C7D2B74CE7CC350D23CDA9505E3046D262947A` | Apply the five narrow changes below; preserve all unrelated c19 edits. |
| `services/api/src/aijian_api/sidecar.py` | `788E3942BC061D8AC48CDD950D6663DB7C72BDBA86C372FF677260C63C764E1C` | `03B5EE2E3C80BF3550AA918D4825451CAEADD8FF95BEDF20759F50E8C3FBD4F2` | No B31 change. c19 already composes the worker and passes availability; retain it. |

Minimal `main.py` B31 delta, using author line numbers as reference:

1. Extend the repository exception import with `ProviderConnectionVersionConflictError`, `ProviderConnectionWriteUnknownError`, and `ProviderRotationOperationExistsError` (author 145–152; c19 132–136). These names must come from DEV01's version 31 `provider_connection_repository.py` candidate SHA `96DAE6694953485C2A5FDD997E19D811B00A713E00EFD5559BF7B1FD1123F053`.
2. Import `Sub2APIConfiguredReadiness` and `create_sub2api_connection_readiness_router` (author 185–188). Their respective source SHAs are `B664D3C848B8651A8B4CF9A8B401A2B87E1E1C29778EE1C89F03C38E3467B299` and `3B806807340C208C705CDC361785087F59034842FB15E8834732504CD0F0393C`.
3. Add `get_sub2api_configured_readiness()` with the same repository path and Vault instance as `get_provider_connection_service()`, passing `sub2api_runtime_availability or (lambda: "UNAVAILABLE")` (author 375–386; insert after c19 331–335). The existing `create_app` availability parameter at c19 250 and `sidecar.py` c19 250 already supply this value.
4. Add redacted 409 handlers for revision conflict and duplicate rotation operation, and redacted 503 handler for unknown write (author 891–923; insert between c19 824–835 conflict and 836 not-found). The base conflict handler message can be generalized, but this wording change is not required for wiring. Preserve the normal error envelope and request ID.
5. Mount readiness router only inside `if sidecar_security is not None` (author 1171–1181; insert after c19 1081 app preferences). The existing provider connection router at c19 1077 already mounts the new PATCH/rotation/GET routes when their DEV05 route source is consumed. The existing middleware enforces the sidecar request boundary.

`sidecar.py` c19 182–205 already composes `Sub2APISourceExtractWorker` and `Sub2APISourceExtractRuntime` with the same Vault; c19 227–250 creates them and passes `sub2api_worker.availability` to `create_app`. The author file adds workspace lock, backup, export, and other changes outside this B31 delta; do not copy the whole file. The prior R2 EXE hash `2F23...` and its QA receipt concern only that separate workspace-lock runtime, not B31/schema31/provider/native acceptance.

The full B31 source list remains `CONSUMPTION.json` SHA `857E2575C764A054703EFFB4E8D3A08810C1479EBDBE8A04EE3FC76AA46BF699`. Its 40 author/c19 source pairs were all rehashed with zero mismatches before this comparison. No fixed Python consumer or behavior QA is claimed.
