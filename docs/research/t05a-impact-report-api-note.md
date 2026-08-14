# T05A Invalidation Impact Report API — Implementation Note

Status: implementation decision for bounded T05A (project-scoped read-only HTTP over durable T04 ledger).
Observation clock: 2026-08-14. Workspace: `codex/f05-impact-report-api` @ `0695bf7`.

## Primary sources inspected

| System | Report / explainability mechanism | Exact refs |
| --- | --- | --- |
| Dagster | Multi-cause stale presentation; deterministic `sort_key` on causes; empty causes ⇒ fresh | [`data_version.py`](https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster/_core/definitions/data_version.py) — `StaleCause.sort_key`, `CachingStaleStatusResolver._get_stale_causes` (`sorted(..., key=cause.sort_key)`) |
| Nix | Ordered multi-path explanation; `--all` retains every independent path, not only shortest | [nix why-depends](https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-why-depends); source `why-depends.cc` (`--all` / all edges) |
| Nx | Reverse graph then DFS dependents; affected graph is a set projection (no path objects) | [Affected docs](https://nx.dev/docs/features/ci-features/affected); [Explore graph](https://nx.dev/docs/features/explore-graph); `packages/nx/src/project-graph/affected/affected-project-graph.ts` (`filterAffected`, `reverse`) |

## Borrow / reject for T05A

1. **Borrow (Dagster):** expose every independent cause/path and sort deterministically for list/detail stability. Group keys and path ordinals are the report identity, not insertion order of dependency edges.
2. **Borrow (Nix `--all`):** keep all independent reverse paths for one affected exact version; do not collapse diamonds. Strongest path impact wins for version-level projection while advisory paths remain visible.
3. **Borrow (Nx reporting surface only):** project-scoped affected list/detail as a stable read API over already-computed reverse-dependent evidence. Do not re-walk the live graph in HTTP handlers.
4. **Reject:** Nx binary affected/not-affected collapse; live T03 reassessment inside report endpoints; labeling event-time ledger rows as current consumability (T03 remains authority for live `general|render`).

## T05A contract choices

- Endpoints: `GET .../invalidation-operations` and `GET .../invalidation-operations/{operation_id}`.
- List order: T04 event order (`created_at ASC`, `operation_id ASC`).
- Detail groups: `(affected_artifact_id, affected_version_id)` sorted; paths by `path_ordinal`.
- Event-time flags from frozen algebra: `general_stale`/`general_blocked` ⇔ any/strongest path is `blocking`; `render_blocked` ⇔ strongest is `blocking|render_only`.
- Fail-closed corrupt ledger rows via stable API error; project-scoped not-found for missing/cross-project operations (no identity leakage).
