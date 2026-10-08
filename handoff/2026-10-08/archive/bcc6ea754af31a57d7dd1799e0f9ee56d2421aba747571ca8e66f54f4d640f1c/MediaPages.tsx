import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useDemo, moveShot, shotAtTime } from "./model";
import type { Annotation } from "./model";
import { art, seconds } from "./data";
import reviewCity from "./assets/v2/city.png";
import { Button, FlowFooter, PageTitle, Pill } from "./Common";
import { Icon } from "./Icon";
import "./v2-media.css";
import { TimelineWorkbench, useModernTimeline } from "./TimelineWorkbench";

const FPS = 24;
export function mediaTimecode(time: number) {
  const frames = Math.max(0, Math.round(time * FPS));
  return [
    Math.floor(frames / (FPS * 3600)),
    Math.floor(frames / (FPS * 60)) % 60,
    Math.floor(frames / FPS) % 60,
    frames % FPS,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
function Card({
  title,
  icon = "film",
  children,
  className = "",
}: {
  title: ReactNode;
  icon?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`v2-media-card ${className}`}>
      <h2>
        <Icon name={icon} size={18} />
        {title}
      </h2>
      {children}
    </section>
  );
}
function useMediaActions() {
  const d = useDemo();
  const shot =
    (d.page === "storyboard" || d.page === "review"
      ? shotAtTime(d.shots, d.time)
      : d.shots.find((item) => item.id === d.selectedShot)) ?? d.shots[0]!;
  const seek = (time: number) => {
    const next = Math.min(d.total, Math.max(0, Math.round(time * FPS) / FPS));
    d.setTime(next);
    d.setSelectedShot(shotAtTime(d.shots, next)?.id ?? 1);
  };
  const select = (id: number) => {
    const index = d.shots.findIndex((item) => item.id === id);
    if (index < 0) return;
    d.setSelectedShot(id);
    d.setTime(d.shots.slice(0, index).reduce((sum, item) => sum + item.duration, 0));
    d.setPlaying(false);
  };
  const editShot = () =>
    d.edit(
      "编辑镜头",
      [
        { key: "name", label: "镜头名称", value: shot.name, required: true },
        { key: "note", label: "叙事与表演", value: shot.note, type: "textarea", required: true },
        {
          key: "duration",
          label: "镜头时长（秒）",
          value: String(shot.duration),
          type: "number",
          min: 0.5,
          max: 30,
          required: true,
        },
      ],
      (values) => {
        const duration = Number(values.duration);
        if (!Number.isFinite(duration) || duration < 0.5 || duration > 30) {
          d.notify("镜头时长须为 0.5–30 秒");
          return false;
        }
        d.setShots((old) =>
          old.map((item) =>
            item.id === shot.id
              ? { ...item, name: values.name!, note: values.note!, duration }
              : item,
          ),
        );
        select(shot.id);
      },
    );
  const addShot = () =>
    d.edit(
      "添加镜头",
      [
        { key: "name", label: "镜头名称", value: "新的镜头", required: true },
        {
          key: "duration",
          label: "时长（秒）",
          value: "4",
          type: "number",
          min: 0.5,
          max: 30,
          required: true,
        },
      ],
      (values) => {
        const duration = Number(values.duration);
        if (!Number.isFinite(duration) || duration < 0.5 || duration > 30) return false;
        const id = Math.max(...d.shots.map((item) => item.id)) + 1;
        d.setShots((old) => [
          ...old,
          { id, name: values.name!, duration, image: shot.image, note: "新增演示镜头 · 待完善" },
        ]);
        d.setSelectedShot(id);
        d.setTime(d.total);
        d.setPlaying(false);
      },
    );
  const mark = () =>
    d.edit("标记待调整", [
      {
        key: `shotIssue-${shot.id}`,
        label: "问题描述",
        value: d.value(`shotIssue-${shot.id}`),
        type: "textarea",
        required: true,
      },
    ]);
  const annotate = (range: boolean, selected?: { start: number; end: number }) =>
    d.edit(
      range ? "添加区间批注" : "添加当前帧批注",
      [
        {
          key: "start",
          label: "开始时间（秒）",
          value: String(selected?.start ?? d.time),
          type: "number",
          min: 0,
          max: d.total,
          required: true,
        },
        ...(range
          ? [
              {
                key: "end",
                label: "结束时间（秒）",
                value: String(selected?.end ?? Math.min(d.total, d.time + 2)),
                type: "number" as const,
                min: 0,
                max: d.total,
                required: true,
              },
            ]
          : []),
        {
          key: "category",
          label: "修改类型",
          value: "剪辑节奏",
          options: ["剪辑节奏", "字幕", "音量", "画面表现"],
        },
        { key: "text", label: "批注内容", value: "", type: "textarea", required: true },
      ],
      (values) => {
        const start = Math.round(Number(values.start) * FPS) / FPS;
        const end = range ? Math.round(Number(values.end) * FPS) / FPS : start;
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end < start ||
          end > d.total
        ) {
          d.notify("未保存：批注区间必须在片长内，结束时间不能早于开始时间");
          return false;
        }
        d.setAnnotations((old) => [
          ...old,
          {
            id: Date.now(),
            start,
            end,
            text: values.text!,
            category: values.category!,
            included: true,
          },
        ]);
      },
    );
  const openImage = () => d.setEditor({ title: `${shot.name} · 参考静帧`, image: shot.image });
  return { d, shot, seek, select, editShot, addShot, mark, annotate, openImage };
}
type MediaActions = ReturnType<typeof useMediaActions>;

