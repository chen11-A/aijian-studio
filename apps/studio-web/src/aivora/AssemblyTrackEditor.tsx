import { Button } from "./Common";
import { frameTimecode } from "./timeline-model";
import {
  assemblySeconds,
  findAssemblyAsset,
  reflowVisual,
  splitAssemblySegment,
} from "./adapters/assemblyEditing";
import type { AssemblySegment } from "./adapters/assemblyEditing";
import type { MediaAsset } from "./adapters/assetLibrary";
import type { AssemblyContent } from "./adapters/episodeMediaAssembly";

type Props = {
  content: AssemblyContent;
  library: MediaAsset[] | null;
  selected: string;
  frame: number;
  locked: boolean;
  sampleRate?: number;
  onSelect(id: string, frame: number): void;
  onFrame(frame: number): void;
  onEdit(content: AssemblyContent): boolean;
  onNotice(message: string): void;
  newId(): string;
};
export function AssemblyTrackEditor({
  content,
  library,
  selected,
  frame,
  locked,
  sampleRate,
  onSelect,
  onFrame,
  onEdit,
  onNotice,
  newId,
}: Props) {
  const segments: AssemblySegment[] = [...content.visual_segments, ...content.audio_segments];
  const current = segments.find((segment) => segment.segment_id === selected);
  const rate = content.sequence_timebase.frame_rate;
  const timecode = (value: number) =>
    frameTimecode(value, rate.num / rate.den, content.sequence_timebase.timecode_mode);
  const visualIndex = content.visual_segments.findIndex((item) => item.segment_id === selected);
  const canSplit =
    current &&
    frame > current.start_frame &&
    frame < current.end_frame &&
    ("media_kind" in current || !!sampleRate);
  function move(direction: number) {
    if (locked || visualIndex < 0) return;
    const target = visualIndex + direction;
    const next = [...content.visual_segments];
    const item = next[visualIndex],
      other = next[target];
    if (!item || !other) return;
    next[visualIndex] = other;
    next[target] = item;
    const changed = reflowVisual(content, next);
    if (onEdit(changed))
      onSelect(item.segment_id, changed.visual_segments[target]?.start_frame ?? 0);
  }
  function remove() {
    if (!current || locked) return;
    const next =
      "media_kind" in current
        ? reflowVisual(
            content,
            content.visual_segments.filter((item) => item.segment_id !== selected),
          )
        : {
            ...content,
            audio_segments: content.audio_segments.filter((item) => item.segment_id !== selected),
          };
    if (onEdit(next)) onSelect("", 0);
  }
  function trim(form: HTMLFormElement) {
    if (!current || locked) return;
    const values = new FormData(form);
    const number = (key: string) => {
      const value = String(values.get(key) ?? "");
      return value.trim() ? Number(value) : NaN;
    };
    const duration = number("duration");
    const next =
      "media_kind" in current
        ? reflowVisual(
            content,
            content.visual_segments.map((item) =>
              item.segment_id === selected
                ? {
                    ...item,
                    end_frame: item.start_frame + duration,
                    source_in_frame: item.media_kind === "video" ? number("source") : 0,
                    embedded_audio:
                      item.media_kind === "video" && values.get("embedded") === "on"
                        ? "PLAY"
                        : "MUTE",
                  }
                : item,
            ),
          )
        : {
            ...content,
            audio_segments: content.audio_segments.map((item) =>
              item.segment_id === selected
                ? {
                    ...item,
                    start_frame: number("start"),
                    end_frame: number("start") + duration,
                    source_in_sample: number("source"),
                  }
                : item,
            ),
          };
    onEdit(next);
  }
  return (
    <section className="assembly-tracks" aria-label="集级剪辑轨道">
      <div className="assembly-position">
        <label>
          剪切位置（序列帧）
          <input
            type="number"
            min={0}
            max={Math.max(0, content.total_frames - 1)}
            step={1}
            value={frame}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isSafeInteger(next))
                onFrame(Math.max(0, Math.min(content.total_frames - 1, next)));
            }}
          />
        </label>
        <span>
          {timecode(frame)} · {assemblySeconds(frame, content).toFixed(3)} 秒
        </span>
        <input
          aria-label="剪切位置时间轴"
          type="range"
          min={0}
          max={Math.max(0, content.total_frames - 1)}
          step={1}
          value={frame}
          disabled={!content.total_frames}
          onChange={(event) => onFrame(Number(event.target.value))}
        />
      </div>
      {([content.visual_segments, content.audio_segments] as const).map((track, index) => (
        <section key={index}>
          <h3>{index === 0 ? "V1 · 画面剪切轨" : "A · 音频片段"}</h3>
          {!track.length && (
            <p>
              {index === 0
                ? "尚无画面，选择图片或视频加入。"
                : "可在已有画面范围内加入 BGM / SFX。"}
            </p>
          )}
          <ol className="assembly-segments" aria-label={index === 0 ? "画面片段" : "音频片段"}>
            {track.map((segment) => (
              <li key={segment.segment_id}>
                <button
                  type="button"
                  aria-pressed={selected === segment.segment_id}
                  onClick={() => onSelect(segment.segment_id, segment.start_frame)}
                >
                  <strong>
                    {"media_kind" in segment
                      ? segment.media_kind === "video"
                        ? "视频"
                        : "图片"
                      : segment.track_kind}{" "}
                    ·{" "}
                    {findAssemblyAsset(library, segment.media)?.filename ??
                      segment.media.asset_version_id}
                  </strong>
                  <span>
                    {segment.start_frame}–{segment.end_frame} 帧 · {timecode(segment.start_frame)} →{" "}
                    {timecode(segment.end_frame)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {current && (
        <section className="assembly-inspector" aria-label="所选片段编辑">
          <h3>
            片段裁剪 · {findAssemblyAsset(library, current.media)?.filename ?? current.segment_id}
          </h3>
          <form
            key={JSON.stringify(current)}
            onSubmit={(event) => {
              event.preventDefault();
              trim(event.currentTarget);
            }}
          >
            {!("media_kind" in current) && (
              <label>
                序列入点（帧）
                <input
                  name="start"
                  type="number"
                  min={0}
                  max={content.total_frames - 1}
                  step={1}
                  required
                  defaultValue={current.start_frame}
                  disabled={locked}
                />
              </label>
            )}
            {!("media_kind" in current && current.media_kind === "image") && (
              <label>
                {"media_kind" in current ? "视频源入点（帧）" : "音频源入点（采样）"}
                <input
                  name="source"
                  type="number"
                  min={0}
                  step={1}
                  required
                  defaultValue={
                    "source_in_frame" in current
                      ? current.source_in_frame
                      : current.source_in_sample
                  }
                  disabled={locked}
                />
              </label>
            )}
            <label>
              片段时长（帧）
              <input
                name="duration"
                type="number"
                min={1}
                max={1_000_000}
                step={1}
                required
                defaultValue={current.end_frame - current.start_frame}
                disabled={locked}
              />
            </label>
            {"media_kind" in current && current.media_kind === "video" && (
              <label className="assembly-checkbox">
                <input
                  name="embedded"
                  type="checkbox"
                  defaultChecked={current.embedded_audio === "PLAY"}
                  disabled={locked}
                />
                保留视频原声
              </label>
            )}
            <button className="button" type="submit" disabled={locked}>
              应用裁剪
            </button>
          </form>
          <div className="assembly-actions">
            <Button
              disabled={locked || !canSplit}
              onClick={() => {
                const next = splitAssemblySegment(content, selected, frame, newId(), sampleRate);
                if (next) onEdit(next);
                else onNotice("请选择片段内的整数帧；音频分割需要已核验的源采样率。");
              }}
            >
              在此帧分割
            </Button>
            {visualIndex >= 0 && (
              <>
                <Button disabled={locked || visualIndex === 0} onClick={() => move(-1)}>
                  向前移动
                </Button>
                <Button
                  disabled={locked || visualIndex === content.visual_segments.length - 1}
                  onClick={() => move(1)}
                >
                  向后移动
                </Button>
              </>
            )}
            <Button disabled={locked} onClick={remove}>
              删除所选片段
            </Button>
          </div>
          {!("media_kind" in current) && (
            <p>
              {sampleRate
                ? `源采样率 ${sampleRate} Hz，分割按此采样率取最近整数采样。`
                : "源采样率尚未核验，暂不能自动分割音频。可调整整数采样入点和序列范围；选择 WAV 原件预览可读取其采样率。"}
            </p>
          )}
        </section>
      )}
      <p>
        范围采用左闭右开整数帧。画面移动、裁剪和删除会拼接
        V1；声音和字幕保持原序列位置，不自动跟随。视频源帧率需与序列一致，探测未完成前只保存剪辑决定。
      </p>
    </section>
  );
}
