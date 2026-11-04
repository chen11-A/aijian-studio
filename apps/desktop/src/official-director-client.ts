import type {
  OfficialDirectorAdopt,
  OfficialDirectorCompletion,
  OfficialDirectorFailure,
  OfficialDirectorList,
  OfficialDirectorOperation,
  OfficialDirectorPrepare,
  OfficialDirectorPrepared,
  OfficialDirectorRead,
  OfficialDirectorReject,
  OfficialDirectorReserve,
} from "@aijian/contracts/official-director";
import {
  canonical,
  episodeId,
  exact,
  operationId,
  projectId,
  record,
  validAdopt,
  validOperation,
  validPrepared,
  validReject,
} from "./official-director-contract";
import { hasRequestId } from "./api-contract-guards";

type Http = (
  path: string,
  init: RequestInit,
) => Promise<{
  status: number;
  payload: unknown;
  requestId: string | null;
} | null>;
export type OfficialDirectorMutation =
  { kind: "OK"; operation: OfficialDirectorOperation; replayed: boolean } | OfficialDirectorFailure;
/** Main-process-only persistence methods. No completion/reservation/preparation IPC exists. */
export type OfficialDirectorPersistenceClient = {
  listOfficialDirector(project: string, episode: string): Promise<OfficialDirectorList>;
  getOfficialDirector(
    project: string,
    episode: string,
    operation: string,
  ): Promise<OfficialDirectorRead>;
  prepareOfficialDirector(
    project: string,
    episode: string,
    input: OfficialDirectorPrepare,
  ): Promise<{ kind: "OK"; request: OfficialDirectorPrepared } | OfficialDirectorFailure>;
  reserveOfficialDirector(
    project: string,
    episode: string,
    input: OfficialDirectorReserve,
  ): Promise<OfficialDirectorMutation>;
  completeOfficialDirector(
    project: string,
    episode: string,
    input: OfficialDirectorCompletion,
  ): Promise<OfficialDirectorMutation>;
  markOfficialDirectorNotSent(
    project: string,
    episode: string,
    operation: string,
    code: string,
  ): Promise<OfficialDirectorMutation>;
  adoptOfficialDirector(
    project: string,
    episode: string,
    operation: string,
    input: OfficialDirectorAdopt,
  ): Promise<OfficialDirectorMutation>;
  rejectOfficialDirector(
    project: string,
    episode: string,
    operation: string,
    input: OfficialDirectorReject,
  ): Promise<OfficialDirectorMutation>;
};
const UNKNOWN = { kind: "UNKNOWN" } as const;
const envelope = (
  value: unknown,
  requestId: string | null,
  extraFields: readonly string[] = [],
): value is Record<string, unknown> =>
  exact(value, ["data", "request_id", ...extraFields]) &&
  hasRequestId(value) &&
  value.request_id === requestId;
const root = (project: string, episode: string): string => {
  if (!projectId(project) || !episodeId(episode))
    throw new Error("Invalid official director scope");
  return `/api/v1/projects/${project}/episodes/${episode}/official-director`;
};
const pathFor = (project: string, episode: string, operation: string): string => {
  if (!operationId(operation)) throw new Error("Invalid official director operation");
  return `${root(project, episode)}/${operation}`;
};
function failure(
  status: number,
  payload: unknown,
  requestId: string | null,
): OfficialDirectorFailure {
  return [401, 403, 404, 409, 413, 422, 428].includes(status) &&
    exact(payload, ["error", "request_id"]) &&
    hasRequestId(payload) &&
    payload.request_id === requestId &&
    record(payload.error) &&
    typeof payload.error.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(payload.error.code)
    ? { kind: "ERROR", code: payload.error.code }
    : UNKNOWN;
}
export function createOfficialDirectorClient(
  http: Http,
  headers: Record<string, string>,
): OfficialDirectorPersistenceClient {
  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  async function request<T>(
    path: string,
    init: RequestInit,
    valid: (body: unknown, envelope: Record<string, unknown>) => T | null,
    extraFields: readonly string[] = [],
  ): Promise<T | OfficialDirectorFailure> {
    // Exactly one request; ambiguity is resolved only by explicit read, never a write retry.
    try {
      const response = await http(path, init);
      if (!response) return UNKNOWN;
      if (response.status !== 200)
        return failure(response.status, response.payload, response.requestId);
      return envelope(response.payload, response.requestId, extraFields)
        ? (valid(response.payload.data, response.payload) ?? UNKNOWN)
        : UNKNOWN;
    } catch {
      return UNKNOWN;
    }
  }
  const mutate = (
    project: string,
    episode: string,
    operation: string,
    path: string,
    body: unknown,
  ): Promise<OfficialDirectorMutation> =>
    request(path, post(body), (data) =>
      exact(data, ["operation", "replayed"]) &&
      typeof data.replayed === "boolean" &&
      validOperation(data.operation, project, episode, operation)
        ? { kind: "OK", operation: data.operation, replayed: data.replayed }
        : null,
    );
  return {
    listOfficialDirector: (project, episode) =>
      request(
        root(project, episode),
        { headers },
        (data, payload) =>
          Array.isArray(data) &&
          data.length <= 20 &&
          typeof payload.has_more === "boolean" &&
          data.every((operation) => validOperation(operation, project, episode)) &&
          new Set(data.map((operation) => operation.request.operation_id)).size === data.length
            ? { kind: "OK", operations: data, hasMore: payload.has_more }
            : null,
        ["has_more"],
      ),
    getOfficialDirector: (project, episode, operation) =>
      request(pathFor(project, episode, operation), { headers }, (data) =>
        validOperation(data, project, episode, operation) ? { kind: "OK", operation: data } : null,
      ),
    prepareOfficialDirector: (project, episode, input) =>
      request(`${root(project, episode)}/preparation`, post(input), (data) =>
        exact(data, ["request"]) &&
        validPrepared(data.request) &&
        data.request.script_stored_content.project_id === project &&
        data.request.script_stored_content.episode_id === episode &&
        Object.entries(input).every(
          ([key, value]) =>
            validPrepared(data.request) &&
            canonical(data.request[key as keyof OfficialDirectorPrepared]) === canonical(value),
        )
          ? { kind: "OK", request: data.request }
          : null,
      ),
    reserveOfficialDirector: (project, episode, input) =>
      mutate(project, episode, input.operation_id, root(project, episode), input),
    completeOfficialDirector: (project, episode, input) =>
      mutate(
        project,
        episode,
        input.operation_id,
        `${pathFor(project, episode, input.operation_id)}/completion`,
        input,
      ),
    markOfficialDirectorNotSent: (project, episode, operation, code) =>
      mutate(project, episode, operation, `${pathFor(project, episode, operation)}/not-sent`, {
        code,
      }),
    adoptOfficialDirector(project, episode, operation, input) {
      if (!validAdopt(input)) throw new Error("Invalid official director adoption");
      return mutate(
        project,
        episode,
        operation,
        `${pathFor(project, episode, operation)}/adoption`,
        input,
      );
    },
    rejectOfficialDirector(project, episode, operation, input) {
      if (!validReject(input)) throw new Error("Invalid official director rejection");
      return mutate(
        project,
        episode,
        operation,
        `${pathFor(project, episode, operation)}/rejection`,
        input,
      );
    },
  };
}
