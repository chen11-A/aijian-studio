import { useCallback, useEffect, useRef, useState } from "react";

import type { ArtifactProposalResponse, TaskQueueResponse } from "../../api/studio";
import "./proposal-review-card.css";

interface ProposalReviewCardProps {
  projectId: string;
  listTasks(projectId: string): Promise<TaskQueueResponse>;
  getProposal(projectId: string, proposalId: string): Promise<ArtifactProposalResponse>;
}

type ProposalState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; response: ArtifactProposalResponse }
  | { kind: "error" };

const artifactLabels: Record<string, string> = {
  SourceExtraction: "来源提取提案",
  StoryBible: "故事圣经提案",
  Screenplay: "剧本提案",
  ShotPlan: "导演分镜提案",
};

function summaryOf(payload: Record<string, unknown>): string {
  const summary = payload.summary;
  return typeof summary === "string" && summary.trim().length > 0
    ? summary
    : "AI 已生成结构化提案，请根据证据和变化范围进行审阅。";
}

function formatCost(estimatedMicros: number, actualMicros: number): string {
  const micros = actualMicros > 0 ? actualMicros : estimatedMicros;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: micros === 0 ? 2 : 4,
    maximumFractionDigits: 6,
  }).format(micros / 1_000_000);
}

export function ProposalReviewCard({ projectId, listTasks, getProposal }: ProposalReviewCardProps) {
  const [state, setState] = useState<ProposalState>({ kind: "loading" });
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setState({ kind: "loading" });
    try {
      const queue = await listTasks(projectId);
      if (generation !== requestGeneration.current) return;
      const task = queue.data.tasks.find(
        (item) => item.node.status === "NEEDS_REVIEW" && item.proposal_id !== null,
      );
      if (!task?.proposal_id) {
        setState({ kind: "empty" });
        return;
      }
      const response = await getProposal(projectId, task.proposal_id);
      if (generation !== requestGeneration.current) return;
      setState({ kind: "ready", response });
    } catch {
      if (generation !== requestGeneration.current) return;
      setState({ kind: "error" });
    }
  }, [getProposal, listTasks, projectId]);

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load]);

  if (state.kind === "loading") {
    return (
      <section className="proposal-state" role="status" aria-live="polite">
        <span className="proposal-loader" aria-hidden="true" />
        <div>
          <strong>正在读取 AI 提案…</strong>
          <p>正在核对任务、证据和提案版本。</p>
        </div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="proposal-state proposal-error" role="alert">
        <div>
          <strong>提案暂时无法读取</strong>
          <p>项目内容没有被修改，恢复连接后可以重试。</p>
        </div>
        <button type="button" onClick={() => void load()}>
          重新读取提案
        </button>
      </section>
    );
  }

  if (state.kind === "empty") {
    return (
      <section className="proposal-empty" aria-label="AI 提案">
        <span>AI PROPOSALS</span>
        <strong>暂无待审提案</strong>
        <p>Agent 完成任务后，这里会显示证据、变化、影响、费用与质量检查。</p>
        <button type="button" className="proposal-refresh" onClick={() => void load()}>
          刷新提案
        </button>
      </section>
    );
  }

  const proposal = state.response.data.proposal;
  const evidenceCount = proposal.source_spans.length;
  const changeCount = proposal.diff.length;
  const impactCount = proposal.impacts.length;
  const qcStatus = proposal.qc.some((item) => item.status === "FAIL")
    ? "failed"
    : proposal.qc.length > 0 && proposal.qc.every((item) => item.status === "PASS")
      ? "passed"
      : "pending";
  const title = artifactLabels[proposal.target_artifact_type] ?? "AI 产物提案";

  return (
    <section className="proposal-review-card" aria-labelledby="proposal-review-title">
      <header>
        <div>
          <span>AI PROPOSAL · DRAFT CANDIDATE</span>
          <h3 id="proposal-review-title">{title}</h3>
        </div>
        <div className="proposal-review-actions">
          <span className="proposal-review-status">等待人工审阅</span>
          <button type="button" aria-label="刷新待审提案" onClick={() => void load()}>
            刷新
          </button>
        </div>
      </header>

      <p className="proposal-summary">{summaryOf(proposal.payload)}</p>

      <dl className="proposal-metrics">
        <div>
          <dt>置信度</dt>
          <dd>{Math.round(proposal.confidence_basis_points / 100)}%</dd>
        </div>
        <div>
          <dt>原文证据</dt>
          <dd>{evidenceCount} 条</dd>
        </div>
        <div>
          <dt>变化</dt>
          <dd>{changeCount} 项</dd>
        </div>
        <div>
          <dt>影响产物</dt>
          <dd>{impactCount} 项</dd>
        </div>
      </dl>

      <div className="proposal-evidence">
        <div className="proposal-section-heading">
          <strong>原文证据</strong>
          <span>SourceSpan</span>
        </div>
        <ul>
          {proposal.source_spans.slice(0, 3).map((span) => (
            <li key={span.source_span_id}>{span.claim}</li>
          ))}
        </ul>
      </div>

      <footer>
        <div>
          <span>预计费用</span>
          <strong>{formatCost(proposal.cost.estimated_micros, proposal.cost.actual_micros)}</strong>
        </div>
        <div>
          <span>自动 QC</span>
          <strong className={`qc-${qcStatus}`}>
            {qcStatus === "failed" ? "需要处理" : qcStatus === "passed" ? "已通过" : "未运行"}
          </strong>
        </div>
      </footer>

      <p className="proposal-gate-note">
        接受与退回将在桌面安全操作接入后开放；AI 不能代替具名人员批准 Gate。
      </p>
    </section>
  );
}
