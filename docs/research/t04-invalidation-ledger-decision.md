# T04 Invalidation Operation And Path-Impact Ledger — Implementation Decision

Status: implementation decision for bounded T04 (persistent append-only ledger on accepted-head replacement). Not a second research phase.
Observation clock: 2026-08-14. Workspace: `codex/f05-invalidation-ledger` @ `99ede15`.

## Primary sources inspected

| System | Mechanism | Exact refs |
| --- | --- | --- |
| Bazel / Skyframe | Bottom-up reverse-dep invalidation; interrupt-safe pending set as operation identity | [Skyframe manual](https://bazel.build/reference/skyframe); `EagerInvalidator.java`; `InvalidatingNodeVisitor.java` (`pendingVisitations`, `InvalidationType`) |
| Nx | Reverse graph then DFS dependents | `packages/nx/src/project-graph/affected/affected-project-graph.ts` (`filterAffected`, `reverse`) |
| Nix | Ordered multi-path explanation | [nix why-depends](https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-why-depends); `why-depends.cc` (`--all`) |
| Dagster | Multi-cause list + deterministic `sort_key` | `python_modules/dagster/dagster/_core/definitions/data_version.py` (`CachingStaleStatusResolver`) |
| Pants | Missing dependency mid-walk is hard failure | `src/rust/graph/src/lib.rs` (`invalidate_from_roots`) |

## Decisions (T04 only)

1. **Trigger:** only trusted Gate approval that moves a non-NULL `accepted_version_id` to a different version. Initial `NULL → version`, rejection, submit/signoff/findings create no rows.
2. **Atomicity:** one `invalidation_operations` row plus all `invalidation_path_impacts` rows are written in the same `BEGIN IMMEDIATE` transaction as challenge consumption, `gate_decisions` insert, and head update. Crash before commit ⇒ no partial operation (no chunked resume protocol in T04).
3. **Walk:** reverse exact `artifact_dependencies` edges from the replaced old accepted version (Nx/Skyframe reverse dependents). Enumerate every simple path; diamonds retain independent records (Nix `--all`, Dagster multi-cause). Do not collapse paths.
4. **Path identity:** ordered `dependency_id` sequence from the affected version toward the replaced root (explainability direction aligned with T03 target→upstream). Parallel relationship and edge-impact arrays. Effective impact = T03 path-min (`blocking > render_only > advisory` ranks; reuse `effective_path_impact`).
5. **Projection:** path rows are the durable evidence. Across paths for one affected version, strongest effective impact wins (`max`); `blocking` ⇒ general-stale; `render_only` does not mark general stale; `advisory` is visible only.
6. **Immutability:** ledger tables are append-only; descendant versions/content/hashes/dependencies/heads/review state are never mutated.
7. **Fail-closed:** missing/corrupt versions, heads, impacts, cross-project edges, or cycles raise `ArtifactDependencyInvalidError` and roll back the entire approval transaction (Skyframe/Pants missing-parent posture; reject Nx/Turbo “unknown ⇒ all affected”).
8. **Schema:** migration 8 adds ownership/FK/check constraints and immutability triggers. Read APIs are project-scoped repository methods only (no HTTP).

## Explicit rejects for T04

Change pruning / content-hash prune; mutating descendants; waiver application; HTTP/UI; background chunking; cache invalidation; altering T03 mode semantics.
