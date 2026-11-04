import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useScopedSuggestions } from "./use-scoped-suggestions";

it("restores a draft only for the same work, page, scene and input version", () => {
  const restore = vi.fn();
  const { rerender } = renderHook(
    ({ scope, value }) => useScopedSuggestions(scope, value, restore),
    {
      initialProps: { scope: "work:board:scene:v1", value: "director draft" },
    },
  );
  rerender({ scope: "work:board:scene:v1", value: "director draft" });
  rerender({ scope: "work:cast:scene:v1", value: "" });
  expect(restore).toHaveBeenLastCalledWith(null);
  rerender({ scope: "work:board:scene:v1", value: "" });
  expect(restore).toHaveBeenLastCalledWith("director draft");
  rerender({ scope: "work:board:scene:v2", value: "" });
  expect(restore).toHaveBeenLastCalledWith(null);
});

it("does not restore an applied draft after a simultaneous page change", () => {
  const restore = vi.fn();
  const { result, rerender } = renderHook(
    ({ scope }) => useScopedSuggestions(scope, "draft", restore),
    {
      initialProps: { scope: "board" },
    },
  );
  rerender({ scope: "board" });
  act(() => result.current.clear());
  rerender({ scope: "script" });
  rerender({ scope: "board" });
  expect(restore).toHaveBeenLastCalledWith(null);
});
