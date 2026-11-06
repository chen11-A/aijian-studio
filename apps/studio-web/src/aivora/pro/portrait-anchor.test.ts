import { describe, expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { makeAllPortraits } from "./portrait-workflow";

function fixture() {
  const film = sampleFilm();
  film.characters = [0, 1].map((index) => ({
    ...film.characters[0]!,
    id: `person-${index}`,
    name: `角色${index}`,
    identity: `角色${index}的外貌`,
    portraits: [],
  }));
  return film;
}

describe("portrait front anchors", () => {
  it("persists each front before editing other angles and never shares faces", async () => {
    let live = fixture();
    const generate = vi.fn(async (_prompt: string, references: string[]) => {
      const n = generate.mock.calls.length;
      if (references.length) {
        expect(live.characters.some((p) => p.portraits.some((v) => v.url === references[0]))).toBe(
          true,
        );
      }
      return { url: `/media/${n}.png`, reason: "" };
    });
    const result = await makeAllPortraits({
      base: live,
      current: () => live,
      apply: (next) => {
        live = next;
      },
      generate,
      progress: vi.fn(),
    });
    expect(result).toMatchObject({ total: 8, done: 8, failed: 0 });
    expect(generate.mock.calls[0]![0]).toContain("正面全身");
    expect(generate.mock.calls.map((call) => call[1])).toEqual([
      [],
      ["/media/1.png"],
      ["/media/1.png"],
      ["/media/1.png"],
      [],
      ["/media/5.png"],
      ["/media/5.png"],
      ["/media/5.png"],
    ]);
  });

  it("adds a counted prerequisite for a single missing angle and reuses existing fronts", async () => {
    let live = fixture();
    live.characters[1]!.portraits = [
      { view: "正面", prompt: "", url: "https://example.test/front.png" },
    ];
    const generate = vi.fn(async () => ({ url: "/new.png", reason: "" }));
    const result = await makeAllPortraits({
      base: live,
      current: () => live,
      apply: (next) => {
        live = next;
      },
      views: ["脸部"],
      generate,
      progress: vi.fn(),
    });
    expect(result).toMatchObject({ total: 3, done: 3 });
    expect(generate.mock.calls).toHaveLength(3);
    expect(generate).toHaveBeenNthCalledWith(2, expect.any(String), ["/new.png"]);
    expect(generate).toHaveBeenNthCalledWith(3, expect.any(String), [
      "https://example.test/front.png",
    ]);
  });

  it("retries a failed front once, fails its dependent angles without generating, and continues the next person", async () => {
    let live = fixture();
    const generate = vi.fn(async (prompt: string) => ({
      url: prompt.includes("角色0") ? "" : "/second.png",
      reason: "rejected",
    }));
    const result = await makeAllPortraits({
      base: live,
      current: () => live,
      apply: (next) => {
        live = next;
      },
      generate,
      progress: vi.fn(),
    });
    expect(generate).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({ total: 8, done: 4, failed: 4 });
    expect(result.failures.slice(1).map((failure) => failure.code)).toEqual(
      Array(3).fill("PORTRAIT_ANCHOR_REQUIRED"),
    );
    expect(
      result.failures
        .slice(1)
        .every((failure) => failure.reason === "先补好正面照，再生成这个角度。"),
    ).toBe(true);
    expect(live.characters[0]!.portraits).toEqual([]);
    expect(live.characters[1]!.portraits).toHaveLength(4);
  });

  it("rejects an edited angle if its front changed while the request was running", async () => {
    let live = fixture();
    live.characters[0]!.portraits = [{ view: "正面", prompt: "", url: "/old.png" }];
    const generate = vi.fn(async () => {
      live = {
        ...live,
        characters: live.characters.map((person) => ({
          ...person,
          portraits: [{ view: "正面", prompt: "", url: "/replacement.png" }],
        })),
      };
      return { url: "/stale.png", reason: "" };
    });
    const result = await makeAllPortraits({
      base: live,
      current: () => live,
      apply: (next) => {
        live = next;
      },
      views: ["侧面"],
      characterIds: ["person-0"],
      generate,
      progress: vi.fn(),
    });
    expect(result).toMatchObject({ failed: 1, done: 0 });
    expect(result.failures[0]?.reason).toBe("REQUEST_STALE");
    expect(JSON.stringify(live)).not.toContain("/stale.png");
  });
});
