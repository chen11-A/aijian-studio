# R05 Completion Lease Expiry Acceptance Evidence

## Scope and status

M2 is independently ACCEPTED on 2026-09-04 against baseline
`dc36de0288c56e2a18eda436e9e5cd01b1f91eb0`. Acceptance covers only the completion
lease clock fix and its regression/recovery tests. It does not claim to diagnose
or resolve a heartbeat issue, and it does not complete R05, M3-M5, K01, or GA.
The local integration result is recorded separately in the delivery ledger;
acceptance does not imply a GitHub push.

## Original reproduction evidence

The original RED run used a real SQLite `BEGIN IMMEDIATE` blocker and a worker.
It confirmed the completion `BEGIN IMMEDIATE` request had started while the
lease `SELECT` had not run, advanced the deterministic clock to T+31, and
failed because the old code did not raise `LeaseLostError`. Its successful
runner exit is separate evidence and does not by itself prove bounded cleanup.

The production candidate moves the existing completion clock sample to after
`BEGIN IMMEDIATE` returns and before the unchanged lease condition query. It
does not promise that a lease remains unexpired until transaction commit.

## Candidate checks

- The T+1 case completes using the original task, attempt, node, and output
  IDs. It verifies persisted successful statuses, output bindings, revision
  increments, T+1 completion timestamps, the current workflow success
  projection, and the existing three completion events at T+1.
- The T+30 and T+31 cases reject with `LeaseLostError`. A complete snapshot of
  workflow runs, ledger rows, attempts, nodes, artifacts, artifact versions,
  artifact heads, and transition events is unchanged while the worker is
  blocked and again after the rejected completion before recovery.
- At each expired boundary, receipt recovery reports one recovered, one
  succeeded, zero requeued, and zero failed. It retains the original task,
  attempt, node, and output identities, adds no Attempt or Artifact, preserves
  complete artifact rows and heads, appends only the existing three
  `output.receipt_recovered` events, and is all-zero and state-idempotent on a
  second recovery.

## Bounded cleanup

The test releases and closes the SQLite blocker before a bounded worker join.
It restores `ledger._open` during cleanup, reports a surviving worker, and
raises an `AssertionError` for every cleanup failure. When a primary failure
also exists, the assertion chains from it so neither the cleanup defect nor the
original traceback is hidden.

## Independent verification

The author supplied the RED/GREEN evidence and final four focused passing tests.
A separate read-only review closed all necessary correctness and cleanup findings.
The controller then verified the frozen production/test hashes and independently
ran the existing full Python suite and coverage gate, without changing thresholds
or excluded modules:

```text
uv run --offline --no-sync pytest -q -p no:cacheprovider --cov=aijian_api --cov-report=term-missing --cov-report=json:.aijian-dev/m2-20260904/root-coverage.json
uv run --offline --no-sync python scripts/check_python_coverage.py .aijian-dev/m2-20260904/root-coverage.json
```

Run directory: the existing `.cache/luna-worktrees/r03-b-web-transport` integration
worktree. `COVERAGE_FILE` pointed to its isolated
`.aijian-dev/m2-20260904/root-coverage-data`. The single full-suite session exited
zero; it is finished and must not be restarted merely to recover context.

- Full suite: **961 passed in 507.11 seconds**, pytest and coverage gate exit 0.
- Line coverage: **9368/10007 = 93.61%**, required 90%.
- Branch coverage: **2072/2474 = 83.75%**, required 83.5%.
- All 14 configured critical modules meet 100% line and branch requirements.
- Independent mypy: **79 source files passed**.
- Scoped Ruff check/format, both changed documents' Prettier check, and
  `git diff --check`: passed. The final acceptance-only documentation edit is
  checked again before the atomic commit; production and test inputs are frozen.
- Protected main-workspace `package.json`, `.pnpm-store/`, and
  `services/api/tests/test_dev_commands.py` remain outside the commit.

The change has no desktop, renderer, IPC, contract, dependency, or build-input
changes. Matching baseline typecheck/build and M1 real Electron evidence are
reused for those unchanged surfaces; they are not represented as a new desktop
test of the clock fix. The changed Python path is covered by the real SQLite
lock-wait, rollback, receipt recovery, and full-suite evidence above. Installer,
real Provider, human film approval, and release acceptance are not claimed.

## Frozen source and evidence identities

Evidence files below are local records under the integration worktree's
`.aijian-dev/m2-20260904/`; logs are not committed. SHA256 values bind this
acceptance to the tested inputs and results.

| File                                                      | SHA256                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `services/api/src/aijian_api/task_ledger_completion.py`   | `6534670F1422BAA59D863399821A6A9DC5069BF23730E630485BCDA9A054F2F6` |
| `services/api/tests/test_task_completion_lease_expiry.py` | `4DCFDB6D43CD311B7D65DB76E91677D64068CD4A4DD9E3EA69373DB49346D2C4` |
| `docs/specs/phase0-task-ledger.md`                        | `558565135FED27AD4587080A6277C075DADA44623CD791EBA3C99CFD48BC698A` |
| `root-full.log`                                           | `C2C723772349970DD8A2FFF49DBD78AB631D514CF935DD6B81F6F8C409707BF6` |
| `root-coverage.json`                                      | `4CEFCE4B5A62EB83090FC273DC1750AF58A1DDF0FA7D79235B4350A678D7BEAE` |
| `root-coverage-gate.log`                                  | `9402E2AE34A9CE62F8050833D23CD0371F1D9F301711CE59578071D0ED27A8D5` |
| `root-mypy.log`                                           | `3F34CA3611E1A278B355483A3CE21A6855656E562840EC67626C224657569FEF` |
| `root-style.log`                                          | `35A8BF653FC270A9BD2C35BC5A6D9D030EBCE27F3317920F300162FA3DBFBCFA` |
