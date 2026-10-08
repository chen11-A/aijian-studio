import type { ProjectData } from "../../api/studio";
import { sourceNavigation, type ProductionSourceStage } from "./ProductionChrome";

type ProjectHomeTarget = "source" | "source-review" | "story" | "trial" | "settings";
interface ProjectHomeProps {
  project: ProjectData;
  source: ProductionSourceStage;
  onNavigate(target: ProjectHomeTarget): void;
  onOpenTasks(): void;
}
const quickActions: ReadonlyArray<{
  target: Exclude<ProjectHomeTarget, "settings">;
  title: string;
  detail: string;
}> = [
  { target: "source", title: "原文", detail: "导入或查看可追溯的小说来源" },
  { target: "source-review", title: "来源审核", detail: "核对并决定当前来源版本" },
  { target: "story", title: "故事", detail: "在已批准来源上整理故事证据" },
  { target: "trial", title: "试制", detail: "使用已提供的试制能力" },
];
export function ProjectHome({ project, source, onNavigate, onOpenTasks }: ProjectHomeProps) {
  const next = sourceNavigation(source);
  return (
    <section className="project-home" aria-labelledby="project-home-title">
      <header className="project-home-hero">
        <div>
          <span className="project-home-kicker">项目概览 · REV {project.revision}</span>
          <h1 id="project-home-title">{project.name}</h1>
          <p>从可靠来源开始，依次进入故事、分镜、制作与审片。</p>
        </div>
        <div className="project-home-hero-meta">
          <dl aria-label="项目元数据">
            <div>
              <dt>画幅</dt>
              <dd>{project.aspect_ratio}</dd>
            </div>
            <div>
              <dt>时长</dt>
              <dd>{project.target_duration_seconds} 秒</dd>
            </div>
            <div>
              <dt>语言</dt>
              <dd>{project.source_language}</dd>
            </div>
          </dl>
          <section className="project-home-source" aria-labelledby="project-source-title">
            <div>
              <span>G1 来源</span>
              <h2 id="project-source-title">{next.status}</h2>
            </div>
            <button
              type="button"
              disabled={next.target === null}
              onClick={() => next.target && onNavigate(next.target as ProjectHomeTarget)}
            >
              {next.label}
            </button>
          </section>
        </div>
      </header>
      <section className="project-home-actions" aria-labelledby="project-actions-title">
        <div className="project-home-section-heading">
          <div>
            <span>开始创作</span>
            <h2 id="project-actions-title">进入工作区</h2>
          </div>
        </div>
        <div className="project-home-action-grid">
          {quickActions.map((action) => (
            <button type="button" key={action.target} onClick={() => onNavigate(action.target)}>
              <strong>{action.title}</strong>
              <span>{action.detail}</span>
              <i aria-hidden="true">›</i>
            </button>
          ))}
        </div>
      </section>
      <section className="project-home-tools" aria-labelledby="project-tools-title">
        <div className="project-home-section-heading">
          <div>
            <span>工作台工具</span>
            <h2 id="project-tools-title">管理制作过程</h2>
          </div>
        </div>
        <div>
          <button type="button" onClick={onOpenTasks}>
            任务与影响报告
          </button>
          <button type="button" onClick={() => onNavigate("settings")}>
            模型与 API
          </button>
        </div>
      </section>
    </section>
  );
}
