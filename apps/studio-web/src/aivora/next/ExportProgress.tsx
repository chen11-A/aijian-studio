import { useId, useRef, useState } from "react";
import "./next.css";
import "./ExportProgress.css";

const PHASE_LABELS = {
  preparing: "正在准备成片",
  joining: "正在拼接镜头",
  mixing: "正在合成声音",
  rendering: "正在制作导出画幅",
  checking: "正在进行技术检查",
  tagging: "正在写入成片标识",
  "checking-final": "正在复核最终文件",
  waitingReview: "等待审核检查结果",
  publishing: "正在发布文件",
  completed: "本次发布结束",
  partial: "部分文件已发布",
  failed: "本次处理未完成",
  unknown: "当前处理状态待确认",
} as const;

export type ExportPhase = keyof typeof PHASE_LABELS;
export type ExportProgressMeasure =
  | { kind: "units"; completed: number; total: number; unit: "镜头" | "画幅" }
  | { kind: "media-time"; outTimeSeconds: number; durationSeconds: number };
export type ExportCancelState = "available" | "requested" | "stopped" | "unavailable";
export type PublishedExport = { aspectRatio: "16:9" | "9:16"; label?: string };
export type ExportProgressProps = {
  /** Stable execution identity, used only to prevent duplicate stop requests. Never rendered. */
  operationKey: string;
  phase: ExportPhase;
  /** Measurements for this phase only, supplied by actual work counters or FFmpeg output. */
  progress?: ExportProgressMeasure;
  cancelState: ExportCancelState;
  published?: readonly PublishedExport[];
  onRequestCancel?: () => void | Promise<void>;
};

const ACTIVE = new Set<ExportPhase>([
  "preparing",
  "joining",
  "mixing",
  "rendering",
  "checking",
  "tagging",
  "checking-final",
  "publishing",
]);

function measurement(value: ExportProgressMeasure | undefined) {
  if (value?.kind === "units") {
    if (
      !Number.isSafeInteger(value.completed) ||
      !Number.isSafeInteger(value.total) ||
      value.completed < 0 ||
      value.total <= 0 ||
      value.completed > value.total ||
      !["镜头", "画幅"].includes(value.unit)
    )
      return null;
    return {
      done: value.completed,
      total: value.total,
      text: `本阶段已完成 ${value.completed} / ${value.total} 个${value.unit}`,
    };
  }
  if (value?.kind === "media-time") {
    const { outTimeSeconds: done, durationSeconds: total } = value;
    if (!Number.isFinite(done) || !Number.isFinite(total) || done < 0 || total <= 0 || done > total)
      return null;
    return { done, total, text: `本阶段 ${Math.round((done / total) * 100)}%` };
  }
  return null;
}

function safeLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (
    /[\\/{}]|(?:https?|file):|(?:api[_ -]?key|token|authorization|bearer|secret|password)\s*[:=]|sk-[A-Za-z0-9]|AKIA[A-Z0-9]|(?:Error|Exception|Traceback):|\b(?:film|prj|shot|take)_[a-z0-9]{8,}/i.test(
      text,
    )
  )
    return "";
  return [...text].slice(0, 160).join("");
}

/** Presentation only. A stop request is never treated as confirmation that a process exited. */
export function ExportProgress({
  operationKey,
  phase,
  progress,
  cancelState,
  published = [],
  onRequestCancel,
}: ExportProgressProps) {
  const id = useId();
  const sentFor = useRef<string | null>(null);
  const [requestedFor, setRequestedFor] = useState<string | null>(null);
  const [uncertainFor, setUncertainFor] = useState<string | null>(null);
  const knownPhase = Object.hasOwn(PHASE_LABELS, phase) ? phase : "unknown";
  const active = ACTIVE.has(knownPhase);
  const stopped = cancelState === "stopped";
  const requested =
    active && !stopped && (cancelState === "requested" || requestedFor === operationKey);
  const measured = active && !stopped ? measurement(progress) : null;
  const canRequest =
    active && !stopped && !requested && cancelState === "available" && Boolean(onRequestCancel);
  let note = "技术处理进度不代表完整观看或试听已经完成。";
  if (stopped) note = "处理已停止。已发布的文件会保留，请核对结果。";
  else if (requested)
    note =
      uncertainFor === operationKey
        ? "停止请求未得到确认，请等待状态更新并核对已保存的文件。"
        : "正在请求停止，等待处理结束的确认。";
  else if (knownPhase === "waitingReview")
    note = "请在检查清单中审核结果，再决定是否发布。取消审核不等于停止正在运行的处理。";
  else if (knownPhase === "unknown") note = "请核对当前任务及已保存的文件，暂时无法确认处理结果。";
  else if (knownPhase === "partial")
    note = "已有文件会保留。其余部分未全部完成，请核对后再决定下一步。";
  else if (knownPhase === "failed") note = "请核对已保存的文件，不能仅凭此状态判断没有输出。";
  else if (knownPhase === "completed") note = "请实际播放和试听已发布的成片。";

  function requestStop() {
    if (!canRequest || sentFor.current === operationKey || !onRequestCancel) return;
    sentFor.current = operationKey;
    setRequestedFor(operationKey);
    try {
      void Promise.resolve(onRequestCancel()).catch(() => setUncertainFor(operationKey));
    } catch {
      setUncertainFor(operationKey);
    }
  }

  return (
    <section className="nx-root nx-export-progress" aria-labelledby={`${id}-heading`}>
      <div className="nx-panel nx-export-progress-panel">
        <div className="nx-panel-head">
          <h2 id={`${id}-heading`}>{stopped ? "处理已停止" : PHASE_LABELS[knownPhase]}</h2>
        </div>
        <div className="nx-panel-body nx-export-progress-body">
          <p role="status" aria-live="polite">
            {note}
          </p>
          {active && !stopped ? (
            <div className="nx-export-progress-meter">
              <progress
                aria-label="本阶段进度"
                {...(measured ? { max: measured.total, value: measured.done } : {})}
              />
              <p className="nx-faint">{measured?.text ?? "暂时没有可用的进度数值。"}</p>
            </div>
          ) : null}
          {published.length > 0 ? (
            <section aria-label="已发布文件" className="nx-export-published">
              <h3>已发布文件</h3>
              <p className="nx-faint">这些部分已经发布，会保留在保存位置。</p>
              <ul>
                {published.map((item, index) => {
                  const label = safeLabel(item.label);
                  const aspect =
                    item.aspectRatio === "16:9"
                      ? "横屏 16:9"
                      : item.aspectRatio === "9:16"
                        ? "竖屏 9:16"
                        : "画幅待确认";
                  return (
                    <li key={index}>
                      <strong>{aspect}</strong>
                      {label ? <span>{label}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {active && !stopped ? (
            <div className="nx-export-progress-actions">
              {canRequest || requested ? (
                <button type="button" className="nx-btn" disabled={requested} onClick={requestStop}>
                  {requested ? "正在请求停止" : "停止处理"}
                </button>
              ) : (
                <p className="nx-faint">
                  {cancelState === "unavailable"
                    ? "当前步骤无法停止，请等待结果。"
                    : "当前无法请求停止，请等待状态更新。"}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
