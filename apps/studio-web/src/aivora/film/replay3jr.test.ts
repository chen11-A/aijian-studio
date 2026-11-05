import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parseReplayManifest, replay3jr, REPLAY_SOURCE_SHA256 } from "./replay3jr";

const source = readFileSync(
  resolve(__dirname, "../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt"),
  "utf8",
);
const digest = createHash("sha256").update(source).digest("hex");
// Synthetic parser fixtures only: these are not provider replies or a real replay result.
const manifest = () => ({
  sourceSha256: REPLAY_SOURCE_SHA256,
  captureDeclaration: "synthetic",
  scenes: [
    {
      sceneNo: 1,
      directorReply: JSON.stringify({ shots: [{ picture: "合成测试镜头", action: "合成动作" }] }),
    },
    {
      sceneNo: 2,
      directorReply: JSON.stringify({ shots: [{ picture: "合成测试镜头", action: "合成动作" }] }),
      actionReply: JSON.stringify({
        beats: Array.from({ length: 19 }, (_, i) => ({ text: `无对应合成动作${i}` })),
      }),
    },
  ],
});

it("hashes the real source fixture while keeping synthetic replies explicitly labeled", () => {
  expect(digest).toBe(REPLAY_SOURCE_SHA256);
  const result = replay3jr(source, manifest(), digest);
  expect(result.captureDeclaration).toBe("synthetic");
  expect(result.provenance).toBe("caller-declared-not-authenticated");
  expect(result.scenes.map((scene) => scene.rawShotCount)).toEqual([1, 1]);
  expect(result.scenes[1]?.actions).toEqual({ input: 19, assigned: 0, unassigned: 19 });
  expect(result.checksPassed).toBe(false);
  expect(JSON.stringify(result)).not.toContain("合成测试镜头");
});

it("rejects missing, duplicate, incomplete or mismatched captures rather than inventing evidence", () => {
  expect(() => parseReplayManifest(null)).toThrow("REPLAY_MANIFEST_REQUIRED");
  expect(() => replay3jr(source, manifest(), "bad")).toThrow("REPLAY_SOURCE_HASH_MISMATCH");
  const capture = manifest();
  capture.scenes.pop();
  expect(() => parseReplayManifest(capture)).toThrow("REPLAY_BOTH_SCENES_REQUIRED");
  const duplicate = manifest();
  duplicate.scenes[1]!.sceneNo = 1;
  expect(() => parseReplayManifest(duplicate)).toThrow("REPLAY_BOTH_SCENES_REQUIRED");
  const absent = manifest();
  absent.scenes[1]!.actionReply = "";
  expect(() => parseReplayManifest(absent)).toThrow("REPLAY_SECOND_ACTION_CAPTURE_REQUIRED");
});

it("treats real-capture as a declaration, not authentication or a passing verdict", () => {
  const capture = manifest();
  capture.captureDeclaration = "real-capture";
  const result = replay3jr(source, capture, digest);
  expect(result.captureDeclaration).toBe("real-capture");
  expect(result.provenance).toBe("caller-declared-not-authenticated");
  expect(result.checksPassed).toBe(false);
});

it("fails explicitly for unsupported director and action replies", () => {
  const director = manifest();
  director.scenes[0]!.directorReply = "无法解析的回复";
  expect(() => replay3jr(source, director, digest)).toThrow("REPLAY_DIRECTOR_UNSUPPORTED");
  const action = manifest();
  action.scenes[1]!.actionReply = "{}";
  expect(() => replay3jr(source, action, digest)).toThrow("REPLAY_ACTION_UNSUPPORTED");
});

it("counts wrapped raw blocks without production compression and rejects silently dropped rows", () => {
  const wrapped = manifest();
  wrapped.scenes[0]!.directorReply = JSON.stringify({
    scenes: [
      { shots: [{ picture: "合成画面一", action: "合成动作" }] },
      { shots: [{ picture: "合成画面二", action: "合成动作" }] },
    ],
  });
  expect(replay3jr(source, wrapped, digest).scenes[0]?.rawShotCount).toBe(2);
  wrapped.scenes[0]!.directorReply = JSON.stringify({ shots: [null] });
  expect(() => replay3jr(source, wrapped, digest)).toThrow("REPLAY_DIRECTOR_UNSUPPORTED");
  const action = manifest();
  action.scenes[1]!.actionReply = JSON.stringify({ beats: [{ text: "合成动作" }, null] });
  expect(() => replay3jr(source, action, digest)).toThrow("REPLAY_ACTION_UNSUPPORTED");
});
