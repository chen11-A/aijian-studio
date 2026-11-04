import "./next.css";
import "./PipelineSteps.css";

/** One step of 一键成片, as GPT reports it (C12 PipelineStep). */
export type PipelineStepView = {
  id: string;
  label: string;
  status: "queued" | "running" | "done" | "failed";
  done: number;
  total: number;
};

/** Where 一键成片 stopped to be looked at: the storyboard is written, no video yet. */
export type PipelineCheckpoint = { shots: number; seconds: number; videos: number };

export type PipelineStepsProps = {
  /** Empty when GPT has not reported steps; the bar then shows only the checkpoint. */
  steps: readonly PipelineStepView[];
  checkpoint?: PipelineCheckpoint | null;
  /** 「继续生成」 at the checkpoint. */
  onContinue?: () => void;
  /** 「从这一步重来」 on a failed step. Left out until GPT can restart from a step. */
  onRetryFrom?: (stepId: string) => void;
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
};

function count(step: PipelineStepView): string {
  if (step.total <= 1) return "";
  return `${step.done}/${step.total}`;
}

/**
 * 4A-U01: the 一键成片 step bar, 编剧 ✓ → 美术 ✓ → 定妆照 12/28 → 导演 …. A failed step is red
 * with 「从这一步重来」. At the checkpoint it adds what will be made and one primary button,
 * 「继续生成」. Draws nothing when there is neither a step nor a checkpoint.
 */
export function PipelineSteps({ steps, checkpoint, onContinue, onRetryFrom }: PipelineStepsProps) {
  if (steps.length === 0 && !checkpoint) return null;
  return (
    <section className="nx-root nx-pipeline" aria-label="一键成片进度">
      {steps.length > 0 && (
        <ol className="nx-pipeline-steps">
          {steps.map((step, index) => {
            const name = STEP_NAMES[step.id] ?? step.label;
            const progress = count(step);
            return (
              <li key={step.id} className="nx-pipeline-step" data-status={step.status}>
                {index > 0 && (
                  <span className="nx-pipeline-arrow" aria-hidden="true">
                    →
                  </span>
                )}
                <span className="nx-pipeline-name">{name}</span>
                {step.status === "done" && (
                  <span className="nx-pipeline-mark" aria-label="做完了">
                    ✓
                  </span>
                )}
                {step.status === "running" && (
                  <span className="nx-pipeline-count">{progress || "正在做"}</span>
                )}
                {step.status === "failed" && (
                  <>
                    <span className="nx-pipeline-count">
                      没做完{progress ? ` ${progress}` : ""}
                    </span>
                    {onRetryFrom && (
                      <button
                        type="button"
                        className="nx-btn nx-pipeline-retry"
                        onClick={() => onRetryFrom(step.id)}
                      >
                        从这一步重来
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {checkpoint && (
        <div className="nx-pipeline-check">
          <span className="nx-pipeline-summary">
            停在分镜，等你看一遍：{checkpoint.shots} 个镜头 · 约 {checkpoint.seconds} 秒 · 将生成{" "}
            {checkpoint.videos} 段视频 · 用会员额度
          </span>
          {onContinue && (
            <button type="button" className="nx-btn nx-primary" onClick={onContinue}>
              继续生成
            </button>
          )}
        </div>
      )}
    </section>
  );
}
