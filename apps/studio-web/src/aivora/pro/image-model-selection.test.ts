import { afterEach, expect, it, vi } from "vitest";
import { MODEL_CENTER_KEY, selectCenteredModel } from "../account/model-center";
import { requestStill } from "./workflow";

const priorBridge = window.aijian;
afterEach(() => {
  window.localStorage.removeItem(MODEL_CENTER_KEY);
  window.aijian = priorBridge;
});
const choice = { provider: "GROK_LOGIN" as const, modelId: "grok-imagine-image-2.0" };
it("passes the selected standalone image choice to native without changing its legacy argument positions", async () => {
  selectCenteredModel("IMAGE", choice);
  const generate = vi.fn(async () => ({ path: "/tmp/frame.png", reason: "" }));
  window.aijian = { generateFilmStill: generate } as unknown as Window["aijian"];
  expect((await requestStill("series", "画面", "16:9", [])).url).not.toBe("");
  expect(generate).toHaveBeenCalledExactlyOnceWith("series", "画面", "16:9", [], undefined, choice);
});
it("returns the native unsupported-selection reason without reporting image success or retrying", async () => {
  selectCenteredModel("IMAGE", {
    provider: "CONNECTION",
    connectionId: "configured",
    modelId: "not-wired",
  });
  const generate = vi.fn(async () => ({
    path: "",
    reason: "所选图像模型尚未接入出图。",
    code: "UNSUPPORTED_SCOPE",
  }));
  window.aijian = { generateFilmStill: generate } as unknown as Window["aijian"];
  expect(await requestStill("series", "画面")).toEqual({
    url: "",
    reason: "所选图像模型尚未接入出图。",
  });
  expect(generate).toHaveBeenCalledOnce();
});
it("does not reread a newer center choice for an already issued protected image stage", async () => {
  selectCenteredModel("IMAGE", { provider: "XAI_API", modelId: "later-choice" });
  const generate = vi.fn(async () => ({ path: "/tmp/frame.png", reason: "" }));
  window.aijian = { generateFilmStill: generate } as unknown as Window["aijian"];
  const issued = { executionId: "issued", stageId: "frame" };
  await requestStill("series", "画面", "16:9", [], issued);
  expect(generate).toHaveBeenCalledExactlyOnceWith("series", "画面", "16:9", [], issued);
});
it("keeps unselected legacy still calls at their original arity", async () => {
  window.localStorage.removeItem(MODEL_CENTER_KEY);
  const generate = vi.fn(async () => ({ path: "/tmp/frame.png", reason: "" }));
  window.aijian = { generateFilmStill: generate } as unknown as Window["aijian"];
  await requestStill("series", "画面");
  expect(generate).toHaveBeenCalledExactlyOnceWith("series", "画面", "9:16", []);
});
