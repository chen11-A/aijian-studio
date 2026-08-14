# T05C Invalidation Golden Acceptance — Decision Note

Status: implementation decision for bounded T05C (technical F05 `invalidation-golden` closeout).
Observation clock: 2026-08-14.

## Workspace / lineage

- Working branch: `codex/f05-invalidation-golden`.
- A2 implementation HEAD (fixture + oracle landed): `1acb2359e4493d79c60a93ceda5863120a15b4b6`
  (`feat(t05c): add real Gate invalidation golden fixture`).
- Prior T05C oracle slice: `daec78a` / coherence fix `147644a`.
- Earlier impact-report base still present in history at `e0091dc`
  (`Order invalidation events by absolute time and gate contract coverage`); that commit is **not**
  the T05C golden decision base.

Research layers:

1. **Prior in-repo mechanism research (T03/T04/T05A/T05B)** — acceptance-shape borrowing from
   Bazel/Nx/Nix/Dagster/Pants/dbt/DVC/Turborepo primary refs already recorded below. No redesign of
   those mechanism conclusions in A3.
2. **A3 adoption/momentum refresh (this note)** — live GitHub repository star totals observed on
   2026-08-14 for the same eight systems. Current stars are supporting adoption evidence only; they
   do **not** change the technical borrowing decision or authorize code copying.

## Primary sources inspected (exact in-repo refs)

| System           | Mechanism used for acceptance shape                                    | Exact primary refs (from prior Aijian research)                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bazel / Skyframe | Bottom-up reverse-dep invalidation; interrupt-safe operation identity  | [Skyframe manual](https://bazel.build/reference/skyframe); `EagerInvalidator.java`; `InvalidatingNodeVisitor.java` (`pendingVisitations`, `InvalidationType`) — T03 §4.1 / T04 table         |
| Nx               | Reverse graph then DFS dependents; project-scoped affected set         | `packages/nx/src/project-graph/affected/affected-project-graph.ts` (`filterAffected`, `reverse`); [Affected docs](https://nx.dev/docs/features/ci-features/affected) — T03 §4.2 / T04 / T05A |
| Nix              | Ordered multi-path explanation; `--all` retains every independent path | [nix why-depends](https://nix.dev/manual/nix/latest/command-ref/new-cli/nix3-why-depends); `why-depends.cc` (`--all`) — T03 §4.6 / T04 / T05A                                                |
| Dagster          | Multi-cause stale presentation; deterministic `sort_key`               | `python_modules/dagster/dagster/_core/definitions/data_version.py` (`StaleCause.sort_key`, `CachingStaleStatusResolver`) — T03 §4.4 / T04 / T05A                                             |
| Pants            | Missing dependency mid-walk is hard failure                            | `src/rust/graph/src/lib.rs` (`invalidate_from_roots`) — T03 §4.5 / T04                                                                                                                       |
| dbt Core (v1)    | Explicit comparison operand; fail closed without state                 | `1.latest` `StateSelectorMethod`; state-selection docs — T03 §4.7                                                                                                                            |
| DVC              | Acyclic graph; corrupt cache not trusted as fresh                      | `dvc/repo/reproduce.py`, `dvc/stage/cache.py` — T03 §4.3                                                                                                                                     |
| Turborepo        | Shared pure affected function; reject SCM-error ⇒ all                  | `crates/turborepo-engine/src/affected.rs` — T03 §4.8                                                                                                                                         |

License/provenance: study behavior only; do not copy incompatible code (Nix LGPL, etc.).

## A3 adoption / momentum snapshot (2026-08-14)

Observation time: **2026-08-14T23:41:11+08:00**.

Method:

- Total stars: unauthenticated GitHub REST `GET https://api.github.com/repos/{owner}/{repo}` with
  `Accept: application/vnd.github+json` (field `stargazers_count`, `html_url`, `full_name`).
- 30-day star delta: attempted `GET /repos/{owner}/{repo}/stargazers` with
  `Accept: application/vnd.github.star+json`. Every request returned **HTTP 401 Unauthorized** for
  unauthenticated public access. This matches GitHub's 2026-06-30 changelog restricting stargazer
  list endpoints to repository admins/collaborators after July 2026
  ([changelog](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/),
  [REST starring docs](https://docs.github.com/rest/activity/starring),
  [Star History restriction note](https://www.star-history.com/blog/github-stargazer-api-restriction)).
- No synthetic monthly growth was estimated. Exact 30-day deltas are recorded as **not verified**.

| System    | Exact GitHub repository                                             | Observed stars | 30-day star delta                                                                                                    | Primary source URL(s)                                                                                            |
| --------- | ------------------------------------------------------------------- | -------------: | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Bazel     | `bazelbuild/bazel`                                                  |         25,716 | not verified — stargazer list API returned 401 without admin/collaborator auth under post-2026-07 public restriction | https://github.com/bazelbuild/bazel ; https://api.github.com/repos/bazelbuild/bazel                              |
| Nx        | `nrwl/nx`                                                           |         29,217 | not verified — same stargazer API 401 limitation                                                                     | https://github.com/nrwl/nx ; https://api.github.com/repos/nrwl/nx                                                |
| Nix       | `NixOS/nix`                                                         |         17,506 | not verified — same stargazer API 401 limitation                                                                     | https://github.com/NixOS/nix ; https://api.github.com/repos/NixOS/nix                                            |
| Dagster   | `dagster-io/dagster`                                                |         15,994 | not verified — same stargazer API 401 limitation                                                                     | https://github.com/dagster-io/dagster ; https://api.github.com/repos/dagster-io/dagster                          |
| Pants     | `pantsbuild/pants`                                                  |          3,815 | not verified — same stargazer API 401 limitation                                                                     | https://github.com/pantsbuild/pants ; https://api.github.com/repos/pantsbuild/pants                              |
| dbt Core  | `dbt-labs/dbt-core`                                                 |         13,642 | not verified — same stargazer API 401 limitation                                                                     | https://github.com/dbt-labs/dbt-core ; https://api.github.com/repos/dbt-labs/dbt-core                            |
| DVC       | cited as `iterative/dvc`; API resolves to canonical `treeverse/dvc` |         15,817 | not verified — same stargazer API 401 limitation                                                                     | https://github.com/iterative/dvc → https://github.com/treeverse/dvc ; https://api.github.com/repos/iterative/dvc |
| Turborepo | `vercel/turborepo`                                                  |         30,892 | not verified — same stargazer API 401 limitation                                                                     | https://github.com/vercel/turborepo ; https://api.github.com/repos/vercel/turborepo                              |

Adoption reading: all eight systems remain large, actively pushed open-source projects on the observation
date. Star totals support that the prior mechanism survey sampled widely adopted tools; they do not
authorize importing code or change the settled T05C acceptance shape below.

## What each system proves (acceptance-relevant)

| Concern                   | Borrowed pattern                                         | Rejected pattern                                                |
| ------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Affected-set completeness | Skyframe/Nx reverse dependents from the replaced root    | Turbo/Nx “unknown ⇒ all affected”                               |
| Multi-cause / multi-path  | Nix `--all` + Dagster multi-cause retention              | Binary affected-set collapse (Nx default product surface)       |
| Deterministic output      | Dagster sorted causes; fixed path ordinals (T04/T05A)    | Hash-map / parallel visitation order as product identity        |
| Restart / crash safety    | Skyframe atomic operation identity (T04 same-txn write)  | Chunked resume / partial ledger commits in the golden path      |
| Golden reproducibility    | dbt explicit comparison operand; fixed IDs + fixed clock | Wall-clock IDs, temp paths, or deriving oracle from live ledger |

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
