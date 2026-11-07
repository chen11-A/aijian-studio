import "./DialogueSplitDialog.css";
export type DialogueSplitReviewView = {
  sourceLines: readonly { speaker: string; text: string }[];
  parts: readonly { speaker: string; text: string; estimatedSeconds: number }[];
  versions: number;
  videoCount: number;
  modelCapSeconds: number;
  limitations: readonly string[];
  notes: readonly string[];
  actualLimit?: {
    requiredSeconds: number;
    maxSeconds: number;
    rawAudioSaved: boolean;
    targetVideoSubmitted: false;
  };
};
export function DialogueSplitDialog({
  review,
  busy,
  applying,
  stale,
  accepted,
  message,
  onAccepted,
  onRefresh,
  onApply,
  onClose,
}: {
  review: DialogueSplitReviewView | null;
  busy: boolean;
  applying: boolean;
  stale: boolean;
  accepted: boolean;
  message: string;
  onAccepted: (value: boolean) => void;
  onRefresh: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-back">
      <section
        className="dialog dialogue-split-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialogue-split-title"
        aria-busy={busy || applying}
      >
        <h2 id="dialogue-split-title">按完整句拆镜</h2>
        <p>
          先核对本机给出的完整台词与新镜头。查看不会生成声音或视频；接受只改分镜结构，之后生成仍需重新确认。
        </p>
        <p role="status" aria-live="polite">
          {applying
            ? "正在保留原版并核对拆镜结果，请等待保存回执…"
            : busy
              ? "正在保存当前编辑并检查拆镜方案…"
              : message}
        </p>
        {review && (
          <>
            {review.actualLimit && (
              <p>
                本次目标的实际配音需要 {review.actualLimit.requiredSeconds} 秒，视频上限为{" "}
                {review.actualLimit.maxSeconds} 秒。
                {review.actualLimit.rawAudioSaved ? "原配音已保留。" : "原配音保存状态仍需核对。"}
                本次目标尚未提交视频；这不代表其他镜头的生成状态。
              </p>
            )}
            <p>
              原镜拆成 {review.parts.length} 镜，每镜 {review.versions} 版，预计新增{" "}
              {review.videoCount} 个视频；不含配音、图片或失败重试。本次不会发起这些生成。
            </p>
            <p>
              每段时长是文字估算，当前视频上限 {review.modelCapSeconds} 秒；仍需实际配音后再核对。
            </p>
            <section aria-label="原镜完整台词">
              <h3>原镜完整台词</h3>
              {review.sourceLines.map((line, i) => (
                <p key={i} className="dialogue-split-line">
                  {line.speaker ? `${line.speaker}：` : ""}
                  {line.text}
                </p>
              ))}
            </section>
            <section aria-label="完整句拆镜方案">
              {review.parts.map((part, i) => (
                <article key={i}>
                  <h3>
                    新镜头 {i + 1} · 约 {part.estimatedSeconds} 秒
                  </h3>
                  <p className="dialogue-split-line">
                    {part.speaker ? `${part.speaker}：` : ""}
                    {part.text}
                  </p>
                </article>
              ))}
            </section>
            <section aria-label="拆镜前需核对">
              <h3>拆镜前需核对</h3>
              <ul>
                {[...review.notes, ...review.limitations].map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </section>
            <label className="dialogue-split-accept">
              <input
                type="checkbox"
                checked={accepted}
                disabled={busy || applying || stale}
                onChange={(event) => onAccepted(event.target.checked)}
              />
              我已核对完整台词、旧素材去向与新增视频数量
            </label>
          </>
        )}
        {stale && <p role="alert">内容、版本或生成数量已变化，请重新检查；旧方案不会应用。</p>}
        <div className="dialogue-split-actions">
          <button className="btn" onClick={onClose} disabled={applying}>
            关闭
          </button>
          <button className="btn" onClick={onRefresh} disabled={busy || applying}>
            重新检查
          </button>
          <button
            className="btn primary"
            disabled={!review || !accepted || busy || applying || stale}
            onClick={onApply}
          >
            接受这份拆镜结构
          </button>
        </div>
      </section>
    </div>
  );
}
