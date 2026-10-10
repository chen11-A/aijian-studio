import { useEffect, useRef, useState } from "react";
import { Button } from "./Common";
import { DraftReviewRevisionPlayback } from "./DraftReviewRevisionPlayback";
import type { DraftExportJob } from "./adapters/draftExport";
import { draftJobMatches } from "./adapters/draftExport";
import type { DraftReviewNote, DraftReviewTarget } from "./adapters/draftReview";
import {
  eligibleRevisionCandidate,
  pendingRevisionMatches,
  revisionIdentity,
  revisionText,
  sameRevisionSelectionOrder,
  type DraftReviewRevisionCandidateEntry,
  type DraftReviewRevisionExportGateway,
  type DraftReviewRevisionGateway,
  type DraftReviewRevisionPlanEntry,
  type DraftReviewRevisionSegment,
  type DraftReviewRevisionSource,
  type PendingRevision,
} from "./adapters/draftReviewRevision";
import { useDraftReviewRevision } from "./useDraftReviewRevision";
import { useDraftReviewRevisionInput } from "./useDraftReviewRevisionInput";
import "./draft-review-revision.css";

type Props = {
  job: DraftExportJob;
  sourceTarget?: DraftReviewTarget;
  notes: DraftReviewNote[];
  notesReady?: boolean;
  gateway?: DraftReviewRevisionGateway;
  exports?: DraftReviewRevisionExportGateway;
};
type RevisionState = ReturnType<typeof useDraftReviewRevision>;
type InputState = ReturnType<typeof useDraftReviewRevisionInput>;
function newId(
  prefix: "drp" | "dra" | "drc" | "drk",
  notify: (text: string) => void,
): string | null {
  try {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  } catch {
    notify("无法生成可靠记录标识，请重新打开桌面软件。");
    return null;
  }
}
export function DraftReviewRevisionPlans(props: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const identity = props.sourceTarget ?? props.job;
  return (
    <section className="draft-review-revision" aria-label="当前草稿人工修改计划">
      <Button
        onClick={() => {
          setMounted(true);
          setOpen((value) => !value);
        }}
      >
        {open ? "收起人工修改计划" : "查看 / 建立人工修改计划"}
      </Button>
      <div hidden={!open}>
        {mounted &&
          (props.gateway ? (
            <RevisionEditor
              key={`${identity.project_id}:${identity.episode_id}:${identity.operation_id}:${identity.assembly_version_id}:${identity.assembly_content_hash}:${identity.output_sha256}:${identity.output_bytes}`}
              {...props}
              gateway={props.gateway}
            />
          ) : (
            <p role="alert">当前桌面版本尚未提供人工修改计划保存能力，请更新桌面版本。</p>
          ))}
      </div>
    </section>
  );
}
function InputRecovery({ draft, locked }: { draft: InputState; locked: boolean }) {
  return (
    <>
      {draft.status === "INVALID" && (
        <p role="alert">本机未提交输入无法可靠读取，明确丢弃后才能编辑；不会自动覆盖。</p>
      )}
      {draft.status === "UNAVAILABLE" && (
        <p role="alert">本机未提交输入缓存不可用，请保存或复制文字后再离开。</p>
      )}
      <Button
        disabled={locked}
        onClick={() => {
          if (window.confirm("丢弃此处本机未提交输入？已保存的计划与记录会保留。")) draft.discard();
        }}
      >
        丢弃此处未提交输入
      </Button>
    </>
  );
}
function PendingEvidence({ pending }: { pending: PendingRevision }) {
  return (
    <details>
      <summary>待核对原提交证据</summary>
      {pending.kind === "create" ? (
        <>
          <p>保存计划：{pending.command.plan_id}</p>
          <p className="draft-revision-text">{pending.command.instruction}</p>
          <p>原评论：{pending.command.note_ids.join("、")}</p>
          <p>原片段：{pending.command.affected_segment_ids.join("、")}</p>
        </>
      ) : (
        <>
          <p>计划：{pending.planId}</p>
          {pending.kind === "approve" && (
            <>
              <p>明确批准：{pending.command.approval_id}</p>
              <p>{pending.command.expected_plan_hash}</p>
            </>
          )}
          {pending.kind === "attach" && (
            <>
              <p>
                关联候选：{pending.command.candidate_id} · {pending.command.candidate_operation_id}
              </p>
              <p>{pending.command.expected_plan_hash}</p>
              <p className="draft-revision-text">{pending.command.change_summary}</p>
            </>
          )}
          {pending.kind === "recheck" && (
            <>
              <p>
                复核候选：{pending.candidateId} · {pending.command.recheck_id}
              </p>
              <p>{pending.command.expected_candidate_hash}</p>
              <p>
                结果：{pending.command.outcome === "MANUALLY_CHECKED" ? "已人工核对" : "仍需修改"}
              </p>
              <p className="draft-revision-text">{pending.command.reason}</p>
            </>
          )}
        </>
      )}
    </details>
  );
}
function TargetEvidence({ target, label }: { target: DraftReviewTarget; label: string }) {
  return (
    <details>
      <summary>{label}精确版本与文件证据</summary>
      <p>
        项目：{target.project_id} · 分集：{target.episode_id}
      </p>
      <p>导出：{target.operation_id}</p>
      <p>
        装配 v{target.assembly_version_number}：{target.assembly_version_id}
      </p>
      <p>装配校验值：{target.assembly_content_hash}</p>
      <p>
        文件 SHA-256：{target.output_sha256} · {target.output_bytes} 字节
      </p>
      <p>
        {label}：{target.total_frames} 帧 · {target.frame_rate_num}/{target.frame_rate_den} fps
      </p>
    </details>
  );
}
function SegmentEvidence({
  segment,
  label,
}: {
  segment: DraftReviewRevisionSegment;
  label: string;
}) {
  return (
    <div>
      <p>
        {segment.track_kind} · {segment.segment_id} · {label}帧 [{segment.start_frame},{" "}
        {segment.end_frame})
      </p>
      {segment.storyboard_ref && (
        <p>
          镜头：{segment.storyboard_ref.shot_id} · 原分镜：
          {segment.storyboard_ref.storyboard_version_id}
        </p>
      )}
      <details>
        <summary>片段版本证据</summary>
        <p>{segment.segment_hash}</p>
        {segment.media && (
          <>
            <p>
              素材：{segment.media.asset_id} · {segment.media.asset_version_id}
            </p>
            <p>{segment.media.sha256}</p>
          </>
        )}
      </details>
    </div>
  );
}
function RevisionEditor({
  job,
  sourceTarget,
  gateway,
  exports,
  notes,
  notesReady = true,
}: Props & { gateway: DraftReviewRevisionGateway }) {
  const sourceIdentity = sourceTarget ?? job;
  const state = useDraftReviewRevision(sourceIdentity, gateway);
  const draft = useDraftReviewRevisionInput(sourceIdentity);
  const [localNotice, setLocalNotice] = useState("");
  const [jobs, setJobs] = useState<DraftExportJob[]>([]);
  const [jobsNotice, setJobsNotice] = useState("");
  const [jobsBusy, setJobsBusy] = useState(false);
  const jobsLife = useRef({ active: true, busy: false, epoch: 0 });
  const reloadJobs = async () => {
    const live = jobsLife.current;
    if (!exports || live.busy) return;
    const ticket = ++live.epoch;
    live.busy = true;
    setJobsBusy(true);
    setJobsNotice("");
    try {
      const result = await exports.list(job.project_id, job.episode_id);
      if (!live.active || ticket !== live.epoch) return;
      if (
        result.kind === "LISTED" &&
        new Set(result.receipt.data.items.map((item) => item.operation_id)).size ===
          result.receipt.data.items.length &&
        result.receipt.data.items.every((item) =>
          draftJobMatches(item, job.project_id, job.episode_id),
        )
      )
        setJobs(result.receipt.data.items);
      else {
        setJobs([]);
        setJobsNotice("候选导出列表暂未可靠读取，请重新核对。");
      }
    } catch {
      if (live.active && ticket === live.epoch) {
        setJobs([]);
        setJobsNotice("候选导出列表暂未可靠读取，请重新核对。");
      }
    } finally {
      if (live.active && ticket === live.epoch) {
        live.busy = false;
        setJobsBusy(false);
      }
    }
  };
  useEffect(() => {
    const live = jobsLife.current;
    live.active = true;
    void reloadJobs();
    return () => {
      live.active = false;
      live.epoch++;
      live.busy = false;
    };
  }, [job.project_id, job.episode_id, exports]);
  useEffect(() => {
    const confirmed = state.confirmed;
    if (
      confirmed?.kind === "create" &&
      draft.input.instruction === confirmed.command.instruction &&
      sameRevisionSelectionOrder(draft.input.noteIds, confirmed.command.note_ids) &&
      sameRevisionSelectionOrder(draft.input.segmentIds, confirmed.command.affected_segment_ids)
    )
      draft.edit({ noteIds: [], segmentIds: [], instruction: "" });
  }, [state.confirmed]);
  const locked =
    state.busy || state.pending !== null || !state.reliable || state.setAside === undefined;
  const composeLocked =
    locked ||
    draft.status === "INVALID" ||
    !notesReady ||
    !state.scope?.output_verified ||
    !state.data?.output_verified;
  const chosenNotes = notes.filter((note) => draft.input.noteIds.includes(note.note_id));
  const chosenSegments =
    state.scope?.segments.filter((segment) =>
      draft.input.segmentIds.includes(segment.segment_id),
    ) ?? [];
  const selectionValid =
    draft.input.noteIds.length > 0 &&
    draft.input.segmentIds.length > 0 &&
    chosenNotes.length === draft.input.noteIds.length &&
    chosenSegments.length === draft.input.segmentIds.length &&
    chosenNotes.every((note) =>
      chosenSegments.some(
        (segment) =>
          note.frame_index >= segment.start_frame && note.frame_index < segment.end_frame,
      ),
    );
  const toggle = (kind: "noteIds" | "segmentIds", id: string, selected: boolean) =>
    draft.edit({
      [kind]: selected
        ? [...draft.input[kind], id]
        : draft.input[kind].filter((item) => item !== id),
    });
  const create = async () => {
    if (composeLocked || !selectionValid || !revisionText(draft.input.instruction) || !state.data)
      return;
    const planId = newId("drp", setLocalNotice);
    if (!planId) return;
    await state.submit({
      kind: "create",
      command: {
        ...revisionIdentity(state.data.source),
        plan_id: planId,
        note_ids: draft.input.noteIds,
        affected_segment_ids: draft.input.segmentIds,
        instruction: draft.input.instruction,
      },
    });
  };
  return (
    <div className="draft-revision-editor">
      <h4>人工修改计划 · 原版与候选版分别核对</h4>
      <p>
        选择已保存评论和原装配片段，保存不可变计划，再单独批准。修改装配与导出仍由你在现有编辑流程完成。
      </p>
      <p>
        计划批准、关联候选与人工复核均不代表自动修正、版权通过或正式发布批准；原评论不会自动处理。
      </p>
      <div className="assembly-actions">
        <Button disabled={state.busy} onClick={() => void state.load()}>
          重新读取修改计划（只读）
        </Button>
        <Button disabled={jobsBusy || !exports} onClick={() => void reloadJobs()}>
          重新读取候选导出
        </Button>
      </div>
      {state.busy && <p role="status">正在核对人工修改记录…</p>}
      {state.notice && <p role="status">{state.notice}</p>}
      {localNotice && <p role="status">{localNotice}</p>}
      {jobsNotice && <p role="status">{jobsNotice}</p>}
      {state.pending === undefined && (
        <p role="alert">本机恢复记录不可用，已暂停全部新提交。请恢复本地存储后重新打开。</p>
      )}
      {state.pending && (
        <div role="alert">
          <p>有一条原提交待核对。只读核对不会重发；重试会沿用同一标识与原内容。</p>
          <PendingEvidence pending={state.pending} />
          <Button
            disabled={state.busy || !state.data}
            onClick={() => {
              if (state.pending && window.confirm("使用原标识与全部原内容重试这条待核对提交？"))
                void state.submit(state.pending);
            }}
          >
            明确重试原修改提交
          </Button>
          <Button
            disabled={state.busy}
            onClick={() => {
              if (
                window.confirm(
                  "原提交仍可能稍后保存。搁置会把原标识与全部内容保留在本机待核对历史，再允许后续新操作；新操作可能形成重复记录。建议先只读核对。仍要搁置这条原提交吗？",
                )
              )
                void state.putAside();
            }}
          >
            搁置原提交并保留本机证据
          </Button>
        </div>
      )}
      {state.setAside === undefined && (
        <p role="alert">本机搁置原提交历史无法可靠读取，新提交已暂停，不会覆盖原证据。</p>
      )}
      {state.setAside && state.setAside.length > 0 && (
        <details>
          <summary>本机已搁置原提交证据（{state.setAside.length} 条）</summary>
          <p>这些原提交仍可能保存；不会自动重发。重新读取只核对保存结果，本机原证据会保留。</p>
          {state.setAside.map((entry, index) => (
            <div key={index}>
              <p>
                {new Date(entry.set_aside_at).toLocaleString()} ·{" "}
                {state.reliable && state.data && pendingRevisionMatches(state.data, entry.pending)
                  ? "原提交后来已读回"
                  : "原提交仍待核对"}
              </p>
              <PendingEvidence pending={entry.pending} />
            </div>
          ))}
        </details>
      )}
      {state.data && (
        <>
          {state.data.plans.reduce((total, entry) => total + entry.candidates.length, 0) >= 20 && (
            <p role="status">此原版已达到 20 个候选的历史上限；已有候选仍可人工复核。</p>
          )}
          <TargetEvidence target={state.data.source} label="原版" />
          {!state.data.output_verified && (
            <p role="alert">原草稿文件缺失或变化。历史证据保留，新计划与批准已暂停。</p>
          )}
          <div className="draft-revision-compose">
            <h5>1. 保存人工修改计划</h5>
            <p>下列评论帧号和片段范围仅对应原草稿。范围采用左闭右开区间。</p>
            <InputRecovery draft={draft} locked={locked} />
            <fieldset disabled={composeLocked}>
              <legend>选择原版已保存评论（最多 50 条）</legend>
              <div className="draft-revision-choices">
                {notes.map((note) => (
                  <label key={note.note_id}>
                    <input
                      type="checkbox"
                      checked={draft.input.noteIds.includes(note.note_id)}
                      disabled={
                        !draft.input.noteIds.includes(note.note_id) &&
                        draft.input.noteIds.length >= 50
                      }
                      onChange={(event) =>
                        toggle("noteIds", note.note_id, event.currentTarget.checked)
                      }
                    />
                    <span>
                      原版第 {note.frame_index} 帧 · {note.text}
                    </span>
                  </label>
                ))}
              </div>
              {!notes.length && <p>请先保存此原版的手工评论，再建立修改计划。</p>}
            </fieldset>
            <fieldset disabled={composeLocked}>
              <legend>选择受影响原装配片段（最多 100 个）</legend>
              <div className="draft-revision-choices">
                {state.scope?.segments.map((segment) => (
                  <div key={segment.segment_id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.input.segmentIds.includes(segment.segment_id)}
                        disabled={
                          !draft.input.segmentIds.includes(segment.segment_id) &&
                          draft.input.segmentIds.length >= 100
                        }
                        onChange={(event) =>
                          toggle("segmentIds", segment.segment_id, event.currentTarget.checked)
                        }
                      />
                      <span>
                        {segment.track_kind} · {segment.segment_id} · 原版帧 [{segment.start_frame},{" "}
                        {segment.end_frame})
                        {segment.storyboard_ref ? ` · 镜头 ${segment.storyboard_ref.shot_id}` : ""}
                      </span>
                    </label>
                    <details>
                      <summary>原片段素材与版本证据</summary>
                      <SegmentEvidence segment={segment} label="原版" />
                    </details>
                  </div>
                ))}
              </div>
              {!state.scope && <p>原装配片段范围尚未可靠读取。</p>}
            </fieldset>
            {(draft.input.noteIds.length > 0 || draft.input.segmentIds.length > 0) &&
              !selectionValid && (
                <p role="alert">选择须仍属于此原版，且每条评论帧号须落在至少一个已选原片段内。</p>
              )}
            <label>
              人工修改指令
              <textarea
                aria-label="人工修改指令"
                value={draft.input.instruction}
                maxLength={4000}
                disabled={composeLocked}
                onChange={(event) => draft.edit({ instruction: event.currentTarget.value })}
              />
            </label>
            <small>
              未提交输入仅缓存于本机。保存并核对成功后才清空对应输入；已保存计划不可编辑，需修订时另建计划。
            </small>
            <Button
              primary
              disabled={
                composeLocked ||
                !selectionValid ||
                !revisionText(draft.input.instruction) ||
                state.data.plans.length >= 100
              }
              onClick={() => void create()}
            >
              保存人工修改计划
            </Button>
          </div>
          {!state.data.plans.length && <p>此原版尚无人工修改计划。</p>}
          {state.data.plans.map((entry) => (
            <RevisionPlan
              key={entry.plan.plan_id}
              job={sourceIdentity}
              entry={entry}
              state={state}
              exports={exports}
              jobs={jobs}
              jobsBusy={jobsBusy}
              notify={setLocalNotice}
            />
          ))}
        </>
      )}
    </div>
  );
}
function RevisionPlan({
  job,
  entry,
  state,
  exports,
  jobs,
  jobsBusy,
  notify,
}: {
  job: DraftReviewRevisionSource;
  entry: DraftReviewRevisionPlanEntry;
  state: RevisionState;
  exports?: DraftReviewRevisionExportGateway;
  jobs: DraftExportJob[];
  jobsBusy: boolean;
  notify: (text: string) => void;
}) {
  const { plan, approval } = entry;
  const draft = useDraftReviewRevisionInput(job, `plan:${plan.plan_id}:${plan.plan_hash}`);
  const locked =
    state.busy || state.pending !== null || !state.reliable || state.setAside === undefined;
  const choices = jobs.filter((candidate) =>
    eligibleRevisionCandidate(candidate, plan.source, entry),
  );
  const chosen = choices.find(
    (candidate) => candidate.operation_id === draft.input.candidateOperationId,
  );
  useEffect(() => {
    const confirmed = state.confirmed;
    if (
      confirmed?.kind === "attach" &&
      confirmed.planId === plan.plan_id &&
      draft.input.candidateOperationId === confirmed.command.candidate_operation_id &&
      draft.input.changeSummary === confirmed.command.change_summary
    )
      draft.edit({ candidateOperationId: "", changeSummary: "" });
  }, [state.confirmed]);
  const approve = async () => {
    if (
      locked ||
      approval ||
      !state.data?.output_verified ||
      !window.confirm(
        `批准此不可变人工修改计划？仅批准计划内容，不会自动修改、导出或发布。\n计划：${plan.plan_id}\n校验值：${plan.plan_hash}`,
      )
    )
      return;
    const approvalId = newId("dra", notify);
    if (approvalId)
      await state.submit({
        kind: "approve",
        planId: plan.plan_id,
        command: { approval_id: approvalId, expected_plan_hash: plan.plan_hash },
      });
  };
  const attach = async () => {
    if (
      locked ||
      !approval ||
      !chosen ||
      draft.status === "INVALID" ||
      !revisionText(draft.input.changeSummary) ||
      typeof chosen.output_sha256 !== "string" ||
      typeof chosen.output_bytes !== "number"
    )
      return;
    const candidateId = newId("drc", notify);
    if (candidateId)
      await state.submit({
        kind: "attach",
        planId: plan.plan_id,
        command: {
          assembly_version_id: chosen.assembly_version_id,
          assembly_content_hash: chosen.assembly_content_hash,
          output_sha256: chosen.output_sha256,
          output_bytes: chosen.output_bytes,
          candidate_id: candidateId,
          expected_plan_hash: plan.plan_hash,
          approval_id: approval.approval_id,
          candidate_operation_id: chosen.operation_id,
          change_summary: draft.input.changeSummary,
        },
      });
  };
  return (
    <article className="draft-revision-plan" aria-label={`人工修改计划 ${plan.plan_id}`}>
      <h5>计划 {plan.plan_id}</h5>
      <p className="draft-revision-text">{plan.instruction}</p>
      <small>
        {plan.actor_id} · {new Date(plan.created_at).toLocaleString()}
      </small>
      <details>
        <summary>不可变计划证据与原评论</summary>
        <p>计划校验值：{plan.plan_hash}</p>
        {plan.notes.map((note) => (
          <p className="draft-revision-text" key={note.note_id}>
            原版第 {note.frame_index} 帧 · {note.text}
          </p>
        ))}
        {plan.affected_segments.map((segment) => (
          <SegmentEvidence key={segment.segment_id} segment={segment} label="原版" />
        ))}
      </details>
      {!approval ? (
        <>
          <p>2. 审阅已保存内容后，单独批准这个精确计划。</p>
          <Button disabled={locked || !state.data?.output_verified} onClick={() => void approve()}>
            明确批准此人工修改计划
          </Button>
        </>
      ) : (
        <>
          <p>
            已明确批准人工修改计划 · {approval.actor_id} ·{" "}
            {new Date(approval.created_at).toLocaleString()}
          </p>
          <details>
            <summary>计划批准证据</summary>
            <p>{approval.approval_id}</p>
            <p>{approval.plan_hash}</p>
            <p>批准时装配版本：v{approval.assembly_version_number_at_approval}</p>
          </details>
          <h5>3. 关联批准后另行导出的候选草稿</h5>
          <p>
            先在成片组装中修改并保存新装配，再另行导出草稿。只列出此分集在批准之后创建、使用不同装配的成功导出；服务端会重新核验版本与文件。
          </p>
          <InputRecovery draft={draft} locked={locked} />
          <label>
            候选草稿
            <select
              aria-label={`计划 ${plan.plan_id} 候选草稿`}
              disabled={locked || jobsBusy || !exports || draft.status === "INVALID"}
              value={draft.input.candidateOperationId}
              onChange={(event) => draft.edit({ candidateOperationId: event.currentTarget.value })}
            >
              <option value="">选择后来导出的精确候选</option>
              {choices.map((candidate) => (
                <option key={candidate.operation_id} value={candidate.operation_id}>
                  {candidate.output_filename} · {candidate.operation_id}
                </option>
              ))}
              {draft.input.candidateOperationId && !chosen && (
                <option value={draft.input.candidateOperationId}>
                  缓存候选已不符合条件，请重新选择
                </option>
              )}
            </select>
          </label>
          {!choices.length && <p>尚无符合条件的后来导出。保存、导出新版后重新读取候选列表。</p>}
          {chosen && (
            <details>
              <summary>待关联候选版本证据</summary>
              <p>装配：{chosen.assembly_version_id}</p>
              <p>{chosen.assembly_content_hash}</p>
              <p>
                文件：{chosen.output_sha256} · {chosen.output_bytes} 字节
              </p>
            </details>
          )}
          <label>
            人工修改摘要
            <textarea
              aria-label={`计划 ${plan.plan_id} 人工修改摘要`}
              value={draft.input.changeSummary}
              maxLength={4000}
              disabled={locked || draft.status === "INVALID"}
              onChange={(event) => draft.edit({ changeSummary: event.currentTarget.value })}
            />
          </label>
          <Button
            disabled={
              locked ||
              !chosen ||
              !revisionText(draft.input.changeSummary) ||
              draft.status === "INVALID" ||
              (state.data?.plans.reduce((total, item) => total + item.candidates.length, 0) ?? 0) >=
                20
            }
            onClick={() => void attach()}
          >
            关联此精确候选草稿
          </Button>
        </>
      )}
      {entry.candidates.map((candidate) => (
        <RevisionCandidate
          key={candidate.candidate.candidate_id}
          job={job}
          plan={entry}
          entry={candidate}
          state={state}
          exports={exports}
          notify={notify}
        />
      ))}
    </article>
  );
}
function RevisionCandidate({
  job,
  plan,
  entry,
  state,
  exports,
  notify,
}: {
  job: DraftReviewRevisionSource;
  plan: DraftReviewRevisionPlanEntry;
  entry: DraftReviewRevisionCandidateEntry;
  state: RevisionState;
  exports?: DraftReviewRevisionExportGateway;
  notify: (text: string) => void;
}) {
  const { candidate, recheck } = entry;
  const draft = useDraftReviewRevisionInput(
    job,
    `candidate:${candidate.candidate_id}:${candidate.candidate_hash}`,
  );
  const locked =
    state.busy ||
    state.pending !== null ||
    !state.reliable ||
    state.setAside === undefined ||
    draft.status === "INVALID" ||
    !entry.output_verified ||
    !!recheck;
  useEffect(() => {
    const confirmed = state.confirmed;
    if (
      confirmed?.kind === "recheck" &&
      confirmed.candidateId === candidate.candidate_id &&
      draft.input.reason === confirmed.command.reason &&
      draft.input.outcome === confirmed.command.outcome
    )
      draft.edit({ reason: "" });
  }, [state.confirmed]);
  const save = async () => {
    if (locked || !revisionText(draft.input.reason)) return;
    const recheckId = newId("drk", notify);
    if (recheckId)
      await state.submit({
        kind: "recheck",
        planId: plan.plan.plan_id,
        candidateId: candidate.candidate_id,
        command: {
          recheck_id: recheckId,
          expected_candidate_hash: candidate.candidate_hash,
          outcome: draft.input.outcome,
          reason: draft.input.reason,
        },
      });
  };
  const comparison = candidate.comparison;
  return (
    <section
      className="draft-revision-candidate"
      aria-label={`人工修改候选 ${candidate.candidate_id}`}
    >
      <h5>候选 {candidate.candidate_id}</h5>
      <p className="draft-revision-text">人工修改摘要：{candidate.change_summary}</p>
      <small>
        {candidate.actor_id} · {new Date(candidate.created_at).toLocaleString()}
      </small>
      <p>关联是人工选择的关系，不证明修改由该计划造成或已完成。原版帧号不会自动映射为候选帧号。</p>
      <div className="draft-revision-comparison">
        <div>
          <h5>原版</h5>
          <TargetEvidence target={plan.plan.source} label="原版" />
          {plan.plan.affected_segments.map((segment) => (
            <SegmentEvidence key={segment.segment_id} segment={segment} label="原版" />
          ))}
          <DraftReviewRevisionPlayback
            target={plan.plan.source}
            exports={exports}
            label="原版"
            verified={state.data?.output_verified === true}
          />
        </div>
        <div>
          <h5>候选版</h5>
          <TargetEvidence target={candidate.target} label="候选版" />
          <details>
            <summary>候选版片段范围（独立帧号）</summary>
            {candidate.segments.map((segment) => (
              <SegmentEvidence key={segment.segment_id} segment={segment} label="候选版" />
            ))}
          </details>
          <DraftReviewRevisionPlayback
            target={candidate.target}
            exports={exports}
            label="候选版"
            verified={entry.output_verified}
          />
        </div>
      </div>
      <p>
        按片段标识比较：未变 {comparison.unchanged_segment_ids.length} · 变化{" "}
        {comparison.changed_segment_ids.length} · 移除 {comparison.removed_segment_ids.length} ·
        新增 {comparison.added_segment_ids.length}
      </p>
      {comparison.sequence_settings_changed && (
        <p role="alert">候选的画布、帧率或总帧数等序列设置已变化，需独立核对。</p>
      )}
      {comparison.out_of_scope_segment_ids.length > 0 && (
        <p role="alert">
          存在计划范围外的片段变化：{comparison.out_of_scope_segment_ids.join("、")}
        </p>
      )}
      <details>
        <summary>候选与比较证据</summary>
        <p>候选校验值：{candidate.candidate_hash}</p>
        <p>计划校验值：{candidate.plan_hash}</p>
        <p>批准：{candidate.approval_id}</p>
        <p>变化：{comparison.changed_segment_ids.join("、") || "无"}</p>
        <p>移除：{comparison.removed_segment_ids.join("、") || "无"}</p>
        <p>新增：{comparison.added_segment_ids.join("、") || "无"}</p>
      </details>
      {!entry.output_verified && (
        <p role="alert">候选文件缺失或变化，播放与新增复核已暂停；历史记录仍保留。</p>
      )}
      {recheck ? (
        <>
          <p>人工复核记录：{recheck.outcome === "MANUALLY_CHECKED" ? "已人工核对" : "仍需修改"}</p>
          <p className="draft-revision-text">{recheck.reason}</p>
          <small>
            {recheck.actor_id} · {new Date(recheck.created_at).toLocaleString()}
          </small>
        </>
      ) : (
        <>
          <h5>4. 独立记录人工复核结果</h5>
          <InputRecovery draft={draft} locked={state.busy || state.pending !== null} />
          <label>
            人工复核结果
            <select
              aria-label={`候选 ${candidate.candidate_id} 人工复核结果`}
              value={draft.input.outcome}
              disabled={locked}
              onChange={(event) =>
                draft.edit({
                  outcome: event.currentTarget.value as "NEEDS_MORE_WORK" | "MANUALLY_CHECKED",
                })
              }
            >
              <option value="NEEDS_MORE_WORK">仍需修改</option>
              <option value="MANUALLY_CHECKED">已人工核对</option>
            </select>
          </label>
          <label>
            人工复核说明
            <textarea
              aria-label={`候选 ${candidate.candidate_id} 人工复核说明`}
              maxLength={4000}
              value={draft.input.reason}
              disabled={locked}
              onChange={(event) => draft.edit({ reason: event.currentTarget.value })}
            />
          </label>
          <Button
            disabled={locked || !revisionText(draft.input.reason)}
            onClick={() => void save()}
          >
            保存此候选人工复核记录
          </Button>
        </>
      )}
      <p>人工核对记录只说明这次复核发生，不代表正式审核通过或发布批准。</p>
    </section>
  );
}
