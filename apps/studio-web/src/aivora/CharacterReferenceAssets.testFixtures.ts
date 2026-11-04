import type { MediaAsset } from "./adapters/assetLibrary";
const project = `prj_${"a".repeat(32)}`;
export const asset: MediaAsset = {
  id: `asset_${"c".repeat(32)}`,
  project_id: project,
  created_at: "2026-10-11T00:00:00Z",
  episode_references: [],
  versions: [],
  latest_version: {
    id: `asv_${"d".repeat(32)}`,
    ordinal: 1,
    filename: "真实登记参考.png",
    kind: "image",
    mime_type: "image/png",
    byte_size: 68,
    sha256: "e".repeat(64),
    rights_status: "PENDING_REVIEW",
    source_kind: "LOCAL_IMPORT",
    technical_metadata: {},
    created_at: "2026-10-11T00:00:00Z",
    availability: "VERIFIED",
  },
};
asset.versions = [asset.latest_version];
