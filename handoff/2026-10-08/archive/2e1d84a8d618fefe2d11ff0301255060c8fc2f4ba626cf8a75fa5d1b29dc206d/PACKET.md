# QA02 c19 R1c TypeScript one-shot gate (prepared, unsigned)

This is fresh QA isolation after R1 harness RED and R1b dependency-topology RED. Both older packets, raw logs, results, and closure files remain unchanged. R1b failed in TypeScript pre-emit diagnostics because its QA `node_modules` junction exposed pnpm relative links without their root targets. It did not emit or launch a fake child; that result does not establish a product-source failure.

## Fixed source and QA-only dependency topology

- c19 baseline: `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`; HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`; status 111 lines; main SHA256 `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0`.
- MGR04 snapshot: `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-c19-r1-external-overlay-candidate-1\SNAPSHOT.json`; SHA256 `2E4EB5B707A1BC1BFEE33CDF71C373F61D0CCC4A0BA8DD80F434D34C64496987`.
- Physical `overlay/apps/desktop/src` contains all 57 baseline desktop TS files with exactly the four snapshot paths changed or added, totaling 59 TS files. All 59 source files and the fake child are byte-identical to R1b. `tsconfig.json` and `package.json` are byte-identical c19 copies; no compiler option is relaxed.
- QA-only junctions point `overlay/apps/desktop/node_modules` to c19 desktop dependencies, `overlay/node_modules` to c19 root dependencies, and `overlay/packages` to c19 packages. This preserves the pnpm relative-link destinations. All leaves and resolved real paths are checked against the exact c19 root. There is no install or author-worktree fallback.
- New fake-child profile: `C:\Users\Administrator\Documents\Codex\q2r1c-20260929`, absent before execution. Its extraction parent plus `x-XXXXXX` is 96 characters, within the candidate's 100-character budget.

## Static resolution preflight, completed

`closure-preflight.mjs` read tsconfig, called `createProgram/getSourceFiles`, `resolveTypeReferenceDirective`, and `resolveModuleName`, and wrote `CLOSURE-PREFLIGHT.json`. It did not call `getPreEmitDiagnostics`, `emit`, or launch a child. Results: **59 root TS files; 299 program files; 59 QA overlay sources; 240 c19 read-only dependency files; zero other sources; one release `main.ts` hit**. The entry hash is the snapshot main hash `BDAB4361B5D0671735253C8A57258FC48005165F07969DCD9D56C3BDC5636DAC`.

The preflight records actual canonical path, SHA256, package version, and package-manifest SHA256 for Node types 26.1.2, `@aijian/contracts` 0.1.0 (main and invalidation-operation), Vitest 4.1.10, and Electron 43.2.0. Every resolved path is under the fixed c19 root. `results-once`, `dist`, and the new profile remain absent.

## Proposed gate, only after new exact MGR02 signature

MGR02 must review the new manifest and provide a unique `MGR02-R1-[A-Za-z0-9_-]{8,100}` token expressly authorizing this packet. QA02 then invokes `node r1-gate.mjs --mgr02-approval=<new signed token>` once from this directory. An unsigned invocation or existing `results-once` is rejected. RED stops the attempt; no automatic retry.

The gate rechecks c19 HEAD/status/main, snapshot, every frozen package file, exactly four physical source differences, three junction targets and their dependency leaves. It compares every actual TypeScript program file's canonical path, category, and SHA256 with the frozen 299-file closure, plus Node/contracts/Vitest/Electron resolutions, versions, and hashes. Then it runs full desktop TypeScript pre-emit diagnostics and emit inside this QA overlay, records `results-once/typescript-closure.json` and release `main.js` hash. Only after compiler PASS does it run the Node fake child for ready/EOF, exact busy, false busy, wrong exit, timeout, and `_MEI` survivor cases, checking TEMP/TMP, parent environment, classification, and close/cleanup.

No Electron, real sidecar, HTTP/network, provider, or c19 write is in this gate. PASS would establish local TypeScript and controlled fake-child behavior only.

Prior RED evidence SHA256: R1 `raw-console.log` `B9F7FAAED676E7807B54D026694FAA8EB80258B31A6B7BA0EB5C158CEFF6B57B`; R1 `result.json` `8BA9ABF1B98B734ECC92B18B7BF2F9E6A0C683DE06006E6ECEAD4399414D9405`; R1b `raw-console.log` `02A8DAFC5E9E88AFA7A96BEDFC5942D3E4DBF117CF0605292197946BE03C4DAF`; R1b `result.json` `65216EFE6E6C8E74ACAAC23177287C91F593F0B1D9A04A603243AE18EF272AF2`; R1b `typescript-closure.json` `569F3A611BAD5AA4AB58049A4AB58756BACC64E726A1C2C2A7AEC25349DC286D`.
