/* global AbortController */
import process from "node:process";
import { URL } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { checkExport } from "../index.mjs";
import { intervalIssues, audioIssues } from "../rules.mjs";
import { checkSubtitles } from "../subtitles.mjs";

function synth(path, video, audio, duration) {
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", video];
  if (audio) args.push("-f", "lavfi", "-i", audio);
  args.push("-t", String(duration), "-c:v", "mpeg4", "-q:v", "2");
  if (audio) args.push("-c:a", "aac");
  execFileSync("ffmpeg", [...args, "-y", path]);
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

test("real ffmpeg synthetic fixtures and CLI", async () => {
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
    assert.ok(types(await checkExport(missing)).includes("silence"));
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
        [new URL("../cli.mjs", import.meta.url).pathname, media, "--srt", srt],
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

test("synthetic edge black runs, full black EOF, silence at start and valid loudness", async () => {
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
        [new URL("../cli.mjs", import.meta.url).pathname, normal, "--invalid"],
        { stdio: "pipe" },
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reject invalid options, audio-only media; accept empty subtitles and CLI help", async () => {
  await assert.rejects(checkExport(""), /mp4Path/);
  await assert.rejects(checkExport("not-used", { timeoutMs: 0 }), /timeoutMs/);
  await assert.rejects(checkExport("."), /常规文件/);
  assert.deepEqual(checkSubtitles("", 320, 180).issues, []);
  assert.throws(() => checkSubtitles("1\n00:70:00,000 --> 00:00:01,000\na", 320, 180), /时间码/);
  assert.throws(() => checkSubtitles("", 320, 180, { fontSizePx: -1 }), /subtitleLayout/);
  assert.throws(() => checkSubtitles("", 320, 180, { safeMargin: 0.5 }), /subtitleLayout/);
  const cliPath = new URL("../cli.mjs", import.meta.url).pathname;
  assert.match(execFileSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" }), /用法/);
  assert.throws(() => execFileSync(process.execPath, [cliPath], { stdio: "pipe" }));
  const dir = await mkdtemp(join(tmpdir(), "aivora-qc-audio-"));
  try {
    const audioOnly = join(dir, "audio.mp4");
    execFileSync("ffmpeg", [
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
    execFileSync("ffmpeg", [
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
