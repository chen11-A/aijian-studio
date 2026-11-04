import { describe, expect, it } from "vitest";
import {
  isEpisodeMediaAssemblyContent,
  type EpisodeMediaAssemblyContent,
} from "./episode-media-assembly-contract";
const project = `prj_${"a".repeat(32)}`,
  episode = `ep_${"b".repeat(32)}`;
function content(): EpisodeMediaAssemblyContent {
  return {
    schema_version: "1.0.0",
    project_id: project,
    episode_id: episode,
    sequence_timebase: { frame_rate: { num: 25, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
    canvas_width: 1920,
    canvas_height: 1080,
    total_frames: 50,
    visual_segments: [
      {
        segment_id: "seg_image",
        media_kind: "image",
        media: {
          asset_id: `asset_${"c".repeat(32)}`,
          asset_version_id: `asv_${"d".repeat(32)}`,
          sha256: "e".repeat(64),
        },
        start_frame: 0,
        end_frame: 50,
        source_in_frame: 0,
        embedded_audio: "MUTE",
      },
    ],
    audio_segments: [],
    subtitle_segments: [
      {
        segment_id: "seg_subtitle",
        start_frame: 3,
        end_frame: 20,
        text: "中文 100%\n[x] '\\:;",
        render_profile: "noto-cjk-sc-bottom-v1",
      },
    ],
  };
}
describe("native literal subtitle contract", () => {
  it("admits exact literal cues and unchanged legacy empty content", () => {
    const value = content();
    expect(isEpisodeMediaAssemblyContent(value, project, episode)).toBe(true);
    value.subtitle_segments = [];
    expect(isEpisodeMediaAssemblyContent(value, project, episode)).toBe(true);
  });
  it.each([
    { text: "emoji😀" },
    { text: "三\n行\n字" },
    { text: "a".repeat(29) },
    { fontfile: "evil" },
    { render_profile: "any-font" },
    { start_frame: 3.5 },
  ])("rejects invalid cue %j", (change) => {
    const value = content();
    Object.assign(value.subtitle_segments[0]!, change);
    expect(isEpisodeMediaAssemblyContent(value, project, episode)).toBe(false);
  });
  it("rejects overlaps while allowing adjacent cues", () => {
    const value = content();
    value.subtitle_segments.push({
      ...value.subtitle_segments[0]!,
      segment_id: "seg_two",
      start_frame: 19,
      end_frame: 30,
    });
    expect(isEpisodeMediaAssemblyContent(value, project, episode)).toBe(false);
    value.subtitle_segments[1]!.start_frame = 20;
    expect(isEpisodeMediaAssemblyContent(value, project, episode)).toBe(true);
  });
});