// The delivered review thumbnails are independent sample references, not Shot media.
const reviewAnnotationSamples: Readonly<Record<number, string>> = {
  1: art.hero,
  2: reviewCity,
  3: art.portrait,
  4: reviewCity,
};

function TimelineFilmstrip({ review }: { review?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(10);
  const className = review ? "v2-review-filmstrip" : "v2-storyboard-filmstrip";
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Frozen build_masters.py: n=max(10,int(iw/74)), each frame iw/n-2 wide.
    const measure = () =>
      setCount(Math.max(10, Math.floor(element.getBoundingClientRect().width / 74)));
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
  return (
    <div ref={ref} className={className} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={`${className}-frame`}
          style={{ left: `${(index / count) * 100}%`, width: `calc(${100 / count}% - 2px)` }}
        >
          <img src={index % 3 === 0 ? reviewCity : art.hero} alt="" />
        </div>
      ))}
    </div>
  );
}

function ReferenceImage({
  actions,
  className = "",
}: {
  actions: MediaActions;
  className?: string;
}) {
  return (
    <button
      className={`v2-media-image ${className}`}
      onClick={actions.openImage}
      aria-label="放大参考画面"
    >
      <img src={actions.shot.image} alt={`${actions.shot.name}参考静帧`} />
    </button>
  );
}
function ProductionTabs({ generation }: { generation: boolean }) {
  const d = useDemo();
  return (
    <div className="v2-production-tabs" role="group" aria-label="制作页面">
      <Button aria-pressed={generation} onClick={() => d.go("generation")}>
        镜头生成
      </Button>
      <Button aria-pressed={!generation} onClick={() => d.go("assembly")}>
        成片组装
      </Button>
    </div>
  );
}

