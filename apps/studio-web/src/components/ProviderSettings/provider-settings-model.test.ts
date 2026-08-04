import { describe, expect, test } from "vitest";

import { compileModels } from "./provider-settings-model";

describe("provider settings model", () => {
  test("merges repeated model IDs without duplicating capabilities", () => {
    expect(
      compileModels({
        TEXT: "shared, text-only, shared",
        IMAGE: "shared",
        VIDEO: "",
        SPEECH: "voice-only",
      }),
    ).toEqual([
      { model_id: "shared", capabilities: ["TEXT", "IMAGE"] },
      { model_id: "text-only", capabilities: ["TEXT"] },
      { model_id: "voice-only", capabilities: ["SPEECH"] },
    ]);
  });
});
