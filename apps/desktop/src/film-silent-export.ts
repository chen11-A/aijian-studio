import { probeMixSource } from "./film-audio-mix";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";

function seconds(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("INVALID_AUDIO_SOURCE");
  return String(Math.round(value * 1000000) / 1000000);
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
  const probed = await probeMixSource(video, tools, run, signal);
  const durationSeconds = probed.videoDurationSeconds;
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
