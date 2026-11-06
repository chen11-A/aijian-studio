import type { FilmRangePlan } from "@aijian/contracts/film-range";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
export type RangeMedia = { duration: number; width: number; height: number; fps: string };
export async function rangeMedia(path: string, tools: QcTools, run: QcRunner): Promise<RangeMedia> {
  const result = await run(
    tools.ffprobePath,
    [
      "-protocol_whitelist",
      "file,pipe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration:frame=best_effort_timestamp_time:format=duration",
      "-read_intervals",
      "%+601",
      "-of",
      "json",
      path,
    ],
    { maxBuffer: 3 * 1024 * 1024, timeoutMs: 30000 },
  );
  const data = JSON.parse(result.stdout);
  const video = data.streams?.[0];
  if (
    !video ||
    !Number.isFinite(Number(data.format?.duration)) ||
    !["24/1", "25/1", "30/1"].includes(video.r_frame_rate) ||
    video.avg_frame_rate !== video.r_frame_rate ||
    !Number.isInteger(video.width) ||
    !Number.isInteger(video.height) ||
    video.width % 2 ||
    video.height % 2
  )
    throw new Error("UNSUPPORTED_SOURCE");
  const duration = Number(data.format.duration);
  const fps = Number(video.r_frame_rate.split("/")[0]);
  const timestamps: unknown[] = Array.isArray(data.frames)
    ? data.frames.map(
        (frame: { best_effort_timestamp_time?: unknown }) => frame.best_effort_timestamp_time,
      )
    : [];
  // Averages do not prove CFR. Inspect every bounded decoded timestamp; refuse long,
  // truncated, discontinuous, duplicate and variable-rate sources before paid dispatch.
  if (
    duration <= 0 ||
    duration > 600 ||
    timestamps.length < 2 ||
    timestamps.length > 18000 ||
    (video.nb_frames && Number(video.nb_frames) !== timestamps.length) ||
    timestamps.some(
      (time, index) =>
        !Number.isFinite(Number(time)) || Math.abs(Number(time) - index / fps) > 0.00001,
    )
  )
    throw new Error("UNSUPPORTED_SOURCE");
  const visualDuration = timestamps.length / fps;
  if (
    Math.abs(duration - visualDuration) > 1 / fps ||
    (video.duration !== undefined &&
      (!Number.isFinite(Number(video.duration)) ||
        Math.abs(Number(video.duration) - visualDuration) > 1 / fps))
  )
    throw new Error("UNSUPPORTED_SOURCE");
  return {
    duration: visualDuration,
    width: video.width,
    height: video.height,
    fps: video.r_frame_rate,
  };
}
/** Real decode/trim/concat; all generated audio is discarded. Original audio remains on
 * its original clock, including dialogue. No dialogue replacement or word timing is claimed. */
export async function renderFilmRange(
  source: string,
  segment: string,
  output: string,
  plan: FilmRangePlan,
  tools: QcTools,
  run: QcRunner,
  signal?: AbortSignal,
  audioSource = source,
) {
  const media = await rangeMedia(source, tools, run);
  const replacement = await rangeMedia(segment, tools, run);
  if (media.fps !== `${plan.frameRate}/1`) throw new Error("UNSUPPORTED_SOURCE");
  const { start, end } = plan.effective;
  if (
    Math.abs(media.duration - plan.duration) > 1 / plan.frameRate ||
    replacement.duration + 1 / plan.frameRate < end - start ||
    media.width * replacement.height !== media.height * replacement.width
  )
    throw new Error("UNSUPPORTED_SOURCE");
  const filters: string[] = [];
  const labels: string[] = [];
  if (start > 0) {
    filters.push(`[0:v]trim=end=${start},setpts=PTS-STARTPTS,setsar=1,settb=AVTB[a]`);
    labels.push("[a]");
  }
  filters.push(
    `[1:v]trim=duration=${end - start},setpts=PTS-STARTPTS,scale=${media.width}:${media.height},setsar=1,fps=${plan.frameRate},settb=AVTB[b]`,
  );
  labels.push("[b]");
  if (end < media.duration - 1 / plan.frameRate) {
    filters.push(`[0:v]trim=start=${end},setpts=PTS-STARTPTS,setsar=1,settb=AVTB[c]`);
    labels.push("[c]");
  }
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0[v]`);
  await run(
    tools.ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-n",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      source,
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      segment,
      ...(audioSource !== source ? ["-protocol_whitelist", "file,pipe", "-i", audioSource] : []),
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[v]",
      "-map",
      audioSource === source ? "0:a?" : "2:a?",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(plan.frameRate),
      "-c:a",
      "copy",
      "-t",
      String(plan.duration),
      "-movflags",
      "+faststart",
      output,
    ],
    { signal, timeoutMs: 120000 },
  );
  const result = await rangeMedia(output, tools, run);
  if (Math.abs(result.duration - plan.duration) > 1 / plan.frameRate)
    throw new Error("SPLICE_FAILED");
}
