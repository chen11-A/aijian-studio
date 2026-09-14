import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { Icon } from "./Icon";
import "./v2-viewer.css";

type Size = { width: number; height: number };
type Pan = { x: number; y: number };
export type V2ArtworkCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
};
export type V2ViewerImage = {
  src: string;
  title?: string;
  filename?: string;
  crop?: V2ArtworkCrop;
};
type Props = V2ViewerImage & {
  title: string;
  images?: readonly V2ViewerImage[];
  onClose: () => void;
};
const centered: Pan = { x: 0, y: 0 };

export function fitImageScale(source: Size, slot: Size) {
  return source.width > 0 && source.height > 0
    ? Math.min(slot.width / source.width, slot.height / source.height)
    : 1;
}
export function imageArtworkSize(source: Size, crop?: V2ArtworkCrop): Size {
  if (!crop) return source;
  const ratio = source.width / crop.sourceWidth;
  return { width: crop.width * ratio, height: crop.height * ratio };
}
export function clampViewerPan(pan: Pan, source: Size, slot: Size, scale: number): Pan {
  const x = Math.max(0, (source.width * scale - slot.width) / 2);
  const y = Math.max(0, (source.height * scale - slot.height) / 2);
  return {
    x: x ? Math.max(-x, Math.min(x, pan.x)) : 0,
    y: y ? Math.max(-y, Math.min(y, pan.y)) : 0,
  };
}

