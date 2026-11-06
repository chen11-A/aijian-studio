import { SuggestionFieldDiff } from "./SuggestionFieldDiff";
import "./SevenPartVideoReview.css";

export function SevenPartVideoReview({
  facts,
  changed,
  before,
  modelText,
  busy,
  stale,
  result,
  onConfirm,
  onDismiss,
}: {
  facts: {
    sections: readonly { label: string; text: string; undecided: boolean }[];
    issues: readonly string[];
    draft: { text: string };
  };
  changed: boolean;
  before: string | null;
  modelText: string;
  busy: boolean;
  stale: boolean;
  result: "saved" | "unsaved" | "rejected" | "undone" | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="nx-root nx-video-review" aria-label="七段视频说明" aria-busy={busy}>
      <h3>视频说明 · {changed ? "1 项" : "没有字段改动"}</h3>
      <p>
        按当前文字设定整理；没有观看画面或验证动作。确认只修改视频说明，不生成媒体，原版本保留。
      </p>
      <dl className="nx-video-facts">
        {facts.sections.map((section) => (
          <div key={section.label}>
            <dt>
              {section.label}
              {section.undecided ? " · 待决定" : ""}
            </dt>
            <dd>{section.text}</dd>
          </div>
        ))}
      </dl>
      <p>
        未填写和相互矛盾的设定仍需人工核对；请在属性中修改后重新整理。声音事实供独立配音与后期检查，不代表视频原生声音支持。
      </p>
      {facts.issues.length > 0 ? (
        <ul role="alert">
          {facts.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <SuggestionFieldDiff
        rows={
          changed
            ? [
                {
                  key: "video-text",
                  label: "视频说明",
                  kind: before === null ? "added" : "changed",
                  before,
                  after: facts.draft.text,
                },
              ]
            : []
        }
      />
      {changed && before === facts.draft.text ? (
        <p>文字内容相同，本次按当前事实与所选版本重新确认绑定。</p>
      ) : null}
      <details>
        <summary>本次完整提交文本</summary>
        <p className="nx-video-model">{modelText || "请先处理上方问题，尚未得到可提交文本。"}</p>
      </details>
      <p role="status" aria-live="polite">
        {!changed
          ? "当前说明与这些事实一致，无需再次应用。保存情况以页脚为准。"
          : result === "undone"
            ? "当前已撤销或替换这份说明，请重新整理。"
            : stale && (result === "saved" || result === "unsaved")
              ? "说明已应用，但当前事实或版本已变化；生成前请重新整理，并核对保存状态。"
              : result === "saved"
                ? "视频说明已确认并保存。此次确认没有生成媒体。"
                : result === "unsaved"
                  ? "视频说明已应用，但尚未保存。请重试保存。"
                  : result === "rejected" || stale
                    ? "事实、选版或页面已变化，本次未应用；请重新整理。"
                    : busy
                      ? "正在应用并保存视频说明…"
                      : "仅在本次事实和所选版本未变时使用；改变后需重新整理。"}
      </p>
      <div className="acts">
        <button className="btn" disabled={busy} onClick={onDismiss}>
          关闭说明
        </button>
        <button
          className="btn primary"
          disabled={!changed || busy || stale || facts.issues.length > 0 || result !== null}
          onClick={onConfirm}
        >
          确认视频说明
        </button>
      </div>
    </section>
  );
}
