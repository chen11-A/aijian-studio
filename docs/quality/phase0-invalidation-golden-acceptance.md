# Phase 0 Invalidation Golden Acceptance (T05C / F05)

Date: 2026-08-14

Backlog: F05 technical `invalidation-golden` closeout only.

## Scope

This record accepts **technical typed-DAG invalidation** for F05:

- real Gate / Repository construction of a fixed fixture graph;
- durable invalidation ledger rows produced inside the production Gate transaction;
- public invalidation report projection of the same operation;
- independent hard-coded label oracle comparison for both surfaces;
- deterministic root CLI / package command and checked-in evidence bytes.

It does **not** accept film-team Canon change-set work (C04), rights-cleared content (C01/E02), UI changes, repair/rebase, waivers, or new public endpoints.

## Real Gate construction and operation identity

- Fixture implementation: `scripts/invalidation_golden.py`
- Independent oracle: `scripts/invalidation_golden_oracle.py`
- Focused tests: `services/api/tests/test_invalidation_golden.py`, `services/api/tests/test_invalidation_golden_oracle.py`

Construction path:

1. Hermetic SQLite workspace via `StudioRepository` with fixed `id_factory` and fixed clock `2026-08-03T12:00:00Z`.
2. Create and Gate-accept `source_manifest` **root-v1**.
3. Create unaccepted custom versions for graph cases (control, direct, mid, mixed, mid_a, mid_b, diamond) plus an accepted human-authored `story_bible` descendant.
4. Create and Gate-accept **root-v2** on the same artifact through production `decide_artifact_gate` (no direct inserts into `invalidation_operations` / `invalidation_path_impacts`).

Measured operation identity:

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| Fixture ID           | `t05c-a2-real-gate-invalidation-golden`                           |
| Schema               | `t05c-a2.v1`                                                      |
| Path direction       | `affected_to_changed_root_v1`                                     |
| Operation count      | `1`                                                               |
| Old accepted head    | `root_v1`                                                         |
| New accepted head    | `root_v2`                                                         |
| Gate decision target | root-v2 decision id recorded on the single invalidation operation |

## Graph cases

| Case                      | Labels / edges                                                                                           | Expected acceptance signal                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Direct                    | `direct_v1 -> root_v1` (`derived_from` / `blocking`)                                                     | one path; effective `blocking`                                                            |
| Mixed multi-hop           | `mixed_v1 -> mid_v1 -> root_v1` (`render_only` then `blocking`)                                          | path-min effective `render_only`; general not blocked; render blocked                     |
| Two-path diamond          | `diamond_v1` via `mid_a_v1` (`blocking`/`blocking`) and `mid_b_v1` (`blocking` then `advisory` upstream) | two independent paths retained; group strongest `blocking`                                |
| Unaffected control        | `control_v1` with no path to root-v1                                                                     | absent from ledger and report (`control_absent=true`)                                     |
| Human-authored descendant | accepted `human_v1` story bible pinned to root-v1                                                        | present as affected; content hash / accepted head / deps unchanged after root replacement |

## Impact algebra proven

- All three impact classes appear on independent paths: `blocking`, `render_only`, `advisory`.
- Path effective impact is the **least severe** edge on that path (path-min).
- Group effective impact is the **strongest** independent path result (group-strongest).
- Flags derived from strongest impact:
  - `blocking` ⇒ `general_stale`, `general_blocked`, `render_blocked`
  - `render_only` ⇒ not general-stale/blocked; `render_blocked`
  - `advisory` ⇒ neither general nor render blocked

Measured group strongest impacts in the golden:

| Label        |   Strongest | Independent paths |
| ------------ | ----------: | ----------------: |
| `diamond_v1` |    blocking |                 2 |
| `direct_v1`  |    blocking |                 1 |
| `human_v1`   |    blocking |                 1 |
| `mid_a_v1`   |    blocking |                 1 |
| `mid_b_v1`   |    advisory |                 1 |
| `mid_v1`     |    blocking |                 1 |
| `mixed_v1`   | render_only |                 1 |

## Ledger and report vs independent oracle

Both durable ledger rows and the public report projection are normalized to label-based operations and compared separately to the hard-coded oracle in `expected_golden_operation()`.

Measured exact counts (both projections):

| Metric                               |                      Measured |
| ------------------------------------ | ----------------------------: |
| Operations                           |                             1 |
| Affected groups                      |                             7 |
| Independent paths                    |                             8 |
| Missed invalidations                 |                             0 |
| Unexpected invalidations             |                             0 |
| Human-authored descendants unchanged |                          true |
| Control present                      | false (`control_absent=true`) |

