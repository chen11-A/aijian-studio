import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useWorkOwners } from "./use-work-owners";

it.each(["still:shot-1", "export", "portraits"])(
  "isolates pending %s ownership across projects and clears only its request",
  async (key) => {
    const { result, rerender } = renderHook(({ projectId }) => useWorkOwners(projectId), {
      initialProps: { projectId: "A" },
    });
    let finishA!: () => void, finishB!: () => void;
    let pendingA!: Promise<void>, pendingB!: Promise<void>;
    act(() => {
      const release = result.current.begin("A", key, "A progress");
      pendingA = new Promise<void>((resolve) => {
        finishA = resolve;
      }).finally(release);
    });
    expect(result.current.busy(key)).toBe(true);
    rerender({ projectId: "B" });
    expect(result.current.busy(key)).toBe(false);
    expect(result.current.progress("still:")).toEqual({});
    act(() => {
      const release = result.current.begin("B", key, "B progress");
      pendingB = new Promise<void>((resolve) => {
        finishB = resolve;
      }).finally(release);
    });
    expect(result.current.busy(key)).toBe(true);
    await act(async () => {
      finishA();
      await pendingA;
    });
    expect(result.current.busy(key)).toBe(true);
    if (key.startsWith("still:"))
      expect(result.current.progress("still:")).toEqual({ "shot-1": "B progress" });
    await act(async () => {
      finishB();
      await pendingB;
    });
    expect(result.current.busy(key)).toBe(false);
    rerender({ projectId: "A" });
    expect(result.current.busy(key)).toBe(false);
  },
);

it("a superseded request cannot clear its newer owner's progress", () => {
  const { result } = renderHook(() => useWorkOwners("A"));
  let old!: () => void, latest!: () => void;
  act(() => {
    old = result.current.begin("A", "still:shot", "first");
  });
  act(() => {
    latest = result.current.begin("A", "still:shot", "second");
  });
  act(() => old());
  expect(result.current.progress("still:")).toEqual({ shot: "second" });
  act(() => latest());
  expect(result.current.progress("still:")).toEqual({});
});
