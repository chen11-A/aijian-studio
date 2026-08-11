import { useEffect, useRef, useState } from "react";

import type { ArtifactProposalRejectionInput } from "../../api/studio";

export type DecisionOutcome =
  | { kind: "accepted"; versionId: string; actorId: string; replayed: boolean }
  | { kind: "rejected"; reason: string; actorId: string; replayed: boolean }
  | { kind: "unknown" }
  | { kind: "definite-error"; status: number; code: string; requestId: string };

const rejectionReasons = [
  ["SOURCE_EVIDENCE", "原文证据"],
  ["CREATIVE_DIRECTION", "创作方向"],
  ["CONTINUITY", "连续性"],
  ["TECHNICAL_QUALITY", "技术质量"],
  ["RIGHTS_OR_SAFETY", "权利或安全"],
  ["BUDGET_OR_COST", "预算或费用"],
  ["OTHER", "其他"],
] as const;

function reasonLabel(value: string): string {
  return rejectionReasons.find(([reason]) => reason === value)?.[1] ?? "其他";
}

function definiteErrorCopy(status: number): string {
  if (status === 409) return "提案状态已经变化，当前决定没有执行。请刷新后重新确认。";
  if (status === 401 || status === 403) return "本地安全会话已经失效，当前决定没有执行。";
  if (status === 404) return "待审提案已不存在，当前决定没有执行。";
  return "请求未通过服务端校验，当前决定没有执行。";
}

export function ProposalDecisionOutcomeView({
  outcome,
  busy,
  onRetry,
  onRefresh,
}: {
  outcome: DecisionOutcome;
  busy: boolean;
  onRetry(): void;
  onRefresh(): void;
}) {
  if (outcome.kind === "accepted") {
    return (
      <section className="proposal-decision-receipt" role="status">
        <strong>已创建不可变 DRAFT</strong>
        <p>
          版本 <code>{outcome.versionId}</code> 已由 {outcome.actorId} 接受为草稿
          {outcome.replayed ? "（幂等重放）" : ""}。尚未批准、发布或推进 Gate。
        </p>
        <button type="button" onClick={onRefresh}>
          完成并刷新
        </button>
      </section>
    );
  }
  if (outcome.kind === "rejected") {
    return (
      <section className="proposal-decision-receipt" role="status">
        <strong>已记录具名退回</strong>
        <p>
          {outcome.actorId} 已按 {reasonLabel(outcome.reason)} 退回
          {outcome.replayed ? "（幂等重放）" : ""}。未创建产物版本，也不会自动重生成。
        </p>
        <button type="button" onClick={onRefresh}>
          完成并刷新
        </button>
      </section>
    );
  }
  if (outcome.kind === "unknown") {
    return (
      <section className="proposal-decision-warning" role="alert">
        <strong>操作结果暂时无法确认</strong>
        <p>不要创建新决定。恢复连接后将使用同一请求身份安全重试。</p>
        <button type="button" disabled={busy} onClick={onRetry}>
          使用原请求重试
        </button>
      </section>
    );
  }
  return (
    <section className="proposal-decision-warning" role="alert">
      <strong>决定未执行</strong>
      <p>{definiteErrorCopy(outcome.status)}</p>
      <small>
        {outcome.code} · {outcome.requestId}
      </small>
      <button type="button" onClick={onRefresh}>
        刷新提案状态
      </button>
    </section>
  );
}

export function ProposalAcceptConfirmation({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const headingRef = useRef<HTMLElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section className="proposal-decision-confirm" aria-labelledby="proposal-accept-title">
      <strong id="proposal-accept-title" ref={headingRef} tabIndex={-1}>
        接受为 DRAFT？
      </strong>
      <p>只创建不可变 DRAFT；不批准、不发布、不推进 Gate。若已有产物 Head，本次操作将失败。</p>
      <div>
        <button type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="proposal-primary-action"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "正在创建 DRAFT…" : "确认创建 DRAFT"}
        </button>
      </div>
    </section>
  );
}

export function ProposalRejectionForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel(): void;
  onSubmit(input: ArtifactProposalRejectionInput): void;
}) {
  const [reason, setReason] =
    useState<ArtifactProposalRejectionInput["reason_code"]>("SOURCE_EVIDENCE");
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const headingRef = useRef<HTMLElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <form
      className="proposal-rejection-form"
      aria-labelledby="proposal-rejection-title"
      onSubmit={(event) => {
        event.preventDefault();
        const normalizedComment = comment.normalize("NFC").replace(/\r\n?/g, "\n").trim();
        if (!normalizedComment) {
          setCommentError("请填写具体退回意见。");
          commentRef.current?.focus();
          return;
        }
        setCommentError(null);
        onSubmit({ reason_code: reason, comment: normalizedComment });
      }}
    >
      <strong id="proposal-rejection-title" ref={headingRef} tabIndex={-1}>
        具名退回提案
      </strong>
      <p>退回会记录意见，不创建产物版本、不删除原提案，也不会自动重生成。</p>
      <label>
        <span>退回原因</span>
        <select
          value={reason}
          disabled={busy}
          onChange={(event) =>
            setReason(event.target.value as ArtifactProposalRejectionInput["reason_code"])
          }
        >
          {rejectionReasons.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>退回意见</span>
        <textarea
          ref={commentRef}
          value={comment}
          maxLength={4000}
          rows={5}
          disabled={busy}
          aria-invalid={commentError !== null}
          aria-describedby={commentError ? "proposal-rejection-comment-error" : undefined}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      {commentError && (
        <p id="proposal-rejection-comment-error" className="proposal-field-error">
          {commentError}
        </p>
      )}
      <div>
        <button type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="proposal-reject-action" disabled={busy}>
          {busy ? "正在记录退回…" : "确认具名退回"}
        </button>
      </div>
    </form>
  );
}
