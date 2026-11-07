import { expect, it, vi } from "vitest";
import {
  registerFilmGenerationExecutions,
  FILM_GENERATION_EXECUTION_CHANNELS,
  type FilmGenerationExecutionService,
} from "./film-generation-execution-ipc";
function setup() {
  const handlers = new Map<
    string,
    (event: { authorized: boolean; id: number }, ...args: unknown[]) => Promise<unknown>
  >();
  let documentCurrent = true;
  const owner = vi.fn((event: { id: number }) => ({
    id: event.id,
    current: () => documentCurrent,
  }));
  const service: FilmGenerationExecutionService = {
    prepare: vi.fn<FilmGenerationExecutionService["prepare"]>(async () => ({
      kind: "FAILED",
      code: "EXECUTION_UNAVAILABLE",
    })),
    retire: vi.fn<FilmGenerationExecutionService["retire"]>(async () => ({ kind: "RETIRED" })),
  };
  registerFilmGenerationExecutions<{ authorized: boolean; id: number }>(
    (channel, run) => {
      handlers.set(channel, run);
    },
    (event) => event.authorized,
    owner,
    service,
  );
  return {
    handlers,
    service,
    owner,
    changeDocument: () => {
      documentCurrent = false;
    },
  };
}
it("registers only the two exact opaque execution channels and does no work by default", () => {
  const f = setup();
  expect([...f.handlers.keys()]).toEqual(Object.values(FILM_GENERATION_EXECUTION_CHANNELS));
  expect(f.service.prepare).not.toHaveBeenCalled();
  expect(f.service.retire).not.toHaveBeenCalled();
  expect(f.owner).not.toHaveBeenCalled();
});
it("rejects foreign senders before owner capture or any service call", async () => {
  const f = setup();
  for (const handler of f.handlers.values())
    await expect(handler({ authorized: false, id: 99 }, {})).rejects.toThrow(
      "Unauthorized generation execution sender",
    );
  expect(f.owner).not.toHaveBeenCalled();
  expect(f.service.prepare).not.toHaveBeenCalled();
  expect(f.service.retire).not.toHaveBeenCalled();
});
it("does not silently drop extra arguments or accept a renderer owner argument", async () => {
  const f = setup(),
    event = { authorized: true, id: 5 };
  for (const handler of f.handlers.values()) {
    await expect(handler(event)).resolves.toEqual({ kind: "FAILED", code: "INVALID_INPUT" });
    await expect(handler(event, {}, { owner: 99 })).resolves.toEqual({
      kind: "FAILED",
      code: "INVALID_INPUT",
    });
  }
  expect(f.owner).not.toHaveBeenCalled();
  expect(f.service.prepare).not.toHaveBeenCalled();
  expect(f.service.retire).not.toHaveBeenCalled();
});
it("uses the actual sender's captured document predicate and forwards only the declared input", async () => {
  const f = setup(),
    event = { authorized: true, id: 7 },
    input = { executionId: "opaque", videoSlotId: "one-slot" };
  await expect(
    f.handlers.get(FILM_GENERATION_EXECUTION_CHANNELS.retire)!(event, input),
  ).resolves.toEqual({ kind: "RETIRED" });
  const [captured, forwarded] = vi.mocked(f.service.retire).mock.calls[0]!;
  expect(captured.id).toBe(event.id);
  expect(forwarded).toBe(input);
  expect(captured.current()).toBe(true);
  f.changeDocument();
  expect(captured.current()).toBe(false);
});
