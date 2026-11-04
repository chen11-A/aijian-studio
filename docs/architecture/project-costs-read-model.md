# Costs page: existing project task read model

Reuse the model's existing project-scoped `useTaskQueue` and `listProjectTasks`
bridge. The Costs page shows all tasks from that response, independent of the
assistant's display filter. No new ledger, monetary store, migration, provider
operation or grant is introduced. Scope mismatches and expired replies never
display another project's tasks; refresh is read-only.

The current `TaskCostData` status is only `NOT_RECORDED`. Null reserve/accrued/
billed/currency/budget fields are unknown; neither an empty queue, a local task,
cancellation nor success establishes a zero charge. No cross-currency totals or
invented CNY conversion are calculated. This task list is explicitly incomplete
as a financial ledger: official account operations and Sub2API/upstream settlement
may not appear here. Remote-call accounting already exists for exact tracked
source-extraction operations, but the general queue does not yet expose that
settlement contract. The UI must disclose this, not duplicate or infer it.

Budget remains an identified mandatory gap. Before enabling budget writes, define
scope and currency, atomic reserve/consume/settle transitions, unknown-charge
handling, exact authorization binding and enforcement at every dispatch. A UI
saved amount without that enforcement is not a usable spending ceiling. These
contracts await the user's design choice; they do not authorize any real call.

Targeted tests cover real rendering from the existing typed queue, empty/error/
unconfigured states, project mismatch, A→B→A and late readback, unknown cost after
success/cancellation, read-only refresh, native route and unchanged fixture UI.
Windows and actual provider billing validation remain separate.
