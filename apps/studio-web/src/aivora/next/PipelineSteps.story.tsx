import { useState } from "react";
import { PipelineSteps, type PipelineStepView } from "./PipelineSteps";
import { StoryFrame } from "./stories/StoryFrame";

/** Example page: 一键成片 on the test novel (3 scenes, 7 people, 28 shots). */
const STATES = [
  { id: "running", label: "在做定妆照" },
  { id: "failed", label: "导演没做完" },
  { id: "checkpoint", label: "停在分镜" },
  { id: "only-checkpoint", label: "只有检查点" },
];

const step = (
  id: string,
  status: PipelineStepView["status"],
  done = 0,
  total = 1,
): PipelineStepView => ({ id, label: id, status, done, total });

function stepsFor(state: string): PipelineStepView[] {
  if (state === "only-checkpoint") return [];
  if (state === "failed")
    return [
      step("writer", "done", 1, 1),
      step("art", "done", 1, 1),
      step("portraits", "done", 28, 28),
      step("director", "failed", 2, 3),
      step("action", "queued"),
      step("performance", "queued"),
      step("prompter", "queued"),
      step("stills", "queued", 0, 28),
      step("review", "queued"),
    ];
  if (state === "checkpoint")
    return [
      step("writer", "done"),
      step("art", "done"),
      step("portraits", "done", 28, 28),
      step("director", "done", 3, 3),
      step("action", "done"),
      step("performance", "done"),
      step("prompter", "done", 28, 28),
      step("stills", "done", 28, 28),
      step("review", "done", 28, 28),
    ];
  return [
    step("writer", "done"),
    step("art", "done"),
    step("portraits", "running", 12, 28),
    step("director", "queued", 0, 3),
    step("action", "queued"),
    step("performance", "queued"),
    step("prompter", "queued", 0, 28),
    step("stills", "queued", 0, 28),
    step("review", "queued", 0, 28),
  ];
}

export function PipelineStepsStory({ state = "running" }: { state?: string }) {
  const [log, setLog] = useState<string>();
  const stopped = state === "checkpoint" || state === "only-checkpoint";
  return (
    <StoryFrame story="pipeline-steps" states={STATES} state={state} log={log}>
      <PipelineSteps
        steps={stepsFor(state)}
        checkpoint={stopped ? { shots: 28, seconds: 149, videos: 28 } : null}
        onContinue={() => setLog("继续生成")}
        onRetryFrom={(id) => setLog(`从「${id}」这一步重来`)}
      />
    </StoryFrame>
  );
}
