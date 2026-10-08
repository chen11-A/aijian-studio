# D export wiring on the c19/repo30 baseline

This is a static staging overlay. It has not been imported, built, migrated, or run. It does not modify the c19 checkout.

## Base and source choice

- Base: `c19-trim-211c9e8-qa-20260923` at `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`, with its working-tree `main.py`, `sidecar.py`, and `media_asset_routes.py` bytes recorded in `STAGING.json`.
- The staged `main.py` and `sidecar.py` are copies of those c19 files plus only the workspace lock, product export route, and managed Job lifecycle changes in `diffs/`. The c19 media route remains byte-identical (`931D14F8...`).
- `repository.py` is DEV01's fixed schema 30 source (`C2104917...`), copied from the recorded source path. The 23 other added modules are source copies from the author checkout. No schema 31 module is in the selected local import closure.

## Runtime order to verify

The sidecar acquires the workspace lock before opening its listener or repository. It creates one `ProductExportJobManager`, injects that instance into one `ProductExportRuntime`, and registers the route only in the authenticated sidecar app. Shutdown stops export submissions, terminates and waits for its managed Jobs, joins export workers, stops the other workers, then releases the workspace lock. Any shutdown error leaves the lock held until process exit. Startup recovery is not called.

The POST route checks a complete same-key request against the stored hash before tool discovery. A new claim still passes the release allowlist, assembly, media, rights, and probe checks. The release allowlist is empty. This overlay does not create an output directory or launch an encoder by itself.

## Remaining gates

- The c19 base has no episode media assembly, rights decision, or media probe routes. Its API cannot yet produce all evidence needed for a new formal D claim. Those routes and their UI flow require separate ownership and QA.
- The c19 desktop currently sets `AIJIAN_DATA_DIR` but not `AIJIAN_RESOURCE_ROOT`. Packaged tool discovery requires the latter and a verified resource tree. The desktop's generic startup error also needs its separate Busy73 classifier before users see a precise workspace-occupied message.
- The fixed schema 30 source and the copied modules require independent import, migration, route authentication, shutdown, and Windows Job verification. The AST closure in `STAGING.json` only checks local file and top-level symbol availability.
- Existing unmanaged encoder processes remain unknown. The workspace lock and future managed Job cannot prove their absence, so startup recovery stays disabled.
- A formal release profile, safe output root creation, and execution-image identity proof are still required before opening new export claims.
