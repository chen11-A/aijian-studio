import type { FilmProject } from "../film/project";
import {
  MEDIA_EXECUTION_ORDER,
  isProductionPipeline,
  productionTargetKey,
  type ProductionStepId,
} from "../film/production-pipeline";

/** Read-only UI contract. The controller still revalidates inputs at dispatch/save time. */
export function pipelineView(film: Pick<FilmProject, "id" | "productionPipeline">) {
  const state = film.productionPipeline;
  if (!state) return { kind: "empty" as const };
  if (!isProductionPipeline(state) || state.code === "STATE_INVALID")
    return { kind: "invalid" as const, code: "STATE_INVALID" as const };
  if (state.projectId !== film.id)
    return { kind: "invalid" as const, code: "PROJECT_RESULT_MISMATCH" as const };
  const finished = (status: string) => status === "done" || status === "accepted";
  const first = MEDIA_EXECUTION_ORDER.map((id) => state.steps.find((step) => step.id === id)!).find(
    (step) => !finished(step.status),
  );
  const checkpointPhase =
    state.current === "portraits" || state.current === "stills"
      ? ("before-media" as const)
      : ("video" as const);
  const busy =
    state.status === "running" ||
    state.steps.some((step) => step.targets.some((target) => target.status === "running"));
  const steps = state.steps.map((step) => ({
    ...structuredClone(step),
    targets: step.targets.map((target) => ({
      ...structuredClone(target),
      key: productionTargetKey(step.id, target.id),
      retryable:
        !busy &&
        step.id === first?.id &&
        ["failed", "blocked", "uncertain"].includes(target.status),
      requiresOutcomeConfirmation: target.status === "uncertain",
    })),
  }));
  const checkpoint = state.checkpoint ? structuredClone(state.checkpoint) : null;
  return {
    kind: "ready" as const,
    status: state.status,
    current: state.current,
    code: state.code,
    steps,
    checkpoint,
    checkpointPhase,
    busy,
    canAcceptReview:
      !busy &&
      first?.id === "review" &&
      first.targets.some((target) => target.id === "all" && target.status === "needs-input"),
    canContinue:
      !busy &&
      state.status === "checkpoint" &&
      !state.continued &&
      (first?.id === "video" || first?.id === "portraits" || first?.id === "stills") &&
      Boolean(
        checkpoint &&
        checkpoint.shotCount > 0 &&
        checkpoint.seconds > 0 &&
        checkpoint.coverage.length > 0 &&
        checkpoint.coverage.every((scene) => scene.ok) &&
        !checkpoint.risks.some((risk) => risk.severity === "block"),
      ),
  };
}
export type PipelineView = ReturnType<typeof pipelineView>;

/** Resolve one explicitly selected target. Never turn a step button into a batch resubmission. */
export function pipelineRetryKey(
  film: Pick<FilmProject, "id" | "productionPipeline">,
  stepId: ProductionStepId,
  targetId: string,
  outcomeConfirmed = false,
): string | null {
  const view = pipelineView(film);
  if (view.kind !== "ready") return null;
  const target = view.steps
    .find((step) => step.id === stepId)
    ?.targets.find((row) => row.id === targetId);
  if (!target?.retryable || (target.requiresOutcomeConfirmation && !outcomeConfirmed)) return null;
  return target.key;
}
