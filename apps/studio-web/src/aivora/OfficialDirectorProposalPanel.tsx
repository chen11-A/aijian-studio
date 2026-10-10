import { useEffect, useState } from "react";
import { Button } from "./Common";
import { OfficialDirectorGenerationForm } from "./OfficialDirectorGenerationForm";
import { OfficialDirectorOperationEvidence } from "./OfficialDirectorOperationEvidence";
import { OfficialDirectorPlanPreview } from "./OfficialDirectorPlanPreview";
import { sameDirectorInputs } from "./adapters/officialDirectorProposal";
import {
  useOfficialDirectorProposals,
  type OfficialDirectorPanelProps,
} from "./useOfficialDirectorProposals";
import "./official-director-proposals.css";

export function OfficialDirectorProposalPanel(props: OfficialDirectorPanelProps) {
  const state = useOfficialDirectorProposals(props);
  const [selection, setSelection] = useState<string | null>(null);
  const newestId = state.operations[0]?.request.operation_id ?? null;
  useEffect(() => {
    setSelection(newestId);
  }, [newestId]);
  const operation =
    state.operations.find((item) => item.request.operation_id === selection) ?? state.operations[0];
  const issues = operation?.proposal
    ? [...operation.proposal.content.issues, ...operation.proposal.capability_losses]
    : [];
  const blocking = issues.some((issue) => issue.severity === "BLOCKING");
  const reviewed = !!operation?.adoption || !!operation?.rejection;
  const canAdopt =
    !!operation?.proposal &&
    !reviewed &&
    !blocking &&
    sameDirectorInputs(state.preparation, operation);
  const status = operation?.adoption
    ? "已采纳为分镜草稿"
    : operation?.rejection
      ? "已人工驳回"
      : operation?.status === "COMPLETED"
        ? "待人工审阅"
        : operation?.status === "INVALID"
          ? "输出校验未通过"
          : operation?.status === "NOT_SENT"
            ? "已确认未发送"
            : "发送结果未知（REMOTE_UNKNOWN）";
  function select(id: string) {
    if (state.reason && !window.confirm("切换记录会放弃尚未提交的驳回理由。继续吗？")) return;
    state.setReason("");
    setSelection(id);
  }
  function adopt() {
    if (!operation || !canAdopt || state.locked) return;
    if (
      !window.confirm(
        `将此 AI 导演提案的 ${operation.proposal?.content.shots.length} 个镜头采纳为新的可编辑分镜版本？原分镜版本和精确剧本引用会保留。`,
      )
    )
      return;
    void state.adopt(operation);
  }
  function reject() {
    if (!operation || reviewed || state.locked || !state.reason.trim()) return;
    if (!window.confirm("记录此人工驳回理由？原 AI 提案会保留，不能再采纳此版本。")) return;
    void state.reject(operation);
  }
  return (
    <section
      className="episode-storyboard official-director-workspace"
      aria-label="AI 导演提案审阅"
    >
      <div className="storyboard-status">
        <span>AI 导演镜头计划 · 人工审阅后创建分镜草稿</span>
        <span>文字计划 · 未生成画面或声音</span>
      </div>
      {state.notice && (
        <p className="storyboard-notice" role="status">
          {state.notice}
        </p>
      )}
      {state.externalBlocked && (
        <p className="storyboard-notice" role="status">
          请先保存剧本、分镜和人工提案修改，并核对尚未明确的原提交。
        </p>
      )}
      {state.baseStale && (
        <p className="storyboard-notice" role="status">
          本集已保存的分镜版本已变化。请先只读核对当前输入；旧提案不会覆盖新版。
        </p>
      )}
      {state.unknown && (
        <p className="storyboard-recovery" role="alert">
          本集有远端结果未知的操作，已暂停新生成。只读核对不会再次调用模型。
        </p>
      )}
      {state.journal.kind !== "EMPTY" && (
        <div className="storyboard-recovery">
          <span>
            {state.journal.kind === "BLOCKED"
              ? "恢复记录不可读取，已暂停所有提交。"
              : "原操作尚待核对，不会自动重发。"}
          </span>
          <Button
            disabled={state.busy || state.journal.kind !== "PENDING" || !props.bridge}
            onClick={() => void state.recover()}
          >
            核对原操作（只读）
          </Button>
        </div>
      )}
      <OfficialDirectorGenerationForm state={state} connected={!!props.bridge} />
      {state.operations.length > 0 && (
        <label className="official-director-history">
          本集操作记录（最近记录）
          <select
            value={operation?.request.operation_id ?? ""}
            disabled={state.busy}
            onChange={(event) => select(event.target.value)}
          >
            {state.operations.map((item) => (
              <option key={item.request.operation_id} value={item.request.operation_id}>
                {item.created_at} · 请求模型 {item.request.model} · {item.status} ·{" "}
                {item.request.operation_id.slice(-8)}
              </option>
            ))}
          </select>
        </label>
      )}
      {state.hasMore && (
        <p className="official-director-history-limit">
          这里只显示最近的部分记录，较早的不可变操作和提案仍保留。
        </p>
      )}
      {operation ? (
        <>
          <div className="official-director-operation-status" role="status">
            <strong>{status}</strong>
            <span>
              任务 {operation.task_id} · Attempt {operation.attempt_id} · {operation.attempt_status}
            </span>
          </div>
          <OfficialDirectorOperationEvidence operation={operation} />
          {operation.status === "INVALID" && (
            <p className="storyboard-notice">
              此次供应商输出未通过服务端校验，原操作和校验问题保留。未创建可采纳的镜头计划。
            </p>
          )}
          {operation.proposal && (
            <OfficialDirectorPlanPreview
              key={operation.request.operation_id}
              content={operation.proposal.content}
            />
          )}
          {operation.rejection && (
            <p className="storyboard-notice">
              人工驳回理由：{operation.rejection.reason} · {operation.rejection.rejected_at}
            </p>
          )}
          {operation.adoption && (
            <p className="storyboard-notice">
              已创建可编辑分镜：{operation.adoption.storyboard_version_id} ·{" "}
              {operation.adoption.storyboard_content_hash}。旧分镜与本提案仍保留。
            </p>
          )}
          {operation.proposal && !reviewed && (
            <footer className="storyboard-save-footer official-director-decision">
              <label>
                人工驳回理由
                <input
                  maxLength={2000}
                  value={state.reason}
                  disabled={state.locked}
                  onChange={(event) => state.setReason(event.target.value)}
                />
              </label>
              <Button disabled={state.locked || !state.reason.trim()} onClick={reject}>
                记录驳回理由
              </Button>
              <Button primary disabled={state.locked || !canAdopt} onClick={adopt}>
                明确采纳为新分镜版本
              </Button>
              {!sameDirectorInputs(state.preparation, operation) && (
                <p>当前剧本、制作意图或分镜基准已变化，原提案只读保留，不能覆盖当前内容。</p>
              )}
            </footer>
          )}
        </>
      ) : (
        <p className="official-director-empty" role="status">
          {state.readState === "loading"
            ? "正在读取本集 AI 导演记录…"
            : state.readState === "error"
              ? "记录尚未核实，请只读核对。"
              : "本集尚无 AI 导演提案。先确认剧本，再明确生成一次镜头计划。"}
        </p>
      )}
    </section>
  );
}
