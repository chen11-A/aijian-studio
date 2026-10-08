# B31 desktop IPC QA plan

State: `PLAN_ONLY_AWAITING_VERSION_MANIFEST`. This QA root contains no imported product source, compiled bundle, mock run, provider call, Electron run, or acceptance receipt.

## Version and authority gate

Before staging or running any B31 TS/mock check, obtain MGR04's new per-file manifest and MGR01's independent review of the same manifest. The manifest must enumerate the four DEV07 desktop files, five DEV04 Web files, the fixed DEV01/DEV05 backend inputs, and every supporting dependency with absolute source path, bytes, SHA-256, owner, and supersession. It must explicitly name the six old DEV05 static-list rows replaced by newer DEV07/DEV04 author files. Reject missing, duplicate, unexpected, symlink/reparse, or hash-drifted files. Pin the exact manifest SHA in each later QA packet and receipt.

The c19 `main`, `preload`, and `api-client` contain reference material; integration is by reviewed segments from the new owner versions. Never treat the old c19 emitted renderer, old 40-row static list, or R2 EXE as B31 behavior evidence. Do not start full backend behavior until migration31 has its own PASS receipt pinned to the same candidate.

## Input closure

| Input | Required identity/evidence | Until received |
| --- | --- | --- |
| MGR04 new source manifest | Exact file paths, hashes, owners, six supersessions, package/lock/toolchain identity | No source staging or TS/mock run |
| MGR01 review | Explicit acceptance of the above manifest and desktop merge boundary | No source staging or TS/mock run |
| DEV07 desktop four | `main` registration and sender checks; `preload` bridge; `api-client` contract; fourth file as named by manifest | Do not infer fourth path |
| DEV04 Web five | Capability and mutation UI versions as named by manifest | Do not infer paths or state |
| DEV01/DEV05 backend | Fixed API contract, operation identity, save/CAS/rotate/UNKNOWN semantics | Contract planning only |
| Migration31 | Same-candidate PASS receipt and DB schema/version fingerprint | Full backend behavior held |
| Runtime prerequisites | Explicit separate authorization and fixed Electron/provider identity | No visible Electron or provider |

No fixture may contain a live key. Use an unmistakably synthetic canary string and store its expected hash in QA evidence; never write the literal to logs or receipts.

## Planned independent gates

1. **Identity and integration static gate.** Verify all input hashes and supersessions; inspect reviewed merge of `main`, `preload`, `api-client` at the segment level. Record the final QA staging inventory and exact source map. Reject an entire-file c19 overwrite or fallback import.
2. **IPC contract TS/mock gate.** In an isolated QA copy, exercise the exact channel in all three layers: main handler registered once, preload exposes only approved methods, api-client uses those methods with typed arguments and responses. Reject unknown channel/method, forged sender/window/frame, disposed window, cross-origin frame, stale capability, or renderer access to raw `ipcRenderer`.
3. **Mutation state gate.** Model save/CAS/rotate with one operation identity. Cover validation rejection before claim, accepted once, conflict/stale revision, duplicate same operation, UNKNOWN after claim, and subsequent GET with the **same** operation ID. Verify no automatic retry, resubmit, or new operation ID on UNKNOWN; UI retains a recoverable state and distinguishes authoritative completion from unknown outcome.
4. **Credential and capability gate.** Insert a synthetic canary only into the mock credential ingress. The authorized rotation request necessarily carries that value across its single IPC invoke and POST body; scan all responses, other IPC traffic, console, errors, persistence, and QA receipts for accidental disclosure. Confirm capability buttons follow backend capability/readback state, including disabled/unknown/revoked states, and cannot initiate an unapproved mutation.
5. **Resource guard gate.** Reverify the pinned R1 version for resource lookup, TEMP handling, profile/window lifecycle, and IPC sender binding. A hash change invalidates earlier R1 evidence; old R1 screenshots or R2 EXE are not substituted.
6. **Backend behavior gate, later.** Only after a same-candidate migration31 PASS, run bounded local/mock backend behavior using the approved database fixture and operation ledger. Preserve raw failures and stop on any ambiguity. This gate remains separate from TS/mock IPC and from native/provider acceptance.

Each gate gets an independent input manifest, command/environment, timeout, output inventory, stdout/stderr, exit code, and before/after hashes. A failed or timed-out gate writes RED and stops; no silent retry. Static, TS/mock, local backend, native Electron, provider, and product acceptance are reported separately.

## Output and write closure

The only current output is this plan under this QA root. Later QA-only staging, synthetic fixtures, packets, and receipts must remain under a new B31 QA subroot after the version gate. No writes to DEV01/04/05/07 product trees, c19, old reader G1 roots, migration31 DB, real credentials, or existing R1 evidence. A future run may write only its predeclared QA run/profile/log directories; establish before/after hashes for every staged input and any DB fixture. No network/provider calls and no visible Electron are in the present grant.

## Required handoff before execution

Record the new manifest path and SHA, MGR01 review result, exact owner file list and supersessions, planned QA root, toolchain identity, migration31 status, and the gate-specific acceptance table. If any input is absent or drifts, remain at `PLAN_ONLY_AWAITING_VERSION_MANIFEST` and request a refreshed version review.
