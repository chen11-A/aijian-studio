import { expect, it } from "vitest";
import { videoDurationFromProbe } from "./film-silent-export";

it("uses the video stream duration and falls back to the container when the stream omits it", () => {
  expect(
    videoDurationFromProbe({ streams: [{ duration: "1.25" }], format: { duration: "9" } }),
  ).toBe(1.25);
  expect(
    videoDurationFromProbe({ streams: [{ duration: "N/A" }], format: { duration: "0.4" } }),
  ).toBe(0.4);
  expect(videoDurationFromProbe({ streams: [{}], format: { duration: 0.5 } })).toBe(0.5);
  expect(() => videoDurationFromProbe({ streams: [{}], format: {} })).toThrow(
    "INVALID_AUDIO_SOURCE",
  );
});
