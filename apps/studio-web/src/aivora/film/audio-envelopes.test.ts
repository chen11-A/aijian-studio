import { expect, it } from "vitest";
import { audioMixEnvelope } from "@aijian/contracts/film-audio-mix-plan";
import { normalizeAudioClips } from "./audio";
const row = {
  id: "clip",
  lane: "sfx",
  shotId: "s",
  takeId: "t",
  label: "真实音效",
  startSeconds: 0,
  durationSeconds: 1,
  offsetSeconds: 0.2,
  gainDb: -6,
  path: "/owned/sound.ogg",
};
it("preserves creative relative-time envelope data and the existing absolute clip gain", () => {
  const envelope = {
    schemaVersion: 1,
    baseGainDb: -6,
    fades: [{ direction: "in", startSeconds: -0.2, durationSeconds: 0.5 }],
    gainAutomation: [{ startSeconds: 0, endSeconds: 0.7, gainDb: -12 }],
  };
  const value = normalizeAudioClips([{ ...row, envelope }])[0]!;
  expect(value.envelope).toEqual(envelope);
  expect(value.gainDb).toBe(-6);
  expect(JSON.parse(JSON.stringify(value)).envelope).toEqual(envelope);
});
it("does not silently drop a malformed envelope and thereby play the underlying clip at full volume", () => {
  const invalid = { schemaVersion: 1, baseGainDb: -6, gainAutomation: [null, {}] };
  const value = normalizeAudioClips([{ ...row, envelope: invalid }])[0]!;
  expect(value.envelope).toEqual(invalid);
  expect(() => audioMixEnvelope(value.envelope)).toThrow("INVALID_AUDIO_ENVELOPE");
  expect(normalizeAudioClips([row])[0]).not.toHaveProperty("envelope");
});
