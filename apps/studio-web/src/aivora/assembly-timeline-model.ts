import type { AssemblyContent } from "./adapters/episodeMediaAssembly";
import { parseTimecode } from "./timeline-model";

export function assemblyTimecodeFrame(value: string, content: AssemblyContent): number | null {
  const { frame_rate: rate, timecode_mode: mode } = content.sequence_timebase;
  if (
    content.total_frames < 1 ||
    (mode === "DROP_FRAME" && (rate.num !== 30000 || rate.den !== 1001))
  )
    return null;
  return parseTimecode(value, content.total_frames - 1, rate.num / rate.den, mode);
}

export function timelinePointerFrame(pixel: number, scale: number, total: number): number {
  if (!Number.isFinite(pixel) || !Number.isFinite(scale) || scale <= 0 || total < 1) return 0;
  return Math.max(0, Math.min(total - 1, Math.floor(pixel / scale)));
}

/** Display-only interval packing. The original segment order and business content stay intact. */
export function timelineLanes<
  T extends { start_frame: number; end_frame: number; segment_id: string },
>(segments: readonly T[]): T[][] {
  const lanes: T[][] = [];
  const ends: number[] = [];
  for (const item of [...segments].sort(
    (a, b) =>
      a.start_frame - b.start_frame ||
      a.end_frame - b.end_frame ||
      a.segment_id.localeCompare(b.segment_id),
  )) {
    let lane = ends.findIndex((end) => end <= item.start_frame);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane]!.push(item);
    ends[lane] = item.end_frame;
  }
  return lanes;
}
