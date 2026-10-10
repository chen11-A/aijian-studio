/** Credential-free official text domain types. HTTP DTOs come from OpenAPI. */
import type { components } from "./generated.js";
export type {
  AssistantChatBridge,
  AssistantChatOperationQuery,
  AssistantChatOperationResult,
  AssistantChatPendingQuery,
  AssistantChatPendingResult,
  AssistantChatPreviewRequest,
  AssistantChatPreviewResult,
  AssistantChatReference,
  AssistantChatScope,
  AssistantChatSendRequest,
  AssistantChatSendResult,
} from "./assistant-chat.js";
export type OfficialTextOperation = components["schemas"]["OfficialTextOperation"];
export type OfficialTextBase = components["schemas"]["OfficialTextScriptBase"];
export type OfficialTextReserve = components["schemas"]["ReserveOfficialTextRequest"];
export type OfficialTextCompletion = components["schemas"]["CompleteOfficialTextRequest"];
export type OfficialTextAdopt = components["schemas"]["AdoptOfficialTextRequest"];
export type OfficialTextGenerate = {
  projectId: string;
  episodeId: string;
  base: OfficialTextBase | null;
  operationId: string;
  /** Account confirmed with the model catalog; older read-only replays may omit it. */
  expectedProfileId?: string;
  model: string;
  text: string;
  instructions?: string;
};
export type OfficialTextFailure = { kind: "ERROR"; code: string } | { kind: "UNKNOWN" };
export type OfficialTextRead =
  { kind: "OK"; operation: OfficialTextOperation } | OfficialTextFailure;
export type OfficialTextList =
  { kind: "OK"; operations: OfficialTextOperation[] } | OfficialTextFailure;
export type OfficialTextGeneration =
  | OfficialTextRead
  | { kind: "NOT_SENT"; code: string; operationId: string }
  | { kind: "REMOTE_UNKNOWN"; code: string; operationId: string };
export type OfficialTextBridge = {
  list(projectId: string, episodeId: string): Promise<OfficialTextList>;
  get(projectId: string, episodeId: string, operationId: string): Promise<OfficialTextRead>;
  generate(command: OfficialTextGenerate): Promise<OfficialTextGeneration>;
  adopt(
    projectId: string,
    episodeId: string,
    operationId: string,
    input: OfficialTextAdopt,
  ): Promise<OfficialTextRead>;
};
