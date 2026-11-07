import { useState } from "react";
import "./GenerationFailurePolicyView.css";

export type FailurePolicyViewState =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
  | { kind: "ready"; limit: number | null; message?: string };

/** Presentation only: the owner supplies server state and performs the revision-checked write. */
export function GenerationFailurePolicyView({
  state,
  busy,
  onSave,
  onRefresh,
  onClose,
  canRefresh = true,
}: {
  state: FailurePolicyViewState;
  busy: boolean;
  onSave: (limit: number) => void;
  onRefresh: () => void;
  onClose: () => void;
  canRefresh?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  function submit() {
    if (busy || state.kind !== "ready") return;
    const value = draft.trim();
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 1000) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSave(Number(value));
  }
  return (
    <div className="dialog-back">
      <section
        className="dialog generation-failure-policy"
        role="dialog"
        aria-modal="true"
        aria-label="视频提交失败保护"
        aria-busy={busy}
      >
        <h2>视频提交失败保护</h2>
        <p>
          为本集设置同一输入的 Grok 视频提交失败及未决次数上限。未配置时不能提交新的视频，设为 0
          会阻止新的视频提交。
        </p>
        <p className="role-desc">
          未决表示提交结果尚未确认，不等于已经失败。此设置不统计图片、配音或整条创作流程，也不代替会员和费用确认。这里不提供已用次数或剩余额度。
        </p>
        {state.kind === "loading" ? <p role="status">正在读取已保存的上限…</p> : null}
        {state.kind === "unsupported" ? (
          <p role="status">当前环境不支持设置视频提交失败保护，请使用支持此功能的桌面版。</p>
        ) : null}
        {state.kind === "error" ? <p role="alert">{state.message}</p> : null}
        {state.kind === "ready" ? (
          <>
            <p role="status">
              {state.limit === null ? "尚未配置上限。" : `已保存的上限：${state.limit} 次。`}
            </p>
            {state.message ? <p role="status">{state.message}</p> : null}
            <label>
              新的上限（整数 0–1000）
              <input
                className="input"
                type="text"
                inputMode="numeric"
                value={draft}
                disabled={busy}
                aria-invalid={invalid}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setInvalid(false);
                }}
              />
            </label>
            <p className="role-desc">没有默认值。1000 是可设置的技术上限，不是建议值或费用承诺。</p>
            {invalid ? <p role="alert">请输入 0 到 1000 的整数。</p> : null}
          </>
        ) : null}
        <div className="acts">
          <button className="btn" type="button" onClick={onClose}>
            关闭
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || !canRefresh || state.kind === "unsupported"}
            onClick={onRefresh}
          >
            重新核对
          </button>
          {state.kind === "ready" ? (
            <button className="btn primary" type="button" disabled={busy} onClick={submit}>
              {busy ? "正在保存…" : "保存上限"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
