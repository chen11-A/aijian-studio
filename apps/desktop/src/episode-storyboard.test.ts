import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, test, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import {
  EPISODE_STORYBOARD_CHANNELS,
  isCreateEpisodeStoryboardVersionRequest,
  isEpisodeStoryboardContent,
  isEpisodeStoryboardVersionCreatedResponse,
  isEpisodeStoryboardVersionResponse,
  type CreateEpisodeStoryboardVersionRequest,
  type EpisodeStoryboardShot,
  type EpisodeStoryboardVersion,
} from "./episode-storyboard-contract";
import { registerEpisodeStoryboardHandlers } from "./episode-storyboard-ipc";

const projectId = `prj_${"a".repeat(32)}`;
const episodeId = `ep_${"b".repeat(32)}`;
const versionId = `ver_${"c".repeat(32)}`;
const otherVersionId = `ver_${"d".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000001";
const session = { origin: "http://127.0.0.1:43124", token: "t".repeat(43) };
const shot: EpisodeStoryboardShot = {
  shot_id: `shp_${"e".repeat(32)}`,
  ordinal: 1,
  duration_frames: 48,
  title: "码头相遇 🎬",
  description: "雨夜码头",
  action: "林舟走入画面。",
  dialogue: "我们到了。",
  camera: "缓慢推近",
  script_scene_id: null,
  character_ids: [],
  location_id: null,
};
const payload: CreateEpisodeStoryboardVersionRequest = {
  content: {
    schema_version: "1.0.0",
    project_id: projectId,
    episode_id: episodeId,
    fps: 24,
    script_version_id: null,
    creative_library_version_id: null,
    shots: [shot],
  },
  parent_version_id: null,
  expected_revision: null,
  change_summary: "保存人工分镜草稿",
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
function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}
function version(): EpisodeStoryboardVersion {
  return {
    version_id: versionId,
    project_id: projectId,
    episode_id: episodeId,
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content: structuredClone(payload.content),
    content_hash: hash(payload.content),
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
function response(
  body: unknown,
  status = 200,
  headerRequestId: string | null = requestId,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headerRequestId === null ? {} : { "X-Request-ID": headerRequestId },
  });
}
function createResponse() {
  return { data: { version: version(), replayed: false }, request_id: requestId };
}

describe("episode storyboard desktop contract", () => {
  test("accepts empty manual drafts, integer frame limits and legacy episode identities", () => {
    expect(isCreateEpisodeStoryboardVersionRequest(payload, projectId, episodeId)).toBe(true);
    expect(
      isEpisodeStoryboardContent({ ...payload.content, shots: [] }, projectId, episodeId),
    ).toBe(true);
    expect(
      isEpisodeStoryboardContent(
        { ...payload.content, fps: 120, shots: [{ ...shot, duration_frames: 864_000 }] },
        projectId,
        episodeId,
      ),
    ).toBe(true);
    const legacyEpisode = `ep_${projectId}`;
    expect(
      isEpisodeStoryboardContent(
        { ...payload.content, episode_id: legacyEpisode },
        projectId,
        legacyEpisode,
      ),
    ).toBe(true);
  });
  test("foreign identities require the relevant immutable version pins", () => {
    const linkedShot = {
      ...shot,
      script_scene_id: `scn_${"1".repeat(32)}`,
      character_ids: [`chr_${"2".repeat(32)}`],
      location_id: `loc_${"3".repeat(32)}`,
    };
    const content = { ...payload.content, shots: [linkedShot] };
    expect(isEpisodeStoryboardContent(content, projectId, episodeId)).toBe(false);
    expect(
      isEpisodeStoryboardContent(
        { ...content, script_version_id: versionId },
        projectId,
        episodeId,
      ),
    ).toBe(false);
    expect(
      isEpisodeStoryboardContent(
        { ...content, creative_library_version_id: versionId },
        projectId,
        episodeId,
      ),
    ).toBe(false);
    expect(
      isEpisodeStoryboardContent(
        { ...content, script_version_id: versionId, creative_library_version_id: otherVersionId },
        projectId,
        episodeId,
      ),
    ).toBe(true);
  });
  test.each([
    { shot_id: "shot_1" },
    { ordinal: 2 },
    { ordinal: true },
    { duration_frames: 0 },
    { duration_frames: 1.5 },
    { duration_frames: "48" },
    { duration_frames: 864_001 },
    { title: "  " },
    { title: "文".repeat(241) },
    { title: "\ud800" },
    { description: "文".repeat(20_001) },
    { action: null },
    { dialogue: 4 },
    { camera: "x".repeat(241) },
    { script_scene_id: "scn_bad" },
    { character_ids: null },
    { character_ids: [`chr_${"2".repeat(32)}`, `chr_${"2".repeat(32)}`] },
    { character_ids: [`loc_${"3".repeat(32)}`] },
    { character_ids: new Array(1) },
    { location_id: "location_1" },
    { approved: true },
  ])("rejects malformed shot fields %j", (patch) => {
    expect(
      isEpisodeStoryboardContent(
        {
          ...payload.content,
          script_version_id: versionId,
          creative_library_version_id: otherVersionId,
          shots: [{ ...shot, ...patch }],
        },
        projectId,
        episodeId,
      ),
    ).toBe(false);
  });
  test.each([
    { fps: 0 },
    { fps: 121 },
    { fps: 24.5 },
    { fps: true },
    { schema_version: "1.0" },
    { project_id: `prj_${"1".repeat(32)}` },
    { episode_id: `ep_${"1".repeat(32)}` },
    { episode_id: null },
    { script_version_id: undefined },
    { creative_library_version_id: "x" },
    { shots: null },
    { shots: new Array(1) },
    { shots: [shot, { ...shot, ordinal: 2 }] },
    { ready_for_generation: true },
  ])("rejects noncanonical or mismatched content %j", (patch) => {
    expect(isEpisodeStoryboardContent({ ...payload.content, ...patch }, projectId, episodeId)).toBe(
      false,
    );
  });
  test("rejects omitted keys, oversized content and excessive shot or character counts", () => {
    const { camera: _camera, ...missingCamera } = shot;
    void _camera;
    expect(
      isEpisodeStoryboardContent(
        { ...payload.content, shots: [missingCamera] },
        projectId,
        episodeId,
      ),
    ).toBe(false);
    const shots = Array.from({ length: 1_001 }, (_, index) => ({
      ...shot,
      ordinal: index + 1,
      shot_id: `shp_${index.toString(16).padStart(32, "0")}`,
    }));
    expect(isEpisodeStoryboardContent({ ...payload.content, shots }, projectId, episodeId)).toBe(
      false,
    );
    const largeShots = shots
      .slice(0, 40)
      .map((item) => ({ ...item, description: "文".repeat(20_000) }));
    expect(
      isEpisodeStoryboardContent({ ...payload.content, shots: largeShots }, projectId, episodeId),
    ).toBe(false);
    const character_ids = Array.from(
      { length: 501 },
      (_, index) => `chr_${index.toString(16).padStart(32, "0")}`,
    );
    expect(
      isEpisodeStoryboardContent(
        {
          ...payload.content,
          creative_library_version_id: versionId,
          shots: [{ ...shot, character_ids }],
        },
        projectId,
        episodeId,
      ),
    ).toBe(false);
  });
  test.each([
    { expected_revision: 1 },
    { parent_version_id: versionId },
    { parent_version_id: "invalid" },
    { expected_revision: 0, parent_version_id: versionId },
    { expected_revision: Number.MAX_SAFE_INTEGER + 1, parent_version_id: versionId },
    { change_summary: " " },
    { change_summary: "x".repeat(241) },
    { confirmed: true },
  ])("rejects invalid write intent %j", (patch) => {
    expect(
      isCreateEpisodeStoryboardVersionRequest({ ...payload, ...patch }, projectId, episodeId),
    ).toBe(false);
  });
  test("validates the readback content hash, scope, requested version and response request ID", () => {
    const receipt = { data: version(), request_id: requestId };
    expect(
      isEpisodeStoryboardVersionResponse(receipt, projectId, episodeId, requestId, versionId),
    ).toBe(true);
    expect(
      isEpisodeStoryboardVersionResponse(receipt, projectId, episodeId, requestId, otherVersionId),
    ).toBe(false);
    expect(
      isEpisodeStoryboardVersionResponse(receipt, projectId, `ep_${"f".repeat(32)}`, requestId),
    ).toBe(false);
    expect(isEpisodeStoryboardVersionResponse(receipt, projectId, episodeId, null)).toBe(false);
    expect(
      isEpisodeStoryboardVersionResponse(
        { ...receipt, request_id: "untrusted" },
        projectId,
        episodeId,
        "untrusted",
      ),
    ).toBe(false);
    const changed = version();
    changed.content.shots[0]!.dialogue = "Changed";
    expect(
      isEpisodeStoryboardVersionResponse(
        { data: changed, request_id: requestId },
        projectId,
        episodeId,
        requestId,
      ),
    ).toBe(false);
  });
  test.each([
    { head_revision: 0 },
    { version_number: 2 },
    { parent_version_id: versionId },
    { created_at: "bad-date" },
    { author_actor_id: "" },
    { content_hash: "sha256:wrong" },
    { episode_id: null },
    { state: "CONFIRMED" },
  ])("rejects malformed immutable versions %j", (patch) => {
    expect(
      isEpisodeStoryboardVersionResponse(
        { data: { ...version(), ...patch }, request_id: requestId },
        projectId,
        episodeId,
        requestId,
      ),
    ).toBe(false);
  });
  test("created receipts must match write intent while historical replay may report a newer head", () => {
    const receipt = createResponse();
    const valid = () =>
      isEpisodeStoryboardVersionCreatedResponse(receipt, projectId, episodeId, requestId, payload);
    expect(valid()).toBe(true);
    receipt.data.version.head_revision = 3;
    expect(valid()).toBe(false);
    receipt.data.replayed = true;
    expect(valid()).toBe(true);
    receipt.data.version.change_summary = "different";
    expect(valid()).toBe(false);
    receipt.data.version.change_summary = payload.change_summary;
    receipt.data.version.content.fps = 25;
    receipt.data.version.content_hash = hash(receipt.data.version.content);
    expect(valid()).toBe(false);
    expect(
      isEpisodeStoryboardVersionCreatedResponse(createResponse(), projectId, episodeId, requestId, {
        ...payload,
        parent_version_id: otherVersionId,
        expected_revision: 1,
      }),
    ).toBe(false);
  });
});

describe("episode storyboard authenticated desktop transport", () => {
  test("real API client uses the fixed sidecar routes and encapsulated authentication", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(createResponse(), 201));
    const client = createLocalApiClient(fetcher, session);
    expect(
      (await client.createEpisodeStoryboardVersion(projectId, episodeId, "save-one", payload)).kind,
    ).toBe("CREATED");
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `${session.origin}/api/v1/projects/${projectId}/episodes/${episodeId}/storyboard/versions`,
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Idempotency-Key": "save-one",
        "Content-Type": "application/json",
        Origin: "app://aijian",
        Authorization: `Bearer ${session.token}`,
      },
    });
    fetcher.mockResolvedValueOnce(response({ data: version(), request_id: requestId }));
    expect((await client.getEpisodeStoryboard(projectId, episodeId)).kind).toBe("FOUND");
    expect(fetcher.mock.lastCall?.[0]).toBe(
      `${session.origin}/api/v1/projects/${projectId}/episodes/${episodeId}/storyboard`,
    );
    fetcher.mockResolvedValueOnce(response({ data: version(), request_id: requestId }));
    expect((await client.getEpisodeStoryboardVersion(projectId, episodeId, versionId)).kind).toBe(
      "FOUND",
    );
    expect(fetcher.mock.lastCall?.[0]).toBe(
      `${session.origin}/api/v1/projects/${projectId}/episodes/${episodeId}/storyboard/versions/${versionId}`,
    );
  });
  test("only latest's validated not-found becomes empty; definite conflict stays distinct from unknown", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createLocalApiClient(fetcher, session);
    fetcher.mockResolvedValueOnce(response(error("STORYBOARD_NOT_FOUND"), 404));
    expect(await client.getEpisodeStoryboard(projectId, episodeId)).toEqual({ kind: "EMPTY" });
    fetcher.mockResolvedValueOnce(response(error("STORYBOARD_NOT_FOUND"), 404));
    expect(await client.getEpisodeStoryboardVersion(projectId, episodeId, versionId)).toMatchObject(
      {
        kind: "DEFINITE_SERVER_ERROR",
        status: 404,
        code: "STORYBOARD_NOT_FOUND",
      },
    );
    fetcher.mockResolvedValueOnce(response(error("STORYBOARD_CONFLICT"), 409));
    expect(
      await client.createEpisodeStoryboardVersion(projectId, episodeId, "save-one", payload),
    ).toMatchObject({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "STORYBOARD_CONFLICT",
    });
    fetcher.mockResolvedValueOnce(response(error("STORYBOARD_STORAGE_FAILED"), 500));
    expect(
      await client.createEpisodeStoryboardVersion(projectId, episodeId, "save-one", payload),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  test("ambiguous writes do not retry and readback corruption is never accepted", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("lost response"));
    const client = createLocalApiClient(fetcher, session);
    expect(
      await client.createEpisodeStoryboardVersion(projectId, episodeId, "save-one", payload),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const result of [
      response(createResponse(), 201, null),
      response({}, 201),
      response({ ...createResponse(), request_id: "00000000-0000-4000-8000-000000000002" }, 201),
      response(error("STORYBOARD_CONFLICT"), 409, null),
      new Response("{", { status: 201 }),
    ]) {
      fetcher.mockResolvedValueOnce(result);
      expect(
        await client.createEpisodeStoryboardVersion(projectId, episodeId, "save-one", payload),
      ).toEqual({ kind: "REMOTE_UNKNOWN" });
    }
    fetcher.mockResolvedValueOnce(response({ data: version(), request_id: requestId }));
    expect(await client.getEpisodeStoryboardVersion(projectId, episodeId, otherVersionId)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    fetcher.mockResolvedValueOnce(
      response({ data: { ...version(), content_hash: "wrong" }, request_id: requestId }),
    );
    expect(await client.getEpisodeStoryboard(projectId, episodeId)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });
  test("invalid scope, keys and payloads are rejected before transport", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createLocalApiClient(fetcher, session);
    await expect(client.getEpisodeStoryboard("bad", episodeId)).rejects.toThrow("canonical");
    await expect(client.getEpisodeStoryboard(projectId, "../other")).rejects.toThrow("canonical");
    await expect(client.getEpisodeStoryboardVersion(projectId, episodeId, "bad")).rejects.toThrow(
      "canonical",
    );
    await expect(
      client.createEpisodeStoryboardVersion(projectId, episodeId, "with spaces", payload),
    ).rejects.toThrow("canonical");
    await expect(
      client.createEpisodeStoryboardVersion(projectId, episodeId, "save-one", {
        ...payload,
        content: { ...payload.content, project_id: `prj_${"f".repeat(32)}` },
      }),
    ).rejects.toThrow("canonical");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("episode storyboard native IPC boundary", () => {
  test("rejects untrusted frames, bad arguments and extra fields before dispatch", async () => {
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    const client = {
      getEpisodeStoryboard: vi.fn(),
      getEpisodeStoryboardVersion: vi.fn(),
      createEpisodeStoryboardVersion: vi.fn(),
    };
    const clientFor = vi.fn(() => client);
    registerEpisodeStoryboardHandlers<boolean>(
      (channel, listener) => handlers.set(channel, listener),
      clientFor,
      (event) => event,
    );
    const latest = handlers.get(EPISODE_STORYBOARD_CHANNELS.latest)!;
    const getVersion = handlers.get(EPISODE_STORYBOARD_CHANNELS.version)!;
    const create = handlers.get(EPISODE_STORYBOARD_CHANNELS.create)!;
    expect(handlers.size).toBe(3);
    for (const handler of handlers.values()) await expect(handler(false)).rejects.toThrow("frame");
    expect(clientFor).not.toHaveBeenCalled();
    await expect(latest(true, projectId)).rejects.toThrow("canonical");
    await expect(latest(true, projectId, episodeId, "extra")).rejects.toThrow("canonical");
    await expect(getVersion(true, projectId, episodeId, "wrong")).rejects.toThrow("canonical");
    await expect(
      create(true, projectId, episodeId, "save-one", { ...payload, approved: true }),
    ).rejects.toThrow("canonical");
    await expect(create(true, projectId, episodeId, "save-one", payload, "extra")).rejects.toThrow(
      "canonical",
    );
    expect(client.getEpisodeStoryboard).not.toHaveBeenCalled();
    expect(client.getEpisodeStoryboardVersion).not.toHaveBeenCalled();
    expect(client.createEpisodeStoryboardVersion).not.toHaveBeenCalled();
    await latest(true, projectId, episodeId);
    await getVersion(true, projectId, episodeId, versionId);
    await create(true, projectId, episodeId, "save-one", payload);
    expect(client.getEpisodeStoryboard).toHaveBeenCalledWith(projectId, episodeId);
    expect(client.getEpisodeStoryboardVersion).toHaveBeenCalledWith(
      projectId,
      episodeId,
      versionId,
    );
    expect(client.createEpisodeStoryboardVersion).toHaveBeenCalledWith(
      projectId,
      episodeId,
      "save-one",
      payload,
    );
  });
  test("actual sandbox preload exposes only fixed channel calls, with no relative runtime imports", async () => {
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
    expect(bridge).not.toHaveProperty("token");
    expect(bridge).not.toHaveProperty("invoke");
    await bridge.getEpisodeStoryboard!(projectId, episodeId);
    expect(invoke.mock.lastCall).toEqual([
      EPISODE_STORYBOARD_CHANNELS.latest,
      projectId,
      episodeId,
    ]);
    await bridge.getEpisodeStoryboardVersion!(projectId, episodeId, versionId);
    expect(invoke.mock.lastCall).toEqual([
      EPISODE_STORYBOARD_CHANNELS.version,
      projectId,
      episodeId,
      versionId,
    ]);
    await bridge.createEpisodeStoryboardVersion!(projectId, episodeId, "save-one", payload);
    expect(invoke.mock.lastCall).toEqual([
      EPISODE_STORYBOARD_CHANNELS.create,
      projectId,
      episodeId,
      "save-one",
      payload,
    ]);
  });
});
