import { createHash } from "node:crypto";
import { visualJson } from "@aijian/contracts/visual-bible";
import fixture from "../../../../packages/contracts/fixtures/audio-asset-probe-evidence.json";
import type { AudioAssetProbeEvidenceResponse } from "../aivora/adapters/audioAssetProbe";
import type { MediaAsset } from "../aivora/adapters/assetLibrary";
import { videoAsset } from "./mediaAssetProbeFixture";

export function audioAsset(digit = "2", projectId?: string) {
  const asset = videoAsset(digit, projectId);
  const version = {
    ...asset.latest_version,
    kind: "audio" as const,
    mime_type: "audio/wav",
    filename: `录音-${digit}.wav`,
  };
  return { ...asset, latest_version: version, versions: [version] };
}
export function audioReceipt(asset: MediaAsset = audioAsset()): AudioAssetProbeEvidenceResponse {
  const receipt = structuredClone(fixture) as AudioAssetProbeEvidenceResponse;
  const version = asset.latest_version;
  Object.assign(receipt.data, {
    id: `mpe_${asset.id.slice(-32)}`,
    project_id: asset.project_id,
    asset_id: asset.id,
    version_id: version.id,
    asset_sha256: version.sha256,
    byte_size: version.byte_size,
  });
  receipt.data.probe.source_asset_sha256 = `sha256:${version.sha256}`;
  receipt.data.probe.byte_size = version.byte_size;
  receipt.data.probe_sha256 = createHash("sha256")
    .update(visualJson(receipt.data.probe))
    .digest("hex");
  return receipt;
}
