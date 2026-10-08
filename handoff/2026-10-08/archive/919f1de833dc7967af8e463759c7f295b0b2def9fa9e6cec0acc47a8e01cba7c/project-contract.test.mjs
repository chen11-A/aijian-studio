import { afterEach, expect, test, vi } from "vitest";
import {
  updateManagedProject, readProjectUpdateJournal, readPendingProjectUpdate,
  closePendingProjectUpdate,
} from "@qa-project/adapters/projectManagement.ts";
import { createLocalApiClient } from "@qa-desktop/api-client.ts";
import { readFileSync } from "node:fs";

const id = "prj_" + "a".repeat(32);
const requestId = "88ed7974-adc3-4e35-a5c8-38b9674fc45c";
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
function project(changes = {}) {
  return { id, name: "旧名", aspect_ratio: "9:16", target_duration_seconds: 60,
    source_language: "zh-CN", status: "active", revision: 1,
    created_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z",
    ...changes };
}
function response(data) { return { request_id: requestId, data }; }
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key) => values.has(key) ? values.get(key) : null),
    setItem: vi.fn((key, value) => { values.set(key, value); }),
    removeItem: vi.fn((key) => { values.delete(key); }),
  };
}
function gateway(result, current) {
  return { updateProject: vi.fn(async () => result), getProject: vi.fn(async () => response(current)) };
}
function jsonReply(body, status, headers = {}) {
  return new Response(JSON.stringify(body), { status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId, ...headers } });
}
afterEach(() => vi.unstubAllGlobals());

