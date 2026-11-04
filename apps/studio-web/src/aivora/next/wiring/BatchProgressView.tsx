import type { BatchProgress } from "@aijian/contracts/task-progress";

/** Displays the backend batch counts without deriving progress from visible task rows. */
export function BatchProgressView({ batches }: { batches: readonly BatchProgress[] }) {
  return batches.length ? (
    <div aria-label="批量进度" aria-live="polite">
      {batches.map((batch) => (
        <output key={batch.batchId}>
          {batch.label} · {batch.done}/{batch.total}
          {batch.failed ? ` · 失败 ${batch.failed}` : ""}
        </output>
      ))}
    </div>
  ) : null;
}
