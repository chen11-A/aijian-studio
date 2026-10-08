import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_TIMEBASES,
  assemblyEditProblem,
  assemblySamples,
  assemblySeconds,
  emptyAssembly,
  reflowVisual,
  splitAssemblySegment,
  wavSampleRate,
} from "./assemblyEditing";
import { parseAssemblyReceipt } from "./episodeMediaAssembly";
import type { AssemblyContent, AssemblyReceipt } from "./episodeMediaAssembly";

const projectId = `prj_${"1".repeat(32)}`,
  episodeId = "ep_edit";
const media = {
  asset_id: `asset_${"2".repeat(32)}`,
  asset_version_id: `asv_${"3".repeat(32)}`,
  sha256: "4".repeat(64),
};
function content(): AssemblyContent {
  return {
    ...emptyAssembly(projectId, episodeId),
    total_frames: 100,
    sequence_timebase: ASSEMBLY_TIMEBASES[3]!.value,
    visual_segments: [
      {
        segment_id: "seg_video",
        media_kind: "video",
        media,
        start_frame: 0,
        end_frame: 100,
        source_in_frame: 7,
        embedded_audio: "MUTE",
      },
    ],
    audio_segments: [
      {
        segment_id: "seg_bgm",
        track_kind: "BGM",
        media: { ...media, asset_id: `asset_${"5".repeat(32)}` },
        start_frame: 0,
        end_frame: 80,
        source_in_sample: 441,
      },
    ],
  };
}
function receipt(): AssemblyReceipt {
  const value = content();
  return {
    request_id: "local-test",
    data: {
      artifact_id: `art_${"6".repeat(32)}`,
      version_id: `ver_${"7".repeat(32)}`,
      content_hash: `sha256:${"8".repeat(64)}`,
      head_revision: 1,
      parent_version_id: null,
      content: value,
      playback_status: "BLOCKED_MEDIA_PROBE",
      export_status: "NO_EXPORT_CLAIM",
      media_checks: [
        {
          media,
          kind: "video",
          availability: "VERIFIED",
          technical_status: "PENDING_MEDIA_PROBE",
          rights_status: "PENDING_REVIEW",
        },
        {
          media: value.audio_segments[0]!.media,
          kind: "audio",
          availability: "VERIFIED",
          technical_status: "PENDING_MEDIA_PROBE",
          rights_status: "PENDING_REVIEW",
        },
      ],
    },
  };
}
describe("local episode assembly edit decisions", () => {
  it("splits real video references without changing rational timebase or audio bindings", () => {
    const before = content();
    const next = splitAssemblySegment(before, "seg_video", 30, "seg_video_right")!;
    expect(
      next.visual_segments.map((item) => [item.start_frame, item.end_frame, item.source_in_frame]),
    ).toEqual([
      [0, 30, 7],
      [30, 100, 37],
    ]);
    expect(next.audio_segments).toEqual(before.audio_segments);
    expect(next.sequence_timebase.frame_rate).toEqual({ num: 30000, den: 1001 });
    expect(assemblySeconds(30, next)).toBe(1.001);
    expect(splitAssemblySegment(before, "seg_video", 100, "seg_boundary")).toBeNull();
  });
  it("reorders/ripple-trims V1 while protecting absolute audio and subtitle end bounds", () => {
    const split = splitAssemblySegment(content(), "seg_video", 30, "seg_right")!;
    const reordered = reflowVisual(split, [...split.visual_segments].reverse());
    expect(
      reordered.visual_segments.map((item) => [item.segment_id, item.start_frame, item.end_frame]),
    ).toEqual([
      ["seg_right", 0, 70],
      ["seg_video", 70, 100],
    ]);
    expect(reordered.audio_segments).toEqual(split.audio_segments);
    expect(assemblyEditProblem(reflowVisual(split, [split.visual_segments[0]!]))).toMatch(
      /声音或字幕/,
    );
  });
  it("converts audio cut offsets with source sample rate and exact rational rounding", () => {
    expect(assemblySamples(30, 44100, content())).toBe(44144);
    expect(splitAssemblySegment(content(), "seg_bgm", 30, "seg_bgm_right")).toBeNull();
    const split = splitAssemblySegment(content(), "seg_bgm", 30, "seg_bgm_right", 44100)!;
    expect(split.audio_segments[1]!.source_in_sample).toBe(44585);
    expect(split.audio_segments[0]!.end_frame).toBe(30);
  });
  it("rejects malformed audio, missing checks, invalid rates and repeated IDs in readback", () => {
    expect(parseAssemblyReceipt(receipt(), projectId, episodeId)).not.toBeNull();
    const malformed = receipt();
    malformed.data.content.audio_segments[0]!.source_in_sample = -1;
    expect(parseAssemblyReceipt(malformed, projectId, episodeId)).toBeNull();
    const missing = receipt();
    missing.data.media_checks.pop();
    expect(parseAssemblyReceipt(missing, projectId, episodeId)).toBeNull();
    const repeated = receipt();
    repeated.data.content.audio_segments[0]!.segment_id = "seg_video";
    expect(parseAssemblyReceipt(repeated, projectId, episodeId)).toBeNull();
    const invalid = JSON.parse(JSON.stringify(receipt()));
    invalid.data.content.sequence_timebase.frame_rate = { num: 30, den: 1 };
    expect(parseAssemblyReceipt(invalid, projectId, episodeId)).toBeNull();
  });
  it("reads source WAV sampling from actual RIFF bytes and refuses truncated/foreign bytes", () => {
    const bytes = new Uint8Array(44);
    const view = new DataView(bytes.buffer);
    const write = (offset: number, text: string) =>
      bytes.set(new TextEncoder().encode(text), offset);
    write(0, "RIFF");
    view.setUint32(4, 36, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint32(24, 44100, true);
    expect(wavSampleRate(bytes)).toBe(44100);
    expect(wavSampleRate(bytes.subarray(0, 30))).toBeUndefined();
    expect(wavSampleRate(new Uint8Array(44))).toBeUndefined();
  });
});