test("generated contract adds PATCH and preserves SUB2API and existing operation IDs", () => {
  const api = JSON.parse(readFileSync(
    "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923/packages/contracts/openapi.json", "utf8"));
  const patch = api.paths["/api/v1/projects/{project_id}"].patch;
  expect(patch.operationId).toBe("updateProject");
  expect(patch.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/UpdateProjectRequest");
  expect(Object.keys(patch.responses).sort()).toEqual(["200","401","403","404","409","412","422","428"]);
  expect(api.paths["/api/v1/projects/{project_id}/remote-source-extract-runs"].post.operationId)
    .toBe("createRemoteSourceExtractRun");
  expect(api.paths["/api/v1/projects/{project_id}/fake-timeline-runs/operations/{operation_id}"].get.operationId)
    .toBe("getFakeTimelineRunOperation");
});

test("adapter applies a rename only after matching receipt and authoritative GET, then archives and restores", async () => {
  vi.stubGlobal("crypto", { randomUUID: () => requestId });
  const store = storage();
  const renamed = project({ name: "新名", revision: 2 });
  const first = gateway({ kind: "SUCCEEDED", receipt: response(renamed) }, renamed);
  const rename = await updateManagedProject(first, store, id, { expectedRevision: 1, name: "新名" });
  expect(rename).toEqual({ kind: "APPLIED", project: renamed });
  expect(first.updateProject).toHaveBeenCalledOnce();
  expect(first.getProject).toHaveBeenCalledWith(id);
  expect(readProjectUpdateJournal(store, id)).toEqual({ kind: "EMPTY" });
  const archived = project({ name: "新名", status: "archived", revision: 3 });
  const second = gateway({ kind: "SUCCEEDED", receipt: response(archived) }, archived);
  expect(await updateManagedProject(second, store, id, { expectedRevision: 2, status: "archived" }))
    .toEqual({ kind: "APPLIED", project: archived });
  const restored = project({ name: "新名", status: "active", revision: 4 });
  const third = gateway({ kind: "SUCCEEDED", receipt: response(restored) }, restored);
  expect(await updateManagedProject(third, store, id, { expectedRevision: 3, status: "active" }))
    .toEqual({ kind: "APPLIED", project: restored });
});

test("412 reads the authoritative project and reports rejection without false save", async () => {
  vi.stubGlobal("crypto", { randomUUID: () => requestId });
  const store = storage();
  const current = project({ name: "别人修改", revision: 2 });
  const remote = gateway({ kind: "DEFINITE_SERVER_ERROR", status: 412,
    code: "PROJECT_PRECONDITION_FAILED", request_id: requestId }, current);
  const outcome = await updateManagedProject(remote, store, id, { expectedRevision: 1, name: "我想修改" });
  expect(outcome).toEqual({ kind: "REJECTED", project: current,
    status: 412, code: "PROJECT_PRECONDITION_FAILED" });
  expect(remote.getProject).toHaveBeenCalledWith(id);
  expect(remote.updateProject).toHaveBeenCalledOnce();
  expect(readProjectUpdateJournal(store, id)).toEqual({ kind: "EMPTY" });
});

test("5xx or network UNKNOWN stays locked and reconciliation performs GET only", async () => {
  vi.stubGlobal("crypto", { randomUUID: () => requestId });
  for (const failure of [{ kind: "REMOTE_UNKNOWN" }, new Error("network")]) {
    const store = storage();
    const current = project({ name: "目标", revision: 2 });
    const remote = gateway(failure, current);
    if (failure instanceof Error) remote.updateProject.mockRejectedValue(failure);
    const outcome = await updateManagedProject(remote, store, id, { expectedRevision: 1, name: "目标" });
    expect(outcome).toEqual({ kind: "UNKNOWN", current, targetReached: true });
    expect(readProjectUpdateJournal(store, id).kind).toBe("PENDING");
    expect(await readPendingProjectUpdate(remote, store, id))
      .toEqual({ kind: "CURRENT", project: current, targetReached: true });
    expect(remote.updateProject).toHaveBeenCalledTimes(1);
    expect(remote.getProject).toHaveBeenCalledTimes(2);
    expect(await closePendingProjectUpdate(remote, store, id))
      .toEqual({ kind: "CURRENT", project: current, targetReached: true });
    expect(readProjectUpdateJournal(store, id)).toEqual({ kind: "EMPTY" });
    expect(remote.updateProject).toHaveBeenCalledTimes(1);
  }
});

test("corrupt journal or unavailable storage blocks PATCH", async () => {
  vi.stubGlobal("crypto", { randomUUID: () => requestId });
  const corrupt = storage({ ["aivora.project-update.v1." + id]: "not-json" });
  const remote = gateway({ kind: "REMOTE_UNKNOWN" }, project());
  expect((await updateManagedProject(remote, corrupt, id, { expectedRevision: 1, name: "新名" })).kind)
    .toBe("UNAVAILABLE");
  expect(remote.updateProject).not.toHaveBeenCalled();
  const broken = { getItem: () => { throw Error("storage denied"); }, setItem: vi.fn(), removeItem: vi.fn() };
  expect((await updateManagedProject(remote, broken, id, { expectedRevision: 1, name: "新名" })).kind)
    .toBe("UNAVAILABLE");
  expect(remote.updateProject).not.toHaveBeenCalled();
});

test("desktop PATCH sends If-Match and accepts exact 200 receipt", async () => {
  const changed = project({ name: "新名", revision: 2 });
  const fetcher = vi.fn(async () => jsonReply(response(changed), 200, { ETag: '"revision-2"' }));
  const result = await createLocalApiClient(fetcher, session)
    .updateProject(id, { expectedRevision: 1, name: "新名" });
  expect(result).toEqual({ kind: "SUCCEEDED", receipt: response(changed) });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(session.origin + "/api/v1/projects/" + id);
  expect(fetcher.mock.calls[0][1].method).toBe("PATCH");
  expect(fetcher.mock.calls[0][1].headers["If-Match"]).toBe('"revision-1"');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ name: "新名" });
});

test("desktop classifies exact 412, while 5xx and network stay UNKNOWN with one PATCH", async () => {
  const error = { request_id: requestId,
    error: { code: "PROJECT_PRECONDITION_FAILED", message: "stale",
      retryable: false, details: {} } };
  const stale = vi.fn(async () => jsonReply(error, 412));
  expect(await createLocalApiClient(stale, session).updateProject(id, { expectedRevision: 1, status: "archived" }))
    .toEqual({ kind: "DEFINITE_SERVER_ERROR", status: 412,
      code: "PROJECT_PRECONDITION_FAILED", request_id: requestId });
  expect(stale).toHaveBeenCalledOnce();
  const server = vi.fn(async () => jsonReply({}, 503));
  expect(await createLocalApiClient(server, session).updateProject(id, { expectedRevision: 1, name: "新名" }))
    .toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(server).toHaveBeenCalledOnce();
  const network = vi.fn(async () => { throw Error("offline"); });
  expect(await createLocalApiClient(network, session).updateProject(id, { expectedRevision: 1, name: "新名" }))
    .toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(network).toHaveBeenCalledOnce();
});
