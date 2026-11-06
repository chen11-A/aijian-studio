import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { parseReplayManifest, replay3jr, REPLAY_SOURCE_SHA256 } from "../film/replay3jr";
import { sampleFilm, type FilmProject } from "../film/project";
import {
  captureEnabled,
  captureFile,
  capturedReplies,
  recordAgentReply as recordReply,
  captureScope,
  type CaptureScope,
  setCaptureEnabled,
} from "./agent-capture";
import { completeMembershipAgent } from "./agent-workflow";

const novel = readFileSync(
  resolve(__dirname, "../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt"),
  "utf8",
);

afterEach(() => {
  setCaptureEnabled(false);
});

/** Three scenes; scene 2's shots are the ones the action director is asked about. */
function film(): FilmProject {
  const base = sampleFilm();
  base.sourceText = novel;
  base.scenes = ["s1", "s2", "s3"].map((id, index) => ({
    ...base.scenes[0]!,
    id,
    title: `第${index + 1}场`,
  }));
  base.shots = [
    { ...base.shots[0]!, id: "s1-a", sceneId: "s1" },
    { ...base.shots[1]!, id: "s2-a", sceneId: "s2" },
    { ...base.shots[2]!, id: "s2-b", sceneId: "s2" },
  ];
  return base;
}

let scope: CaptureScope;
beforeEach(async () => {
  scope = (await captureScope(film()))!;
});
const recordAgentReply = (...args: Parameters<typeof recordReply>) =>
  recordReply(args[0], args[1], args[2], args[3], scope);

const directed = (scene: string, picture: string) =>
  JSON.stringify({ shots: [{ picture, line: "" }], scene_id: scene });

describe("3JR-B11 (R2-02) keeping the director's and action's replies on this computer", () => {
  it("keeps nothing until it is turned on, and deletes what it kept when turned off", () => {
    expect(captureEnabled()).toBe(false);
    recordAgentReply("director", "场次 id：s1\n剧本", "拆镜头", directed("s1", "雨夜"));
    expect(capturedReplies()).toEqual([]);
    setCaptureEnabled(true);
    recordAgentReply("director", "场次 id：s1\n剧本", "拆镜头", directed("s1", "雨夜"));
    recordAgentReply("writer", "原文", "分场", "{}");
    expect(capturedReplies().map((item) => [item.agent, item.sceneId, item.kind])).toEqual([
      ["director", "s1", "first"],
    ]);
    setCaptureEnabled(false);
    setCaptureEnabled(true);
    expect(capturedReplies()).toEqual([]);
  });

  it("writes a file the replay tool reads: scenes in order, first replies, repairs apart", async () => {
    setCaptureEnabled(true);
    const base = film();
    recordAgentReply("director", "场次 id：s1", "拆镜头", directed("s1", "第一次"));
    recordAgentReply("director", "场次 id：s1", "拆镜头", directed("s1", "重试后的"));
    recordAgentReply(
      "director",
      '{"scene_id":"s1","source_text":"…"}',
      "只补这一场缺失台词与结尾",
      directed("s1", "补拍"),
    );
    recordAgentReply("director", "场次 id：s2", "拆镜头", directed("s2", "仓库"));
    recordAgentReply(
      "action",
      `原文\n镜头：${JSON.stringify([{ id: "s2-a" }, { id: "s2-b" }])}`,
      "按给出的镜头 id 写动作节点。",
      '{"beats":[]}',
    );
    recordAgentReply("director", "场次 id：s3", "拆镜头", directed("s3", "医院"));
    const file = await captureFile(base);
    expect(file?.scenes).toBe(3);
    expect(file?.name).toMatch(/^aivora-排查-\d{12}\.json$/);
    const parsed = JSON.parse(file!.text) as {
      sourceSha256: string;
      scenes: {
        sceneNo: number;
        directorReply: string;
        actionReply?: string;
        directorRepairs?: string[];
      }[];
    };
    expect(parsed.sourceSha256).toBe(REPLAY_SOURCE_SHA256);
    expect(parsed.scenes.map((scene) => scene.sceneNo)).toEqual([1, 2, 3]);
    expect(parsed.scenes[0]!.directorReply).toContain("重试后的");
    expect(parsed.scenes[0]!.directorRepairs).toEqual([directed("s1", "补拍")]);
    expect(parsed.scenes[1]!.actionReply).toBe('{"beats":[]}');
    expect(parsed.scenes[2]!.actionReply).toBeUndefined();
    // The replay tool accepts it (its checks may fail on these toy replies; that is its verdict).
    expect(parseReplayManifest(parsed).scenes).toHaveLength(3);
  });

  it("is null when no director reply was kept for this work", async () => {
    setCaptureEnabled(true);
    expect(await captureFile(film())).toBeNull();
  });

  it("is fed by every successful membership reply", async () => {
    setCaptureEnabled(true);
    const reply = directed("s2", "仓库");
    const bridge = {
      status: vi
        .fn()
        .mockResolvedValue({ provider: "GROK_LOGIN", runtime: "DESKTOP", state: "CONNECTED" }),
      completeText: vi.fn().mockResolvedValue({
        kind: "OK",
        text: reply,
        billingAccountKind: "grok_login",
        model: "grok-4.7",
      }),
      cancelText: vi.fn(),
    } as unknown as GrokLoginBridge;
    await completeMembershipAgent("director", "画风：雨夜\n场次 id：s2\n剧本：…", "拆镜头", {
      bridge,
      modelIds: ["grok-4.7"],
      billingProject: async () => `prj_${"a".repeat(32)}`,
      current: () => true,
      modelsChanged: () => undefined,
      captureFilm: film,
    });
    expect(capturedReplies().at(-1)).toMatchObject({ agent: "director", sceneId: "s2", reply });
  });
});

it("3JR-B11: the replay tool takes a third scene and still needs scenes 1 and 2", () => {
  const scene = (sceneNo: number) => ({
    sceneNo,
    directorReply: JSON.stringify({ shots: [{ picture: "合成测试镜头" }] }),
    ...(sceneNo === 2 ? { actionReply: JSON.stringify({ beats: [] }) } : {}),
  });
  const manifest = (nos: number[]) => ({
    sourceSha256: REPLAY_SOURCE_SHA256,
    captureDeclaration: "synthetic" as const,
    scenes: nos.map(scene),
  });
  expect(parseReplayManifest(manifest([1, 2, 3])).scenes).toHaveLength(3);
  expect(() => parseReplayManifest(manifest([1, 3]))).toThrow("REPLAY_BOTH_SCENES_REQUIRED");
  expect(() => parseReplayManifest(manifest([2, 3]))).toThrow("REPLAY_BOTH_SCENES_REQUIRED");
  expect(() => replay3jr(novel, manifest([1, 2, 9]), REPLAY_SOURCE_SHA256)).toThrow(
    "REPLAY_SOURCE_SCENES_MISSING",
  );
});
