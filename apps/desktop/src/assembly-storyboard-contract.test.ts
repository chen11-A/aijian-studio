import { describe, expect, it } from "vitest";
import {
  isCreateEpisodeMediaAssemblyVersionRequest,
  isEpisodeMediaAssemblyContent,
  isEpisodeMediaAssemblyResponse,
  type EpisodeMediaAssemblyContent,
} from "./episode-media-assembly-contract";
const project = `prj_${"a".repeat(32)}`,
  episode = `ep_${"b".repeat(32)}`;
const reference = {
  storyboard_version_id: `ver_${"c".repeat(32)}`,
  shot_id: `shp_${"d".repeat(32)}`,
};
function content(): EpisodeMediaAssemblyContent {
  return {
    schema_version: "1.0.0",
    project_id: project,
    episode_id: episode,
    sequence_timebase: { frame_rate: { num: 24, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
    canvas_width: 1920,
    canvas_height: 1080,
    total_frames: 48,
    visual_segments: [
      {
        segment_id: "seg_one",
        media_kind: "image",
        media: {
          asset_id: `asset_${"e".repeat(32)}`,
          asset_version_id: `asv_${"f".repeat(32)}`,
          sha256: "a".repeat(64),
        },
        start_frame: 0,
        end_frame: 48,
        source_in_frame: 0,
        embedded_audio: "MUTE",
      },
    ],
    audio_segments: [],
    subtitle_segments: [],
  };
}
describe("native assembly storyboard provenance contract", () => {
  it("accepts legacy absence and an explicit optional exact source without weakening closed fields", () => {
    const legacy = content();
    expect(isEpisodeMediaAssemblyContent(legacy, project, episode)).toBe(true);
    const linked = content();
    linked.visual_segments[0]!.storyboard_ref = reference;
    expect(isEpisodeMediaAssemblyContent(linked, project, episode)).toBe(true);
    expect(
      isCreateEpisodeMediaAssemblyVersionRequest(
        {
          content: linked,
          change_summary: "Reference shot",
          parent_version_id: null,
          expected_revision: null,
        },
        project,
        episode,
      ),
    ).toBe(true);
    const requestId = "00000000-0000-4000-8000-000000000001";
    expect(
      isEpisodeMediaAssemblyResponse(
        {
          request_id: requestId,
          data: {
            artifact_id: `art_${"a".repeat(32)}`,
            version_id: `ver_${"b".repeat(32)}`,
            content_hash: `sha256:${"c".repeat(64)}`,
            head_revision: 1,
            parent_version_id: null,
            content: linked,
            media_checks: [],
            playback_status: "DRAFT_STATIC_ANIMATIC",
            export_status: "NO_EXPORT_CLAIM",
          },
        },
        project,
        episode,
        requestId,
      ),
    ).toBe(true);
    expect(legacy.visual_segments[0]).not.toHaveProperty("storyboard_ref");
  });
  it.each([
    { storyboard_version_id: reference.storyboard_version_id },
    { shot_id: reference.shot_id },
    { ...reference, shot_id: "shp_missing" },
    { ...reference, storyboard_version_id: "ver_latest" },
    { ...reference, fulfilled: true },
    [],
    "latest",
    7,
  ])("rejects malformed or extra reference fields: %j", (value) => {
    const invalid = content();
    Object.assign(invalid.visual_segments[0]!, { storyboard_ref: value });
    expect(isEpisodeMediaAssemblyContent(invalid, project, episode)).toBe(false);
  });
  it("does not permit new unknown visual fields alongside the optional link", () => {
    const invalid = content();
    Object.assign(invalid.visual_segments[0]!, { storyboard_ref: reference, completed: true });
    expect(isEpisodeMediaAssemblyContent(invalid, project, episode)).toBe(false);
  });
});
