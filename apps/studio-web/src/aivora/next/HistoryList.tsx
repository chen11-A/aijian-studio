import { useState } from "react";
import "./next.css";
import "./HistoryList.css";

/** One kept version of the work. Every field is already in words. */
export type HistoryEntry = {
  id: string;
  /** When it was kept, for example 「今天 14:32」. */
  when: string;
  /** Why it was kept, for example 「批量生成前自动存的」. */
  why: string;
  /** What it had, for example 「3 场 · 28 个镜头 · 12 个做好了」. */
  summary?: string;
};

export type HistoryListProps = {
  /** null when this version of the app keeps no history at all. */
  entries: readonly HistoryEntry[] | null;
  loading?: boolean;
  error?: string | null;
  /** The entry being restored right now. */
  restoring?: string;
  onRestore: (id: string) => void;
};

/**
 * 4C-U02: the kept versions of the work, newest first, each with 「恢复到这里」. Restoring asks
 * once more, in place, and says what happens to the work as it is now. Without a history it
 * says so instead of showing an empty list.
 */
export function HistoryList({
  entries,
  loading = false,
  error,
  restoring,
  onRestore,
}: HistoryListProps) {
  const [asking, setAsking] = useState("");
  if (loading) {
    return (
      <section className="nx-root nx-history" aria-label="历史版本">
        <p className="nx-muted">正在读历史版本…</p>
      </section>
    );
  }
  if (error)
    return (
      <section className="nx-root nx-history" aria-label="历史版本">
        <p className="nx-muted" role="alert">
          {error}
        </p>
      </section>
    );
  if (entries === null) {
    return (
      <section className="nx-root nx-history" aria-label="历史版本">
        <p className="nx-muted">这个版本的软件还不能看历史版本。改错了可以先用顶栏的撤销。</p>
      </section>
    );
  }
  if (entries.length === 0) {
    return (
      <section className="nx-root nx-history" aria-label="历史版本">
        <p className="nx-muted">还没有存过的版本。每次批量生成之前会自动存一份。</p>
      </section>
    );
  }
  return (
    <section className="nx-root nx-history" aria-label="历史版本">
      <ol className="nx-history-list">
        {entries.map((entry) => {
          const busy = restoring === entry.id;
          return (
            <li key={entry.id} className="nx-history-row">
              <div className="nx-history-text">
                <strong>{entry.when}</strong>
                <span className="nx-muted">{entry.why}</span>
                {entry.summary ? <span className="nx-faint">{entry.summary}</span> : null}
              </div>
              {asking === entry.id ? (
                <div className="nx-history-confirm" role="group" aria-label="确认恢复">
                  <p>
                    恢复到「{entry.when}
                    」？作品会回到那时的样子；现在的样子会另存一份，想回来还能恢复。
                  </p>
                  <div className="nx-row">
                    <button
                      type="button"
                      className="nx-btn nx-sm nx-primary"
                      disabled={Boolean(restoring)}
                      onClick={() => {
                        setAsking("");
                        onRestore(entry.id);
                      }}
                    >
                      恢复
                    </button>
                    <button type="button" className="nx-btn nx-sm" onClick={() => setAsking("")}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="nx-btn nx-sm"
                  disabled={Boolean(restoring)}
                  onClick={() => setAsking(entry.id)}
                >
                  {busy ? "正在恢复" : "恢复到这里"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
