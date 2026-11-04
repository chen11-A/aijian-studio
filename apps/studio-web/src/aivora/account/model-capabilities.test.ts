import { describe, expect, it } from "vitest";
import {
  capabilitiesForListedModel,
  capabilitiesForModelId,
  capabilitiesFromModalities,
} from "./model-capabilities";

describe("model capability classification", () => {
  it("reads output modalities from a live catalog before guessing from the id", () => {
    expect(capabilitiesFromModalities(["image"])).toEqual(["IMAGE"]);
    expect(capabilitiesFromModalities(["text", "audio"])).toEqual(["TEXT", "SPEECH"]);
    expect(
      capabilitiesForListedModel({
        id: "grok-4.7",
        outputModalities: ["text"],
      }),
    ).toEqual(["TEXT"]);
    expect(
      capabilitiesForListedModel({
        id: "grok-imagine-image-2.0",
        outputModalities: ["image"],
      }),
    ).toEqual(["IMAGE"]);
  });

  it("maps documented xAI and ChatGPT ids when the catalog omits modalities", () => {
    expect(capabilitiesForModelId("grok-4.7")).toEqual(["TEXT"]);
    expect(capabilitiesForModelId("grok-imagine-image-2.0")).toEqual(["IMAGE"]);
    expect(capabilitiesForModelId("grok-imagine-image")).toEqual(["IMAGE"]);
    expect(capabilitiesForModelId("grok-imagine-video-1.5")).toEqual(["VIDEO"]);
    expect(capabilitiesForModelId("grok-imagine-video-1.5-lite")).toEqual(["VIDEO"]);
    expect(capabilitiesForModelId("grok-tts")).toEqual(["SPEECH"]);
    expect(capabilitiesForModelId("grok-voice-3.0")).toEqual(["SPEECH"]);
    expect(capabilitiesForModelId("gpt-image-1")).toEqual(["IMAGE"]);
    expect(capabilitiesForModelId("sora-2")).toEqual(["VIDEO"]);
    expect(capabilitiesForModelId("tts-1")).toEqual(["SPEECH"]);
    expect(capabilitiesForModelId("gpt-5")).toEqual(["TEXT"]);
    expect(capabilitiesForListedModel({ id: "grok-4.7" })).toEqual(["TEXT"]);
  });
});
