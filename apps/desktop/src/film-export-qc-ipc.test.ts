import { describe, expect, it, vi } from "vitest";
import { registerFilmExportQc } from "./film-export-qc-ipc";
import type { FilmQcHost } from "./film-export-qc";
describe("checked export IPC", () => {
  function fixture() {
    const handlers = new Map<
      string,
      (event: { ok: boolean; id: string }, ...args: unknown[]) => Promise<unknown>
    >();
    const host: FilmQcHost = {
      filmsRoot: "unused",
      storyFilmsRoot: "unused",
      temporaryRoot: "unused",
      read: vi.fn(async () => null),
      tools: vi.fn(),
      engine: vi.fn(),
      font: () => undefined,
      pickDirectory: vi.fn(),
    };
    const watch = vi.fn();
    registerFilmExportQc(
      (channel, handler) => handlers.set(channel, handler),
      (event: { ok: boolean; id: string }) => event.ok,
      (event) => event.id,
      host,
      watch,
    );
    return { handlers, host, watch };
  }
  it("rejects unauthorized callers and invalid argument arity before project or tool reads", async () => {
    const f = fixture();
    for (const action of ["prepare", "publish", "discard"]) {
      await expect(
        f.handlers.get(`film:qc-${action}`)!({ ok: false, id: "other" }, {}),
      ).rejects.toThrow("not authorized");
      await expect(
        f.handlers.get(`film:qc-${action}`)!({ ok: true, id: "owner" }, {}, {}),
      ).rejects.toThrow("one request");
    }
    expect(f.host.read).not.toHaveBeenCalled();
    expect(f.host.tools).not.toHaveBeenCalled();
  });
  it("does not accept renderer execution paths or fabricated receipts, and only registers one owner lifetime watcher", async () => {
    const f = fixture(),
      event = { ok: true, id: "owner" };
    expect(
      await f.handlers.get("film:qc-prepare")!(event, {
        projectId: "film_a",
        path: "/arbitrary.mp4",
      }),
    ).toEqual({ kind: "FAILED", code: "INVALID_INPUT" });
    await f.handlers.get("film:qc-discard")!(event, "fabricated");
    await f.handlers.get("film:qc-discard")!(event, "fabricated");
    expect(f.watch).toHaveBeenCalledTimes(1);
    expect(f.host.read).not.toHaveBeenCalled();
    expect(f.host.tools).not.toHaveBeenCalled();
  });
  it("reclaims one owner only after all of that owner's projects settle", async () => {
    const waits: Array<(value: null) => void> = [];
    const handlers = new Map<
      string,
      (event: { ok: boolean; id: string }, ...args: unknown[]) => Promise<unknown>
    >();
    const host: FilmQcHost = {
      filmsRoot: "unused",
      storyFilmsRoot: "unused",
      temporaryRoot: "unused",
      read: () => new Promise((resolve) => waits.push(resolve)),
      tools: vi.fn(),
      engine: vi.fn(),
      font: () => undefined,
      pickDirectory: vi.fn(),
    };
    registerFilmExportQc<{ ok: boolean; id: string }>(
      (channel, handler) => handlers.set(channel, handler),
      () => true,
      (event) => event.id,
      host,
    );
    const disposed: string[] = [];
    const request = (projectId: string) => ({
      projectId,
      expectedSelection: [{ shotId: "shot-one", takeId: "take-one" }],
      settings: {
        aiMark: false,
        aspects: ["16:9"],
        quality: "720p",
        style: "white",
        subtitles: "none",
      },
    });
    const ownerA = { ok: true, id: "owner-a" };
    const ownerB = { ok: true, id: "owner-b" };
    const first = handlers.get("film:qc-prepare")!(
      ownerA,
      request(`film_${"a".repeat(16)}`),
      "project-a",
    );
    const second = handlers.get("film:qc-prepare")!(
      ownerA,
      request(`film_${"b".repeat(16)}`),
      "project-b",
    );
    const third = handlers.get("film:qc-prepare")!(
      ownerB,
      request(`film_${"c".repeat(16)}`),
      "project-c",
    );
    await vi.waitFor(() => expect(waits).toHaveLength(3));
    host.noteOwnerLost!("owner-a", () => disposed.push("owner-a"));
    host.noteOwnerLost!("owner-b", () => disposed.push("owner-b"));
    expect(disposed).toEqual([]);
    waits[0]!(null);
    await expect(first).resolves.toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
    expect(disposed).toEqual([]);
    waits[1]!(null);
    await expect(second).resolves.toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
    expect(disposed).toEqual(["owner-a"]);
    waits[2]!(null);
    await expect(third).resolves.toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
    expect(disposed).toEqual(["owner-a", "owner-b"]);
  });
});
