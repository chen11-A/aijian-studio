# AC05 front/desktop local QA preparation

**Prepared only.** MGR02 has not released c19 from QA01's backend window for QA03 execution. No script in this directory has been run against c19.

## Authority and boundary

- Historical 34-item author snapshot: `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260924-ac05-full-34\SNAPSHOT.json`, SHA256 `436DD18F7E5282BBA60889E7E3BBBF414A9F38B78AA40F7F050885B67C43BD3D`.
- Backend policy delta: `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260924-ac05-policy-task-id-fix-1\SNAPSHOT.json`, SHA256 `7E0FA120BF19FE4ACEE2B175605977F4EBA6C2A9BF05D538A1EEA7A61341D668`.
- Backend store delta: `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260924-ac05-store-response-id-fix-1\SNAPSHOT.json`, SHA256 `AE978F431BB1C763488B29F7834A084EE0B14BADF834986A022ABEB57B8E6224`. This external snapshot is prepared, but QA01 acceptance and MGR02 release are still pending.
- On release, verify the 34-item baseline plus both deltas, including each delta's original-file hash and the parent snapshot hash. Include any further explicitly released deltas before running tests.
- c19 target: `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`; MGR04 reported the initial protected 34/34 sync. QA03 must independently recheck the final authorized snapshot, HEAD/status and relevant process/lock state after QA01 releases c19 and MGR02 opens this window.
- No real Sub2API call, provider account, Electron UI, install, or native acceptance in this QA window.

## Sequence after release

1. Capture c19 source/status/dist fingerprint and verify all final authorized snapshot paths by bytes and SHA256. Verify both generated outputs and that no unknown status path appeared. Record the 34-item baseline and both patch snapshots separately.
2. Run the external Vitest files in this directory. `ac05-contract.test.mjs` checks the generated four V2 operations and preserves the PROJECT01 operation map; `ac05-ipc.test.mjs` checks top-frame and canonical-argument gates; `ac05-client.test.mjs` checks one queue POST, exact definitive 503, malformed 201/transport UNKNOWN, approval GET-before-POST, and versioned proposal 404/UNKNOWN. Retain stdout/stderr/exit separately for every run. If a product RED appears, stop before typecheck/build and notify owners with raw evidence.
3. If targeted QA passes, run from c19 root `pnpm --filter @aijian/studio-web exec tsc -b --force --pretty false`, then `pnpm --filter @aijian/desktop typecheck`, then `pnpm --filter @aijian/studio-web build`, then `pnpm --filter @aijian/desktop build`, each with raw stdout/stderr/exit and source/dist fingerprint. The forced Web check prevents reliance on the earlier incremental state.
4. Compare source/status at every gate and old dist against rebuilt dist; report local static/targeted/build result separately from real provider/native acceptance. Release c19 after QA03's own postflight.

The positive 201 queue receipt and positive one-call approval response require a complete server-consistent attempt fingerprint. The prepared client file currently tests fail-closed and request-shape behavior. Add a real validated fixture only if the frozen contract supplies a trustworthy one; do not invent a successful remote receipt.
