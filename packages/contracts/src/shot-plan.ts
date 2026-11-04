/** HUMAN-only director proposal DTOs are generated from the authoritative OpenAPI schema. */
import type { components } from "./generated.js";

export type ShotPlanPreparation = components["schemas"]["ShotPlanPreparationData"];
export type ShotPlanProposal = components["schemas"]["ShotPlanProposalData"];
export type ShotPlanContent = components["schemas"]["ShotPlanContentV1"];
export type ShotPlanShot = components["schemas"]["ShotPlanShotV1"];
export type HumanShotPlanRequest = components["schemas"]["CreateHumanShotPlanRequest"];
export type ShotPlanAdoptionRequest = components["schemas"]["AdoptShotPlanRequest"];
export type ShotPlanAdoption = components["schemas"]["ShotPlanAdoptionData"];
export type ShotPlanMutation = components["schemas"]["ShotPlanMutationData"];
export type ShotPlanWriteStatus = components["schemas"]["ShotPlanWriteStatusData"];
export type ShotPlanAdoptionStatus = components["schemas"]["ShotPlanAdoptionStatusData"];
export type ShotPlanFailure =
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
type Receipt<T> = { data: T; request_id: string };

export type ShotPlanGateway = {
  prepareHumanShotPlan(
    projectId: string,
    episodeId: string,
  ): Promise<{ kind: "PREPARED"; receipt: Receipt<ShotPlanPreparation> } | ShotPlanFailure>;
  getShotPlanProposal(
    projectId: string,
    episodeId: string,
  ): Promise<
    { kind: "FOUND"; receipt: Receipt<ShotPlanProposal> } | { kind: "EMPTY" } | ShotPlanFailure
  >;
  getShotPlanProposalVersion(
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<{ kind: "FOUND"; receipt: Receipt<ShotPlanProposal> } | ShotPlanFailure>;
  getHumanShotPlanWriteStatus(
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<{ kind: "STATUS"; receipt: Receipt<ShotPlanWriteStatus> } | ShotPlanFailure>;
  getShotPlanAdoptionStatus(
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<{ kind: "STATUS"; receipt: Receipt<ShotPlanAdoptionStatus> } | ShotPlanFailure>;
  createHumanShotPlanProposal(
    projectId: string,
    episodeId: string,
    operationId: string,
    payload: HumanShotPlanRequest,
  ): Promise<{ kind: "CREATED"; receipt: Receipt<ShotPlanMutation> } | ShotPlanFailure>;
  adoptHumanShotPlanProposal(
    projectId: string,
    episodeId: string,
    versionId: string,
    operationId: string,
    payload: ShotPlanAdoptionRequest,
  ): Promise<{ kind: "ADOPTED"; receipt: Receipt<ShotPlanMutation> } | ShotPlanFailure>;
};
