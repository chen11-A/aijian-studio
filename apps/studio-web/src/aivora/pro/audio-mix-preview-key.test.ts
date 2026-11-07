import { expect, it } from "vitest";
import { audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import { sampleFilm, upgradeFilm } from "../film/project";
import { filmAudioSourceIdentity } from "../film/audio-waveform-data";
import { audioMixPreviewKey } from "./audio-mix-preview-key";
function fixture() {
  const film = upgradeFilm(sampleFilm())!;
  film.audioClips = [
    {
      id: "score",
      lane: "score",
      shotId: "",
      takeId: "",
      label: "Music",
      path: "/trusted/music.wav",
      startSeconds: 0,
      durationSeconds: 2,
      offsetSeconds: 0,
      gainDb: 0,
    },
  ];
  const clip = film.audioClips[0]!;
  clip.waveform = {
    schemaVersion: 1,
    sourceKey: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    identity: filmAudioSourceIdentity(film, clip),
    offsetSeconds: 0,
    durationSeconds: 2,
    analyzedSeconds: 2,
    peaks: [0.1, 0.2],
  };
  return film;
}
it("keeps assembly references, save metadata, title and waveform peaks out of the same-input retry budget", () => {
  const film = fixture(),
    changed = structuredClone(film);
  changed.title = "new title";
  changed.audioClips[0]!.libraryAsset = {
    assetId: "fixture",
    source: "https://example.invalid/public",
    author: "Fixture author",
    license: "CC0",
    sha256: "a".repeat(64),
    loopable: false,
    loudness: null,
  };
  changed.subtitleStyle = "white";
  changed.assemblyPath = "/private/assembly.mp4";
  changed.assemblyUrl = "aijian-media:///private/assembly.mp4";
  changed.audioClips[0]!.waveform!.peaks = [0.3, 0.4];
  changed.audioClips[0]!.waveform!.analyzedSeconds = 1;
  expect(audioMixPreviewKey(changed)).toBe(audioMixPreviewKey(film));
});
it("uses a current measured source SHA only as a new-check hint and ignores unrelated stale waveform identities", () => {
  const film = fixture(),
    changed = structuredClone(film);
  changed.audioClips[0]!.waveform!.sourceSha256 = "c".repeat(64);
  expect(audioMixPreviewKey(changed)).not.toBe(audioMixPreviewKey(film));
  changed.audioClips[0]!.waveform!.identity = "old source";
  const noCache = structuredClone(changed);
  delete noCache.audioClips[0]!.waveform;
  expect(audioMixPreviewKey(changed)).toBe(audioMixPreviewKey(noCache));
});
it.each(["gain", "trim", "path", "enabled", "envelope", "lane", "speech", "subtitle"])(
  "changes the budget for consumed %s inputs",
  (mode) => {
    const film = fixture(),
      changed = structuredClone(film),
      clip = changed.audioClips[0]!;
    if (mode === "gain") clip.gainDb = -6;
    else if (mode === "trim") clip.offsetSeconds = 0.2;
    else if (mode === "path") clip.path = "/trusted/other.wav";
    else if (mode === "enabled") clip.enabled = false;
    else if (mode === "envelope")
      clip.envelope = {
        schemaVersion: 1,
        baseGainDb: 0,
        fades: [{ direction: "in", startSeconds: 0, durationSeconds: 0.3 }],
      };
    else if (mode === "lane") {
      changed.audioMix = audioMixSettings(changed.audioMix);
      changed.audioMix.lanes.score.muted = true;
    } else if (mode === "speech") changed.shots[0]!.line = "new speech";
    else changed.subtitleStyle = "yellow";
    expect(audioMixPreviewKey(changed)).not.toBe(audioMixPreviewKey(film));
  },
);
