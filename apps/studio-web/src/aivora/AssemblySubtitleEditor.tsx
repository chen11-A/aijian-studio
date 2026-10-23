import { useEffect, useState } from "react";
import { Button } from "./Common";
import { newAssemblySegmentId } from "./adapters/assemblyEditing";
import {
  SUBTITLE_PROFILE,
  subtitleTextProblem,
  scriptSubtitleText,
} from "./adapters/assemblySubtitles";
import type { SubtitleScriptRef } from "@aijian/contracts/assembly-script-provenance";
import { useConfirmedAssemblyScript } from "./useConfirmedAssemblyScript";
import type { AssemblyScriptGateway } from "./useAssemblyScriptSources";
import type { AssemblyContent, AssemblySubtitleSegment } from "./adapters/episodeMediaAssembly";
import "./assembly-subtitles.css";

import { Select } from "./Select";
type Fields = {
  id: string;
  text: string;
  start: string;
  end: string;
  scriptRef?: SubtitleScriptRef;
  sourceText?: string;
};
type Props = {
  content: AssemblyContent;
  frame: number;
  locked: boolean;
  onEdit(content: AssemblyContent): boolean;
  onPendingInput(pending: boolean): void;
  gateway?: AssemblyScriptGateway;
};
export function AssemblySubtitleEditor({
  content,
  frame,
  locked,
  onEdit,
  onPendingInput,
  gateway,
}: Props) {
  const confirmed = useConfirmedAssemblyScript(content.project_id, content.episode_id, gateway);
  const sourceKey = `${content.project_id}/${content.episode_id}/${confirmed.source.version?.version_id ?? ""}`;
  const [sourceChoice, setSourceChoice] = useState({ key: "", blockId: "" });
  const candidate =
    sourceChoice.key === sourceKey
      ? confirmed.source.dialogues.find((d) => d.block.block_id === sourceChoice.blockId)
      : undefined;
  const [form, setForm] = useState<Fields | null>(null);
  const [initial, setInitial] = useState<Fields | null>(null);
  const [notice, setNotice] = useState("");
  const dirty = !!form && (!initial || JSON.stringify(form) !== JSON.stringify(initial));
  useEffect(() => onPendingInput(dirty), [dirty, onPendingInput]);
  useEffect(() => {
    // Applied edits, undo and readback replace the form snapshot as one unit.
    setForm(null);
    setInitial(null);
    setNotice("");
    onPendingInput(false);
  }, [content, onPendingInput]);
  const reset = () => {
    setForm(null);
    setInitial(null);
    setNotice("");
    onPendingInput(false);
  };
  function begin(cue?: AssemblySubtitleSegment) {
    if (locked || (dirty && !window.confirm("放弃尚未应用的字幕输入吗？"))) return;
    const start = Math.max(0, Math.min(frame, content.total_frames - 1));
    const fields: Fields = cue
      ? {
          id: cue.segment_id,
          text: "text" in cue ? cue.text : "",
          start: String(cue.start_frame),
          end: String(cue.end_frame),
          ...("text" in cue && cue.script_ref
            ? { scriptRef: cue.script_ref, sourceText: cue.text }
            : {}),
        }
      : {
          id: newAssemblySegmentId(),
          text: "",
          start: String(start),
          end: String(
            Math.min(
              content.total_frames,
              start +
                Math.max(
                  1,
                  Math.round(
                    (2 * content.sequence_timebase.frame_rate.num) /
                      content.sequence_timebase.frame_rate.den,
                  ),
                ),
            ),
          ),
        };
    setForm(fields);
    setInitial(cue && "text" in cue ? fields : null);
    setNotice("");
  }
  function fromScript() {
    const source = confirmed.source.version;
    if (locked || !source || !candidate) return;
    const text = scriptSubtitleText(candidate.block.text);
    if (text === null) {
      setNotice(
        "此对白超出当前 草稿 字幕长度或字形范围；没有截断或替换。请在剧本中明确调整后另行确认。",
      );
      return;
    }
    if (
      form &&
      !window.confirm(
        "以所选已确认对白替换当前字幕输入？帧范围保留；旧保存版本保留，需应用后另行保存。",
      )
    )
      return;
    const start = Math.max(0, Math.min(frame, content.total_frames - 1));
    setForm({
      id: form?.id ?? newAssemblySegmentId(),
      text,
      start: form?.start ?? String(start),
      end:
        form?.end ??
        String(
          Math.min(
            content.total_frames,
            start +
              Math.max(
                1,
                Math.round(
                  (2 * content.sequence_timebase.frame_rate.num) /
                    content.sequence_timebase.frame_rate.den,
                ),
              ),
          ),
        ),
      scriptRef: {
        script_version_id: source.version_id,
        script_block_id: candidate.block.block_id,
        script_content_hash: source.content_hash,
      },
      sourceText: text,
    });
    setNotice("已将精确确认对白放入字幕输入。请核对帧范围并应用，再另行保存装配。");
  }
  function apply() {
    if (!form || locked) return;
    const problem = subtitleTextProblem(form.text);
    if (problem) {
      setNotice(problem);
      return;
    }
    const start_frame = form.start.trim() ? Number(form.start) : NaN;
    const end_frame = form.end.trim() ? Number(form.end) : NaN;
    if (
      !Number.isSafeInteger(start_frame) ||
      !Number.isSafeInteger(end_frame) ||
      start_frame < 0 ||
      end_frame <= start_frame ||
      end_frame > content.total_frames
    ) {
      setNotice("字幕入点、出点须为画面范围内的整数帧，且出点大于入点。");
      return;
    }
    const keepSource = !!form.scriptRef && form.text === form.sourceText;
    if (
      form.scriptRef &&
      !keepSource &&
      !window.confirm(
        "字幕文字已改变，明确转为手工文字并移除剧本来源？原版本保留；这一字幕不再计为该剧本对白。",
      )
    )
      return;
    const next = {
      segment_id: form.id,
      start_frame,
      end_frame,
      text: form.text,
      render_profile: SUBTITLE_PROFILE,
      ...(keepSource ? { script_ref: form.scriptRef } : {}),
    };
    const exists = content.subtitle_segments.some((cue) => cue.segment_id === form.id);
    if (
      onEdit({
        ...content,
        ...(keepSource && !content.script_provenance
          ? { script_provenance: { mode: "DRAFT" as const } }
          : {}),
        subtitle_segments: exists
          ? content.subtitle_segments.map((cue) => (cue.segment_id === form.id ? next : cue))
          : [...content.subtitle_segments, next],
      })
    )
      reset();
  }
  return (
    <details className="assembly-subtitles" open>
      <summary>字幕 · {content.subtitle_segments.length} 条</summary>
      <div className="assembly-subtitle-body">
        <p>
          固定 Noto Sans CJK SC 白字黑边，底部居中。每条最多两行、每行 28 字；支持基础汉字、ASCII
          和常用中文标点，暂不支持 emoji 或其他文字。最终样式以真实草稿 MP4 为准。
        </p>
        <Button disabled={locked || !content.total_frames} onClick={() => begin()}>
          添加文字字幕
        </Button>
        <label>
          已确认剧本字幕对白
          <Select
            value={sourceChoice.key === sourceKey ? sourceChoice.blockId : ""}
            disabled={locked || confirmed.source.state !== "ready" || !content.total_frames}
            onChange={(e) => setSourceChoice({ key: sourceKey, blockId: e.target.value })}
          >
            <option value="">选择精确已确认对白</option>
            {confirmed.source.dialogues.map((d) => (
              <option key={d.block.block_id} value={d.block.block_id}>
                {d.block.speaker}：{d.block.text}
              </option>
            ))}
          </Select>
        </label>
        <Button disabled={locked || !candidate || !content.total_frames} onClick={fromScript}>
          将所选剧本对白设为字幕
        </Button>
        <Button
          disabled={locked || confirmed.source.state === "loading"}
          onClick={confirmed.refresh}
        >
          核对字幕剧本确认
        </Button>
        {confirmed.source.state === "error" && (
          <p role="status">字幕确认来源未可靠读回；现有字幕与未保存输入保留。</p>
        )}
        {!content.total_frames && <p>请先加入画面，再设置字幕范围。</p>}
        <ol className="assembly-subtitle-list" aria-label="字幕片段">
          {content.subtitle_segments.map((cue) => (
            <li key={cue.segment_id}>
              <strong>{"text" in cue ? cue.text : "旧版剧本绑定字幕（尚无固定文字）"}</strong>
              <span>
                {cue.start_frame}–{cue.end_frame} 帧 · 左闭右开
              </span>
              {"text" in cue && cue.script_ref && (
                <p>
                  剧本来源：{cue.script_ref.script_version_id} / {cue.script_ref.script_block_id} ·{" "}
                  {cue.script_ref.script_content_hash}
                </p>
              )}
              {!("text" in cue) && (
                <p>此绑定暂不能编码。可明确输入文字替换；历史装配版本保留原剧本引用。</p>
              )}
              <div className="assembly-actions">
                <Button disabled={locked} onClick={() => begin(cue)}>
                  {"text" in cue ? "编辑字幕" : "转换为文字字幕"}
                </Button>
                <Button
                  disabled={locked || dirty}
                  onClick={() => {
                    if (
                      onEdit({
                        ...content,
                        subtitle_segments: content.subtitle_segments.filter(
                          (item) => item.segment_id !== cue.segment_id,
                        ),
                      }) &&
                      form?.id === cue.segment_id
                    )
                      reset();
                  }}
                >
                  删除字幕
                </Button>
              </div>
            </li>
          ))}
        </ol>
        {form && (
          <form
            className="assembly-subtitle-form"
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            {form.scriptRef && (
              <p>
                固定剧本：{form.scriptRef.script_version_id} / {form.scriptRef.script_block_id}
                。帧编辑保留来源，文字编辑需明确转为手工字幕。
              </p>
            )}
            <label className="assembly-subtitle-text">
              字幕文字
              <textarea
                rows={3}
                value={form.text}
                disabled={locked}
                onChange={(event) => setForm({ ...form, text: event.target.value })}
              />
            </label>
            <label>
              字幕入点（帧）
              <input
                type="number"
                step={1}
                min={0}
                required
                value={form.start}
                disabled={locked}
                onChange={(event) => setForm({ ...form, start: event.target.value })}
              />
            </label>
            <label>
              字幕出点（不含此帧）
              <input
                type="number"
                step={1}
                min={1}
                max={content.total_frames}
                required
                value={form.end}
                disabled={locked}
                onChange={(event) => setForm({ ...form, end: event.target.value })}
              />
            </label>
            <div className="assembly-actions">
              <button type="submit" className="button" disabled={locked || !dirty}>
                应用字幕
              </button>
              <Button disabled={locked} onClick={reset}>
                放弃字幕输入
              </Button>
            </div>
            {dirty && (
              <p>
                字幕输入尚未应用。先应用或放弃，再保存本集装配；应用后仍需保存版本才能进入草稿 MP4。
              </p>
            )}
          </form>
        )}
        {notice && <p role="alert">{notice}</p>}
        <p>
          字幕使用序列整数帧，不随画面移动；单次草稿最多编码 128
          条，范围不能重叠。固定样式与字体校验值会写入本地导出证据。
        </p>
      </div>
    </details>
  );
}
