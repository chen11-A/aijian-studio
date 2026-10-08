import type { components } from "@aijian/contracts";
import type { ShotPlanGateway } from "@aijian/contracts/shot-plan";
import {
  isHumanShotPlanRequest,
  isShotPlanAdoptedResponse,
  isShotPlanAdoptionRequest,
  isShotPlanAdoptionStatusResponse,
  isShotPlanCreatedResponse,
  isShotPlanEpisodeId,
  isShotPlanOperationId,
  isShotPlanPreparationResponse,
  isShotPlanProjectId,
  isShotPlanProposalResponse,
  isShotPlanVersionId,
  isShotPlanWriteStatusResponse,
  shotPlanDefiniteError,
} from "./shot-plan-contract";

type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;
type DefiniteError = NonNullable<ReturnType<typeof shotPlanDefiniteError>>;
type UnknownResult = { kind: "REMOTE_UNKNOWN" };
type ProposalResponse = components["schemas"]["ShotPlanProposalResponse"];

export function createShotPlanClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): ShotPlanGateway {
  const root = (projectId: string, episodeId: string): string => {
    if (!isShotPlanProjectId(projectId) || !isShotPlanEpisodeId(episodeId))
      throw new Error("Shot plan requires canonical scope ids");
    return `/api/v1/projects/${projectId}/episodes/${episodeId}/shot-plan-proposals`;
  };
  const version = (versionId: string): string => {
    if (!isShotPlanVersionId(versionId))
      throw new Error("Shot plan requires a canonical version id");
    return `/versions/${versionId}`;
  };
  const operation = (operationId: string): string => {
    if (!isShotPlanOperationId(operationId))
      throw new Error("Shot plan requires a canonical UUID v4 operation id");
    return operationId;
  };
  async function request<T>(
    path: string,
    status: number,
    valid: (body: unknown, requestId: string | null) => body is T,
    init: RequestInit = { headers },
  ): Promise<{ kind: "SUCCESS"; receipt: T } | DefiniteError | UnknownResult> {
    // Exactly one attempt. Recovery is an explicit read-only operation/status request.
    let result;
    try {
      result = await readHttp(path, init);
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    if (result === null) return { kind: "REMOTE_UNKNOWN" };
    if (result.status === status)
      return valid(result.payload, result.requestId)
        ? { kind: "SUCCESS", receipt: result.payload }
        : { kind: "REMOTE_UNKNOWN" };
    return (
      shotPlanDefiniteError(result.status, result.payload, result.requestId) ?? {
        kind: "REMOTE_UNKNOWN",
      }
    );
  }
  const post = (operationId: string, payload: unknown): RequestInit => ({
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Idempotency-Key": operation(operationId),
    },
    body: JSON.stringify(payload),
  });
  return {
    async prepareHumanShotPlan(projectId, episodeId) {
      const result = await request(
        root(projectId, episodeId) + "/preparation",
        200,
        (body, requestId): body is components["schemas"]["ShotPlanPreparationResponse"] =>
          isShotPlanPreparationResponse(body, projectId, episodeId, requestId),
      );
      return result.kind === "SUCCESS" ? { kind: "PREPARED", receipt: result.receipt } : result;
    },
    async getShotPlanProposal(projectId, episodeId) {
      const result = await request(
        root(projectId, episodeId),
        200,
        (body, requestId): body is ProposalResponse =>
          isShotPlanProposalResponse(body, projectId, episodeId, requestId),
      );
      if (result.kind === "SUCCESS") return { kind: "FOUND", receipt: result.receipt };
      return result.kind === "DEFINITE_SERVER_ERROR" &&
        result.status === 404 &&
        result.code === "SHOT_PLAN_NOT_FOUND"
        ? { kind: "EMPTY" }
        : result;
    },
    async getShotPlanProposalVersion(projectId, episodeId, versionId) {
      const result = await request(
        root(projectId, episodeId) + version(versionId),
        200,
        (body, requestId): body is ProposalResponse =>
          isShotPlanProposalResponse(body, projectId, episodeId, requestId, versionId),
      );
      return result.kind === "SUCCESS" ? { kind: "FOUND", receipt: result.receipt } : result;
    },
    async getHumanShotPlanWriteStatus(projectId, episodeId, operationId) {
      const result = await request(
        root(projectId, episodeId) + `/human-operations/${operation(operationId)}`,
        200,
        (body, requestId): body is components["schemas"]["ShotPlanWriteStatusResponse"] =>
          isShotPlanWriteStatusResponse(body, projectId, episodeId, requestId),
      );
      return result.kind === "SUCCESS" ? { kind: "STATUS", receipt: result.receipt } : result;
    },
    async getShotPlanAdoptionStatus(projectId, episodeId, versionId) {
      const result = await request(
        root(projectId, episodeId) + version(versionId) + "/adoption",
        200,
        (body, requestId): body is components["schemas"]["ShotPlanAdoptionStatusResponse"] =>
          isShotPlanAdoptionStatusResponse(body, versionId, requestId),
      );
      return result.kind === "SUCCESS" ? { kind: "STATUS", receipt: result.receipt } : result;
    },
    async createHumanShotPlanProposal(projectId, episodeId, operationId, payload) {
      const path = root(projectId, episodeId) + "/human";
      if (!isHumanShotPlanRequest(payload, projectId, episodeId))
        throw new Error("Human shot plan write requires a closed HUMAN request");
      const snapshot = structuredClone(payload);
      const result = await request(
        path,
        201,
        (body, requestId): body is components["schemas"]["ShotPlanMutationResponse"] =>
          isShotPlanCreatedResponse(body, projectId, episodeId, requestId, snapshot),
        post(operationId, snapshot),
      );
      return result.kind === "SUCCESS" ? { kind: "CREATED", receipt: result.receipt } : result;
    },
    async adoptHumanShotPlanProposal(projectId, episodeId, versionId, operationId, payload) {
      const path = root(projectId, episodeId) + version(versionId) + "/adopt";
      if (!isShotPlanAdoptionRequest(payload))
        throw new Error(
          "Human shot plan adoption requires explicit true confirmation and the exact content hash",
        );
      const snapshot = structuredClone(payload);
      const result = await request(
        path,
        200,
        (body, requestId): body is components["schemas"]["ShotPlanMutationResponse"] =>
          isShotPlanAdoptedResponse(body, projectId, episodeId, versionId, requestId, snapshot),
        post(operationId, snapshot),
      );
      return result.kind === "SUCCESS" ? { kind: "ADOPTED", receipt: result.receipt } : result;
    },
  };
}
