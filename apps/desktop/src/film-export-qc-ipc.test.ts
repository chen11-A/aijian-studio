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
});
