import type {
  OfficialDirectorBridge,
  OfficialDirectorGenerate,
  OfficialDirectorOperation,
} from "@aijian/contracts/official-director";
import type { ShotPlanGateway } from "@aijian/contracts/shot-plan";
import { vi } from "vitest";
import officialFixture from "../../../../packages/contracts/fixtures/official-director.json";
import { validHumanShotPlanPreparation } from "../aivora/adapters/humanShotPlan";

export function directorInputs() {
  const value: unknown = structuredClone(officialFixture.humanPreparation);
  if (
    !validHumanShotPlanPreparation(
      value,
      officialFixture.humanPreparation.project_id,
      officialFixture.humanPreparation.episode_id,
    )
  )
    throw new Error("Invalid preparation fixture");
  return value;
}
export function directorOperation(
  operationId = "123e4567-e89b-42d3-a456-426614174000",
  count = 7,
): OfficialDirectorOperation {
  const operation = structuredClone(officialFixture.completed) as OfficialDirectorOperation;
  operation.request.operation_id = operationId;
  if (operation.completion) operation.completion.operation_id = operationId;
  if (!operation.proposal) throw new Error("No actual offline proposal fixture");
  const plan = operation.proposal.content;
  plan.shots = Array.from({ length: count }, (_, index) => {
    const source = plan.shots[index % plan.shots.length];
    if (!source) throw new Error("Empty actual plan fixture");
    return {
      ...source,
      shot_id: `shp_${index.toString(16).padStart(32, "0")}`,
      ordinal: index + 1,
      title: `模型镜头 ${index + 1}`,
    };
  });
  return operation;
}

export function directorGenerate(operation = directorOperation()): OfficialDirectorGenerate {
  return {
    projectId: operation.project_id,
    episodeId: operation.episode_id,
    operationId: operation.request.operation_id,
    model: operation.request.model,
    authority: operation.request.authority,
    storyboardBase: operation.request.storyboard_base,
    intent: operation.request.intent,
    options: operation.request.options,
  };
}
export function directorGateway(operations: OfficialDirectorOperation[] = []) {
  const store = new Map(operations.map((operation) => [operation.request.operation_id, operation]));
  const bridge: OfficialDirectorBridge = {
    list: vi.fn<OfficialDirectorBridge["list"]>(async () => ({
      kind: "OK",
      operations: [...store.values()],
      hasMore: false,
    })),
    get: vi.fn<OfficialDirectorBridge["get"]>(async (_p, _e, id) => {
      const operation = store.get(id);
      return operation ? { kind: "OK", operation } : { kind: "UNKNOWN" };
    }),
    generate: vi.fn<OfficialDirectorBridge["generate"]>(async (input) => {
      const operation = directorOperation(input.operationId, input.options.target_shot_count ?? 7);
      operation.request = {
        ...operation.request,
        model: input.model,
        intent: input.intent,
        options: input.options,
        authority: input.authority,
        storyboard_base: input.storyboardBase,
      };
      store.set(input.operationId, operation);
      return { kind: "OK", operation };
    }),
    adopt: vi.fn<OfficialDirectorBridge["adopt"]>(async (_p, _e, id, payload) => {
      const operation = store.get(id);
      if (!operation) return { kind: "UNKNOWN" };
      const next = {
        ...operation,
        adoption: {
          proposal_version_id: payload.proposal_version_id,
          proposal_content_hash: payload.proposal_content_hash,
          storyboard_version_id: `ver_${"3".repeat(32)}`,
          storyboard_content_hash: `sha256:${"4".repeat(64)}`,
          actor_id: "local-user",
          adopted_at: "2026-10-08T11:00:00Z",
        },
      };
      store.set(id, next);
      return { kind: "OK", operation: next };
    }),
    reject: vi.fn<OfficialDirectorBridge["reject"]>(async (_p, _e, id, payload) => {
      const operation = store.get(id);
      if (!operation) return { kind: "UNKNOWN" };
      const next = {
        ...operation,
        rejection: {
          actor_id: "local-user",
          rejected_at: "2026-10-08T11:00:00Z",
          reason: payload.reason,
        },
      };
      store.set(id, next);
      return { kind: "OK", operation: next };
    }),
  };
  const inputs = directorInputs();
  const preparationGateway: ShotPlanGateway = {
    prepareHumanShotPlan: vi.fn<ShotPlanGateway["prepareHumanShotPlan"]>(async () => ({
      kind: "PREPARED",
      receipt: { data: inputs, request_id: "123e4567-e89b-42d3-a456-426614174000" },
    })),
    getShotPlanProposal: vi.fn(async () => ({ kind: "EMPTY" as const })),
    getShotPlanProposalVersion: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    getHumanShotPlanWriteStatus: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    getShotPlanAdoptionStatus: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    createHumanShotPlanProposal: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    adoptHumanShotPlanProposal: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
  };
  return { bridge, preparationGateway, store, inputs };
}
export function directorStorage() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}
