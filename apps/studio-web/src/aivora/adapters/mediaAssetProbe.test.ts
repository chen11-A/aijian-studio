import backendProbeFixture from "../../../../../packages/contracts/fixtures/media-asset-probe-evidence.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMediaProbeStore,
  parseMediaProbeReceipt,
  type MediaAssetProbeGateway,
} from "./mediaAssetProbe";
import { noProbe, probeReceipt, probeScope } from "../../test/mediaAssetProbeFixture";
const scope = probeScope();
const receipt = probeReceipt();
function gateway() {
  return {
    getMediaAssetProbeEvidence: vi
      .fn<MediaAssetProbeGateway["getMediaAssetProbeEvidence"]>()
      .mockResolvedValue(noProbe),
    probeSelectedMediaAssetVersion: vi
      .fn<MediaAssetProbeGateway["probeSelectedMediaAssetVersion"]>()
      .mockResolvedValue({ kind: "PROBED", receipt }),
  };
}
beforeEach(() => localStorage.clear());
describe("selected-version probe evidence", () => {
  it("decodes the actual backend Pydantic response without changing hash prefixes", () => {
    const data = backendProbeFixture.data;
    expect(
      parseMediaProbeReceipt(backendProbeFixture, {
        projectId: data.project_id,
        assetId: data.asset_id,
        versionId: data.version_id,
        sha256: data.asset_sha256,
        byteSize: data.byte_size,
      }),
    ).toEqual(data);
  });
  it("accepts only exact project, asset, version, byte size and prefixed source hash", () => {
    expect(parseMediaProbeReceipt(receipt, scope)).toEqual(receipt.data);
    for (const patch of [
      { projectId: `prj_${"9".repeat(32)}` },
      { assetId: `asset_${"9".repeat(32)}` },
      { versionId: `asv_${"9".repeat(32)}` },
      { sha256: "9".repeat(64) },
      { byteSize: 65 },
    ])
      expect(parseMediaProbeReceipt(receipt, { ...scope, ...patch })).toBeNull();
    const invalid = structuredClone(receipt);
    invalid.data.probe.source_asset_sha256 = scope.sha256;
    expect(parseMediaProbeReceipt(invalid, scope)).toBeNull();
    invalid.data.probe.source_asset_sha256 = `sha256:${scope.sha256}`;
    invalid.data.probe.video.frames[0]!.pts.time_base.den = 0;
    expect(parseMediaProbeReceipt(invalid, scope)).toBeNull();
  });
  it("reads durable evidence after a successful exact-scope POST", async () => {
    const native = gateway();
    const store = createMediaProbeStore(scope, native, localStorage);
    await store.refresh();
    native.getMediaAssetProbeEvidence.mockResolvedValue({ kind: "FOUND", receipt });
    await store.probe();
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledExactlyOnceWith(
      scope.projectId,
      scope.assetId,
      scope.versionId,
    );
    expect(native.getMediaAssetProbeEvidence).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().phase).toBe("FOUND");
    expect(store.getSnapshot().uncertain).toBe(false);
    await store.probe();
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1);
  });
  it("keeps a 404 after unknown locked across a new store until explicit recovery", async () => {
    const native = gateway();
    native.probeSelectedMediaAssetVersion.mockResolvedValue({ kind: "PROBE_UNKNOWN" });
    const first = createMediaProbeStore(scope, native, localStorage);
    await first.refresh();
    await first.probe();
    await first.probe();
    expect(first.getSnapshot()).toMatchObject({
      phase: "UNKNOWN",
      uncertain: true,
      notFound: true,
    });
    const reopened = createMediaProbeStore(scope, native, localStorage);
    await reopened.refresh();
    await reopened.probe();
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1);
    reopened.acknowledgeFinished();
    expect(reopened.getSnapshot().phase).toBe("NOT_FOUND");
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1);
  });
  it("reconciles unknown to actual persisted evidence without another POST", async () => {
    const native = gateway();
    native.probeSelectedMediaAssetVersion.mockResolvedValue({ kind: "PROBE_UNKNOWN" });
    const store = createMediaProbeStore(scope, native, localStorage);
    await store.refresh();
    native.getMediaAssetProbeEvidence.mockResolvedValue({ kind: "FOUND", receipt });
    await store.probe();
    expect(store.getSnapshot().evidence).toEqual(receipt.data);
    expect(store.getSnapshot().uncertain).toBe(false);
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1);
  });
  it("rejects inconsistent readback after a valid POST instead of showing another record", async () => {
    const native = gateway();
    const store = createMediaProbeStore(scope, native, localStorage);
    await store.refresh();
    const changed = structuredClone(receipt);
    changed.data.probe_sha256 = "8".repeat(64);
    native.getMediaAssetProbeEvidence.mockResolvedValue({ kind: "FOUND", receipt: changed });
    await store.probe();
    expect(store.getSnapshot().phase).toBe("UNKNOWN");
    expect(store.getSnapshot().evidence).toBeNull();
  });
  it("treats only pre-mutation toolchain-unavailable 503 as definite", async () => {
    const native = gateway();
    const store = createMediaProbeStore(scope, native, localStorage);
    await store.refresh();
    native.probeSelectedMediaAssetVersion.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 503,
      code: "TOOLCHAIN_UNAVAILABLE",
      request_id: "unavailable",
    });
    await store.probe();
    expect(store.getSnapshot()).toMatchObject({ phase: "ERROR", uncertain: false });
    await store.refresh();
    native.probeSelectedMediaAssetVersion.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 503,
      code: "PROBE_WRITE_UNKNOWN",
      request_id: "unavailable",
    });
    await store.probe();
    expect(store.getSnapshot()).toMatchObject({ phase: "UNKNOWN", uncertain: true });
  });
  it("does not probe if pending-intent storage is unavailable", async () => {
    const native = gateway();
    const store = createMediaProbeStore(scope, native);
    await store.refresh();
    await store.probe();
    expect(native.probeSelectedMediaAssetVersion).not.toHaveBeenCalled();
  });
});
