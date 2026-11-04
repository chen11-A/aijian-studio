import {
  contentHash,
  episodeId,
  exact,
  operationId,
  projectId,
  record,
  validAdopt,
  validOperation,
} from "./official-text-contract";
import type {
  OfficialTextAdopt,
  OfficialTextCompletion,
  OfficialTextFailure,
  OfficialTextList,
  OfficialTextOperation,
  OfficialTextRead,
  OfficialTextReserve,
} from "@aijian/contracts/official-text";

type Http = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;
export type OfficialTextMutation =
  { kind: "OK"; operation: OfficialTextOperation; replayed: boolean } | OfficialTextFailure;
/** These mutators stay main-only; preload exposes no reserve/complete/notSent IPC. */
export type OfficialTextPersistenceClient = {
  listOfficialText(project: string, episode: string): Promise<OfficialTextList>;
  getOfficialText(project: string, episode: string, operation: string): Promise<OfficialTextRead>;
  reserveOfficialText(
    project: string,
    episode: string,
    input: OfficialTextReserve,
  ): Promise<OfficialTextMutation>;
  completeOfficialText(
    project: string,
    episode: string,
    input: OfficialTextCompletion,
  ): Promise<OfficialTextMutation>;
  markOfficialTextNotSent(
    project: string,
    episode: string,
    operation: string,
    code: string,
  ): Promise<OfficialTextMutation>;
  adoptOfficialText(
    project: string,
    episode: string,
    operation: string,
    input: OfficialTextAdopt,
  ): Promise<OfficialTextMutation>;
};
const UNKNOWN = { kind: "UNKNOWN" } as const;
function root(project: string, episode: string): string {
  if (!projectId(project) || !episodeId(episode)) throw new Error("Invalid official text scope");
  return `/api/v1/projects/${project}/episodes/${episode}/official-text`;
}
function pathFor(project: string, episode: string, operation: string): string {
  if (!operationId(operation)) throw new Error("Invalid official text operation");
  return `${root(project, episode)}/${operation}`;
}
function envelope(value: unknown, requestId: string | null): value is Record<string, unknown> {
  return (
    !!requestId &&
    /^[0-9a-f-]{36}$/i.test(requestId) &&
    record(value) &&
    value.request_id === requestId
  );
}
function failure(status: number, payload: unknown, requestId: string | null): OfficialTextFailure {
  return [401, 403, 404, 409, 413, 422, 500].includes(status) &&
    envelope(payload, requestId) &&
    exact(payload, ["error", "request_id"]) &&
    record(payload.error) &&
    typeof payload.error.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(payload.error.code)
    ? { kind: "ERROR", code: payload.error.code }
    : UNKNOWN;
}
export function createOfficialTextClient(
  http: Http,
  headers: Record<string, string>,
): OfficialTextPersistenceClient {
  async function mutate(
    project: string,
    episode: string,
    operation: string,
    path: string,
    body: unknown,
  ): Promise<OfficialTextMutation> {
    const response = await http(path, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response) return UNKNOWN;
    const { status, payload, requestId } = response;
    if (status !== 200) return failure(status, payload, requestId);
    return envelope(payload, requestId) &&
      exact(payload, ["data", "request_id"]) &&
      exact(payload.data, ["operation", "replayed"]) &&
      typeof payload.data.replayed === "boolean" &&
      validOperation(payload.data.operation, project, episode, operation)
      ? { kind: "OK", operation: payload.data.operation, replayed: payload.data.replayed }
      : UNKNOWN;
  }
  return {
    async listOfficialText(project, episode) {
      const response = await http(root(project, episode), { headers });
      if (!response) return UNKNOWN;
      const { status, payload, requestId } = response;
      if (status !== 200) return failure(status, payload, requestId);
      if (
        !envelope(payload, requestId) ||
        !exact(payload, ["data", "request_id"]) ||
        !Array.isArray(payload.data) ||
        payload.data.length > 10 ||
        !payload.data.every((value) => validOperation(value, project, episode))
      )
        return UNKNOWN;
      const operations = payload.data as OfficialTextOperation[];
      return new Set(operations.map((operation) => operation.request.operation_id)).size ===
        operations.length
        ? { kind: "OK", operations }
        : UNKNOWN;
    },
    async getOfficialText(project, episode, operation) {
      const response = await http(pathFor(project, episode, operation), { headers });
      if (!response) return UNKNOWN;
      const { status, payload, requestId } = response;
      if (status !== 200) return failure(status, payload, requestId);
      return envelope(payload, requestId) &&
        exact(payload, ["data", "request_id"]) &&
        validOperation(payload.data, project, episode, operation)
        ? { kind: "OK", operation: payload.data }
        : UNKNOWN;
    },
    reserveOfficialText(project, episode, input) {
      if (
        !operationId(input.operation_id) ||
        !operationId(input.profile_id) ||
        !contentHash(input.request_hash)
      )
        throw new Error("Invalid official text reservation");
      return mutate(project, episode, input.operation_id, root(project, episode), input);
    },
    completeOfficialText(project, episode, input) {
      return mutate(
        project,
        episode,
        input.operation_id,
        `${pathFor(project, episode, input.operation_id)}/completion`,
        input,
      );
    },
    markOfficialTextNotSent(project, episode, operation, code) {
      if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(code))
        throw new Error("Invalid official text failure code");
      return mutate(
        project,
        episode,
        operation,
        `${pathFor(project, episode, operation)}/not-sent`,
        { code },
      );
    },
    adoptOfficialText(project, episode, operation, input) {
      if (!validAdopt(input)) throw new Error("Invalid official text adoption");
      return mutate(
        project,
        episode,
        operation,
        `${pathFor(project, episode, operation)}/adoption`,
        input,
      );
    },
  };
}
