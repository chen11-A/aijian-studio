import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createAgentLog } from "./agent-log";
import { registerFilmLibraryHandlers, type FilmLibraryHost } from "./film-library-ipc";

it.each([
  { name: "signed out", token: null, selected: 1, dispatched: false },
  { name: "too many references", token: "fake-token", selected: 6, dispatched: false },
  { name: "provider rejection", token: "fake-token", selected: 1, dispatched: true },
  { name: "transport failure", token: "fake-token", selected: 1, dispatched: true },
])("persists safe still diagnostics for $name without claiming delivery", async (scenario) => {
  const root = await mkdtemp(join(tmpdir(), "still-diagnostics-"));
  const path = join(root, "agents.log");
  const log = createAgentLog(path);
  const references = Array.from(
    { length: scenario.selected },
    (_, i) => `https://example.invalid/private-portrait-${i}.png`,
  );
  const fetcher = vi.fn(async () => {
    if (scenario.name === "transport failure") throw new Error("private provider body");
    return Response.json({ error: "private provider body" }, { status: 400 });
  });
  const host: FilmLibraryHost = {
    filmsRoot: () => root,
    storyFilmsRoot: () => root,
    runFfmpeg: async () => undefined,
    mediaToken: async () => scenario.token,
    fetcher,
    pickDirectory: async () => null,
    copyFile: async () => undefined,
    reveal: () => undefined,
    open: async () => "",
    logStill: (detail) =>
      log.write({
        ...detail,
        agent: "image",
        model: "grok-imagine-image-2.0",
        endpoint: "image-edit",
        httpStatus: 0,
      }),
  };
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  registerFilmLibraryHandlers(
    (channel, handler) => handlers.set(channel, handler),
    (event: boolean) => event,
    host,
  );
  const result = await handlers.get("film:still")?.(
    true,
    "film_series0000000001",
    "私密小说原文",
    "16:9",
    [...references, references[0]],
  );
  expect(result).toMatchObject({ path: "" });
  expect(fetcher).toHaveBeenCalledTimes(scenario.dispatched ? 1 : 0);
  await vi.waitFor(async () => {
    const text = await readFile(path, "utf8");
    expect(JSON.parse(text)).toMatchObject({
      selectedReferenceImageCount: scenario.selected,
      referenceImageCount: scenario.dispatched ? scenario.selected : 0,
      requestDispatched: scenario.dispatched,
      imageLimit: 5,
      videoReferenceLimit: 13,
    });
    expect(text).not.toMatch(/私密|小说|private|example\.invalid|fake-token|detail|body/);
  });
});
