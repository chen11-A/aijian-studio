import type { MediaAsset } from "../aivora/adapters/assetLibrary";
import type {
  MediaAssetProbeEvidenceResponse,
  MediaProbeScope,
} from "../aivora/adapters/mediaAssetProbe";
export const probeProjectId = `prj_${"1".repeat(32)}`;
export function videoAsset(digit = "2", projectId = probeProjectId): MediaAsset {
  const version = {
    id: `asv_${digit.repeat(32)}`,
    ordinal: 1,
    filename: `video-${digit}.mp4`,
    kind: "video" as const,
    mime_type: "video/mp4",
    byte_size: 64,
    sha256: digit.repeat(64),
    rights_status: "PENDING_REVIEW" as const,
    source_kind: "LOCAL_IMPORT" as const,
    technical_metadata: {},
    created_at: "2026-10-08",
    availability: "VERIFIED" as const,
  };
  return {
    id: `asset_${digit.repeat(32)}`,
    project_id: projectId,
    created_at: "2026-10-08",
    latest_version: version,
    versions: [version],
    episode_references: [],
  };
}
export function probeScope(asset = videoAsset()): MediaProbeScope {
  return {
    projectId: asset.project_id,
    assetId: asset.id,
    versionId: asset.latest_version.id,
    sha256: asset.latest_version.sha256,
    byteSize: asset.latest_version.byte_size,
  };
}
export function probeReceipt(asset = videoAsset()): MediaAssetProbeEvidenceResponse {
  const scope = probeScope(asset);
  return {
    request_id: "c2daab9c-2e17-4f91-b7ca-cc7bcd19ce6f",
    data: {
      id: `mpe_${asset.id.slice(-32)}`,
      project_id: scope.projectId,
      asset_id: scope.assetId,
      version_id: scope.versionId,
      asset_sha256: scope.sha256,
      byte_size: scope.byteSize,
      probe_sha256: "4".repeat(64),
      toolchain_profile_id: "windows-x86_64-gyan-full-8.1.2-dev",
      toolchain_version: "8.1.2",
      ffmpeg_sha256: "5".repeat(64),
      ffprobe_sha256: "6".repeat(64),
      created_at: "2026-10-08T00:00:00Z",
      probe: {
        source_asset_sha256: `sha256:${scope.sha256}`,
        byte_size: scope.byteSize,
        format_names: ["mov", "mp4"],
        container_duration: { num: 1, den: 5 },
        video: {
          stream_index: 0,
          codec_name: "h264",
          width: 320,
          height: 180,
          pixel_format: "yuv420p",
          average_frame_rate: { num: 25, den: 1 },
          time_base: { num: 1, den: 12800 },
          frames: Array.from({ length: 5 }, (_, i) => ({
            pts: { ticks: i * 512, time_base: { num: 1, den: 12800 } },
          })),
          is_variable_frame_rate: false,
        },
        audio: null,
      },
    },
  };
}
export const noProbe = {
  kind: "DEFINITE_SERVER_ERROR" as const,
  status: 404 as const,
  code: "PROBE_NOT_FOUND",
  request_id: "c2daab9c-2e17-4f91-b7ca-cc7bcd19ce6f",
};
