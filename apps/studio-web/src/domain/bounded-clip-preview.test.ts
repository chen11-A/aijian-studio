import { describe, expect, test, vi } from "vitest";

import {
  BoundedClipPreviewLifecycle,
  MAX_BOUNDED_CLIP_PREVIEW_BYTES,
  createBoundedClipPreviewSource,
  type BoundedClipPreviewMedia,
  type BoundedClipPreviewSelection,
} from "./bounded-clip-preview";

const selection = (
  overrides: Partial<BoundedClipPreviewSelection> = {},
): BoundedClipPreviewSelection => ({
  timelineVersionId: "ver_A",
  clipId: "clip-A",
  sourceInFrame: 25,
  durationFrames: 50,
  frameRate: { num: 25, den: 1 },
  ...overrides,
});
const media = (overrides: Partial<BoundedClipPreviewMedia> = {}): BoundedClipPreviewMedia => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  return {
    bytes,
    byteLength: bytes.byteLength,
    mimeType: "video/webm",
    previewFrameCount: 125,
    previewKind: "DEVELOPMENT_FAKE",
    ...overrides,
  };
};

describe("bounded clip preview lifecycle", () => {
  test("rejects absent, non-webm, zero or oversized, declared-mismatch media before URL allocation", () => {
    const urls = { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() };
    expect(createBoundedClipPreviewSource(null, selection(), urls)).toMatchObject({
      kind: "absent",
    });
    expect(
      createBoundedClipPreviewSource(media({ mimeType: "video/mp4" as never }), selection(), urls),
    ).toMatchObject({ kind: "unsupported-media" });
    expect(
      createBoundedClipPreviewSource(
        media({ bytes: new ArrayBuffer(0), byteLength: 0 }),
        selection(),
        urls,
      ),
    ).toMatchObject({ kind: "unsupported-media" });
    expect(
      createBoundedClipPreviewSource(
        media({
          bytes: new ArrayBuffer(MAX_BOUNDED_CLIP_PREVIEW_BYTES + 1),
          byteLength: MAX_BOUNDED_CLIP_PREVIEW_BYTES + 1,
        }),
        selection(),
        urls,
      ),
    ).toMatchObject({ kind: "unsupported-media" });
    expect(
      createBoundedClipPreviewSource(media({ byteLength: 2 }), selection(), urls),
    ).toMatchObject({ kind: "unsupported-media" });
    expect(urls.createObjectURL).not.toHaveBeenCalled();
  });

  test("rejects noninteger or out-of-bounds frames and invalid FPS before URL allocation", () => {
    const urls = { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() };
    for (const invalid of [
      selection({ sourceInFrame: 1.5 }),
      selection({ durationFrames: 0 }),
      selection({ sourceInFrame: 100, durationFrames: 26 }),
      selection({ frameRate: { num: 0, den: 1 } }),
      selection({ frameRate: { num: 25, den: 0 } }),
      selection({ frameRate: { num: 25.5, den: 1 } }),
    ])
      expect(createBoundedClipPreviewSource(media(), invalid, urls)).toMatchObject({
        kind: "invalid-frame-range",
      });
    expect(urls.createObjectURL).not.toHaveBeenCalled();
  });

  test("releases a ready URL once", () => {
    const urls = { createObjectURL: vi.fn().mockReturnValue("blob:A"), revokeObjectURL: vi.fn() };
    const source = createBoundedClipPreviewSource(media(), selection(), urls);
    if (source.kind !== "ready") throw new Error("expected ready source");
    expect(source).toMatchObject({ url: "blob:A", startSeconds: 1, endSeconds: 3 });
    source.release();
    source.release();
    expect(urls.revokeObjectURL).toHaveBeenCalledOnce();
    expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:A");
  });

  test("direct release invalidates its token and releases only once", () => {
    const urls = { createObjectURL: vi.fn().mockReturnValue("blob:A"), revokeObjectURL: vi.fn() };
    const lifecycle = new BoundedClipPreviewLifecycle(urls);
    const source = lifecycle.prepare(media(), selection());
    if (source.kind !== "ready") throw new Error("expected source");
    source.release();
    source.release();
    expect(urls.revokeObjectURL).toHaveBeenCalledOnce();
    expect(
      lifecycle.runIfCurrent(source.token, () => {
        throw new Error("released token must not run");
      }),
    ).toBe(false);
  });

  test("switching selection recovers the old URL, rejects old events, and old release cannot clear B", () => {
    const urls = {
      createObjectURL: vi.fn().mockReturnValueOnce("blob:A").mockReturnValueOnce("blob:B"),
      revokeObjectURL: vi.fn(),
    };
    const lifecycle = new BoundedClipPreviewLifecycle(urls);
    const first = lifecycle.prepare(media(), selection());
    if (first.kind !== "ready") throw new Error("expected first source");
    let applied = 0;
    const second = lifecycle.prepare(
      media(),
      selection({ timelineVersionId: "ver_B", clipId: "clip-B" }),
    );
    if (second.kind !== "ready") throw new Error("expected second source");
    expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:A");
    first.release();
    expect(
      lifecycle.runIfCurrent(first.token, () => {
        applied += 1;
      }),
    ).toBe(false);
    expect(
      lifecycle.runIfCurrent(second.token, () => {
        applied += 1;
      }),
    ).toBe(true);
    expect(applied).toBe(1);
    lifecycle.dispose();
    lifecycle.dispose();
    expect(urls.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(urls.revokeObjectURL).toHaveBeenLastCalledWith("blob:B");
  });
});