function useMediaSlot() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({
    width: window.innerWidth - 136,
    height: window.innerHeight - 226,
  });
  useEffect(() => {
    const slot = ref.current;
    const measure = () => {
      if (!slot) return;
      setSize({
        width: slot.clientWidth || Math.max(1, window.innerWidth - 136),
        height: slot.clientHeight || Math.max(1, window.innerHeight - 226),
      });
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (slot) observer?.observe(slot);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { ref, size };
}

/** Image-only modal. It owns viewing state; project selection, drafts and playback stay with the caller. */
export function V2ImageViewer({ title, src, crop, filename, images, onClose }: Props) {
  const gallery = images?.length ? images : [{ title, src, crop, filename }];
  const [index, setIndex] = useState(
    Math.max(
      0,
      gallery.findIndex((item) => item.src === src),
    ),
  );
  const item = gallery[index] ?? gallery[0]!;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const titleId = useId();
  const { ref: mediaRef, size: slot } = useMediaSlot();
  const [loaded, setLoaded] = useState<{ src: string; size: Size }>();
  const [failed, setFailed] = useState("");
  const [retry, setRetry] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [pan, setPan] = useState<Pan>(centered);
  const drag = useRef<{ id: number; start: Pan; pan: Pan } | null>(null);
  const ready = loaded?.src === item.src && failed !== item.src;
  const natural = ready ? loaded.size : { width: 0, height: 0 };
  const source = imageArtworkSize(natural, item.crop);
  const fit = fitImageScale(source, slot);
  const scale = zoom === "fit" ? fit : zoom;
  const maxScale = Math.max(4, fit);
  const position = clampViewerPan(pan, source, slot, scale);
  const canPan = source.width * scale > slot.width || source.height * scale > slot.height;
  const currentTitle = item.title ?? title;
  const currentFilename =
    item.filename ?? item.src.split("/").at(-1)?.split("?")[0] ?? "artwork.png";

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    setZoom("fit");
    setPan(centered);
    setSaveError(false);
    drag.current = null;
  }, [item.src]);

  const reset = () => {
    setZoom("fit");
    setPan(centered);
  };
  const changeZoom = (next: number) => {
    const bounded = Math.max(0.1, Math.min(maxScale, next));
    setZoom(bounded);
    setPan(clampViewerPan(position, source, slot, bounded));
  };
  const move = (x: number, y: number) => setPan(clampViewerPan({ x, y }, source, slot, scale));
  const changeImage = (direction: number) => {
    setIndex((index + direction + gallery.length) % gallery.length);
    reset();
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  const saveImage = () => {
    if (!ready || !imageRef.current) return;
    try {
      let href = item.src;
      if (item.crop) {
        // Legacy callers may still supply a crop; save only its real artwork pixels.
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(source.width);
        canvas.height = Math.round(source.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        const ratio = natural.width / item.crop.sourceWidth;
        context.drawImage(
          imageRef.current,
          item.crop.x * ratio,
          item.crop.y * ratio,
          source.width,
          source.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        href = canvas.toDataURL("image/png");
      }
      const link = document.createElement("a");
      link.href = href;
      link.download = item.crop ? `artwork-${currentFilename}` : currentFilename;
      document.body.append(link);
      link.click();
      link.remove();
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  };
  const cropRatio = item.crop ? natural.width / item.crop.sourceWidth : 1;
  const imageStyle: CSSProperties = {
    width: natural.width * scale,
    height: natural.height * scale,
    left: item.crop ? -item.crop.x * cropRatio * scale : 0,
    top: item.crop ? -item.crop.y * cropRatio * scale : 0,
  };
  return (
    <dialog
      ref={dialogRef}
      className="v2-image-viewer"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (!ready) return;
        if (
          ["+", "=", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        )
          event.preventDefault();
        if (event.key === "+" || event.key === "=") changeZoom(scale * 1.25);
        if (event.key === "-") changeZoom(scale * 0.8);
        if (event.key === "0") reset();
        if (event.key === "ArrowLeft") move(position.x + 40, position.y);
        if (event.key === "ArrowRight") move(position.x - 40, position.y);
        if (event.key === "ArrowUp") move(position.x, position.y + 40);
        if (event.key === "ArrowDown") move(position.x, position.y - 40);
      }}
    >
      <header className="v2-viewer-toolbar">
        <button
          type="button"
          ref={closeRef}
          className="v2-viewer-close"
          aria-label="关闭查看器"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
        <h2 id={titleId}>大屏预览 · {currentTitle}</h2>
        <div className="v2-viewer-tools" role="group" aria-label="图像查看工具">
          <button
            type="button"
            className="v2-viewer-fit"
            disabled={!ready}
            aria-pressed={zoom === "fit"}
            onClick={reset}
          >
            <Icon name="expand" size={18} />
            适应窗口
          </button>
          <button
            type="button"
            disabled={!ready}
            aria-pressed={zoom === 1}
            onClick={() => {
              setZoom(1);
              setPan(centered);
            }}
          >
            100%
          </button>
          <button
            type="button"
            disabled={!ready || scale <= 0.1}
            onClick={() => changeZoom(scale * 0.8)}
          >
            <span aria-hidden="true">−</span>缩小
          </button>
          <button
            type="button"
            disabled={!ready || scale >= maxScale}
            onClick={() => changeZoom(scale * 1.25)}
          >
            <Icon name="plus" size={18} />
            放大
          </button>
          <button
            type="button"
            className="v2-viewer-gallery"
            disabled={gallery.length < 2}
            aria-describedby={gallery.length < 2 ? `${titleId}-note` : undefined}
            onClick={() => changeImage(-1)}
          >
            <Icon name="back" size={18} />
            上一张
          </button>
          <button
            type="button"
            className="v2-viewer-gallery"
            disabled={gallery.length < 2}
            aria-describedby={gallery.length < 2 ? `${titleId}-note` : undefined}
            onClick={() => changeImage(1)}
          >
            <Icon name="chevron" size={18} />
            下一张
          </button>
        </div>
        <button type="button" className="v2-viewer-save" disabled={!ready} onClick={saveImage}>
          <Icon name="export" size={18} />
          保存样例
        </button>
      </header>
      <div className="v2-viewer-media-band">
        <div
          ref={mediaRef}
          className={`v2-viewer-media${canPan ? " is-pannable" : ""}`}
          aria-label="图片画布"
          tabIndex={0}
          onPointerDown={(event) => {
            if (!ready || !canPan || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            drag.current = {
              id: event.pointerId,
              start: { x: event.clientX, y: event.clientY },
              pan: position,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current?.id !== event.pointerId) return;
            move(
              drag.current.pan.x + event.clientX - drag.current.start.x,
              drag.current.pan.y + event.clientY - drag.current.start.y,
            );
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <div
            className="v2-viewer-artwork"
            data-testid="v2-viewer-artwork"
            style={{
              width: source.width * scale,
              height: source.height * scale,
              visibility: ready ? "visible" : "hidden",
              transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`,
            }}
          >
            <img
              key={`${item.src}-${retry}`}
              ref={imageRef}
              data-testid="v2-viewer-source"
              src={item.src}
              alt={currentTitle}
              draggable={false}
              style={imageStyle}
              onLoad={(event) => {
                const image = event.currentTarget;
                if (!image.naturalWidth || !image.naturalHeight) {
                  setFailed(item.src);
                  return;
                }
                setLoaded({
                  src: item.src,
                  size: { width: image.naturalWidth, height: image.naturalHeight },
                });
                setFailed("");
              }}
              onError={() => setFailed(item.src)}
            />
          </div>
          {!ready && (
            <div className="v2-viewer-load-state" role={failed === item.src ? "alert" : "status"}>
              {failed === item.src ? (
                <>
                  图片加载失败
                  <button
                    type="button"
                    onClick={() => {
                      setFailed("");
                      setRetry(retry + 1);
                    }}
                  >
                    重试加载
                  </button>
                </>
              ) : (
                "正在读取图片原始尺寸…"
              )}
            </div>
          )}
        </div>
      </div>
      <footer className="v2-viewer-info">
        <span className="v2-viewer-filename" title={currentFilename}>
          {currentFilename} · 样例插画
        </span>
        <output aria-live="polite">
          {ready
            ? `${Math.round(source.width)} × ${Math.round(source.height)} px / ${zoom === "fit" ? "适应 " : ""}${(scale * 100).toFixed(1)}%`
            : "原始尺寸待读取"}
        </output>
        <span id={`${titleId}-note`} className="v2-viewer-note">
          {saveError
            ? "保存失败，请重试"
            : !ready
              ? "读取完成后可使用缩放与保存"
              : scale <= 0.1
                ? "已达最小缩放 10%"
                : scale >= maxScale
                  ? "已达最大缩放"
                  : gallery.length < 2
                    ? "当前仅一张；工具栏不遮图"
                    : canPan
                      ? "拖动或方向键查看细节；0 恢复完整图"
                      : "默认完整适应；工具栏不遮图"}
        </span>
      </footer>
    </dialog>
  );
}
