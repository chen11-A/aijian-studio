# QA01: D/repo30 staged composition gate

Date: 2026-09-28. This supersedes only the composition blocker in `D-LIFECYCLE-ISOLATED-QA-PLAN.md`. The old nine-source author snapshot remains historical; it must not be mixed with this staging overlay.

## Fixed identity and static finding

`C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-d-repo30-c19-staging-metadata-base-2\STAGING.json` SHA-256 `AEE2D4715020F89B9480307E4E5C84ABEEFC38ECE771BAAFEE57B5EF5387095B` describes c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2` plus 27 staged sources and 125 retained c19 modules. Its local AST dependency table reports no unresolved modules or missing imported names. The narrowed readback again matches `main.py` `81C1F2FE...`, `sidecar.py` `8B0596AD...`, `repository.py` `C2104917...`, `product_export_claim.py` `F1C068AF...`, and product operation routes `8158A7FD...`. The older `09BCDB0C...` metadata is historical. The staging files live in an author worktree; a runnable QA copy needs its own sealed source package and independent readback.

The staged `sidecar.py` acquires the workspace lock before listener and repository creation (lines 228-254), injects one Job manager and export runtime (254-260), and registers the route through `create_app` (278-285). Normal shutdown orders `stop_accepting`, `shutdown_and_wait`, `join_workers`, then owner release only if no shutdown error (317-353). `main.py` registers the export router only when sidecar security and runtime are supplied (1083-1088). Startup recovery is still absent and intentionally closed. These are static source observations, not runtime acceptance.

## Next runnable, non-encoding gates

1. **Single module/import gate:** on an isolated copy with `AIJIAN_DATA_DIR` and resource root pointing only inside a new disposable profile, import the fixed overlay; check schema 30 opens and migration matches the separate repo30 result. Capture import stdout/stderr, created paths, SQLite version, and hashes. Do not import from a live author checkout.
2. **Route/auth gate:** construct the authenticated sidecar app on that disposable profile. Check unauthenticated requests reject, read-only GET and old exact same-key POST replay do not discover tools or start workers, mismatched replay returns 409, and a new operation is denied while the release allowlist is empty. Seed a synthetic old receipt with fixed identity; do not touch any user database or submit an approved new claim.
3. **Dual sidecar Busy73 gate:** launch controlled A/B against the same disposable profile, then close A and launch C once. Check B emits one complete busy line and exit 73 before ready, A still serves, B leaves database hash unchanged, C starts after A closes, and all PIDs exit. This checks the staged Python sidecar; the separate DEV07 desktop local Node/mock result does not prove this gate.
4. **Shutdown/Job gate:** only a controlled harmless local helper may enter a managed Job. Assert child exit/Job active count reaches zero before owner release; inject bounded failures without encoding. Preserve original failures and process identities. Do not run this until the isolated package and helper identity are fixed.

The above are ordered gates, not a blanket authorization to run them together. Stop on the first failure and retain raw evidence.

## Required one-shot QA envelope

- MGR04 seals a runnable copy of all 27 staged modules plus the 125 retained c19 dependency files, exact versions of config and launcher, manifest with SHA-256/readback, and the external package location. The current AST table alone is not the executable package.
- QA01 records Python/Node executables and hashes, a per-case disposable profile and SQLite pre/post/backup hashes, exact script and source manifest hashes, invocation argv/environment names (secret values redacted), raw stdout/stderr and HTTP response bytes, child PID/port/exit signal, no-residual-process check, and c19 status before/after. Test output is outside the product tree.
- MGR02 signs the finite cases and timeout/stop conditions before sidecar or Job process launch. A failed case stops that phase; no automatic resubmission, replay or encoder retry follows.

## Product changes still needed before a formal new claim

Keep the release allowlist empty and startup recovery disabled. DEV05 owns the minimum D wiring changes: package resource-root identity and safe output-root creation; a complete same-source release profile; and a verified lifecycle path for the installed execution image. The base lacks assembly, rights, and probe routes, so their owned API/UI evidence path must also be integrated and independently QA'd. DEV07 owns the desktop startup-error presentation using the already isolated Busy73 classifier; the frozen diagnostic module test does not prove Electron behavior. CTL/MGR04 must first establish that old unmanaged encoders are gone and approve UNKNOWN handling before DEV05 wires startup recovery. No formal new claim, ffmpeg/MLT run, provider call, user DB, installation, or overall acceptance is implied by these local gates.
