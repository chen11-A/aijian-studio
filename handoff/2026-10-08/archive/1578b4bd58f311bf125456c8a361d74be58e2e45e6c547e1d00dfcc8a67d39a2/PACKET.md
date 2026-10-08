# QA02 c19 R1 TypeScript one-shot gate (prepared, unsigned)

## Frozen inputs and ownership

- c19: `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`; HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`; status 111 lines; `apps/desktop/src/main.ts` SHA256 `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0`.
- MGR04 snapshot: `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-c19-r1-external-overlay-candidate-1\SNAPSHOT.json`; SHA256 `2E4EB5B707A1BC1BFEE33CDF71C373F61D0CCC4A0BA8DD80F434D34C64496987`.
- QA02 physical overlay: this packet's `overlay/apps/desktop`. It contains all 57 c19 desktop TS files, with exactly four snapshot differences, giving 59 TS files. `node_modules` is a QA-only junction to c19 desktop dependencies for read-only resolution. `tsconfig.json` and `package.json` are byte-identical copies.
- QA02 fake-child profile: `C:\Users\Administrator\Documents\Codex\q2r1-20260929` (absent before run); local application data is its `AppData\Local`. Extraction parent plus `x-XXXXXX` is 95 characters, under the candidate's 100-character budget.

## Gate, only after exact MGR02 signature

MGR02 must supply a unique token matching `MGR02-R1-[A-Za-z0-9_-]{8,100}` and explicitly authorize this exact packet. QA02 then invokes `node r1-gate.mjs --mgr02-approval=<signed token>` once from this directory. The script refuses an unsigned invocation and refuses any invocation when `results-once` already exists. Do not restart on RED without a new decision and fresh isolation.

The script first rechecks c19 HEAD/status/main hash, snapshot and every source-file hash, the four-path physical diff, copied config/package hashes, and the dependency junction target. It then typechecks and emits the **full** desktop TypeScript program in the QA overlay, including the release `main.ts` entry. It records every TypeScript program source and SHA256 in `results-once/typescript-closure.json`, plus emitted `main.js` and candidate module hashes. Any compiler diagnostic is RED and stops subsequent cases.

Only if typecheck and emit pass, the script launches QA02's `fake-child.cjs` with Node. The six isolated cases check ready/EOF close, exact busy line plus exit 73, false busy line, wrong exit code, startup timeout, and a survivor `_MEIqa02` directory. Every case checks child TEMP/TMP equal its unique wrapper, parent TEMP/TMP unchanged, forbidden parent marker excluded, classification, and cleanup only after close. The survivor is intentionally retained inside the QA profile as evidence. No Electron, real sidecar, HTTP/network, provider, or c19 source write is in this gate.

`results-once/result.json` records PASS or RED and the raw error stack. The console result must also be retained. A PASS means local TypeScript and controlled fake-child verification only; it does not establish native Electron, PyInstaller bundle, renderer, real sidecar, provider, or overall product acceptance.

## Static preparation status

- Physical overlay comparison: 57 baseline TS, 59 overlay TS, exactly four snapshot paths and hashes.
- `node --check` for `r1-gate.mjs` and `fake-child.cjs`: PASS.
- c19 default and `-uall` porcelain counts: both 111.
- R1 gate: **NOT RUN; MGR02 signature pending**.
