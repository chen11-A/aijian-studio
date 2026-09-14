import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useDemo } from "./model";
import { anchoredScroll, frameTimecode, parseTimecode, rulerStep } from "./timeline-model";
import "./v21-timeline.css";

export function useModernTimeline() {
  return true;
}

export function TimelineWorkbench({
  children,
  seek,
  actions,
  gutter = 0,
  review = false,
  timeline,
}: {
  children: ReactNode;
  seek: (time: number) => void;
  gutter?: number;
  review?: boolean;
  actions?: (range: { start: number; end: number } | undefined) => ReactNode;
  timeline?: {
    totalFrames: number;
    frame: number;
    frameRate: { num: number; den: number };
    timecodeMode: string;
    clipEndFrames: number[];
  };
}) {
  const d = useDemo(),
    frameRate = timeline ? timeline.frameRate.num / timeline.frameRate.den : 24,
    timecodeRate = Math.max(1, Math.round(frameRate)),
    total = Math.max(1, timeline?.totalFrames ?? Math.round(d.total * frameRate)),
    frame = Math.round(timeline?.frame ?? d.time * frameRate);
  const scroll = useRef<HTMLDivElement>(null),
    drag = useRef<number | null>(null);
  const pending = useRef<{ frame: number; anchor: number } | null>(null);
  const lastVisibleFrame = useRef<number | null>(null);
  const [width, setWidth] = useState(992),
    [left, setLeft] = useState(0);
  const [code, setCode] = useState(
      frameTimecode(
        frame,
        timecodeRate,
        timeline?.timecodeMode as "NON_DROP_FRAME" | "DROP_FRAME" | undefined,
      ),
    ),
    [invalid, setInvalid] = useState(false);
  const fit = Math.max(0.001, (width - gutter) / total);
  const storedScale = Number(d.value("timelineScale", "0"));
  const scale = storedScale === 0 ? fit : Math.max(fit, Math.min(6, storedScale));
  const snap = d.value("timelineSnap", "true") === "true";
  const readMark = (key: string) => {
    const raw = d.value(key, "");
    return raw === "" ? null : Math.min(total, Math.max(0, Number(raw)));
  };
  const start = readMark("timelineIn"),
    end = readMark("timelineOut");
  const range =
    start !== null && end !== null && end > start
      ? { start: start / frameRate, end: end / frameRate }
      : undefined;
  const edges = [0];
  let elapsed = 0;
  if (timeline) edges.push(...timeline.clipEndFrames);
  else
    d.shots.forEach((shot) => {
      elapsed += shot.duration;
      edges.push(Math.round(elapsed * frameRate));
    });
  useEffect(() => {
    setCode(
      frameTimecode(
        frame,
        timecodeRate,
        timeline?.timecodeMode as "NON_DROP_FRAME" | "DROP_FRAME" | undefined,
      ),
    );
    setInvalid(false);
  }, [frame]);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth) setWidth(element.clientWidth);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    if (pending.current) {
      element.scrollLeft = anchoredScroll(
        pending.current.frame,
        scale,
        pending.current.anchor,
        width - gutter,
        total,
      );
      pending.current = null;
    }
    setLeft(element.scrollLeft);
  }, [scale, total, width, gutter]);
  useEffect(() => {
    const element = scroll.current;
    if (!element || lastVisibleFrame.current === frame) return;
    lastVisibleFrame.current = frame;
    const x = frame * scale - element.scrollLeft;
    if (x < 0 || x > width - gutter)
      element.scrollLeft = anchoredScroll(
        frame,
        scale,
        (width - gutter) / 2,
        width - gutter,
        total,
      );
    // Recenter only when the time changes; manual horizontal inspection stays free.
  }, [frame, scale, width, gutter, total]);
  const go = (next: number) => {
    d.setPlaying(false);
    seek(Math.max(0, Math.min(total, Math.round(next))) / frameRate);
  };
  const zoom = (next: number, mouse?: number) => {
    const x = frame * scale - (scroll.current?.scrollLeft ?? 0);
    const anchor = mouse ?? (x >= 0 && x <= width - gutter ? x : (width - gutter) / 2);
    pending.current = {
      frame:
        mouse !== undefined || x < 0 || x > width - gutter
          ? ((scroll.current?.scrollLeft ?? 0) + anchor) / scale
          : frame,
      anchor,
    };
    d.put("timelineScale", String(next));
  };
  const mark = (kind: "In" | "Out") => {
    if (
      (kind === "In" && end !== null && frame >= end) ||
      (kind === "Out" && start !== null && frame <= start)
    ) {
      d.notify("出点必须晚于入点，请先清除范围再重新标记");
      return;
    }
    d.put(`timeline${kind}`, String(frame));
  };
  const clear = () => {
    d.put("timelineIn", "");
    d.put("timelineOut", "");
  };
  const pointer = (clientX: number) => {
    const element = scroll.current;
    if (!element) return;
    let next = Math.round(
      (clientX - element.getBoundingClientRect().left + element.scrollLeft - gutter) / scale,
    );
    if (snap) {
      const edge = edges.reduce(
        (best, item) => (Math.abs(item - next) < Math.abs(best - next) ? item : best),
        edges[0]!,
      );
      if (Math.abs(edge - next) * scale <= 8) next = edge;
    }
    go(next);
  };
  const step = rulerStep(scale),
    first = Math.max(0, Math.floor(left / scale / step) * step);
  const ticks = Array.from(
    { length: Math.ceil(width / scale / step) + 2 },
    (_, index) => first + index * step,
  ).filter((tick) => tick <= total);
  return (
    <section
      className={`v21-timeline ${gutter ? "v21-timeline-assembly" : ""}`}
      aria-label={review ? "唯一批注时间线" : "帧级时间轴"}
    >
      <div className="v21-timeline-toolbar">
        <div className="v21-timeline-group">
          <button
            aria-label="上一镜头"
            onClick={() => go([...edges].reverse().find((edge) => edge < frame) ?? 0)}
          >
            │‹
          </button>
          <button aria-label="上一帧" onClick={() => go(frame - 1)}>
            ‹
          </button>
          <input
            aria-label="当前时间码"
            aria-invalid={invalid}
            title="HH:MM:SS:FF · Enter 定位"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setInvalid(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const parsed = parseTimecode(
                  code,
                  total,
                  timecodeRate,
                  timeline?.timecodeMode as "NON_DROP_FRAME" | "DROP_FRAME" | undefined,
                );
                setInvalid(parsed === null);
                if (parsed !== null) go(parsed);
              }
              if (event.key === "Escape") {
                setCode(
                  frameTimecode(
                    frame,
                    timecodeRate,
                    timeline?.timecodeMode as "NON_DROP_FRAME" | "DROP_FRAME" | undefined,
                  ),
                );
                setInvalid(false);
              }
            }}
          />
          <button aria-label="下一帧" onClick={() => go(frame + 1)}>
            ›
          </button>
          <button
            aria-label="下一镜头"
            onClick={() => go(edges.find((edge) => edge > frame) ?? total)}
          >
            ›│
          </button>
          <span className="v21-timeline-duration">
            /{" "}
            {frameTimecode(
              total,
              timecodeRate,
              timeline?.timecodeMode as "NON_DROP_FRAME" | "DROP_FRAME" | undefined,
            )}{" "}
            ·{" "}
            {timeline
              ? `${timeline.frameRate.num}/${timeline.frameRate.den} fps · ${timeline.timecodeMode}`
              : "24 fps"}
          </span>
        </div>
        <div className="v21-timeline-group v21-timeline-scale">
          <button onClick={() => zoom(0)}>适应全片</button>
          <input
            type="range"
            aria-label="时间轴缩放"
            min={Math.min(fit, 6)}
            max={6}
            step="any"
            value={Math.min(scale, 6)}
            onChange={(event) => zoom(Number(event.target.value))}
          />
          <output aria-label="时间轴比例">
            {storedScale === 0 ? "全片" : `${scale.toFixed(2)} px/帧`}
          </output>
        </div>
      </div>
      <div className="v21-timeline-tools">
        <div className="v21-timeline-group">
          <button aria-pressed={snap} onClick={() => d.put("timelineSnap", String(!snap))}>
            吸附
          </button>
          <button aria-label="设入点 I" onClick={() => mark("In")}>
            入点 I
          </button>
          <button aria-label="设出点 O" onClick={() => mark("Out")}>
            出点 O
          </button>
          <button onClick={clear}>清除范围</button>
        </div>
        <div className="v21-timeline-group">{actions?.(range)}</div>
      </div>
      <div className="v21-timeline-status">
        <output aria-label="已选时间范围">
          {invalid
            ? "时间码无效：使用 HH:MM:SS:FF，帧须为 00–23 且不超过片长"
            : start !== null || end !== null
              ? `I ${start === null ? "未设" : frameTimecode(start, timecodeRate, timeline?.timecodeMode as "NON_DROP_FRAME" | "DROP_FRAME" | undefined)} → O ${end === null ? "未设" : frameTimecode(end, timecodeRate, timeline?.timecodeMode as "NON_DROP_FRAME" | "DROP_FRAME" | undefined)}${range ? ` · ${end! - start!} 帧` : ""}`
              : "点击标尺定位 · ← / → 逐帧 · I / O 标记范围"}
        </output>
        <span>Ctrl + 滚轮缩放</span>
      </div>
      <div
        className="v21-timeline-scroll"
        ref={scroll}
        tabIndex={0}
        aria-label="时间轴横向滚动区域"
        onScroll={(event) => setLeft(event.currentTarget.scrollLeft)}
        onWheel={(event) => {
          if (event.ctrlKey) {
            event.preventDefault();
            zoom(
              Math.max(fit, Math.min(6, scale * Math.exp(-event.deltaY * 0.003))),
              event.clientX - event.currentTarget.getBoundingClientRect().left - gutter,
            );
          } else event.currentTarget.scrollLeft += event.deltaX || event.deltaY;
        }}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return;
          if (
            ["ArrowLeft", "ArrowRight", "Home", "End", "i", "I", "o", "O", "Escape"].includes(
              event.key,
            )
          )
            event.preventDefault();
          if (event.key === "ArrowLeft" || event.key === "ArrowRight")
            go(frame + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 24 : 1));
          if (event.key === "Home") go(0);
          if (event.key === "End") go(total);
          if (event.key.toLowerCase() === "i") mark("In");
          if (event.key.toLowerCase() === "o") mark("Out");
          if (event.key === "Escape") clear();
        }}
      >
        <div className="v21-timeline-content" style={{ width: total * scale + gutter }}>
          <div
            className="v21-frame-ruler"
            style={{ marginLeft: gutter, backgroundSize: `${rulerStep(scale, 6) * scale}px 5px` }}
            onPointerDown={(event) => {
              drag.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              pointer(event.clientX);
            }}
            onPointerMove={(event) => {
              if (drag.current === event.pointerId) pointer(event.clientX);
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            {ticks.map((tick) => (
              <span key={tick} style={{ left: tick * scale }}>
                {frameTimecode(
                  tick,
                  timecodeRate,
                  timeline?.timecodeMode as "NON_DROP_FRAME" | "DROP_FRAME" | undefined,
                )}
              </span>
            ))}
          </div>
          {range && (
            <div
              className="v21-selected-range"
              style={{ left: gutter + start! * scale, width: (end! - start!) * scale }}
            />
          )}
          {children}
          <div
            className="v21-frame-playhead"
            style={{ left: gutter + Math.min(total * scale - 1, frame * scale) }}
          >
            <button
              aria-label="拖动播放头"
              title={frameTimecode(
                frame,
                timecodeRate,
                timeline?.timecodeMode as "NON_DROP_FRAME" | "DROP_FRAME" | undefined,
              )}
              onPointerDown={(event) => {
                event.preventDefault();
                drag.current = event.pointerId;
                event.currentTarget.setPointerCapture(event.pointerId);
                pointer(event.clientX);
              }}
              onPointerMove={(event) => {
                if (drag.current === event.pointerId) pointer(event.clientX);
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                  event.preventDefault();
                  go(frame + (event.key === "ArrowLeft" ? -1 : 1));
                }
              }}
            />
          </div>
        </div>
      </div>
      <div className="v21-timeline-seek-access">
        <input
          className="v21-timeline-accessible-seek"
          aria-label={review ? "审片时间轴" : gutter ? "组装位置" : "预演位置"}
          type="range"
          min={0}
          max={d.total}
          step={1 / frameRate}
          value={frame / frameRate}
          onChange={(event) => go(Number(event.target.value) * frameRate)}
        />
      </div>
    </section>
  );
}
