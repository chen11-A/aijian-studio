import type { components } from "@aijian/contracts";

import {
  hasOnlyKeys,
  hasRequestId,
  isIdArray,
  isNullableId,
  isNullableString,
  isRecord,
} from "./api-contract-guards";

export type TaskQueueResponse = components["schemas"]["TaskQueueResponse"];

const WORKFLOW_RUN_ID_PATTERN = /^wfr_[0-9a-f]{32}$/;
const NODE_RUN_ID_PATTERN = /^node_[0-9a-f]{32}$/;
const ATTEMPT_ID_PATTERN = /^att_[0-9a-f]{32}$/;
const TASK_ID_PATTERN = /^task_[0-9a-f]{32}$/;
const PROPOSAL_ID_PATTERN = /^prp_[0-9a-f]{32}$/;
const VERSION_ID_PATTERN = /^ver_[0-9a-f]{32}$/;
const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isTaskNode(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "workflow_run_id",
      "node_run_id",
      "node_key",
      "node_type",
      "status",
      "responsible_role",
      "upstream_gate",
      "input_hash",
      "input_version_ids",
      "output_version_id",
      "attempt_count",
      "max_attempts",
      "updated_at",
    ]) &&
    typeof value.workflow_run_id === "string" &&
    WORKFLOW_RUN_ID_PATTERN.test(value.workflow_run_id) &&
    typeof value.node_run_id === "string" &&
    NODE_RUN_ID_PATTERN.test(value.node_run_id) &&
    typeof value.node_key === "string" &&
    typeof value.node_type === "string" &&
    [
      "BLOCKED",
      "PENDING",
      "RUNNING",
      "RECONCILIATION_REQUIRED",
      "NEEDS_REVIEW",
      "SUCCEEDED",
      "FAILED",
      "CANCEL_REQUESTED",
      "CANCELLED",
      "SUPERSEDED",
    ].includes(String(value.status)) &&
    typeof value.responsible_role === "string" &&
    isNullableString(value.upstream_gate) &&
    typeof value.input_hash === "string" &&
    CONTENT_HASH_PATTERN.test(value.input_hash) &&
    isIdArray(value.input_version_ids, VERSION_ID_PATTERN) &&
    isNullableId(value.output_version_id, VERSION_ID_PATTERN) &&
    Number.isInteger(value.attempt_count) &&
    Number(value.attempt_count) >= 0 &&
    Number.isInteger(value.max_attempts) &&
    Number(value.max_attempts) >= 1 &&
    typeof value.updated_at === "string"
  );
}

function isTaskAttempt(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "attempt_id",
      "number",
      "execution_mode",
      "status",
      "provider_model",
      "provider_job_id",
      "retry_disposition",
      "error_code",
      "output_version_id",
      "started_at",
      "finished_at",
      "updated_at",
    ]) &&
    typeof value.attempt_id === "string" &&
    ATTEMPT_ID_PATTERN.test(value.attempt_id) &&
    Number.isInteger(value.number) &&
    Number(value.number) >= 1 &&
    ["local", "remote"].includes(String(value.execution_mode)) &&
    [
      "READY",
      "LEASED",
      "RUNNING",
      "SUBMIT_INTENT",
      "SUBMITTING",
      "WAITING_REMOTE",
      "REMOTE_UNKNOWN",
      "SUCCEEDED",
      "FAILED",
      "CANCEL_REQUESTED",
      "CANCELLED",
      "NOT_SUBMITTED",
    ].includes(String(value.status)) &&
    isNullableString(value.provider_model) &&
    isNullableString(value.provider_job_id) &&
    (value.retry_disposition === null ||
      [
        "SAFE_LOCAL_RETRY",
        "PROVIDER_CONFIRMED_NOT_ACCEPTED",
        "NON_RETRYABLE",
        "REMOTE_UNKNOWN",
      ].includes(String(value.retry_disposition))) &&
    isNullableString(value.error_code) &&
    isNullableId(value.output_version_id, VERSION_ID_PATTERN) &&
    isNullableString(value.started_at) &&
    isNullableString(value.finished_at) &&
    typeof value.updated_at === "string"
  );
}

function isTaskLedger(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "task_id",
      "kind",
      "status",
      "priority",
      "available_at",
      "lease_generation",
      "lease_expires_at",
      "heartbeat_at",
      "updated_at",
    ]) &&
    typeof value.task_id === "string" &&
    TASK_ID_PATTERN.test(value.task_id) &&
    typeof value.kind === "string" &&
    ["READY", "LEASED", "COMPLETED", "CANCELLED"].includes(String(value.status)) &&
    Number.isInteger(value.priority) &&
    Number(value.priority) >= 0 &&
    Number(value.priority) <= 100 &&
    typeof value.available_at === "string" &&
    Number.isInteger(value.lease_generation) &&
    Number(value.lease_generation) >= 0 &&
    isNullableString(value.lease_expires_at) &&
    isNullableString(value.heartbeat_at) &&
    typeof value.updated_at === "string"
  );
}

function isTaskQueueItem(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["proposal_id", "node", "attempt", "task", "cost", "presentation"])
  ) {
    return false;
  }
  const { cost, presentation } = value;
  return (
    isNullableId(value.proposal_id, PROPOSAL_ID_PATTERN) &&
    isTaskNode(value.node) &&
    isTaskAttempt(value.attempt) &&
    isTaskLedger(value.task) &&
    isRecord(cost) &&
    hasOnlyKeys(cost, [
      "status",
      "currency",
      "reserved",
      "accrued",
      "billed",
      "budget_limit",
      "retry_increment_limit",
    ]) &&
    cost.status === "NOT_RECORDED" &&
    [
      cost.currency,
      cost.reserved,
      cost.accrued,
      cost.billed,
      cost.budget_limit,
      cost.retry_increment_limit,
    ].every(isNullableString) &&
    isRecord(presentation) &&
    hasOnlyKeys(presentation, ["status_label", "next_action_label", "allowed_actions"]) &&
    typeof presentation.status_label === "string" &&
    typeof presentation.next_action_label === "string" &&
    Array.isArray(presentation.allowed_actions) &&
    presentation.allowed_actions.every((action) => action === "VIEW_DETAILS")
  );
}

export function isTaskQueueResponse(
  value: unknown,
  expectedProjectId: string,
): value is TaskQueueResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["project_id", "summary", "tasks"])
  ) {
    return false;
  }
  const data = value.data;
  if (
    data.project_id !== expectedProjectId ||
    !isRecord(data.summary) ||
    !hasOnlyKeys(data.summary, ["total", "attention", "active", "completed"])
  ) {
    return false;
  }
  const summary = data.summary;
  return (
    ["total", "attention", "active", "completed"].every(
      (key) => Number.isInteger(summary[key]) && Number(summary[key]) >= 0,
    ) &&
    Array.isArray(data.tasks) &&
    data.tasks.every(isTaskQueueItem) &&
    summary.total === data.tasks.length
  );
}
