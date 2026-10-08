// Host-safe contract checks only. These do not claim native Windows acceptance.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assemblyContent,
  assertAuthorizedHost,
  assertCoreReceipt,
  publicJob,
  syntheticProjectInput,
} from "./windows-external-media-smoke.mjs";

const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "chen11-A/aijian-studio",
  GITHUB_REF: "refs/heads/codex/windows-installer-dev-20261008",
  GITHUB_SHA: "a".repeat(40),
  RUNNER_TEMP: "/runner/temp",
  APPDATA: "/runner/appdata",
  SystemRoot: "/windows",
  AIVORA_ARTIFACT_UPLOAD_ALLOWED: "false",
};
test("acceptance is bound to Windows, exact repository, branch and fresh runner environment", () => {
  assert.doesNotThrow(() => assertAuthorizedHost("win32", env));
  assert.throws(() => assertAuthorizedHost("linux", env));
  for (const key of Object.keys(env))
    assert.throws(() => assertAuthorizedHost("win32", { ...env, [key]: "" }), key);
  assert.throws(() => assertAuthorizedHost("win32", { ...env, GITHUB_REF: "refs/heads/main" }));
  assert.throws(() => assertAuthorizedHost("win32", { ...env, GITHUB_ACTIONS: "false" }));
});
const core = {
  schema_version: 1,
  result: "PASS",
  scope: "installed-development-core-native-smoke",
  candidate_head: env.GITHUB_SHA,
  packaged: true,
  electron: "43.2.0",
  user_data_directory: "/runner/appdata/AIVORA Dev Core",
  resource_directory: "/runner/temp/install/resources",
  renderer_errors: [],
  verified: ["fresh process exact readback", "full process shutdown", "no orphan sidecar"],
};
const validateCore = (value = core) =>
  assertCoreReceipt(value, env.GITHUB_SHA, core.user_data_directory, core.resource_directory);
test("prior core PASS must match exact candidate, profile and installed resources", () => {
  assert.doesNotThrow(() => validateCore());
  for (const [key, value] of Object.entries({
    result: "FAIL",
    packaged: false,
    candidate_head: "b".repeat(40),
    user_data_directory: "/another/profile",
    resource_directory: "/another/install/resources",
    renderer_errors: ["error"],
    electron: "43.1.0",
    scope: "development-simulation",
    verified: [],
  }))
    assert.throws(() => validateCore({ ...core, [key]: value }), key);
});
const asset = (n) => ({
  id: `asset_${String(n).repeat(32)}`,
  latest_version: {
    id: `asv_${String(n).repeat(32)}`,
    sha256: String(n).repeat(64),
  },
});
const assets = { clip_a: asset(1), clip_b: asset(2), bgm: asset(3) };
test("project metadata respects native API bounds independently from landscape assembly", () => {
  assert.deepEqual(syntheticProjectInput(), {
    name: "Windows 外部媒体合成验收",
    aspect_ratio: "9:16",
    target_duration_seconds: 30,
    source_language: "zh-CN",
  });
});
test("saved assembly is exactly 96 frames, B then A, nonzero trims and no embedded dialogue", () => {
  const value = assemblyContent("project", "episode", assets);
  assert.equal(value.project_id, "project");
  assert.equal(value.episode_id, "episode");
  assert.equal(value.canvas_width, 1280);
  assert.equal(value.canvas_height, 720);
  assert.equal(value.total_frames, 96);
  assert.deepEqual(value.sequence_timebase, {
    frame_rate: { num: 24, den: 1 },
    timecode_mode: "NON_DROP_FRAME",
  });
  assert.deepEqual(
    value.visual_segments.map((s) => [
      s.media.asset_id,
      s.start_frame,
      s.end_frame,
      s.source_in_frame,
      s.embedded_audio,
    ]),
    [
      [assets.clip_b.id, 0, 48, 12, "MUTE"],
      [assets.clip_a.id, 48, 96, 24, "MUTE"],
    ],
  );
});
test("BGM unity contract and subtitle literal interval cannot silently become unsupported gain automation", () => {
  const value = assemblyContent("project", "episode", assets);
  assert.equal(value.audio_segments.length, 1);
  assert.deepEqual(value.audio_segments[0], {
    segment_id: "seg_bgm",
    track_kind: "BGM",
    media: {
      asset_id: assets.bgm.id,
      asset_version_id: assets.bgm.latest_version.id,
      sha256: assets.bgm.latest_version.sha256,
    },
    start_frame: 0,
    end_frame: 96,
    source_in_sample: 0,
    script_version_id: null,
    script_block_id: null,
    speaker_id: null,
    delivery: null,
  });
  assert.deepEqual(value.subtitle_segments, [
    {
      segment_id: "seg_literal-subtitle",
      start_frame: 24,
      end_frame: 48,
      text: "第二段草稿 100% [测试]",
      render_profile: "noto-cjk-sc-bottom-v1",
    },
  ]);
});
test("evidence receipts omit arbitrary paths, server messages and unknown fields", () => {
  const value = publicJob({
    operation_id: "operation",
    output_sha256: "a".repeat(64),
    output_path: "/private/path",
    error_message: "unexpected private detail",
    credential: "never-copy",
  });
  assert.equal(value.operation_id, "operation");
  assert.equal(value.output_sha256, "a".repeat(64));
  for (const name of ["output_path", "error_message", "credential"])
    assert.equal(Object.hasOwn(value, name), false);
});
test(
  "CLI fails closed before opening an application on this non-Windows host",
  { skip: process.platform === "win32" },
  () => {
    const script = join(
      dirname(fileURLToPath(import.meta.url)),
      "windows-external-media-smoke.mjs",
    );
    const child = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 10_000 });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Windows acceptance must not execute on another host/);
  },
);
