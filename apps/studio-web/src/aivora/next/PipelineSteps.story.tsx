import { useState } from "react";
import {
  PipelineSteps,
  type PipelineCheckpoint,
  type PipelineStatus,
  type PipelineStepView,
  type PipelineTargetView,
} from "./PipelineSteps";
import { StoryFrame } from "./stories/StoryFrame";

/** Example page: 一键成片 on the test novel (3 scenes, 7 people, 28 shots). */
const STATES = [
  { id: "running", label: "在做定妆照" },
  { id: "failed", label: "有一张没出成" },
  { id: "uncertain", label: "结果不确定" },
  { id: "review", label: "等你审片" },
  { id: "blocked", label: "结尾没拍到" },
  { id: "checkpoint", label: "可以继续" },
  { id: "cancelled", label: "已取消" },
];

const ORDER = [
  "writer",
  "art",
  "portraits",
  "director",
  "action",
  "performance",
  "prompter",
  "stills",
  "review",
  "video",
  "assembly",
];
const NAMES: Record<string, string> = {
  "lin@正面": "林晚 · 正面",
  "lin@侧面": "林晚 · 侧面",
  "shen@正面": "沈砚 · 正面",
  "s2-6": "第 2 场第 6 个镜头",
};

/** Steps up to `upTo` done, that step in `state`, the rest queued. */
function steps(upTo: string, state: PipelineStatus, targets: PipelineTargetView[] = []) {
  const at = ORDER.indexOf(upTo);
  return ORDER.map((id, index): PipelineStepView => {
    const total = ["portraits", "prompter", "stills", "video"].includes(id) ? 28 : 3;
    if (index < at) return { id, status: "done", done: total, total };
    if (index > at) return { id, status: "queued", done: 0, total };
    return { id, status: state, done: Math.round(total * 0.4), total, targets };
  });
}

const CHECKPOINT: PipelineCheckpoint = {
  shotCount: 28,
  seconds: 149,
  estimatedRequests: 28,
  coverage: [
    { sceneId: "s1", ok: true, missingLines: [], missingTail: null },
    { sceneId: "s2", ok: true, missingLines: [], missingTail: null },
  ],
  risks: [{ code: "VIDEO_SUBMISSIONS_ESTIMATE", text: "", severity: "info" }],
};

function propsFor(state: string) {
  switch (state) {
    case "failed":
      return {
        steps: steps("portraits", "failed", [
          { id: "lin@正面", status: "done" },
          { id: "lin@侧面", status: "failed", code: "PORTRAIT_FAILED", retryable: true },
        ] as PipelineTargetView[]),
      };
    case "uncertain":
      return {
        steps: steps("portraits", "uncertain", [
          {
            id: "shen@正面",
            status: "uncertain",
            code: "REQUEST_OUTCOME_UNKNOWN",
            retryable: true,
            requiresOutcomeConfirmation: true,
          },
        ] as PipelineTargetView[]),
      };
    case "review":
      return {
        steps: steps("review", "needs-input", [{ id: "all", status: "needs-input" }]),
        canAcceptReview: true,
      };
    case "blocked":
      return {
        steps: steps("video", "queued"),
        overall: "checkpoint" as const,
        checkpoint: {
          ...CHECKPOINT,
          coverage: [
            {
              sceneId: "s1",
              ok: false,
              missingLines: [],
              missingTail: "就在这时，门外传来刺耳的刹车声。",
            },
          ],
          risks: [
            {
              code: "ACTION_UNASSIGNED",
              text: "2 个动作还没对上镜头。",
              severity: "block" as const,
            },
          ],
        },
        canContinue: false,
      };
    case "checkpoint":
      return {
        steps: steps("video", "queued"),
        overall: "checkpoint" as const,
        checkpoint: CHECKPOINT,
        canContinue: true,
      };
    case "cancelled":
      return { steps: steps("director", "queued"), overall: "cancelled" as const };
    default:
      return { steps: steps("portraits", "running"), busy: true };
  }
}

export function PipelineStepsStory({ state = "running" }: { state?: string }) {
  const [log, setLog] = useState<string>();
  return (
    <StoryFrame story="pipeline-steps" states={STATES} state={state} log={log}>
      <PipelineSteps
        {...propsFor(state)}
        targetName={(_, id) => NAMES[id] ?? ""}
        sceneName={(id) => (id === "s1" ? "第 1 场「雨夜旧书店」" : "")}
        onContinue={() => setLog("继续生成")}
        onAcceptReview={(reason) => setLog(`审片结论：${reason}`)}
        onRetryTarget={(step, target, sure) =>
          setLog(`重试 ${NAMES[target] ?? target}${sure ? "（核对过）" : ""}`)
        }
        onCancel={() => setLog("取消")}
      />
    </StoryFrame>
  );
}
