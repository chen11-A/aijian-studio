import { useId, useState } from "react";
import { NOTICE_COPY } from "./wiring/noticeCopy";
import "./next.css";
import "./PipelineSteps.css";

/** Every state a step or a target of 一键成片 can be in (GPT 4a production pipeline). */
export type PipelineStatus =
  "queued" | "running" | "done" | "failed" | "blocked" | "needs-input" | "uncertain" | "accepted";

/** One thing a step makes, for example one portrait or one shot (pipelineView target). */
export type PipelineTargetView = {
  id: string;
  status: PipelineStatus;
  attempt?: number;
  code?: string;
  detail?: string;
  /** Only the first unfinished step's failed, blocked or uncertain targets can be retried. */
  retryable?: boolean;
  /** An uncertain target may already have used membership quota: confirm before a retry. */
  requiresOutcomeConfirmation?: boolean;
};

/** One step of 一键成片, as pipelineView reports it. */
export type PipelineStepView = {
  id: string;
  /** Never shown: the page names the steps itself. */
  label?: string;
  status: PipelineStatus;
  done: number;
  total: number;
  targets?: readonly PipelineTargetView[];
};

/** Where 一键成片 stopped to be looked at, before any video (pipelineView checkpoint). */
export type PipelineCheckpoint = {
  shotCount: number;
  seconds: number;
  /** An estimate of the requests, not a promise of how many videos come out. */
  estimatedRequests: number;
  coverage: readonly {
    sceneId: string;
    ok: boolean;
    missingLines: readonly string[];
    missingTail: string | null;
  }[];
  risks: readonly { code: string; text: string; severity: "block" | "manual" | "info" }[];
};

export type PipelineStepsProps = {
  steps: readonly PipelineStepView[];
  /** The state of the whole run, including 「checkpoint」 and 「cancelled」. */
  overall?: PipelineStatus | "checkpoint" | "cancelled";
  checkpoint?: PipelineCheckpoint | null;
  checkpointPhase?: "before-media" | "video";
  /** Something is being made right now; nothing else can start. */
  busy?: boolean;
  /** From pipelineView: only then is 「继续生成」 enabled. */
  canContinue?: boolean;
  onContinue?: () => void;
  /** From pipelineView: the person has to look at the pictures and say so in words. */
  canAcceptReview?: boolean;
  onAcceptReview?: (reason: string) => void;
  /** Retry one chosen target; the host turns it into GPT's exact retry key. */
  onRetryTarget?: (stepId: string, targetId: string, outcomeConfirmed: boolean) => void;
  onCancel?: () => void;
  /** Plain names for targets and scenes; without them the list counts 「第 N 项」. */
  targetName?: (stepId: string, targetId: string) => string;
  sceneName?: (sceneId: string) => string;
};

/** Plain names for the steps, so GPT's internal labels never reach the screen. */
const STEP_NAMES: Record<string, string> = {
  writer: "编剧",
  art: "美术",
  portraits: "定妆照",
  director: "导演",
  action: "动作",
  performance: "表演",
  prompter: "画面说明",
  stills: "出图",
  review: "审片",
  video: "视频",
  assembly: "合成成片",
};

/** What a step or target in each state says, next to its name. */
const STATE_WORDS: Record<PipelineStatus, string> = {
  queued: "",
  running: "正在做",
  done: "✓",
  accepted: "✓ 人工确认",
  failed: "没做完",
  blocked: "卡住了",
  "needs-input": "等你确认",
  uncertain: "结果不确定",
};

const PROBLEMS: readonly PipelineStatus[] = ["failed", "blocked", "uncertain", "needs-input"];

function count(step: PipelineStepView): string {
  return step.total > 1 ? `${step.done}/${step.total}` : "";
}

/** The reason under a target: GPT's code in the app's words, or its plain detail. */
function reasonOf(target: PipelineTargetView): string {
  const copy = target.code ? NOTICE_COPY[target.code] : "";
  if (copy) return copy;
  const detail = target.detail?.trim() ?? "";
  return /^[A-Z][A-Z0-9_]+$/.test(detail) ? "" : detail;
}

/**
 * 4A-U01: the 一键成片 bar, 编剧 ✓ → 美术 ✓ → 定妆照 12/28 → 导演 …. It reads GPT's pipeline
 * view as it is (see INTEGRATION.md) and keeps each decision a separate, explicit click:
 * retrying one chosen target, confirming an uncertain one first, writing a human review, and
 * 「继续生成」, which only works when the checkpoint allows it. Draws nothing without steps
 * or a checkpoint.
 */
