import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, test, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import {
  isCreateProjectCreativeLibraryVersionRequest,
  isProjectCreativeLibraryVersionCreatedResponse,
  isProjectCreativeLibraryVersionResponse,
  PROJECT_CREATIVE_LIBRARY_CHANNELS,
  type CreateProjectCreativeLibraryVersionRequest,
  type ProjectCreativeLibraryVersion,
} from "./project-creative-library-contract";
import { registerProjectCreativeLibraryHandlers } from "./project-creative-library-ipc";

const projectId = `prj_${"a".repeat(32)}`;
const versionId = `ver_${"b".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000001";
const session = { origin: "http://127.0.0.1:43124", token: "t".repeat(43) };
const payload: CreateProjectCreativeLibraryVersionRequest = {
  content: {
    schema_version: "1.0.0",
    project_id: projectId,
    episode_id: null,
    characters: [
      {
        character_id: `chr_${"c".repeat(32)}`,
        ordinal: 1,
        name: "林舟",
        role: "主角",
        description: "文本草稿",
        appearance: "",
        personality: "谨慎",
      },
    ],
    world: {
      premise: "星夜之城",
      rules: "永夜",
      era: "未来",
      visual_style: "",
      palette: "",
      materials: "",
    },
    scenes: [
      {
        scene_id: `loc_${"d".repeat(32)}`,
        ordinal: 1,
        name: "码头",
        description: "",
        location: "旧城",
        time_of_day: "夜",
        weather: "雨",
        continuity: "",
      },
    ],
  },
  parent_version_id: null,
  expected_revision: null,
  change_summary: "保存人工草稿",
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function version(): ProjectCreativeLibraryVersion {
  return {
    version_id: versionId,
    project_id: projectId,
    episode_id: null,
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content: structuredClone(payload.content),
    content_hash: `sha256:${createHash("sha256").update(canonical(payload.content), "utf8").digest("hex")}`,
    author_actor_id: "local-user",
    change_summary: payload.change_summary,
    created_at: "2026-10-08T00:00:00Z",
  };
}
function error(code: string): object {
  return {
    error: { code, message: "Rejected", details: {}, retryable: false },
    request_id: requestId,
  };
}
function response(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "X-Request-ID": requestId } });
}

describe("project creative library desktop contract", () => {
  test("closed input keeps stable identities and project-shared scope", () => {
    expect(isCreateProjectCreativeLibraryVersionRequest(payload, projectId)).toBe(true);
    for (const invalid of [
      { ...payload, content: { ...payload.content, episode_id: `ep_${"e".repeat(32)}` } },
      { ...payload, expected_revision: 1 },
      {
        ...payload,
        content: {
          ...payload.content,
          characters: [...payload.content.characters, ...payload.content.characters],
        },
      },
      {
        ...payload,
        content: { ...payload.content, world: { ...payload.content.world, approved: true } },
      },
    ])
      expect(isCreateProjectCreativeLibraryVersionRequest(invalid, projectId)).toBe(false);
  });
  test("verifies readback hash, exact version, scope and historical replay", () => {
    const receipt = { data: version(), request_id: requestId };
    expect(isProjectCreativeLibraryVersionResponse(receipt, projectId, requestId, versionId)).toBe(
      true,
    );
    expect(
      isProjectCreativeLibraryVersionResponse(
        receipt,
        projectId,
        requestId,
        `ver_${"1".repeat(32)}`,
      ),
    ).toBe(false);
    receipt.data.content.world.rules = "corrupt";
    expect(isProjectCreativeLibraryVersionResponse(receipt, projectId, requestId)).toBe(false);
    const created = { data: { version: version(), replayed: false }, request_id: requestId };
    expect(
      isProjectCreativeLibraryVersionCreatedResponse(created, projectId, requestId, payload),
    ).toBe(true);
    created.data.version.head_revision = 3;
    expect(
      isProjectCreativeLibraryVersionCreatedResponse(created, projectId, requestId, payload),
    ).toBe(false);
    created.data.replayed = true;
    expect(
      isProjectCreativeLibraryVersionCreatedResponse(created, projectId, requestId, payload),
    ).toBe(true);
  });
  test("real API client routes only validated requests and distinguishes empty, conflict and unknown", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ data: { version: version(), replayed: false }, request_id: requestId }, 201),
      );
    const client = createLocalApiClient(fetcher, session);
    expect(
      (await client.createProjectCreativeLibraryVersion(projectId, "save-one", payload)).kind,
    ).toBe("CREATED");
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `${session.origin}/api/v1/projects/${projectId}/creative-library/versions`,
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ "Idempotency-Key": "save-one" });
    fetcher.mockResolvedValueOnce(response(error("CREATIVE_LIBRARY_NOT_FOUND"), 404));
    expect(await client.getProjectCreativeLibrary(projectId)).toEqual({ kind: "EMPTY" });
    fetcher.mockResolvedValueOnce(response(error("CREATIVE_LIBRARY_CONFLICT"), 409));
    expect(
      (await client.createProjectCreativeLibraryVersion(projectId, "save-one", payload)).kind,
    ).toBe("DEFINITE_SERVER_ERROR");
    fetcher.mockRejectedValueOnce(new Error("lost response"));
    expect(
      await client.createProjectCreativeLibraryVersion(projectId, "save-one", payload),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
    fetcher.mockResolvedValueOnce(response({ data: version(), request_id: requestId }));
    expect((await client.getProjectCreativeLibraryVersion(projectId, versionId)).kind).toBe(
      "FOUND",
    );
    const calls = fetcher.mock.calls.length;
    await expect(client.getProjectCreativeLibrary("wrong")).rejects.toThrow("canonical");
    expect(fetcher.mock.calls).toHaveLength(calls);
  });
  test("IPC rejects child frames and malformed requests before dispatch", async () => {
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    const client = {
      getProjectCreativeLibrary: vi.fn(),
      getProjectCreativeLibraryVersion: vi.fn(),
      createProjectCreativeLibraryVersion: vi.fn(),
    };
    registerProjectCreativeLibraryHandlers<boolean>(
      (channel, listener) => handlers.set(channel, listener),
      () => client,
      (event) => event,
    );
    const create = handlers.get(PROJECT_CREATIVE_LIBRARY_CHANNELS.create);
    if (!create) throw new Error("missing handler");
    await expect(create(false, projectId, "save-one", payload)).rejects.toThrow("frame");
    await expect(
      create(true, projectId, "save-one", { ...payload, approved: true }),
    ).rejects.toThrow("canonical");
    expect(client.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
    await create(true, projectId, "save-one", payload);
    expect(client.createProjectCreativeLibraryVersion).toHaveBeenCalledWith(
      projectId,
      "save-one",
      payload,
    );
  });
  test("actual sandbox preload exposes the three fixed calls without token access", async () => {
    const source = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    let bridge: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    const invoke = vi.fn().mockResolvedValue({});
    runInNewContext(compiled, {
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
    });
    await bridge.getProjectCreativeLibrary?.(projectId);
    expect(invoke.mock.lastCall).toEqual([PROJECT_CREATIVE_LIBRARY_CHANNELS.latest, projectId]);
    await bridge.getProjectCreativeLibraryVersion?.(projectId, versionId);
    expect(invoke.mock.lastCall).toEqual([
      PROJECT_CREATIVE_LIBRARY_CHANNELS.version,
      projectId,
      versionId,
    ]);
    await bridge.createProjectCreativeLibraryVersion?.(projectId, "save-one", payload);
    expect(invoke.mock.lastCall).toEqual([
      PROJECT_CREATIVE_LIBRARY_CHANNELS.create,
      projectId,
      "save-one",
      payload,
    ]);
  });
});
