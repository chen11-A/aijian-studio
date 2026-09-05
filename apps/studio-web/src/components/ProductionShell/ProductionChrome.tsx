import type { ReactNode } from "react";

import type { ProjectData } from "../../api/studio";
import "./production-chrome.css";

type StageTone = "active" | "waiting" | "review" | "approved";
export type ProductionSourceStage =
  | { kind: "loading" | "error" | "inconsistent" | "empty" }
  | { kind: "draft" | "review"; acceptedVersionNumber: number | null }
  | { kind: "approved"; versionNumber: number };
type ProductionNavigationTarget = "project" | "source" | "source-review" | "story";

interface ProductionStageBarProps {
  source: ProductionSourceStage;
  onNext(target: ProductionNavigationTarget): void;
}

const stageNames = ["立项", "来源", "故事", "规划", "剧本", "视觉", "导演", "剪辑", "发布"];

function sourceNavigation(source: ProductionSourceStage): {
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

export function ProductionStageBar({ source, onNext }: ProductionStageBarProps) {
  const next = sourceNavigation(source);

  const toneFor = (index: number): StageTone => {
    if (index === 0) return "active";
    if (index === 1) return next.tone;
    return "waiting";
  };

  const statusFor = (index: number) => {
    if (index === 0) return "未签署";
    if (index === 1) return next.status;
    if (index === 2) return "状态未接入";
    return "等待上游";
  };

  return (
    <section className="production-progress" aria-label="G0 至 G8 生产阶段">
      <div className="production-stages">
        {stageNames.map((name, index) => (
          <button
            type="button"
            className={`production-stage tone-${toneFor(index)}`}
            key={name}
            aria-label={`G${index} ${name}：${statusFor(index)}`}
            disabled={index > 1 || (index === 1 && source.kind === "loading")}
            onClick={() => {
              if (index === 0) onNext("project");
              if (index === 1) onNext("source-review");
            }}
          >
            <span>G{index}</span>
            <strong>{name}</strong>
            <small>{statusFor(index)}</small>
          </button>
        ))}
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
  if (collapsed) {
    return (
      <aside className="project-inspector collapsed" aria-label="属性检查器">
        <button type="button" onClick={onToggle} aria-label="展开属性检查器" aria-expanded="false">
          ‹
        </button>
      </aside>
    );
  }

  return (
    <aside className="project-inspector" aria-label="属性检查器">
      <header>
        <div>
          <span>INSPECTOR</span>
          <strong>项目属性</strong>
        </div>
        <button type="button" onClick={onToggle} aria-label="收起属性检查器" aria-expanded="true">
          ›
        </button>
      </header>
      <dl>
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
