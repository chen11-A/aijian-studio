import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import {
  DRAFT_EXPORT_CHANNELS,
  isDraftExportCommand,
  isDraftExportJob,
  type DraftExportCommand,
  type DraftExportJob,
} from "./draft-export-contract";
import { registerDraftExportHandlers, type DraftExportClient } from "./draft-export-ipc";
const project = `prj_${"a".repeat(32)}`,
  episode = `ep_${"b".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000001";
const command: DraftExportCommand = {
  operation_id: `dmp_${"c".repeat(32)}`,
  assembly_version_id: `ver_${"d".repeat(32)}`,
  assembly_content_hash: `sha256:${"e".repeat(64)}`,
  rights_declaration: "OWNED_OR_SYNTHETIC",
};
const job: DraftExportJob = {
  ...command,
  project_id: project,
  episode_id: episode,
  status: "QUEUED",
  progress_frames: 0,
  total_frames: 50,
  output_filename: "local-DRAFT.mp4",
  output_path: null,
  output_sha256: null,
  output_bytes: null,
  error_code: null,
  error_message: null,
  created_at: "2026-10-08T00:00:00+00:00",
  updated_at: "2026-10-08T00:00:00+00:00",
  toolchain_profile_id: "test-pinned",
  draft: true,
};
const receipt = { data: job, request_id: requestId };
function response(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
  });
}
function setup(
  selectOutput = vi.fn<() => Promise<string | null>>().mockResolvedValue("/tmp/local-DRAFT.mp4"),
) {
  const client: DraftExportClient = {
    listDraftExports: vi.fn(),
    getDraftExport: vi.fn(),
    cancelDraftExport: vi.fn(),
    createDraftExport: vi.fn().mockResolvedValue({ kind: "FOUND", receipt }),
  };
  const handlers = new Map<
    string,
    (event: { top: boolean }, ...args: unknown[]) => Promise<unknown>
  >();
  registerDraftExportHandlers<{ top: boolean }>(
    (name, fn) => handlers.set(name, fn),
    () => client,
    (event) => event.top,
    selectOutput,
  );
  const invoke = (action: keyof typeof DRAFT_EXPORT_CHANNELS, ...args: unknown[]) =>
    handlers.get(DRAFT_EXPORT_CHANNELS[action])!({ top: true }, project, episode, ...args);
  return { client, handlers, selectOutput, invoke };
}
describe("DRAFT MP4 native boundary", () => {
  it("accepts only a path-free canonical renderer command", () => {
    expect(isDraftExportCommand(command)).toBe(true);
    for (const bad of [
      { ...command, output_path: "/tmp/injected.mp4" },
      { ...command, operation_id: "../../escape" },
      { ...command, rights_declaration: "CLEARED" },
      { ...command, assembly_content_hash: "bad" },
    ])
      expect(isDraftExportCommand(bad)).toBe(false);
    expect(isDraftExportJob(job, project, episode)).toBe(true);
    expect(isDraftExportJob({ ...job, output_path: "/tmp/unverified.mp4" }, project, episode)).toBe(
      false,
    );
    expect(isDraftExportJob({ ...job, status: "SUCCEEDED" }, project, episode)).toBe(false);
    const success = {
      ...job,
      status: "SUCCEEDED",
      progress_frames: 50,
      output_path: "/tmp/local-DRAFT.mp4",
      output_sha256: "f".repeat(64),
      output_bytes: 256,
    };
    expect(isDraftExportJob(success, project, episode)).toBe(true);
    expect(isDraftExportJob({ ...success, progress_frames: 49 }, project, episode)).toBe(false);
    expect(
      isDraftExportJob(
        { ...success, operation_id: `dmp_${"f".repeat(32)}` },
        project,
        episode,
        command.operation_id,
      ),
    ).toBe(false);
  });
  it("injects only the native save destination after validating the top-level sender", async () => {
    const env = setup();
    await expect(
      env.invoke("create", { ...command, output_path: "/tmp/injected.mp4" }),
    ).rejects.toThrow("path-free");
    expect(env.selectOutput).not.toHaveBeenCalled();
    for (const action of ["create", "list", "get", "cancel"] as const) {
      await expect(
        env.handlers.get(DRAFT_EXPORT_CHANNELS[action])!({ top: false }, project, episode, command),
      ).rejects.toThrow("not authorized");
    }
    expect(env.client.createDraftExport).not.toHaveBeenCalled();
    expect(await env.invoke("create", command)).toEqual({ kind: "FOUND", receipt });
    expect(env.selectOutput).toHaveBeenCalledWith(expect.stringMatching(/DRAFT.*\.mp4$/));
    expect(env.client.createDraftExport).toHaveBeenCalledExactlyOnceWith(project, episode, {
      ...command,
      output_path: "/tmp/local-DRAFT.mp4",
    });
  });
  it("never submits a dismissed or invalid destination and rejects repeated picker clicks", async () => {
    const cancelled = setup(vi.fn().mockResolvedValue(null));
    expect(await cancelled.invoke("create", command)).toEqual({ kind: "PICKER_CANCELLED" });
    expect(cancelled.client.createDraftExport).not.toHaveBeenCalled();
    const invalid = setup(vi.fn().mockResolvedValue("relative.mp4"));
    expect(await invalid.invoke("create", command)).toEqual({ kind: "INVALID_DESTINATION" });
    expect(invalid.client.createDraftExport).not.toHaveBeenCalled();
    let finish!: (value: string | null) => void;
    const env = setup(
      vi.fn(
        () =>
          new Promise<string | null>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const pending = env.invoke("create", command);
    expect(await env.invoke("create", command)).toEqual({ kind: "PICKER_BUSY" });
    expect(await env.invoke("get", command.operation_id)).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await env.invoke("cancel", command.operation_id)).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(env.client.getDraftExport).not.toHaveBeenCalled();
    finish(null);
    await pending;
    await env.invoke("get", command.operation_id);
    expect(env.client.getDraftExport).toHaveBeenCalledWith(project, episode, command.operation_id);
  });
  it("routes authenticated real API list/create/get/cancel without trusting malformed receipts", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ data: { items: [job] }, request_id: requestId }, 200))
      .mockResolvedValueOnce(response(receipt, 202))
      .mockResolvedValueOnce(response(receipt, 200))
      .mockResolvedValueOnce(response({ ...receipt, data: { ...job, status: "CANCELLED" } }, 200))
      .mockResolvedValueOnce(
        response({ ...receipt, data: { ...job, episode_id: `ep_${"f".repeat(32)}` } }, 200),
      );
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    expect((await client.listDraftExports(project, episode)).kind).toBe("LISTED");
    expect(
      (
        await client.createDraftExport(project, episode, {
          ...command,
          output_path: "/tmp/real-DRAFT.mp4",
        })
      ).kind,
    ).toBe("FOUND");
    expect((await client.getDraftExport(project, episode, command.operation_id)).kind).toBe(
      "FOUND",
    );
    expect((await client.cancelDraftExport(project, episode, command.operation_id)).kind).toBe(
      "FOUND",
    );
    expect((await client.getDraftExport(project, episode, command.operation_id)).kind).toBe(
      "REMOTE_UNKNOWN",
    );
    expect(fetcher.mock.calls[1]![0]).toBe(
      `http://127.0.0.1:43124/api/v1/projects/${project}/episodes/${episode}/draft-exports`,
    );
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({
      ...command,
      output_path: "/tmp/real-DRAFT.mp4",
    });
    expect(fetcher.mock.calls[3]![0]).toContain(`/${command.operation_id}/cancellations`);
    expect(() =>
      client.createDraftExport(project, episode, { ...command, output_path: "relative.mp4" }),
    ).toThrow("destination");
  });
  it("keeps dropped replies unknown and distinguishes a confirmed missing operation", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce(
        response(
          {
            error: {
              code: "DRAFT_EXPORT_NOT_FOUND",
              message: "Absent",
              details: {},
              retryable: false,
            },
            request_id: requestId,
          },
          404,
        ),
      );
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    expect(
      await client.createDraftExport(project, episode, {
        ...command,
        output_path: "/tmp/DRAFT.mp4",
      }),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await client.getDraftExport(project, episode, command.operation_id)).toEqual({
      kind: "NOT_FOUND",
      request_id: requestId,
    });
  });
  it("recognizes only validated preclaim toolchain failures on CREATE, keeping other 503 unknown", async () => {
    const error = {
      error: {
        code: "DRAFT_TOOLCHAIN_UNAVAILABLE",
        message: "Pinned tools unavailable",
        details: {},
        retryable: false,
      },
      request_id: requestId,
    };
    const fetcher = vi.fn().mockResolvedValue(response(error, 503));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    const create = () =>
      client.createDraftExport(project, episode, { ...command, output_path: "/tmp/DRAFT.mp4" });
    expect(await create()).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status: 503,
      code: "DRAFT_TOOLCHAIN_UNAVAILABLE",
      request_id: requestId,
    });
    expect(await client.getDraftExport(project, episode, command.operation_id)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(await client.cancelDraftExport(project, episode, command.operation_id)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(await client.listDraftExports(project, episode)).toEqual({ kind: "REMOTE_UNKNOWN" });
    for (const payload of [
      { ...error, request_id: "00000000-0000-4000-8000-000000000002" },
      { ...error, request_id: "invalid" },
      { ...error, unexpected: true },
      { ...error, error: { ...error.error, code: "DRAFT_EXPORT_UNKNOWN" } },
      { ...error, error: { ...error.error, retryable: true } },
      { ...error, error: { ...error.error, details: null } },
      { ...error, error: { ...error.error, message: 42 } },
      { ...error, error: { ...error.error, unexpected: true } },
    ]) {
      fetcher.mockResolvedValue(response(payload, 503));
      expect(await create()).toEqual({ kind: "REMOTE_UNKNOWN" });
    }
    fetcher.mockResolvedValue(response(error, 500));
    expect(await create()).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  it("exposes a sandbox-compatible preload with no path API or relative runtime import", async () => {
    const source = readFileSync(resolve(__dirname, "preload.ts"), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    let bridge: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    const invoke = vi.fn().mockResolvedValue({ kind: "PICKER_CANCELLED" });
    runInNewContext(js, {
      exports: {},
      require: (name: string) => {
        if (name !== "electron") throw new Error(`Unexpected sandbox import ${name}`);
        return {
          contextBridge: {
            exposeInMainWorld: (_name: string, api: typeof bridge) => {
              bridge = api;
            },
          },
          ipcRenderer: { invoke },
        };
      },
    });
    await bridge.createDraftExportFromPicker!(project, episode, command);
    expect(invoke).toHaveBeenCalledWith(
      "draft-exports:create-from-picker",
      project,
      episode,
      command,
    );
    await bridge.createDraftCompositionPreview!(project, episode, command);
    expect(invoke).toHaveBeenLastCalledWith(
      "draft-exports:create-composition-preview",
      project,
      episode,
      command,
    );
    await bridge.readDraftExportPreview!(project, episode, command.operation_id);
    expect(invoke).toHaveBeenLastCalledWith(
      "draft-exports:preview",
      project,
      episode,
      command.operation_id,
    );
    await bridge.revealDraftExportOutput!(project, episode, command.operation_id);
    expect(invoke).toHaveBeenLastCalledWith(
      "draft-exports:reveal-output",
      project,
      episode,
      command.operation_id,
    );
    expect(bridge).not.toHaveProperty("createDraftExport");
    expect(bridge).not.toHaveProperty("openPath");
  });
});
