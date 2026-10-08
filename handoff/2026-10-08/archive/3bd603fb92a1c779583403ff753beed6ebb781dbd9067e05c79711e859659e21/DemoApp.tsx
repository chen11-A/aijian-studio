import { useState } from "react";
import { DemoProvider, useDemo } from "./model";
import { art, pages, projectNav, stages } from "./data";
import type { PageId, Scenario } from "./data";
import { Button, EditorDialog } from "./Common";
import { Icon, Logo } from "./Icon";
import { AssistantPanel } from "./AssistantPanel";
import { HomePages } from "./HomePages";
import { StoryPages } from "./StoryPages";
import { VisualPages } from "./VisualPages";
import { MediaPages } from "./MediaPages";
import { UtilityPages } from "./UtilityPages";
import { Inspector } from "./Inspector";
import { Dropdown } from "./Dropdown";

export function DemoApp() {
  const [revision, setRevision] = useState(0);
  return (
    <DemoProvider key={revision}>
      <Workspace
        reset={() => {
          window.history.replaceState({}, "", "#project");
          setRevision((old) => old + 1);
        }}
      />
    </DemoProvider>
  );
}
function Workspace({ reset }: { reset: () => void }) {
  const d = useDemo();
  const global = pages[d.page][2] < 0;
  const activeStage = pages[d.page][2];
  const management = global;
  const hasStage = !management;
  const inspectable = [
    "source",
    "story",
    "script",
    "character",
    "characters",
    "world",
    "scenes",
    "storyboard",
    "generation",
    "assembly",
    "review",
  ].includes(d.page);
  const homes: PageId[] = ["home", "project", "projects", "launch"];
  const stories: PageId[] = ["source", "story", "script"];
  const visuals: PageId[] = ["characters", "character", "world", "scenes", "assets"];
  const medias: PageId[] = ["storyboard", "generation", "assembly", "review", "changes", "export"];
  const pro = d.professional && !management;
  const hasRail = pro || (management ? d.value("managementAI") === "true" : d.aiOpen);
  return (
    <div
      className={`demo-root ${global ? "global-shell" : "project-shell"} ${hasStage ? "has-stage" : "no-stage"} ${management ? "management-shell" : "creation-shell"} ${pro ? "is-pro" : "is-simple"} ${hasRail ? "has-rail" : "no-rail"}`}
      data-right-tab={d.rightTab}
      data-page={d.page}
      data-scenario={d.scenario}
    >
      <a
        className="skip-link"
        href="#demo-scroll"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("demo-scroll")?.focus();
        }}
      >
        跳到主要内容
      </a>
      <header className="topbar">
        <button className="brand" onClick={() => d.go("launch")} aria-label="AIVORA 启动页">
          <Logo />
          <span>
            <strong>AIVORA</strong>
            <small>AI Story & Motion Studio</small>
          </span>
        </button>
        <select
          aria-label="作品选择"
          value={d.value("projectId", "1")}
          onChange={(event) => {
            const project = d.projects.find((item) => item.id === Number(event.target.value));
            if (!project) return;
            d.put("projectId", String(project.id));
            d.put("title", project.name);
            d.go("project");
          }}
        >
          {d.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <Button icon="back" onClick={d.back}>
          返回
        </Button>
        {!global && (
          <select
            className="episode-select"
            aria-label="剧集选择"
            value={d.value("episode")}
            onChange={(event) => d.put("episode", event.target.value)}
          >
            <option>第 1 集 · 重逢</option>
            <option>第 2 集 · 回声</option>
          </select>
        )}
        <div className="topbar-spacer" />
        <div className="mode-switch">
          <button
            className={!d.professional ? "active" : ""}
            aria-pressed={!d.professional}
            onClick={() => {
              d.setProfessional(false);
              d.setInspector(false);
            }}
          >
            普通模式
          </button>
          <button
            className={d.professional ? "active" : ""}
            aria-pressed={d.professional}
            onClick={() => {
              d.setProfessional(true);
              d.setInspector(true);
            }}
          >
            专业模式
          </button>
        </div>
        <button className="service-indicator" onClick={() => d.go("services")}>
          <span />
          未连接真实服务
        </button>
        <Dropdown className="demo-controls" summary="UI 演示 · 样例">
          <div>
            <label>
              演示页面
              <select
                aria-label="演示页面"
                value={d.page}
                onChange={(event) => d.go(event.target.value as PageId)}
              >
                {Object.entries(pages).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value[0]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              页面状态
              <select
                aria-label="页面状态"
                value={d.scenario}
                onChange={(event) => d.setScenario(event.target.value as Scenario)}
              >
                <option value="normal">正常示例</option>
                <option value="empty">空数据</option>
                <option value="loading">加载中</option>
                <option value="error">失败</option>
                <option value="unavailable">能力未接入</option>
              </select>
            </label>
            <p>全部编辑只在内存中保存，刷新后恢复样例。</p>
            <Button onClick={reset}>重置演示</Button>
          </div>
        </Dropdown>
        <Button
          aria-label="通知"
          icon="bell"
          onClick={() =>
            d.setEditor({
              title: "通知",
              description: d.tasks.length
                ? d.tasks.map((task) => `${task.name} · ${task.status}`).join("\n")
                : "暂无新通知。这里会展示本次演示中的任务进度。",
            })
          }
        />
        <Dropdown
          className="user-menu"
          label="用户菜单"
          summary={
            <>
              <img className="user-avatar" src={d.value("avatar", art.portrait)} alt="" />
              <span>{d.value("userName", "陈")}</span>
              <span>⌄</span>
            </>
          }
        >
          <div>
            <button onClick={() => d.go("settings")}>用户中心</button>
            <button onClick={() => d.go("projectSettings")}>项目设置</button>
            <button onClick={() => d.go("launch")}>返回启动页</button>
          </div>
        </Dropdown>
      </header>
      <aside className="left-nav" aria-label="主导航">
        <nav>
          {global ? (
            <>
              {[
                { page: "home", label: "创作首页", icon: "home" },
                { page: "projects", label: "项目中心", icon: "folder" },
                { page: "services", label: "AI 服务", icon: "spark" },
                { page: "costs", label: "用量", icon: "clock" },
                { page: "settings", label: "设置", icon: "settings" },
              ].map((item) => (
                <NavItem key={item.page} {...item} page={item.page as PageId} />
              ))}
            </>
          ) : (
            projectNav.map((item) => (
              <div key={item.page}>
                {item.group && (
                  <small
                    className="nav-label"
                    data-group={item.group === "资源与交付" ? "resources" : "characters"}
                  >
                    <Icon name="globe" size={19} />
                    {item.group}
                  </small>
                )}
                <NavItem {...item} />
              </div>
            ))
          )}
        </nav>
        <div className="nav-bottom">
          {!global && <NavItem page="services" label="AI 服务" icon="spark" />}
          {!global && <NavItem page="settings" label="设置" icon="settings" />}
          <div className="local-note">
            <span>
              存储空间 <small>128 GB / 1 TB</small>
            </span>
            <progress aria-label="演示存储空间" value={128} max={1024} />
            <small>{global ? "单用户 · 不包含团队权限" : "本地样例 · 不产生费用"}</small>
          </div>
        </div>
      </aside>
      {hasStage && (
        <nav className="stage-bar" aria-label="创作阶段">
          {stages.map((stage, index) => (
            <button
              key={stage.page}
              aria-current={index === activeStage ? "step" : undefined}
              className={index === activeStage ? "current" : ""}
              onClick={() => d.go(stage.page)}
            >
              <span>
                {d.value(
                  [
                    "storyConfirmed",
                    "assetsConfirmed",
                    "animaticConfirmed",
                    "assemblyConfirmed",
                    "reviewDone",
                  ][index]!,
                ) === "true" ? (
                  <Icon name="check" size={16} />
                ) : (
                  index + 1
                )}
              </span>
              <b>{stage.label}</b>
              {index < 4 && <i>›</i>}
            </button>
          ))}
        </nav>
      )}
      <main className={`main-panel page-${d.page}`}>
        <div id="demo-scroll" tabIndex={-1} className="page-scroll">
          {homes.includes(d.page) ? (
            <HomePages />
          ) : stories.includes(d.page) ? (
            <StoryPages />
          ) : visuals.includes(d.page) ? (
            <VisualPages />
          ) : medias.includes(d.page) ? (
            <MediaPages />
          ) : (
            <UtilityPages />
          )}
        </div>
      </main>
      <aside className="right-dock" aria-label="创作辅助面板">
        {pro && (
          <div className="dock-tabs" role="tablist" aria-label="右侧面板">
            <button
              id="dock-inspector-tab"
              role="tab"
              aria-controls="dock-inspector"
              aria-selected={d.rightTab === "inspector"}
              onClick={() => d.selectRightTab("inspector")}
            >
              Inspector
            </button>
            <button
              id="dock-ai-tab"
              role="tab"
              aria-controls="dock-ai"
              aria-selected={d.rightTab === "ai"}
              onClick={() => d.selectRightTab("ai")}
            >
              Aivora AI
            </button>
          </div>
        )}
        <div id="dock-inspector" className="dock-inspector" aria-label="对象属性" hidden={!pro}>
          {inspectable && <Inspector />}
        </div>
        <div id="dock-ai" className="dock-ai">
          <AssistantPanel />
        </div>
      </aside>
      <button
        className="ai-toggle button"
        aria-label={hasRail ? "切换 AI 助手" : "展开 AI 助手"}
        onClick={() => {
          if (pro) d.selectRightTab(d.rightTab === "ai" ? "inspector" : "ai");
          else if (management) d.put("managementAI", hasRail ? "false" : "true");
          else d.setAiOpen(!d.aiOpen);
        }}
      >
        <Icon name="spark" />
        AI
      </button>
      {d.toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {d.toast}
        </div>
      )}
      <EditorDialog />
    </div>
  );
}
function NavItem({
  page,
  label,
  icon,
  child,
}: {
  page: PageId;
  label: string;
  icon: string;
  child?: boolean;
}) {
  const d = useDemo();
  const selected =
    d.page === page ||
    (page === "story" && ["source", "script"].includes(d.page)) ||
    (page === "characters" && d.page === "character") ||
    (page === "generation" && d.page === "assembly") ||
    (page === "review" && d.page === "changes");
  return (
    <button
      className={`nav-item ${selected ? "selected" : ""} ${child ? "nav-child" : ""}`}
      aria-current={selected ? "page" : undefined}
      title={label}
      onClick={() => d.go(page)}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}
