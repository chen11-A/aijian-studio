import type { TimelineResponse } from "../../api/studio";
import type { TimelineWorkspaceState } from "../../domain/timeline-workspace-controller";

type Timeline = TimelineResponse["data"]["timeline"];
type MediaPackage = NonNullable<Timeline["media_package"]>;

export type DevelopmentTimelineSnapshot = Readonly<{
  projectId: string;
  versionId: string;
  contentHash: string;
  revision: number;
  clips: ReadonlyArray<Timeline["clips"][number]>;
  assets: ReadonlyArray<Timeline["assets"][number]>;
  mediaPackage: MediaPackage;
  durationFrames: number;
  frameRate: Timeline["sequence_timebase"]["frame_rate"];
}>;

export type DevelopmentTimelineSnapshotResult =
  | Readonly<{ kind: "ready"; snapshot: DevelopmentTimelineSnapshot }>
  | Readonly<{
      kind: "unavailable";
      reason:
        | "NO_PROJECT"
        | "NOT_READY"
        | "SAVING"
        | "PROJECT_MISMATCH"
        | "INVALID_IDENTITY"
        | "EMPTY_TIMELINE"
        | "MEDIA_UNAVAILABLE";
    }>;

const versionIdPattern = /^ver_[0-9a-f]{32}$/;
const hashPattern = /^sha256:[0-9a-f]{64}$/;
const packageIdPattern = /^fmp_[0-9a-f]{32}$/;
const unavailable = (
  reason: Extract<DevelopmentTimelineSnapshotResult, { kind: "unavailable" }>["reason"],
): DevelopmentTimelineSnapshotResult => ({ kind: "unavailable", reason });
const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/** A detached read model for export requests and matching durable export receipts. */
export function getDevelopmentTimelineSnapshot(
  projectId: string | null,
  workspace: TimelineWorkspaceState,
): DevelopmentTimelineSnapshotResult {
  if (!projectId) return unavailable("NO_PROJECT");
  if (workspace.kind !== "ready") return unavailable("NOT_READY");
  if (workspace.saving) return unavailable("SAVING");

  const { data } = workspace.response;
  if (workspace.projectId !== projectId || data.project_id !== projectId)
    return unavailable("PROJECT_MISMATCH");

  const timeline = data.timeline;
  const frameRate = timeline.sequence_timebase.frame_rate;
  if (
    workspace.timelineId !== timeline.timeline_id ||
    !timeline.timeline_id ||
    !versionIdPattern.test(data.version_id) ||
    !hashPattern.test(data.content_hash) ||
    !positiveInteger(timeline.revision) ||
    !positiveInteger(data.total_duration_frames) ||
    !positiveInteger(frameRate.num) ||
    !positiveInteger(frameRate.den)
  )
    return unavailable("INVALID_IDENTITY");

  if (timeline.clips.length === 0 || timeline.assets.length === 0)
    return unavailable("EMPTY_TIMELINE");

  const mediaPackage = timeline.media_package;
  if (!mediaPackage) return unavailable("MEDIA_UNAVAILABLE");
  const assets = new Map(timeline.assets.map((asset) => [asset.asset_id, asset]));
  const bindings = new Map(mediaPackage.assets.map((binding) => [binding.asset_id, binding]));
  if (
    !packageIdPattern.test(mediaPackage.media_package_id) ||
    !hashPattern.test(mediaPackage.manifest_sha256) ||
    assets.size !== timeline.assets.length ||
    bindings.size !== mediaPackage.assets.length ||
    bindings.size !== assets.size
  )
    return unavailable("INVALID_IDENTITY");

  for (const asset of timeline.assets) {
    const binding = bindings.get(asset.asset_id);
    const editingHash = asset.proxy?.proxy_asset_sha256 ?? asset.source_asset_sha256;
    const editableFrames = asset.proxy?.editable_frame_count ?? asset.source_frame_count;
    if (
      !binding ||
      !hashPattern.test(asset.source_asset_sha256) ||
      !hashPattern.test(editingHash) ||
      !positiveInteger(asset.source_frame_count) ||
      !positiveInteger(editableFrames) ||
      binding.source_asset_sha256 !== asset.source_asset_sha256 ||
      binding.source_frame_count !== asset.source_frame_count ||
      binding.editing_asset_sha256 !== editingHash ||
      binding.preview_sha256 !== editingHash ||
      binding.editable_frame_count !== editableFrames
    )
      return unavailable("INVALID_IDENTITY");
  }

  let durationFrames = 0;
  const clipIds = new Set<string>();
  for (const clip of timeline.clips) {
    const asset = assets.get(clip.asset_id);
    const editableFrames = asset?.proxy?.editable_frame_count ?? asset?.source_frame_count;
    if (
      !clip.clip_id ||
      clipIds.has(clip.clip_id) ||
      editableFrames === undefined ||
      !Number.isSafeInteger(clip.source_in_frame) ||
      clip.source_in_frame < 0 ||
      !positiveInteger(clip.duration_frames) ||
      clip.source_in_frame + clip.duration_frames > editableFrames
    )
      return unavailable("INVALID_IDENTITY");
    clipIds.add(clip.clip_id);
    durationFrames += clip.duration_frames;
  }
  if (!positiveInteger(durationFrames) || durationFrames !== data.total_duration_frames)
    return unavailable("INVALID_IDENTITY");

  return {
    kind: "ready",
    snapshot: {
      projectId,
      versionId: data.version_id,
      contentHash: data.content_hash,
      revision: timeline.revision,
      clips: timeline.clips.map((clip) => ({ ...clip })),
      assets: timeline.assets.map((asset) => ({
        ...asset,
        proxy: asset.proxy ? { ...asset.proxy } : asset.proxy,
      })),
      mediaPackage: {
        ...mediaPackage,
        assets: mediaPackage.assets.map((binding) => ({ ...binding })),
      },
      durationFrames,
      frameRate: { ...frameRate },
    },
  };
}
