import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createProjectSettingsClient } from "./project-settings-client";
import { registerProjectSettingsHandlers } from "./project-settings-ipc";
import { createLocalApiClient } from "./api-client";
import {
  SETTINGS_CHANNELS,
  settingsCommand,
  settingsIdentity,
  settingsResponse,
  settingsReceipt,
  settingsTimebase,
} from "@aijian/contracts/project-settings";
import type {
  SettingsCommand,
  SettingsReceipt,
  SettingsResponse,
} from "@aijian/contracts/project-settings";

const p = `prj_${"1".repeat(32)}`,
  other = `prj_${"2".repeat(32)}`,
  op = `pso_${"3".repeat(32)}`;
const date = "2026-10-11T10:00:00Z",
  id = "00000000-0000-4000-8000-000000000000";
const boundary: SettingsResponse["boundary"] = {
  settings_scope: "PROJECT_METADATA_ONLY",
  existing_artifact_versions_modified: false,
  sequence_timebase_effect: "DECLARED_DEFAULT_REQUIRES_EXPLICIT_ADOPTION",
  aspect_duration_language: "READ_ONLY_PENDING_CONSUMER_CAPABILITIES",
  episode_settings: "SEPARATE_EPISODE_CAS",
  production_intent: "SEPARATE_PRODUCTION_BRIEF_VERSION",
  generation_remote_version_policies: "NO_EDITABLE_PROJECT_POLICY_CONTRACT",
};
const input: SettingsCommand = {
  operation_id: op,
  expected_project_revision: 1,
  changes: { description: "说明😀\nsecond", sequence_timebase: null },
};
function current(): SettingsResponse {
  return {
    data: {
      schema_version: 1,
      project_id: p,
      name: "A",
      description: "",
      status: "active",
      sequence_timebase: null,
      aspect_ratio: "9:16",
      target_duration_seconds: 90,
      source_language: "zh-CN",
      revision: 1,
      created_at: date,
      updated_at: date,
    },
    boundary: structuredClone(boundary),
    request_id: id,
  };
}
function receipt(): SettingsReceipt {
  return {
    data: {
      project_id: p,
      operation_id: op,
      base_revision: 1,
      result_revision: 2,
      request_hash: `sha256:${createHash("sha256").update(settingsIdentity(p, input)).digest("hex")}`,
      result: {
        ...current().data,
        revision: 2,
        description: input.changes.description!,
        sequence_timebase: null,
      },
      created_at: date,
    },
    boundary: structuredClone(boundary),
    request_id: id,
  };
}
describe("canonical settings and exact operation guards", () => {
  it.each([
    {},
    { name: null },
    { description: "x\u200b" },
    { name: " x " },
    { description: "x\ud800" },
    { status: "deleted" },
    { target_duration_seconds: 60 },
  ])("rejects invalid changes %j", (changes) =>
    expect(settingsCommand({ ...input, changes })).toBe(false),
  );
  it("keeps omission distinct from clear and rejects invalid drop-frame", () => {
    expect(settingsIdentity(p, input)).not.toBe(
      settingsIdentity(p, { ...input, changes: { description: input.changes.description } }),
    );
    expect(settingsTimebase({ frame_rate: { num: 24, den: 1 }, timecode_mode: "DROP_FRAME" })).toBe(
      false,
    );
    expect(settingsResponse(current(), other)).toBe(false);
    expect(settingsReceipt(receipt(), p, `pso_${"4".repeat(32)}`)).toBe(false);
  });
  it.each([
    "wrong-project",
    "wrong-operation",
    "wrong-hash",
    "wrong-revision",
    "changed-content",
    "wrong-request-id",
    "future-boundary",
  ])("rejects bad mutation reply %s as UNKNOWN", async (kind) => {
    const value = receipt();
    if (kind === "wrong-project") value.data.project_id = other;
    if (kind === "wrong-operation") value.data.operation_id = `pso_${"5".repeat(32)}`;
    if (kind === "wrong-hash") value.data.request_hash = `sha256:${"0".repeat(64)}`;
    if (kind === "wrong-revision") value.data.result.revision = 5;
    if (kind === "changed-content") value.data.result.description = "different";
    if (kind === "wrong-request-id") value.request_id = "00000000-0000-4000-8000-000000000001";
    if (kind === "future-boundary")
      (
        value.boundary as unknown as { existing_artifact_versions_modified: boolean }
      ).existing_artifact_versions_modified = true;
    const read = vi.fn().mockResolvedValue({ status: 200, payload: value, requestId: id });
    expect(await createProjectSettingsClient(read, {}).updateProjectSettings(p, input)).toEqual({
      kind: "UNKNOWN",
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("reads current and exact historical receipt and never retries transport failures", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, payload: current(), requestId: id })
      .mockResolvedValueOnce({ status: 200, payload: receipt(), requestId: id })
      .mockRejectedValueOnce(new Error("lost"));
    const api = createProjectSettingsClient(read, { "X-Sidecar-Token": "synthetic" });
    expect((await api.getProjectSettings(p)).kind).toBe("FOUND");
    expect((await api.getProjectSettingsReceipt(p, op)).kind).toBe("FOUND");
    expect(await api.updateProjectSettings(p, input)).toEqual({ kind: "UNKNOWN" });
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls[1]?.[0]).toBe(`/api/v1/projects/${p}/settings/operations/${op}`);
  });
  it.each([
    [401, "SIDECAR_AUTH_REQUIRED"],
    [403, "SIDECAR_REQUEST_REJECTED"],
    [404, "PROJECT_NOT_FOUND"],
    [409, "PROJECT_SETTINGS_CONFLICT"],
  ] as const)(
    "preserves definite %s rejection without treating it as UNKNOWN",
    async (status, code) => {
      const error = {
        request_id: id,
        error: { code, message: "rejected", details: {}, retryable: false },
      };
      const read = vi.fn().mockResolvedValue({ status, payload: error, requestId: id });
      expect(await createProjectSettingsClient(read, {}).updateProjectSettings(p, input)).toEqual({
        kind: "REJECTED",
        status,
        code,
      });
      expect(read).toHaveBeenCalledTimes(1);
    },
  );
  it("production LocalApiClient wires bounded HTTP, exact hash and snapshot before await", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(receipt()), {
        status: 200,
        headers: { "X-Request-ID": id, "Content-Type": "application/json" },
      }),
    );
    const api = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    const mutable = structuredClone(input);
    const promise = api.updateProjectSettings(p, mutable);
    mutable.changes.description = "later mutation";
    expect((await promise).kind).toBe("FOUND");
    const init = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(init?.body as string)).toEqual(input);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("IPC rejects subframes, wrong arity and unauthorized fields before client calls", async () => {
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    const api = {
      getProjectSettings: vi.fn(),
      getProjectSettingsReceipt: vi.fn(),
      updateProjectSettings: vi.fn(),
    };
    registerProjectSettingsHandlers<boolean>(
      (channel, listener) => handlers.set(channel, listener),
      () => api,
      (e) => e,
    );
    await expect(handlers.get(SETTINGS_CHANNELS.write)!(false, p, input)).rejects.toThrow(
      "top frame",
    );
    await expect(
      handlers.get(SETTINGS_CHANNELS.write)!(true, p, {
        ...input,
        changes: { source_language: "en-US" },
      }),
    ).rejects.toThrow();
    await expect(handlers.get(SETTINGS_CHANNELS.read)!(true, p, op)).rejects.toThrow();
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
    await handlers.get(SETTINGS_CHANNELS.write)!(true, p, input);
    expect(api.updateProjectSettings).toHaveBeenCalledExactlyOnceWith(p, input);
  });
  it("actual sandbox preload invokes only fixed settings channels and main guards the frame", async () => {
    const preload = readFileSync(resolve("src/preload.ts"), "utf8");
    const main = readFileSync(resolve("src/main.ts"), "utf8");
    for (const method of ["read", "receipt", "write"])
      expect(preload).toContain(`SETTINGS_CHANNELS.${method}`);
    expect(main).toContain("registerProjectSettingsHandlers<IpcMainInvokeEvent>");
    expect(main).toContain("event.senderFrame === mainWindow.webContents.mainFrame");
    let bridge!: Record<string, (...args: unknown[]) => Promise<unknown>>;
    const invoke = vi.fn().mockResolvedValue({ receipt: true });
    runInNewContext(
      ts.transpileModule(preload, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
        .outputText,
      {
        exports: {},
        require: (name: string) => {
          expect(name).toBe("electron");
          return {
            contextBridge: {
              exposeInMainWorld: (_name: string, value: typeof bridge) => {
                bridge = value;
              },
            },
            ipcRenderer: { invoke },
          };
        },
      },
    );
    await bridge.getProjectSettings!(p);
    expect(invoke.mock.lastCall).toEqual([SETTINGS_CHANNELS.read, p]);
    await bridge.getProjectSettingsReceipt!(p, op);
    expect(invoke.mock.lastCall).toEqual([SETTINGS_CHANNELS.receipt, p, op]);
    await bridge.updateProjectSettings!(p, input);
    expect(invoke.mock.lastCall).toEqual([SETTINGS_CHANNELS.write, p, input]);
  });
});
