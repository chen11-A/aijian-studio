# Explicit recovery of unresolved submitted video

This slice resumes only a previously accepted, locally recorded video request. It never submits generation, restarts the original StoryFilm job, changes a take, reapplies footage to a new draft, or calls image/TTS. The result is **raw video footage**, not a finished film, and does not include the original separately generated voice or subsequent composition. A user can explicitly save the recovered original bytes through the native chooser and use the existing import flow. Saving never overwrites an existing file.

## Trust and lifecycle

- Migration 52 adds `generation_video_recovery`; existing policy/attempt/fee/task rows and SQL stay unchanged. Attachment requires the original reservation/project/input and a main-attested stable account. Provider IDs stay private and are recorded immediately after the actual submit response. No ID is invented for pre-response crashes or older unknown attempts.
- The original poll and recovery share a nonblocking per-attempt OS file lock. Process exit releases ownership; no deadline frees budget or proves a provider stopped. A still-active original poll or another recovery returns BUSY. Lock files are retained and never used as stale-file timeout markers.
- Fresh main-owned account/bearer pairs sign the actual empty HTTP body for the same project and session. Renderer inputs are only API project ID and opaque local attempt ID. Wrong account/project/input membership is rejected before provider GET. Document retirement and account changes reject late native responses; chooser/download waits recheck before writing.
- Recovery performs one existing provider poll GET, then only the provider-returned HTTPS download when done. Pending, unreachable, failed/expired, malformed or unreadable downloads never release the hold. Failed provider evidence remains a counted failure. No request ID or unknown download is treated as success.
- Success uses the original actual-video readability verifier, preserves bounded bytes in a main/API-owned exclusive file, verifies them again, then commits output SHA/size and the original attempt's SUCCEEDED state together. A later read/export verifies the exact saved bytes again through a bounded single descriptor, checking file identity/size/timestamps before and after the read. The original task idempotency ledger remains intact, so recovery never reruns it.
- Metadata is closed and path-free: opaque local attempt, state, actual relative filename/SHA/bytes. Neither provider ID, account/input digest, bearer, original request text, download URL nor local path is exposed. A fingerprint is not authorization.

## Explicit limitations

The first page is bounded to 100 account-matching unresolved/recovered records and exposes `hasMore`; it does not claim older omitted records are settled. Older attempts without a recorded provider ID/account cannot be reconstructed and retain their original occupancy. Provider completion with no readable complete download stays unresolved. A changed draft/selected take is never automatically adopted; the saved raw result is explicit user material only. Image/TTS budgets and parent creative-request budgets are outside this slice. No real membership account or provider was used for tests.

## Evidence

- `unknown-recovery-final-core-tests.log`: nine-file production/GET/account/SQLite/migration and original budget regression matrix, 103 passed. The final bounded same-descriptor read hardening is separately covered by all twelve new API/service cases in `unknown-recovery-final-read-tests.log`; the earlier 103 is not claimed as a rerun after that hardening.
- `unknown-recovery-native-tests-final.log`: actual native consumer, fixed authorized IPC, sandbox preload, original StoryFilm client/IPC and failure-policy bridge.
- Real local FFmpeg video, original bytes, API account attestations, process lock exit, restart, pending/invalid/provider-failed holds, wrong scope/input, preserved task idempotency and output tampering are exercised.
- The first combined run (`unknown-recovery-core-tests.log`) kept 101 passes and one missing imported pytest fixture; explicit fixture re-export fixes collection. `unknown-recovery-full-ts-types.log` preserves the initial test dynamic-import extension errors. No production threshold or timeout changed to address either.

Root must run the original full Python/coverage and joint frontend/native gates on the frozen final API source. Local subsets do not replace those gates, Windows recovery remains a real platform validation, and a synthetic accepted video is not proof of quality or human review.
