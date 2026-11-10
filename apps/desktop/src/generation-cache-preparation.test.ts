import { describe, expect, it } from "vitest";
import { parseGenerationSlotPreparations } from "./generation-cache-preparation";

const part = (sha256: string) => ({ sha256, bytes: 4 });
const cache = {
  schema_version: 1,
  snapshot_sha256: "a".repeat(64),
  input_sha256: "b".repeat(64),
  request: { scene_label: "私有请求" },
  sources: [
    {
      source: "owned",
      canonical_path: "/only/main",
      sha256: "c".repeat(64),
      mime: "video/mp4",
    },
  ],
  runtime_recipe: { cap: 10, actual_video: { kept: true } },
  parts: { image: part("d".repeat(64)), video: part("e".repeat(64)), voice: part("f".repeat(64)) },
};

describe("private cache preparation parser", () => {
  it("keeps slot 0 cache private and rejects a cache object on a fresh client slot", () => {
    const facts = parseGenerationSlotPreparations({
      kind: "PREPARATIONS",
      items: [
        { target_key: "target", slot_index: 0, preparation: "STORYFILM_CACHE", cache },
        { target_key: "target", slot_index: 1, preparation: "CLIENT_IMAGES", cache: null },
        { target_key: "target", slot_index: 2, preparation: "CLIENT_IMAGES", cache: null },
      ],
    });
    expect(facts.kind).toBe("PREPARATIONS");
    expect(facts.items.map((item) => item.preparation)).toEqual([
      "STORYFILM_CACHE",
      "CLIENT_IMAGES",
      "CLIENT_IMAGES",
    ]);
    expect(facts.items[0]?.cache?.sources[0]?.canonicalPath).toBe("/only/main");
    expect(facts.items[1]?.cache).toBeNull();
    expect(() =>
      parseGenerationSlotPreparations({
        kind: "PREPARATIONS",
        items: [{ target_key: "target", slot_index: 1, preparation: "CLIENT_IMAGES", cache }],
      }),
    ).toThrow("CREATION_INPUT_UNVERIFIABLE");
    expect(() =>
      parseGenerationSlotPreparations({
        kind: "PREPARATIONS",
        items: [{ target_key: "target", slot_index: 1, preparation: "STORYFILM_CACHE", cache }],
      }),
    ).toThrow("CREATION_INPUT_UNVERIFIABLE");
  });

  it("rejects a frozen row that is not in the registered plan", () => {
    const expected = [
      { targetKey: "target", slotIndex: 0 },
      { targetKey: "target", slotIndex: 1 },
    ];
    expect(() =>
      parseGenerationSlotPreparations(
        {
          kind: "PREPARATIONS",
          items: [
            { target_key: "target", slot_index: 0, preparation: "CLIENT_IMAGES", cache: null },
            { target_key: "target", slot_index: 1, preparation: "CLIENT_IMAGES", cache: null },
            { target_key: "other", slot_index: 0, preparation: "CLIENT_IMAGES", cache: null },
          ],
        },
        expected,
      ),
    ).toThrow("CREATION_INPUT_UNVERIFIABLE");
    expect(
      parseGenerationSlotPreparations(
        {
          kind: "PREPARATIONS",
          items: [
            { target_key: "target", slot_index: 0, preparation: "CLIENT_IMAGES", cache: null },
            { target_key: "target", slot_index: 1, preparation: "CLIENT_IMAGES", cache: null },
          ],
        },
        expected,
      ).items,
    ).toHaveLength(2);
  });

  it("rejects a public kind, a short table, and a duplicate slot", () => {
    for (const payload of [
      { kind: "PREPARED", items: [] },
      { kind: "PREPARATIONS", items: [] },
      {
        kind: "PREPARATIONS",
        items: [
          { target_key: "target", slot_index: 0, preparation: "CLIENT_IMAGES", cache: null },
          { target_key: "target", slot_index: 0, preparation: "CLIENT_IMAGES", cache: null },
        ],
      },
    ])
      expect(() => parseGenerationSlotPreparations(payload)).toThrow("CREATION_INPUT_UNVERIFIABLE");
  });
});
