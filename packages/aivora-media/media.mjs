import {
  measureAudioLoudness,
  audioNormalizationFilter,
  assertNormalizedAudio,
} from "./audio-normalize.mjs";
import { mkdtemp, rm, copyFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { escapeFilterPath } from "./filter-path.mjs";
import { run } from "./process.mjs";
import { assHeader, dimensions, escapeAss, wrapText } from "./subtitles.mjs";

const base = ["-hide_banner", "-nostdin", "-y", "-filter_threads", "1"];
const videoCodec = [
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-threads",
  "2",
];
const audioCodec = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"];

async function scratch(work) {
  const dir = await mkdtemp(path.join(tmpdir(), "aivora-media-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function publish(source, destination) {
  // Exclusive copy: never overwrite an existing export or source.
  const output = path.resolve(destination);
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(source, output, 1);
  return output;
}

async function probe(input, ffprobePath) {
  const { stdout } = await run(ffprobePath, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    path.resolve(input),
  ]);
  return JSON.parse(stdout);
}

function assFilter(fontsDir) {
  return `ass=filename=captions.ass${fontsDir === undefined ? "" : `:fontsdir=${escapeFilterPath(path.resolve(fontsDir))}`}`;
}

function fit(orientation) {
  const [w, h] = dimensions(orientation);
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

/** The only user-facing audio control is autoAdjustVolume. */
export async function exportVideo({
  input,
  ass,
  output,
  orientation = "portrait",
  autoAdjustVolume = false,
  fontsDir,
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
}) {
  dimensions(orientation);
  if (typeof autoAdjustVolume !== "boolean") throw new Error("自动调整音量必须为布尔值");
  const source = path.resolve(input);
  const info = await probe(source, ffprobePath);
  if (!info.streams.some((s) => s.codec_type === "video")) throw new Error("输入缺少视频");
  const hasAudio = info.streams.some((s) => s.codec_type === "audio");
  return scratch(async (dir) => {
    // A fixed relative filter filename avoids FFmpeg filter-language path injection.
    await copyFile(path.resolve(ass), path.join(dir, "captions.ass"));
    const audio =
      autoAdjustVolume && hasAudio
        ? await audioNormalizationFilter(source, ffmpegPath, run)
        : "anull";
    const args = [...base, "-i", source];
    if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
    args.push(
      "-map",
      "0:v:0",
      "-map",
      hasAudio ? "0:a:0" : "1:a:0",
      "-vf",
      `${fit(orientation)},${assFilter(fontsDir)}`,
      "-af",
      audio,
      ...videoCodec,
      ...audioCodec,
      "-shortest",
      "-movflags",
      "+faststart",
      "result.mp4",
    );
    await run(ffmpegPath, args, { cwd: dir });
    const result = path.join(dir, "result.mp4");
    if (autoAdjustVolume && hasAudio) {
      assertNormalizedAudio(await measureAudioLoudness(result, ffmpegPath, run));
    }
    return publish(result, output);
  });
}

function titleAss(title, orientation, aiLabel, fontFamily, center) {
  if (typeof title !== "string" || !title.trim()) throw new Error("标题不能为空");
  const [w, h] = dimensions(orientation);
  const lines = wrapText(title, orientation === "portrait" ? 16 : 22);
  if (lines.length > 6) throw new Error("标题最多六行");
  const titleText = lines.map(escapeAss).join("\\N");
  let result = assHeader(orientation, "white", fontFamily);
  result += `Dialogue: 0,0:00:00.00,9:59:59.00,Default,,0,0,0,,{\\an5\\pos(${w / 2},${center ? h / 2 : h * 0.35})\\fs${orientation === "portrait" ? 60 : 72}}${titleText}\n`;
  if (aiLabel)
    result += `Dialogue: 1,0:00:00.00,9:59:59.00,Default,,0,0,0,,{\\an3\\pos(${w - 45},${h - 45})\\fs32}AI 生成\n`;
  return result;
}

export async function createCovers({
  input,
  time,
  title,
  outputDir,
  aiLabel = true,
  fontFamily,
  fontsDir,
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
}) {
  if (!Number.isFinite(time) || time < 0) throw new Error("封面时间无效");
  if (typeof aiLabel !== "boolean") throw new Error("AI 标记开关必须为布尔值");
  const source = path.resolve(input);
  const info = await probe(source, ffprobePath);
  if (!info.streams.some((s) => s.codec_type === "video") || time >= Number(info.format.duration))
    throw new Error("封面时间超出视频范围");
  return scratch(async (dir) => {
    const results = {};
    for (const orientation of ["portrait", "landscape"]) {
      await writeFile(
        path.join(dir, "captions.ass"),
        titleAss(title, orientation, aiLabel, fontFamily, false),
      );
      await run(
        ffmpegPath,
        [
          ...base,
          "-ss",
          String(time),
          "-i",
          source,
          "-vf",
          `${fit(orientation)},setpts=PTS-STARTPTS,${assFilter(fontsDir)}`,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          "-threads",
          "1",
          "-update",
          "1",
          `${orientation}.jpg`,
        ],
        { cwd: dir },
      );
      results[orientation] = await publish(
        path.join(dir, `${orientation}.jpg`),
        path.join(outputDir, `${orientation}.jpg`),
      );
    }
    return results;
  });
}

export async function createTitleCard({
  title,
  output,
  orientation = "portrait",
  fade = false,
  fontFamily,
  fontsDir,
  ffmpegPath = "ffmpeg",
}) {
  const [w, h] = dimensions(orientation);
  if (typeof fade !== "boolean") throw new Error("淡入淡出开关必须为布尔值");
  return scratch(async (dir) => {
    await writeFile(
      path.join(dir, "captions.ass"),
      titleAss(title, orientation, false, fontFamily, true),
    );
    const filter = `${assFilter(fontsDir)}${fade ? ",fade=t=in:st=0:d=0.3,fade=t=out:st=1.7:d=0.3" : ""}`;
    await run(
      ffmpegPath,
      [
        ...base,
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=${w}x${h}:r=30:d=2`,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-vf",
        filter,
        ...videoCodec,
        ...audioCodec,
        "-t",
        "2",
        "-movflags",
        "+faststart",
        "result.mp4",
      ],
      { cwd: dir },
    );
    return publish(path.join(dir, "result.mp4"), output);
  });
}
