/** Renderer-safe contextual chat contract. No credentials or mutable work content crosses this bridge. */
export type AssistantChatScope = {
  projectId: string | null;
  episodeId: string | null;
  page: string;
};

/** References name saved objects only. Main re-reads and verifies the current head. */
export type AssistantChatReference = {
  objectKind:
    | "SCRIPT_SCENE"
    | "SCRIPT_BLOCK"
    | "STORYBOARD_SHOT"
    | "CREATIVE_CHARACTER"
    | "CREATIVE_SCENE"
    | "CREATIVE_WORLD";
  objectId: string;
  versionId: string;
  contentHash: string;
  headRevision: number;
};

export type AssistantChatPreviewRequest = {
  sessionId: string;
  scope: AssistantChatScope;
  userText: string;
  model: string;
  expectedProfileId: string;
  references: AssistantChatReference[];
};

export type AssistantChatPreviewResult =
  | {
      kind: "READY";
      previewId: string;
      operationId: string;
      inputHash: string;
      outboundText: string;
      includedSources: string[];
      historyOmitted: number;
      contextTruncated: boolean;
    }
  | { kind: "NOT_READY"; code: string };

export type AssistantChatSendRequest = {
  previewId: string;
  operationId: string;
  inputHash: string;
  expectedProfileId: string;
};

export type AssistantChatSendResult =
  | { kind: "COMPLETED"; operationId: string; text: string }
  | { kind: "NOT_SENT"; operationId: string; code: string }
  | { kind: "REMOTE_UNKNOWN"; operationId: string; code: string };

export type AssistantChatOperationQuery = {
  operationId: string;
  expectedProfileId: string;
  scope: AssistantChatScope;
};

export type AssistantChatOperationResult =
  | AssistantChatSendResult
  | { kind: "COMPLETED_UNAVAILABLE"; operationId: string }
  | { kind: "NOT_FOUND"; operationId: string }
  | { kind: "ERROR"; code: string; operationId: string };

export type AssistantChatPendingQuery = {
  scope: AssistantChatScope;
  expectedProfileId: string;
};

/** Metadata-only IDs let the UI surface outstanding operations after restart. */
export type AssistantChatPendingResult =
  { kind: "OK"; operationIds: string[] } | { kind: "ERROR"; code: string };

export type AssistantChatBridge = {
  preview(request: AssistantChatPreviewRequest): Promise<AssistantChatPreviewResult>;
  send(request: AssistantChatSendRequest): Promise<AssistantChatSendResult>;
  discardPreview(previewId: string): Promise<void>;
  getOperation(query: AssistantChatOperationQuery): Promise<AssistantChatOperationResult>;
  listPending(query: AssistantChatPendingQuery): Promise<AssistantChatPendingResult>;
};
