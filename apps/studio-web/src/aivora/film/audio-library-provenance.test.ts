import { expect, it } from "vitest";
import { normalizeAudioClips } from "./audio";
import { normalizeLibraryProvenance } from "./audio-library-provenance";
const source = {
  assetId: "bundled-sfx",
  source: "https://example.org/original",
  author: "原作者",
  license: "CC0-1.0",
  sha256: "a".repeat(64),
  loopable: false,
  loudness: null,
  processingGainDb: 20.68,
};
it("keeps creative source attribution and a real sound label without reapplying baked processing gain", () => {
  const [clip] = normalizeAudioClips([
    {
      id: "clip",
      lane: "sfx",
      label: "小刀划动",
      shotId: "shot",
      takeId: "take",
      startSeconds: 0,
      offsetSeconds: 0,
      durationSeconds: 0.3,
      gainDb: 0,
      path: "/owned/asset.ogg",
      libraryAsset: { ...source, secret: "discard unknown metadata", path: "/forged/library/root" },
    },
  ]);
  expect(clip!.label).toBe("小刀划动");
  expect(clip!.gainDb).toBe(0);
  expect(clip!.libraryAsset).toEqual(source);
  expect(JSON.stringify(clip)).not.toContain("discard unknown metadata");
  expect(JSON.stringify(clip)).not.toContain("/forged/library/root");
});
it("rejects malformed provenance without granting anything from an asset identifier or license text", () => {
  for (const edit of [
    { source: "file:///private" },
    { sha256: "invalid" },
    { loudness: Infinity },
    { loopable: "true" },
    { processingGainDb: NaN },
  ])
    expect(normalizeLibraryProvenance({ ...source, ...edit })).toBeUndefined();
  expect(normalizeLibraryProvenance(null)).toBeUndefined();
});
