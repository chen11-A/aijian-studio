import type { QcRunner, QcTools } from "./film-export-qc-runtime";

function seconds(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 36000)
    throw new Error("INVALID_AUDIO_SOURCE");
  return String(Math.round(value * 1000000) / 1000000);
}

/** Video-stream duration only. Source channel count is irrelevant to a replacement silence track. */
async function videoStreamSeconds(
  video: string,
  tools: QcTools,
  run: QcRunner,
  signal?: AbortSignal,
) {
  const { stdout } = await run(
    tools.ffprobePath,
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=duration:format=duration",
      "-of",
      "json",
      video,
    ],
    { signal, timeoutMs: 30000, maxBuffer: 65536 },
  );
  const data = JSON.parse(stdout) as {
    streams?: { duration?: unknown }[];
    format?: { duration?: unknown };
  };
  return String(videoDurationFromProbe(data));
}

/** Prefer the video stream clock. Fall back to the container when the stream omits duration. */
export function videoDurationFromProbe(data: {
  streams?: { duration?: unknown }[];
  format?: { duration?: unknown };
}): number {
  const stream = Number(data.streams?.[0]?.duration);
  const container = Number(data.format?.duration);
  const duration = Number.isFinite(stream) && stream > 0 ? stream : container;
  return Number(seconds(duration));
}

/**
 * Replace every source audio stream with one silent AAC track.
 * `durationSeconds` is the probed video-stream length, not a target or a tolerance.
 */
export async function muxSilentAac(
  video: string,
  output: string,
  tools: QcTools,
  run: QcRunner,
  signal?: AbortSignal,
): Promise<number> {
  const durationSeconds = Number(await videoStreamSeconds(video, tools, run, signal));
  await run(
    tools.ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      video,
      "-f",
      "lavfi",
      "-t",
      seconds(durationSeconds),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      output,
    ],
    { signal, timeoutMs: 600000, maxBuffer: 1024 * 1024 },
  );
  return durationSeconds;
}
