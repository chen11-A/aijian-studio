/** Credential-free official AI director surface. HTTP DTOs come from OpenAPI. */
import type { components } from "./generated.js";

export type OfficialDirectorOperation = components["schemas"]["OfficialDirectorOperation"];
export type OfficialDirectorPrepare = components["schemas"]["PrepareOfficialDirectorRequest"];
export type OfficialDirectorPrepared = components["schemas"]["OfficialDirectorPreparedRequest"];
export type OfficialDirectorReserve = components["schemas"]["ReserveOfficialDirectorRequest"];
export type OfficialDirectorCompletion = components["schemas"]["CompleteOfficialDirectorRequest"];
export type OfficialDirectorAdopt = components["schemas"]["AdoptOfficialDirectorRequest"];
export type OfficialDirectorReject = components["schemas"]["RejectOfficialDirectorRequest"];
export type OfficialDirectorContent = components["schemas"]["OfficialDirectorContentV1"];
export type OfficialDirectorGenerate = {
  projectId: string;
  episodeId: string;
  operationId: string;
  model: string;
  authority: OfficialDirectorPrepare["authority"];
  storyboardBase: OfficialDirectorPrepare["storyboard_base"];
  intent: string;
  options: OfficialDirectorPrepare["options"];
};
export type OfficialDirectorFailure = { kind: "ERROR"; code: string } | { kind: "UNKNOWN" };
export type OfficialDirectorRead =
  { kind: "OK"; operation: OfficialDirectorOperation } | OfficialDirectorFailure;
export type OfficialDirectorList =
  | { kind: "OK"; operations: OfficialDirectorOperation[]; hasMore: boolean }
  | OfficialDirectorFailure;
export type OfficialDirectorGeneration =
  | OfficialDirectorRead
  | { kind: "NOT_SENT"; code: string; operationId: string }
  | { kind: "REMOTE_UNKNOWN"; code: string; operationId: string };
/** Renderer has no reservation, completion, credentials, prompt-import or arbitrary HTTP channel. */
export type OfficialDirectorBridge = {
  list(projectId: string, episodeId: string): Promise<OfficialDirectorList>;
  get(projectId: string, episodeId: string, operationId: string): Promise<OfficialDirectorRead>;
  generate(command: OfficialDirectorGenerate): Promise<OfficialDirectorGeneration>;
  adopt(
    projectId: string,
    episodeId: string,
    operationId: string,
    input: OfficialDirectorAdopt,
  ): Promise<OfficialDirectorRead>;
  reject(
    projectId: string,
    episodeId: string,
    operationId: string,
    input: OfficialDirectorReject,
  ): Promise<OfficialDirectorRead>;
};
