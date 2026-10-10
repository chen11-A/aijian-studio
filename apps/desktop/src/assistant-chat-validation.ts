import type {
  AssistantChatOperationQuery,
  AssistantChatPendingQuery,
  AssistantChatPreviewRequest,
  AssistantChatReference,
  AssistantChatScope,
  AssistantChatSendRequest,
} from "@aijian/contracts/official-text";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const OBJECT: Record<AssistantChatReference["objectKind"], RegExp> = {
  SCRIPT_SCENE: /^scn_[0-9a-f]{32}$/,
  SCRIPT_BLOCK: /^sblk_[0-9a-f]{32}$/,
  STORYBOARD_SHOT: /^shp_[0-9a-f]{32}$/,
  CREATIVE_CHARACTER: /^chr_[0-9a-f]{32}$/,
  CREATIVE_SCENE: /^loc_[0-9a-f]{32}$/,
  CREATIVE_WORLD: /^world$/,
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function match(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}
function prose(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    Boolean(value.trim()) &&
    !value.includes("\0")
  );
}
export function parseScope(value: unknown): AssistantChatScope | null {
  if (!record(value) || !exact(value, ["projectId", "episodeId", "page"])) return null;
  if (
    (value.projectId !== null && !match(value.projectId, PROJECT)) ||
    (value.episodeId !== null && !match(value.episodeId, EPISODE)) ||
    (value.projectId === null && value.episodeId !== null) ||
    !match(value.page, /^[a-z][a-zA-Z0-9_-]{0,63}$/)
  )
    return null;
  return {
    projectId: value.projectId,
    episodeId: value.episodeId,
    page: value.page,
  } as AssistantChatScope;
}
function parseReference(value: unknown, scope: AssistantChatScope): AssistantChatReference | null {
  if (
    !record(value) ||
    !exact(value, ["objectKind", "objectId", "versionId", "contentHash", "headRevision"]) ||
    typeof value.objectKind !== "string" ||
    !Object.hasOwn(OBJECT, value.objectKind)
  )
    return null;
  const objectKind = value.objectKind as AssistantChatReference["objectKind"];
  if (
    !match(value.objectId, OBJECT[objectKind]) ||
    !match(value.versionId, VERSION) ||
    !match(value.contentHash, HASH) ||
    !Number.isSafeInteger(value.headRevision) ||
    (value.headRevision as number) < 1 ||
    scope.projectId === null ||
    ((objectKind === "SCRIPT_SCENE" ||
      objectKind === "SCRIPT_BLOCK" ||
      objectKind === "STORYBOARD_SHOT") &&
      scope.episodeId === null)
  )
    return null;
  return {
    objectKind,
    objectId: value.objectId,
    versionId: value.versionId,
    contentHash: value.contentHash,
    headRevision: value.headRevision as number,
  };
}

export function parsePreviewRequest(value: unknown): AssistantChatPreviewRequest | null {
  if (
    !record(value) ||
    !exact(value, ["sessionId", "scope", "userText", "model", "expectedProfileId", "references"]) ||
    !match(value.sessionId, UUID) ||
    !prose(value.userText, 8000) ||
    !prose(value.model, 200) ||
    !match(value.expectedProfileId, UUID) ||
    !Array.isArray(value.references) ||
    value.references.length > 3
  )
    return null;
  const scope = parseScope(value.scope);
  if (!scope) return null;
  const references = value.references.map((item) => parseReference(item, scope));
  if (references.some((item) => item === null)) return null;
  const keys = references.map((item) => `${item?.objectKind}/${item?.objectId}`);
  if (new Set(keys).size !== keys.length) return null;
  return {
    sessionId: value.sessionId,
    scope,
    userText: value.userText,
    model: value.model,
    expectedProfileId: value.expectedProfileId,
    references: references as AssistantChatReference[],
  };
}

export function parseSendRequest(value: unknown): AssistantChatSendRequest | null {
  if (
    !record(value) ||
    !exact(value, ["previewId", "operationId", "inputHash", "expectedProfileId"]) ||
    !match(value.previewId, UUID) ||
    !match(value.operationId, UUID) ||
    !match(value.inputHash, HASH) ||
    !match(value.expectedProfileId, UUID)
  )
    return null;
  return {
    previewId: value.previewId,
    operationId: value.operationId,
    inputHash: value.inputHash,
    expectedProfileId: value.expectedProfileId,
  };
}

export function parseOperationQuery(value: unknown): AssistantChatOperationQuery | null {
  if (
    !record(value) ||
    !exact(value, ["operationId", "expectedProfileId", "scope"]) ||
    !match(value.operationId, UUID) ||
    !match(value.expectedProfileId, UUID)
  )
    return null;
  const scope = parseScope(value.scope);
  return scope
    ? { operationId: value.operationId, expectedProfileId: value.expectedProfileId, scope }
    : null;
}

export function parsePendingQuery(value: unknown): AssistantChatPendingQuery | null {
  if (
    !record(value) ||
    !exact(value, ["scope", "expectedProfileId"]) ||
    !match(value.expectedProfileId, UUID)
  )
    return null;
  const scope = parseScope(value.scope);
  return scope ? { scope, expectedProfileId: value.expectedProfileId } : null;
}

export const validPreviewId = (value: unknown): value is string => match(value, UUID);
