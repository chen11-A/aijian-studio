import { useEffect, useMemo, useState } from "react";
import type { ShotPlanAdoption, ShotPlanGateway, ShotPlanShot } from "@aijian/contracts/shot-plan";
import { Button } from "./Common";
import { reorderHumanShotPlanShots, validHumanShotPlanContent } from "./adapters/humanShotPlan";
import { ShotPlanInputContext } from "./ShotPlanInputContext";
import { ShotPlanShotEditor } from "./ShotPlanShotEditor";
import { useHumanShotPlan } from "./useHumanShotPlan";
import "./episode-storyboard.css";
import "./shot-plan-proposals.css";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ShotPlanProposalReviewProps = {
  projectId: string;
  episodeId: string;
  gateway: ShotPlanGateway | null;
  scriptDirty: boolean;
  storyboardDirty: boolean;
  pendingOperations: boolean;
  onAdopted: (adoption: ShotPlanAdoption) => void | Promise<void>;
  onWorkStateChange?: (state: { dirty: boolean; pending: boolean; busy: boolean }) => void;
  storage?: StoragePort | null;
  initiallyOpen?: boolean;
  workspace?: boolean;
};

export function ShotPlanProposalReview(props: ShotPlanProposalReviewProps) {
  const storage = useMemo(() => {
    if (props.storage !== undefined) return props.storage;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, [props.storage]);
  const state = useHumanShotPlan({
    ...props,
    storage,
    guards: {
      scriptDirty: props.scriptDirty,
      storyboardDirty: props.storyboardDirty,
      pendingOperations: props.pendingOperations,
    },
  });
  const [expanded, setExpanded] = useState(props.initiallyOpen ?? false);
  const [count, setCount] = useState(7);
  const [selection, setSelection] = useState<string | null>(null);
  const pending = state.journal.kind !== "EMPTY";
  useEffect(() => {
    props.onWorkStateChange?.({ dirty: state.dirty, pending, busy: state.busy });
  }, [state.dirty, pending, state.busy, props.onWorkStateChange]);
  const shot =
    state.draft?.shots.find((item) => item.shot_id === selection) ?? state.draft?.shots[0];
  const index = shot && state.draft ? state.draft.shots.indexOf(shot) : -1;
  const historical = !!state.proposal?.adoption && !state.dirty;
  const editorLocked = state.locked || historical;
  const editorPreparation =
    historical &&
    state.draft &&
    (state.preparation?.authority.script.version_id !== state.draft.authority.script.version_id ||
      state.preparation?.authority.script.content_hash !==
        state.draft.authority.script.content_hash)
      ? null
      : state.preparation;
  const valid =
    state.draft &&
    validHumanShotPlanContent(
      state.draft,
      props.projectId,
      props.episodeId,
      historical ? undefined : (state.preparation ?? undefined),
    );
  const issues = state.proposal
    ? [...state.proposal.content.issues, ...state.proposal.capability_losses]
    : [];
  const blocking = issues.some((issue) => issue.severity === "BLOCKING");
  function update(patch: Partial<ShotPlanShot>) {
    if (shot && !historical)
      state.edit((content) => ({
        ...content,
        shots: content.shots.map((item) =>
          item.shot_id === shot.shot_id ? { ...item, ...patch } : item,
        ),
      }));
  }
  function template() {
    if (state.dirty && !window.confirm("重新建立人工模板会丢弃当前未保存的提案修改。继续吗？"))
      return;
    state.template(count);
  }
  function reload() {
    if (state.dirty && !window.confirm("重新读取会丢弃当前未保存的提案修改。继续吗？")) return;
    void state.reload();
  }
  function adopt() {
    if (!state.proposal || state.locked || state.dirty || blocking) return;
    if (
      !window.confirm(
        `将人工导演提案的 ${state.proposal.content.shots.length} 个镜头采纳到新的分镜版本？旧分镜版本会保留。`,
      )
    )
      return;
    void state.adopt();
  }
  const editor = (
    <section className="episode-storyboard" aria-label="人工导演提案审阅">
      <div className="storyboard-status">
        <p>依据已确认剧本建立可变镜头模板，逐镜人工编排、审阅后采纳。没有生成画面或声音。</p>
        <span>
          {state.busy
            ? "正在核对…"
            : state.dirty
              ? "有未保存提案修改"
              : state.proposal
                ? `人工提案 v${state.proposal.version_number}`
                : "尚无人工提案"}
        </span>
      </div>
      {state.notice && (
        <div className="storyboard-notice" role="status">
          {state.notice}
        </div>
      )}
      {state.externalBlocked && (
        <div className="storyboard-notice" role="status">
          请先保存剧本和分镜，并核对待处理的原提交，再保存或采纳提案。
        </div>
      )}
      {pending && (
        <div className="storyboard-recovery" role="status">
          <span>
            {state.journal.kind === "BLOCKED"
              ? "恢复记录不可读取，本次不会发送新请求。"
              : "有一笔原提交待核对，不会自动重发。"}
          </span>
          <Button
            disabled={state.busy || state.journal.kind !== "PENDING"}
            onClick={() => void state.recover()}
          >
            核对原提交（只读）
          </Button>
        </div>
      )}
      {state.proposal && (
        <details className="shot-plan-pin">
          <summary>已保存提案 v{state.proposal.version_number} 的原始凭据</summary>
          <p>原剧本确认 {state.proposal.content.authority.script.confirmation_id}</p>
          <p>
            原剧本 {state.proposal.content.authority.script.version_id} ·{" "}
            {state.proposal.content.authority.script.content_hash}
          </p>
          <p>
            原制作意图 {state.proposal.content.authority.production_brief.version_id} ·{" "}
            {state.proposal.content.authority.production_brief.content_hash}
          </p>
          <p>保存的视觉约束：{state.proposal.content.visual_constraints.join("；") || "未声明"}</p>
        </details>
      )}
      {state.preparation && (
        <details className="shot-plan-pin">
          <summary>新模板当前输入与确认凭据</summary>
          <ShotPlanInputContext preparation={state.preparation} draft={null} />
          <p>
            {state.preparation.authority.mode === "ORIGINAL" ? "原创" : "改编"} · 剧本确认{" "}
            {state.preparation.authority.script.confirmation_id}
          </p>
          <p>
            剧本 {state.preparation.authority.script.version_id} ·{" "}
            {state.preparation.authority.script.content_hash}
          </p>
          <p>
            制作意图 {state.preparation.authority.production_brief.version_id} ·{" "}
            {state.preparation.authority.production_brief.content_hash}
          </p>
        </details>
      )}
      <div className="shot-plan-toolbar">
        <label>
          模板镜头数
          <input
            type="number"
            min={1}
            max={1000}
            step={1}
            value={count}
            disabled={state.locked}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <Button disabled={state.locked || !state.preparation} onClick={template}>
          建立人工待编排模板
        </Button>
        <Button disabled={state.busy || pending} onClick={reload}>
          重新读取输入和提案
        </Button>
      </div>
      {state.draft && (state.preparation || historical) ? (
        <>
          <div className="storyboard-layout">
            <aside className="storyboard-shot-list">
              <header>
                <h3>提案镜头</h3>
                <span>
                  {state.draft.shots.length} 个 · {state.draft.timebase.frame_rate.num}/
                  {state.draft.timebase.frame_rate.den} fps
                </span>
              </header>
              <ol>
                {state.draft.shots.map((item) => (
                  <li key={item.shot_id}>
                    <button
                      type="button"
                      aria-pressed={item.shot_id === shot?.shot_id}
                      onClick={() => setSelection(item.shot_id)}
                    >
                      <span>{String(item.ordinal).padStart(2, "0")}</span>
                      <div>
                        <strong>{item.title}</strong>
                        <small>
                          {item.duration_frames} 帧 · {item.script_block_ids.length} 个剧本块
                        </small>
                      </div>
                    </button>
                  </li>
                ))}
              </ol>
            </aside>
            <div className="storyboard-detail-scroll">
              {shot && (
                <>
                  <div className="storyboard-editor-heading">
                    <h3>镜头审阅</h3>
                    <div>
                      <Button
                        disabled={editorLocked || index <= 0}
                        onClick={() =>
                          state.edit((content) => ({
                            ...content,
                            shots: reorderHumanShotPlanShots(content.shots, index, -1),
                          }))
                        }
                      >
                        上移
                      </Button>
                      <Button
                        disabled={editorLocked || index >= (state.draft?.shots.length ?? 0) - 1}
                        onClick={() =>
                          state.edit((content) => ({
                            ...content,
                            shots: reorderHumanShotPlanShots(content.shots, index, 1),
                          }))
                        }
                      >
                        下移
                      </Button>
                    </div>
                  </div>
                  <ShotPlanShotEditor
                    shot={shot}
                    preparation={editorPreparation}
                    disabled={editorLocked}
                    update={update}
                  />
                </>
              )}
            </div>
          </div>
          {!valid && (
            <p className="shot-plan-issues" role="status">
              请核对镜头字段、场景/块覆盖和整数帧切区。保存前不会发送无效提案。
            </p>
          )}
        </>
      ) : (
        <p role="status">
          {state.readState === "loading"
            ? "正在读取已确认的输入…"
            : state.preparation
              ? "已读取当前确认版本。选择镜头数，建立人工待编排模板。"
              : "先明确确认剧本，再建立人工镜头模板。"}
        </p>
      )}
      {issues.length > 0 && (
        <ul className="shot-plan-issues" aria-label="提案问题与能力损失">
          {issues.map((issue, i) => (
            <li key={`${issue.code}:${i}`}>
              {issue.severity === "BLOCKING" ? "阻断" : "提示"}：{issue.message}
            </li>
          ))}
        </ul>
      )}
      {historical && state.proposal?.adoption && (
        <p className="shot-plan-pin">
          已采纳到分镜 {state.proposal.adoption.storyboard_version_id}
          。此已采用版本只读保留。要开始新版本，请明确建立新的人工待编排模板。
        </p>
      )}
      <footer className="storyboard-save-footer">
        <Button
          primary
          disabled={state.locked || !state.draft || !valid || !state.dirty}
          onClick={() => void state.save()}
        >
          保存人工提案新版本
        </Button>
        <Button
          disabled={
            state.locked ||
            !state.proposal ||
            state.dirty ||
            !valid ||
            blocking ||
            !state.preparation ||
            !!state.proposal.adoption
          }
          onClick={adopt}
        >
          审阅并采纳到新分镜
        </Button>
      </footer>
    </section>
  );
  return props.workspace ? (
    <div className="shot-plan-proposal" role="region" aria-label="人工导演工作区">
      <p className="shot-plan-workspace-title">人工导演提案 · AI 生成尚未接通</p>
      {editor}
    </div>
  ) : (
    <details
      className="shot-plan-proposal"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>人工导演提案 · AI 生成尚未接通</summary>
      {editor}
    </details>
  );
}
