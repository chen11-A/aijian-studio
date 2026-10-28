import { spawn } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { joinClips, mixMusic } from "./film-library";

const requested = process.env.AIVORA_FFMPEG ?? "";
const ffmpeg = requested || "/usr/bin/ffmpeg";
const ffprobe = process.env.AIVORA_FFPROBE || join(dirname(ffmpeg), "ffprobe");
const probeBin = existsSync(ffprobe) ? ffprobe : "ffprobe";
const runnable = existsSync(ffmpeg);
const required = requested.length > 0;
const fixtures = join(__dirname, "../fixtures");

function run(bin: string, args: string[]): Promise<string> {
  const lib = join(dirname(ffmpeg), "..", "lib");
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [lib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
      },
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(out || `${bin} failed`));
    });
  });
}

async function duration(path: string): Promise<number> {
  const text = await run(probeBin, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    path,
  ]);
  return Number(text.trim());
}

function meanVolume(log: string): number {
  const match = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(log);
  if (!match) throw new Error(log.slice(-400));
  return Number(match[1]);
}

describe.skipIf(!runnable && !required)("real ffmpeg", () => {
  it("uses the ffmpeg CI configured", () => {
    if (required && !runnable) throw new Error(`AIVORA_FFMPEG is set but missing: ${requested}`);
    expect(runnable).toBe(true);
  });
  it("joins two generated shots on a path with Chinese and spaces", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-中文 路径-"));
    const shotA = join(root, "镜头 1.mp4");
    const shotB = join(root, "镜头 2.mp4");
    copyFileSync(join(fixtures, "shot-a.mp4"), shotA);
    copyFileSync(join(fixtures, "shot-b.mp4"), shotB);
    const destination = join(root, "成片 输出.mp4");
    mkdirSync(dirname(destination), { recursive: true });
    const before = (await duration(shotA)) + (await duration(shotB));
    await joinClips([shotA, shotB], destination, (args) => run(ffmpeg, args).then(() => undefined));
    const after = await duration(destination);
    expect(after).toBeGreaterThan(before - 0.4);
    expect(after).toBeLessThan(before + 0.4);
  });

  it("lowers music under dialogue and leaves the dialogue level alone", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-duck-"));
    const video = join(root, "dialogue.mp4");
    const music = join(root, "bed.wav");
    await run(ffmpeg, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:duration=2,volume=0:enable='gte(t,1)',aformat=channel_layouts=stereo",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x180:r=24:d=2",
      "-shortest",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      video,
    ]);
    await run(ffmpeg, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=4000:duration=2",
      "-ac",
      "2",
      music,
    ]);
    const dry = await run(ffmpeg, [
      "-i",
      video,
      "-af",
      "atrim=0:1,highpass=f=700,lowpass=f=1400,volumedetect",
      "-f",
      "null",
      "-",
    ]);
    const original = join(root, "dry.mp4");
    copyFileSync(video, original);
    await mixMusic(video, music, (args) => run(ffmpeg, args).then(() => undefined), -14);
    const bed = join(root, "bed.wav");
    await run(ffmpeg, [
      "-y",
      "-i",
      video,
      "-i",
      original,
      "-filter_complex",
      "[1:a]volume=-1[inv];[0:a][inv]amix=inputs=2:normalize=0:duration=shortest[a]",
      "-map",
      "[a]",
      bed,
    ]);
    const under = await run(ffmpeg, [
      "-i",
      bed,
      "-af",
      "atrim=0.35:0.9,highpass=f=3000,lowpass=f=5000,volumedetect",
      "-f",
      "null",
      "-",
    ]);
    const away = await run(ffmpeg, [
      "-i",
      bed,
      "-af",
      "atrim=1.2:1.9,highpass=f=3000,lowpass=f=5000,volumedetect",
      "-f",
      "null",
      "-",
    ]);
    const spoken = await run(ffmpeg, [
      "-i",
      video,
      "-af",
      "atrim=0:1,highpass=f=700,lowpass=f=1400,volumedetect",
      "-f",
      "null",
      "-",
    ]);
    expect(meanVolume(under)).toBeLessThan(meanVolume(away) - 6);
    expect(Math.abs(meanVolume(spoken) - meanVolume(dry))).toBeLessThan(3);
  });
});
