# QA02 c19 R1b corrected one-shot gate (prepared, unsigned)

This is a fresh QA isolation after the R1 harness RED. The original R1 packet and its `raw-console.log`/`results-once/result.json` remain unchanged at sibling `qa02-ts-r1-20260929`. Original RED was `AssertionError: release main entry absent` at gate line 115, before diagnostics or emit; it is not a TypeScript product result.

## Frozen inputs and physical overlay

- c19: `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`; HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`; status 111 lines; baseline `apps/desktop/src/main.ts` SHA256 `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0`.
- MGR04 snapshot: `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-c19-r1-external-overlay-candidate-1\SNAPSHOT.json`; SHA256 `2E4EB5B707A1BC1BFEE33CDF71C373F61D0CCC4A0BA8DD80F434D34C64496987`.
- QA02 physical overlay: `overlay/apps/desktop`, copied from the original frozen overlay. It has 57 baseline desktop TS files plus exactly the four approved snapshot differences, totaling 59 TS files. `node_modules` is a QA-only junction to c19 desktop dependencies for read-only resolution. Config and package metadata are byte-identical c19 copies.
- New fake-child profile: `C:\Users\Administrator\Documents\Codex\q2r1b-20260929` (absent before run), with `AppData\Local` inside it. Extraction parent plus `x-XXXXXX` is 96 characters, under the candidate's 100-character budget.

## Harness correction and static preflight

Only harness path handling changed from R1: `path-canonical.cjs` resolves each existing path and normalizes separators/case. `r1-gate.mjs` uses it for the release `main.ts` equality check and the overlay/c19 source classifications; the fake child and physical TypeScript overlay are byte-identical to R1. The profile name changed for isolation. The original R1 script and RED evidence are untouched.

`closure-preflight.mjs` ran once in this new QA directory. It read tsconfig, called `createProgram` and `getSourceFiles`, and wrote `CLOSURE-PREFLIGHT.json`: **59 root TS files; 116 program files; 59 QA overlay sources; 57 c19 read-only dependencies; one release `main.ts` hit**. It did not call `getPreEmitDiagnostics`, `emit`, or spawn a child. `results-once`, `dist`, and the fake-child profile remain absent.

## Proposed gate, only after a new exact MGR02 signature

MGR02 must review this packet's new file hashes and provide a new unique token matching `MGR02-R1-[A-Za-z0-9_-]{8,100}` with explicit authorization for this package only. QA02 then invokes `node r1-gate.mjs --mgr02-approval=<new signed token>` once from this directory. The script refuses unsigned runs and any run when `results-once` exists. RED stops the attempt; no automatic retry.

The gate rechecks c19 HEAD/status/main hash, snapshot and all source-file hashes, exactly four physical overlay changes, copied config/package, junction target, and every frozen package file. It also compares every actual TypeScript program file path, category, and SHA256 with the frozen 116-file `CLOSURE-PREFLIGHT.json` before diagnostics. It then typechecks and emits the full desktop TypeScript program in this QA overlay, recording `results-once/typescript-closure.json` and the release `main.js` hash. Only after compiler PASS does it launch QA02's Node fake child for ready/EOF, exact busy, false busy, wrong exit, timeout, and `_MEI` survivor cases. It checks child TEMP/TMP, unchanged parent TEMP/TMP, forbidden environment filtering, classification, and close/cleanup boundary.

No Electron, real sidecar, HTTP/network, provider, or c19 source write is in this gate. A PASS establishes only local TypeScript and controlled fake-child behavior, not native product acceptance.
