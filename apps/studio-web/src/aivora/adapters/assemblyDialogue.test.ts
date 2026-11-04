import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindAssemblyDialogue,
  scriptSpeakerId,
  validDialogueBinding,
  type AssemblyDialogueBinding,
} from "./assemblyDialogue";
import { staticAnimaticContent, type AssemblyContent } from "./episodeMediaAssembly";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const version = `ver_${"1".repeat(32)}`;
const binding: AssemblyDialogueBinding = {
  script_version_id: version,
  script_block_id: `sblk_${"c".repeat(32)}`,
  speaker_id: "spk_bc0090202dab5bd8d5f5fc81df3e48eb",
  delivery: "OFF_SCREEN",
};
const media = {
  asset_id: `asset_${"d".repeat(32)}`,
  asset_version_id: `asv_${"e".repeat(32)}`,
  sha256: "f".repeat(64),
};
function content(): AssemblyContent {
  return {
    ...staticAnimaticContent(project, episode, [{ media, frames: 100 }]),
    audio_segments: [
      {
        segment_id: "seg_audio",
        track_kind: "BGM",
        media,
        start_frame: 4,
        end_frame: 80,
        source_in_sample: 441,
      },
      {
        segment_id: "seg_other_audio",
        track_kind: "DIALOGUE",
        media,
        start_frame: 20,
        end_frame: 100,
        source_in_sample: 0,
        ...binding,
      },
    ],
  };
}

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe("exact saved script speaker identity", () => {
  it.each([
    ["林夕", "spk_bc0090202dab5bd8d5f5fc81df3e48eb"],
    [" 林夕 ", "spk_e9e48eccf8774f5b70689c6e047e2aa4"],
    ["e\u0301", "spk_402374951ce92e278d2f6a14c26cec65"],
    ["é", "spk_ed29a1139625ae5b7a9ac45cb3438587"],
    ['角色🌙\n"台词"\\尾', "spk_14a07ea7dbcdc332007bd21e5c23e5a8"],
  ])(
    "matches the backend UTF-8 JSON hash for %j without normalization",
    async (label, expected) => {
      expect(await scriptSpeakerId(project, episode, version, label)).toBe(expected);
    },
  );

  it("scopes identities to the exact project, episode and version", async () => {
    const original = await scriptSpeakerId(project, episode, version, "林夕");
    for (const args of [
      [`prj_${"0".repeat(32)}`, episode, version],
      [project, `ep_${"0".repeat(32)}`, version],
      [project, episode, `ver_${"0".repeat(32)}`],
    ] as const) {
      expect(await scriptSpeakerId(args[0], args[1], args[2], "林夕")).not.toBe(original);
    }
  });

  it("fails closed when hashing or UTF-8 encoding is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(await scriptSpeakerId(project, episode, version, "林夕")).toBeNull();
    vi.stubGlobal("crypto", {});
    expect(await scriptSpeakerId(project, episode, version, "林夕")).toBeNull();
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("TextEncoder", undefined);
    expect(await scriptSpeakerId(project, episode, version, "林夕")).toBeNull();
  });

  it("fails closed when SHA-256 rejects or returns a malformed digest", async () => {
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn().mockRejectedValue(new Error("unavailable")) },
    });
    expect(await scriptSpeakerId(project, episode, version, "林夕")).toBeNull();
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(16)) } });
    expect(await scriptSpeakerId(project, episode, version, "林夕")).toBeNull();
  });
});

describe("imported audio dialogue binding", () => {
  it("changes only the selected track kind and four references immutably", () => {
    const original = content();
    const before = structuredClone(original);
    Object.freeze(original.audio_segments[0]);
    Object.freeze(original.audio_segments);
    Object.freeze(original);
    const next = bindAssemblyDialogue(original, "seg_audio", binding);
    expect(next.audio_segments[0]).toEqual({
      ...before.audio_segments[0],
      ...binding,
      track_kind: "DIALOGUE",
    });
    expect(next.audio_segments[1]).toBe(original.audio_segments[1]);
    expect(next.visual_segments).toBe(original.visual_segments);
    expect(next.subtitle_segments).toBe(original.subtitle_segments);
    expect(next.sequence_timebase).toBe(original.sequence_timebase);
    expect(next.total_frames).toBe(original.total_frames);
    expect(original).toEqual(before);
  });

  it("clears all four references on only the selected audio when converting to BGM", () => {
    const original = bindAssemblyDialogue(content(), "seg_audio", binding);
    const next = bindAssemblyDialogue(original, "seg_audio", null);
    expect(next.audio_segments[0]).toEqual({
      ...content().audio_segments[0],
      script_version_id: null,
      script_block_id: null,
      speaker_id: null,
      delivery: null,
    });
    for (const field of Object.keys(binding))
      expect(next.audio_segments[0]).toHaveProperty(field, null);
    expect(next.audio_segments[1]).toBe(original.audio_segments[1]);
    expect(original.audio_segments[0]).toMatchObject(binding);
  });

  it("supports SFX imports and ignores extra binding fields", () => {
    const original = content();
    original.audio_segments[0]!.track_kind = "SFX";
    const extra = { ...binding, media: null, start_frame: 90, track_kind: "BGM" };
    const next = bindAssemblyDialogue(original, "seg_audio", extra);
    expect(next.audio_segments[0]).toEqual({
      ...original.audio_segments[0],
      ...binding,
      track_kind: "DIALOGUE",
    });
  });

  it("keeps a missing selection or malformed binding unchanged", () => {
    const original = content();
    expect(bindAssemblyDialogue(original, "missing", binding)).toBe(original);
    expect(
      bindAssemblyDialogue(original, "seg_audio", {
        ...binding,
        delivery: "INVALID",
      } as unknown as AssemblyDialogueBinding),
    ).toBe(original);
  });

  it("validates only the four reference fields on bindings and complete segments", () => {
    expect(validDialogueBinding(binding)).toBe(true);
    expect(
      validDialogueBinding({ ...content().audio_segments[0], ...binding, track_kind: "DIALOGUE" }),
    ).toBe(true);
    expect(validDialogueBinding({ ...binding, delivery: "ON_SCREEN" })).toBe(true);
    expect(validDialogueBinding(Object.create(binding))).toBe(false);
  });

  it.each([
    null,
    undefined,
    [],
    "binding",
    {},
    { ...binding, script_version_id: null },
    { ...binding, script_version_id: `ver_${"a".repeat(31)}` },
    { ...binding, script_version_id: `VER_${"a".repeat(32)}` },
    { ...binding, script_block_id: undefined },
    { ...binding, script_block_id: `scn_${"a".repeat(32)}` },
    { ...binding, speaker_id: `spk_${"A".repeat(32)}` },
    { ...binding, speaker_id: 12 },
    { ...binding, delivery: null },
    { ...binding, delivery: "on_screen" },
    { ...binding, delivery: { toString: () => "ON_SCREEN" } },
  ])("rejects malformed dialogue references: %j", (value) => {
    expect(validDialogueBinding(value)).toBe(false);
  });
});
