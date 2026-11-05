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

  it("says 口型 when it is done or being done, and when it failed that it can be tried again", () => {
    expect(lipSyncTag(shot([take("a", "done", { lipSync: "done" })]))?.text).toBe("口型");
    expect(lipSyncTag(shot([take("a", "done", "pending")]))?.title).toBe("正在对口型");
    const failed = lipSyncTag(shot([take("a", "done", { lipSync: "failed" })]));
    expect(failed).toMatchObject({ text: "口型未对上", failed: true });
    expect(failed?.title).toContain("可重试");
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
