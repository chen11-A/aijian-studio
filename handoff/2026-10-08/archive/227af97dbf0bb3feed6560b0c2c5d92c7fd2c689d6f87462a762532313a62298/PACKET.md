# QA02 actual c19 desktop TypeScript one-shot gate (prepared, unsigned)

MGR04 has synced exactly the four R1 paths to c19. This packet reads the **actual c19 workspace** without a physical source overlay. It is separate from the prior R1/R1b RED packets and the R1c local overlay PASS packet; all prior evidence remains unchanged.

## Fixed inputs and static preflight

- c19 root: `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`; HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`; `git status --porcelain=v1 -uall` has 114 lines, raw UTF-8 SHA256 `FE92C6E787E71888226D3E3B9E5AE12833080C40194BA2C2A236BF6F7F258AEB`.
- MGR04 sync receipt: `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260929-c19-r1-four-path-prewrite-1\POST.json`, SHA256 `D7EF083ED343C9507725321BAF37333101E2E3B9DEDA0F25CEAAC00E82183D90`.
- Four c19 source SHA256: `main.ts` `BDAB4361B5D0671735253C8A57258FC48005165F07969DCD9D56C3BDC5636DAC`; `sidecar-process.ts` `DE5D46DCE9CEB276F67A968F0B271B37498814CECECAF7AD7712FB6DBE22710F`; `sidecar-startup-diagnostic.ts` `2B2147A6480824B6FBBC0489CB7A74780D04FE994C6C2F285E76308533FDABA6`; `sidecar-extraction-temp.ts` `6EA5A2BA8ACD40F46CEE5F8A6F035C824A5A3479D93DD1565FF0C550511F7821`.
- `static-preflight.mjs` used actual c19 `apps/desktop/tsconfig.json` with TypeScript `readConfigFile`, `parseJsonConfigFileContent`, `createProgram`, and `getSourceFiles`, plus read-only module/type resolution. It wrote `STATIC-CLOSURE.json`: 59 desktop root TS files, 299 program source files, 59 c19 desktop sources, 240 c19 read-only dependencies, zero outside c19, one `main.ts` entry. Node types, contracts (main and subpath), Vitest, and Electron resolved to version/hash-bound files under this c19 root. It did not call TypeScript diagnostics or emit.
- c19 `apps/desktop/dist` already has 57 files. `STATIC-CLOSURE.json` records their paths, byte lengths, and SHA256. c19 `apps/desktop/build`, root `dist`, and root `build` are absent. All four directories are compared again after the gate.

## Proposed gate, only after exact MGR02 one-shot signature

MGR02 must review the final packet manifest and provide a unique token matching `MGR02-C19TS-[A-Za-z0-9_-]{8,100}`, explicitly authorizing this packet. QA02 then invokes `node c19-ts-gate.mjs --mgr02-approval=<signed token>` **once**. Existing `run-01` or an unsigned invocation is rejected. RED stops the attempt; no automatic retry.

The gate rechecks the frozen packet, prior R1/R1b/R1c evidence, c19 HEAD/status/POST/four sources, existing c19 output directories, every one of the 299 TypeScript source paths and SHA256 values, and Node/contracts/Vitest/Electron consumer resolutions. It creates the TypeScript program from c19's real config and roots. Before emitting, it overrides **only `outDir`** to QA `run-01/dist`; a custom `writeFile` refuses any path outside that QA directory and checks the real destination parent. No c19 dist/build write is allowed. It runs full pre-emit diagnostics, then emits the full program, including release `main.js`, to QA. `run-01/result.json` and `run-01/actual-closure.json` retain raw outcomes and hashes. Postflight rereads all 299 source hashes, c19 status/four sources, existing c19 output directory contents, and packet files.

No Electron, real sidecar executable, fake child, HTTP/network, provider, or installation is in this gate. PASS would establish actual-c19 TypeScript typecheck plus emit to QA isolation only.
