import { expect, it, vi } from "vitest";
import { audioMixEnvelopeCurves } from "@aijian/contracts/film-audio-mix-plan";
import type { MixTrack } from "@aijian/contracts/film-audio-mix";
import { scheduleEnvelopeCurve } from "./audio-envelope-schedule";
const track: MixTrack = {
  key: "a",
  sourceKey: "a",
  lane: "ambience",
  startSeconds: 2,
  endSeconds: 6,
  offsetSeconds: 0.8,
  gainDb: -6,
  native: false,
  loopSeconds: 1,
  envelope: {
    schemaVersion: 1,
    baseGainDb: -6,
    fades: [{ direction: "in", startSeconds: -0.5, durationSeconds: 1 }],
    gainAutomation: [
      { startSeconds: 1, endSeconds: 2, gainDb: -12 },
      { startSeconds: 2, endSeconds: 3, gainDb: -9 },
    ],
  },
};
it("schedules the existing cropped fade from its actual progress on seek/rate2, not its source loop", () => {
  const curves = audioMixEnvelopeCurves(track);
  const parameter = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  scheduleEnvelopeCurve(parameter, curves[0]!, 2, 10, 2);
  expect(parameter.setValueAtTime).toHaveBeenCalledWith(0.5, 10);
  expect(parameter.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.25);
  const automation = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  scheduleEnvelopeCurve(automation, curves[1]!, 3.5, 20, 0.5);
  expect(automation.setValueAtTime.mock.calls).toEqual([
    [10 ** (-6 / 20), 20],
    [10 ** (-3 / 20), 21],
    [1, 23],
  ]);
  expect(automation.linearRampToValueAtTime).not.toHaveBeenCalled();
});
it("rejects an invalid clock rather than claiming successful scheduling", () => {
  expect(() =>
    scheduleEnvelopeCurve(
      { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      audioMixEnvelopeCurves(track)[0]!,
      2,
      10,
      0,
    ),
  ).toThrow("INVALID_PREVIEW_CLOCK");
});
