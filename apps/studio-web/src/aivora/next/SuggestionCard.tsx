import {
  suggestionCounts,
  suggestionDiff,
  type SuggestionItem,
  type SuggestionRow,
} from "./adapters/suggestionDiff";
import "./next.css";
import "./SuggestionCard.css";

export type SuggestionCardProps = {
  /** Shots go into the storyboard, scenes into the script. */
  unit: "shot" | "scene";
  /** What is there now. */
  current: readonly SuggestionItem[];
  /** What the assistant suggests instead. */
  proposed: readonly SuggestionItem[];
  /** GPT's own diff (4A-B11 ④) when it has one; otherwise it is worked out from the words. */
  rows?: readonly SuggestionRow[];
  /** Already put in: the card says so and offers 「撤销」 instead. */
  applied?: boolean;
  /** The assistant is writing another one. */
  busy?: boolean;
  onApply: () => void;
  /** 「换一个」: ask the same assistant for a different suggestion. */
  onAnother?: () => void;
  /** 「不要」: drop the suggestion; nothing changes. */
  onReject?: () => void;
  /** Takes the suggestion back out after it was put in. */
  onUndo?: () => void;
};

const MARK: Record<Exclude<SuggestionRow["kind"], "same">, string> = {
  added: "新增",
  changed: "改了",
  removed: "删掉",
};

function headline(unit: SuggestionCardProps["unit"], now: number, next: number): string {
  if (unit === "scene") return now > 0 ? `现在 ${now} 场 → 建议 ${next} 场` : `建议写成 ${next} 场`;
  return now > 0 ? `现在 ${now} 个 → 建议 ${next} 个` : `建议拆成 ${next} 个镜头`;
}

function summary(rows: readonly SuggestionRow[]): string {
  const counts = suggestionCounts(rows);
  const parts = [
    counts.added ? `新增 ${counts.added}` : "",
    counts.changed ? `改了 ${counts.changed}` : "",
    counts.removed ? `删掉 ${counts.removed}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "和现在一样";
}

/**
 * 4A-U11: the assistant's suggestion as a change to what is there now: 「现在 6 个 → 建议 4
 * 个」, each line marked 新增, 改了 or 删掉, and three plain choices: 放进分镜 (or 放进剧本), 换一个,
 * 不要. Nothing changes until 放进 is clicked; after that the card offers 撤销. Draws nothing
 * when there is no suggestion, so an empty card never shows.
 */
export function SuggestionCard(props: SuggestionCardProps) {
  const { unit, current, proposed, applied = false, busy = false } = props;
  if (proposed.length === 0 && !(props.rows && props.rows.length > 0)) return null;
  const rows = props.rows ?? suggestionDiff(current, proposed);
  const into = unit === "scene" ? "放进剧本" : "放进分镜";
  const noun = unit === "scene" ? "场" : "镜头";
  let number = 0;
  return (
    <section className="nx-root nx-suggest" aria-label="助手的建议">
      <header className="nx-suggest-head">
        <strong>{headline(unit, current.length, proposed.length)}</strong>
        {current.length > 0 ? <span className="nx-muted">{summary(rows)}</span> : null}
      </header>
      <ol className="nx-suggest-rows">
        {rows.map((row) => {
          const removed = row.kind === "removed";
          if (!removed) number += 1;
          const changed = row.kind === "changed" ? row.before : null;
          return (
            <li
              key={`${row.kind}:${row.item.id}`}
              className="nx-suggest-row"
              data-kind={row.kind}
              title={changed ? `原来：${changed.text}` : undefined}
            >
              <span className="nx-suggest-no">{removed ? "" : number}</span>
              <span className="nx-suggest-body">
                <span className="nx-suggest-line">
                  {row.item.who ? <span className="nx-suggest-who">{row.item.who}</span> : null}
                  {removed ? (
                    <del className="nx-one-line">{row.item.text}</del>
                  ) : (
                    <span className="nx-one-line">{row.item.text}</span>
                  )}
                </span>
                {changed ? (
                  <span className="nx-suggest-before nx-one-line">原来：{changed.text}</span>
                ) : null}
              </span>
              {row.item.tail ? <span className="nx-suggest-tail">{row.item.tail}</span> : null}
              {row.kind !== "same" && current.length > 0 ? (
                <span className="nx-tag nx-suggest-mark">{MARK[row.kind]}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="nx-suggest-acts">
        {applied ? (
          <>
            <span className="nx-muted">已放进去。</span>
            {props.onUndo ? (
              <button type="button" className="nx-btn nx-sm" onClick={props.onUndo}>
                撤销
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              className="nx-btn nx-sm nx-suggest-apply"
              disabled={busy}
              onClick={props.onApply}
            >
              {into}
            </button>
            {props.onAnother ? (
              <button
                type="button"
                className="nx-btn nx-sm"
                disabled={busy}
                title={`请助手换一种分法，现在的${noun}不会变`}
                onClick={props.onAnother}
              >
                {busy ? "正在换" : "换一个"}
              </button>
            ) : null}
            {props.onReject ? (
              <button type="button" className="nx-btn nx-sm nx-ghost" onClick={props.onReject}>
                不要
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
