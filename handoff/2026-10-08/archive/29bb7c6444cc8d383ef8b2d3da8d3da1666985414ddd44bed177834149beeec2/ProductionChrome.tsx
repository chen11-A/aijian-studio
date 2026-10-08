import type { ReactNode } from "react";

import type { ProjectData } from "../../api/studio";
import "./production-chrome.css";

type StageTone = "active" | "waiting" | "review" | "approved";
export type ProductionSourceStage =
  | { kind: "loading" | "error" | "inconsistent" | "empty" }
  | { kind: "draft" | "review"; acceptedVersionNumber: number | null }
  | { kind: "approved"; versionNumber: number };
type ProductionNavigationTarget = "project" | "source" | "source-review" | "story";
export type ProductionStage = "story" | "world" | "shots" | "production" | "review";

interface ProductionStageBarProps {
  source: ProductionSourceStage;
  onNext(target: ProductionNavigationTarget): void;
  activeStage?: ProductionStage | null;
  onStage?(stage: ProductionStage): void;
}

const stages: ReadonlyArray<{ id: ProductionStage; name: string }> = [
  { id: "story", name: "故事" },
  { id: "world", name: "角色与世界" },
  { id: "shots", name: "分镜" },
  { id: "production", name: "制作" },
  { id: "review", name: "审片" },
];

export function sourceNavigation(source: ProductionSourceStage): {
  status: string;
  tone: StageTone;
  label: string;
  target: ProductionNavigationTarget | null;
} {
  switch (source.kind) {
    case "loading":
      return { status: "读取中", tone: "waiting", label: "正在读取来源状态", target: null };
    case "error":
      return {
        status: "读取失败",
        tone: "waiting",
        label: "恢复来源审核",
        target: "source-review",
      };
    case "inconsistent":
      return {
        status: "身份不一致",
        tone: "waiting",
        label: "核对来源审核",
        target: "source-review",
      };
    case "empty":
      return { status: "未导入", tone: "active", label: "导入小说原文", target: "source" };
    case "approved":
      return { status: "已批准", tone: "approved", label: "审阅故事证据", target: "story" };
    case "draft":
      return {
        status: source.acceptedVersionNumber === null ? "待审核" : "新版待审核",
        tone: "review",
        label: "审核来源版本",
        target: "source-review",
      };
    case "review":
      return {
        status: source.acceptedVersionNumber === null ? "审核中" : "新版审核中",
        tone: "review",
        label: "审核来源版本",
        target: "source-review",
      };
  }
}

export function ProductionStageBar({
  source,
  onNext,
  activeStage = "story",
  onStage,
}: ProductionStageBarProps) {
  const next = sourceNavigation(source);

  return (
    <section className="production-progress" aria-label="创作导航与来源状态">
      <nav className="production-stages" aria-label="创作五阶段">
        {stages.map((stage, index) => (
          <button
            type="button"
            className={`production-stage${activeStage === stage.id ? " tone-active" : ""}`}
            key={stage.id}
            aria-current={activeStage === stage.id ? "step" : undefined}
            disabled={!onStage}
            onClick={() => onStage?.(stage.id)}
          >
            <span>{index + 1}</span>
            <strong>{stage.name}</strong>
          </button>
        ))}
      </nav>
      <div className="production-gates" aria-label="已有 Gate 与来源状态">
        <button type="button" onClick={() => onNext("project")} aria-label="G0 立项：项目概览">
          G0 项目概览
        </button>
        <button
          type="button"
          className={`source-gate tone-${next.tone}`}
          aria-label={`G1 来源：${next.status}`}
          disabled={source.kind === "loading"}
          onClick={() => onNext("source-review")}
        >
          G1 来源：{next.status}
        </button>
        <span>G2–G8 状态未接入 · 导航不代表批准</span>
      </div>
      <div className="production-next">
        <span>
          费用尚未接入 · G1 以实际来源版本为准
          {source.kind === "approved" && (
            <>
              <br />
              最新来源 V{source.versionNumber} 已批准
            </>
          )}
          {(source.kind === "draft" || source.kind === "review") &&
            source.acceptedVersionNumber !== null && (
              <>
                <br />
                新版尚未批准；旧批准基线 V{source.acceptedVersionNumber} 仍可用于故事阅读
              </>
            )}
        </span>
        <button
          type="button"
          disabled={next.target === null}
          onClick={() => {
            if (next.target) onNext(next.target);
          }}
        >
          下一步：{next.label}
        </button>
      </div>
    </section>
  );
}

interface ProjectInspectorProps {
  project: ProjectData;
  collapsed: boolean;
  proposal?: ReactNode;
  onToggle(): void;
}

export function ProjectInspector({
  project,
  collapsed,
  proposal,
  onToggle,
}: ProjectInspectorProps) {
  return (
    <aside className="project-inspector studio-inspector" aria-label="Aivora AI 与提案">
      <header>
        <div>
          <span>AIVORA AI</span>
          <strong>助手尚未接入</strong>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "展开属性检查器" : "收起属性检查器"}
          aria-expanded={!collapsed}
        >
          {collapsed ? "项目属性" : "收起属性"}
        </button>
      </header>
      <p className="assistant-availability">对话与生成暂不可用；下方保留已有任务的真实提案审核。</p>
      <dl hidden={collapsed}>
        <div>
          <dt>当前版本</dt>
          <dd>REV {project.revision}</dd>
        </div>
        <div>
          <dt>交付画幅</dt>
          <dd>{project.aspect_ratio}</dd>
        </div>
        <div>
          <dt>目标时长</dt>
          <dd>{project.target_duration_seconds} 秒</dd>
        </div>
      </dl>
      {proposal ?? (
        <section className="proposal-empty" aria-label="AI 提案">
          <span>AI PROPOSALS</span>
          <strong>暂无待审提案</strong>
          <p>Agent 完成任务后，这里会显示证据、变化、影响、费用与质量检查。</p>
        </section>
      )}
    </aside>
  );
}

export function PendingWorkspace({ name }: { name: string }) {
  return (
    <section className="pending-workspace" aria-labelledby="pending-workspace-title">
      <span>PLANNED · NOT IMPLEMENTED</span>
      <h2 id="pending-workspace-title">{name}工作区尚未实现</h2>
      <p>当前只建立生产导航与真实空状态，不会用静态示例冒充可用功能。</p>
    </section>
  );
}
