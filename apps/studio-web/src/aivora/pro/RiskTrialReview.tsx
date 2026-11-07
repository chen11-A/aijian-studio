import { useEffect, useRef, useState } from "react";
import type { TrialReview } from "./actions/risk-trial-review";
import "./RiskTrialReview.css";
export function RiskTrialReview({
  review,
  stale,
  onRefresh,
  onClose,
  onInspect,
}: {
  review: TrialReview;
  stale: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onInspect: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.focus();
  }, []);
  const candidate = review.candidates.find((c) => c.id === selected);
  return (
    <div className="dialog-back">
      <section
        className="dialog risk-trial-review"
        role="dialog"
        aria-label="试片候选审阅"
        aria-modal="true"
        ref={root}
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2>试片候选审阅</h2>
        <p>显示的是当前编辑记录，不代表已经保存或核验素材。</p>
        <p>
          只根据文字和记录列出导航候选，没有看过画面或听过声音。选中条目不会生成，也不代表已完成试片或批准批量生成。
        </p>
        <p>
          按分镜顺序列出，不是质量排序；未默认替你选择。下方只陈述显式选版字段的记录，不推断默认版本，也不证明文件存在或已经播放。
        </p>
        {stale && <p role="alert">作品、创作输入或选版记录已变化，请刷新候选后再查看。</p>}
        <div className="risk-trial-body">
          <fieldset>
            <legend>候选镜头（{review.candidates.length}）</legend>
            {!review.candidates.length && <p>当前没有可列出的候选镜头，请先核对剧本与分镜。</p>}
            {review.candidates.map((c) => (
              <label className="risk-trial-choice" key={c.id}>
                <input
                  type="radio"
                  name="risk-trial-candidate"
                  checked={selected === c.id}
                  onChange={() => setSelected(c.id)}
                />
                <span>
                  {c.label}
                  <small>{c.reasons.map((r) => r.text).join("\n")}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <section aria-label="候选详情" className="risk-trial-detail">
            {!candidate ? (
              <p>先选一个条目查看文字线索。这里不会选中生成范围。</p>
            ) : (
              <>
                <h3>{candidate.label}</h3>
                <p>显式选版记录：{candidate.version}</p>
                <h4>当前画面文字</h4>
                <p>{candidate.picture || "尚未填写"}</p>
                <h4>本镜对白记录</h4>
                {candidate.dialogue.length ? (
                  candidate.dialogue.map((line, i) => <p key={i}>{line}</p>)
                ) : (
                  <p>没有对白记录</p>
                )}
                {(candidate.sceneMissingLines.length > 0 || candidate.sceneMissingTail) && (
                  <details>
                    <summary>本场原文检测缺项（不是单镜结论）</summary>
                    {candidate.sceneMissingLines.map((line, i) => (
                      <p key={i}>待核台词：{line}</p>
                    ))}
                    {candidate.sceneMissingTail && <p>待核结尾：{candidate.sceneMissingTail}</p>}
                  </details>
                )}
                <p>
                  人物身份、画面、动作、口型、对白完整性和实际听感仍待播放核对；文字线索不证明素材质量。
                </p>
              </>
            )}
          </section>
        </div>
        {review.notices.length > 0 && (
          <details>
            <summary>当前作品的文字与记录提示</summary>
            {review.notices.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </details>
        )}
        <p>需要生成时，请回到分镜，仍需逐项检查原来的生成前确认表。</p>
        <div className="acts">
          <button
            type="button"
            className="btn"
            disabled={!candidate || stale}
            onClick={() => candidate && onInspect(candidate.id)}
          >
            在分镜查看
          </button>
          <button type="button" className="btn" onClick={onRefresh}>
            刷新候选
          </button>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
