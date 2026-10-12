import { webcrypto } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { audioAsset, audioReceipt } from "../../test/audioAssetProbeFixture";
import { noProbe, probeScope } from "../../test/mediaAssetProbeFixture";
import {
  createAudioProbeStore,
  desktopAudioAssetProbe,
  parseAudioProbeReceipt,
  type AudioAssetProbeGateway,
} from "./audioAssetProbe";
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto });
});
function gateway() {
  return {
    getAudioAssetProbeEvidence: vi
      .fn<AudioAssetProbeGateway["getAudioAssetProbeEvidence"]>()
      .mockResolvedValue(noProbe),
    probeSelectedAudioAssetVersion: vi
      .fn<AudioAssetProbeGateway["probeSelectedAudioAssetVersion"]>()
      .mockResolvedValue({ kind: "PROBE_UNKNOWN" }),
  };
}
it("uses only the exact desktop audio capability and caches gateway identity", () => {
  expect(desktopAudioAssetProbe({})).toBeUndefined();
  const native = gateway();
  expect(desktopAudioAssetProbe(native)).toBe(desktopAudioAssetProbe(native));
});
it("verifies canonical body hash, strict timing and selected immutable source", async () => {
  const receipt = audioReceipt();
  const scope = probeScope(audioAsset());
  expect(await parseAudioProbeReceipt(receipt, scope)).toEqual(receipt.data);
  const bad = structuredClone(receipt);
  bad.data.probe_sha256 = "f".repeat(64);
  expect(await parseAudioProbeReceipt(bad, scope)).toBeNull();
  expect(
    await parseAudioProbeReceipt(receipt, { ...scope, versionId: `asv_${"3".repeat(32)}` }),
  ).toBeNull();
  expect(await parseAudioProbeReceipt({ ...receipt, request_id: "not-request" }, scope)).toBeNull();
  expect(
    await parseAudioProbeReceipt(
      {
        ...receipt,
        data: {
          ...receipt.data,
          probe: {
            ...receipt.data.probe,
            audio: { ...receipt.data.probe.audio, total_samples: true },
          },
        },
      },
      scope,
    ),
  ).toBeNull();
});
it("locks unknown writes across store recreation and reconciles by read only", async () => {
  const native = gateway();
  const scope = probeScope(audioAsset());
  const first = createAudioProbeStore(scope, native, localStorage);
  await first.refresh();
  await first.probe();
  await first.probe();
  expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1);
  expect(first.getSnapshot()).toMatchObject({ phase: "UNKNOWN", uncertain: true });
  const reopened = createAudioProbeStore(scope, native, localStorage);
  await reopened.refresh();
  await reopened.probe();
  expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1);
  native.getAudioAssetProbeEvidence.mockResolvedValue({ kind: "FOUND", receipt: audioReceipt() });
  await reopened.refresh();
  expect(reopened.getSnapshot()).toMatchObject({ phase: "FOUND", uncertain: false });
});
it("an explicit finished acknowledgement requires a reliable missing record and a separate new click", async () => {
  const native = gateway();
  const scope = probeScope(audioAsset());
  const store = createAudioProbeStore(scope, native, localStorage);
  await store.refresh();
  await store.probe();
  store.acknowledgeFinished();
  expect(store.getSnapshot()).toMatchObject({ phase: "NOT_FOUND", uncertain: false });
  expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1);
  await store.probe();
  expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(2);
});
it("keeps two projects and exact versions isolated, including late A results and A→B→A", async () => {
  const a = audioAsset(),
    b = audioAsset("3", `prj_${"b".repeat(32)}`);
  const native = gateway();
  let finish!: (
    value: Awaited<ReturnType<AudioAssetProbeGateway["getAudioAssetProbeEvidence"]>>,
  ) => void;
  native.getAudioAssetProbeEvidence.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const input = probeScope(a);
  const first = createAudioProbeStore(input, native, localStorage);
  const read = first.refresh();
  input.projectId = b.project_id;
  const second = createAudioProbeStore(probeScope(b), native, localStorage);
  await second.refresh();
  finish({ kind: "FOUND", receipt: audioReceipt(a) });
  await read;
  expect(first.getSnapshot().evidence?.project_id).toBe(a.project_id);
  expect(second.getSnapshot().evidence).toBeNull();
  native.getAudioAssetProbeEvidence.mockResolvedValue({ kind: "FOUND", receipt: audioReceipt(a) });
  const back = createAudioProbeStore(probeScope(a), native, localStorage);
  await back.refresh();
  expect(back.getSnapshot().evidence?.version_id).toBe(a.latest_version.id);
});
it("mismatched POST and readback records keep the lock and never adopt a different receipt", async () => {
  const native = gateway();
  const receipt = audioReceipt();
  const store = createAudioProbeStore(probeScope(audioAsset()), native, localStorage);
  await store.refresh();
  native.probeSelectedAudioAssetVersion.mockResolvedValue({ kind: "PROBED", receipt });
  const different = structuredClone(receipt);
  different.data.id = `mpe_${"f".repeat(32)}`;
  native.getAudioAssetProbeEvidence.mockResolvedValue({ kind: "FOUND", receipt: different });
  await store.probe();
  expect(store.getSnapshot()).toMatchObject({ phase: "UNKNOWN", evidence: null, uncertain: true });
  await store.probe();
  expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1);
});
it("unavailable recovery storage prevents starting a write", async () => {
  const native = gateway();
  const store = createAudioProbeStore(probeScope(audioAsset()), native);
  await store.refresh();
  await store.probe();
  expect(native.probeSelectedAudioAssetVersion).not.toHaveBeenCalled();
  expect(store.getSnapshot().uncertain).toBe(true);
});
