import process from "node:process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { run, readIntervals, loudness } from "./media.mjs";
import { intervalIssues, audioIssues } from "./rules.mjs";
import { checkSubtitles } from "./subtitles.mjs";

/** Read-only QC of the first video/audio stream; all times are seconds from export start. */
export async function checkExport(mp4Path, options = {}) {
  const { srtPath, dialogue = [], subtitleLayout = {}, signal, timeoutMs = 600000 } = options;
  if (typeof mp4Path !== "string" || !mp4Path) throw new Error("mp4Path 必须为本地文件路径");
  if (
    !Array.isArray(dialogue) ||
    dialogue.some(
      (range) =>
        !range ||
        !Number.isFinite(range.start) ||
        !Number.isFinite(range.end) ||
        range.start < 0 ||
        range.end <= range.start,
    )
  )
    throw new Error("dialogue 必须为有效的 {start,end} 秒区间数组");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs 必须为正数");
  const ffmpegPath = options.ffmpegPath ?? process.env.AIVORA_FFMPEG ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? process.env.AIVORA_FFPROBE ?? "ffprobe";
  for (const toolPath of [ffmpegPath, ffprobePath]) {
    if (typeof toolPath !== "string" || !toolPath.trim())
      throw new Error("工具路径必须为非空字符串");
  }
  const input = resolve(mp4Path);
  if (!(await stat(input)).isFile()) throw new Error("输入必须为本地常规文件");
  const execution = { signal, timeoutMs, onProcess: options.onProcess };
  const probe = JSON.parse(
    (
      await run(
        ffprobePath,
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", input],
        execution,
      )
    ).stdout,
  );
  const video = probe.streams.find(
    (stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic,
  );
  if (!video) throw new Error("输入缺少视频轨");
  const duration = Number(video.duration ?? probe.format.duration);
  if (!Number.isFinite(duration) || duration <= 0 || !video.width || !video.height)
    throw new Error("无法获取有效视频时长或尺寸");
  // ffmpeg autorotates by default; use display dimensions for subtitle estimates.
  const rotation = Number(
    video.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ??
      video.tags?.rotate ??
      0,
  );
  const sideways = Math.abs(rotation % 180) === 90;
  const width = sideways ? video.height : video.width;
  const height = sideways ? video.width : video.height;
  const [fpsNumerator, fpsDenominator] = (video.avg_frame_rate ?? "0/1").split("/").map(Number);
  const frameDuration = fpsNumerator > 0 ? fpsDenominator / fpsNumerator : 0;
  const subtitles = srtPath
    ? checkSubtitles(await readFile(resolve(srtPath), "utf8"), width, height, subtitleLayout)
    : null;
  const common = [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-v",
    "info",
    "-xerror",
    "-copyts",
    "-i",
    input,
  ];
  const visual = (
    await run(
      ffmpegPath,
      [
        ...common,
        "-map",
        `0:${video.index}`,
        "-an",
        "-vf",
        "setpts=PTS-STARTPTS,blackdetect=d=0:pix_th=0.10:pic_th=0.98,freezedetect=n=-60dB:d=1",
        "-f",
        "null",
        "-",
      ],
      execution,
    )
  ).stderr;
  const issues = ["black", "freeze"].flatMap((type) =>
    intervalIssues(type, readIntervals(visual, type, duration, frameDuration), duration, dialogue),
  );
  const audioStream = probe.streams.find((stream) => stream.codec_type === "audio");
  let audio = { present: Boolean(audioStream), integratedLufs: null, truePeakDbtp: null };
  if (audioStream) {
    const audioLog = (
      await run(
        ffmpegPath,
        [
          ...common,
          "-map",
          `0:${audioStream.index}`,
          "-vn",
          "-af",
          `asetpts=PTS-(${Number(video.start_time ?? 0)})/TB,aresample=async=1:first_pts=0,apad=whole_dur=${duration},atrim=duration=${duration},silencedetect=n=-50dB:d=2,loudnorm=I=-16:TP=-1:print_format=json`,
          "-f",
          "null",
          "-",
        ],
        execution,
      )
    ).stderr;
    audio = { present: true, ...loudness(audioLog) };
    issues.push(
      ...intervalIssues("silence", readIntervals(audioLog, "silence", duration), duration),
    );
  }
  issues.push(...audioIssues(audio, duration), ...(subtitles?.issues ?? []));
  issues.sort((a, b) => a.time - b.time || a.type.localeCompare(b.type));
  return {
    schemaVersion: 1,
    media: { duration, width, height },
    audio,
    assumptions: {
      streams: "首条非封面视频轨和首条音轨，时间相对成片起点；不检测其他音轨或烧录字幕。",
      black: "blackdetect: pix_th=0.10, pic_th=0.98；片头/片尾≤0.5秒黑区间作为短淡入淡出代理豁免。",
      freeze: "freezedetect: noise=-60dB；整个静止区间被台词时间段覆盖才放宽至2秒。",
      silence: "silencedetect: 全声道≤−50dB，音轨空缺视为静音，缺少整条音轨单独报告no_audio。",
      loudness: "loudnorm 输入测量；全片问题time=0；无法测量/负无穷用null表示。",
      subtitleLayout: subtitles?.layout ?? null,
    },
    issues,
  };
}
