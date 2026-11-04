import { describe, expect, it, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import {
  isEpisodeMediaAssemblyContent,
  isEpisodeMediaAssemblyResponse,
  type EpisodeMediaAssemblyContent,
  type EpisodeMediaAssemblyResponse,
} from "./episode-media-assembly-contract";

const p = `prj_${"1".repeat(32)}`,
  e = `ep_${"2".repeat(32)}`,
  v = `ver_${"3".repeat(32)}`,
  h = `sha256:${"4".repeat(64)}`,
  rid = "00000000-0000-4000-8000-000000000001";
function receipt(): EpisodeMediaAssemblyResponse {
  const media = {
    asset_id: `asset_${"5".repeat(32)}`,
    asset_version_id: `asv_${"6".repeat(32)}`,
    sha256: "7".repeat(64),
  };
  const content: EpisodeMediaAssemblyContent = {
    schema_version: "1.0.0",
    project_id: p,
    episode_id: e,
    sequence_timebase: { frame_rate: { num: 25, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
    canvas_width: 160,
    canvas_height: 90,
    total_frames: 50,
    visual_segments: [
      {
        segment_id: "seg_image",
        media_kind: "image",
        media,
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
        start_frame: 0,
        end_frame: 20,
        text: "准确来源。",
        render_profile: "noto-cjk-sc-bottom-v1",
        script_ref: {
          script_version_id: v,
          script_block_id: `sblk_${"8".repeat(32)}`,
          script_content_hash: h,
        },
      },
    ],
    script_provenance: {
      mode: "CONFIRMED",
      confirmation_id: `esc_${"9".repeat(32)}`,
      script_version_id: v,
      script_content_hash: h,
    },
  };
  return {
    request_id: rid,
    data: {
      artifact_id: `art_${"a".repeat(32)}`,
      version_id: `ver_${"b".repeat(32)}`,
      content_hash: `sha256:${"c".repeat(64)}`,
      head_revision: 1,
      parent_version_id: null,
      content,
      media_checks: [
        {
          media,
          kind: "image",
          availability: "VERIFIED",
          technical_status: "STILL_HEADER_ONLY",
          probe_evidence_id: null,
          probed_video_frames: null,
          probed_has_audio: null,
          rights_status: "PENDING_REVIEW",
          rights_decision_id: null,
        },
      ],
      playback_status: "DRAFT_STATIC_ANIMATIC",
      export_status: "NO_EXPORT_CLAIM",
      script_source_status: {
        state: "CONFIRMED_CURRENT",
        latest_confirmation: {
          confirmation_id: `esc_${"d".repeat(32)}`,
          project_id: p,
          episode_id: e,
          artifact_id: `art_${"e".repeat(32)}`,
          version_id: v,
          content_hash: h,
          head_revision: 1,
          actor_id: "local-user",
          confirmed_at: "2026-10-11T00:00:00Z",
        },
        newer_draft_available: false,
        dialogue_segment_ids: [],
        subtitle_segment_ids: ["seg_subtitle"],
      },
    },
  };
}
describe("actual desktop confirmed-source DTO admission", () => {
  it("accepts a real source cue and different same-source confirmation receipt", async () => {
    const r = receipt();
    expect(isEpisodeMediaAssemblyContent(r.data.content, p, e)).toBe(true);
    expect(isEpisodeMediaAssemblyResponse(r, p, e, rid)).toBe(true);
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(r), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": rid },
      }),
    );
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "x".repeat(43),
    });
    expect((await client.readLatestEpisodeMediaAssembly(p, e)).kind).toBe("FOUND");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    "missing_status",
    "wrong_scope",
    "wrong_projection",
    "contradictory_state",
    "hash",
    "empty",
    "unknown_keys",
  ])("rejects %s instead of enabling consumption", (kind) => {
    const r = receipt();
    const st = r.data.script_source_status!;
    if (kind === "missing_status") delete r.data.script_source_status;
    if (kind === "wrong_scope") st.latest_confirmation!.episode_id = `ep_${"0".repeat(32)}`;
    if (kind === "wrong_projection") st.subtitle_segment_ids = ["seg_foreign"];
    if (kind === "contradictory_state") st.state = "CONFIRMATION_SUPERSEDED";
    if (kind === "hash") st.latest_confirmation!.content_hash = `sha256:${"0".repeat(64)}`;
    if (kind === "empty") {
      r.data.content.subtitle_segments = [];
      st.subtitle_segment_ids = [];
    }
    if (kind === "unknown_keys") Object.assign(st, { approved: true });
    expect(isEpisodeMediaAssemblyResponse(r, p, e, rid)).toBe(false);
  });
  it("accepts superseded/unknown historical status without pretending it is current", () => {
    const r = receipt(),
      st = r.data.script_source_status!;
    st.latest_confirmation!.version_id = `ver_${"0".repeat(32)}`;
    st.state = "CONFIRMATION_SUPERSEDED";
    expect(isEpisodeMediaAssemblyResponse(r, p, e, rid)).toBe(true);
    st.latest_confirmation = null;
    st.state = "AUTHORITY_UNKNOWN";
    expect(isEpisodeMediaAssemblyResponse(r, p, e, rid)).toBe(true);
  });
  it.each(["missing_provenance", "bad_ref", "extra_ref", "null_ref", "bad_pin"])(
    "new literal source never bypasses dependency marker: %s",
    (kind) => {
      const c = receipt().data.content;
      const cue = c.subtitle_segments[0]!;
      if (kind === "missing_provenance") delete c.script_provenance;
      if (kind === "bad_pin") Object.assign(c.script_provenance!, { mode: "DRAFT" });
      if ("text" in cue) {
        if (kind === "bad_ref") cue.script_ref!.script_content_hash = "wrong";
        if (kind === "extra_ref") Object.assign(cue.script_ref!, { secret: "x" });
        if (kind === "null_ref") cue.script_ref = null;
      }
      expect(isEpisodeMediaAssemblyContent(c, p, e)).toBe(false);
    },
  );
});
