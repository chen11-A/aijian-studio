# T03 Typed Invalidation — Open-Source Benchmark

Status: research gate for **bounded T03** (read-only, connection-scoped assessor). No implementation in this commit.
Author: research owner on `codex/typed-invalidation`.
Observation clock: GitHub REST `GET /repos/{owner}/{repo}` at **2026-08-14T11:12:04Z**.
Workspace check: branch `codex/typed-invalidation`, required base `5ab007eda3746e8bfb930cc1e9414f96e2fbad6d`, worktree clean at research start; no vendor clones.

This document answers a product question, not a popularity contest:

> Given one exact Aijian `ArtifactVersion` that is the artifact’s **current accepted head**, and a selected consumption mode (`general` | `render`), is that version consumable when some accepted upstream heads no longer match its pinned exact upstream `version_id`s? What independent mismatch causes explain the result, and is the target `stale`?

T03 is **read-only**: no migration, cache, mutation, route, UI, waiver, or persistent stale-mark write. Stars and commit recency are context only. Design choices below are justified from mechanisms, invariants, and the frozen T03 contract.

## 1. Evidence rules and method

- Technical claims use primary evidence: official manuals, official repositories, source, tests, or official maintainer comments. Marketing README language is not treated as proof.
- Every important claim has an exact URL. Source claims name file and symbol.
- GitHub star totals come from the public repository API at the timestamp above. **30-day star growth is `not verifiable`**: GitHub restricted public stargazer timelines on 2026-06-30 ([changelog](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/), [REST starring docs](https://docs.github.com/rest/activity/starring), prior Aijian note in [`docs/research/oss-baseline-2026-08-14.md`](oss-baseline-2026-08-14.md)). This document does not invent growth.
- Recent commits and releases are separate activity signals.
- Labels used below:
  - **Documented**: official manual or design page.
  - **Source-confirmed**: inspected source or tests.
  - **Inference**: the author's conclusion, not claimed by the project.
- All eight mandatory candidates were scanned. All eight are compared in depth. No repository was cloned into this worktree.

## 2. What T03 computes (bounded)

Aijian already stores the ingredients T03 will **read**. F05-style persistent propagation is `NOT_STARTED` ([`docs/roadmap/phase-0-execution-status.md`](../roadmap/phase-0-execution-status.md)) and is **out of T03 scope**.

Fixed in-repo facts T03 reuses:

| Fact | Where it is written |
| --- | --- |
| `artifact_id` is stable; `version_id` is never reused; content edits create a new version | [`docs/contracts/artifact-envelope.md`](../contracts/artifact-envelope.md) |
| Inputs pin **exact** versions, not “current role” | same |
| Edge `impact ∈ {blocking, advisory, render_only}`; graph must be acyclic | same; SQL `CHECK` + `artifact_dependencies_no_cycle` in [`services/api/src/aijian_api/repository.py`](../../services/api/src/aijian_api/repository.py) |
| `accepted_version_id` is a separate mutable head | artifact envelope; `ArtifactHead` |
| Domain type already exists: `DependencyImpact = Literal["blocking", "advisory", "render_only"]` | [`services/api/src/aijian_api/domain.py`](../../services/api/src/aijian_api/domain.py) |
| Gate actions run in `BEGIN IMMEDIATE` and call `_require_current_blocking_g1` **before** challenge consumption | [`repository.py`](../../services/api/src/aijian_api/repository.py) (`prepare_*` / decision paths) |

### 2.1 Frozen T03 contract (authoritative for this revision)

1. **Severity order:** `blocking > render_only > advisory`.
2. **Along one path:** effective impact is the **least severe** edge on that path (`min` by severity). Impact may weaken toward the target; it never strengthens along a path.
   - Required examples: `blocking → render_only` = `render_only`; `advisory → blocking` = `advisory`.
3. **Across independent paths/causes:** retain every independent mismatch path; overall severity is the **strongest** (`max`). Any independent blocking path wins.
   - Required example: advisory direct path **plus** a separate all-blocking path → independent blocking cause wins.
4. **Consumption modes (exactly two):**
   - `general`: reject only if any cause’s effective impact is `blocking`; `render_only` and `advisory` allow.
   - `render`: reject if any cause’s effective impact is `blocking` **or** `render_only`; `advisory` allows.
5. **`stale`:** `true` only when at least one cause has effective impact `blocking`. A `render_only` mismatch does **not** make the general artifact stale.
6. **No waivers** in T03 (no open-waiver reads, no waiver fields, no waiver tests).
7. **Change signal:** only **accepted `version_id` mismatch** (pinned upstream version ≠ current accepted head, or accepted head is `None`). No content-hash comparison and no semantic-field prune in T03.
8. **Guard order:** (a) prove the target `version_id` **is** the artifact’s current `accepted_version_id`; (b) only then walk dependencies for the selected mode. Drafts and former accepted versions **cannot** pass merely because their ancestors still match.
9. **T02 reuse:** `_require_current_blocking_g1` must call the connection-scoped generic assessor for staleness **while preserving** the exact structural invariant “StoryBible has direct `derived_from` + `blocking` SourceManifest pin(s),” inside each existing `BEGIN IMMEDIATE` Gate transaction and **before** challenge consumption.
10. **Scope:** read-only assessor + unit/integration tests around it. No migration, cache table, mutation, route, or UI.

T03 is **not** “rebuild a monorepo,” **not** persistent invalidation propagation, and **not** a waiver system. It is a **mode-specific consumability judgment** of one accepted head against exact pinned upstream version ids, using typed edges, with fail-closed structural errors.

## 3. Catalog — all eight scanned

GitHub REST metadata at **2026-08-14T11:12:04Z**. 30-day star growth: **not verifiable**.

| # | Project | Repo | Stars | License | Default branch | Latest observed activity | Deep compare? |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| 1 | Bazel / Skyframe | [bazelbuild/bazel](https://github.com/bazelbuild/bazel) | 25,715 | Apache-2.0 | `master` | HEAD commit `e6e199d` 2026-08-14T09:29:31Z; release 9.2.0 on 2026-07-13; 8.8.0rc1 on 2026-08-06 | yes |
| 2 | Nx | [nrwl/nx](https://github.com/nrwl/nx) | 29,218 | MIT | `master` | HEAD `81a6cfb` 2026-08-13T20:00:00Z; stable 23.1.1 on 2026-07-30; 23.2.0-beta.7 on 2026-08-11 | yes |
| 3 | DVC | [iterative/dvc](https://github.com/iterative/dvc) → [treeverse/dvc](https://github.com/treeverse/dvc) | 15,817 | Apache-2.0 | `main` | HEAD `56e5982` 2026-08-06T04:17:40Z; latest release 3.67.1 on 2026-03-31 | yes |
| 4 | Dagster | [dagster-io/dagster](https://github.com/dagster-io/dagster) | 15,994 | Apache-2.0 | `master` | HEAD `a706ddb` 2026-08-13T22:44:00Z; release 1.13.17 on 2026-08-07 | yes |
| 5 | Pants | [pantsbuild/pants](https://github.com/pantsbuild/pants) | 3,814 | Apache-2.0 | `main` | HEAD `23be51b` 2026-08-13T15:23:42Z; release 2.33.0 on 2026-08-01 | yes |
| 6 | Nix | [NixOS/nix](https://github.com/NixOS/nix) | 17,509 | LGPL-2.1 | `master` | HEAD `6274126` 2026-08-12T21:46:08Z; no GitHub Releases; tag `2.35.2` present | yes |
| 7 | dbt Core | [dbt-labs/dbt-core](https://github.com/dbt-labs/dbt-core) | 13,641 | Apache-2.0 | `main` = v2 alpha; production v1 on `1.latest` | HEAD `008b19a` 2026-08-14T01:08:20Z; v1.8.10 / v1.12.2 still shipping | yes |
| 8 | Turborepo | [vercel/turborepo](https://github.com/vercel/turborepo) | 30,893 | MIT | `main` | HEAD `65aa565` 2026-08-13T19:13:40Z; stable v2.10.9 on 2026-08-07 | yes |

Activity inference: seven of eight have commits in the last eight days. DVC is slower on releases (last tag March 2026) but the repo is not archived. Popularity does not decide T03.

Added-but-not-required neighbours (not deep-compared, do not reduce the eight): Buck2 / Dice, Rust `salsa`, GNU Make. They share incrementality ideas already covered by Skyframe and Pants.

## 4. Deep comparisons

### 4.1 Bazel / Skyframe

**Manual:** [Skyframe](https://bazel.build/reference/skyframe). **Code:** [`src/main/java/com/google/devtools/build/skyframe/`](https://github.com/bazelbuild/bazel/tree/master/src/main/java/com/google/devtools/build/skyframe).

#### Graph identity

- **Documented:** a node is a `SkyValue` addressed by an immutable `SkyKey` (`FILECONTENTS:/tmp/foo`, `PACKAGE://foo`). A `SkyFunction` builds a value from other keys. The graph is a DAG of those dependencies.
- **Source-confirmed:** `SkyFunction` + `SkyFunction.Environment` request deps via `getValue` / `getValues`; missing deps return `null` and the function is re-entered. Unregistered filesystem reads are explicitly forbidden because they produce incorrect incremental builds.

#### Mutable head vs immutable version

- **Documented:** values are immutable. Incrementality is a dirty/rebuild of keys, not mutation of an accepted pointer.
- **Inference:** Bazel has no Aijian-style `accepted_version_id`. The closest mutable thing is the filesystem / `--override` injected `Differencer` delta.

#### Change detection

- **Documented:** leaf `FileStateValue` is `lstat()` plus extra change info. `FileValue` adds contents / symlink resolution. Bottom-up invalidation stats previous inputs; `inotify` is mentioned as an optimization.
- **Source-confirmed:** `Differencer.Diff` splits `changedKeysWithoutNewValues` vs `changedKeysWithNewValues`. Injected new values “cannot have any dependencies” so injected and derived values are not conflated (`Differencer.java`).
- **Source-confirmed hermeticity:** `FunctionHermeticity.{HERMETIC, SEMI_HERMETIC, NONHERMETIC}`. Hermetic functions may not be marked `CHANGED`; only non-hermetic nodes may be dirtied because of state outside Skyframe (`FunctionHermeticity.java`, `DirtyingNodeVisitor`).

#### Traversal and propagation

- **Documented:** Bazel only does **bottom-up** invalidation: reverse transitive closure of changed inputs. Top-down invalidation is described and rejected for Bazel’s usual “rebuild the same top-level node” workload.
- **Documented change pruning:** if a dirtied node rebuilds to an equal value, dependents are “resurrected.” Example: a comment-only C++ change does not relink.
- **Source-confirmed:** `EagerInvalidator.invalidate` walks reverse deps. `InvalidatingNodeVisitor.InvalidationType` is `CHANGED` (must recompute), `DIRTIED` (may later be marked clean), `DELETED`. Reverse deps are always marked `DIRTIED`, never `CHANGED` (`dirtyKeyAndVisitParents`). Hermetic keys cannot be `CHANGED`.
- **Source-confirmed interrupt contract:** if a node is dirty but not yet marked, it or a transitive dep must remain in `pendingVisitations`. Reverse-dep pointers always point at existing nodes. This is the recovery model.

#### Multiple paths, cycles, missing, order

- Multiple reverse-dep paths are unioned. A node is processed at most once per `(SkyKey, InvalidationType)` except the documented dirty→changed upgrade race (`DirtyingNodeVisitor` comments).
- Missing keys enqueued by an existing parent throw `IllegalStateException` (“key(s) … not in the graph, but enqueued for dirtying by …”).
- Cycles are a first-class evaluation failure (`CycleDetector`, `SimpleCycleDetector`, `CycleDeduper`, `CyclesReporter`). Invalidation itself assumes a DAG.
- Invalidation is parallel (`ForkJoin` worker pool). Evaluation order is dependency-driven, not user-visible sorted paths.

#### Impact severity

- **Source-confirmed binary-plus-evaluation-state, not product impact.** `DirtyType` is `DIRTY` / `CHANGE` / `REWIND`. `DIRTY` can be cleaned if children did not change. `CHANGE` always re-evaluates. `REWIND` re-evaluates parents even if the value is equal. There is no `blocking` / `render_only` / `advisory`.
- **Documented limitation:** invalidation is all-or-nothing. Incremental linking / in-place JAR mutation is rejected because Google values bit-for-bit repeatability over mutating old values.

#### Snapshot / persistence

- In-memory graph in the Bazel server. Persistence is the action cache / remote cache, not an audit table of stale marks. Invalidation must not interleave with other graph writes.

#### Explainability

- Users see “this target is being rebuilt,” `bazel query` / `cquery`, and Skyframe dumps. There is no first-class “why is this approved version stale for publish” report. Change pruning can hide a dirtied ancestor from the user if the rebuilt value matches.

#### Tests / invariants

- [`EagerInvalidatorTest.java`](https://github.com/bazelbuild/bazel/blob/master/src/test/java/com/google/devtools/build/skyframe/EagerInvalidatorTest.java)
- [`MemoizingEvaluatorTest.java`](https://github.com/bazelbuild/bazel/blob/master/src/test/java/com/google/devtools/build/skyframe/MemoizingEvaluatorTest.java)
- [`IncrementalInMemoryNodeEntryTest.java`](https://github.com/bazelbuild/bazel/blob/master/src/test/java/com/google/devtools/build/skyframe/IncrementalInMemoryNodeEntryTest.java)
- Cycle tests: `CycleDeduperTest`, `CyclesReporterTest`.
- Invariant worth copying: interrupt-safe pending set; hermetic nodes cannot be marked changed; missing reverse-dep targets are errors.

#### Borrow / reject

- **Borrow for T03:** hermetic rule that only registered dependencies count; missing enqueued parent is a hard error (maps to raise-on-structural-corruption).
- **Borrow for later F05 only (not T03):** `CHANGED` vs `DIRTIED` + interrupt-safe pending visitation for durable downstream marking after an accepted-head advance.
- **Reject for T03:** change pruning / hash-equal resurrection as a change signal (T03 uses version-id mismatch only); in-memory evaluator as source of truth (ADR-0002).

### 4.2 Nx

**Manual:** [Run only tasks affected by a PR](https://nx.dev/docs/features/ci-features/affected), [Mental model](https://nx.dev/docs/concepts/mental-model), [Explore the graph](https://nx.dev/docs/features/explore-graph). **Code:** [`packages/nx/src/project-graph/affected/affected-project-graph.ts`](https://github.com/nrwl/nx/blob/master/packages/nx/src/project-graph/affected/affected-project-graph.ts).

#### Graph identity

- **Documented:** Project Graph nodes are projects; Task Graph nodes are `(project, target)`. Edges are project deps / task `dependsOn`.
- **Source-confirmed:** `filterAffected` takes a `ProjectGraph` plus `FileChange[]`. Locators (`getTouchedProjects`, `getImplicitlyTouchedProjects`, project-glob, JS plugin) map files → project names. Traversal uses `reverse(graph)` then DFS to dependents.

#### Mutable head vs immutable version

- Heads are Git SHAs (`--base`, `--head`, `NX_BASE` / `NX_HEAD`). Projects themselves are mutable working-tree identities. There is no immutable `version_id` per project.

#### Change detection

- **Documented:** Git diff of files, mapped through the project graph. Default lockfile change marks **all** projects affected (`projectsAffectedByDependencyUpdates: "all"`). `"auto"` inspects which workspace projects actually changed in the lockfile. `"all"` is called “the safest option.”
- **Documented CI rule:** set base to the last *successful* commit so changes since a red CI are not lost.
- **Documented fail-open alternative:** without Git, pass `--files`.

#### Traversal

- **Documented:** changed projects plus projects that depend on them (downstream / dependents).
- **Source-confirmed:** shared `visited` sets so multiple touched roots are O(nodes), not O(touched × shared). Invalid project names throw `Error('Invalid project name is detected: …')`.
- **Source-confirmed deletion fail-safe:** deleting a retired `project.json` can affect every project; tests allow disabling that fallback (`affected-project-graph.spec.ts`).

#### Multiple paths, cycles, missing, order

- Multiple paths collapse to a set of affected projects. No path objects are retained.
- Cycles are a workspace-config problem; the affected walk assumes the project graph is usable.
- Deterministic order is not a documented product invariant of `affected`; CI just needs a set.

#### Impact severity

- Binary: affected or not. Optional “ignore these globs” (`.gitignore`, `.nxignore`) is exclusion, not a third severity.

#### Snapshot / persistence

- On-demand from Git + the current project graph. Nx Cloud cache is a content hash of task inputs, not a persisted stale mark on an accepted artifact.

#### Explainability

- `nx graph --affected` visualizes the subset. There is no “this edge is blocking publish” explanation. Users infer “these projects will run.”

#### Tests / invariants

- [`affected-project-graph.spec.ts`](https://github.com/nrwl/nx/blob/master/packages/nx/src/project-graph/affected/affected-project-graph.spec.ts) — deletion fallback on/off.
- Locator tests under `packages/nx/src/project-graph/affected/locators/`.

#### Borrow / reject

- **Borrow for T03:** explicit comparison operand (here: current accepted heads on the connection), not an in-flight draft.
- **Borrow for later F05 only:** reverse-DAG dependents walk after a head moves.
- **Reject for T03:** lockfile/unknown-range “mark everything affected,” Git-SHA identity, and fail-open “all stale.” Structural uncertainty raises; it does not invent causes.

### 4.3 DVC

**Manual:** [dvc repro](https://dvc.org/doc/command-reference/repro) (hosted at [doc.dvc.org](https://doc.dvc.org/command-reference/repro)), plus status / DAG / pipeline pages linked from that command. **Code:** [`dvc/repo/reproduce.py`](https://github.com/iterative/dvc/blob/main/dvc/repo/reproduce.py), [`dvc/repo/graph.py`](https://github.com/iterative/dvc/blob/main/dvc/repo/graph.py), [`dvc/stage/__init__.py`](https://github.com/iterative/dvc/blob/main/dvc/stage/__init__.py), [`dvc/stage/cache.py`](https://github.com/iterative/dvc/blob/main/dvc/stage/cache.py). Official changelog now points at [treeverse/dvc releases](https://github.com/treeverse/dvc/releases).

#### Graph identity

- **Documented / source-confirmed:** nodes are `Stage` objects (path + optional name). Edges go **from a stage to the stage that produces its dependency** (`C.dvc -> B.dvc -> A.dvc`). Overlap is resolved with an outs trie. `build_graph` raises `CyclicGraphError`, `OutputDuplicationError`, `OverlappingOutputPathsError`, `StagePathAsOutputError`.

#### Mutable head vs immutable version

- Workspace files are mutable. Content-addressed cache objects and `dvc.lock` hashes are the immutable side. Git branches are a separate experiment head. This is closer to “lockfile of hashes” than Aijian’s accepted pointer.

#### Change detection

- **Source-confirmed `Stage.changed`:** `changed_stage()` (md5 of stage definition vs stored md5) OR `changed_deps()` OR `changed_outs()`. Frozen stages report no dep changes. Callback stages (`cmd` but no deps/outs) and `always_changed` always change.
- **Documented `dvc repro`:** stages without deps or outs are always run. Outputs are deleted before rerun unless `persist: true`.
- **Source-confirmed run-cache:** `_can_hash` requires local hashed deps and local in-repo outs. Cache key is `dict_sha256` of the lockfile projection. Corrupted cache YAML is unlinked and treated as miss (`StageCache._load_cache`).

#### Traversal

- **Source-confirmed:** `plan_repro` uses `networkx.dfs_postorder_nodes` so descendants (dependencies) evaluate first. `--downstream` reverses the graph. Frozen stages are disconnected from their dependencies in `get_active_graph` (`remove_edges_from(graph.out_edges(stage))`).
- `--force-downstream` forces every successor after a rerun.
- On error, `handle_error` DFS-skips dependents. `on_error` is `fail` | `keep-going` | `ignore`.

#### Multiple paths, cycles, missing, order

- Multiple paths are flattened by postorder. Order is deterministic only insofar as NetworkX’s DFS is; the docstring’s example `[A, B, C, D]` is the intended meaning, not a named sort key.
- Cycles abort graph build (`check_acyclic` / `nx.find_cycle`).
- Missing outputs can be `--allow-missing`. That is a **fail-open** knob Aijian must not copy for blocking edges.

#### Impact severity

- Binary changed/unchanged, plus status reasons: `changed deps`, `changed outs`, `changed checksum`, `always changed`. Cloud status adds `new` / `deleted` / `missing`. These are **why-changed labels**, not consumption policy.

#### Snapshot / persistence

- `dvc.lock` + content-addressed cache. `reproduce` is `@locked` (repo lock). Concurrent `dvc repro` of disjoint branches is documented as a user-coordinated trick, not a snapshot isolator.

#### Explainability

- `dvc status` prints which deps/outs/checksums changed. `dvc dag` prints the graph. There is no accepted-head vs pinned-version path.

#### Tests / invariants

- [`tests/func/repro/test_repro.py`](https://github.com/iterative/dvc/blob/main/tests/func/repro/test_repro.py), `test_repro_allow_missing.py`, `test_repro_pull.py`
- [`tests/func/test_status.py`](https://github.com/iterative/dvc/blob/main/tests/func/test_status.py), [`tests/func/test_run_cache.py`](https://github.com/iterative/dvc/blob/main/tests/func/test_run_cache.py)
- Invariant: acyclic graph; overlapping outputs forbidden; corrupted run-cache is dropped, not trusted.

#### Borrow / reject

- **Borrow for T03:** corrupt dependency/version rows are never “fresh” — they raise. Acyclic insert discipline already matches Aijian’s trigger.
- **Reject for T03:** `frozen` edges that stop checks; `--allow-missing`; always-changed callbacks; treating status labels as the three-level impact algebra.

### 4.4 Dagster

**Manual:** [Asset versioning and caching](https://docs.dagster.io/guides/build/assets/asset-versioning-and-caching), [Virtual assets](https://docs.dagster.io/guides/build/assets/virtual-assets), [AutomationCondition](https://docs.dagster.io/api/dagster/assets). **Code:** [`python_modules/dagster/dagster/_core/definitions/data_version.py`](https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster/_core/definitions/data_version.py), [`declarative_automation/automation_condition.py`](https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster/_core/definitions/declarative_automation/automation_condition.py).

#### Graph identity

- Nodes are `AssetKey` (optionally + `partition_key`). Edges are parent asset keys declared on `@asset` / `deps`.
- **Source-confirmed:** `DataProvenance` stores `code_version`, `input_data_versions: Mapping[AssetKey, DataVersion]`, `input_storage_ids`, `is_user_provided`.

#### Mutable head vs immutable version

- The asset key is the stable identity. Each materialization records a data version (auto hash or user `Output(..., data_version=…)`). The “head” is the latest materialization/observation event in the instance event log — mutable in the same way Aijian’s accepted pointer is mutable, but **without a Gate**. Anyone who materializes moves the head.

#### Change detection

- **Documented:** default data version = hash(code_version + input data versions). Unspecified `code_version` becomes the run id, so every run looks new. User-supplied `DataVersion` can keep downstream fresh across a cosmetic refactor.
- **Documented “Unsynced” reasons:** code version changed; deps added/removed; parent data version changed. **Unsynced is not transitive** until the parent is rematerialized.
- **Source-confirmed:** `compute_logical_data_version` sorts input keys, concatenates, SHA-256s. Any `UNKNOWN` input yields `UNKNOWN_DATA_VERSION`.
- **Source-confirmed stale resolver:** `CachingStaleStatusResolver` → `StaleStatus.{MISSING, STALE, FRESH}`. Causes have `StaleCauseCategory.{CODE, DATA, DEPENDENCIES}` and a child list for root-cause walk (`_get_stale_root_causes`).

#### Traversal

- Staleness is evaluated **per asset from its provenance vs current parent versions**, not by flooding a dirty bit through the whole DAG. Virtual assets are transparent: a view is stale if a non-virtual ancestor moved (`_get_stale_causes_materialized` ancestor loop; docs: virtual assets are not marked stale merely because an upstream updated if the view always reflects current data — the code still looks through for materialization timestamps).
- **Source-confirmed performance fail-open:** if a partition has ≥ 100 upstream partitions, that edge is **skipped** (`SKIP_PARTITION_DATA_VERSION_DEPENDENCY_THRESHOLD`). Self-dependent assets with ≥ 100 partitions skip the self-edge. This is documented in comments as a temporary performance cap.

#### Multiple paths, cycles, missing, order

- Multiple stale causes are collected and sorted by `sort_key` (`"{key}/{dependency}"`). Root causes BFS through `children` with `dedupe_key`.
- Partitioned asset queried without a partition key returns `FRESH` / `[]` “for backcompat” — **source-confirmed fail-open**.
- External assets are always `FRESH`.
- `NULL` vs `INITIAL` data versions are special-cased so a materializable-vs-external view of the same never-materialized asset does not look changed.

#### Impact severity

- Status is ternary `MISSING/STALE/FRESH`, but that is **freshness**, not publish policy. Cause categories (CODE/DATA/DEPENDENCIES) are explanation, not `blocking|render_only|advisory`.
- Automation conditions (`code_version_changed`, `eager`, `any_deps_match`) decide whether to launch a run. They are a separate algebra.

#### Snapshot / persistence

- Event-log materializations are durable. Stale status is **computed on demand** inside one request (`CachingStaleStatusResolver` docstring). Declarative automation persists evaluation cursors, not a stale watermark on descendants.

#### Explainability

- Best-in-class among the eight for “why.” UI “Unsynced” tooltip + `get_stale_causes` / `get_stale_root_causes`. Official docs walk the exact code-version vs data-version cases.

#### Tests / invariants

- [`dagster_tests/core_tests/test_data_versions.py`](https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster_tests/core_tests/test_data_versions.py)
- [`execution_tests/versioning_tests/test_data_versions.py`](https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster_tests/execution_tests/versioning_tests/test_data_versions.py)
- [`execution_tests/versioning_tests/test_view_staleness.py`](https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster_tests/execution_tests/versioning_tests/test_view_staleness.py)
- [`declarative_automation_tests/.../test_data_version_changed.py`](https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster_tests/declarative_automation_tests/automation_condition_tests/builtins/test_data_version_changed.py)
- [`dagster_graphql_tests/graphql/test_data_versions.py`](https://github.com/dagster-io/dagster/blob/master/python_modules/dagster-graphql/dagster_graphql_tests/graphql/test_data_versions.py)

#### Borrow / reject

- **Borrow for T03:** multi-cause list with deterministic sort keys; independent causes retained (maps to multi-path retention). Provenance-vs-current-parent comparison maps to pin-vs-accepted version-id.
- **Reject for T03:** “Unsynced is not transitive”; skip-at-100 edges; latest materialization as accepted head; omitted scope ⇒ FRESH; user data-version / content-hash equality as a T03 change signal.

### 4.5 Pants

**Manual:** [How does Pants work?](https://www.pantsbuild.org/stable/docs/introduction/how-does-pants-work) (v2.33), [Processes](https://www.pantsbuild.org/dev/docs/writing-plugins/the-rules-api/processes), [2021 early-cutoff note](https://www.pantsbuild.org/blog/2021/02/01/fast-incremental-builds-speculation-cancellation). **Code:** [`src/rust/graph/src/lib.rs`](https://github.com/pantsbuild/pants/blob/main/src/rust/graph/src/lib.rs), [`node.rs`](https://github.com/pantsbuild/pants/blob/main/src/rust/graph/src/node.rs), [`entry.rs`](https://github.com/pantsbuild/pants/blob/main/src/rust/graph/src/entry.rs), [`tests.rs`](https://github.com/pantsbuild/pants/blob/main/src/rust/graph/src/tests.rs).

#### Graph identity

- **Source-confirmed:** `Node: Clone + Eq + Hash`. Graph is `petgraph::DiGraph<Entry<N>, ()>`. `EntryId = NodeIndex<u32>`. Edges record “this node observed that dependency at `Generation`.”

#### Mutable head vs immutable version

- Session graph in `pantsd`. Generations increment when a node’s **output value is not identical**. There is no product-level accepted head.

#### Change detection

- **Documented:** engine caches processes from inputs; work is sandboxed; file changes invalidate fine-grained units kept warm in the daemon.
- **Source-confirmed:** `invalidate_from_roots(predicate)` clears started roots matching the predicate and dirties transitive dependents (`Direction::Incoming`). NotStarted roots are skipped to debounce. Non-`restartable()` running nodes stop the dirty walk (“dirty through” only if restartable).
- **Source-confirmed early cutoff:** `attempt_cleaning` re-gets each dep and compares `Generation`. All match → node stays clean and keeps edges. Any mismatch → `try_join_all` fails fast, edges cleared, node reruns. Official 2021 blog describes the same generation identity.

#### Traversal

- Invalidation: roots → incoming (dependents). Evaluation: outgoing deps. Cycle handling is **runtime**, not insert-time: `terminate_cycles` builds the subgraph of *Running* nodes, `kosaraju_scc`, then either clears a cleaning node or **terminates** the highest-id running node and reports `Node::cyclic_error(path)`.

#### Multiple paths, cycles, missing, order

- Multiple dependents are a set (`InvalidationResult { cleared, dirtied }`).
- Cycles among running nodes are broken, not rejected at graph construction. That is appropriate for a live engine, not for Aijian’s append-only dependency table.
- Missing deps panic: `"Dependency not present in Graph."`
- `NodeError::invalidated()` is a first-class error if a node is wiped while running.

#### Impact severity

- Binary dirty/clean, plus `cacheable` / `uncacheable` (must recompute once per `RunId`). No product impact enum.

#### Snapshot / persistence

- In-memory + LMDB process cache (`~/.cache/pants/lmdb_store`). Official troubleshooting refuses a “clear all caches” goal because they want bugs filed. That posture is the opposite of Aijian’s crash-recovery matrix.

#### Explainability

- `visualize` writes GraphViz of the walk from roots. Users mostly see “Dirtying {node}” logs. No accepted-head report.

#### Tests / invariants

- [`src/rust/graph/src/tests.rs`](https://github.com/pantsbuild/pants/blob/main/src/rust/graph/src/tests.rs) (35 KB of engine tests: invalidate, clean, cycle, restart).
- Invariants: generation equality iff value identity; `NodeError::invalidated`; cyclic_error carries a path.

#### Borrow / reject

- **Borrow for T03:** missing dependency mid-walk is a hard failure (raise), never silent success.
- **Reject for T03:** daemon memory as truth; cycle-breaking by killing a node; dependency inference instead of explicit typed edges; generation/hash equality as T03’s change signal.

### 4.6 Nix

**Manual:** [`nix why-depends`](https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-why-depends) (source of the page: [`src/nix/why-depends.md`](https://github.com/NixOS/nix/blob/master/src/nix/why-depends.md)), [content-addressing store objects](https://nix.dev/manual/nix/2.26/store/store-object/content-address), [content-addressing derivation outputs](https://nix.dev/manual/nix/2.34/store/derivation/outputs/content-address.html). **Code:** [`src/nix/why-depends.cc`](https://github.com/NixOS/nix/blob/master/src/nix/why-depends.cc), [`src/libstore/include/nix/store/path.hh`](https://github.com/NixOS/nix/blob/master/src/libstore/include/nix/store/path.hh), [`content-address.hh`](https://github.com/NixOS/nix/blob/master/src/libstore/include/nix/store/content-address.hh), [`derivations.hh`](https://github.com/NixOS/nix/blob/master/src/libstore/include/nix/store/derivations.hh).

#### Graph identity

- **Documented / source-confirmed:** a `StorePath` is `hashPart` (32 base-32 chars, 160 bits) + name. Nodes are store objects. Edges are **references** (runtime: scanned hash parts inside files; build-time: derivation inputs). `why-depends` builds `{path, refs, rrefs}` for the FS closure.

#### Mutable head vs immutable version

- Store objects are immutable. Input-addressed outputs have paths computed from the derivation (how it was built). Content-addressed outputs have paths computed from the result bytes (`Type::ContentAddressed { sandboxed, fixed }` vs `InputAddressed` vs `Impure` in `derivations.hh`).
- Flake lock / profile generations are the mutable heads. They are not Gate-approved.

#### Change detection

- Rebuilds happen when the derivation (inputs, builder, env) changes — input addressing — or when a fixed-output hash mismatches. CA floating outputs are not known until build.
- **Documented `why-depends`:** if the dependency’s store path is not already known (unbuilt CA derivation), it is **not** a dependency of `package`, because realizing `package` would have required it. Missing realisation ⇒ “does not depend.”

#### Traversal

- **Source-confirmed:** compute FS closure of `package`; if `dependency` ∉ closure, print “does not depend” and return. Transpose refs → rrefs. Dijkstra from the dependency so every node stores distance and `prev`. Print shortest path by default; `--all` prints every edge on some path; `--precise` scans files for the hash part that caused the reference.

#### Multiple paths, cycles, missing, order

- Default: one shortest path. `--all`: all paths, still shortest-first via `multimap<dist, Node*>`.
- Self-references are a supported diagnostic (`why-depends glibc glibc`).
- Unrealised CA dependency is treated as non-dependency (see above) — correct for Nix, **wrong** if naively copied to “missing blocking StoryBible ⇒ consumable.”
- Closure maintenance is fail-closed at install time: “it is therefore not possible to install a store path without having all of its references present.”

#### Impact severity

- None. A reference either exists or not. Unexpected compiler references are a closure-size bug, not an advisory warning.

#### Snapshot / persistence

- The Nix store is the snapshot. Realisations are durable. No stale bit on a previously built path — the old path remains; a new path is a new identity. That is the purest immutability model in the set.

#### Explainability

- Best-in-class for **path** explanation: node sequence + file fragment containing the next hash. This is the model Aijian’s UI should imitate for “why is this ShotIntent stale.”

#### Tests / invariants

- Command is covered by Nix’s functional tests around `why-depends` (manual embeds the contract). Store-path constructor throws `BadStorePath`. Closure is mandatory.
- Invariant: references are content-detected hash parts, not declared impact types.

#### Borrow / reject

- **Borrow for T03:** ordered path from subject to mismatched upstream; retain multi-path explanations; hop witness fields become `dependency_id`, relationship, pin, current accepted, effective impact.
- **Reject for T03:** “missing realisation ⇒ does not depend” (missing accepted head is a typed mismatch; missing rows raise); scanned string references instead of `artifact_dependencies`; LGPL code import.

### 4.7 dbt Core

**Manual:** [state selection](https://docs.getdbt.com/reference/node-selection/state-selection), [state method](https://docs.getdbt.com/reference/node-selection/methods#state), [graph operators](https://docs.getdbt.com/reference/node-selection/graph-operators), [state comparison caveats](https://docs.getdbt.com/reference/node-selection/state-comparison-caveats). **Code (production v1):** branch [`1.latest`](https://github.com/dbt-labs/dbt-core/tree/1.latest) — [`core/dbt/graph/selector_methods.py`](https://github.com/dbt-labs/dbt-core/blob/1.latest/core/dbt/graph/selector_methods.py) `StateSelectorMethod`, [`selector.py`](https://github.com/dbt-labs/dbt-core/blob/1.latest/core/dbt/graph/selector.py), [`graph.py`](https://github.com/dbt-labs/dbt-core/blob/1.latest/core/dbt/graph/graph.py). **Code (v2 alpha on `main`):** Rust crates `dbt-dag`, `dbt-selector-parser`, `dbt-common/src/node_selector.rs`, `dbt-schemas/src/schemas/prev_state`. README on `main` warns that v1 development moved to `1.latest`.

This comparison treats **v1 `1.latest` as the production mechanism** (documented Slim CI). v2 is scanned as a rewrite in progress, not as the contract.

#### Graph identity

- Nodes: `unique_id` (`model.package.name`, sources, exposures, metrics, …). Edges: `ref` / `depends_on`, stored on a NetworkX `DiGraph`. `parent_test` edges are excluded from ancestor/descendant walks.

#### Mutable head vs immutable version

- Comparison is **manifest vs manifest**. `--state` points at a previous `manifest.json` (and related artifacts). That previous manifest is a snapshot of *code + declared graph*, not of warehouse table bytes. Deferral uses the state manifest as a stand-in for unselected upstream relations.

#### Change detection

- **Documented / source-confirmed `state:` selectors:** `new`, `old`, `modified`, `unmodified`, `modified.body`, `modified.configs`, `modified.persisted_descriptions`, `modified.relation`, `modified.macros`, `modified.contract`.
- `modified` = `same_contents` failure OR upstream macro change (recursive) OR contract change. Removed/disabled/renamed nodes are included for some checkers.
- **Documented caveats:** seeds hashed only if &lt; 1 MiB; `tags` and `meta` changes do **not** count as modified; macro changes mark every dependent resource.

#### Traversal

- **Documented graph operators:** `+model` ancestors, `model+` descendants, `+model+` both, `n+` depth limits, `@` children’s parents.
- **Source-confirmed:** `Graph.select_children` / `select_parents` are layered BFS. `get_subset_graph` removes unselected nodes while **rewiring transitive edges** (product of in-edges × out-edges, skipping self-loops). Missing selected ids raise `CompilationError`.

#### Multiple paths, cycles, missing, order

- Selection is a set. Multiple paths just put a node in the set once.
- Cycles are a compilation failure in dbt’s DAG construction (project won’t parse).
- No previous manifest ⇒ `DbtRuntimeError("Got a state selector method, but no comparison manifest")` — fail closed for this feature.
- Missing referenced macro ⇒ `CompilationError` (fail closed).

#### Impact severity

- `state:modified.*` is a **taxonomy of change kinds**, not consumption policy. Indirect selection of tests is a separate knob (`IndirectSelection`), not `render_only`.

#### Snapshot / persistence

- The state directory is an explicit snapshot boundary. This is the closest OSS analogue to “assessment against accepted heads at revision R.” It is computed on demand; it does not stamp warehouse tables stale.

#### Explainability

- `dbt ls --select state:modified+` shows the set. Users do not get a path of edges with impacts. Slim CI is explained in docs more than in a machine-readable cause tree.

#### Tests / invariants

- [`tests/unit/graph/test_selector_methods.py`](https://github.com/dbt-labs/dbt-core/blob/1.latest/tests/unit/graph/test_selector_methods.py)
- [`tests/unit/graph/test_graph.py`](https://github.com/dbt-labs/dbt-core/blob/1.latest/tests/unit/graph/test_graph.py)
- [`tests/unit/test_graph_selection.py`](https://github.com/dbt-labs/dbt-core/blob/1.latest/tests/unit/test_graph_selection.py)
- Official caveats page is itself an invariant list (what does *not* count as modified).

#### Borrow / reject

- **Borrow for T03:** explicit comparison operand (current accepted heads on the SQLite connection); fail if required comparison rows are absent (raise).
- **Reject for T03:** `state:modified.*` as the impact algebra; ignoring structural metadata; Fusion/`main` v2-alpha as the contract.

### 4.8 Turborepo

**Manual:** [Configuring turbo.json / `affectedUsingTaskInputs`](https://turbo.build/repo/docs/reference/configuration), [run](https://turbo.build/repo/docs/reference/run), [configuring tasks](https://turbo.build/repo/docs/crafting-your-repository/configuring-tasks). **Code:** [`crates/turborepo-engine/src/affected.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-engine/src/affected.rs), [`crates/turborepo-scope/src/change_detector.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-scope/src/change_detector.rs), [`crates/turborepo-task-hash/src/lib.rs`](https://github.com/vercel/turborepo/blob/main/crates/turborepo-task-hash/src/lib.rs).

#### Graph identity

- Package graph + task graph. A node is `TaskId` (`package#task`). Edges are `dependsOn`. Hash identity is `TaskHashable` over files, env, dependency task hashes, global hash.

#### Mutable head vs immutable version

- Git refs + content hashes of inputs. Cache lookup is by hash, so outputs are content-addressed blobs. Package names are mutable workspace identity.

#### Change detection

- **Source-confirmed package-level:** `ScopeChangeDetector.changed_packages` diffs Git (`from_ref`/`to_ref`, uncommitted, merge-base). Invalid ref range **defaults to all packages changed** (`AllPackageChangeReason::GitRefNotFound`). SCM path errors also default to all packages (`AllPackageChangeReason::ScmError`) after a warning. Lockfile previous-content failure becomes `LockfileContents::UnknownChange`.
- **Source-confirmed task-level (opt-in):** `match_tasks_against_changed_files` iterates **every** engine task (including tasks in non-affected packages, because `$TURBO_ROOT$` inputs can see root files). Default inputs = all package files. **Does not include transitive dependents** — callers must propagate.
- **Documented:** `affectedUsingTaskInputs` default `false` means package-level affected (any file in package ⇒ all tasks).

#### Traversal

- Affected package set, then task graph `dependsOn` for execution order. Cache hits skip the task even if the package is in the affected set (hash still matches).

#### Multiple paths, cycles, missing, order

- Affected is a map `TaskId → first matching file`. Multiple files collapse to the first match.
- Missing package for a task is `AffectednessError::UnknownTaskPackage` (fail closed). Invalid input glob is an error.
- Hashing fails closed on missing dependency task hash (`MissingDependencyTaskHash`).
- Unknown Git objects can be configured `allow_unknown_objects` → treat as all changed (fail open).

#### Impact severity

- Binary affected + independent cache boolean (`cache: false` forces run). Not a three-level algebra.

#### Snapshot / persistence

- Remote/local cache keyed by task hash. No durable stale mark on a package.

#### Explainability

- Run summary includes task hash, inputs, outputs, dependencies, dependents, env. `--affected` is explained at package or task granularity. No “this edge blocks G8.”

#### Tests / invariants

- In-file tests in `affected.rs` (`multiple_tasks_selective_matching`, `$TURBO_ROOT$` cross-package case).
- `turborepo_types::task_input_matching::tests` for glob matching.
- Invariant the module comment states: both `turbo run --affected` and `turbo query { affectedTasks }` must share this implementation.

#### Borrow / reject

- **Borrow for T03:** one pure shared assessor function reused by every call site (T02 Gate path and any later caller).
- **Reject for T03:** unknown Git/SCM error → all affected; package-level coarseness; treating cache miss as impact severity.

## 5. Comparison matrix

Legend: **D** documented, **S** source-confirmed, **I** inference. Severity “binary” means affected/stale vs not.

| Concern | Skyframe | Nx | DVC | Dagster | Pants | Nix | dbt v1 | Turborepo | **Bounded T03 need** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Node identity | `SkyKey` (D/S) | project / task (D/S) | `Stage` path (S) | `AssetKey`[+partition] (D/S) | hashed `Node` (S) | `StorePath` (D/S) | `unique_id` (D/S) | `package#task` (S) | `(project_id, artifact_id, version_id)`; target must be current accepted head |
| Edge identity | requested SkyKey (S) | project/task dep (D) | output→dep stage (S) | parent asset key (S) | observed `EntryId`+`Generation` (S) | store reference (D/S) | `depends_on` / `ref` (D/S) | `dependsOn` (D) | `dependency_id` + relationship + impact + exact upstream/downstream versions |
| Mutable head | filesystem / differencer (D) | Git SHA (D) | workspace + git exp (D) | latest materialization (D/S) | pantsd session (D) | profile / flake lock (D) | `--state` manifest (D) | Git ref (S) | `ArtifactHead.accepted_version_id` (read only in T03) |
| Immutable version | `SkyValue` (D) | none per project (I) | cache hash / lock (S) | `DataVersion` (D/S) | node output + generation (S) | store object (D) | node checksum in manifest (D) | task hash (S) | immutable `version_id` pin on edges |
| Change signal | file state / injected diff (D/S) | Git file set (D) | stage md5, dep/out status (S) | code/data/dep provenance (D/S) | file roots + generation (S) | drv / CA hash (D) | manifest diff (D/S) | Git + input globs (S) | **only** pinned `version_id` ≠ current accepted (or accepted `None`) |
| Walk direction | reverse transitive (D/S) | dependents (D/S) | postorder deps; optional downstream (S) | per-node provenance (D/S) | incoming dependents (S) | refs / rrefs + Dijkstra (S) | `+` ancestors/descendants (D/S) | package/task then dependsOn (S) | **upstream path enumeration** from accepted target only (read-only) |
| Multi-path algebra | union (S) | set (S) | flattened DFS (S) | cause list + sort_key (S) | set (S) | shortest or `--all` (S) | set (D) | first matching file (S) | **per path `min` severity; across paths `max`; retain independent causes** |
| Cycles | eval error (S) | config error (I) | insert abort (S) | partition self-edge skip (S) | break running SCC (S) | self-ref printable (D) | compile error (D) | engine validate (I) | insert trigger already; defensive cycle ⇒ **repository error** |
| Missing / corrupt | throw if parent enqueued missing (S) | throw invalid project (S) | `--allow-missing` opt (D/S) | MISSING or skip edge (S) | panic missing dep (S) | missing CA ⇒ not a dep (S) | no manifest ⇒ error (S) | unknown range ⇒ all (S) | structural ⇒ **raise stable repository error**; missing accepted head ⇒ **typed mismatch cause** |
| Deterministic order | unspecified parallel (S) | unspecified set (I) | NetworkX DFS (S) | sorted causes (S) | unspecified (I) | shortest-first (S) | BFS layers (S) | first file (S) | **sort causes by full dependency-id path** |
| Severity / modes | DIRTY/CHANGE/REWIND (S) | binary (D) | binary + labels (S) | FRESH/STALE/MISSING (S) | dirty/clean (S) | binary ref (D) | modified.* (D/S) | binary + cache (D) | **`general` / `render` modes**; `stale` only if blocking |
| Snapshot | in-memory server (D) | Git range (D) | lock + cache (D) | event log on demand (S) | daemon + LMDB (D) | store (D) | previous manifest (D) | cache hash (D) | **one SQLite read txn**; same connection inside Gate `BEGIN IMMEDIATE` |
| Explainability | rebuild logs / query (D) | affected graph viz (D) | `status` / `dag` (D) | cause tree (D/S) | GraphViz / logs (S) | **why-depends paths** (D/S) | `dbt ls` set (D) | run summary hashes (D) | ordered `dependency_id` path + relationship + pin vs accepted |
| Persist stale marks | no | no | no | no | no | no | no | no | **out of T03** (later F05/T04 only) |

## 6. Decision for bounded T03

Sections 3–4 remain the OSS benchmark. This section is the **only** implementation-facing contract for T03 code that may follow after review.

### 6.1 Recommended frozen result shape

Small typed records (names illustrative; freeze fields, not brand marketing):

```text
ConsumptionMode = "general" | "render"

MismatchCause
  dependency_path: tuple[dependency_id, ...]   # complete ordered path, target → mismatched upstream
  relationships: tuple[relationship, ...]      # parallel to edges on that path (enough to explain)
  edge_impacts: tuple[DependencyImpact, ...]   # parallel to edges; for audit
  effective_impact: DependencyImpact           # min(edge_impacts) by severity
  pinned_upstream_version_id: str
  current_accepted_version_id: str | None
  # typed mismatch only: accepted_head_moved | accepted_head_missing
  # (structural problems raise; they are not causes)

InvalidationAssessment
  project_id: str
  artifact_id: str
  version_id: str
  mode: ConsumptionMode
  causes: tuple[MismatchCause, ...]            # deterministic order; independent paths retained
  stale: bool                                  # True iff any cause.effective_impact == blocking
  consumable: bool                             # mode-specific (see §6.2)
```

Derivation rules:

| Field | Rule |
| --- | --- |
| `stale` | `any(c.effective_impact == "blocking" for c in causes)` — **`render_only` never sets `stale`** |
| `consumable` in `general` | `not any(c.effective_impact == "blocking" for c in causes)` |
| `consumable` in `render` | `not any(c.effective_impact in ("blocking", "render_only") for c in causes)` |
| empty causes | `stale=false`, `consumable=true` (after guard order §6.3 succeeds) |

Borrowed shape lessons (not copied wholesale): Dagster’s multi-cause list + sort keys; Nix’s ordered path of edges from subject to mismatch. **Not** Nx affected sets, **not** Skyframe dirty bits, **not** `blocking_publish`, **not** waiver fields.

### 6.2 Path-impact algebra (corrected)

Severity total order (frozen):

```text
rank(advisory)    = 1
rank(render_only) = 2
rank(blocking)    = 3
```

**Along one path (weaken only):**

```text
effective(path) = argmin_{e in path.edges} rank(e.impact)
```

Required identities:

| Path edge impacts (target → … → mismatch) | `effective_impact` |
| --- | --- |
| `blocking → render_only` | `render_only` |
| `advisory → blocking` | `advisory` |
| `blocking → blocking` | `blocking` |
| `render_only` (single edge) | `render_only` |
| `advisory` (single edge) | `advisory` |

**Across independent paths (strengthen):**

```text
overall_strength = argmax_{c in causes} rank(c.effective_impact)
```

Independent causes are **retained** (not collapsed into one row). Severity across them uses `max`, so any independent blocking path wins.

Required multi-path example:

- Path A: direct `advisory` mismatch → cause with `effective_impact=advisory`
- Path B: separate all-`blocking` path mismatch → cause with `effective_impact=blocking`
- Assessment retains **both** causes; `stale=true`; `general` `consumable=false`; `render` `consumable=false`.

Mode application after causes are computed:

| Mode | Rejecting effective impacts | Allows |
| --- | --- | --- |
| `general` | `blocking` only | `render_only`, `advisory`, none |
| `render` | `blocking`, `render_only` | `advisory`, none |

Change signal for emitting a cause: on the path from the **accepted** target to some upstream artifact, the **pinned** `upstream_version_id` on the mismatching hop differs from that upstream artifact’s current `accepted_version_id`, or accepted is `None` (`accepted_head_missing`). **Any** accepted version-id change is conservatively meaningful. T03 does **not** compare `content_hash` or semantic fields.

Walk: enumerate simple upstream dependency paths from the target through **pinned** versions (Dagster provenance style + Nix multi-path). Do not flood dirty bits downstream. Do not stop early on an `advisory` hop if another independent path is `blocking`.

### 6.3 Guard order (future and T02)

Mandatory order for every assessment call:

1. **Target acceptance guard.** Resolve `(project_id, artifact_id, version_id)`. Fail (repository error / invalid assessment input) unless `artifact_heads.accepted_version_id == version_id` for that artifact in-project. Drafts, review-only versions, and **old** accepted versions **must not** succeed merely because their ancestors still match current heads.
2. **Mode.** Require `mode ∈ {general, render}`.
3. **Dependency walk** for that mode: load edges, detect typed mismatches, build `MismatchCause`s, compute `stale` and `consumable`.
4. **Structural checks** during the walk: ownership / same-project, known impact enum, required rows exist, defensive cycle. Failures **raise** (see §6.5); they are not soft causes.

#### T02 reuse (`_require_current_blocking_g1`)

Source today ([`repository.py`](../../services/api/src/aijian_api/repository.py) `_require_current_blocking_g1`):

- Runs on the **same** `sqlite3.Connection` after `BEGIN IMMEDIATE` in Gate prepare/action paths.
- Runs **before** challenge consumption.
- For `story_bible` only: requires ≥1 direct edge with `relationship='derived_from'` and `impact='blocking'`, and each such pin’s upstream row is `source_manifest` whose **accepted** head equals the pin.

T03 recommendation:

- Introduce a **connection-scoped** generic assessor used for staleness (`mode="general"` for Gate structural consumption).
- `_require_current_blocking_g1` **keeps** the exact direct `derived_from + blocking` SourceManifest structural invariant (raise `ArtifactDependencyInvalidError` if missing/wrong type).
- After that structural invariant holds, use the generic assessor so a StoryBible whose G1 pin is no longer the accepted SourceManifest is rejected as **stale** / not consumable, still inside the same `BEGIN IMMEDIATE` and still before challenge consumption.
- Do not open a second connection; do not require a separate public route for T02.

### 6.4 Deterministic ordering

Causes are a sorted tuple before return:

```text
sort key = (
  dependency_path,                    # lexicographic over dependency_id strings
  pinned_upstream_version_id,
  current_accepted_version_id or "",
  effective_impact rank DESC,         # stronger first for human scan; optional but stable
)
```

Within a cause, `dependency_path` is ordered **target → mismatched upstream**. Do not rely on hash map iteration order.

### 6.5 Snapshot boundary (SQLite only, T03)

| Call site | Boundary |
| --- | --- |
| Public / unit assessment | **One** explicit SQLite read transaction (or the ambient connection already in a transaction). Observe one complete old or new snapshot of heads + versions + dependencies. |
| Gate path (T02) | Reuse the **existing** connection inside `BEGIN IMMEDIATE`; assess before challenge consumption. |

Out of T03:

- Postgres-specific isolation protocols
- Persisted snapshot revision tokens / `If-Match` assessment protocol
- Post-read `snapshot_race` API
- Reading open waivers
- Writing `StaleMark` / operation recovery tables

Concurrency: the Gate’s `BEGIN IMMEDIATE` already serializes head moves vs assessment on that connection. Public read assessments are snapshot-consistent within their single read transaction; they do not invent a multi-phase race protocol.

### 6.6 Fail-closed policy (repository vs typed causes)

| Situation | Behavior |
| --- | --- |
| Target is not current accepted head | Reject assessment input / repository error — do **not** return `consumable=true` |
| Cross-project edge / ownership mismatch | **Raise** stable repository error (e.g. `ArtifactDependencyInvalidError`) |
| Missing required version/artifact/dependency **row** | **Raise** stable repository error |
| Corrupt / impossible `impact` value | **Raise** stable repository error |
| Defensive cycle detected during walk | **Raise** stable repository error (insert trigger already prevents normal writes) |
| Accepted head is `None` while a pin exists | **Typed** `MismatchCause` with `current_accepted_version_id=None`, `accepted_head_missing` semantics |
| Pinned version exists but ≠ current accepted | **Typed** `MismatchCause` (`accepted_head_moved`) |
| Nx/Turbo-style “unknown ⇒ all stale” | **Rejected** |
| Dagster-style skip edge / omit scope ⇒ FRESH | **Rejected** |
| Convert structural corruption into a soft blocking cause | **Rejected** |

Structural problems never become ordinary assessment causes. Typed mismatches never become silent `consumable=true`.

### 6.7 What is original to Aijian (and in T03)

No OSS benchmark supplies this combination:

1. Edge-level `blocking | render_only | advisory` with **path `min` / multi-path `max`**.
2. Exactly two consumption modes (`general` / `render`) driving `consumable`.
3. `stale` defined only by blocking effective impact (render_only does not stale the general artifact).
4. Assessment only after the target is proven to be the **current accepted head**.
5. Change signal = accepted **version-id** pin mismatch only (Gate heads, not materializations or Git diffs).
6. No waivers in the assessor.

Closest non-equivalents remain: Skyframe DIRTY/CHANGE (evaluation), Dagster FRESH/STALE (freshness + non-transitive unsynced), dbt `state:modified.*` (code change kinds), Turbo `cache: false` (always run).

### 6.8 Mapping → T03 requirements

| Frozen requirement | Where satisfied |
| --- | --- |
| Path `min` / multi-path `max` | §6.2 |
| Modes `general` / `render` | §6.1–6.2 |
| `stale` only from blocking | §6.1 |
| No waivers | §2.1, §6.1, §6.5 |
| Version-id mismatch only | §6.2, §6.6 |
| Structural errors raise | §6.6 |
| Result: mode, causes with full dependency-id path, pin vs accepted, effective impact, stale, consumable | §6.1 |
| Target accepted-head guard first | §6.3 |
| T02 `_require_current_blocking_g1` + `BEGIN IMMEDIATE` + before challenge | §6.3 |
| Single SQLite read / connection-scoped | §6.5 |
| Read-only; no persist/migration/route/UI | §2.1, §6.9 |

### 6.9 Later F05 / T04 — **not T03**

Benchmark lessons that must **not** enter the T03 implementation or its test matrix:

- Downstream **marking walks** and durable `StaleMark` rows after accepted-head advance
- `operation_id` / pending-set recovery (Skyframe `pendingVisitations` analogy)
- Same-transaction head move + bulk stale persistence
- Named waiver coverage of blocking paths
- Content-hash or typed semantic-field prune (envelope step 1 / C04) — optional later, never silent for T03
- Public HTTP routes / UI impact reports
- Schema migrations for invalidation tables

Those remain product goals for F05 / film invalidation reports; citing them here does not authorize T03 code to implement them.

### 6.10 Unresolved risks and **T03** tests only

Risks:

1. Multi-hop diamonds with mixed edge impacts — golden fixtures for path `min` vs multi-path `max`.
2. Large fan-in — must not drop paths (reject Dagster skip-100).
3. T02 structural SourceManifest check must not be weakened when the generic assessor is introduced.
4. Assessor must refuse non-accepted targets without scanning deps.
5. SQLite single-connection reuse under `BEGIN IMMEDIATE` (no nested write txn from the assessor).

**T03 test table** (read-only assessor + T02 wiring; no mark/waiver/migrate tests):

| ID | Invariant |
| --- | --- |
| T03-G1 | Target not current accepted head → assessment rejected; drafts/old accepted cannot pass on ancestor currency alone |
| T03-G2 | No mismatches → `stale=false`, `consumable=true` for both modes |
| T03-G3 | Single-edge `blocking` mismatch → `stale=true`; `general` and `render` both `consumable=false` |
| T03-G4 | Single-edge `render_only` mismatch → `stale=false`; `general` `consumable=true`; `render` `consumable=false` |
| T03-G5 | Single-edge `advisory` mismatch → `stale=false`; both modes `consumable=true` |
| T03-G6 | Path `blocking → render_only` → effective `render_only` (min); same consumable pattern as G4 |
| T03-G7 | Path `advisory → blocking` → effective `advisory` (min); same consumable pattern as G5 |
| T03-G8 | Independent advisory path **and** independent all-blocking path → both causes retained; blocking wins (`stale=true`, `general` not consumable) |
| T03-G9 | Accepted head `None` on a pin → typed mismatch cause with `current_accepted_version_id=None` |
| T03-G10 | Missing dependency/version row, bad impact, cross-project edge, or defensive cycle → **raises** repository error (not a soft cause) |
| T03-G11 | Cause order stable for identical graphs (dependency-id path sort) |
| T03-G12 | `_require_current_blocking_g1` still requires direct `derived_from+blocking` SourceManifest structure |
| T03-G13 | `_require_current_blocking_g1` rejects when G1 accepted head moved (generic assessor), still inside `BEGIN IMMEDIATE` before challenge consume |
| T03-G14 | Assessor performs no writes (read-only) |

## 7. Per-project borrow/reject recap (T03 lens)

| Project | Borrow **for T03** | Reject **for T03** |
| --- | --- | --- |
| Skyframe | Hermetic “only declared deps count”; missing parent is hard error | Change pruning; in-memory truth; dirty-bit flood as the API |
| Nx | Explicit comparison base idea (here: current accepted heads) | Unknown range ⇒ all affected; Git as identity |
| DVC | Acyclic insert discipline; corrupt data is not “fresh” | `--allow-missing`; frozen edges; always-changed callbacks |
| Dagster | Multi-cause list + deterministic sort; provenance vs current parent | Non-transitive unsynced; skip-100; omitted scope = FRESH; materialize = accept |
| Pants | Fail if dependency row missing mid-walk | Daemon truth; kill-a-node cycle “repair” |
| Nix | Ordered path explanation subject → mismatch | Missing realisation = no dep; content-address as sole id |
| dbt v1 | Explicit comparison operand; fail if comparison state missing | tags/meta ignored; modified.* as impact algebra |
| Turborepo | One shared pure function for all call sites | SCM error ⇒ all affected; package-level coarseness |

**Later F05 only (not T03 borrow list):** Skyframe interrupt-safe pending sets, Nx reverse-DAG marking walks, durable stale projections.

## 8. Sources

### Official manuals

- https://bazel.build/reference/skyframe
- https://nx.dev/docs/features/ci-features/affected
- https://nx.dev/docs/concepts/mental-model
- https://nx.dev/docs/features/explore-graph
- https://dvc.org/doc/command-reference/repro (also https://doc.dvc.org/command-reference/repro)
- https://docs.dagster.io/guides/build/assets/asset-versioning-and-caching
- https://docs.dagster.io/guides/build/assets/virtual-assets
- https://docs.dagster.io/api/dagster/assets
- https://www.pantsbuild.org/stable/docs/introduction/how-does-pants-work
- https://www.pantsbuild.org/dev/docs/writing-plugins/the-rules-api/processes
- https://www.pantsbuild.org/blog/2021/02/01/fast-incremental-builds-speculation-cancellation
- https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-why-depends
- https://nix.dev/manual/nix/2.26/store/store-object/content-address
- https://nix.dev/manual/nix/2.34/store/derivation/outputs/content-address.html
- https://docs.getdbt.com/reference/node-selection/state-selection
- https://docs.getdbt.com/reference/node-selection/methods
- https://docs.getdbt.com/reference/node-selection/graph-operators
- https://docs.getdbt.com/reference/node-selection/state-comparison-caveats
- https://turbo.build/repo/docs/reference/configuration
- https://turbo.build/repo/docs/reference/run

### Source (inspected as raw files from default branches / `1.latest` on 2026-08-14)

- https://github.com/bazelbuild/bazel/blob/master/src/main/java/com/google/devtools/build/skyframe/InvalidatingNodeVisitor.java (`DirtyingNodeVisitor`, `InvalidationType`, `InvalidationState`)
- https://github.com/bazelbuild/bazel/blob/master/src/main/java/com/google/devtools/build/skyframe/EagerInvalidator.java
- https://github.com/bazelbuild/bazel/blob/master/src/main/java/com/google/devtools/build/skyframe/DirtyBuildingState.java (`signalDep`, `VERIFIED_CLEAN`)
- https://github.com/bazelbuild/bazel/blob/master/src/main/java/com/google/devtools/build/skyframe/NodeEntry.java (`DirtyType`, `LifecycleState`)
- https://github.com/bazelbuild/bazel/blob/master/src/main/java/com/google/devtools/build/skyframe/FunctionHermeticity.java
- https://github.com/bazelbuild/bazel/blob/master/src/main/java/com/google/devtools/build/skyframe/Differencer.java
- https://github.com/nrwl/nx/blob/master/packages/nx/src/project-graph/affected/affected-project-graph.ts (`filterAffected`)
- https://github.com/nrwl/nx/blob/master/packages/nx/src/project-graph/affected/locators/workspace-projects.ts
- https://github.com/nrwl/nx/blob/master/packages/nx/src/project-graph/affected/affected-project-graph.spec.ts
- https://github.com/iterative/dvc/blob/main/dvc/repo/reproduce.py (`plan_repro`, `_reproduce`, `get_active_graph`)
- https://github.com/iterative/dvc/blob/main/dvc/repo/graph.py (`check_acyclic`, `build_graph`)
- https://github.com/iterative/dvc/blob/main/dvc/repo/status.py
- https://github.com/iterative/dvc/blob/main/dvc/stage/__init__.py (`Stage.changed`, `Stage.status`)
- https://github.com/iterative/dvc/blob/main/dvc/stage/cache.py (`StageCache`, corrupt unlink)
- https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster/_core/definitions/data_version.py (`DataVersion`, `DataProvenance`, `CachingStaleStatusResolver`, `compute_logical_data_version`)
- https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster/_core/definitions/declarative_automation/automation_condition.py
- https://github.com/pantsbuild/pants/blob/main/src/rust/graph/src/lib.rs (`invalidate_from_roots`, `attempt_cleaning`, `terminate_cycles`)
- https://github.com/pantsbuild/pants/blob/main/src/rust/graph/src/node.rs (`Node::cyclic_error`, `NodeError::invalidated`)
- https://github.com/NixOS/nix/blob/master/src/nix/why-depends.cc (`CmdWhyDepends`)
- https://github.com/NixOS/nix/blob/master/src/nix/why-depends.md
- https://github.com/NixOS/nix/blob/master/src/libstore/include/nix/store/path.hh
- https://github.com/NixOS/nix/blob/master/src/libstore/include/nix/store/derivations.hh
- https://github.com/dbt-labs/dbt-core/blob/1.latest/core/dbt/graph/selector_methods.py (`StateSelectorMethod`)
- https://github.com/dbt-labs/dbt-core/blob/1.latest/core/dbt/graph/graph.py
- https://github.com/dbt-labs/dbt-core/blob/1.latest/core/dbt/graph/selector.py
- https://github.com/vercel/turborepo/blob/main/crates/turborepo-engine/src/affected.rs (`match_tasks_against_changed_files`)
- https://github.com/vercel/turborepo/blob/main/crates/turborepo-scope/src/change_detector.rs
- https://github.com/vercel/turborepo/blob/main/crates/turborepo-task-hash/src/lib.rs

### GitHub metadata

- `GET https://api.github.com/repos/{owner}/{repo}` at 2026-08-14T11:12:04Z for the eight repos listed in §3.
- `GET .../commits?per_page=1`, `GET .../releases?per_page=…`, `GET .../tags?per_page=…` the same day.
- Star-growth restriction: https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/

### Aijian in-repo contracts this decision implements against

- [`docs/contracts/artifact-envelope.md`](../contracts/artifact-envelope.md) (edge impact enum; exact version pins)
- [`docs/architecture/ADR-0002-deterministic-workflow.md`](../architecture/ADR-0002-deterministic-workflow.md)
- [`services/api/src/aijian_api/domain.py`](../../services/api/src/aijian_api/domain.py) `DependencyImpact`
- [`services/api/src/aijian_api/repository.py`](../../services/api/src/aijian_api/repository.py) `artifact_dependencies`, cycle trigger, immutability triggers, `_require_current_blocking_g1`, `BEGIN IMMEDIATE` Gate paths
- F05 / film-invalidation product goals remain **out of T03** (see §6.9)

## 9. Evidence gaps (honest)

- 30-day star growth: **not verifiable** for every repo.
- Bazel public GitHub is a published mirror of a Google-internal tree ([codebase note](https://bazel.build/contribute/codebase)); Skyframe behavior cited here is from the public tree and the public manual.
- DVC’s GitHub namespace has moved to `treeverse/dvc`; API still serves `iterative/dvc`. Latest **release** is four months older than HEAD.
- dbt `main` is Core v2 / Fusion alpha. Production Slim CI source was read from `1.latest`. v2 `prev_state` / selector crates were listed, not treated as the T03 contract.
- Nix has no GitHub Releases; activity is commits + tags (`2.35.2`).
- Turborepo cycle detection was not fully traced beyond task-name validation; execution-graph cycle behavior is an **inference** gap and does not affect the reject of “SCM error ⇒ all affected.”
- No official three-level impact algebra with path-`min` / multi-path-`max` and dual consumption modes was found in any of the eight.

This revision freezes the **bounded T03** contract in §2.1 and §6. Implementation, if approved, is limited to a connection-scoped read-only assessor, T02 wiring, and the tests in §6.10 — not F05 persistence.