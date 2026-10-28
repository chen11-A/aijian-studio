import { describe, expect, it } from "vitest";
import { videoActions } from "./capabilities";

describe("subscription video actions", () => {
  it("enables generation on 1.5 and keeps edits off", () => {
    const actions = videoActions(["grok-imagine-video-1.5", "grok-imagine-image-2.0", "grok-tts"]);
    expect(actions.regenerate.enabled).toBe(true);
    expect(actions.rewrite.enabled).toBe(true);
    expect(actions.voice.enabled).toBe(true);
    expect(actions.cut.enabled).toBe(true);
    expect(actions.edit.enabled).toBe(false);
    expect(actions.extend.enabled).toBe(false);
    expect(actions.edit.reason).toContain("不能改画面细节");
  });

  it("does not treat the 1.5 id as the edit model", () => {
    const actions = videoActions(["grok-imagine-video-1.5-lite"]);
    expect(actions.regenerate.enabled).toBe(false);
    expect(actions.edit.enabled).toBe(false);
  });

  it("enables edits and extensions only for the exact older model", () => {
    const actions = videoActions(["grok-imagine-video", "grok-imagine-video-1.5"]);
    expect(actions.edit.enabled).toBe(true);
    expect(actions.extend.enabled).toBe(true);
    expect(actions.edit.reason).toContain("文字");
  });
});
