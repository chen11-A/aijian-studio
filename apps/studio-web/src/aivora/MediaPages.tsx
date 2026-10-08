import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useDemo, moveShot, shotAtTime } from "./model";
import type { Annotation } from "./model";
import { art, seconds } from "./data";
import reviewCity from "./assets/v2/city.png";
import { Button, FlowFooter, PageTitle, Pill } from "./Common";
import { Icon } from "./Icon";
import "./v2-media.css";
import { TimelineWorkbench } from "./TimelineWorkbench";
import { DevelopmentExportPanel } from "./DevelopmentExportPanel";
import { DevelopmentMediaPanel } from "./DevelopmentMediaPanel";
import { getDevelopmentTimelineSnapshot } from "./adapters/developmentTimeline";
import { createStudioTransport } from "../api/studio";
import { EpisodeMediaAssemblyPanel } from "./EpisodeMediaAssemblyPanel";
import { MltPreviewPanel } from "./MltPreviewPanel";

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
  const { d, shot, seek, select, addShot, annotate } = actions;
  const dragShot = useRef<number | null>(null);
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
    <>
      <DevelopmentMediaPanel key={d.backendProjectId ?? "no-project"} />
      <div className="v2-media-body v2-generation-body">
      <div className="v2-media-selection">
        <ProductionTabs generation />
        <span className="v2-media-amber">正式视频未接入 · 本地 Fake 仅开发用途</span>
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
    </>
  );
}
function AssemblyBody({ actions }: { actions: MediaActions }) {
  const { d } = actions;
  const workspace = d.timelineWorkspace;
  const controller = d.timelineWorkspaceController;
  const [trimDraft, setTrimDraft] = useState<{
    clipId: string;
    revision: number;
    sourceIn: number;
    duration: number;
    replacementAssetId: string;
  } | null>(null);
  const dragClip = useRef<string | null>(null);
  const tracks = d.professional
    ? ["V1 画面", "A1 对白", "A2 音乐", "A3 环境", "S1 字幕"]
    : ["视频", "对白", "字幕"];
  const response = workspace.kind === "ready" ? workspace.response : null;
  const timeline = response?.data.timeline;
  const selectedClipId = workspace.kind === "ready" ? workspace.selectedClipId : null;
  const selected = timeline?.clips.find((clip) => clip.clip_id === selectedClipId) ?? null;
  const draftMatchesSelection = !!(
    selected &&
    timeline &&
    trimDraft?.clipId === selected.clip_id &&
    trimDraft.revision === timeline.revision
  );
  const activeDraft = draftMatchesSelection ? trimDraft : null;
  const sourceIn = activeDraft?.sourceIn ?? selected?.source_in_frame ?? 0;
  const duration = activeDraft?.duration ?? selected?.duration_frames ?? 1;
  const replacementAssetId = activeDraft?.replacementAssetId ?? selected?.asset_id ?? "";
  useLayoutEffect(() => {
    setTrimDraft(null);
  }, [
    selected?.clip_id,
    selected?.source_in_frame,
    selected?.duration_frames,
    selected?.asset_id,
    timeline,
  ]);
  const updateTrimDraft = (
    updates: Partial<{ sourceIn: number; duration: number; replacementAssetId: string }>,
  ) => {
    if (!selected || !timeline) return;
    setTrimDraft({
      clipId: selected.clip_id,
      revision: timeline.revision,
      sourceIn,
      duration,
      replacementAssetId,
      ...updates,
    });
  };
  const selectedAsset =
    timeline?.assets.find((asset) => asset.asset_id === selected?.asset_id) ?? null;
  const sourceLimit = selectedAsset ? selectedAsset.source_frame_count - sourceIn : -1;
  const replacementAsset =
    timeline?.assets.find((asset) => asset.asset_id === replacementAssetId) ?? null;
  const replacementCanFit = !!(
    selected &&
    replacementAsset &&
    Number.isInteger(sourceIn) &&
    sourceIn >= 0 &&
    sourceIn + selected.duration_frames <= replacementAsset.source_frame_count
  );
  const status = !d.backendProjectId
    ? "尚未连接本地项目，无法读取真实时间线。"
    : workspace.kind === "loading"
      ? "正在读取真实时间线…"
      : workspace.kind === "empty"
        ? "时间线尚未生成；完成分镜和素材后可在此编辑。"
        : workspace.kind === "error"
          ? "无法读取真实时间线。请确认本地创作引擎在线后重试。"
          : null;
  const runReorder = (clipId: string, newIndex: number) => {
    if (!timeline || workspace.saving || newIndex < 0 || newIndex >= timeline.clips.length) return;
    controller.selectClip(clipId);
    void controller.reorder({
      clip_id: clipId,
      new_index: newIndex,
      expected_revision: timeline.revision,
    });
  };
  const timelineTracks = timeline && response && (
    <div className="v2-assembly-track-list">
      {tracks.map((name, index) => (
        <div key={name}>
          <span>{name}</span>
          <div className="v2-assembly-track-targets">
            {index === 0 ? (
              timeline.clips.map((clip, clipIndex) => (
                <button
                  style={{ flexGrow: clip.duration_frames }}
                  className={clip.clip_id === selectedClipId ? "selected" : ""}
                  key={clip.clip_id}
                  aria-label={`${name}镜头 ${clipIndex + 1} ${clip.clip_id}`}
                  aria-pressed={clip.clip_id === selectedClipId}
                  title={`${clip.clip_id} · ${clip.duration_frames} 帧`}
                  draggable={!workspace.saving}
                  disabled={workspace.saving}
                  onClick={() => controller.selectClip(clip.clip_id)}
                  onDragStart={() => {
                    controller.selectClip(clip.clip_id);
                    dragClip.current = clip.clip_id;
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    const source = dragClip.current;
                    if (source) runReorder(source, clipIndex);
                    dragClip.current = null;
                  }}
                  onKeyDown={(event) => {
                    if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                    event.preventDefault();
                    runReorder(clip.clip_id, clipIndex + (event.key === "ArrowLeft" ? -1 : 1));
                  }}
                >
                  <span className="v21-shot-label">
                    {String(clipIndex + 1).padStart(2, "0")} · {clip.clip_id}
                  </span>
                </button>
              ))
            ) : (
              <p className="v2-media-muted">{name}轨尚未接入真实素材</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div
      className={`v2-media-body v2-assembly-body v21-assembly-body ${d.professional ? "v2-assembly-pro" : ""}`}
    >
      <div className="v2-media-selection">
        <ProductionTabs generation={false} />
        <Button onClick={() => d.go("voice")}>声音与字幕</Button>
        <Button onClick={() => d.go("export")}>开发 MP4 导出</Button>
      </div>
      <section className="v2-assembly-tracks">
        <header>
          <h2>{d.professional ? "多轨组装" : "单一成片时间线"}</h2>
          <div>
            {timeline && <span>修订版 {timeline.revision}</span>}
            {d.backendProjectId && (
              <button disabled={workspace.saving} onClick={() => void controller.reload()}>
                重新读取
              </button>
            )}
          </div>
        </header>
        {status && (
          <div role={workspace.kind === "error" ? "alert" : "status"} className="v2-media-muted">
            <p>{status}</p>
            {workspace.kind === "error" && (
              <Button onClick={() => void controller.reload()}>重新读取</Button>
            )}
          </div>
        )}
        {workspace.kind === "ready" && timeline && response && (
          <>
            <div className="v2-assembly-inspector" aria-label="真实镜头检查器">
              <span>{selected?.clip_id ?? "未选择镜头"}</span>
              <label>
                源入点（帧）
                <input
                  aria-label="源入点（帧）"
                  type="number"
                  min={0}
                  max={selectedAsset?.source_frame_count ?? 0}
                  value={sourceIn}
                  disabled={workspace.saving || !selected}
                  onChange={(event) =>
                    updateTrimDraft({
                      sourceIn: Math.max(0, Math.round(Number(event.target.value))),
                    })
                  }
                />
              </label>
              <label>
                持续（帧）
                <input
                  aria-label="持续（帧）"
                  type="number"
                  min={1}
                  max={Math.max(1, sourceLimit)}
                  value={duration}
                  disabled={workspace.saving || !selected}
                  onChange={(event) =>
                    updateTrimDraft({
                      duration: Math.max(1, Math.round(Number(event.target.value))),
                    })
                  }
                />
              </label>
              <Button
                disabled={
                  workspace.saving ||
                  !selected ||
                  !Number.isInteger(sourceIn) ||
                  !Number.isInteger(duration) ||
                  duration > sourceLimit
                }
                onClick={() =>
                  selected &&
                  void controller.trim({
                    clip_id: selected.clip_id,
                    new_source_in_frame: sourceIn,
                    new_duration_frames: duration,
                    expected_revision: timeline.revision,
                  })
                }
              >
                应用裁剪
              </Button>
              <label>
                替换素材
                <select
                  aria-label="替换素材"
                  disabled={workspace.saving || !selected}
                  value={replacementAssetId}
                  onChange={(event) => updateTrimDraft({ replacementAssetId: event.target.value })}
                >
                  {timeline.assets.map((asset) => (
                    <option key={asset.asset_id} value={asset.asset_id}>
                      {asset.asset_id}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={
                  workspace.saving ||
                  !selected ||
                  replacementAssetId === selected?.asset_id ||
                  !replacementCanFit
                }
                onClick={() =>
                  selected &&
                  void controller.replace({
                    clip_id: selected.clip_id,
                    replacement_asset_id: replacementAssetId,
                    replacement_source_in_frame: sourceIn,
                    expected_revision: timeline.revision,
                  })
                }
              >
                替换当前素材
              </Button>
            </div>
            {workspace.notice && <p role="alert">{workspace.notice}</p>}
            <TimelineWorkbench
              seek={(seconds) => d.setTime(seconds)}
              gutter={64}
              timeline={{
                totalFrames: response.data.total_duration_frames,
                frame: Math.round(
                  (d.time * timeline.sequence_timebase.frame_rate.num) /
                    timeline.sequence_timebase.frame_rate.den,
                ),
                frameRate: timeline.sequence_timebase.frame_rate,
                timecodeMode: timeline.sequence_timebase.timecode_mode,
                clipEndFrames: timeline.clips.reduce<number[]>(
                  (ends, clip) => [...ends, (ends.at(-1) ?? 0) + clip.duration_frames],
                  [],
                ),
              }}
            >
              {timelineTracks}
            </TimelineWorkbench>
          </>
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
function InvalidationHistory({ d }: { d: ReturnType<typeof useDemo> }) {
  const history = d.invalidationHistory;
  const rows = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!history.selectedOperationId && history.lastSelectedOperationId)
      rows.current.get(history.lastSelectedOperationId)?.focus();
  }, [history.lastSelectedOperationId, history.selectedOperationId]);
  if (!d.backendProjectId)
    return <p className="v2-media-muted">尚未连接本地项目，无法读取真实影响报告。</p>;
  if (history.detail !== "idle") {
    const operationId = history.selectedOperationId!;
    return (
      <div className="v2-invalidation-detail" aria-label="影响报告详情">
        <Button onClick={() => d.invalidationHistoryController.backToList()}>返回影响报告</Button>
        {history.detail === "loading" && <p role="status">正在读取报告详情…</p>}
        {history.detail === "error" && (
          <div role="alert">
            <p>{history.detailError}</p>
            <Button onClick={() => void d.invalidationHistoryController.select(operationId)}>
              重新读取报告
            </Button>
          </div>
        )}
        {history.detail === "ready" && (
          <>
            <p>报告编号 · {history.operation!.operation_id}</p>
            {history.operation!.paths.length === 0 ? (
              <p>本次没有下游影响路径</p>
            ) : (
              <ul>
                {history.operation!.paths.map((path) => (
                  <li key={path.path_id}>
                    影响类别：{path.classification} · 影响结果：{path.effective_impact} · 关联产物：
                    {path.affected_artifact_id}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="v2-invalidation-history" aria-label="影响报告">
      {history.list === "loading" && <p role="status">正在读取影响报告…</p>}
      {history.list === "error" && (
        <div role="alert">
          <p>{history.listError}</p>
          <Button onClick={() => void d.invalidationHistoryController.loadInitial()}>
            重新读取
          </Button>
        </div>
      )}
      {history.list === "ready" && history.items.length === 0 && <p>暂无影响报告</p>}
      {history.items.map((item) => (
        <button
          key={item.operation_id}
          ref={(element) => {
            if (element) rows.current.set(item.operation_id, element);
            else rows.current.delete(item.operation_id);
          }}
          onClick={() => void d.invalidationHistoryController.select(item.operation_id)}
        >
          内容版本发生变更 · {item.reason_path_count} 条影响路径
        </button>
      ))}
      {history.more === "error" && (
        <div role="alert">
          <p>{history.moreError}</p>
          <Button onClick={() => void d.invalidationHistoryController.loadMore()}>
            重新加载更多
          </Button>
        </div>
      )}
      {history.nextCursor !== null && history.more !== "error" && (
        <Button
          disabled={history.more === "loading"}
          onClick={() => void d.invalidationHistoryController.loadMore()}
        >
          {history.more === "loading" ? "正在读取…" : "加载更多"}
        </Button>
      )}
    </div>
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
          <Card title="真实影响报告" icon="review" className="v2-change-history">
            <InvalidationHistory d={d} />
          </Card>
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
    d.edit("正式导出样例设置（未接入）", [
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
      <DevelopmentExportPanel
        key={d.backendProjectId ?? "no-project"}
        projectId={d.backendProjectId}
        timeline={getDevelopmentTimelineSnapshot(d.backendProjectId, d.timelineWorkspace)}
      />
      <div className="v2-media-body v2-export-body">
        <div className="v2-export-left">
          <ReferenceImage actions={actions} />
          <Card title="正式导出样例（未接入）">
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
        <Card title="正式导出前检查（未接入）" icon="review" className="v2-export-checks">
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
        secondaryLabel="查看正式导出样例设置"
        secondaryAction={settings}
      />
    </>
  );
}

export function MediaPages() {
  const d = useDemo();
  const actions = useMediaActions();
  const transport = useMemo(createStudioTransport, []);
  if (d.page === "assembly" && !d.isFixture &&
      (!d.backendProjectId || !d.selectedEpisodeId)) {
    return <>
      <PageTitle />
      <section className="v2-media-body" role="status">
        <p>请先在项目页选择真实项目和剧集，再读取该集的媒体装配。</p>
        <Button onClick={() => d.go("project")}>选择项目和剧集</Button>
      </section>
    </>;
  }
  if (d.page === "assembly" && d.backendProjectId && d.selectedEpisodeId && !d.isFixture) {
    return <>
      <PageTitle />
      <div className="v2-media-body">
        <EpisodeMediaAssemblyPanel key={`${d.backendProjectId}/${d.selectedEpisodeId}`}
          projectId={d.backendProjectId} episodeId={d.selectedEpisodeId}
          assets={transport.assetLibrary} assembly={transport.episodeMediaAssembly} />
        <MltPreviewPanel key={`mlt/${d.backendProjectId}/${d.selectedEpisodeId}`}
          projectId={d.backendProjectId} episodeId={d.selectedEpisodeId}
          identity={null} totalFrames={null} gateway={undefined} />
      </div>
      <FlowFooter secondaryLabel="返回项目素材" secondaryAction={() => d.go("assets")}
        label="正式审片待接入" disabled
        reason="当前只有集级草稿预演；声音、字幕、正式审片与导出尚未接入" />
    </>;
  }
  if (d.page === "changes") return <V2ChangesPage />;
  if (!d.shots.length && ["storyboard", "review"].includes(d.page)) {
    return (
      <section className="v2-media-body">
        <h1>
          {d.page === "review" ? "审片" : d.page === "export" ? "成片预览与导出" : "分镜与制作"}
        </h1>
        <p>尚未从已确认的故事资料读取镜头；相关能力也尚未接入。</p>
      </section>
    );
  }
  if (!d.shots.length && d.page === "generation") {
    return (
      <>
        <PageTitle />
        <div className="v2-media-body">
          <div className="v2-media-selection"><ProductionTabs generation /></div>
          <DevelopmentMediaPanel key={d.backendProjectId ?? "no-project"} />
        </div>
      </>
    );
  }
  if (!d.shots.length && d.page === "export") {
    return (
      <>
        <PageTitle />
        <DevelopmentExportPanel
          key={d.backendProjectId ?? "no-project"}
          projectId={d.backendProjectId}
          timeline={getDevelopmentTimelineSnapshot(d.backendProjectId, d.timelineWorkspace)}
        />
        <p className="v2-media-muted">正式导出尚未接入；开发 MP4 使用真实时间线和本地 Fake 素材。</p>
        <Button onClick={() => d.go("assembly")}>返回真实时间线</Button>
      </>
    );
  }
  const { shot, select, editShot, mark } = actions;
  const preview = d.page === "storyboard",
    review = d.page === "review",
    generation = d.page === "generation",
    assembly = d.page === "assembly";
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
            ) : shot ? (
              <Button onClick={editShot}>镜头详情</Button>
            ) : null}
          </>
        }
      />
      {preview ? (
        <div className="v2-media-body v2-storyboard-body v21-storyboard-body">
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
        <div className="v2-media-body v2-review-body v21-review-body">
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
          review ? "返回制作" : generation ? "标记待调整" : preview ? "修改当前镜头" :
            !shot ? "返回本地 Fake 任务" : "调整"
        }
        secondaryAction={
          review
            ? () => d.go("assembly")
            : generation
              ? mark
              : !shot
                ? () => d.go("generation")
              : () => shot && d.focusAssistant(`修改「Shot ${shot.id} · ${shot.name}」：`)
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
              ? "本地 Fake 任务请在页面内提交与查询；正式视频未接入"
              : assembly
                ? "真实时间线见当前读回；声音、字幕和内嵌播放尚未接入"
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