## Deterministic CLI / root command and evidence

Root package script in `package.json`:

```text
pnpm evidence:invalidation-golden
→ uv run python scripts/invalidation_golden.py --output docs/quality/evidence/invalidation-golden.json
```

- Checked-in evidence: `docs/quality/evidence/invalidation-golden.json`
- Manifest entry: `docs/quality/evidence/SHA256SUMS`

Local generation on clean temporary databases (two successive runs):

| Run | Bytes | SHA-256                                                            |
| --- | ----: | ------------------------------------------------------------------ |
| 1   | 10615 | `858e339c0ed29a51a206fd5bdd6a05bb4361f8f21a7e0b26497de9903134bf7b` |
| 2   | 10615 | `858e339c0ed29a51a206fd5bdd6a05bb4361f8f21a7e0b26497de9903134bf7b` |

- Byte identity of the two runs: **identical**.
- Encoding: UTF-8, sorted JSON keys, exactly one trailing LF.
- `pnpm evidence:check`: **PASS (24 files)**.

## Automated tests measured locally

Focused (fixture + oracle):

```powershell
F:\UserData\Documents\ChatGPT\sp\aijian-studio\.venv\Scripts\python.exe -m pytest `
  services/api/tests/test_invalidation_golden.py `
  services/api/tests/test_invalidation_golden_oracle.py `
  -q --tb=line `
  --basetemp='F:\UserData\Documents\ChatGPT\sp\.pytest-grok-t05c-a3-focused'
```

Result: **17 passed** in 8.47s.

Related (typed invalidation, ledger, report API):

```powershell
F:\UserData\Documents\ChatGPT\sp\aijian-studio\.venv\Scripts\python.exe -m pytest `
  services/api/tests/test_artifact_invalidation.py `
  services/api/tests/test_artifact_invalidation_ledger.py `
  services/api/tests/test_invalidation_report_api.py `
  -q --tb=line `
  --basetemp='F:\UserData\Documents\ChatGPT\sp\.pytest-grok-t05c-a3-related'
```

Result: **54 passed** in 13.36s.

Local workspace quality measurements on this closeout (not a remote GitHub Actions claim):

| Command                           | Measured result                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm contracts:check`            | PASS                                                                                                                                                                                  |
| `pnpm typecheck`                  | PASS (TS packages + mypy 51 source files)                                                                                                                                             |
| `pnpm lint:py`                    | PASS (`ruff check`)                                                                                                                                                                   |
| `pnpm lint:ts` / full `pnpm lint` | FAIL pre-existing at A2 HEAD: `scripts/e2e/impact-report-visual.mjs` 19× `no-undef` (outside F05 closeout paths)                                                                      |
| `pnpm format:check`               | FAIL pre-existing Prettier drift in unrelated files; allowed markdown paths formatted; `docs/quality/evidence/invalidation-golden.json` is listed in `.prettierignore` because the fixture serializer owns its byte contract |
| `pnpm test:ts`                    | PASS — desktop **61**, studio-web **71**                                                                                                                                              |
| `pnpm test:py`                    | tests **547 passed, 1 skipped**; coverage gate FAIL pre-existing at A2 HEAD for critical modules `media_toolchain.py` / `task_ledger_recovery.py` (defensive branches 64/245 and 163) |
| `pnpm audit --prod`               | PASS with `registry.npmjs.org` (default npmmirror audit endpoint missing)                                                                                                             |
| `pnpm build`                      | PASS                                                                                                                                                                                  |

These are local measurements only.

## CI configuration (repository)

`.github/workflows/ci.yml` quality matrix already runs on `ubuntu-latest` and `windows-latest`.

After tests / dependency setup and media contract evidence reproduction, CI now runs:

```yaml
- name: Reproduce invalidation golden evidence
  run: pnpm evidence:invalidation-golden
```

immediately **before** `Verify evidence hashes` (`pnpm evidence:check`). The existing final `git diff --exit-code` clean-generated-state check is unchanged.

This documents the repository CI configuration only. No GitHub-hosted remote run for this commit was observed during local closeout, so remote CI is **not** claimed passed here.

## C04 / E02 boundary (still blocked)

- F05 technical invalidation golden is complete with real-Gate evidence.
- C04 remains **BLOCKED**: this synthetic fixture is not a rights-cleared film Canon change set and cannot substitute for E02 / content / legal prerequisites.
- Remaining blocker: rights-cleared golden film content and E02 acceptance before any film-team Canon invalidation report can be accepted.
