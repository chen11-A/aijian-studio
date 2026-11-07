import { expect, it, vi } from "vitest";
import { registerFilmDialogueSplits } from "./film-dialogue-split-ipc";
it("allows only exact authorized main-frame arguments with no record/path callbacks exposed", async () => {
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>(),
    beforeCommit = vi.fn();
  registerFilmDialogueSplits(
    (name, handler) => handlers.set(name, handler),
    (event: boolean) => event,
    { filmsRoot: "/must-not-read", beforeCommit },
  );
  for (const [channel, handler] of handlers) {
    expect([
      "film:dialogue-split-prepare",
      "film:dialogue-split-apply",
      "film:dialogue-split-verify-backup",
    ]).toContain(channel);
    await expect(handler(false, {})).rejects.toThrow("not authorized");
    await expect(handler(true, {}, {})).rejects.toThrow("Invalid dialogue split request");
    expect(
      await handler(true, {
        projectId: "film_aaaaaaaaaaaaaaaa",
        expectedHash: "a".repeat(64),
        shotId: "source",
        versions: 1,
        path: "/forged",
      }),
    ).toMatchObject({ kind: "FAILED", code: "INVALID_INPUT" });
  }
  expect(beforeCommit).not.toHaveBeenCalled();
});
