export const MAX_BOUNDED_CLIP_PREVIEW_BYTES = 16 * 1024 * 1024;

export type BoundedClipPreviewMedia = {
  bytes: ArrayBuffer;
  byteLength: number;
  mimeType: "video/webm";
  previewFrameCount: number;
  previewKind: "DEVELOPMENT_FAKE" | "PUBLISHED_MEDIA";
};

export type BoundedClipPreviewSelection = {
  timelineVersionId: string;
  clipId: string;
  sourceInFrame: number;
  durationFrames: number;
  frameRate: { num: number; den: number };
};

type ObjectUrls = Readonly<{
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}>;

export type BoundedClipPreviewSource =
  | { kind: "absent" }
  | { kind: "unsupported-media" }
  | { kind: "invalid-frame-range" }
  | { kind: "ready"; url: string; startSeconds: number; endSeconds: number; release(): void };

type ReadySource = Extract<BoundedClipPreviewSource, { kind: "ready" }>;
export type PreparedBoundedClipPreview =
  Exclude<BoundedClipPreviewSource, ReadySource> | (ReadySource & { token: number });

function frameToSeconds(frame: number, rate: BoundedClipPreviewSelection["frameRate"]): number {
  return (frame * rate.den) / rate.num;
}

function supported(media: BoundedClipPreviewMedia | null): media is BoundedClipPreviewMedia {
  return (
    media !== null &&
    media.bytes instanceof ArrayBuffer &&
    media.mimeType === "video/webm" &&
    Number.isSafeInteger(media.byteLength) &&
    media.byteLength === media.bytes.byteLength &&
    media.byteLength > 0 &&
    media.byteLength <= MAX_BOUNDED_CLIP_PREVIEW_BYTES
  );
}

function validRange(selection: BoundedClipPreviewSelection, frameCount: number): boolean {
  const { sourceInFrame, durationFrames, frameRate } = selection;
  if (
    !Number.isSafeInteger(sourceInFrame) ||
    sourceInFrame < 0 ||
    !Number.isSafeInteger(durationFrames) ||
    durationFrames <= 0 ||
    !Number.isSafeInteger(frameCount) ||
    frameCount <= 0 ||
    !Number.isSafeInteger(frameRate.num) ||
    frameRate.num <= 0 ||
    !Number.isSafeInteger(frameRate.den) ||
    frameRate.den <= 0
  )
    return false;
  const endFrame = sourceInFrame + durationFrames;
  return (
    Number.isSafeInteger(endFrame) &&
    endFrame <= frameCount &&
    Number.isFinite(frameToSeconds(endFrame, frameRate))
  );
}

export function createBoundedClipPreviewSource(
  media: BoundedClipPreviewMedia | null,
  selection: BoundedClipPreviewSelection,
  objectUrls: ObjectUrls = URL,
): BoundedClipPreviewSource {
  if (media === null) return { kind: "absent" };
  if (!supported(media)) return { kind: "unsupported-media" };
  if (!validRange(selection, media.previewFrameCount)) return { kind: "invalid-frame-range" };
  const url = objectUrls.createObjectURL(new Blob([media.bytes], { type: media.mimeType }));
  let released = false;
  return {
    kind: "ready",
    url,
    startSeconds: frameToSeconds(selection.sourceInFrame, selection.frameRate),
    endSeconds: frameToSeconds(
      selection.sourceInFrame + selection.durationFrames,
      selection.frameRate,
    ),
    release() {
      if (!released) {
        released = true;
        objectUrls.revokeObjectURL(url);
      }
    },
  };
}

/** Owns one bounded in-memory URL; UI media callbacks must use its token guard. */
export class BoundedClipPreviewLifecycle {
  private current: (ReadySource & { token: number }) | null = null;
  private nextToken = 0;

  public constructor(private readonly objectUrls: ObjectUrls = URL) {}

  public prepare(
    media: BoundedClipPreviewMedia | null,
    selection: BoundedClipPreviewSelection,
  ): PreparedBoundedClipPreview {
    this.dispose();
    const source = createBoundedClipPreviewSource(media, selection, this.objectUrls);
    if (source.kind !== "ready") return source;
    const token = ++this.nextToken;
    const ready = {
      ...source,
      token,
      release: () => {
        if (this.current?.token !== token) return;
        source.release();
        this.current = null;
      },
    };
    this.current = ready;
    return ready;
  }

  public runIfCurrent(token: number, action: () => void): boolean {
    if (this.current?.token !== token) return false;
    action();
    return true;
  }

  public dispose(): void {
    if (this.current === null) return;
    this.current.release();
    this.current = null;
  }
}
