import { expect, it, vi } from "vitest";
import { blankFilm, offlineShots } from "../../film/project";
import { prepareShotSceneReferences } from "./scene-references";

it("3JR-B08 saves selected scene before image requests and reuses the image", async () => {
  let live = blankFilm();
  live.locations = [];
  live.scenes[0]!.where = "书店 · 夜";
  live.scenes[0]!.text = "雨水敲打书店玻璃。";
  live.shots = offlineShots(live.scenes[0]!.text, live.scenes[0]!.id);
  const events: string[] = [];
  const request = vi.fn(async () => {
    expect(live.locations[0]?.sceneId).toBe(live.scenes[0]!.id);
    events.push("request");
    return { url: "/tmp/scene.png", reason: "" };
  });
  const host = {
    current: () => live,
    valid: () => true,
    request,
    apply: async (next: typeof live) => {
      live = next;
      events.push("save");
    },
  };
  const ready = await prepareShotSceneReferences(live, live.shots, host);
  expect(ready.locations[0]?.referenceImage).toBe("/tmp/scene.png");
  expect(events).toEqual(["save", "request", "save"]);
  await prepareShotSceneReferences(live, live.shots, host);
  expect(request).toHaveBeenCalledTimes(1);
});

it("3JR-B08 fails the prerequisite after two unsuccessful requests", async () => {
  let live = blankFilm();
  live.locations = [];
  live.scenes[0]!.where = "书店";
  live.shots = offlineShots("雨水敲打玻璃。", live.scenes[0]!.id);
  const request = vi.fn(async () => ({ url: "", reason: "failure" }));
  await expect(
    prepareShotSceneReferences(live, live.shots, {
      current: () => live,
      valid: () => true,
      request,
      apply: (next) => {
        live = next;
      },
    }),
  ).rejects.toMatchObject({ code: "LOCATION_IMAGE_FAILED" });
  expect(request).toHaveBeenCalledTimes(2);
  expect(live.locations[0]?.referenceImage).toBeUndefined();
});

it("3JR-B08 exposes a short missing-source notice without leaking an internal code", async () => {
  const { stillFailureNotice } = await import("../workflow");
  expect(
    stillFailureNotice(
      Object.assign(new Error("LOCATION_SOURCE_REQUIRED"), { code: "LOCATION_SOURCE_REQUIRED" }),
    ),
  ).toEqual({ code: "LOCATION_SOURCE_REQUIRED", text: "这一场还没有可用的环境描述。" });
});
