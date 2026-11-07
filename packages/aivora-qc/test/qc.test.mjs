/* global AbortController, URL */
import process from "node:process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, mkdir, copyFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { checkExport } from "../index.mjs";
import { intervalIssues, audioIssues } from "../rules.mjs";
import { checkSubtitles } from "../subtitles.mjs";

const ffmpeg = process.env.AIVORA_FFMPEG ?? "ffmpeg";
const ffprobe = process.env.AIVORA_FFPROBE ?? "ffprobe";

function missingMediaTools(t) {
  for (const binary of [ffmpeg, ffprobe]) {
    const check = spawnSync(binary, ["-version"], { encoding: "utf8" });
    if (check.error?.code === "ENOENT") {
      t.skip("未找到 ffmpeg 或 ffprobe，跳过需要本地合成媒体的测试；纯逻辑测试继续运行。");
      return true;
    }
    assert.equal(
      check.status,
      0,
      `${binary} 已找到但无法运行：${check.error?.code ?? check.stderr}`,
    );
  }
  return false;
}

function synth(path, video, audio, duration) {
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", video];
  if (audio) args.push("-f", "lavfi", "-i", audio);
  args.push("-t", String(duration), "-c:v", "mpeg4", "-q:v", "2");
  if (audio) args.push("-c:a", "aac");
  execFileSync(ffmpeg, [...args, "-y", path]);
}
const types = (report) => report.issues.map((issue) => issue.type);

test("inclusive duration boundaries, edge black exemption and full dialogue coverage", () => {
  const check = (kind, start, end, speech = []) =>
    intervalIssues(kind, [{ start, end }], 10, speech);
  assert.equal(check("black", 2, 2.499).length, 0);
  assert.equal(check("black", 2, 2.5).length, 1);
  assert.equal(check("black", 0, 0.5).length, 0);
  assert.equal(check("black", 9.5, 10).length, 0);
  assert.equal(check("black", 0, 0.501).length, 1);
  assert.equal(check("freeze", 2, 3).length, 1);
  assert.equal(check("freeze", 2, 3.9, [{ start: 2, end: 4 }]).length, 0);
  assert.equal(check("freeze", 2, 4, [{ start: 2, end: 4 }]).length, 1);
  assert.equal(check("freeze", 2, 3.5, [{ start: 2, end: 2.5 }]).length, 1);
  assert.equal(
    check("freeze", 2, 3.5, [
      { start: 2, end: 3 },
      { start: 3, end: 4 },
    ]).length,
    0,
  );
  assert.equal(check("silence", 1, 2.999).length, 0);
  assert.equal(check("silence", 1, 3).length, 1);
});

test("loudness and true peak limits are inclusive; undefined loudness is explicit", () => {
  for (const integratedLufs of [-17, -15])
    assert.equal(audioIssues({ integratedLufs, truePeakDbtp: -1 }, 4).length, 0);
  assert.equal(audioIssues({ integratedLufs: -17.01, truePeakDbtp: -0.99 }, 4).length, 2);
  assert.equal(audioIssues({ integratedLufs: null, truePeakDbtp: null }, 4)[0].type, "loudness");
});

test("SRT handles BOM, CRLF, unordered cues, multiline, tags and adjacent overlap", () => {
  const srt =
    "\ufeff2\r\n00:00:02,000 --> 00:00:04,000\r\n<b>短字幕</b>\r\n\r\n1\r\n00:00:01,000 --> 00:00:03,000\r\n" +
    "宽".repeat(45);
  const report = checkSubtitles(srt, 320, 180);
  assert.deepEqual(report.issues.map((x) => x.type).sort(), [
    "subtitle_line_length",
    "subtitle_overlap",
    "subtitle_safe_area",
  ]);
  assert.equal(report.layout.estimated, true);
  assert.equal(
    checkSubtitles(
      "1\n00:00:00,000 --> 00:00:01,000\na\n\n2\n00:00:01,000 --> 00:00:02,000\nb",
      320,
      180,
    ).issues.length,
    0,
  );
  assert.throws(() => checkSubtitles("broken", 320, 180), /SRT/);
  assert.throws(() => checkSubtitles("1\n00:00:03,000 --> 00:00:02,000\na", 320, 180), /SRT/);
  assert.ok(
    checkSubtitles(
      "1\n00:00:00,000 --> 00:00:01,000\n" + Array(20).fill("字").join("\n"),
      320,
      180,
    ).issues.some((x) => x.type === "subtitle_safe_area"),
  );
});

