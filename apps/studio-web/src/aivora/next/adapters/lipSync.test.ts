import { describe, expect, it } from "vitest";
import type { FilmShot, FilmTake } from "../../film/project";
import { lipSyncTag } from "./lipSync";

const take = (id: string, status: FilmTake["status"], lipSync?: unknown): FilmTake =>
  ({ id, status, lipSync }) as unknown as FilmTake;

const shot = (takes: FilmTake[], selectedTakeId = ""): FilmShot =>
  ({ takes, selectedTakeId }) as unknown as FilmShot;

describe("lipSyncTag", () => {
  it("shows nothing without a take in use or without a lip sync state", () => {
    expect(lipSyncTag(shot([]))).toBeNull();
    expect(lipSyncTag(shot([take("a", "done")]))).toBeNull();
    expect(lipSyncTag(shot([take("a", "done", { lipSync: "none" })]))).toBeNull();
  });

  it("labels all old marker states as unverified and preserves the historical failed styling", () => {
    expect(lipSyncTag(shot([take("a", "done", { lipSync: "done" })]))?.text).toBe("口型待核验");
    expect(lipSyncTag(shot([take("a", "done", "pending")]))?.title).toBe(
      "历史口型标记为待处理，当前未核验实际口型状态。",
    );
    const failed = lipSyncTag(shot([take("a", "done", { lipSync: "failed" })]));
    expect(failed).toMatchObject({ text: "口型待核验", failed: true });
    expect(failed?.title).toBe("历史口型标记为失败，实际对齐与声音尚未核验。");
  });

  it("reads the chosen take, not just the first one", () => {
    const takes = [
      take("a", "done", { lipSync: "failed" }),
      take("b", "done", { lipSync: "done" }),
    ];
    expect(lipSyncTag(shot(takes, "b"))?.failed).toBe(false);
    expect(lipSyncTag(shot(takes))?.failed).toBe(true);
  });
});
