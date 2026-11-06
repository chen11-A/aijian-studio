import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

export async function run(binary, args, { signal, timeoutMs = 600000 } = {}) {
  try {
    return await execute(binary, args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs,
      signal,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      const missing = new Error("找不到视频检查工具，请安装工具或在设置中指定正确位置。");
      missing.code = "FFMPEG_NOT_FOUND";
      throw missing;
    }
    // Do not relay raw FFmpeg diagnostics, which may include input paths or subtitle text.
    const failure = new Error(
      `${binary} 检测失败（${error.code ?? (error.killed ? "timeout" : "unknown")}）`,
    );
    failure.code = error.code ?? "MEDIA_TOOL_FAILED";
    throw failure;
  }
}

export function readIntervals(log, type, duration, frameDuration = 0) {
  const intervals = [];
  if (type === "black") {
    for (const match of log.matchAll(
      /black_start:([\d.e+-]+)\s+black_end:([\d.e+-]+)\s+black_duration:/g,
    )) {
      let end = Number(match[2]);
      // blackdetect reports the last frame PTS for a black run reaching EOF.
      if (Math.abs(duration - end - frameDuration) < 1e-5) end = duration;
      intervals.push({ start: Number(match[1]), end });
    }
    return intervals;
  }
  let start;
  const pattern = new RegExp(
    `${type === "freeze" ? "freeze" : "silence"}_(start|end):\\s*([\\d.e+-]+)`,
    "g",
  );
  for (const match of log.matchAll(pattern)) {
    if (match[1] === "start") start = Number(match[2]);
    else if (start !== undefined) {
      intervals.push({ start, end: Number(match[2]) });
      start = undefined;
    }
  }
  if (start !== undefined) intervals.push({ start, end: duration });
  return intervals;
}

export function loudness(log) {
  const match = /\{\s*"input_i"\s*:[\s\S]*?\}/.exec(log);
  if (!match) throw new Error("ffmpeg 未返回 loudnorm 测量结果");
  const measurement = JSON.parse(match[0]);
  const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    integratedLufs: finite(measurement.input_i),
    truePeakDbtp: finite(measurement.input_tp),
  };
}
