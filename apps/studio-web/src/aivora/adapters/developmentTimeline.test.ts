import { describe, expect, test } from "vitest";
import type { TimelineResponse } from "../../api/studio";
import type { TimelineWorkspaceState } from "../../domain/timeline-workspace-controller";
import { getDevelopmentTimelineSnapshot } from "./developmentTimeline";

const projectId = `prj_${"1".repeat(32)}`;
const hash = `sha256:${"2".repeat(64)}`;
const proxyHash = `sha256:${"3".repeat(64)}`;
function ready(proxy = false): Extract<TimelineWorkspaceState, { kind: "ready" }> {
  // Validation of the full transport DTO is separate. All fields consumed by
  // the detached export snapshot are represented and independently mutated.
  const response = {
    data: {
      project_id: projectId,
      version_id: `ver_${"4".repeat(32)}`,
      content_hash: hash,
      total_duration_frames: 25,
      timeline: {
        timeline_id: "timeline-1",
        revision: 1,
        sequence_timebase: { frame_rate: { num: 25, den: 1 } },
        clips: [
          { clip_id: "clip-1", asset_id: "asset-1", source_in_frame: 0, duration_frames: 25 },
        ],
        assets: [
          {
            asset_id: "asset-1",
            source_asset_sha256: hash,
            source_frame_count: 50,
            ...(proxy
              ? { proxy: { proxy_asset_sha256: proxyHash, editable_frame_count: 25 } }
              : {}),
          },
        ],
        media_package: {
          media_package_id: `fmp_${"5".repeat(32)}`,
          manifest_sha256: hash,
          assets: [
            {
              asset_id: "asset-1",
              source_asset_sha256: hash,
              source_frame_count: 50,
              editing_asset_sha256: proxy ? proxyHash : hash,
              preview_sha256: proxy ? proxyHash : hash,
              editable_frame_count: proxy ? 25 : 50,
            },
          ],
        },
      },
    },
  } as TimelineResponse;
  return {
    kind: "ready",
    projectId,
    response,
    timelineId: "timeline-1",
    selectedClipId: "clip-1",
    notice: null,
    saving: false,
  };
}

