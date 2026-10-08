# QA03 local offline OpenAPI generation candidate v3

State: `PREPARED_FOR_NEW_MGR01_SCOPE_REVIEW_AND_MGR02_INDEPENDENT_ONE_CALL_APPROVAL`. No v3 approval or formal `run-01` exists. The real exporter and real openapi-typescript CLI have not been invoked in v3 preparation.

## Lineage and current boundary

- v1 `PACKAGE.json` SHA-256 `BDFA1D9A38D5314000C28281C6F5C8D31A3C63208C412A3001EFF866CA558870` was rejected as `NOT_RUN` and remains intact in its original packet.
- v2 `PACKAGE.json` SHA-256 `9AA65279BD36E9C6B1AACB381C821B5F6DAE9FEA00D9BEB559CAF64E1F3662C8` consumed its one signature and ended RED. The fixed Python child exited 1 before the exporter ran: `keyring` imported `jaraco.context`, which called `platform.system()` and local `socket.gethostname()`; the QA guard classified that read-only query as network activity. Node never started. The original v2 packet, approval, raw stderr and `run-01` are preserved. Selected copies are in `lineage/`. v2's failure readback proved the full stage unchanged and the isolated environment empty.
- v3 fixes only that QA classification. It allows `socket.gethostname` with exactly zero audit arguments and counts such events without recording, replacing, or printing the hostname. Every other `socket.*` audit event remains denied, including DNS, connect, bind, listen and send. The six keyring/Vault entry points and child processes remain denied.

## Fixed inputs and one-call scope

- Stage: `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-stage-01`. `STAGE-BASE-MANIFEST.json` pins its 14,466 regular files and 771 internal relative symlinks. `DISCOVERY.json` pins the sidecar Python, Node 24.15.0, exporter and real stage-local CLI file and SHA-256.
- Call ID: `QA03-LOCAL-OPENAPI-GENERATE-03`; scope: `ONE_OFFLINE_TWO_OUTPUT_GENERATION_NO_MIGRATION`.
- Only `source/packages/contracts/openapi.json` and `source/packages/contracts/src/generated.ts` may change, and both must have new SHA-256 values. OpenAPI and generated TypeScript must expose `PUBLIC_HTTPS` and `LOCAL_LOOPBACK_HTTP` in the relevant Sub2API `origin_mode` models. A synthetic validation sentinel checks omitted public HTTPS behavior, explicit null rejection, and explicit local loopback acceptance without making a provider request.
- Python is launched with fixed `-I -B -S`; its wrapper inserts stage API source and `deps/`, installs write/network/process guards, imports real keyring, patches six Vault entry points, then imports API code. Node is called by its fixed executable and stage-local real CLI, with a stage-relative OpenAPI input, a `file://` preloader, permission model, module realpath audit and exact-output write guard. The old `.bin` shims, `uv run`, `NODE_PATH`, migrations, provider, worker, Vault, Electron and product runtime are outside scope.
- The parent records PID, actual process image and SHA, exit code, raw stdout/stderr, loaded-module realpaths, and isolated APPDATA/LOCALAPPDATA/TEMP/home/cache state. The entire stage is read before execution, after each successful child and again in `finally` after any outcome. That final independent receipt records both outputs' current bytes/SHA, tree counts and full readback; an audit exception forces RED. The first failure stops; no child or call is retried.

## Pure QA and limits

`QA-FIXTURE-RECEIPT-07.json` is `PASS_PURE_QA_NO_REAL_GENERATOR`. The probe ran the actual stage-local `keyring → jaraco.context → platform.system` import chain under the revised guard; eight local platform metadata methods passed, the no-argument hostname query was counted twice, and no hostname value was emitted. Synthetic audit events for DNS/connect/bind/listen/send/lookup and an actual socket constructor were denied; six Vault aliases were denied. Dummy Python and Node children wrote partial fixture outputs and exited 7/8; failure inspection retained their output hashes and rejected an added third file. The earlier Node permission/preloader, process identity and relative URL fixtures also passed. Full stage readback before and after the fixture matched the 14,466/771 baseline. This does not establish that the real exporter or CLI will complete.

Node's [permission model](https://nodejs.org/download/release/v24.15.0/docs/api/permissions.html) is a bounded aid for trusted code; it is not a malicious-code sandbox and follows symlinks. All 771 stage symlinks are pinned and resolved inside the stage. The module realpath guard uses [Node 24 synchronous module hooks](https://nodejs.org/download/release/v24.15.0/docs/api/module.html).

## Required new authorization

MGR01 must review this exact v3 package. MGR02 must independently create `MGR02-APPROVAL.json` in this v3 root with `approved_by: "MGR02"`, `call_id: "QA03-LOCAL-OPENAPI-GENERATE-03"`, `scope: "ONE_OFFLINE_TWO_OUTPUT_GENERATION_NO_MIGRATION"`, `stage_root` equal to the fixed stage, and `package_sha256` equal to this v3 `PACKAGE.json` SHA-256. Earlier signatures grant nothing to v3.

Only after that new signature may QA03 invoke the fixed sidecar Python once with `-I -B -S generate_once.py MGR02-APPROVAL.json`. Any RED/UNKNOWN keeps all raw output and partial stage evidence and ends the call. A PASS would prove only this isolated offline generation, not migration 32/33, provider, Electron, native or full S2 acceptance.
