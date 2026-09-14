import { describe, expect, it } from "vitest";
import type { StudioTransport } from "../../api/studio";
import { loadStoryWorkspace } from "./storyWorkspace";

describe("story workspace adapter", () => {
  it("does not ask for a story bible until an accepted source version exists", async () => {
    const transport = {
      getStoryBibleIndex: () => {
        throw new Error("unexpected");
      },
    } as unknown as StudioTransport;
    await expect(loadStoryWorkspace(transport, "prj_x", null)).resolves.toEqual({
      storyBibleIndex: null,
      storyBibleVersion: null,
    });
  });
});
