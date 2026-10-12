import { createHash } from "node:crypto";
import { visualJson } from "@aijian/contracts/visual-bible";
import {
  isAudioAssetProbeEvidenceResponse,
  isProbeAssetId,
  isProbeProjectId,
  isProbeVersionId,
  audioAssetProbeDefiniteError,
  type AudioAssetProbeReadResult,
  type AudioAssetProbeWriteResult,
} from "./audio-asset-probe-contract";

export type AudioAssetProbeClient = {
  getAudioAssetProbeEvidence(
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<AudioAssetProbeReadResult>;
  probeSelectedAudioAssetVersion(
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<AudioAssetProbeWriteResult>;
};
type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;

/** Only ids enter this boundary; the sidecar reads its own immutable media bytes. */
export function createAudioAssetProbeClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): AudioAssetProbeClient {
  async function request(
    method: "GET" | "POST",
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<AudioAssetProbeReadResult | AudioAssetProbeWriteResult> {
    if (!isProbeProjectId(projectId) || !isProbeAssetId(assetId) || !isProbeVersionId(versionId))
      throw new Error("Audio probe requires canonical project, asset and version ids");
    const path = `/api/v1/projects/${projectId}/assets/${assetId}/versions/${versionId}/audio-probe-evidence`;
    let result;
    try {
      result = await readHttp(path, { method, headers });
    } catch {
      return { kind: "PROBE_UNKNOWN" };
    }
    if (!result) return { kind: "PROBE_UNKNOWN" };
    const { status, payload, requestId } = result;
    if (status === (method === "GET" ? 200 : 201)) {
      if (!isAudioAssetProbeEvidenceResponse(payload, projectId, assetId, versionId, requestId))
        return { kind: "PROBE_UNKNOWN" };
      const canonical = visualJson(payload.data.probe);
      if (
        Buffer.byteLength(canonical, "utf8") > 8 * 1024 * 1024 ||
        createHash("sha256").update(canonical, "utf8").digest("hex") !== payload.data.probe_sha256
      )
        return { kind: "PROBE_UNKNOWN" };
      return { kind: method === "GET" ? "FOUND" : "PROBED", receipt: payload };
    }
    return audioAssetProbeDefiniteError(status, payload, requestId) ?? { kind: "PROBE_UNKNOWN" };
  }
  return {
    getAudioAssetProbeEvidence: (projectId, assetId, versionId) =>
      request("GET", projectId, assetId, versionId) as Promise<AudioAssetProbeReadResult>,
    probeSelectedAudioAssetVersion: (projectId, assetId, versionId) =>
      request("POST", projectId, assetId, versionId) as Promise<AudioAssetProbeWriteResult>,
  };
}
