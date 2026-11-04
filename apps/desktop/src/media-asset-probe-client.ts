import {
  isMediaAssetProbeEvidenceResponse,
  isProbeAssetId,
  isProbeProjectId,
  isProbeVersionId,
  mediaAssetProbeDefiniteError,
  type MediaAssetProbeReadResult,
  type MediaAssetProbeWriteResult,
} from "./media-asset-probe-contract";

export type MediaAssetProbeClient = {
  getMediaAssetProbeEvidence(
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<MediaAssetProbeReadResult>;
  probeSelectedMediaAssetVersion(
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<MediaAssetProbeWriteResult>;
};
type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;

/** Only ids enter this boundary; the sidecar reads its own immutable media bytes. */
export function createMediaAssetProbeClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): MediaAssetProbeClient {
  async function request(
    method: "GET" | "POST",
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<MediaAssetProbeReadResult | MediaAssetProbeWriteResult> {
    if (!isProbeProjectId(projectId) || !isProbeAssetId(assetId) || !isProbeVersionId(versionId))
      throw new Error("Media probe requires canonical project, asset and version ids");
    const path = `/api/v1/projects/${projectId}/assets/${assetId}/versions/${versionId}/probe-evidence`;
    let result;
    try {
      result = await readHttp(path, { method, headers });
    } catch {
      return { kind: "PROBE_UNKNOWN" };
    }
    if (!result) return { kind: "PROBE_UNKNOWN" };
    const { status, payload, requestId } = result;
    if (status === (method === "GET" ? 200 : 201)) {
      if (!isMediaAssetProbeEvidenceResponse(payload, projectId, assetId, versionId, requestId))
        return { kind: "PROBE_UNKNOWN" };
      return { kind: method === "GET" ? "FOUND" : "PROBED", receipt: payload };
    }
    return mediaAssetProbeDefiniteError(status, payload, requestId) ?? { kind: "PROBE_UNKNOWN" };
  }
  return {
    getMediaAssetProbeEvidence: (projectId, assetId, versionId) =>
      request("GET", projectId, assetId, versionId) as Promise<MediaAssetProbeReadResult>,
    probeSelectedMediaAssetVersion: (projectId, assetId, versionId) =>
      request("POST", projectId, assetId, versionId) as Promise<MediaAssetProbeWriteResult>,
  };
}
