import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import { registerEpisodeMediaAssemblyHandlers } from "./episode-media-assembly-ipc";
import type { CreateEpisodeMediaAssemblyVersionRequest } from "./episode-media-assembly-contract";

const project = `prj_${"a".repeat(32)}`,
  episode = `ep_${"b".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000001";
const command: CreateEpisodeMediaAssemblyVersionRequest = {
  content: {
    schema_version: "1.0.0",
    project_id: project,
    episode_id: episode,
    sequence_timebase: { frame_rate: { num: 25, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
    canvas_width: 1920,
    canvas_height: 1080,
    total_frames: 50,
    visual_segments: [
      {
        segment_id: "seg_local_video",
        media_kind: "video",
        media: {
          asset_id: `asset_${"c".repeat(32)}`,
          asset_version_id: `asv_${"d".repeat(32)}`,
          sha256: "e".repeat(64),
        },
        start_frame: 0,
        end_frame: 50,
        source_in_frame: 0,
        embedded_audio: "MUTE",
      },
    ],
    audio_segments: [],
    subtitle_segments: [],
  },
  parent_version_id: null,
  expected_revision: null,
  change_summary: "剪辑草稿",
};
const receipt = {
  request_id: requestId,
  data: {
    artifact_id: `art_${"1".repeat(32)}`,
    version_id: `ver_${"2".repeat(32)}`,
    content_hash: `sha256:${"3".repeat(64)}`,
    head_revision: 1,
    parent_version_id: null,
    content: command.content,
    media_checks: [
      {
        media: command.content.visual_segments[0]!.media,
        kind: "video",
        availability: "VERIFIED",
        technical_status: "PENDING_MEDIA_PROBE",
        probe_evidence_id: null,
        probed_video_frames: null,
        probed_has_audio: null,
        rights_status: "PENDING_REVIEW",
        rights_decision_id: null,
      },
    ],
    playback_status: "BLOCKED_MEDIA_PROBE",
    export_status: "NO_EXPORT_CLAIM",
  },
};
function response(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
  });
}
describe("actual desktop assembly bridge", () => {
  it("routes authenticated latest/readback/create requests through the real local API client", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            request_id: requestId,
            error: { code: "ASSEMBLY_NOT_FOUND", message: "Absent", details: {}, retryable: false },
          },
          404,
        ),
      )
      .mockResolvedValueOnce(response(receipt, 201))
      .mockResolvedValueOnce(response(receipt, 200));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    expect(await client.readLatestEpisodeMediaAssembly(project, episode)).toEqual({
      kind: "NOT_FOUND",
      request_id: requestId,
    });
    expect((await client.createEpisodeMediaAssemblyVersion(project, episode, command)).kind).toBe(
      "CREATED",
    );
    expect((await client.readLatestEpisodeMediaAssembly(project, episode)).kind).toBe("FOUND");
    expect(fetcher.mock.calls[1]![0]).toBe(
      `http://127.0.0.1:43124/api/v1/projects/${project}/episodes/${episode}/media-assembly/versions`,
    );
    expect(fetcher.mock.calls[1]![1].method).toBe("POST");
    expect(fetcher.mock.calls[1]![1].body).toBe(JSON.stringify(command));
  });
  it("keeps unknown writes unknown and rejects an untrusted IPC frame before dispatch", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("disconnected"));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    expect(await client.createEpisodeMediaAssemblyVersion(project, episode, command)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    const handlers = new Map<
      string,
      (event: { top: boolean }, ...args: unknown[]) => Promise<unknown>
    >();
    registerEpisodeMediaAssemblyHandlers<{ top: boolean }>(
      (channel, callback) => handlers.set(channel, callback),
      () => client,
      (event) => event.top,
    );
    await expect(
      handlers.get("episode-media-assembly:create-version")!(
        { top: false },
        project,
        episode,
        command,
      ),
    ).rejects.toThrow("not authorized");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("exposes assembly methods from the actual sandbox preload without relative runtime imports", async () => {
    const source = readFileSync(resolve(__dirname, "preload.ts"), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exposed: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    const invoke = vi.fn().mockResolvedValue({ kind: "NOT_FOUND", request_id: requestId });
    runInNewContext(js, {
      exports: {},
      require: (name: string) => {
        if (name !== "electron") throw new Error(`Unexpected preload import ${name}`);
        return {
          contextBridge: {
            exposeInMainWorld: (_name: string, bridge: typeof exposed) =>
              Object.assign(exposed, bridge),
          },
          ipcRenderer: { invoke },
        };
      },
    });
    await exposed.readLatestEpisodeMediaAssembly!(project, episode);
    await exposed.createEpisodeMediaAssemblyVersion!(project, episode, command);
    expect(invoke).toHaveBeenNthCalledWith(1, "episode-media-assembly:latest", project, episode);
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "episode-media-assembly:create-version",
      project,
      episode,
      command,
    );
  });
});