test("real ffmpeg synthetic fixtures and CLI", async (t) => {
  if (missingMediaTools(t)) return;
  const dir = await mkdtemp(join(tmpdir(), "aivora-qc-"));
  try {
    const media = join(dir, "合成 video.mp4");
    synth(
      media,
      "testsrc2=s=160x90:r=20,drawbox=color=black:t=fill:enable='between(t,1,1.65)'",
      "sine=frequency=440:sample_rate=48000,volume=0:enable='gte(t,2)'",
      5,
    );
    const report = await checkExport(media);
    assert.deepEqual(
      (await checkExport(media)).issues.map((entry) => entry.id),
      report.issues.map((entry) => entry.id),
    );
    assert.ok(types(report).includes("black"));
    assert.ok(types(report).includes("silence"));
    assert.ok(types(report).includes("loudness"));
    const black = report.issues.find((x) => x.type === "black");
    assert.ok(Math.abs(black.time - 1) < 0.06);
    const silence = report.issues.find((x) => x.type === "silence");
    assert.ok(Math.abs(silence.time - 2) < 0.1);
    assert.ok(silence.end > 4.9);
    for (const issue of report.issues) {
      assert.equal(typeof issue.time, "number");
      assert.ok(issue.message && issue.suggestion);
    }
    const still = join(dir, "still.mp4");
    synth(still, "color=c=blue:s=160x90:r=20", null, 1.5);
    assert.ok(types(await checkExport(still)).includes("freeze"));
    assert.ok(
      !types(await checkExport(still, { dialogue: [{ start: 0, end: 1.5 }] })).includes("freeze"),
    );
    const missing = join(dir, "missing.mp4");
    synth(missing, "testsrc2=s=160x90:r=20", null, 2.5);
    assert.deepEqual(types(await checkExport(missing)), ["no_audio"]);
    const silent = join(dir, "silent.mp4");
    synth(silent, "testsrc2=s=160x90:r=20", "anullsrc=r=48000:cl=stereo", 2.5);
    const silentReport = await checkExport(silent);
    assert.equal(silentReport.audio.integratedLufs, null);
    assert.ok(types(silentReport).includes("silence"));
    const high = join(dir, "high.mp4");
    synth(high, "testsrc2=s=160x90:r=20", "sine=frequency=1000:sample_rate=48000,volume=8", 3);
    assert.ok(types(await checkExport(high)).includes("true_peak"));
    const srt = join(dir, "captions.srt");
    await writeFile(srt, "1\n00:00:00,000 --> 00:00:01,000\n" + "宽".repeat(45));
    const cli = JSON.parse(
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL("../cli.mjs", import.meta.url)), media, "--srt", srt],
        { encoding: "utf8" },
      ),
    );
    assert.ok(types(cli).includes("subtitle_safe_area"));
    await assert.rejects(checkExport(join(dir, "absent.mp4")));
    await assert.rejects(checkExport(media, { dialogue: [{ start: 2, end: 1 }] }), /dialogue/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(checkExport(media, { signal: controller.signal }));
    await assert.rejects(checkExport(media, { timeoutMs: 1 }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("synthetic edge black runs, full black EOF, silence at start and valid loudness", async (t) => {
  if (missingMediaTools(t)) return;
  const dir = await mkdtemp(join(tmpdir(), "aivora-qc-boundaries-"));
  try {
    for (const [name, video, expected] of [
      [
        "edges",
        "testsrc2=s=160x90:r=20,drawbox=color=black:t=fill:enable='lt(t,0.5)+gte(t,2.5)'",
        0,
      ],
      ["long-start", "testsrc2=s=160x90:r=20,drawbox=color=black:t=fill:enable='lt(t,0.6)'", 1],
      ["long-end", "testsrc2=s=160x90:r=20,drawbox=color=black:t=fill:enable='gte(t,2.4)'", 1],
      ["all-black", "color=c=black:s=160x90:r=20", 1],
    ]) {
      const path = join(dir, name + ".mp4");
      synth(path, video, null, 3);
      assert.equal(
        (await checkExport(path)).issues.filter((x) => x.type === "black").length,
        expected,
        name,
      );
    }
    const normal = join(dir, "normal.mp4");
    synth(normal, "testsrc2=s=160x90:r=20", "sine=frequency=1000:sample_rate=48000,volume=1.8", 3);
    assert.deepEqual(types(await checkExport(normal)), []);
    const startSilence = join(dir, "start-silence.mp4");
    synth(
      startSilence,
      "testsrc2=s=160x90:r=20",
      "sine=frequency=1000:sample_rate=48000,volume=0:enable='lt(t,2.2)'",
      3,
    );
    const silence = (await checkExport(startSilence)).issues.find((x) => x.type === "silence");
    assert.ok(silence.time < 0.01 && silence.end > 2.1);
    const corrupt = join(dir, "corrupt.mp4");
    await writeFile(corrupt, "not video");
    await assert.rejects(checkExport(corrupt), /ffprobe/);
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL("../cli.mjs", import.meta.url)), normal, "--invalid"],
        { stdio: "pipe" },
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pure validation, empty subtitles and CLI help do not require media tools", async () => {
  await assert.rejects(checkExport(""), /mp4Path/);
  await assert.rejects(checkExport("not-used", { timeoutMs: 0 }), /timeoutMs/);
  await assert.rejects(checkExport("."), /常规文件/);
  assert.deepEqual(checkSubtitles("", 320, 180).issues, []);
  assert.throws(() => checkSubtitles("1\n00:70:00,000 --> 00:00:01,000\na", 320, 180), /时间码/);
  assert.throws(() => checkSubtitles("", 320, 180, { fontSizePx: -1 }), /subtitleLayout/);
  assert.throws(() => checkSubtitles("", 320, 180, { safeMargin: 0.5 }), /subtitleLayout/);
  const cliPath = fileURLToPath(new URL("../cli.mjs", import.meta.url));
  assert.match(execFileSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" }), /用法/);
  assert.throws(() => execFileSync(process.execPath, [cliPath], { stdio: "pipe" }));
  await assert.rejects(checkExport("unused", { dialogue: [{ start: 2, end: 1 }] }), /dialogue/);
  await assert.rejects(checkExport("unused", { ffmpegPath: "" }), /工具路径/);
});

test("audio-only media, missing tail and CLI options", async (t) => {
  if (missingMediaTools(t)) return;
  const cliPath = fileURLToPath(new URL("../cli.mjs", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "aivora-qc-audio-"));
  try {
    const audioOnly = join(dir, "audio.mp4");
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "1",
      "-c:a",
      "aac",
      audioOnly,
    ]);
    await assert.rejects(checkExport(audioOnly), /视频轨/);
    const video = join(dir, "tail.mp4");
    // Short audio track: absence after 0.5 seconds must be included in silence QC.
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=160x90:r=20:d=3",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.5",
      "-c:v",
      "mpeg4",
      "-c:a",
      "aac",
      video,
    ]);
    const silence = (await checkExport(video)).issues.find((x) => x.type === "silence");
    assert.ok(silence.time < 0.6 && silence.end === 3);
    const dialoguePath = join(dir, "dialogue.json");
    const layoutPath = join(dir, "layout.json");
    await writeFile(dialoguePath, '[{"start":0,"end":3}]');
    await writeFile(layoutPath, '{"fontSizePx":4}');
    const output = execFileSync(
      process.execPath,
      [cliPath, video, "--dialogue", dialoguePath, "--layout", layoutPath],
      { encoding: "utf8" },
    );
    assert.equal(JSON.parse(output).schemaVersion, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("portrait sizing and stable actionable plain-language issues", () => {
  const caption = (count) => `1\n00:00:03,000 --> 00:00:04,000\n${"字".repeat(count)}`;
  assert.equal(checkSubtitles(caption(15), 1080, 1920).layout.fontSizePx, 54);
  assert.deepEqual(checkSubtitles(caption(15), 1080, 1920).issues, []);
  assert.deepEqual(
    checkSubtitles(caption(20), 1080, 1920).issues.map((x) => x.type),
    ["subtitle_safe_area"],
  );
  const issues = [
    ...["black", "freeze", "silence"].flatMap((type) =>
      intervalIssues(type, [{ start: 3, end: 6 }], 10),
    ),
    ...audioIssues({ present: false, integratedLufs: null, truePeakDbtp: null }, 10),
    ...audioIssues({ integratedLufs: -20, truePeakDbtp: 0 }, 10),
    ...audioIssues({ integratedLufs: -12, truePeakDbtp: -2 }, 10),
    ...audioIssues({ integratedLufs: null, truePeakDbtp: null }, 10),
    ...checkSubtitles(caption(45) + "\n\n2\n00:00:03,500 --> 00:00:05,000\n短", 1080, 1920).issues,
  ];
  for (const entry of issues) {
    assert.ok(entry.id.startsWith(entry.type + "-"));
    assert.ok(["warn", "block"].includes(entry.severity));
    assert.match(entry.timeLabel, /^第 \d+\.\d 秒$/);
    assert.ok(
      ["trim", "regenerate_shot", "add_audio", "adjust_volume", "edit_subtitle", "none"].includes(
        entry.action,
      ),
    );
    assert.ok(Object.keys(entry.detail).length > 0);
    assert.doesNotMatch(
      entry.message + entry.suggestion,
      /LUFS|dBTP|真峰值|归一化|限制器|全角等效|假设布局|帧/,
    );
  }
  const first = intervalIssues("black", [{ start: 3, end: 4 }], 10)[0];
  assert.equal(first.id, intervalIssues("black", [{ start: 3, end: 4 }], 10)[0].id);
  assert.equal(first.severity, "warn");
  const duplicateTimes = checkSubtitles(
    caption(45) + "\n\n2\n00:00:03,000 --> 00:00:04,000\n" + "字".repeat(45),
    1080,
    1920,
  ).issues;
  assert.equal(new Set(duplicateTimes.map((x) => x.id)).size, duplicateTimes.length);
});

test("missing probe returns FFMPEG_NOT_FOUND even without installed tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aivora-qc-missing-tool-"));
  try {
    const input = join(dir, "unused.mp4");
    await writeFile(input, "not decoded because probe is absent");
    await assert.rejects(checkExport(input, { ffprobePath: join(dir, "absent-probe") }), {
      code: "FFMPEG_NOT_FOUND",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("explicit and environment tool paths, including spaces and Chinese characters", async (t) => {
  if (missingMediaTools(t)) return;
  const dir = await mkdtemp(join(tmpdir(), "aivora-qc-tools-"));
  try {
    const spaced = join(dir, "含空格 和中文");
    await mkdir(spaced);
    // Resolve actual executable locations without assuming /usr/bin or a shell.
    const { default: which } = await import("./which.mjs");
    const extension = process.platform === "win32" ? ".exe" : "";
    const ffmpegPath = join(spaced, "ffmpeg" + extension);
    const ffprobePath = join(spaced, "ffprobe" + extension);
    await copyFile(which(ffmpeg), ffmpegPath);
    await copyFile(which(ffprobe), ffprobePath);
    await chmod(ffmpegPath, 0o755);
    await chmod(ffprobePath, 0o755);
    const video = join(dir, "sample.mp4");
    synth(video, "testsrc2=s=160x90:r=20", null, 1);
    const options = { ffmpegPath, ffprobePath };
    assert.deepEqual(types(await checkExport(video, options)), ["no_audio"]);
    await assert.rejects(checkExport(video, { ...options, ffmpegPath: join(dir, "absent") }), {
      code: "FFMPEG_NOT_FOUND",
    });
    const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
    const invalidEnv = {
      ...process.env,
      AIVORA_FFMPEG: join(dir, "bad"),
      AIVORA_FFPROBE: join(dir, "bad"),
    };
    const output = execFileSync(
      process.execPath,
      [cli, video, "--ffmpeg", ffmpegPath, "--ffprobe", ffprobePath],
      { encoding: "utf8", env: invalidEnv },
    );
    assert.deepEqual(types(JSON.parse(output)), ["no_audio"]);
    const envOutput = execFileSync(process.execPath, [cli, video], {
      encoding: "utf8",
      env: { ...process.env, PATH: dir, AIVORA_FFMPEG: ffmpegPath, AIVORA_FFPROBE: ffprobePath },
    });
    assert.deepEqual(types(JSON.parse(envOutput)), ["no_audio"]);
    const invalidEnvironment = spawnSync(process.execPath, [cli, video], {
      encoding: "utf8",
      env: invalidEnv,
    });
    assert.equal(invalidEnvironment.status, 1);
    assert.equal(JSON.parse(invalidEnvironment.stderr).error.code, "FFMPEG_NOT_FOUND");
    const failed = spawnSync(process.execPath, [cli, video, "--ffprobe", join(dir, "absent")], {
      encoding: "utf8",
    });
    assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stderr).error.code, "FFMPEG_NOT_FOUND");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("issue IDs use two decimal places and audio actions match repair intent", () => {
  for (const [type, start, end, expected] of [
    ["freeze", 2.97, 4.2, "freeze-2.97-4.20"],
    ["black", 3, 3.633333, "black-3.00-3.63"],
  ]) {
    const check = () => intervalIssues(type, [{ start, end }], 10)[0];
    assert.equal(check().id, expected);
    assert.equal(check().id, check().id);
    assert.equal(check().end, end); // ID formatting must not reduce measurement precision.
  }
  const silence = intervalIssues("silence", [{ start: 1, end: 3 }], 10)[0];
  const noAudio = audioIssues({ present: false }, 4.2)[0];
  assert.equal(silence.action, "add_audio");
  assert.equal(noAudio.action, "add_audio");
  assert.equal(noAudio.id, "no_audio-0.00-4.20");
  assert.equal(silence.severity, "warn");
  assert.equal(noAudio.severity, "warn");
  const audio = audioIssues({ integratedLufs: -20, truePeakDbtp: 0 }, 4);
  assert.equal(audio.find((entry) => entry.type === "loudness").severity, "warn");
  assert.equal(audio.find((entry) => entry.type === "true_peak").severity, "block");
  assert.ok(audio.every((entry) => entry.action === "adjust_volume"));
});

test("observes final technical facts from the existing probe without extra processes or schema changes", async (t) => {
  if (missingMediaTools(t)) return;
  const root = await mkdtemp(join(tmpdir(), "qc-facts-"));
  try {
    const path = join(root, "facts.mp4");
    synth(path, "testsrc=size=160x90:rate=24", "sine=frequency=731:sample_rate=48000", 1);
    const observations = [],
      started = [],
      closed = [];
    const report = await checkExport(path, {
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe,
      onMediaInfo: (value) => observations.push(value),
      onProcess: (pid, done) => (done ? closed : started).push(pid),
    });
    assert.equal(observations.length, 1);
    const facts = observations[0];
    assert.equal(facts.video.width, 160);
    assert.equal(facts.video.height, 90);
    assert.equal(facts.video.averageFrameRate, 24);
    assert.equal(facts.video.codec, "mpeg4");
    assert.equal(facts.audioTracks[0].codec, "aac");
    assert.equal(facts.audioTracks[0].sampleRate, 48000);
    assert.equal(facts.video.colorSpace, null);
    assert.equal(started.length, 3); // existing probe + visual detector + audio detector only
    assert.equal(closed.length, 3);
    assert.deepEqual(Object.keys(report).sort(), [
      "assumptions",
      "audio",
      "issues",
      "media",
      "schemaVersion",
    ]);
    assert.equal(JSON.stringify(facts).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
