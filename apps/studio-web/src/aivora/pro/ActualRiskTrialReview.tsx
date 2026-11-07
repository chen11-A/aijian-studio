import { useEffect, useState } from "react";
import type { FilmRiskTrialDecision, FilmRiskTrialReady } from "@aijian/contracts/film-risk-trial";
import "./ActualRiskTrialReview.css";
export type ActualTrialRecord = { value: FilmRiskTrialDecision; verified: boolean };
export type ActualTrialViewState =
  | { kind: "preparing" }
  | { kind: "loading-media" }
  | { kind: "unsupported" }
  | { kind: "failed"; message: string }
  | {
      kind: "ready";
      ready: FilmRiskTrialReady;
      mediaSrc: string | null;
      mediaFailed: boolean;
      message?: string;
      recorded?: ActualTrialRecord;
    };
/** Human input only; playback, main checks and saved notes never choose a decision for the user. */
export function ActualRiskTrialReview({
  state,
  busy,
  stale,
  pending,
  canContinue = false,
  onClose,
  onRefresh,
  onRecord,
  onMediaError,
  onCheckPending,
  onContinue,
}: {
  state: ActualTrialViewState;
  busy: boolean;
  stale: boolean;
  pending: boolean;
  canContinue?: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onRecord: (decision: "accepted" | "needs-changes", note: string) => void;
  onMediaError: () => void;
  onCheckPending?: () => void;
  onContinue?: (decisionId: string) => void;
}) {
  const [decision, setDecision] = useState<"accepted" | "needs-changes" | null>(null),
    [note, setNote] = useState(""),
    [humanChecked, setHumanChecked] = useState(false);
  const reviewId = state.kind === "ready" ? state.ready.reviewId : null;
  useEffect(() => {
    setDecision(null);
    setHumanChecked(false);
  }, [reviewId]);
  const editable = state.kind === "ready" && !busy && !stale && !pending;
  const canRecord =
    editable &&
    !!state.mediaSrc &&
    !state.mediaFailed &&
    !!decision &&
    note.length <= 500 &&
    (decision !== "accepted" || humanChecked);
  const recorded = state.kind === "ready" ? state.recorded : undefined;
  return (
    <div className="dialog-back">
      <section
        className="dialog actual-risk-trial"
        role="dialog"
        aria-modal="true"
        aria-label="实际版本试片审核"
        aria-busy={busy}
      >
        <h2>实际版本试片审核</h2>
        <p>这里只核对所选版本的实际画面素材。后期配音、字幕与整片混音不由这次播放证明。</p>
        <p className="role-desc">
          播放事件不能证明已经完整观看或试听。接受或需修改是你的人工记录，不是技术验收、批量生成许可或费用确认。
        </p>
        {state.kind === "preparing" ? (
          <p role="status">正在核对所选版本的实际素材…</p>
        ) : state.kind === "loading-media" ? (
          <p role="status">正在读取本次核对的素材…</p>
        ) : state.kind === "unsupported" ? (
          <p role="status">当前环境不支持实际版本试片审核，请使用支持此功能的桌面版。</p>
        ) : state.kind === "failed" ? (
          <p role="alert">{state.message}</p>
        ) : (
          <>
            <h3>
              {state.ready.label} · {state.ready.versionLabel}
            </h3>
            <p>
              实际素材时长：
              {Number.isFinite(state.ready.durationSeconds) && state.ready.durationSeconds > 0
                ? `${state.ready.durationSeconds} 秒`
                : "尚未核实"}
            </p>
            <p className="role-desc">
              本次记录绑定的制作范围含 {state.ready.batchShotCount}{" "}
              镜；这不是新增视频数量或报价。继续仍须原数量、费用与输入确认。
            </p>
            {state.mediaSrc ? (
              <video
                className="actual-trial-video"
                controls
                preload="metadata"
                src={state.mediaSrc}
                onError={onMediaError}
              />
            ) : (
              <p role="status">实际素材尚未载入，暂时不能记录决定。</p>
            )}
            {state.mediaFailed ? (
              <p role="alert">此环境没有成功播放素材，不能据此记录已接受。请重新读取后核对。</p>
            ) : null}
            <section aria-label="本次试片未验证项">
              <h3>仍需核对</h3>
              <ul>
                {state.ready.limitations.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </section>
            {state.ready.existingDecision ? (
              <details>
                <summary>此前的人工记录</summary>
                <p>
                  {state.ready.existingDecision.decision === "accepted"
                    ? "此前记录为接受。"
                    : "此前记录为需要修改。"}
                  本次没有替你选择决定。
                </p>
                <p>{state.ready.existingDecision.note || "没有附加说明。"}</p>
                <p>记录时间：{state.ready.existingDecision.recordedAt}</p>
              </details>
            ) : null}
            {recorded ? (
              <section aria-label="已保存的试片人工记录">
                <p role="status">
                  人工决定已记录：{recorded.value.decision === "accepted" ? "接受" : "需修改"}。
                </p>
                <p>{recorded.value.note || "没有附加说明。"}</p>
                {!recorded.verified ? (
                  <p role="alert">人工记录已保存，试片仍需重新核对，暂时不能据此继续。</p>
                ) : null}
              </section>
            ) : null}
            {state.message ? <p role="status">{state.message}</p> : null}
            <fieldset disabled={!editable}>
              <legend>本次人工决定（未默认选择）</legend>
              <label>
                <input
                  type="radio"
                  name="actual-trial-decision"
                  checked={decision === "accepted"}
                  onChange={() => setDecision("accepted")}
                />
                接受这个实际版本
              </label>
              <label>
                <input
                  type="radio"
                  name="actual-trial-decision"
                  checked={decision === "needs-changes"}
                  onChange={() => setDecision("needs-changes")}
                />
                这个实际版本需要修改
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={humanChecked}
                  onChange={(event) => setHumanChecked(event.target.checked)}
                />
                我已人工核对本次素材，接受决定由我作出
              </label>
            </fieldset>
            <label className="trial-note">
              说明（原样保存）
              <textarea
                className="area"
                rows={4}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <p className="role-desc">
              说明长度：{note.length} / 500。部分符号会占两个位置，内容不会自动截断。
            </p>
            {note.length > 500 ? <p role="alert">说明过长，请缩短后再记录；原文已保留。</p> : null}
          </>
        )}
        {stale ? <p role="alert">创作输入、选版或当前会话已变化，本次试片需重新核对。</p> : null}
        {pending ? <p role="alert">人工决定的保存结果尚未确认，不会自动重复记录。</p> : null}
        <div className="acts">
          <button className="btn" type="button" onClick={onClose}>
            关闭
          </button>
          <button
            className="btn"
            type="button"
            onClick={onRefresh}
            disabled={busy || pending || state.kind === "unsupported"}
          >
            重新核对实际素材
          </button>
          {pending && onCheckPending ? (
            <button className="btn" type="button" disabled={busy} onClick={onCheckPending}>
              核对试片保存结果
            </button>
          ) : null}
          {state.kind === "ready" ? (
            <button
              className="btn primary"
              type="button"
              disabled={!canRecord}
              onClick={() => {
                if (canRecord && decision) onRecord(decision, note);
              }}
            >
              保存本次人工决定
            </button>
          ) : null}
          {canContinue &&
          recorded?.verified &&
          recorded.value.decision === "accepted" &&
          onContinue ? (
            <button
              className="btn"
              type="button"
              disabled={busy || stale || pending}
              onClick={() => {
                if (!busy && !stale && !pending) onContinue(recorded.value.id);
              }}
            >
              核对决定后继续本批
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
