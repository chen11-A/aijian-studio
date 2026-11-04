import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useCoverageRepair } from "./useCoverageRepair";

it("keeps each scene repair busy until its own request settles and allows retry after failure", async () => {
  let rejectFirst!: (reason: Error) => void;
  let finishSecond!: () => void;
  const first = vi.fn(
    () =>
      new Promise<void>((_, reject) => {
        rejectFirst = reject;
      }),
  );
  const second = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSecond = resolve;
      }),
  );
  const hook = renderHook(({ scope, repair }) => useCoverageRepair(scope, repair), {
    initialProps: { scope: "project:empty-scene", repair: first },
  });
  let one!: Promise<void>;
  act(() => {
    one = hook.result.current.run();
    void hook.result.current.run();
  });
  expect(first).toHaveBeenCalledTimes(1);
  hook.rerender({ scope: "project:other-scene", repair: second });
  let two!: Promise<void>;
  act(() => {
    two = hook.result.current.run();
  });
  await act(async () => {
    rejectFirst(new Error("save failed"));
    await one;
  });
  expect(hook.result.current.fixing).toBe(true);
  expect(hook.result.current.failed).toBe(false);
  hook.rerender({ scope: "project:empty-scene", repair: first });
  expect(hook.result.current.fixing).toBe(false);
  expect(hook.result.current.failed).toBe(true);
  first.mockResolvedValueOnce(undefined);
  await act(async () => {
    await hook.result.current.run();
  });
  expect(first).toHaveBeenCalledTimes(2);
  expect(hook.result.current.failed).toBe(false);
  await act(async () => {
    finishSecond();
    await two;
  });
});
