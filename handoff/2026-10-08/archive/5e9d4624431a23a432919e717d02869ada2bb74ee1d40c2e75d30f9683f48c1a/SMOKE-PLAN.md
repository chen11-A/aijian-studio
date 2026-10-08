# Contracts runtime and module-format smoke (prepared, not run)

## Fixed inputs

- MGR04's future seven-file contracts runtime snapshot and its per-file SHA-256/byte manifest. The source gate is `20260928-contracts-runtime-source-gate-1/INPUTS.json`, SHA-256 `04312C1B9BD087018FC608757CCD1CCD68CD8E6107CD1622F9788E8730C0B4BF`; its `QA-HANDOFF.json` SHA-256 is `A07266F80E4935B3E477C61AAC5B062F0D78E40B216812BDFF2C838D5E305217`. The seven runtime outputs are not yet present. Do not use the c19 source package as a substitute for emitted files.
- MGR04's accepted 38-file desktop runtime snapshot: `20260928-release-desktop-runtime-38-1/FILES.json`, SHA-256 `227375AE5ED3AB42BD40BDDFD0694EDCE0B654C89B9D999399A68655BA9E369D`.
- Pin Node executable path/version/SHA, c19 HEAD/status, frozen source identities, the smoke runner SHA, and a single signed MGR02 approval SHA. The approval is valid for one fresh QA output directory only.

## Isolated layout

- Copy the frozen 38 desktop files into a fresh QA-only `candidate/app/dist/` and verify each copy's SHA/bytes.
- Copy the exact seven contracts runtime files, preserving the frozen package paths, into `candidate/app/node_modules/@aijian/contracts/`. Verify each copy's SHA/bytes and reject extra files/links. Preserve the frozen package name, version, `type`, and `exports` byte for byte.
- Place smoke harness files outside the candidate's package and desktop dist. Use child Node processes launched with `candidate/app/` as `cwd`; no `NODE_PATH`, loader, import map, package rewrite, or c19 write.

## Executable checks

1. Parse the frozen desktop files and require exactly the four known runtime consumers: `api-client.js`, `artifact-proposal-contract.js`, `invalidation-operation-ipc.js`, and `remote-source-extract-v2-contract.js`. Pin their file hashes and the two package specifiers actually used: `@aijian/contracts/artifact-proposal` and `@aijian/contracts/invalidation-operation`.
2. From each consumer's physical candidate path, use Node `createRequire(consumerPath)` to resolve and `require()` its package specifier. In a separate child process, execute `require(consumerPath)` for each consumer. Require exported runtime functions `isArtifactProposalResponse` and `validateInvalidationOperationPageQuery` where applicable. Capture exit, stdout, stderr, resolved path, and error code/message/stack separately for every case.
3. From a temporary `.mjs` harness under `candidate/app/`, run native `import()` of the package root and both subpaths. Check the named function exports on the two subpaths. Capture exit/stdout/stderr and resolved module URL/error separately. The harness is QA-only and is excluded from the 38-file desktop comparison.
4. Compare full copied input trees with both frozen manifests after the smoke. Preserve raw failures. Any failed import/require, package identity drift, unexpected file, or source/output drift is RED and stops the gate without automatic retry.

This gate establishes Node CJS/ESM module resolution and execution for the frozen runtime pair. It does not establish staging, Electron packaged execution, installation, provider behavior, or final acceptance.
