# Phase 0 Typed Dependency Assessment (T03)

Scope: read-only typed dependency assessment and consumption guard for exact accepted upstream pins. No F05 persistent stale propagation, routes, UI, waivers, or migrations.

## Impact algebra

1. Severity: `blocking > render_only > advisory`.
2. An edge mismatches when its pinned `upstream_version_id` is not that artifact's current `accepted_version_id` (NULL accepted head counts as mismatch).
3. Path effective impact is the least severe edge on the path (impact may weaken upstream, never strengthen).
4. Independent mismatch paths are retained; overall consumption uses the strongest effective impact (`blocking` on any path blocks both modes).
5. `blocking` => `stale=True` and rejects `general` and `render`.
6. `render_only` => not general-stale; allows `general`, rejects `render`.
7. `advisory` never rejects consumption; causes remain visible.
8. Any accepted version-id change is conservatively meaningful (no content-hash or semantic prune).

## Fail-closed structural validation

Assessment validates every assessed/traversed version, artifact, head, and dependency row inside one SQLite snapshot. Soft mismatch (NULL or advanced accepted head) remains reportable; corruption raises `ArtifactDependencyInvalidError`:

- missing target or traversed `artifact_heads` row;
- non-NULL `accepted_version_id` that does not resolve to a version owned by that artifact/project;
- missing dependency ownership, cross-project edges, impossible impact values, or cycles.

Do not rely only on schema constraints or triggers for these defenses.

## Repository surface

- `assess_artifact_dependencies(project_id, version_id, mode)` - one SQLite read snapshot.
- `require_accepted_artifact_consumable(project_id, version_id, mode)` - target must be current accepted head and consumable.
- Connection-scoped helper used inside existing Gate `BEGIN IMMEDIATE` transactions.

## T02 reuse

`_require_current_blocking_g1` keeps the StoryBible structural invariant (direct `derived_from` + `blocking` SourceManifest pin) and uses the generic assessor (`mode=general`) for staleness before challenge consumption.

## Evidence

`services/api/tests/test_artifact_invalidation.py` plus existing G2 / review / story.extract regressions.
