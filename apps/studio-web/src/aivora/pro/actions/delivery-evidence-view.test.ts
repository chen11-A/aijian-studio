import { describe, expect, it } from "vitest";
import { deliveryEvidenceView } from "./delivery-evidence-view";
import { writtenDelivery } from "../delivery-evidence.test-fixture";
describe("main delivery evidence presentation", () => {
  it("uses actual file facts instead of export settings and never projects internal selection IDs", () => {
    const raw = writtenDelivery();
    const before = structuredClone(raw),
      view = deliveryEvidenceView(raw, "PUBLISHED");
    expect(view.kind).toBe("written");
    if (view.kind !== "written") throw Error("missing view");
    expect(view.files[0]!.facts).toContainEqual({ label: "存储尺寸", value: "1920 × 1080" });
    expect(view.files[0]!.facts).toContainEqual({ label: "文件时长", value: "2.25 秒" });
    expect(view.settings).toContain("导出设置：720p");
    expect(JSON.stringify(view)).not.toMatch(/private-shot-id|private-take-id/);
    expect(raw).toEqual(before);
  });
  it("distinguishes unknown audio from an actual empty track inventory", () => {
    const raw = writtenDelivery();
    let view = deliveryEvidenceView(raw, "PUBLISHED");
    if (view.kind !== "written") throw Error("missing view");
    expect(view.files[0]!.facts).toContainEqual({ label: "音轨", value: "未核验" });
    raw.manifest.files[0]!.technical!.audioTracks = [];
    view = deliveryEvidenceView(raw, "PUBLISHED");
    if (view.kind !== "written") throw Error("missing view");
    expect(view.files[0]!.facts).toContainEqual({ label: "音轨", value: "检测未发现音轨" });
  });
  it("does not reconstruct a manifest for legacy or failed writes", () => {
    expect(deliveryEvidenceView(undefined, "PUBLISHED")).toEqual({ kind: "not-provided" });
    const view = deliveryEvidenceView(
      {
        kind: "FAILED",
        code: "EVIDENCE_WRITE_FAILED",
        files: [{ role: "video", aspectRatio: "16:9", fileName: "已落视频.mp4" }],
      },
      "PARTIAL",
    );
    expect(view).toEqual({
      kind: "failed",
      reason: "write-failed",
      files: [{ name: "已落视频.mp4", role: "视频", aspect: "16:9", facts: [] }],
    });
  });
  it("requires a partial manifest for a partial publish and preserves all unverified items", () => {
    const raw = writtenDelivery("partial");
    expect(deliveryEvidenceView(raw, "PUBLISHED")).toEqual({ kind: "invalid" });
    const view = deliveryEvidenceView(raw, "PARTIAL");
    if (view.kind !== "written") throw Error("missing view");
    expect(view.partial).toBe(true);
    expect(view.unverified).toEqual(raw.manifest.unverified);
  });
  it("rejects unsafe metadata or invalid technical evidence as a whole instead of rendering paths or raw objects", () => {
    for (const mutate of [
      (row: ReturnType<typeof writtenDelivery>) => {
        row.fileName = "/private/secret.json";
      },
      (row: ReturnType<typeof writtenDelivery>) => {
        row.manifest.files[0]!.sha256 = "not-a-sha";
      },
      (row: ReturnType<typeof writtenDelivery>) => {
        row.manifest.files[0]!.technical!.durationSeconds = NaN;
      },
      (row: ReturnType<typeof writtenDelivery>) => {
        row.manifest.files[0]!.technical!.video!.codec = "sk-PRIVATE_SECRET";
      },
      (row: ReturnType<typeof writtenDelivery>) => {
        row.manifest.unverified.push("token=PRIVATE_SECRET");
      },
      (row: ReturnType<typeof writtenDelivery>) => {
        row.manifest.selection[0]!.label = "/private/record";
      },
    ]) {
      const raw = writtenDelivery();
      mutate(raw);
      expect(deliveryEvidenceView(raw, "PUBLISHED")).toEqual({ kind: "invalid" });
    }
  });
});
