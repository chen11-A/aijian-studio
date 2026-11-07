import { expect, it, vi } from "vitest";
import { registerStoryFilmHandlers } from "./story-film-ipc";
const projectId = `prj_${"a".repeat(32)}`;
const input = {
  scene_label: "雨夜",
  narration: "雨停了。",
  provider: "grok_subscription",
  confirmed: true,
};
const execution = {
  executionId: "native-execution",
  videoSlotId: "slot",
  shotId: "shot",
  takeId: "take",
};
function fixture(installed: boolean) {
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  const fetcher = vi.fn<typeof fetch>(),
    bearer = vi.fn(async () => "PRIVATE");
  const protectedCreate = vi.fn<
    NonNullable<Parameters<typeof registerStoryFilmHandlers<boolean>>[9]>
  >(async () => ({
    request_id: "controlled",
    data: { status: "BLOCKED" },
  }));
  registerStoryFilmHandlers(
    (name, run) => handlers.set(name, run),
    (event) => event,
    () => ({ origin: "http://127.0.0.1:51234", token: "s".repeat(43) }),
    bearer,
    fetcher,
    undefined,
    undefined,
    undefined,
    undefined,
    installed ? protectedCreate : undefined,
  );
  return { run: handlers.get("story-film:create")!, fetcher, bearer, protectedCreate };
}
it("routes the exact protected context without legacy transport/bearer or changed request fields", async () => {
  const f = fixture(true);
  expect(await f.run(true, projectId, input, undefined, execution)).toMatchObject({
    data: { status: "BLOCKED" },
  });
  expect(f.protectedCreate).toHaveBeenCalledExactlyOnceWith(
    true,
    projectId,
    input,
    undefined,
    execution,
  );
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(f.bearer).not.toHaveBeenCalled();
});
it("fails closed when the native protected handler is unavailable", async () => {
  const f = fixture(false);
  await expect(f.run(true, projectId, input, undefined, execution)).rejects.toThrow(
    "EXECUTION_UNAVAILABLE",
  );
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(f.bearer).not.toHaveBeenCalled();
});
it("rejects unauthorized, malformed, explicit-null and extra protected fields without fallback", async () => {
  const f = fixture(true);
  await expect(f.run(false, projectId, input, undefined, execution)).rejects.toThrow(
    "not authorized",
  );
  for (const context of [
    undefined,
    null,
    {},
    { ...execution, account: "PRIVATE" },
    { ...execution, takeId: " " },
  ])
    await expect(f.run(true, projectId, input, undefined, context)).rejects.toThrow(
      "INVALID_INPUT",
    );
  expect(f.protectedCreate).not.toHaveBeenCalled();
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(f.bearer).not.toHaveBeenCalled();
});
