import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyRevisionInput,
  parseRevisionInput,
  revisionInputKey,
  useDraftReviewRevisionInput,
} from "./useDraftReviewRevisionInput";
import { sourceJob, savedNote, sourceSegment } from "./adapters/draftReviewRevision.testFixtures";
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("revision unsubmitted input cache", () => {
  it("retains original selections and human text across reopen, scoped to exact output", () => {
    const view = renderHook(() => useDraftReviewRevisionInput(sourceJob));
    act(() =>
      view.result.current.edit({
        noteIds: [savedNote.note_id],
        segmentIds: [sourceSegment.segment_id],
        instruction: "保留的原版修改指令",
      }),
    );
    view.unmount();
    const reopened = renderHook(() => useDraftReviewRevisionInput(sourceJob));
    expect(reopened.result.current.input.instruction).toBe("保留的原版修改指令");
    expect(reopened.result.current.input.noteIds).toEqual([savedNote.note_id]);
    const different = renderHook(() =>
      useDraftReviewRevisionInput({ ...sourceJob, output_bytes: 101 }),
    );
    expect(different.result.current.input).toEqual(emptyRevisionInput);
    expect(revisionInputKey(sourceJob, "plan:one")).not.toBe(
      revisionInputKey(sourceJob, "candidate:one"),
    );
  });
  it("preserves invalid data until explicit discard and doesn't silently edit it", () => {
    const key = revisionInputKey(sourceJob);
    localStorage.setItem(key, "bad-json");
    const { result } = renderHook(() => useDraftReviewRevisionInput(sourceJob));
    expect(result.current.status).toBe("INVALID");
    act(() => result.current.edit({ instruction: "replacement" }));
    expect(localStorage.getItem(key)).toBe("bad-json");
    act(() => result.current.discard());
    expect(result.current.status).toBe("READY");
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("retains visible input when persistence fails and refuses unsafe/out-of-range caches", () => {
    const { result } = renderHook(() => useDraftReviewRevisionInput(sourceJob));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    act(() => result.current.edit({ instruction: "还未安全缓存的输入" }));
    expect(result.current.input.instruction).toBe("还未安全缓存的输入");
    expect(result.current.status).toBe("UNAVAILABLE");
    for (const patch of [
      { actor_id: "renderer" },
      { noteIds: [savedNote.note_id, savedNote.note_id] },
      { segmentIds: ["not-a-segment"] },
      { candidateOperationId: "/private/path" },
      { outcome: "FIXED" },
      { reason: "\0" },
      { instruction: "\ud800" },
    ])
      expect(parseRevisionInput({ ...emptyRevisionInput, ...patch })).toBeNull();
    expect(
      parseRevisionInput({ ...emptyRevisionInput, instruction: "🙂".repeat(2000) }),
    ).not.toBeNull();
  });
});
