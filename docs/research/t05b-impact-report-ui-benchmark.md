# T05B Impact Report UI — OSS Benchmark

Status: decision note for bounded T05B (project-scoped historical impact report workspace).
Observation clock: GitHub REST `GET /repos/{owner}/{repo}` at **2026-08-14** (same day as this worktree).
Workspace: `codex/f05-impact-report-ui` @ starting HEAD `0fc0cd6`.

## Evidence rules

- Star totals from public GitHub repository metadata API.
- **30-day / monthly star growth: not verifiable.** GitHub restricted public stargazer timelines on 2026-06-30 ([changelog](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/), prior Aijian note in [`oss-baseline-2026-08-14.md`](oss-baseline-2026-08-14.md)). This document does not invent growth.
- Borrow/reject choices must keep T05A event-time evidence distinct from T03 live consumability.

## Reference matrix

| Reference | Official repo | Official UI / docs | Stars (2026-08-14) | Monthly growth |
| --- | --- | --- | ---: | --- |
| Dagster asset lineage / materialization history | [dagster-io/dagster](https://github.com/dagster-io/dagster) | [Assets & metadata](https://docs.dagster.io/guides/build/assets/metadata-and-tags); [webserver](https://docs.dagster.io/guides/operate/webserver) | 15,994 | not verifiable |
| Nx affected / project graph | [nrwl/nx](https://github.com/nrwl/nx) | [Explore graph](https://nx.dev/docs/features/explore-graph); [Affected](https://nx.dev/docs/features/ci-features/affected) | 29,218 | not verifiable |
| Temporal event history | [temporalio/temporal](https://github.com/temporalio/temporal) · UI [temporalio/ui](https://github.com/temporalio/ui) | [Web UI](https://docs.temporal.io/web-ui); [Event history](https://docs.temporal.io/workflow-execution/event) | 22,308 / 426 | not verifiable |
| Sentry issue / event details | [getsentry/sentry](https://github.com/getsentry/sentry) | [Issue details frontend](https://github.com/getsentry/sentry/tree/master/static/app/views/issueDetails); [self-hosted](https://develop.sentry.dev/self-hosted) | 44,541 | not verifiable |
| Airflow grid / DAG history (extra) | [apache/airflow](https://github.com/apache/airflow) | [UI / Grid view docs](https://airflow.apache.org/docs/apache-airflow/stable/ui.html) | 46,482 | not verifiable |

## Patterns worth borrowing

### Dagster

- **List → detail:** asset catalog / activity list with a selected event’s frozen metadata.
- **Multi-cause presentation:** retain independent causes; sort deterministically for stable UI (T05A already freezes path ordinals and group keys).
- **Empty / fresh framing:** zero causes is a valid “no impact” outcome, not an error.

**Reject:** re-materialize / launch actions from the history view; treating lineage graph freshness as current live status; making a global canvas the primary surface.

### Nx

- **Project-scoped affected set:** show what one change touched inside one workspace/project.
- **Reverse-dependency mental model:** “what depends on this” as an ordered report, not a free-form exploration toy.

**Reject:** binary affected / not-affected collapse; interactive project-graph spectacle as the default UI; recomputing live graph state inside the report screen (T03 remains live authority).

### Temporal

- **Event history as frozen timeline:** chronological operation list; selecting one event loads that event’s payload.
- **Full identity in detail:** workflow/run/event IDs remain inspectable; short labels never replace canonical identity.
- **History ≠ current execution state:** the selected event is evidence of what happened then.

**Reject:** reset / retry / terminate style actions; conflating history detail with live workflow status badges that imply repairability.

### Sentry

- **Severity with text + icon, not color alone:** level labels remain readable without hue.
- **Event snapshot framing:** one selected event is a frozen capture; breadcrumbs / stack frames stay ordered and distinct.
- **Recoverable error / empty states:** explicit retry and “no events yet” copy.

**Reject:** resolve / assign / mute actions that mutate operational state; secret-shaped extra fields leaking into the renderer; treating issue “current status” as the event payload.

### Airflow (secondary)

- **Historical run grid/list:** temporal framing of past DAG runs and task instances.

**Reject:** clear / retry task actions; using the historical grid as if it were the live DAG editor.

## Aijian T05B decisions driven by this research

| Decision | Source | Implementation consequence |
| --- | --- | --- |
| Operation list + selected detail | Temporal, Dagster, Sentry | Left list of operations; right detail for one `operation_id` |
| Newest default selection from deterministic API order | Temporal event list + T05A ASC order | API is oldest→newest; UI selects the **last** list item by default |
| Keep every independent path / version group | Dagster multi-cause, Nx reverse deps, T05A | Do not merge versions of one artifact; render path ordinals and full dep chains |
| Severity as text + semantic marker | Sentry | Labels `阻断` / `仅渲染` / `提示` with icons; color is secondary |
| Event-time banner | Temporal history ≠ status | Prominent notice: frozen replacement evidence, not live consumability |
| No repair console | all rejects above | No retry, regenerate, waiver, enqueue, or T03 reassessment controls |
| No graph library | Nx/Dagster graph spectacle reject | Cards/sections only; no canvas dependency |
| Strict trust boundary | Sentry secret-field caution | Desktop client validates IDs, ownership, enums, counts, nested path shape, exact keys |

## Explicit non-goals (defer)

- T05C / C04 repair or rebase flows.
- Pagination, filters, live T03 badges, ledger writes, backend changes.
- Graph visualization libraries or marketing hero chrome.
