import { expect, it, vi } from "vitest";
import { registerFilmAudioLibrary } from "./film-audio-library-ipc";
it("admits only the authorized main frame and exact argument counts before reading any resource or project", async () => {
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  const root = vi.fn(() => "/must-not-read"),
    run = vi.fn(),
    tools = vi.fn();
  registerFilmAudioLibrary(
    (name, handler) => handlers.set(name, handler),
    (event: boolean) => event,
    {
      filmsRoot: "/must-not-read",
      storyFilmsRoot: "/must-not-read",
      libraryRoot: root,
      tools,
      run,
      videoOwner: vi.fn(),
    },
  );
  for (const [name, args] of [
    ["film:audio-library-list", []],
    ["film:audio-library-add", [{}]],
    ["film:audio-library-target", [{}]],
    ["film:audio-library-shot-suggest", [{}]],
    ["film:audio-library-shot-apply", [{}]],
  ] as const)
    await expect(handlers.get(name)!(false, ...args)).rejects.toThrow("not authorized");
  await expect(handlers.get("film:audio-library-list")!(true, "/forged/root")).rejects.toThrow(
    "Invalid audio library request",
  );
  await expect(handlers.get("film:audio-library-add")!(true, {}, "/forged/path")).rejects.toThrow(
    "Invalid audio library request",
  );
  await expect(
    handlers.get("film:audio-library-target")!(true, {}, "/forged/path"),
  ).rejects.toThrow("Invalid audio library request");
  expect(
    await handlers.get("film:audio-library-target")!(true, {
      projectId: "film_aaaaaaaaaaaaaaaa",
      expectedProjectHash: "a".repeat(64),
      shotId: "shot",
      takeId: "take",
      path: "/forged",
    }),
  ).toMatchObject({ kind: "FAILED", code: "INVALID_INPUT" });
  await expect(
    handlers.get("film:audio-library-shot-suggest")!(true, {}, "/forged/path"),
  ).rejects.toThrow("Invalid audio library request");
  expect(
    await handlers.get("film:audio-library-shot-suggest")!(true, {
      projectId: "film_aaaaaaaaaaaaaaaa",
      expectedProjectHash: "a".repeat(64),
      shotId: "shot",
      takeId: "take",
      path: "/forged",
    }),
  ).toMatchObject({ kind: "FAILED", code: "INVALID_INPUT" });
  await expect(handlers.get("film:audio-library-shot-apply")!(true, {}, "/forged")).rejects.toThrow(
    "Invalid audio library request",
  );
  expect(
    await handlers.get("film:audio-library-shot-apply")!(true, {
      projectId: "film_aaaaaaaaaaaaaaaa",
      path: "/forged",
    }),
  ).toMatchObject({ kind: "FAILED", code: "INVALID_INPUT" });
  expect(root).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(tools).not.toHaveBeenCalled();
});
