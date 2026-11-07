import { useState } from "react";
import "./StoryCreationFailurePolicyView.css";
export type StoryCreationPolicyState =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
  | { kind: "ready"; limit: number | null; message?: string };
/** Only server-reported policy is shown as saved. No draft becomes a local allowance. */
export function StoryCreationFailurePolicyView({
  state,
  busy,
  onSave,
  onRefresh,
  onClose,
  canRefresh = true,
}: {
  state: StoryCreationPolicyState;
  busy: boolean;
  onSave: (limit: number) => void;
  onRefresh: () => void;
  onClose: () => void;
  canRefresh?: boolean;
}) {
  const [draft, setDraft] = useState(""),
    [invalid, setInvalid] = useState(false);
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
        className="dialog story-creation-failure-policy"
        role="dialog"
        aria-modal="true"
        aria-label="创作流程失败保护"
        aria-busy={busy}
      >
        <h2>创作流程失败保护</h2>
        <p>
          为本集设置同一实际创作输入下，Grok
          成片创作流程的失败及结果未确认次数上限，覆盖该流程中的图片、配音和视频步骤。
        </p>
        <p className="role-desc">
          未配置时不能新增提交；设为0会阻止这条流程新增提交，不影响读取已有缓存或查询原任务。随机重做中间首帧不会重置这项保护。
        </p>
        <p className="role-desc">
          单独补做定妆照、单独配音等独立操作不在本项范围内。视频提交失败上限仍单独检查，两项设置不会互相代替。
        </p>
        <p className="role-desc">
          结果未确认不等于已经失败。修改上限不会清除已有的失败或未确认记录；找回一条视频或人工接受试片也不代表整条流程已经成功。
        </p>
        <p className="role-desc">
          此设置不是费用额度，不代替会员能力、生成数量或费用确认。这里不提供已用次数或剩余次数。
        </p>
        {state.kind === "loading" ? <p role="status">正在读取创作流程上限…</p> : null}
        {state.kind === "unsupported" ? (
          <p role="status">当前环境不支持设置创作流程失败保护，请使用支持此功能的桌面版。</p>
        ) : null}
        {state.kind === "error" ? <p role="alert">{state.message}</p> : null}
        {state.kind === "ready" ? (
          <>
            <p role="status">
              {state.limit === null
                ? "尚未配置创作流程上限。"
                : `已保存的创作流程上限：${state.limit} 次。`}
            </p>
            {state.message ? <p role="status">{state.message}</p> : null}
            <label>
              新的创作流程上限（整数 0–1000）
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
            <p className="role-desc">没有默认值。1000是可设置的技术上限，不是建议值或费用承诺。</p>
            {invalid ? <p role="alert">请输入0到1000的整数。</p> : null}
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
            重新核对创作流程上限
          </button>
          {state.kind === "ready" ? (
            <button className="btn primary" type="button" disabled={busy} onClick={submit}>
              {busy ? "正在保存…" : "保存创作流程上限"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
