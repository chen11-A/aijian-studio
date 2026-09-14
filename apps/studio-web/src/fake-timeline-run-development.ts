import type {
  FakeTimelineRunCapability,
  ProjectData,
  SourceDocumentResponse,
  SourceManifestResponse,
} from "./api/studio";
import {
  submitFakeTimelineRunOperation,
  type FakeTimelineRunOperationJournal,
  type FakeTimelineRunSubmissionResult,
} from "./fake-timeline-run-operation-journal";
import { prepareFakeTimelineRun, type FakeTimelinePreflight } from "./fake-timeline-run-preflight";

export type FakeTimelineDevelopmentScope = Readonly<{ projectId: string; token: number }>;
export type FakeTimelineDevelopmentResult =
  | {
      kind: "scope-unavailable";
      reason: "scope-project-mismatch" | "stale-scope";
      projectId: string;
      deliver: false;
    }
  | { kind: "manifest-unavailable"; projectId: string; deliver: boolean }
  | {
      kind: "preflight-unavailable";
      projectId: string;
      deliver: boolean;
      preflight: FakeTimelinePreflight;
    }
  | { kind: "journal-corrupt"; projectId: string; deliver: boolean }
  | {
      kind: "submission";
      projectId: string;
      deliver: boolean;
      submission: FakeTimelineRunSubmissionResult;
    };

interface DevelopmentDependencies {
  journal: FakeTimelineRunOperationJournal;
  capability: FakeTimelineRunCapability;
  loadManifest(projectId: string): Promise<SourceManifestResponse | null>;
}

/**
 * Development-only coordinator for the existing fake-timeline contract.
 * It is deliberately not an API for a production renderer.
 */
export function createFakeTimelineDevelopmentCoordinator(dependencies: DevelopmentDependencies) {
  const inFlight = new Map<string, Promise<FakeTimelineDevelopmentResult>>();
  let activeScope: FakeTimelineDevelopmentScope | null = null;
  let nextToken = 0;

  const isDeliverable = (scope: FakeTimelineDevelopmentScope) =>
    activeScope?.projectId === scope.projectId && activeScope.token === scope.token;

  const result = <T extends Omit<FakeTimelineDevelopmentResult, "deliver" | "projectId">>(
    scope: FakeTimelineDevelopmentScope,
    value: T,
  ): T & Pick<FakeTimelineDevelopmentResult, "projectId" | "deliver"> => ({
    ...value,
    projectId: scope.projectId,
    deliver: isDeliverable(scope),
  });

  return {
    activate(projectId: string): FakeTimelineDevelopmentScope {
      activeScope = { projectId, token: ++nextToken };
      return activeScope;
    },

    submit(
      scope: FakeTimelineDevelopmentScope,
      project: Pick<ProjectData, "id">,
      source: Pick<SourceDocumentResponse, "data">,
    ): Promise<FakeTimelineDevelopmentResult> {
      if (scope.projectId !== project.id) {
        return Promise.resolve({
          kind: "scope-unavailable",
          reason: "scope-project-mismatch",
          projectId: scope.projectId,
          deliver: false,
        });
      }
      if (!isDeliverable(scope)) {
        return Promise.resolve({
          kind: "scope-unavailable",
          reason: "stale-scope",
          projectId: scope.projectId,
          deliver: false,
        });
      }

      const existing = inFlight.get(scope.projectId);
      if (existing) return existing;

      const pending = (async (): Promise<FakeTimelineDevelopmentResult> => {
        let manifest: SourceManifestResponse | null;
        try {
          manifest = await dependencies.loadManifest(project.id);
        } catch {
          return result(scope, { kind: "manifest-unavailable" });
        }

        const preflight = prepareFakeTimelineRun(project, source, manifest);
        if (preflight.kind !== "ready") {
          return result(scope, { kind: "preflight-unavailable", preflight });
        }

        try {
          const submission = await submitFakeTimelineRunOperation(
            dependencies.journal,
            dependencies.capability,
            project.id,
            preflight.input,
          );
          return result(scope, { kind: "submission", submission });
        } catch {
          return result(scope, { kind: "journal-corrupt" });
        }
      })();
      inFlight.set(scope.projectId, pending);
      void pending.finally(() => {
        if (inFlight.get(scope.projectId) === pending) inFlight.delete(scope.projectId);
      });
      return pending;
    },
  };
}
