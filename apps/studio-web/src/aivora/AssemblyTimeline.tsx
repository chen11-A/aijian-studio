import { useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { AssemblyContent } from "./adapters/episodeMediaAssembly";
import type { AssemblySegment } from "./adapters/assemblyEditing";
import { assemblySeconds, findAssemblyAsset } from "./adapters/assemblyEditing";
import type { MediaAsset } from "./adapters/assetLibrary";
import { anchoredScroll, frameTimecode, rulerStep } from "./timeline-model";
import {
  assemblyTimecodeFrame,
  timelinePointerFrame,
  timelineLanes,
} from "./assembly-timeline-model";

type Props = {
  compact?: boolean;
  content: AssemblyContent;
  library: MediaAsset[] | null;
  frame: number;
  selected: string;
  selectionLocked: boolean;
  audioOnly: boolean;
  canSplit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onFrame(frame: number): void;
  onSelect(id: string, frame: number): void;
  onSplit(): void;
  onRemove(): void;
  onUndo(redo: boolean): void;
  onNotice(message: string): void;
};

/** View controls for the real assembly. Editing stays in the existing guarded callbacks. */
export function AssemblyTimeline(props: Props) {
  const { content, frame, selected, selectionLocked, audioOnly, library } = props;
  const total = content.total_frames;
  const rate = content.sequence_timebase.frame_rate;
  const timecode = (at: number) =>
    frameTimecode(at, rate.num / rate.den, content.sequence_timebase.timecode_mode);
  const displayed = timecode(frame);
  const [code, setCode] = useState({ at: displayed, value: displayed });
  const [invalidCode, setInvalidCode] = useState(false);
  const codeHelpId = useId();
  const nominalFps = Math.round(rate.num / rate.den);
  const codeError = `请输入序列范围内的 HH:MM:SS:FF，帧号为 00–${String(nominalFps - 1).padStart(2, "0")}；跳帧序列不能使用被跳过的帧号。`;
  const value = code.at === displayed ? code.value : displayed;
  useLayoutEffect(() => {
    setCode((previous) =>
      previous.at === displayed ? previous : { at: displayed, value: displayed },
    );
    setInvalidCode(false);
  }, [displayed]);
  const region = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [scroll, setScroll] = useState(0);
  const scale = (width / Math.max(1, total)) * zoom;
  const latest = useRef({ frame, scale, width, zoom });
  latest.current = { frame, scale, width, zoom };
  const anchor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => {
      const next = Math.max(1, node.clientWidth);
      if (next === latest.current.width) return;
      anchor.current = latest.current.frame * latest.current.scale - node.scrollLeft;
      setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    let next = node.scrollLeft;
    if (anchor.current !== null) {
      next = anchoredScroll(frame, scale, anchor.current, width, total);
      anchor.current = null;
    } else if (frame * scale < next || frame * scale > next + width - 1) {
      next = anchoredScroll(frame, scale, width / 2, width, total);
    }
    node.scrollLeft = next;
    setScroll(node.scrollLeft);
  }, [frame, scale, width, total]);
  function changeZoom(next: number) {
    const bounded = Math.max(1, Math.min(64, next));
    if (bounded === zoom) return;
    anchor.current = frame * scale - (viewport.current?.scrollLeft ?? 0);
    setZoom(bounded);
  }
  function jump() {
    const next = assemblyTimecodeFrame(value, content);
    if (next === null) {
      setInvalidCode(true);
      props.onNotice(codeError);
      return;
    }
    setInvalidCode(false);
    props.onFrame(next);
    setCode({ at: timecode(next), value: timecode(next) });
  }
  function locate(direction: number) {
    if (selectionLocked) return;
    const segments = [...(audioOnly ? content.audio_segments : content.visual_segments)].sort(
      (a, b) => a.start_frame - b.start_frame || a.segment_id.localeCompare(b.segment_id),
    );
    const index = segments.findIndex((item) => item.segment_id === selected);
    const next =
      index >= 0
        ? segments[index + direction]
        : direction > 0
          ? segments.find((item) => item.start_frame > frame)
          : segments.filter((item) => item.start_frame < frame).at(-1);
    if (next) props.onSelect(next.segment_id, next.start_frame);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.target !== event.currentTarget ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.metaKey
    )
      return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey) {
      if (event.repeat || selectionLocked) return;
      if (key === "b" && !event.shiftKey && props.canSplit) props.onSplit();
      else if (key === "z" && (event.shiftKey ? props.canRedo : props.canUndo))
        props.onUndo(event.shiftKey);
      else return;
    } else if (key === "arrowleft" || key === "arrowright") {
      props.onFrame(
        Math.max(
          0,
          Math.min(
            Math.max(0, total - 1),
            frame + (key === "arrowleft" ? -1 : 1) * (event.shiftKey ? 10 : 1),
          ),
        ),
      );
    } else if (event.shiftKey && key !== "+") return;
    else if (key === "home" || key === "end")
      props.onFrame(key === "home" ? 0 : Math.max(0, total - 1));
    else if (key === "arrowup" || key === "arrowdown") locate(key === "arrowup" ? -1 : 1);
    else if (key === "+" || key === "=") changeZoom(zoom * 2);
    else if (key === "-") changeZoom(zoom / 2);
    else if (key === "f") changeZoom(1);
    else if (key === "delete" && !event.repeat && !selectionLocked && selected) props.onRemove();
    else return;
    event.preventDefault();
  }
  function pointer(event: MouseEvent, segment?: AssemblySegment) {
    const node = viewport.current;
    if (!node || (segment && selectionLocked)) return;
    const at = timelinePointerFrame(
      event.clientX - node.getBoundingClientRect().left - node.clientLeft + node.scrollLeft,
      scale,
      total,
    );
    if (segment)
      props.onSelect(
        segment.segment_id,
        event.detail === 0
          ? segment.start_frame
          : Math.max(segment.start_frame, Math.min(segment.end_frame - 1, at)),
      );
    else props.onFrame(at);
    region.current?.focus({ preventScroll: true });
  }
  const step = rulerStep(scale);
  const first = Math.floor(scroll / scale / step) * step;
  const ticks: number[] = [];
  for (let at = first; at <= Math.min(total, (scroll + width) / scale + step); at += step)
    ticks.push(at);
  const tracks = [
    ...(audioOnly ? [] : [{ label: "画面定位轨", segments: content.visual_segments }]),
    ...timelineLanes(content.audio_segments).map((segments, index) => ({
      label: `音频定位轨 ${index + 1}`,
      segments,
    })),
    ...(audioOnly
      ? []
      : timelineLanes(content.subtitle_segments).map((segments, index) => ({
          label: `字幕定位轨 ${index + 1}`,
          segments,
        }))),
  ];
  return (
    <div
      className="assembly-timeline"
      ref={region}
      tabIndex={0}
      role="region"
      aria-label="生产时间轴快捷键区域"
      onKeyDown={keyboard}
    >
      <div className="assembly-position">
        <label>
          剪切位置（序列帧）
          <input
            type="number"
            min={0}
            max={Math.max(0, total - 1)}
            step={1}
            value={frame}
            disabled={!total}
            onChange={(event) => {
              if (!event.target.value.trim()) return;
              const at = Number(event.target.value);
              if (Number.isSafeInteger(at)) props.onFrame(Math.max(0, Math.min(total - 1, at)));
            }}
          />
        </label>
        <label>
          定位时间码
          <input
            aria-label="定位时间码"
            aria-invalid={invalidCode}
            aria-describedby={codeHelpId}
            value={value}
            spellCheck={false}
            disabled={!total}
            onChange={(event) => {
              setInvalidCode(false);
              setCode({ at: displayed, value: event.target.value });
            }}
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              if (event.key === "Enter") {
                event.preventDefault();
                jump();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setInvalidCode(false);
                setCode({ at: displayed, value: displayed });
              }
            }}
          />
        </label>
        <button type="button" className="button" disabled={!total} onClick={jump}>
          定位
        </button>
        {!props.compact && (
          <span>
            {displayed} · {assemblySeconds(frame, content).toFixed(3)} 秒
          </span>
        )}
      </div>
      {(!props.compact || invalidCode) && (
        <p
          id={codeHelpId}
          role={invalidCode ? "alert" : undefined}
          className="assembly-timeline-help"
        >
          {invalidCode
            ? codeError
            : `帧号 00–${String(nominalFps - 1).padStart(2, "0")} · ${content.sequence_timebase.timecode_mode === "DROP_FRAME" ? "29.97 跳帧" : "非跳帧"} · ${total ? `${timecode(0)} → ${timecode(total - 1)}` : "尚无序列帧"}`}
        </p>
      )}
      <div className="assembly-actions assembly-timeline-tools">
        <button
          type="button"
          className="button"
          disabled={zoom <= 1}
          onClick={() => changeZoom(zoom / 2)}
          aria-label="缩小时间轴"
        >
          −
        </button>
        <span>{zoom}×</span>
        <button
          type="button"
          className="button"
          disabled={zoom >= 64 || !total}
          onClick={() => changeZoom(zoom * 2)}
          aria-label="放大时间轴"
        >
          +
        </button>
        <button type="button" className="button assembly-fit" onClick={() => changeZoom(1)}>
          适应窗口
        </button>
        <button
          type="button"
          className="button assembly-locate assembly-locate-previous"
          title={audioOnly ? "上一音频片段" : "上一镜头"}
          disabled={selectionLocked || !total}
          onClick={() => locate(-1)}
        >
          上一{audioOnly ? "音频片段" : "镜头"}
        </button>
        <button
          type="button"
          className="button assembly-locate assembly-locate-next"
          title={audioOnly ? "下一音频片段" : "下一镜头"}
          disabled={selectionLocked || !total}
          onClick={() => locate(1)}
        >
          下一{audioOnly ? "音频片段" : "镜头"}
        </button>
      </div>
      <div
        className="assembly-timeline-viewport"
        ref={viewport}
        onScroll={(event) => setScroll(event.currentTarget.scrollLeft)}
        aria-label="可缩放序列轨道"
      >
        <div className="assembly-timeline-canvas" style={{ width: width * zoom }}>
          <div
            className="assembly-timeline-ruler"
            onClick={(event) => pointer(event)}
            aria-label="帧刻度定位"
          >
            {ticks.map((at) => (
              <span key={at} style={{ left: at * scale }}>
                {timecode(at)}
              </span>
            ))}
          </div>
          {tracks.map((track) => (
            <div className="assembly-timeline-lane" key={track.label} aria-label={track.label}>
              {track.segments.map((segment) =>
                "media" in segment ? (
                  <button
                    key={segment.segment_id}
                    type="button"
                    disabled={selectionLocked}
                    aria-pressed={segment.segment_id === selected}
                    title={`${"track_kind" in segment ? `${segment.track_kind} · ` : ""}${findAssemblyAsset(library, segment.media)?.filename ?? segment.segment_id} · ${timecode(segment.start_frame)}–${timecode(segment.end_frame)}`}
                    aria-label={`定位片段 ${segment.segment_id}`}
                    style={{
                      left: segment.start_frame * scale,
                      width: (segment.end_frame - segment.start_frame) * scale,
                    }}
                    onClick={(event) => pointer(event, segment)}
                  >
                    {"track_kind" in segment ? `${segment.track_kind} · ` : ""}
                    {findAssemblyAsset(library, segment.media)?.filename ?? segment.segment_id}
                  </button>
                ) : (
                  <span
                    className="assembly-timeline-subtitle"
                    key={segment.segment_id}
                    style={{
                      left: segment.start_frame * scale,
                      width: (segment.end_frame - segment.start_frame) * scale,
                    }}
                    title={"text" in segment ? segment.text : `剧本文块 ${segment.script_block_id}`}
                  >
                    {`字幕 · ${"text" in segment ? segment.text : "剧本文块"}`}
                  </span>
                ),
              )}
            </div>
          ))}
          <span
            className="assembly-timeline-playhead"
            style={{ left: Math.min(width * zoom - 1, frame * scale) }}
            aria-hidden="true"
          />
        </div>
      </div>
      <input
        aria-label="剪切位置时间轴"
        type="range"
        min={0}
        max={Math.max(0, total - 1)}
        step={1}
        value={frame}
        disabled={!total}
        onChange={(event) => props.onFrame(Number(event.target.value))}
      />
      {!props.compact && (
        <p className="assembly-timeline-help">更改草稿后请保存；时间轴不代表实时播放。</p>
      )}
      <details className="assembly-timeline-help">
        <summary>{props.compact ? "时间码、快捷键与监看边界" : "快捷键说明"}</summary>
        {props.compact && (
          <>
            <p>
              {displayed} · {assemblySeconds(frame, content).toFixed(3)} 秒
            </p>
            {!invalidCode && (
              <p
                id={codeHelpId}
                role={invalidCode ? "alert" : undefined}
                className="assembly-timeline-help"
              >
                {invalidCode
                  ? codeError
                  : `帧号 00–${String(nominalFps - 1).padStart(2, "0")} · ${content.sequence_timebase.timecode_mode === "DROP_FRAME" ? "29.97 跳帧" : "非跳帧"} · ${total ? `${timecode(0)} → ${timecode(total - 1)}` : "尚无序列帧"}`}
              </p>
            )}
            <p>更改草稿后请保存；时间轴不代表实时播放。</p>
          </>
        )}
        <p className="assembly-timeline-help">
          聚焦时间轴后：←/→ 逐帧，Shift+←/→ 10 帧，Home/End 首末帧，↑/↓{" "}
          {audioOnly ? "音频片段" : "镜头"}，+/− 缩放，F 适应窗口；Ctrl+B 分割、Delete 删除、Ctrl+Z
          / Ctrl+Shift+Z
          撤销/重做只修改当前草稿。请另行保存。时间轴定位用于剪辑决定，不代表序列实时播放。
        </p>
      </details>
    </div>
  );
}
