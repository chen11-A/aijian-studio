import { useEffect, useRef, useState } from "react";

import "./timeline-clip-preview.css";

const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;

export type TimelineClipPreviewMedia = {
  bytes: ArrayBuffer;
  byteLength: number;
  mimeType: "video/webm";
  previewFrameCount: number;
  previewKind: "DEVELOPMENT_FAKE" | "PUBLISHED_MEDIA";
};

export type TimelineClipPreviewSelection = {
  timelineVersionId: string;
  clipId: string;
  sourceInFrame: number;
  durationFrames: number;
  frameRate: { num: number; den: number };
};

type PreviewSource = { token: number; url: string };
type PreviewStatus = "idle" | "ready" | "playing" | "ended" | "error";

function frameToSeconds(
  frame: number,
  frameRate: TimelineClipPreviewSelection["frameRate"],
): number {
  return (frame * frameRate.den) / frameRate.num;
}

function hasSafeFrameRange(
  selection: TimelineClipPreviewSelection,
  previewFrameCount: number,
): boolean {
  const { sourceInFrame, durationFrames, frameRate } = selection;
  if (
    !Number.isSafeInteger(sourceInFrame) ||
    sourceInFrame < 0 ||
    !Number.isSafeInteger(durationFrames) ||
    durationFrames <= 0 ||
    !Number.isSafeInteger(previewFrameCount) ||
    previewFrameCount <= 0 ||
    !Number.isSafeInteger(frameRate.num) ||
    frameRate.num <= 0 ||
    !Number.isSafeInteger(frameRate.den) ||
    frameRate.den <= 0
  ) {
    return false;
  }
  const endFrame = sourceInFrame + durationFrames;
  const endSeconds = frameToSeconds(endFrame, frameRate);
  return (
    Number.isSafeInteger(endFrame) && endFrame <= previewFrameCount && Number.isFinite(endSeconds)
  );
}

function hasSupportedMedia(
  media: TimelineClipPreviewMedia | null,
): media is TimelineClipPreviewMedia {
  return (
    media !== null &&
    media.bytes instanceof ArrayBuffer &&
    media.mimeType === "video/webm" &&
    Number.isSafeInteger(media.byteLength) &&
    media.byteLength === media.bytes.byteLength &&
    media.byteLength > 0 &&
    media.byteLength <= MAX_PREVIEW_BYTES
  );
}

