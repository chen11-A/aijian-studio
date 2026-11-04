import { describe, expect, it } from "vitest";
import { coverageNotice } from "./coverage-notice";
import type { SceneCoverage } from "./contracts3j";

const missing: SceneCoverage = {
  sceneId: "scene-1",
  ok: false,
  lastLine: "一起上！",
  missingLines: ["一起上！", "别走。"],
  missingTail: "警笛响起。",
};
describe("UIR-02 coverage explanation", () => {
  it("names missing dialogue and tail with a next step, keeping the code out of copy", () => {
    const message = coverageNotice(missing);
    expect(message.code).toBe("COVERAGE_INCOMPLETE");
    const visible = `${message.text} ${message.detail}`;
    for (const text of ["一起上！", "别走。", "警笛响起。", "导演再拆一次", "补镜头"])
      expect(visible).toContain(text);
    expect(visible).not.toMatch(/\b[A-Z]{3,}(?:_[A-Z0-9]+)+\b/);
    expect(visible).not.toContain("保留全部台词");
  });
  it("retains paragraph ownership risk without inventing missing dialogue", () => {
    const message = coverageNotice({ ...missing, missingLines: [], missingTail: null });
    expect(message.detail).toContain("场次归属需要核对");
    expect(message.detail).not.toContain("一起上");
  });
  it("does not show repair instructions once coverage is complete", () => {
    expect(coverageNotice({ ...missing, ok: true, missingLines: [], missingTail: null })).toEqual({
      code: "COVERAGE_COMPLETE",
      text: "台词和结尾已覆盖。",
    });
  });
});