export function PipelineSteps(props: PipelineStepsProps) {
  const { steps, checkpoint, overall } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [review, setReview] = useState("");
  if (steps.length === 0 && !checkpoint) return null;

  const nameOf = (stepId: string, targetId: string, index: number) =>
    props.targetName?.(stepId, targetId) ||
    (targetId === "all" ? "整部作品" : `第 ${index + 1} 项`);
  const problems = steps.flatMap((step) =>
    (step.targets ?? [])
      .map((target, index) => ({ step, target, index }))
      .filter(
        ({ target }) =>
          PROBLEMS.includes(target.status) &&
          !(step.id === "review" && target.id === "all" && target.status === "needs-input"),
      ),
  );
  const uncovered = checkpoint?.coverage.filter((scene) => !scene.ok) ?? [];
  const risks = checkpoint?.risks ?? [];
  const blocking = risks.some((risk) => risk.severity === "block");
  const things =
    problems.length + uncovered.length + risks.length + (props.canAcceptReview ? 1 : 0);
  const why = !checkpoint
    ? ""
    : uncovered.length > 0
      ? "先补上没拍到的结尾和台词，才能继续。"
      : blocking
        ? "先处理标红的问题，才能继续。"
        : props.canAcceptReview
          ? "先看一遍画面，写下审片结论，才能继续。"
          : props.busy
            ? "还有东西在做，做完才能继续。"
            : "";

  return (
    <section className="nx-root nx-pipeline" aria-label="一键成片进度">
      <div className="nx-pipeline-row">
        {steps.length > 0 && (
          <ol className="nx-pipeline-steps">
            {steps.map((step, index) => {
              const progress = count(step);
              const word = STATE_WORDS[step.status];
              return (
                <li key={step.id} className="nx-pipeline-step" data-status={step.status}>
                  {index > 0 && (
                    <span className="nx-pipeline-arrow" aria-hidden="true">
                      →
                    </span>
                  )}
                  <span className="nx-pipeline-name">{STEP_NAMES[step.id] ?? "其他步骤"}</span>
                  {word ? <span className="nx-pipeline-mark">{word}</span> : null}
                  {progress && step.status !== "done" && step.status !== "accepted" ? (
                    <span className="nx-pipeline-count">{progress}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        {overall === "cancelled" ? (
          <span className="nx-pipeline-summary">已取消，做好的都留着。</span>
        ) : null}
        {checkpoint ? (
          <span className="nx-pipeline-summary">
            {props.checkpointPhase === "before-media" ? "自动生成前确认" : "停在分镜"}：
            {checkpoint.shotCount} 个镜头 · 约 {Math.round(checkpoint.seconds)} 秒 ·{" "}
            {props.checkpointPhase === "before-media" ? "视频最多" : "约需"}{" "}
            {checkpoint.estimatedRequests} 次生成 · 用会员额度
          </span>
        ) : null}
        <span className="nx-pipeline-acts">
          {things > 0 ? (
            <button
              type="button"
              className="nx-btn nx-pipeline-more"
              aria-expanded={open}
              aria-controls={`${id}-list`}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "收起" : `要处理的 ${things} 件事`}
            </button>
          ) : null}
          {props.busy && props.onCancel ? (
            <button type="button" className="nx-btn" onClick={props.onCancel}>
              取消
            </button>
          ) : null}
          {checkpoint && props.onContinue ? (
            <button
              type="button"
              className="nx-btn nx-primary"
              disabled={!props.canContinue}
              title={props.canContinue ? undefined : why || "现在还不能继续"}
              onClick={props.onContinue}
            >
              继续生成
            </button>
          ) : null}
        </span>
      </div>
      {checkpoint && !props.canContinue && why ? <p className="nx-pipeline-why">{why}</p> : null}
      {open && things > 0 ? (
        <div className="nx-pipeline-list" id={`${id}-list`}>
          {props.canAcceptReview ? (
            <div className="nx-pipeline-review">
              <label htmlFor={`${id}-review`}>
                审片还不会自己看画面。请你看一遍每个镜头的画面，写一句结论：
              </label>
              <textarea
                id={`${id}-review`}
                rows={2}
                value={review}
                placeholder="比如：28 张都看过，人物和场景对得上，第 2 场第 6 个镜头要重出。"
                onChange={(event) => setReview(event.target.value)}
              />
              <button
                type="button"
                className="nx-btn"
                disabled={!review.trim() || !props.onAcceptReview}
                onClick={() => props.onAcceptReview?.(review.trim())}
              >
                记下审片结论
              </button>
            </div>
          ) : null}
          {uncovered.length > 0 ? (
            <ul className="nx-pipeline-issues">
              {uncovered.map((scene) => (
                <li key={scene.sceneId} data-tone="block">
                  {props.sceneName?.(scene.sceneId) || "有一场"}
                  {scene.missingTail
                    ? `结尾还没拍到：「${scene.missingTail}」`
                    : `还有 ${scene.missingLines.length} 句台词没拍到`}
                </li>
              ))}
            </ul>
          ) : null}
          {risks.length > 0 ? (
            <ul className="nx-pipeline-issues">
              {risks.map((risk) => (
                <li key={risk.code} data-tone={risk.severity}>
                  {risk.text || NOTICE_COPY[risk.code] || "有一处要注意"}
                </li>
              ))}
            </ul>
          ) : null}
          {problems.length > 0 ? (
            <ul className="nx-pipeline-issues">
              {problems.map(({ step, target, index }) => {
                const key = `${step.id}:${target.id}`;
                const sure = Boolean(confirmed[key]);
                const reason = reasonOf(target);
                return (
                  <li key={key} data-tone={target.status === "blocked" ? "block" : "manual"}>
                    <span className="nx-pipeline-target">
                      {STEP_NAMES[step.id] ?? "其他步骤"} · {nameOf(step.id, target.id, index)}：
                      {STATE_WORDS[target.status]}
                      {reason ? `。${reason}` : ""}
                    </span>
                    {target.requiresOutcomeConfirmation && target.retryable ? (
                      <label className="nx-pipeline-confirm">
                        <input
                          type="checkbox"
                          checked={sure}
                          onChange={(event) =>
                            setConfirmed((now) => ({ ...now, [key]: event.target.checked }))
                          }
                        />
                        我核对过，上次没有做成（重试会再用一次额度）
                      </label>
                    ) : null}
                    {target.retryable && props.onRetryTarget ? (
                      <button
                        type="button"
                        className="nx-btn"
                        disabled={Boolean(target.requiresOutcomeConfirmation) && !sure}
                        onClick={() => props.onRetryTarget?.(step.id, target.id, sure)}
                      >
                        重试这一项
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
