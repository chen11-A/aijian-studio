import { beforeEach, expect, it } from "vitest";
import { MODEL_CENTER_KEY, selectCenteredModel } from "../account/model-center";
import { snapshotVideoSelection } from "./video-model-selection";
import { generationExecutionNotice } from "./actions/generation-execution";

beforeEach(() => window.localStorage.clear());
it("captures only VIDEO preference without modifying the mode or selecting a fallback", () => {
  expect(snapshotVideoSelection()).toBeUndefined();
  selectCenteredModel("IMAGE", { provider: "XAI_API", modelId: "image" });
  expect(snapshotVideoSelection()).toBeUndefined();
  selectCenteredModel("VIDEO", { provider: "GROK_LOGIN", modelId: "grok-imagine-video-1.5" });
  const frozen = snapshotVideoSelection();
  const before = window.localStorage.getItem(MODEL_CENTER_KEY);
  expect(snapshotVideoSelection()).toEqual(frozen);
  expect(window.localStorage.getItem(MODEL_CENTER_KEY)).toBe(before);
  selectCenteredModel("VIDEO", {
    provider: "CONNECTION",
    connectionId: "alternate",
    modelId: "other",
  });
  expect(frozen).toEqual({ provider: "GROK_LOGIN", modelId: "grok-imagine-video-1.5" });
  expect(snapshotVideoSelection()).toEqual({
    provider: "CONNECTION",
    connectionId: "alternate",
    modelId: "other",
  });
});
it("presents unsupported VIDEO as an actionable Chinese model choice error", () => {
  expect(generationExecutionNotice({ code: "VIDEO_SELECTION_UNSUPPORTED" })).toMatchObject({
    code: "VIDEO_SELECTION_UNSUPPORTED",
    text: expect.stringContaining("模型中心"),
  });
});