export function TimelineClipPreview({
  media,
  selection,
}: {
  media: TimelineClipPreviewMedia | null;
  selection: TimelineClipPreviewSelection;
}) {
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const tokenRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const revokedUrls = useRef(new Set<string>());
  const mediaIsSupported = hasSupportedMedia(media);
  const intervalIsValid = mediaIsSupported && hasSafeFrameRange(selection, media.previewFrameCount);
  const startSeconds = intervalIsValid
    ? frameToSeconds(selection.sourceInFrame, selection.frameRate)
    : 0;
  const endSeconds = intervalIsValid
    ? frameToSeconds(selection.sourceInFrame + selection.durationFrames, selection.frameRate)
    : 0;

  const revokeUrl = (url: string) => {
    if (revokedUrls.current.has(url)) return;
    revokedUrls.current.add(url);
    URL.revokeObjectURL(url);
  };

  const stopAndUnbind = (video: HTMLVideoElement) => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  useEffect(() => {
    tokenRef.current += 1;
    const token = tokenRef.current;
    setStatus(media === null || (mediaIsSupported && intervalIsValid) ? "idle" : "error");
    if (!mediaIsSupported || !intervalIsValid) {
      setSource(null);
      return;
    }

    const url = URL.createObjectURL(new Blob([media.bytes], { type: media.mimeType }));
    setSource({ token, url });
    return () => {
      const video = videoRef.current;
      if (video?.dataset.previewToken === String(token)) stopAndUnbind(video);
      revokeUrl(url);
    };
  }, [
    intervalIsValid,
    media,
    mediaIsSupported,
    selection.clipId,
    selection.durationFrames,
    selection.frameRate.den,
    selection.frameRate.num,
    selection.sourceInFrame,
    selection.timelineVersionId,
  ]);

  const isCurrent = (token: number) => token === tokenRef.current;

  const releaseErroredSource = (video: HTMLVideoElement, current: PreviewSource) => {
    if (!isCurrent(current.token)) return;
    stopAndUnbind(video);
    revokeUrl(current.url);
    setSource(null);
    setStatus("error");
  };

  const clampToClip = (video: HTMLVideoElement) => {
    if (video.currentTime < startSeconds || video.currentTime >= endSeconds) {
      video.currentTime = startSeconds;
    }
  };

  const play = async () => {
    const video = videoRef.current;
    if (video === null || source === null || !intervalIsValid) return;
    clampToClip(video);
    try {
      await video.play();
    } catch {
      if (isCurrent(source.token)) releaseErroredSource(video, source);
    }
  };

  const pause = () => {
    const video = videoRef.current;
    if (video === null || source === null) return;
    video.pause();
    if (isCurrent(source.token)) setStatus("ready");
  };

  const unsupportedMessage = !mediaIsSupported
    ? "受控媒体必须是 16 MiB 以内的 video/webm 内存字节。"
    : "无法以当前编辑帧区间和媒体帧数建立受控预览。";

  if (media === null) {
    return (
      <section className="timeline-clip-preview" aria-labelledby="clip-preview-heading">
        <p className="clip-preview-kicker">CLIP PREVIEW</p>
        <h3 id="clip-preview-heading">{selection.clipId}</h3>
        <p className="clip-preview-status" role="status">
          已选择镜头，尚未接入受控媒体。
        </p>
      </section>
    );
  }

  if (!mediaIsSupported || !intervalIsValid) {
    return (
      <section className="timeline-clip-preview" aria-labelledby="clip-preview-heading">
        <p className="clip-preview-kicker">CLIP PREVIEW</p>
        <h3 id="clip-preview-heading">受控预览不可用</h3>
        <p className="clip-preview-status" role="alert">
          {unsupportedMessage}
        </p>
      </section>
    );
  }

  return (
    <section className="timeline-clip-preview" aria-labelledby="clip-preview-heading">
      <header className="clip-preview-header">
        <div>
          <p className="clip-preview-kicker">CLIP PREVIEW</p>
          <h3 id="clip-preview-heading">{selection.clipId}</h3>
        </div>
        {media.previewKind === "DEVELOPMENT_FAKE" && (
          <span className="clip-preview-kind">开发工程媒体</span>
        )}
      </header>

      {source === null ? (
        <p className="clip-preview-status" role={status === "error" ? "alert" : "status"}>
          {status === "error"
            ? "浏览器无法解码已提供的受控媒体。"
            : "已选择镜头，尚未接入受控媒体。"}
        </p>
      ) : (
        <>
          <video
            key={source.token}
            ref={videoRef}
            className="clip-preview-video"
            data-preview-token={source.token}
            src={source.url}
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => {
              if (!isCurrent(source.token)) return;
              const video = event.currentTarget;
              if (!Number.isFinite(video.duration) || video.duration + 0.001 < endSeconds) {
                releaseErroredSource(video, source);
                return;
              }
              video.currentTime = startSeconds;
              setStatus("ready");
            }}
            onTimeUpdate={(event) => {
              if (!isCurrent(source.token)) return;
              const video = event.currentTarget;
              if (video.currentTime >= endSeconds) {
                video.currentTime = endSeconds;
                video.pause();
                setStatus("ended");
              }
            }}
            onPlay={() => {
              if (isCurrent(source.token)) setStatus("playing");
            }}
            onPause={() => {
              if (isCurrent(source.token) && status !== "ended") setStatus("ready");
            }}
            onEnded={() => {
              if (isCurrent(source.token)) setStatus("ended");
            }}
            onError={(event) => releaseErroredSource(event.currentTarget, source)}
          >
            此浏览器无法播放受控镜头预览。
          </video>
          <div className="clip-preview-controls">
            <button type="button" onClick={() => void play()} disabled={status === "error"}>
              播放区间
            </button>
            <button type="button" onClick={pause} disabled={status !== "playing"}>
              暂停
            </button>
          </div>
          <p className="clip-preview-status" aria-live="polite">
            仅播放当前镜头的编辑帧区间。
          </p>
        </>
      )}
      <dl className="clip-preview-meta">
        <div>
          <dt>版本</dt>
          <dd>{selection.timelineVersionId}</dd>
        </div>
        <div>
          <dt>编辑入点</dt>
          <dd>{selection.sourceInFrame} 帧</dd>
        </div>
        <div>
          <dt>持续</dt>
          <dd>{selection.durationFrames} 帧</dd>
        </div>
      </dl>
    </section>
  );
}
