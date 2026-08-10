import type { ProjectData } from "../../api/studio";
import "./production-chrome.css";

type StageTone = "active" | "waiting" | "review" | "approved";

interface ProductionStageBarProps {
  sourceReady: boolean;
  onNext(workspace: "project" | "story"): void;
}

const stageNames = ["立项", "来源", "故事", "规划", "剧本", "视觉", "导演", "剪辑", "发布"];

export function ProductionStageBar({ sourceReady, onNext }: ProductionStageBarProps) {
  const next = sourceReady
    ? { label: "审阅故事证据", workspace: "story" as const }
    : { label: "导入小说原文", workspace: "project" as const };

  const toneFor = (index: number): StageTone => {
    if (index === 0) return "active";
    if (index === 1) return sourceReady ? "review" : "active";
    if (index === 2) return "waiting";
    return "waiting";
  };

  const statusFor = (index: number) => {
    if (index === 0) return "未签署";
    if (index === 1) return sourceReady ? "待审批" : "当前";
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
            disabled={index > 1}
            onClick={() => {
              if (index <= 1) onNext("project");
            }}
          >
            <span>G{index}</span>
            <strong>{name}</strong>
            <small>{statusFor(index)}</small>
          </button>
        ))}
      </div>
      <div className="production-next">
        <span>费用尚未接入 · 审批人未指派</span>
        <button type="button" onClick={() => onNext(next.workspace)}>
          下一步：{next.label}
        </button>
      </div>
    </section>
  );
}

interface ProjectInspectorProps {
  project: ProjectData;
  collapsed: boolean;
  onToggle(): void;
}

export function ProjectInspector({ project, collapsed, onToggle }: ProjectInspectorProps) {
  if (collapsed) {
    return (
      <aside className="project-inspector collapsed" aria-label="属性检查器">
        <button type="button" onClick={onToggle} aria-label="展开属性检查器">
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
        <button type="button" onClick={onToggle} aria-label="收起属性检查器">
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
      <section className="proposal-empty" aria-label="AI 提案">
        <span>AI PROPOSALS</span>
        <strong>暂无提案</strong>
        <p>Agent Runtime 接入后，提案会在此显示证据、差异、影响、费用和接受为 DRAFT 操作。</p>
      </section>
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