describe("development export snapshot binds saved media evidence", () => {
  test.each([false, true])("detaches nested media and frame identities, proxy=%s", (proxy) => {
    const workspace = ready(proxy);
    const result = getDevelopmentTimelineSnapshot(projectId, workspace);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("fixture not ready");
    expect(result.snapshot).toMatchObject({
      projectId,
      revision: 1,
      durationFrames: 25,
      frameRate: { num: 25, den: 1 },
    });
    const source = workspace.response.data.timeline;
    expect(result.snapshot.clips[0]).not.toBe(source.clips[0]);
    expect(result.snapshot.assets[0]).not.toBe(source.assets[0]);
    expect(result.snapshot.mediaPackage.assets[0]).not.toBe(source.media_package!.assets[0]);
    expect(result.snapshot.frameRate).not.toBe(source.sequence_timebase.frame_rate);
    if (proxy) expect(result.snapshot.assets[0]!.proxy).not.toBe(source.assets[0]!.proxy);
    source.clips[0]!.duration_frames = 1;
    source.assets[0]!.source_frame_count = 1;
    source.media_package!.assets[0]!.preview_sha256 = "changed";
    source.sequence_timebase.frame_rate.num = 24;
    expect(result.snapshot.clips[0]!.duration_frames).toBe(25);
    expect(result.snapshot.assets[0]!.source_frame_count).toBe(50);
    expect(result.snapshot.mediaPackage.assets[0]!.preview_sha256).toBe(proxy ? proxyHash : hash);
    expect(result.snapshot.frameRate.num).toBe(25);
  });

  test("no selected project, loading, and save-in-progress never expose snapshots", () => {
    expect(getDevelopmentTimelineSnapshot(null, ready())).toEqual({
      kind: "unavailable",
      reason: "NO_PROJECT",
    });
    expect(
      getDevelopmentTimelineSnapshot(projectId, {
        kind: "loading",
        projectId,
        notice: null,
        saving: false,
      }),
    ).toEqual({ kind: "unavailable", reason: "NOT_READY" });
    expect(getDevelopmentTimelineSnapshot(projectId, { ...ready(), saving: true })).toEqual({
      kind: "unavailable",
      reason: "SAVING",
    });
  });

  test.each(["workspace", "response"])("%s from a different project is rejected", (where) => {
    const workspace = { ...ready() };
    if (where === "workspace") workspace.projectId = "other";
    else workspace.response.data.project_id = "other";
    expect(getDevelopmentTimelineSnapshot(projectId, workspace)).toEqual({
      kind: "unavailable",
      reason: "PROJECT_MISMATCH",
    });
  });

  test.each([
    "timeline-id",
    "empty-id",
    "version",
    "hash",
    "revision",
    "duration",
    "frame-rate-num",
    "frame-rate-den",
    "package-id",
    "manifest-hash",
    "duplicate-asset",
    "duplicate-binding",
    "missing-binding",
    "wrong-binding-id",
    "source-hash",
    "source-frames",
    "proxy-hash",
    "proxy-frames",
    "bound-source-hash",
    "bound-source-frames",
    "bound-edit-hash",
    "bound-preview-hash",
    "bound-edit-frames",
    "empty-clip-id",
    "duplicate-clip",
    "clip-asset",
    "fractional-in",
    "negative-in",
    "clip-duration",
    "out-of-range",
    "total-mismatch",
  ])("rejects inconsistent %s before export", (fault) => {
    const workspace = { ...ready(true) };
    const data = workspace.response.data;
    const timeline = data.timeline;
    const asset = timeline.assets[0]!;
    const media = timeline.media_package!;
    const binding = media.assets[0]!;
    const clip = timeline.clips[0]!;
    switch (fault) {
      case "timeline-id":
        workspace.timelineId = "other";
        break;
      case "empty-id":
        workspace.timelineId = timeline.timeline_id = "";
        break;
      case "version":
        data.version_id = "bad";
        break;
      case "hash":
        data.content_hash = "bad";
        break;
      case "revision":
        timeline.revision = 0;
        break;
      case "duration":
        data.total_duration_frames = 0;
        break;
      case "frame-rate-num":
        // Deliberately malformed runtime DTO, outside the generated enum.
        timeline.sequence_timebase.frame_rate.num = 0 as 25;
        break;
      case "frame-rate-den":
        timeline.sequence_timebase.frame_rate.den = 1.5 as 1;
        break;
      case "package-id":
        media.media_package_id = "bad";
        break;
      case "manifest-hash":
        media.manifest_sha256 = "bad";
        break;
      case "duplicate-asset":
        timeline.assets.push({ ...asset });
        break;
      case "duplicate-binding":
        media.assets.push({ ...binding });
        break;
      case "missing-binding":
        media.assets = [];
        break;
      case "wrong-binding-id":
        binding.asset_id = "other";
        break;
      case "source-hash":
        asset.source_asset_sha256 = "bad";
        break;
      case "source-frames":
        asset.source_frame_count = 0;
        break;
      case "proxy-hash":
        asset.proxy!.proxy_asset_sha256 = "bad";
        break;
      case "proxy-frames":
        asset.proxy!.editable_frame_count = 0;
        break;
      case "bound-source-hash":
        binding.source_asset_sha256 = proxyHash;
        break;
      case "bound-source-frames":
        binding.source_frame_count = 49;
        break;
      case "bound-edit-hash":
        binding.editing_asset_sha256 = hash;
        break;
      case "bound-preview-hash":
        binding.preview_sha256 = hash;
        break;
      case "bound-edit-frames":
        binding.editable_frame_count = 24;
        break;
      case "empty-clip-id":
        clip.clip_id = "";
        break;
      case "duplicate-clip":
        timeline.clips.push({ ...clip });
        break;
      case "clip-asset":
        clip.asset_id = "other";
        break;
      case "fractional-in":
        clip.source_in_frame = 0.5;
        break;
      case "negative-in":
        clip.source_in_frame = -1;
        break;
      case "clip-duration":
        clip.duration_frames = 0;
        break;
      case "out-of-range":
        clip.source_in_frame = 1;
        break;
      case "total-mismatch":
        data.total_duration_frames = 24;
        break;
    }
    expect(getDevelopmentTimelineSnapshot(projectId, workspace)).toEqual({
      kind: "unavailable",
      reason: "INVALID_IDENTITY",
    });
  });

  test.each(["clips", "assets", "media"])("missing %s prevents readiness", (missing) => {
    const workspace = ready();
    if (missing === "clips") workspace.response.data.timeline.clips = [];
    if (missing === "assets") workspace.response.data.timeline.assets = [];
    if (missing === "media") delete workspace.response.data.timeline.media_package;
    expect(getDevelopmentTimelineSnapshot(projectId, workspace)).toEqual({
      kind: "unavailable",
      reason: missing === "media" ? "MEDIA_UNAVAILABLE" : "EMPTY_TIMELINE",
    });
  });
});
