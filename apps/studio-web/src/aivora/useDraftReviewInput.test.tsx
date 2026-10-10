import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceJob } from "./adapters/draftReviewRevision.testFixtures";
import { useDraftReviewInput } from "./useDraftReviewInput";

const key = `aivora:draft-review:input:${sourceJob.project_id}:${sourceJob.episode_id}:${sourceJob.operation_id}:${sourceJob.assembly_version_id}:${sourceJob.assembly_content_hash}`;
const empty = { frame: "0", text: "", noteId: null, reason: "" };
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("draft review input persistence boundaries", () => {
  it.each([
    "bad-json",
    "x".repeat(10001),
    "null",
    "[]",
    JSON.stringify({ ...empty, extra: true }),
    JSON.stringify({ ...empty, frame: "1".repeat(33) }),
    JSON.stringify({ ...empty, text: "x".repeat(2001) }),
    JSON.stringify({ ...empty, reason: "x".repeat(2001) }),
    JSON.stringify({ ...empty, noteId: "drn_invalid" }),
  ])("preserves invalid cached bytes until explicit discard: %#", (stored) => {
    localStorage.setItem(key, stored);
    const { result } = renderHook(() => useDraftReviewInput(sourceJob));
    expect(result.current.status).toBe("INVALID");
    expect(result.current.input).toEqual(empty);
    act(() => result.current.edit({ text: "must not overwrite" }));
    expect(localStorage.getItem(key)).toBe(stored);
    act(() => result.current.discard());
    expect(localStorage.getItem(key)).toBeNull();
    expect(result.current.status).toBe("READY");
  });

  it("merges same-tick edits and restores only the exact assembly identity", () => {
    const view = renderHook(() => useDraftReviewInput(sourceJob));
    act(() => {
      view.result.current.edit({ text: "human note" });
      view.result.current.edit({ frame: "12", noteId: `drn_${"1".repeat(32)}` });
      view.result.current.edit({ reason: "human reason" });
    });
    const saved = view.result.current.input;
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(saved);
    expect(saved.text).toBe("human note");
    view.unmount();
    const restored = renderHook(() => useDraftReviewInput(sourceJob));
    expect(restored.result.current.input).toEqual(saved);
    const other = renderHook(() =>
      useDraftReviewInput({ ...sourceJob, assembly_content_hash: `sha256:${"e".repeat(64)}` }),
    );
    expect(other.result.current.input).toEqual(empty);
    act(() => restored.result.current.edit(empty));
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("recovers an unavailable read through an explicit edit", () => {
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    const { result } = renderHook(() => useDraftReviewInput(sourceJob));
    expect(result.current.status).toBe("UNAVAILABLE");
    read.mockRestore();
    act(() => result.current.edit({ text: "recovered" }));
    expect(result.current.status).toBe("READY");
    expect(JSON.parse(localStorage.getItem(key)!).text).toBe("recovered");
  });

  it.each(["text", "reason"] as const)(
    "warns before unloading unsaved %s and removes the listener on unmount",
    (field) => {
      const view = renderHook(() => useDraftReviewInput(sourceJob));
      const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("full");
      });
      act(() => view.result.current.edit({ [field]: "still visible" }));
      expect(view.result.current.input[field]).toBe("still visible");
      expect(view.result.current.status).toBe("UNAVAILABLE");
      const warn = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(warn);
      expect(warn.defaultPrevented).toBe(true);
      write.mockRestore();
      act(() => view.result.current.edit({ frame: "1" }));
      const safe = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(safe);
      expect(safe.defaultPrevented).toBe(false);
      view.unmount();
      const closed = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(closed);
      expect(closed.defaultPrevented).toBe(false);
    },
  );

  it("does not clear visible text when explicit discard fails", () => {
    const { result } = renderHook(() => useDraftReviewInput(sourceJob));
    act(() => result.current.edit({ text: "keep me" }));
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    act(() => result.current.discard());
    expect(result.current.status).toBe("UNAVAILABLE");
    expect(result.current.input.text).toBe("keep me");
    expect(JSON.parse(localStorage.getItem(key)!).text).toBe("keep me");
    remove.mockRestore();
    act(() => result.current.discard());
    expect(result.current.input).toEqual(empty);
    expect(result.current.status).toBe("READY");
  });
});
