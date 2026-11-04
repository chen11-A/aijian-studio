import { subtitleTrackProblem } from "./assemblySubtitles";
import type { AssetVersion, MediaAsset } from "./assetLibrary";
import type {
  AssemblyAudioSegment,
  AssemblyContent,
  AssemblyMediaRef,
  AssemblyVisualSegment,
} from "./episodeMediaAssembly";

export type AssemblySegment = AssemblyVisualSegment | AssemblyAudioSegment;
export const ASSEMBLY_TIMEBASES: Array<{
  label: string;
  value: AssemblyContent["sequence_timebase"];
}> = [
  {
    label: "23.976 (24000/1001)",
    value: { frame_rate: { num: 24000, den: 1001 }, timecode_mode: "NON_DROP_FRAME" },
  },
  { label: "24", value: { frame_rate: { num: 24, den: 1 }, timecode_mode: "NON_DROP_FRAME" } },
  { label: "25", value: { frame_rate: { num: 25, den: 1 }, timecode_mode: "NON_DROP_FRAME" } },
  {
    label: "29.97 (30000/1001)",
    value: { frame_rate: { num: 30000, den: 1001 }, timecode_mode: "NON_DROP_FRAME" },
  },
  {
    label: "29.97 (30000/1001) DF",
    value: { frame_rate: { num: 30000, den: 1001 }, timecode_mode: "DROP_FRAME" },
  },
];

export function assemblyMediaKey(media: AssemblyMediaRef): string {
  return `${media.asset_id}/${media.asset_version_id}/${media.sha256}`;
}

export function findAssemblyAsset(
  library: MediaAsset[] | null,
  media: AssemblyMediaRef,
): AssetVersion | undefined {
  return library
    ?.find((asset) => asset.id === media.asset_id)
    ?.versions.find(
      (version) => version.id === media.asset_version_id && version.sha256 === media.sha256,
    );
}

export function assemblySeconds(frames: number, content: AssemblyContent): number {
  const { num, den } = content.sequence_timebase.frame_rate;
  return (frames * den) / num;
}

/** Sample offsets use the verified source rate, never an assumed 48 kHz rate. */
export function assemblySamples(
  frames: number,
  sampleRate: number,
  content: AssemblyContent,
): number {
  const { num, den } = content.sequence_timebase.frame_rate;
  const numerator = BigInt(frames) * BigInt(sampleRate) * BigInt(den);
  return Number((numerator + BigInt(Math.floor(num / 2))) / BigInt(num));
}

export function emptyAssembly(projectId: string, episodeId: string): AssemblyContent {
  return {
    schema_version: "1.0.0",
    project_id: projectId,
    episode_id: episodeId,
    sequence_timebase: { frame_rate: { num: 25, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
    canvas_width: 1920,
    canvas_height: 1080,
    total_frames: 0,
    visual_segments: [],
    audio_segments: [],
    subtitle_segments: [],
  };
}

export function newAssemblySegmentId(): string {
  return `seg_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** V1 is a contiguous cut track. Audio and subtitle positions stay absolute. */
export function reflowVisual(
  content: AssemblyContent,
  segments: AssemblyVisualSegment[],
): AssemblyContent {
  let cursor = 0;
  const visual_segments = segments.map((segment) => {
    const duration = segment.end_frame - segment.start_frame;
    const start_frame = cursor;
    cursor += duration;
    return { ...segment, start_frame, end_frame: cursor };
  });
  return { ...content, visual_segments, total_frames: cursor };
}

export function assemblyEditProblem(content: AssemblyContent): string | null {
  if (
    !Number.isSafeInteger(content.total_frames) ||
    content.total_frames < 0 ||
    content.total_frames > 1_000_000
  )
    return "总时长必须在 1,000,000 帧以内。";
  if (
    [content.visual_segments, content.audio_segments, content.subtitle_segments].some(
      (track) => track.length > 1000,
    )
  )
    return "每类轨道最多可保存 1,000 个片段。";
  const ids = new Set<string>();
  for (const segment of [
    ...content.visual_segments,
    ...content.audio_segments,
    ...content.subtitle_segments,
  ]) {
    if (ids.has(segment.segment_id)) return "片段编号重复。";
    ids.add(segment.segment_id);
    if (
      !Number.isSafeInteger(segment.start_frame) ||
      !Number.isSafeInteger(segment.end_frame) ||
      segment.start_frame < 0 ||
      segment.end_frame <= segment.start_frame
    )
      return "入点和时长必须是有效整数帧。";
    if (segment.end_frame > content.total_frames)
      return "声音或字幕超过画面结尾；请先缩短或移除这些片段。";
    if (
      "source_in_frame" in segment &&
      (!Number.isSafeInteger(segment.source_in_frame) || segment.source_in_frame < 0)
    )
      return "视频源入点必须是非负整数帧。";
    if (
      "source_in_sample" in segment &&
      (!Number.isSafeInteger(segment.source_in_sample) || segment.source_in_sample < 0)
    )
      return "音频源入点必须是非负整数采样。";
  }
  return subtitleTrackProblem(content);
}

export function splitAssemblySegment(
  content: AssemblyContent,
  id: string,
  at: number,
  newId: string,
  sampleRate?: number,
): AssemblyContent | null {
  const visual = content.visual_segments.find((segment) => segment.segment_id === id);
  const audio = content.audio_segments.find((segment) => segment.segment_id === id);
  const segment = visual ?? audio;
  if (!segment || !Number.isSafeInteger(at) || at <= segment.start_frame || at >= segment.end_frame)
    return null;
  if (visual) {
    const right = {
      ...visual,
      segment_id: newId,
      start_frame: at,
      source_in_frame:
        visual.source_in_frame + (visual.media_kind === "video" ? at - visual.start_frame : 0),
    };
    return {
      ...content,
      visual_segments: content.visual_segments.flatMap((item) =>
        item.segment_id === id ? [{ ...item, end_frame: at }, right] : [item],
      ),
    };
  }
  if (!audio || !Number.isSafeInteger(sampleRate) || Number(sampleRate) <= 0) return null;
  const right = {
    ...audio,
    segment_id: newId,
    start_frame: at,
    source_in_sample:
      audio.source_in_sample + assemblySamples(at - audio.start_frame, Number(sampleRate), content),
  };
  return {
    ...content,
    audio_segments: content.audio_segments.flatMap((item) =>
      item.segment_id === id ? [{ ...item, end_frame: at }, right] : [item],
    ),
  };
}

/** Read source WAV timing only after its original bytes have passed identity checks. */
export function wavSampleRate(bytes: Uint8Array): number | undefined {
  if (bytes.length < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || view.getUint32(4, true) + 8 !== bytes.length)
    return undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.length) return undefined;
    if (tag(offset) === "fmt " && size >= 16) {
      const rate = view.getUint32(offset + 12, true);
      return rate > 0 && rate <= 384000 ? rate : undefined;
    }
    offset += 8 + size + (size % 2);
  }
  return undefined;
}
