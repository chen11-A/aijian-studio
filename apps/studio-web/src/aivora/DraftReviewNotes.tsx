import { useEffect, useState } from "react";
import { Button } from "./Common";
import { DraftReviewScope } from "./DraftReviewScope";
import { DraftReviewNoteList } from "./DraftReviewNoteList";
import { DraftReviewRevisionPlans } from "./DraftReviewRevisionPlans";
import type {
  DraftReviewRevisionExportGateway,
  DraftReviewRevisionGateway,
} from "./adapters/draftReviewRevision";
import type { DraftExportJob } from "./adapters/draftExport";
import { approximateFrame, reviewIdentity, type DraftReviewGateway } from "./adapters/draftReview";
import { useDraftReview } from "./useDraftReview";
import { useDraftReviewInput } from "./useDraftReviewInput";
import "./draft-review.css";

type Props = {
  job: DraftExportJob;
  gateway?: DraftReviewGateway;
  playbackSeconds?: number | null;
  revision?: DraftReviewRevisionGateway;
  exports?: DraftReviewRevisionExportGateway;
};
export function DraftReviewNotes(props: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return (
    <section className="draft-review" aria-label="当前草稿手工核对记录">
      <Button
        onClick={() => {
          setMounted(true);
          setOpen((value) => !value);
        }}
      >
        {open ? "收起手工核对记录" : "查看 / 添加手工核对记录"}
      </Button>
      <div hidden={!open}>
        {mounted &&
          (props.gateway ? (
            <ReviewEditor
              key={`${props.job.project_id}:${props.job.episode_id}:${props.job.operation_id}:${props.job.assembly_version_id}:${props.job.output_sha256}`}
              {...props}
              gateway={props.gateway}
            />
          ) : (
            <p role="alert">当前桌面版本尚未提供手工记录保存功能，请更新桌面版本。</p>
          ))}
      </div>
    </section>
  );
}
function ReviewEditor({
  job,
  gateway,
  playbackSeconds,
  revision,
  exports,
}: Props & { gateway: DraftReviewGateway }) {
  const state = useDraftReview(job, gateway);
  const draft = useDraftReviewInput(job);
  const { frame, text } = draft.input;
  const setFrame = (frame: string) => draft.edit({ frame });
  const setText = (text: string) => draft.edit({ text });
  const [localNotice, setLocalNotice] = useState("");
  useEffect(() => {
    const confirmed = state.confirmed;
    if (confirmed?.kind === "create" && text === confirmed.command.text) draft.edit({ text: "" });
    if (
      confirmed?.kind === "resolve" &&
      draft.input.noteId === confirmed.noteId &&
      draft.input.reason === confirmed.command.reason
    )
      draft.edit({ noteId: null, reason: "" });
  }, [state.confirmed]);
  const target = state.data?.target;
  const locked = state.busy || state.pending !== null || !target || draft.status === "INVALID";
  const frameNumber = frame.trim() === "" ? NaN : Number(frame);
  const validFrame =
    Number.isSafeInteger(frameNumber) &&
    frameNumber >= 0 &&
    !!target &&
    frameNumber < target.total_frames;
  const newId = (prefix: string) => {
    try {
      return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
    } catch {
      setLocalNotice("无法生成可靠记录标识，请重新打开桌面软件。");
      return null;
    }
  };
  const create = async () => {
    if (!target || locked || !validFrame || !text.trim() || !state.data?.output_verified) return;
    const noteId = newId("drn");
    if (!noteId) return;
    const saved = await state.submit({
      kind: "create",
      command: {
        ...reviewIdentity(target),
        note_id: noteId,
        frame_index: frameNumber,
        text,
      },
    });
    if (saved) setText("");
  };
  const resolve = async (noteId: string, reason: string) => {
    if (!target || locked || !reason.trim()) return false;
    const resolutionId = newId("drr");
    if (!resolutionId) return false;
    return state.submit({
      kind: "resolve",
      noteId,
      command: {
        ...reviewIdentity(target),
        resolution_id: resolutionId,
        expected_revision: 1,
        reason,
      },
    });
  };
  const capture = () => {
    if (!target || playbackSeconds === null || playbackSeconds === undefined) return;
    const captured = approximateFrame(playbackSeconds, target);
    if (captured === null) return;
    setFrame(String(captured));
    setLocalNotice("已按播放器时间估算帧号。播放器不保证逐帧精度，请核对并修正整数帧号后保存。");
  };
  return (
    <div className="draft-review-editor">
      <h4>手工核对记录 · 仅此 DRAFT 版本</h4>
      <p>评论及处理说明保存在当前项目和分集。处理评论不代表画面修正、版权通过或正式发布批准。</p>
      <Button disabled={state.busy} onClick={() => void state.load()}>
        重新读取手工记录
      </Button>
      {state.busy && <p role="status">正在核对与保存原版本记录…</p>}
      {state.notice && <p role="status">{state.notice}</p>}
      {localNotice && <p role="status">{localNotice}</p>}
      <p>未提交输入仅在本机按此导出版本缓存，尚未保存为手工记录。</p>
      {draft.status !== "READY" && (
        <p role="alert">未提交输入缓存不可用。请先提交或复制输入；离开此页可能丢失输入。</p>
      )}
      {draft.status === "INVALID" && (
        <p role="alert">缓存内容无法可靠读取；明确丢弃后才能编辑，不会自动覆盖。</p>
      )}
      <Button
        disabled={state.busy || !!state.pending}
        onClick={() => {
          if (window.confirm("丢弃此草稿版本的未提交输入？已保存的手工记录不受影响。"))
            draft.discard();
        }}
      >
        丢弃本机未提交输入
      </Button>
      {state.pending === undefined && (
        <p role="alert">本机恢复记录不可用，已暂停新增与处理评论。</p>
      )}
      {state.pending && (
        <div role="alert">
          <p>有一条提交结果待核对。新提交已暂停；重试沿用原标识，不会改成另一条记录。</p>
          <p className="draft-review-text">
            {state.pending.kind === "create"
              ? state.pending.command.text
              : state.pending.command.reason}
          </p>
          <Button
            disabled={state.busy || !target}
            onClick={() => state.pending && void state.submit(state.pending)}
          >
            核对并重试原提交
          </Button>
        </div>
      )}
      {target && state.data && (
        <>
          <DraftReviewScope data={state.data} />
          {draft.input.noteId &&
            draft.input.reason &&
            !state.data.notes.some(
              (note) => note.note_id === draft.input.noteId && note.revision === 1,
            ) && (
              <p role="alert" className="draft-review-text">
                原评论已处理或暂不可读；未提交处理说明仍保留在本机：{draft.input.reason}
              </p>
            )}
          <DraftReviewNoteList
            notes={state.data.notes}
            locked={locked}
            resolve={resolve}
            selected={draft.input.noteId}
            reason={draft.input.reason}
            select={(noteId) => draft.edit({ noteId })}
            setReason={(reason) => draft.edit({ reason })}
          />
          <DraftReviewRevisionPlans
            job={job}
            sourceTarget={state.data.target}
            notes={state.data.notes}
            notesReady={state.pending === null}
            gateway={revision}
            exports={exports}
          />
          <div className="draft-review-compose">
            <label>
              帧号（从 0 开始）
              <input
                type="number"
                min={0}
                max={target.total_frames - 1}
                step={1}
                value={frame}
                disabled={locked || !state.data.output_verified}
                onChange={(event) => setFrame(event.currentTarget.value)}
              />
            </label>
            <Button
              disabled={
                locked ||
                playbackSeconds === null ||
                playbackSeconds === undefined ||
                !state.data.output_verified
              }
              onClick={capture}
            >
              从播放位置估算帧号
            </Button>
            <p>
              有效帧号 0–{target.total_frames - 1}。保存以输入的整数帧为准；播放器时间只供近似定位。
            </p>
            <label>
              评论
              <textarea
                maxLength={2000}
                value={text}
                disabled={locked || !state.data.output_verified}
                onChange={(event) => setText(event.currentTarget.value)}
                placeholder="例如：核对动作衔接、构图或声音位置"
              />
            </label>
            <small>保存成功并读回后才会清除对应缓存。</small>
            <Button
              primary
              disabled={
                locked ||
                !validFrame ||
                !text.trim() ||
                text.includes("\0") ||
                !state.data.output_verified ||
                state.data.notes.length >= 500
              }
              onClick={() => void create()}
            >
              保存此帧手工评论
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
