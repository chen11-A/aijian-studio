import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import f from "../../../packages/contracts/fixtures/manual-media-candidate.json";
import { createManualMediaCandidateClient } from "./manual-media-candidate-client";
import { createAssemblyExactClient } from "./assembly-exact-client";
import { registerManualMediaCandidateHandlers } from "./manual-media-candidate-ipc";
import { registerAssemblyExactHandlers } from "./assembly-exact-ipc";
import {
  MANUAL_MEDIA_CANDIDATE_CHANNELS,
  type ManualMediaCandidateCommand,
} from "@aijian/contracts/manual-media-candidate";
import {
  ASSEMBLY_EXACT_CHANNELS,
  assemblyExactCommand,
  type AssemblyExactCommand,
} from "@aijian/contracts/assembly-exact";
import { mediaHash } from "@aijian/contracts/media-preparation";

const candidate = f.candidate_command as ManualMediaCandidateCommand;
const assembly = f.assembly_command as AssemblyExactCommand;
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown, status = 200) => ({
  status,
  payload: { data, request_id: f.request_id },
  requestId: f.request_id,
});
function family(
  kind: "candidate" | "assembly",
  http: Parameters<typeof createManualMediaCandidateClient>[0],
) {
  if (kind === "candidate") {
    const api = createManualMediaCandidateClient(http, {});
    return {
      save: () => api.saveManualMediaCandidate(f.project_id, f.episode_id, candidate),
      original: () => api.getManualMediaCandidateOperation(f.project_id, f.episode_id, candidate),
      command: candidate,
      operation: f.candidate_operation,
      reject: "MANUAL_MEDIA_CANDIDATE_INPUT_REJECTED",
    };
  }
  const api = createAssemblyExactClient(http, {});
  return {
    save: () => api.saveExact(f.project_id, f.episode_id, assembly),
    original: () => api.getOriginal(f.project_id, f.episode_id, assembly),
    command: assembly,
    operation: f.assembly_operation,
    reject: "ASSEMBLY_INPUT_REJECTED",
  };
}
test.each(["candidate", "assembly"] as const)(
  "%s sends exact original UUID/full payload and GET-only full hash",
  async (kind) => {
    const http = vi.fn(),
      api = family(kind, http);
    http.mockResolvedValue(response(api.operation, 201));
    expect((await api.save()).kind).toBe("FOUND");
    expect(http.mock.calls[0]![1].headers["Idempotency-Key"]).toBe(api.command.operation_id);
    expect(JSON.parse(http.mock.calls[0]![1].body)).toEqual(api.command.payload);
    http.mockResolvedValue(response(api.operation));
    expect((await api.original()).kind).toBe("FOUND");
    expect(http.mock.calls[1]![1].method).toBe("GET");
    const url = new URL(http.mock.calls[1]![0], "http://127.0.0.1");
    expect(url.pathname).toContain(api.command.operation_id);
    expect(url.searchParams.get("payload_hash")).toBe(await mediaHash(api.command.payload));
    expect(url.searchParams.size).toBe(1);
    expect(http).toHaveBeenCalledTimes(2);
  },
);
test.each(
  (["candidate", "assembly"] as const).flatMap((kind) =>
    ["header", "hash", "operation", "schema", "payload", "parent", "extra"].map(
      (fault) => [kind, fault] as const,
    ),
  ),
)("%s bad original %s stays UNKNOWN without POST", async (kind, fault) => {
  const http = vi.fn(),
    api = family(kind, http),
    data = structuredClone(api.operation);
  let header = f.request_id;
  if (fault === "header") header = "not-a-uuid";
  if (fault === "hash") data.version.content_hash = "sha256:" + "0".repeat(64);
  if (fault === "operation") data.operation_id = data.operation_id.toLowerCase();
  if (fault === "schema") data.version.content.schema_version = "0.9.0";
  if (fault === "payload") Object.assign(data.payload, { expected_revision: 999 });
  if (fault === "parent") data.version.parent_version_id = ("ver_" + "0".repeat(32)) as never;
  if (fault === "extra") Object.assign(data, { unexpected: true });
  http.mockResolvedValue({ ...response(data), requestId: header });
  expect(await api.original()).toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(http).toHaveBeenCalledOnce();
  expect(http.mock.calls[0]![1].method).toBe("GET");
});
test("immutable result_revision survives a newer current head but never equals it by inference", async () => {
  const data = structuredClone(f.assembly_operation),
    http = vi.fn();
  data.version.head_revision = 8;
  http.mockResolvedValue(response(data));
  const api = family("assembly", http);
  expect((await api.original()).kind).toBe("FOUND");
  data.result_revision = 8;
  expect((await api.original()).kind).toBe("REMOTE_UNKNOWN");
});
test.each(
  (["candidate", "assembly"] as const).flatMap((kind) =>
    ["array", "status", "code", "request", "retryable", "extra"].map(
      (fault) => [kind, fault] as const,
    ),
  ),
)("%s unattributed error %s preserves UNKNOWN", async (kind, fault) => {
  const http = vi.fn(),
    api = family(kind, http),
    error = { code: api.reject, message: "controlled", details: {}, retryable: false };
  const payload = { error, request_id: f.request_id };
  let status = 422;
  if (fault === "array") Object.assign(error, { details: [] });
  if (fault === "status") status = 500;
  if (fault === "code") error.code = "UNRELATED_CODE";
  if (fault === "request") payload.request_id = "11111111-1111-4111-8111-111111111111";
  if (fault === "retryable") error.retryable = true;
  if (fault === "extra") Object.assign(payload, { another: true });
  http.mockResolvedValue({ status, payload, requestId: f.request_id });
  expect(await api.save()).toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(http).toHaveBeenCalledOnce();
});
test.each(["candidate", "assembly"] as const)(
  "%s only closed exact rejection is definite; original 404 remains UNKNOWN",
  async (kind) => {
    const http = vi.fn(),
      api = family(kind, http);
    http.mockResolvedValue({
      status: 422,
      payload: {
        error: { code: api.reject, message: "controlled", details: {}, retryable: false },
        request_id: f.request_id,
      },
      requestId: f.request_id,
    });
    expect((await api.save()).kind).toBe("DEFINITE_SERVER_ERROR");
    http.mockResolvedValue({
      status: 404,
      payload: {
        error: { code: api.reject, message: "controlled", details: {}, retryable: false },
        request_id: f.request_id,
      },
      requestId: f.request_id,
    });
    expect((await api.original()).kind).toBe("REMOTE_UNKNOWN");
  },
);
test("candidate history and detail cannot substitute another episode or candidate version", async () => {
  const http = vi.fn().mockResolvedValue(response(f.candidate_page)),
    api = createManualMediaCandidateClient(http, {});
  expect((await api.listManualMediaCandidates(f.project_id, f.episode_id)).kind).toBe("FOUND");
  expect((await api.listManualMediaCandidates(f.project_id, "ep_" + "0".repeat(32))).kind).toBe(
    "REMOTE_UNKNOWN",
  );
  http.mockResolvedValue(response(f.candidate_operation.version));
  expect(
    (await api.getManualMediaCandidate(f.project_id, f.episode_id, "ver_" + "0".repeat(32))).kind,
  ).toBe("REMOTE_UNKNOWN");
});
test.each([true, 1.5, null, { nested: "value" }, [1], "x".repeat(33000)])(
  "typed asset metadata rejects unsupported or over-budget entry %#",
  async (value) => {
    const data = structuredClone(f.candidate_operation.version);
    Object.assign(data.content.asset_snapshot, { technical_metadata: { controlled: value } });
    data.content_hash = (await mediaHash(data.content))!;
    const http = vi.fn().mockResolvedValue(response(data));
    expect(
      (
        await createManualMediaCandidateClient(http, {}).getManualMediaCandidate(
          f.project_id,
          f.episode_id,
          data.version_id,
        )
      ).kind,
    ).toBe("REMOTE_UNKNOWN");
    expect(http).toHaveBeenCalledOnce();
  },
);
test("typed asset metadata accepts string/integer entries and rejects a lone surrogate key", async () => {
  const data = structuredClone(f.candidate_operation.version);
  Object.assign(data.content.asset_snapshot, { technical_metadata: { format: "PNG", width: 16 } });
  data.content_hash = (await mediaHash(data.content))!;
  const http = vi.fn().mockResolvedValue(response(data));
  const api = createManualMediaCandidateClient(http, {});
  expect(
    (await api.getManualMediaCandidate(f.project_id, f.episode_id, data.version_id)).kind,
  ).toBe("FOUND");
  Object.assign(data.content.asset_snapshot, { technical_metadata: { "\ud800": "invalid key" } });
  data.content_hash = (await mediaHash(data.content))!;
  expect(
    (await api.getManualMediaCandidate(f.project_id, f.episode_id, data.version_id)).kind,
  ).toBe("REMOTE_UNKNOWN");
});
test("explicit null manual provenance is rejected before I/O; legacy missing field remains valid", () => {
  const c = structuredClone(assembly),
    segment = c.payload.content.visual_segments[0]!;
  Object.assign(segment, { manual_candidate_ref: null });
  expect(assemblyExactCommand(c, f.project_id, f.episode_id)).toBe(false);
  delete segment.manual_candidate_ref;
  expect(assemblyExactCommand(c, f.project_id, f.episode_id)).toBe(true);
});
test.each(["candidate", "assembly"] as const)(
  "%s IPC enforces fixed top-frame/arity/scope/full command",
  async (kind) => {
    const http = vi.fn(),
      listeners = new Map<
        string,
        (event: { top: boolean }, ...args: unknown[]) => Promise<unknown>
      >();
    const handle = (c: string, h: (e: { top: boolean }, ...args: unknown[]) => Promise<unknown>) =>
      listeners.set(c, h);
    let channel: string, command: ManualMediaCandidateCommand | AssemblyExactCommand;
    if (kind === "candidate") {
      http.mockResolvedValue(response(f.candidate_operation));
      registerManualMediaCandidateHandlers(
        handle,
        () => createManualMediaCandidateClient(http, {}),
        (e) => e.top,
      );
      channel = MANUAL_MEDIA_CANDIDATE_CHANNELS.original;
      command = candidate;
    } else {
      http.mockResolvedValue(response(f.assembly_operation));
      registerAssemblyExactHandlers(
        handle,
        () => createAssemblyExactClient(http, {}),
        (e) => e.top,
      );
      channel = ASSEMBLY_EXACT_CHANNELS.original;
      command = assembly;
    }
    const original = listeners.get(channel)!;
    await expect(original({ top: false }, f.project_id, f.episode_id, command)).rejects.toThrow(
      "frame",
    );
    await expect(
      original({ top: true }, f.project_id, f.episode_id, command, "extra"),
    ).rejects.toThrow();
    await expect(
      original({ top: true }, f.project_id, "ep_" + "0".repeat(32), command),
    ).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
    expect(
      ((await original({ top: true }, f.project_id, f.episode_id, command)) as { kind: string })
        .kind,
    ).toBe("FOUND");
    expect(http.mock.calls[0]![1].method).toBe("GET");
  },
);
