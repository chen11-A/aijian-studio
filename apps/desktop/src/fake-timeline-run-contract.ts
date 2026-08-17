import type { components } from "@aijian/contracts";

import { hasOnlyKeys, isRecord } from "./api-contract-guards";

export type FakeTimelineRunCreateInput = components["schemas"]["CreateFakeTimelineRunRequest"];
export type FakeTimelineRunResponse = components["schemas"]["FakeTimelineRunResponse"];
export type FakeTimelineRunCreateCommand = {
  operation_id: string;
  input: FakeTimelineRunCreateInput;
};
export type FakeTimelineRunCreateResult =
  | { kind: "SUCCEEDED"; receipt: FakeTimelineRunResponse; replayed: boolean }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
const SOURCE_ID = /^src_[0-9a-f]{32}$/;
const WORKFLOW_RUN_ID = /^wfr_[0-9a-f]{32}$/;
const NODE_RUN_ID = /^node_[0-9a-f]{32}$/;
const ATTEMPT_ID = /^att_[0-9a-f]{32}$/;
const TASK_ID = /^task_[0-9a-f]{32}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const FAKE_TIMELINE_CAPABILITY_LOSSES = [
  "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
  "STATIC_FRAME_NO_MOTION_GENERATION",
  "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
] as const;

const RESPONSE_DATA_KEYS = [
  "project_id",
  "source_manifest_version_id",
  "source_document_id",
  "workflow_run_id",
  "node_run_id",
  "attempt_id",
  "task_id",
  "attempt_status",
  "task_status",
  "capability_losses",
] as const;

const LEGAL_REPLAY_STATUS_PAIRS = new Set([
  "READY\0READY",
  "LEASED\0LEASED",
  "RUNNING\0LEASED",
  "SUCCEEDED\0COMPLETED",
  "FAILED\0COMPLETED",
  "CANCELLED\0CANCELLED",
]);

const SENSITIVE_KEY_SUFFIXES = [
  "apikey",
  "accesstoken",
  "refreshtoken",
  "privatekey",
  "signingkey",
  "password",
  "passwd",
  "secret",
  "cookie",
  "authorization",
  "credential",
  "credentials",
  "bearer",
  "auth",
  "token",
] as const;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function hasSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (
      SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) || hasSensitiveKey(child)
    );
  });
}

function isCapabilityLosses(
  value: unknown,
): value is [
  "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
  "STATIC_FRAME_NO_MOTION_GENERATION",
  "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
] {
  return (
    Array.isArray(value) &&
    value.length === FAKE_TIMELINE_CAPABILITY_LOSSES.length &&
    FAKE_TIMELINE_CAPABILITY_LOSSES.every((loss, index) => value[index] === loss)
  );
}

export function fakeTimelineRunIdempotencyKey(command: FakeTimelineRunCreateCommand): string {
  return `fake-timeline-run:create:v1:${command.operation_id}`;
}

export function isFakeTimelineRunCreateCommand(
  value: unknown,
): value is FakeTimelineRunCreateCommand {
  if (!isRecord(value) || !hasExactKeys(value, ["operation_id", "input"])) return false;
  if (typeof value.operation_id !== "string" || !OPERATION_ID.test(value.operation_id)) {
    return false;
  }
  const input = value.input;
  return (
    isRecord(input) &&
    hasExactKeys(input, ["source_manifest_version_id", "source_document_id"]) &&
    typeof input.source_manifest_version_id === "string" &&
    VERSION_ID.test(input.source_manifest_version_id) &&
    typeof input.source_document_id === "string" &&
    SOURCE_ID.test(input.source_document_id)
  );
}

export function isFakeTimelineRunResponse(
  value: unknown,
  projectId: string,
  command: FakeTimelineRunCreateCommand,
  fresh: boolean,
): value is FakeTimelineRunResponse {
  if (
    !PROJECT_ID.test(projectId) ||
    !isFakeTimelineRunCreateCommand(command) ||
    !isRecord(value) ||
    !hasExactKeys(value, ["data", "request_id"]) ||
    typeof value.request_id !== "string" ||
    !REQUEST_ID.test(value.request_id) ||
    hasSensitiveKey(value)
  ) {
    return false;
  }
  const data = value.data;
  if (
    !isRecord(data) ||
    !hasExactKeys(data, RESPONSE_DATA_KEYS) ||
    data.project_id !== projectId ||
    typeof data.workflow_run_id !== "string" ||
    !WORKFLOW_RUN_ID.test(data.workflow_run_id) ||
    typeof data.node_run_id !== "string" ||
    !NODE_RUN_ID.test(data.node_run_id) ||
    typeof data.attempt_id !== "string" ||
    !ATTEMPT_ID.test(data.attempt_id) ||
    typeof data.task_id !== "string" ||
    !TASK_ID.test(data.task_id) ||
    data.source_manifest_version_id !== command.input.source_manifest_version_id ||
    data.source_document_id !== command.input.source_document_id ||
    !isCapabilityLosses(data.capability_losses)
  ) {
    return false;
  }
  if (fresh) {
    return data.attempt_status === "READY" && data.task_status === "READY";
  }
  return LEGAL_REPLAY_STATUS_PAIRS.has(
    `${String(data.attempt_status)}\0${String(data.task_status)}`,
  );
}
