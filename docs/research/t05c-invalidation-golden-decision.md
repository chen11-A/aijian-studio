# T05C Invalidation Golden Acceptance — Decision Note

Status: implementation decision for bounded T05C (technical F05 `invalidation-golden` closeout).
Observation clock: 2026-08-14. Workspace: `codex/f05-invalidation-golden` @ `e0091dc`.
Research base: in-repo T03/T04/T05A/T05B primary refs (no new web survey this turn).

## Primary sources inspected (exact in-repo refs)

| System | Mechanism used for acceptance shape | Exact primary refs (from prior Aijian research) |
| --- | --- | --- |
| Bazel / Skyframe | Bottom-up reverse-dep invalidation; interrupt-safe operation identity | [Skyframe manual](https://bazel.build/reference/skyframe); `EagerInvalidator.java`; `InvalidatingNodeVisitor.java` (`pendingVisitations`, `InvalidationType`) — T03 §4.1 / T04 table |
| Nx | Reverse graph then DFS dependents; project-scoped affected set | `packages/nx/src/project-graph/affected/affected-project-graph.ts` (`filterAffected`, `reverse`); [Affected docs](https://nx.dev/docs/features/ci-features/affected) — T03 §4.2 / T04 / T05A |
| Nix | Ordered multi-path explanation; `--all` retains every independent path | [nix why-depends](https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-why-depends); `why-depends.cc` (`--all`) — T03 §4.6 / T04 / T05A |
| Dagster | Multi-cause stale presentation; deterministic `sort_key` | `python_modules/dagster/dagster/_core/definitions/data_version.py` (`StaleCause.sort_key`, `CachingStaleStatusResolver`) — T03 §4.4 / T04 / T05A |
| Pants | Missing dependency mid-walk is hard failure | `src/rust/graph/src/lib.rs` (`invalidate_from_roots`) — T03 §4.5 / T04 |
| dbt Core (v1) | Explicit comparison operand; fail closed without state | `1.latest` `StateSelectorMethod`; state-selection docs — T03 §4.7 |
| DVC | Acyclic graph; corrupt cache not trusted as fresh | `dvc/repo/reproduce.py`, `dvc/stage/cache.py` — T03 §4.3 |
| Turborepo | Shared pure affected function; reject SCM-error ⇒ all | `crates/turborepo-engine/src/affected.rs` — T03 §4.8 |

License/provenance: study behavior only; do not copy incompatible code (Nix LGPL, etc.).

## What each system proves (acceptance-relevant)

| Concern | Borrowed pattern | Rejected pattern |
| --- | --- | --- |
| Affected-set completeness | Skyframe/Nx reverse dependents from the replaced root | Turbo/Nx “unknown ⇒ all affected” |
| Multi-cause / multi-path | Nix `--all` + Dagster multi-cause retention | Binary affected-set collapse (Nx default product surface) |
| Deterministic output | Dagster sorted causes; fixed path ordinals (T04/T05A) | Hash-map / parallel visitation order as product identity |
| Restart / crash safety | Skyframe atomic operation identity (T04 same-txn write) | Chunked resume / partial ledger commits in the golden path |
| Golden reproducibility | dbt explicit comparison operand; fixed IDs + fixed clock | Wall-clock IDs, temp paths, or deriving oracle from live ledger |

## Aijian T05C acceptance shape (settled)

1. **Real Gate replacement:** build the typed DAG through Repository/domain APIs; advance the upstream accepted head only via the production `decide_artifact_gate` transaction that already calls T04. Never insert into `invalidation_operations` / `invalidation_path_impacts` and never hand-author report JSON as the system under test.
2. **Fixed ID / fixed clock:** hermetic SQLite workspace with deterministic `id_factory` and clock so two clean runs are byte-identical after normalization.
3. **Fixture graph (labels):** direct affected; mixed multi-hop (`blocking` then `render_only` path-min); diamond with two independent paths; unaffected control branch absent from the report; human-authored downstream version whose content hash/head remain unchanged.
4. **Independent label-based oracle:** declare expected affected labels, path multiplicity, relationship/impact sequences, effective impacts, and group flags separately from the ledger/report implementation. Compare oracle to **both** durable ledger rows and the public report projection. Require `missed_invalidations = 0` and `unexpected_invalidations = 0`.
5. **Normalized evidence:** write `docs/quality/evidence/invalidation-golden.json` with labels (not raw temp paths), sorted keys, LF newlines; register in `SHA256SUMS`; CI runs the command on Windows and Ubuntu before the hash check.
6. **Scope boundary:** technical F05 fixture only. C04 film Canon acceptance stays `BLOCKED` until E02 and rights-cleared golden content exist.

## Explicit rejects for T05C

- Deriving the expected set by reading the implementation under test
- Content-hash prune or change-pruning resurrection as the change signal
- UI, pagination, repair/rebase, waivers, new public endpoints
- Network dependency during acceptance
- Treating this synthetic fixture as film-team Canon (C04)
