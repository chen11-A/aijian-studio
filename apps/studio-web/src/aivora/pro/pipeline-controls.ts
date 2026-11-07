import type { FilmProject } from "../film/project";
import { PRODUCTION_STEPS, type ProductionStepId } from "../film/production-pipeline";
import { NOTICE_TEXT } from "../film/notices";
import type { UiNotice } from "../film/contracts3j";
import { pipelineRetryKey, pipelineView } from "./pipeline-view";
import type { createPipelineWorkspaceHost } from "./pipeline-workspace-host";

type Workspace = ReturnType<typeof createPipelineWorkspaceHost>;
/** Component callbacks consume current persisted state, never the old batch-video shortcut. */
export function createPipelineControls(host: {
  current: () => FilmProject | null;
  workspace: Workspace;
  notify: (notice: UiNotice) => void;
}) {
  let active = false;
  const notice = (code: string) =>
    host.notify({
      code,
      text: (NOTICE_TEXT as Record<string, string>)[code] ?? NOTICE_TEXT.ONECLICKFILM_FAILED,
    });
  async function invoke(projectId: string | undefined, action: () => Promise<unknown>) {
    if (!projectId || host.current()?.id !== projectId) {
      notice("PIPELINE_REQUEST_STALE");
      return false;
    }
    if (active) {
      notice("PIPELINE_ALREADY_RUNNING");
      return false;
    }
    active = true;
    try {
      await action();
      return true;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      if (host.current()?.id === projectId)
        notice(
          typeof code === "string" && Object.hasOwn(NOTICE_TEXT, code)
            ? code
            : "ONECLICKFILM_FAILED",
        );
      return false;
    } finally {
      active = false;
    }
  }
  return {
    ...host.workspace,
    start: () => invoke(host.current()?.id, host.workspace.start),
    /** Call on each render. Empty/invalid state does not fabricate steps or a checkpoint. */
    props() {
      const film = host.current();
      const projectId = film?.id;
      const view = film ? pipelineView(film) : { kind: "empty" as const };
      const currentView = () => {
        const current = host.current();
        return current && current.id === projectId ? pipelineView(current) : null;
      };
      return {
        steps: view.kind === "ready" ? view.steps : [],
        overall: view.kind === "ready" ? view.status : undefined,
        checkpoint: view.kind === "ready" ? view.checkpoint : null,
        checkpointPhase: view.kind === "ready" ? view.checkpointPhase : undefined,
        busy: active || (view.kind === "ready" && view.busy),
        canContinue: !active && view.kind === "ready" && view.canContinue,
        canAcceptReview: !active && view.kind === "ready" && view.canAcceptReview,
        onContinue: () => {
          const latest = currentView();
          if (latest?.kind !== "ready" || !latest.canContinue) {
            notice("CHECKPOINT_INVALID");
            return Promise.resolve(false);
          }
          return invoke(projectId, host.workspace.continue);
        },
        onContinueAfterTrial: (decisionId: string) => {
          const latest = currentView();
          if (
            latest?.kind !== "ready" ||
            !latest.canContinue ||
            latest.checkpointPhase !== "video" ||
            !/^rtd_[a-f0-9]{32}$/.test(decisionId)
          ) {
            notice("CHECKPOINT_INVALID");
            return Promise.resolve(false);
          }
          return invoke(projectId, () => host.workspace.continueAfterTrial(decisionId));
        },
        onAcceptReview: (reason: string) => {
          const latest = currentView();
          if (latest?.kind !== "ready" || !latest.canAcceptReview || !reason.trim()) {
            notice("REVIEW_REASON_REQUIRED");
            return Promise.resolve(false);
          }
          return invoke(projectId, () => host.workspace.acceptReview(reason.trim()));
        },
        onRetryTarget: (stepId: string, targetId: string, outcomeConfirmed: boolean) => {
          const current = host.current();
          const key =
            current &&
            current.id === projectId &&
            PRODUCTION_STEPS.includes(stepId as ProductionStepId)
              ? pipelineRetryKey(current, stepId as ProductionStepId, targetId, outcomeConfirmed)
              : null;
          if (!key) {
            notice("PIPELINE_TARGETS_CHANGED");
            return Promise.resolve(false);
          }
          return invoke(projectId, () => host.workspace.retry([key]));
        },
        onCancel: () => {
          if (host.current()?.id === projectId) host.workspace.cancel();
        },
      };
    },
  };
}