function MediaTimeline({ actions, review }: { actions: MediaActions; review?: boolean }) {
  const modern = useModernTimeline();
  const { d, shot, seek, select, addShot, annotate } = actions;
  const dragShot = useRef<number | null>(null);
  if (!modern) return <LegacyMediaTimeline actions={actions} review={review} />;
  return (
    <TimelineWorkbench
      seek={seek}
      review={review}
      actions={(range) =>
        review ? (
          <>
            <Button onClick={() => annotate(false)}>添加批注</Button>
            <Button aria-label="选择范围批注" onClick={() => annotate(true, range)}>
              范围批注
            </Button>
          </>
        ) : (
          <>
            <Button
              aria-label={d.playing && d.time < d.total ? "暂停分镜预演" : "播放分镜预演"}
              onClick={() => {
                if (d.time >= d.total) d.setTime(0);
                d.setPlaying(d.time >= d.total || !d.playing);
              }}
            >
              {d.playing && d.time < d.total ? "暂停" : "播放静帧"}
            </Button>
            <Button onClick={addShot}>添加镜头</Button>
          </>
        )
      }
    >
      <div className="v2-timeline-layers">
        <div className="v2-timeline-markers">
          {d.annotations.map((note, index) => {
            if (note.start > d.total) return null;
            const left = (note.start / d.total) * 100;
            return (
              <div
                key={note.id}
                className={note.end > note.start ? "is-range" : ""}
                style={{
                  left: `${left}%`,
                  width: `${(Math.max(0, Math.min(d.total, note.end) - note.start) / d.total) * 100}%`,
                }}
              >
                {note.end > note.start && <span />}
                <button
                  aria-label={`定位批注 ${note.text}`}
                  title={mediaTimecode(note.start)}
                  onClick={() => {
                    seek(note.start);
                    d.setPlaying(false);
                  }}
                >
                  {index + 1}
                </button>
              </div>
            );
          })}
        </div>
        <div
          className={`v2-timeline-thumbnails ${review ? "v2-review-thumbnails" : "v2-storyboard-thumbnails"}`}
        >
          <TimelineFilmstrip review={review} />
          {d.shots.map((item, index) => (
            <button
              key={item.id}
              className={shot.id === item.id ? "selected" : ""}
              style={{ flexGrow: item.duration }}
              aria-label={`镜头 ${item.id} ${item.name}`}
              aria-pressed={shot.id === item.id}
              title={`${item.name} · ${item.duration}s${review ? "" : " · 拖动或 Alt + 方向键排序"}`}
              draggable={!review}
              onClick={() => select(item.id)}
              onDragStart={() => {
                dragShot.current = item.id;
              }}
              onDragOver={(event) => {
                if (!review) event.preventDefault();
              }}
              onDrop={() => {
                const sourceId = dragShot.current;
                if (!review && sourceId !== null) {
                  d.setShots((old) => moveShot(old, sourceId, item.id));
                  d.setPlaying(false);
                }
                dragShot.current = null;
              }}
              onKeyDown={(event) => {
                if (!review && event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
                  event.preventDefault();
                  const target = d.shots[index + (event.key === "ArrowLeft" ? -1 : 1)];
                  if (target) {
                    d.setShots((old) => moveShot(old, item.id, target.id));
                    d.setPlaying(false);
                  }
                }
              }}
            >
              <span className="v21-shot-label">
                {String(item.id).padStart(2, "0")} · {item.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </TimelineWorkbench>
  );
}

function LegacyMediaTimeline({ actions, review }: { actions: MediaActions; review?: boolean }) {
  const { d, shot, seek, select, addShot, annotate } = actions;
  const dragShot = useRef<number | null>(null);
  const scrub = useRef<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const play = () => {
    if (d.time >= d.total) d.setTime(0);
    d.setPlaying(d.time >= d.total || !d.playing);
  };
  const position = d.total ? Math.min(100, (d.time / d.total) * 100) : 0;
  const seekPointer = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (box?.width) seek(((clientX - box.left) / box.width) * d.total);
  };
  return (
    <section
      className="v2-media-timeline"
      aria-label={review ? "唯一批注时间线" : "镜头预演时间线"}
    >
      <header>
        <h2>{review ? "唯一批注时间线" : "镜头预演时间线"}</h2>
        <div className="v2-timeline-actions">
          {review ? (
            <>
              <Button icon="point" onClick={() => annotate(false)}>
                点批注
              </Button>
              <Button icon="range" aria-label="选择范围批注" onClick={() => annotate(true)}>
                范围
              </Button>
              <Button icon="plus" onClick={() => annotate(false)}>
                添加批注
              </Button>
            </>
          ) : (
            <>
              <Button
                icon={d.playing && d.time < d.total ? "pause" : "play"}
                aria-label={d.playing && d.time < d.total ? "暂停分镜预演" : "播放分镜预演"}
                onClick={play}
              >
                {d.playing && d.time < d.total ? "暂停" : "播放"}
              </Button>
              <Button
                icon="film"
                onClick={() => {
                  d.setPlaying(false);
                  seek(d.time + 1 / FPS);
                }}
              >
                逐帧
              </Button>
              <Button icon="plus" onClick={addShot}>
                添加镜头
              </Button>
            </>
          )}
        </div>
        <div className="v2-timeline-zoom">
          <button
            aria-label="缩小时间轴"
            disabled={zoom === 1}
            onClick={() => setZoom(Math.max(1, zoom - 1))}
          >
            −
          </button>
          <span>时间缩放 {zoom}×</span>
          <button
            aria-label="放大时间轴"
            disabled={zoom === 4}
            onClick={() => setZoom(Math.min(4, zoom + 1))}
          >
            +
          </button>
        </div>
      </header>
      <div
        className="v2-timeline-scroll"
        aria-label="时间轴局部缩放"
        tabIndex={zoom > 1 ? 0 : undefined}
        onWheel={(event) => {
          if (zoom > 1 && !event.ctrlKey)
            event.currentTarget.scrollLeft += event.deltaX || event.deltaY;
        }}
        style={{ overflowX: zoom > 1 ? "auto" : "hidden" }}
      >
        <div className="v2-timeline-layers" ref={strip} style={{ width: `${zoom * 100}%` }}>
          <div className="v2-timeline-markers">
            {d.annotations.map((note, index) => {
              if (note.start > d.total) return null;
              const left = (note.start / d.total) * 100;
              return (
                <div
                  key={note.id}
                  className={note.end > note.start ? "is-range" : ""}
                  style={{
                    left: `${left}%`,
                    width: `${(Math.max(0, Math.min(d.total, note.end) - note.start) / d.total) * 100}%`,
                  }}
                >
                  {note.end > note.start && <span />}
                  <button
                    aria-label={`定位批注 ${note.text}`}
                    title={mediaTimecode(note.start)}
                    onClick={() => {
                      seek(note.start);
                      d.setPlaying(false);
                    }}
                  >
                    {index + 1}
                  </button>
                </div>
              );
            })}
          </div>
          <div
            className={`v2-timeline-thumbnails ${review ? "v2-review-thumbnails" : "v2-storyboard-thumbnails"}`}
          >
            <TimelineFilmstrip review={review} />
            {d.shots.map((item, index) => (
              <button
                key={item.id}
                className={shot.id === item.id ? "selected" : ""}
                style={{ flexGrow: item.duration }}
                aria-label={`镜头 ${item.id} ${item.name}`}
                aria-pressed={shot.id === item.id}
                title={`${item.name} · ${item.duration}s${review ? "" : " · 拖动或 Alt + 方向键排序"}`}
                draggable={!review}
                onClick={() => select(item.id)}
                onDragStart={() => {
                  dragShot.current = item.id;
                }}
                onDragOver={(event) => {
                  if (!review) event.preventDefault();
                }}
                onDrop={() => {
                  const sourceId = dragShot.current;
                  if (!review && sourceId !== null) {
                    d.setShots((old) => moveShot(old, sourceId, item.id));
                    d.setPlaying(false);
                  }
                  dragShot.current = null;
                }}
                onKeyDown={(event) => {
                  if (!review && event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
                    event.preventDefault();
                    const target = d.shots[index + (event.key === "ArrowLeft" ? -1 : 1)];
                    if (target) {
                      d.setShots((old) => moveShot(old, item.id, target.id));
                      d.setPlaying(false);
                    }
                  }
                }}
              />
            ))}
          </div>
          <div className="v2-timeline-ruler">
            {Array.from({ length: 9 }, (_, index) => (
              <span key={index}>{seconds((d.total * index) / 8)}</span>
            ))}
          </div>
          <input
            className="v2-timeline-seek"
            aria-label={review ? "审片时间轴" : "预演位置"}
            type="range"
            min={0}
            max={d.total}
            step={1 / FPS}
            value={d.time}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <div className="v2-timeline-playhead" style={{ left: `${position}%` }}>
            <button
              aria-label="拖动播放头"
              title={mediaTimecode(d.time)}
              onPointerDown={(event) => {
                event.preventDefault();
                scrub.current = event.pointerId;
                event.currentTarget.setPointerCapture(event.pointerId);
                d.setPlaying(false);
                seekPointer(event.clientX);
              }}
              onPointerMove={(event) => {
                if (scrub.current === event.pointerId) seekPointer(event.clientX);
              }}
              onPointerUp={(event) => {
                scrub.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                scrub.current = null;
              }}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                  event.preventDefault();
                  seek(d.time + (event.key === "ArrowLeft" ? -1 : 1) / FPS);
                }
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewPlayer({ actions }: { actions: MediaActions }) {
  const { d, shot } = actions;
  return (
    <div className="v2-review-player">
      <ReferenceImage actions={actions} />
      <div className="v2-review-controls">
        <Button icon="play" aria-label="暂无真实视频，不能播放" disabled title="未提供真实视频" />
        <Button icon="audio" aria-label="暂无真实音轨" disabled title="未提供真实音轨" />
        <span>
          {mediaTimecode(d.time)} / {mediaTimecode(d.total)}
        </span>
        <small>参考静帧 · 无视频/音轨</small>
        <Button icon="expand" aria-label={`全屏查看 ${shot.name}`} onClick={actions.openImage} />
      </div>
    </div>
  );
}
function ReviewNotes({ actions }: { actions: MediaActions }) {
  const { d, shot, seek } = actions;
  const listRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(384);
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const measure = () => {
      if (element.clientHeight) setViewportHeight(element.clientHeight);
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
  const filter = d.value("annotationFilter", "全部"),
    sort = d.value("annotationSort", "时间顺序");
  const notes = d.annotations
    .filter(
      (note) =>
        filter === "全部" ||
        (filter === "当前镜头"
          ? shotAtTime(d.shots, note.start)?.id === shot.id
          : note.category === filter),
    )
    .sort((a, b) => (sort === "时间顺序" ? a.start - b.start : b.id - a.id));
  const contentHeight = Math.max(0, notes.length * 128 - 8);
  const scrollTop = Math.max(
    0,
    Math.min(contentHeight - viewportHeight, Number(d.value("reviewNoteScroll", "0"))),
  );
  const thumbRatio = contentHeight ? Math.min(1, viewportHeight / contentHeight) : 1;
  return (
    <section className="v2-review-notes">
      <header>
        <h2>
          <Icon name="review" size={18} />
          批注列表 · {d.annotations.length} 条
        </h2>
        <button
          onClick={() =>
            d.edit("批注筛选与排序", [
              {
                key: "annotationFilter",
                label: "批注筛选",
                value: filter,
                options: ["全部", "当前镜头", "剪辑节奏", "字幕", "音量", "画面表现"],
              },
              {
                key: "annotationSort",
                label: "批注排序",
                value: sort,
                options: ["时间顺序", "最新添加"],
              },
            ])
          }
        >
          {sort === "时间顺序" ? "按时间" : "最新"}
        </button>
      </header>
      <div
        className="v2-review-note-list"
        aria-label="批注列表内容"
        onScroll={(event) => d.put("reviewNoteScroll", String(event.currentTarget.scrollTop))}
        ref={(element) => {
          listRef.current = element;
          if (element && Math.abs(element.scrollTop - Number(d.value("reviewNoteScroll", "0"))) > 1)
            element.scrollTop = Number(d.value("reviewNoteScroll", "0"));
        }}
      >
        {notes.map((note) => (
          <button
            key={note.id}
            title={note.text}
            className={`v2-review-note ${note.end > note.start ? "is-range" : ""} ${(note.end > note.start ? d.time >= note.start && d.time < note.end : d.time === note.start) ? "selected" : ""}`}
            onClick={() => {
              seek(note.start);
              d.setPlaying(false);
            }}
          >
            <header>
              <b>{d.annotations.findIndex((item) => item.id === note.id) + 1}</b>
              <strong>
                {mediaTimecode(note.start)}
                {note.end > note.start && `–${mediaTimecode(note.end)}`}
              </strong>
            </header>
            <div>
              <img
                src={reviewAnnotationSamples[note.id] ?? shotAtTime(d.shots, note.start)?.image}
                alt=""
              />
              <p>{note.text}</p>
            </div>
            <small>
              {note.start > d.total ? "超出当前片长" : note.end > note.start ? "范围" : "点批注"} ·
              待处理
            </small>
          </button>
        ))}
        {!notes.length && <p className="v2-media-muted">暂无匹配批注；调整筛选或添加意见。</p>}
      </div>
      <div className="v2-review-scroll-track" aria-hidden="true">
        <div
          className="v2-review-scroll-thumb"
          style={{
            height: `${thumbRatio * 100}%`,
            top: `${contentHeight ? (scrollTop / contentHeight) * 100 : 0}%`,
          }}
        />
      </div>
    </section>
  );
}

function GenerationBody({ actions }: { actions: MediaActions }) {
  const { d, shot, select, editShot, mark } = actions;
  return (
    <div className="v2-media-body v2-generation-body">
      <div className="v2-media-selection">
        <ProductionTabs generation />
        <span className="v2-media-amber">未接入视频服务</span>
      </div>
      <div className="v2-generation-preview">
        <ReferenceImage actions={actions} />
        <Card title="当前镜头" className="v2-generation-job">
          <dl>
            <dt>镜头</dt>
            <dd>
              <select
                aria-label="当前制作镜头"
                value={shot.id}
                onChange={(event) => select(Number(event.target.value))}
              >
                {d.shots.map((item) => (
                  <option key={item.id} value={item.id}>
                    {String(item.id).padStart(3, "0")} / {String(d.shots.length).padStart(3, "0")} ·{" "}
                    {item.name}
                  </option>
                ))}
              </select>
            </dd>
            <dt>来源</dt>
            <dd>已选择分镜参考</dd>
            <dt>正式视频</dt>
            <dd>尚未生成</dd>
            <dt>费用</dt>
            <dd>未连接真实费用</dd>
          </dl>
          <Button onClick={editShot}>编辑镜头</Button>
        </Card>
      </div>
      <section className="v2-generation-candidates">
        <h2>候选版本 · 图稿样例</h2>
        <div
          className="v2-candidate-row"
          data-scroll-region="generation-candidates-scroll"
          aria-label="候选版本内容"
          tabIndex={0}
          onWheel={(event) => {
            event.currentTarget.scrollLeft += event.deltaX || event.deltaY;
          }}
          onScroll={(event) =>
            d.put("generationCandidateScroll", String(event.currentTarget.scrollLeft))
          }
          ref={(element) => {
            if (element) element.scrollLeft = Number(d.value("generationCandidateScroll", "0"));
          }}
        >
          {[1, 2, 3].map((version) => (
            <button
              key={version}
              className={d.value(`candidate-${shot.id}`, "1") === String(version) ? "selected" : ""}
              onClick={() =>
                d.edit("候选版本比较", [
                  {
                    key: `candidate-${shot.id}`,
                    label: "设为当前候选",
                    value: String(version),
                    options: ["1", "2", "3"],
                  },
                ])
              }
            >
              <img src={shot.image} alt={`版本 ${version} 演示参考`} />
              <span>参考样例 {version}</span>
            </button>
          ))}
        </div>
        <div className="v2-generation-adjust">
          <Button onClick={mark}>标记待调整</Button>
          <small>{d.value(`shotIssue-${shot.id}`, "")}</small>
        </div>
      </section>
    </div>
  );
}
function AssemblyBody({ actions }: { actions: MediaActions }) {
  const modern = useModernTimeline();
  const { d, shot, select } = actions;
  const dragShot = useRef<number | null>(null);
  const subtitle = () =>
    d.edit("修改字幕", [
      {
        key: "subtitle",
        label: "字幕文本",
        value: d.value("subtitle", "我总觉得，这座城市藏着什么……"),
        type: "textarea",
      },
    ]);
  const music = () =>
    d.edit("音乐与音量", [
      {
        key: "music",
        label: "配乐方向",
        value: d.value("music", "雨夜 · 轻氛围"),
        options: ["雨夜 · 轻氛围", "晨光 · 钢琴", "关闭配乐"],
      },
      {
        key: "volume",
        label: "音量 (%)",
        value: d.value("volume", "65"),
        type: "number",
        min: 0,
        max: 100,
      },
    ]);
  const ambience = () =>
    d.edit("环境声设定", [
      { key: "ambience", label: "环境声", value: d.value("ambience", "雨声与城市底噪") },
    ]);
  const tracks = d.professional
    ? ["V1 画面", "A1 对白", "A2 音乐", "A3 环境", "S1 字幕"]
    : ["视频", "对白", "字幕"];
  const timelineTracks = (
    <div className="v2-assembly-track-list">
      {tracks.map((name, index) => (
        <div key={name}>
          <span>{name}</span>
          <div className="v2-assembly-track-targets">
            <div className="v2-assembly-decoration" aria-hidden="true">
              {Array.from({ length: 5 }, (_, segment) => (
                <span
                  key={segment}
                  className="v2-assembly-decoration-segment"
                  style={{
                    backgroundColor:
                      index === 0 ? "#194d70" : name.includes("字幕") ? "#363856" : "#24445d",
                  }}
                >
                  {`${String(segment + 1).padStart(2, "0")}  样例`}
                </span>
              ))}
            </div>
            {d.shots.map((item, shotIndex) => (
              <button
                style={{ flexGrow: item.duration }}
                className={index === 0 && item.id === shot.id ? "selected" : ""}
                key={item.id}
                aria-label={`${name}镜头 ${item.id} ${item.name}`}
                aria-pressed={index === 0 ? item.id === shot.id : undefined}
                title={`${item.name} · ${item.duration}s`}
                draggable={index === 0}
                onDragStart={() => {
                  if (index === 0) dragShot.current = item.id;
                }}
                onDragOver={(event) => {
                  if (index === 0) event.preventDefault();
                }}
                onDrop={() => {
                  const sourceId = dragShot.current;
                  if (index === 0 && sourceId !== null) {
                    d.setShots((old) => moveShot(old, sourceId, item.id));
                    d.setPlaying(false);
                  }
                  dragShot.current = null;
                }}
                onKeyDown={(event) => {
                  if (
                    index === 0 &&
                    event.altKey &&
                    ["ArrowLeft", "ArrowRight"].includes(event.key)
                  ) {
                    event.preventDefault();
                    const target = d.shots[shotIndex + (event.key === "ArrowLeft" ? -1 : 1)];
                    if (target) {
                      d.setShots((old) => moveShot(old, item.id, target.id));
                      d.setPlaying(false);
                    }
                  }
                }}
                onClick={() => {
                  if (index === 0) select(item.id);
                  else if (name.includes("字幕")) subtitle();
                  else if (name.includes("音乐")) music();
                  else if (name.includes("环境")) ambience();
                  else d.go("voice");
                }}
              >
                {modern && (
                  <span className="v21-shot-label">
                    {String(item.id).padStart(2, "0")} · {item.name}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div
      className={`v2-media-body v2-assembly-body ${modern ? "v21-assembly-body" : ""} ${d.professional ? "v2-assembly-pro" : ""}`}
    >
      <div className="v2-media-selection">
        <ProductionTabs generation={false} />
        <Button onClick={() => d.go("voice")}>声音与字幕</Button>
      </div>
      <ReferenceImage actions={actions} />
      <section className="v2-assembly-tracks">
        <header>
          <h2>{d.professional ? "多轨组装 · 演示片段" : "单一成片时间线 · 演示片段"}</h2>
          <div>
            <button onClick={subtitle}>字幕</button>
            <button
              onClick={() =>
                d.edit("替换当前镜头", [
                  {
                    key: `candidate-${shot.id}`,
                    label: "已存在的演示候选",
                    value: d.value(`candidate-${shot.id}`, "1"),
                    options: ["1", "2", "3"],
                  },
                ])
              }
            >
              替换镜头
            </button>
            <button
              onClick={() => {
                d.put("editVersion", String(Number(d.value("editVersion", "1")) + 1));
                d.notify("剪辑演示版本已保存在内存中");
              }}
            >
              保存版本 v{d.value("editVersion", "1")}
            </button>
          </div>
        </header>
        {modern ? (
          <TimelineWorkbench seek={actions.seek} gutter={64}>
            {timelineTracks}
          </TimelineWorkbench>
        ) : (
          timelineTracks
        )}
      </section>
    </div>
  );
}

function editChange(d: ReturnType<typeof useDemo>, note: Annotation) {
  d.edit(
    "编辑修改方案项",
    [{ key: "text", label: "修改要求", value: note.text, type: "textarea", required: true }],
    (values) =>
      d.setAnnotations((old) =>
        old.map((item) => (item.id === note.id ? { ...item, text: values.text! } : item)),
      ),
  );
}
function V2ChangesPage() {
  const d = useDemo();
  const filter = d.value("changeFilter", "");
  const notes = d.annotations.filter((note) => !filter || note.category === filter);
  const included = d.annotations.filter((note) => note.included);
  return (
    <>
      <PageTitle
        actions={
          <Button
            onClick={() =>
              d.setEditor({
                title: "修改方案详情",
                presentation: "drawer",
                confirm: "关闭",
                description: [
                  d.value("reviewDone") === "true" ? "审核完成 · 演示" : "审片批注草案",
                  `${d.annotations.length} 条批注，当前纳入 ${included.length} 项。`,
                  ...d.annotations.map(
                    (note) =>
                      `${note.included ? "已纳入" : "未纳入"} · ${note.category} · ${mediaTimecode(note.start)}${note.end > note.start ? `–${mediaTimecode(note.end)}` : ""}\n${note.text}`,
                  ),
                  "当前只保存演示方案；真实执行器与费用服务未接入。",
                ].join("\n\n"),
              })
            }
          >
            详细信息
          </Button>
        }
      />
      <div className="v2-media-body v2-changes-body">
        <Card title="修改方案 · 待确认的建议" icon="review" className="v2-change-list">
          <select
            aria-label="批注分组"
            value={filter}
            onChange={(event) => {
              d.put("changeFilter", event.target.value);
              d.put("changeItemsScroll", "0");
            }}
          >
            <option value="">显示全部</option>
            {["剪辑节奏", "字幕", "音量", "画面表现"].map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
          <div
            className="v2-change-rows"
            data-scroll-region="change-items-scroll"
            aria-label="修改方案内容"
            tabIndex={0}
            onScroll={(event) => d.put("changeItemsScroll", String(event.currentTarget.scrollTop))}
            ref={(element) => {
              if (element) element.scrollTop = Number(d.value("changeItemsScroll", "0"));
            }}
          >
            {notes.map((note, index) => (
              <article className="v2-change-row" key={note.id}>
                <label>
                  <input
                    aria-label={`纳入方案 ${note.id}`}
                    type="checkbox"
                    checked={note.included}
                    onChange={() =>
                      d.setAnnotations((old) =>
                        old.map((item) =>
                          item.id === note.id ? { ...item, included: !item.included } : item,
                        ),
                      )
                    }
                  />
                  <strong>
                    {String(index + 1).padStart(2, "0")} {note.category}
                  </strong>
                  <span>{seconds(note.start)}</span>
                </label>
                <Pill>{note.category === "画面表现" ? "创建新候选" : `${note.category}优先`}</Pill>
                <p>{note.text}</p>
                <div className="v2-change-actions">
                  <button onClick={() => editChange(d, note)}>编辑方案</button>
                  <button
                    onClick={() =>
                      d.setEditor({
                        title: "影响范围",
                        description: `${mediaTimecode(note.start)}—${mediaTimecode(note.end)}\n修改类型：${note.category}\n保留其他镜头、角色身份、场景设定和现有候选。真实费用未知。`,
                      })
                    }
                  >
                    查看影响
                  </button>
                </div>
              </article>
            ))}
            {!notes.length && <p className="v2-media-muted">暂无匹配批注。返回审片添加意见。</p>}
          </div>
        </Card>
        <div className="v2-change-summary">
          <Card title="影响范围" icon="globe">
            <p>
              {d.annotations.length} 条批注，当前选择 {included.length} 项。修改方案仍在草稿阶段。
            </p>
            <p>保留未选中方案、其他对象和所有原版本。</p>
          </Card>
          <Card title="费用状态" icon="clock">
            <p>未连接费用服务。当前不产生费用；真实执行尚未接入。</p>
            <p>{d.tasks[0]?.status ?? "等待你的决定"}</p>
          </Card>
        </div>
      </div>
      <FlowFooter
        label="确认并执行"
        disabled
        reason="尚未接入执行器，方案可编辑保存"
        secondaryLabel="返回审片"
        secondaryAction={() => d.go("review")}
      />
    </>
  );
}
function V2ExportPage({ actions }: { actions: MediaActions }) {
  const { d } = actions;
  const checks = [
    ["媒体完整", "未就绪"],
    ["审片结论", d.value("reviewDone") === "true" ? "样例审片已完成" : "仅有样例"],
    ["素材权利", "需核验"],
    ["费用结算", "未接入"],
    ["输出规格", `${d.value("aspect", "16:9")} / 待生成母版`],
    ["具名用户批准", "尚未批准"],
  ];
  const settings = () =>
    d.edit("输出设置", [
      {
        key: "format",
        label: "格式",
        value: d.value("format", "MP4 (H.264)"),
        options: ["MP4 (H.264)", "MOV"],
      },
      {
        key: "resolution",
        label: "分辨率",
        value: d.value("resolution", "1920 × 1080"),
        options: ["1920 × 1080", "3840 × 2160"],
      },
      {
        key: "fps",
        label: "帧率",
        value: d.value("fps", "24 fps"),
        options: ["24 fps", "25 fps", "30 fps"],
      },
      {
        key: "captions",
        label: "字幕",
        value: d.value("captions", "内嵌字幕"),
        options: ["内嵌字幕", "独立字幕文件", "不含字幕"],
      },
    ]);
  return (
    <>
      <PageTitle
        actions={
          <Button
            onClick={() =>
              d.setEditor({
                title: "导出检查详情",
                presentation: "drawer",
                confirm: "关闭",
                description: [
                  "当前只有演示参考帧，没有可发布的成片母版。",
                  `${d.value("format", "MP4 (H.264)")} · ${d.value("resolution", "1920 × 1080")} · ${d.value("fps", "24 fps")}`,
                  ...checks.map(([label, value]) => `${label}：${value}`),
                  "真实生成与正式导出均未接入；查看详情不产生审批或发布记录。",
                ].join("\n\n"),
              })
            }
          >
            详细信息
          </Button>
        }
      />
      <div className="v2-media-body v2-export-body">
        <div className="v2-export-left">
          <ReferenceImage actions={actions} />
          <Card title="导出候选">
            <p>当前只是 UI 演示参考帧，没有可发布的成片母版。导出不是第六阶段。</p>
            <p>
              {d.value("format", "MP4 (H.264)")} · {d.value("resolution", "1920 × 1080")} ·{" "}
              {d.value("fps", "24 fps")}
            </p>
            <div className="v2-export-actions">
              <Button
                onClick={() =>
                  d.propose("导出草稿流程演示", "检查画幅、帧率与字幕，展示本地意图；不生成文件。")
                }
              >
                演示草稿导出
              </Button>
              <Button disabled title="没有真实输出目录或文件">
                打开目录 · 无输出
              </Button>
            </div>
          </Card>
        </div>
        <Card title="正式导出前检查" icon="review" className="v2-export-checks">
          <dl
            data-scroll-region="export-check-items-scroll"
            aria-label="导出检查内容"
            tabIndex={0}
            onScroll={(event) => d.put("exportCheckScroll", String(event.currentTarget.scrollTop))}
            ref={(element) => {
              if (element) element.scrollTop = Number(d.value("exportCheckScroll", "0"));
            }}
          >
            {checks.map(([key, value]) => (
              <div key={key}>
                <Icon name="review" size={18} />
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
      <FlowFooter
        label="批准并导出正式版"
        disabled
        action={() => d.notify("正式导出未接入")}
        reason="正式导出未接入，缺少成片母版"
        secondaryLabel="查看输出设置"
        secondaryAction={settings}
      />
    </>
  );
}

export function MediaPages() {
  const actions = useMediaActions();
  const modern = useModernTimeline();
  const { d, shot, select, editShot, mark } = actions;
  const preview = d.page === "storyboard",
    review = d.page === "review",
    generation = d.page === "generation",
    assembly = d.page === "assembly";
  if (d.page === "changes") return <V2ChangesPage />;
  if (d.page === "export") return <V2ExportPage actions={actions} />;
  return (
    <>
      <PageTitle
        actions={
          <>
            {review ? (
              <Button
                onClick={() =>
                  d.setEditor({
                    title: "版本信息",
                    description: `剪辑演示版本 v${d.value("editVersion", "1")}\n${d.shots.length} 个镜头，${mediaTimecode(d.total)} / 24 fps\n当前只有参考静帧，没有真实视频与音轨。`,
                  })
                }
              >
                版本信息
              </Button>
            ) : (
              <Button onClick={editShot}>镜头详情</Button>
            )}
          </>
        }
      />
      {preview ? (
        <div className={`v2-media-body v2-storyboard-body ${modern ? "v21-storyboard-body" : ""}`}>
          <div className="v2-media-selection">
            <Button onClick={() => d.go("scenes")}>
              场景 · {d.value("sceneName", "雨夜街道")}
            </Button>
            <select
              aria-label="当前分镜"
              value={shot.id}
              onChange={(event) => select(Number(event.target.value))}
            >
              {d.shots.map((item) => (
                <option key={item.id} value={item.id}>
                  镜头 {String(item.id).padStart(3, "0")}
                </option>
              ))}
            </select>
            <span>Animatic：分镜静帧预演</span>
          </div>
          <ReferenceImage actions={actions} />
          <MediaTimeline actions={actions} />
        </div>
      ) : review ? (
        <div className={`v2-media-body v2-review-body ${modern ? "v21-review-body" : ""}`}>
          <div className="v2-review-top">
            <ReviewPlayer actions={actions} />
            <ReviewNotes actions={actions} />
          </div>
          <MediaTimeline actions={actions} review />
        </div>
      ) : generation ? (
        <GenerationBody actions={actions} />
      ) : (
        <AssemblyBody actions={actions} />
      )}
      <FlowFooter
        secondaryLabel={
          review ? "返回制作" : generation ? "标记待调整" : preview ? "修改当前镜头" : "调整"
        }
        secondaryAction={
          review
            ? () => d.go("assembly")
            : generation
              ? mark
              : () => d.focusAssistant(`修改「Shot ${shot.id} · ${shot.name}」：`)
        }
        label={
          preview
            ? "确认分镜并进入制作"
            : generation
              ? "进入成片组装"
              : assembly
                ? "进入审片"
                : "审核完成 · 查看修改方案"
        }
        reason={
          preview
            ? `当前镜头 ${Math.round(shot.duration * FPS)} 帧 / 24 fps · 未生成正式视频`
            : generation
              ? "仅演示导航 · 视频服务未接入"
              : assembly
                ? "声音、字幕和视频是独立产物 · 仅展示样例"
                : `已记录 ${d.annotations.length} 条批注 · 尚未执行修改`
        }
        action={
          preview
            ? () => {
                d.put("animaticConfirmed", "true");
                d.go("generation");
              }
            : generation
              ? () => d.go("assembly")
              : assembly
                ? () => d.go("review")
                : () => {
                    d.put("reviewDone", "true");
                    d.go("changes");
                  }
        }
      />
    </>
  );
}
