# MGR01 exact scope review request — B31 G3

Decision requested: review this exact, unchanged `B31_G3_METADATA_CAS_PUBLIC_BASELINE_ONLY` packet for QA-only execution scope. This request is not a grant. MGR02 alone decides whether to issue the one-shot grant after MGR01's review. Current state: no grant, attempt, profile, launch, run or RED; behavior `NOT_RUN`.

## Frozen identities

| Input | Absolute path / identity |
| --- | --- |
| Packet | `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\b31-g3-metadata-cas-prep-01\PACKET.json`; SHA-256 `4D4EF00CD44C5CEF80466A812CD0F74B40AF16370DB99B9E133F2D518C0F72E3` |
| Python runner | Same directory `g3_once.py`; fixed Python consumer SHA-256 `ED96FE49C2E3325298393D1C3C3EFEEE0F7FB122E4BFC0F359AF2FC3CF689DC8` |
| PowerShell launcher | Same directory `launch_g3_once.ps1`; SHA-256 `88D948C6A7661DF5144521D71547A76685AC3E5548E416F9B8C3747585A33F82`; parser errors 0 |
| B31 physical input | `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\b31-minimal-migration-prep-01\qa-physical-package`; 153/153 per G2 `PACKET.json` SHA `D706829FF6C2B942DB44C607EDC69A0E7A3D289081EEA96C1C2FA1BF5FF02CB9` |
| Python dependencies | `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\core153-import-gate-prep-01\qa-deps`; 157/157 per `DEPENDENCY-CANDIDATE.json` SHA `DCD7BF0BF0FB29B7A1247C33C62B4470AD15A89AB8658CC4845E84E7FDAE6AC7` |
| Interpreter and shell | Python 3.12 `-I -B` SHA `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602`; PowerShell 7.6.5 SHA `362A356CE7F0940EC74F73A8FC2C990A2CC24A38A11C90BBD8ECA947110AD139`; full paths are in the packet |
| Legacy QA DB | G1 `run-01/migrate-v30/workspace.sqlite3` SHA `89FF99C76E39603A62F28301F53DECA7447B138E7B05111FDB1D869076869B33`, 0-byte WAL; copied to this gate's run directory before product read |
| Prior receipts | G1 SHA `82AD81B7DCC0539B466D6C87CB622ECD8DC12923944A6ADEB40FA7D9A4F7A918`; G2 SHA `7A2B98A3F78602C1FE940D93C3856A92072E9388786C964CE9AB0354F24048A9` |

The fixed Python view has just rechecked 153/153 product and 157/157 dependency file sizes/hashes, all listed receipt/legacy DB hashes and the runner AST. PowerShell parsed the launcher with 0 errors. All five one-shot output/marker locations remain absent. Raw PowerShell reads of protected `.py` files expose a different view; product and runner SHA values above are from the fixed Python execution view.

## Exact expected behavior

1. Copy the already migrated schema31 QA DB; actual `ProviderConnectionRepository.list/get` sees six old rows with `credential_ref=id` and the original G1 main DB SHA remains unchanged.
2. Initialize a fresh schema31 DB. Create a synthetic PUBLIC_HTTPS SUB2API row and read it through a reopened repository with revision 1 and `credential_ref=id`.
3. Edit metadata through `update_metadata_cas`; revision becomes 2, URL/model/enabled/name change together, credential ref remains id, and a reopened repository reads the same row.
4. Stale revision, five public-mode invalid origins, non-text model and a non-SUB2API metadata update are rejected; each rejection leaves the semantic DB snapshot unchanged. No rotation operation is created. Check integrity and foreign keys.

Only QA-owned `run-01` DB/WAL/SHM and receipt, `launch-01` raw stdout/stderr/EXIT, `profile-01`, one-shot attempt/RED markers may be written. No product checkout, G1 original DB, c19, real user profile, key/Vault, provider, HTTP, IPC, Electron or UI writes/calls. No positive local-loopback acceptance: this fixed schema31 contract intentionally rejects a local SUB2API URL unless a later explicit mode version is accepted.

The launcher claims `ATTEMPT-USED.json` before preflight, uses a hidden bounded Python child and dual-stream capture, and stops on first unexpected RED. An attempt is never retried. Independent postrun review is required for DB semantic/sidecar readback, import paths, PID/exit/streams and source hashes before any PASS. MGR01 should record exact approved/rejected range and reason; if approved, MGR02 must independently rehash and issue a single-use grant with the packet, runner and launcher SHA values above. Migration32/33 and DEV05 local source candidates remain under separate `INTEGRATION_HOLD`; core153 G4 claim and G5 lock remain `OPEN/NOT_RUN`.
