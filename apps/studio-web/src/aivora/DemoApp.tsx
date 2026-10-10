import { useState, type ReactNode } from "react";
import { DemoProvider, useDemo } from "./model";
import type { DemoFixture } from "./model";
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
import {
  OfficialConnectionProvider,
  useOfficialConnection,
} from "./chatgpt-auth/ChatGPTConnectionContext";
import { assessChatGPTConnection, readinessLabels } from "../domain/ai-capability-readiness";
import { AssistantSelectionProvider } from "./assistantSelection";

export function DemoApp({ fixture }: { fixture?: DemoFixture }) {
  const [revision, setRevision] = useState(0);
  return (
    <DemoProvider key={revision} fixture={fixture}>
      <OfficialConnectionProvider>
        <AssistantSelectionBoundary>
          <Workspace
            reset={() => {
              window.history.replaceState({}, "", "#project");
              setRevision((old) => old + 1);
            }}
          />
        </AssistantSelectionBoundary>
      </OfficialConnectionProvider>
    </DemoProvider>
  );
}
function AssistantSelectionBoundary({ children }: { children: ReactNode }) {
  const d = useDemo();
  return (
    <AssistantSelectionProvider
      scope={{
        fixture: d.isFixture,
        projectId: d.backendProjectId,
        episodeId: d.selectedEpisodeId,
        page: d.page,
      }}
    >
      {children}
    </AssistantSelectionProvider>
  );
}
function Workspace({ reset }: { reset: () => void }) {
  const d = useDemo();
  const account = useOfficialConnection();
  const global = pages[d.page][2] < 0;
  const activeStage = pages[d.page][2];
  const activeProject = d.projects.find((project) => String(project.id) === d.value("projectId"));
  const projectUnavailable = !global && !activeProject;
  const sourceUnavailable =
    d.isFixture &&
    !!activeProject?.backendId &&
    activeProject.backendId === d.backendProjectId &&
    ["story", "script"].includes(d.page) &&
    !d.value("source").trim();
  const missingPageData =
    !activeProject ||
    (d.isFixture && ["story", "script"].includes(d.page) && !d.value("source").trim()) ||
    (d.isFixture && d.page === "world" && !d.value("worldNote").trim()) ||
    (d.isFixture && d.page === "assets" && d.localAssets.length === 0) ||
    (d.isFixture && d.page === "voice" && d.characters.length === 0);
  const management = global || projectUnavailable;
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
  const providerState = d.providerSettings.state;
  const serviceStatus = d.isFixture
    ? "未连接真实服务"
    : providerState.kind === "loading"
      ? "正在读取服务配置"
      : providerState.kind === "error"
        ? "服务配置读取失败"
        : providerState.response.data.length === 0
          ? "没有 API 连接"
          : `已配置 ${providerState.response.data.length} 个模型连接 · 可用性待核验`;
  const officialStatus = account
    ? readinessLabels[assessChatGPTConnection(account.connection)]
    : "账号状态未读取";
  const taskState = d.taskQueue.state;
  const notificationDescription = d.isFixture
    ? d.tasks.length
      ? d.tasks.map((task) => `${task.name} · ${task.status}`).join("\n")
      : "暂无新通知。这里会展示本次演示中的任务进度。"
    : !d.backendProjectId
      ? "当前未选择真实项目。请先创建或选择项目，再查看制作任务。"
      : taskState.kind === "loading" || taskState.kind === "idle"
        ? "正在读取当前项目的制作任务。"
        : taskState.kind === "error"
          ? "任务队列暂时无法读取。请打开右侧“任务”面板重新读取。"
          : taskState.response.data.tasks.length === 0
            ? "当前项目还没有制作任务。"
            : taskState.response.data.tasks
                .map((item) => `${item.node.node_type} · ${item.presentation.status_label}`)
                .join("\n");
  return (
    <div
      className={`demo-root ${!d.isFixture ? "production-workbench" : ""} ${global ? "global-shell" : "project-shell"} ${hasStage ? "has-stage" : "no-stage"} ${management ? "management-shell" : "creation-shell"} ${pro ? "is-pro" : "is-simple"} ${hasRail ? "has-rail" : "no-rail"}`}
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
          onChange={async (event) => {
            const project = d.projects.find((item) => item.id === Number(event.target.value));
            if (!project) return;
            if (await d.selectRealProject(project.id)) d.go("project");
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
        {!management && (
          <>
            <select
              className="episode-select"
              aria-label="剧集选择"
              value={d.isFixture ? d.value("episode") : (d.selectedEpisodeId ?? "")}
              disabled={!d.isFixture && (d.episodeState !== "ready" || d.episodes.length === 0)}
              onChange={(event) =>
                d.isFixture
                  ? d.put("episode", event.target.value)
                  : void d.selectRealEpisode(event.target.value)
              }
            >
              {!d.isFixture && (
                <option value="">
                  {d.episodeState === "loading" ? "正在读取剧集" : "选择剧集"}
                </option>
              )}
              {d.isFixture ? (
                <>
                  <option>第 1 集 · 重逢</option>
                  <option>第 2 集 · 回声</option>
                </>
              ) : (
                d.episodes.map((episode) => (
                  <option key={episode.id} value={episode.id}>
                    {episode.title}
                  </option>
                ))
              )}
            </select>
            <Button
              disabled={
                d.episodeState === "loading" ||
                d.episodeState === "storage-error" ||
                d.episodeCreateInFlight ||
                !!d.episodeCreateMarker
              }
              onClick={() =>
                d.setEditor({
                  title: "新建剧集",
                  fields: [{ key: "title", label: "剧集名称", value: "", required: true }],
                  confirm: "创建剧集",
                  save: async (data) => {
                    const title = data.title?.trim();
                    if (!title) return false;
                    const outcome = await d.createRealEpisode({ title });
                    if (outcome.kind !== "SUCCEEDED") {
                      d.notify(
                        outcome.kind === "REMOTE_UNKNOWN"
                          ? "创建结果待确认，请关闭窗口并刷新剧集列表核对。"
                          : "剧集未创建，请核对名称和工作区连接后重试。",
                      );
                      return false;
                    }
                    d.notify("剧集已创建并读回，可以开始编写剧本。");
                  },
                })
              }
            >
              新建剧集
            </Button>
            {(d.episodeState === "error" || d.episodeState === "storage-error") && (
              <Button onClick={() => void d.refreshRealEpisodes()}>刷新剧集列表</Button>
            )}
            {d.episodeCreateMarker && d.episodeState === "ready" && (
              <>
                <p role="status">
                  {d.episodeCreateInFlight
                    ? "正在创建剧集，请等待结果后再试。"
                    : "上次创建结果待确认，请刷新列表后核对。"}
                </p>
                <Button
                  onClick={d.acknowledgeEpisodeCreation}
                  disabled={!d.episodeAcknowledgementReady}
                >
                  我已核对结果，允许新建
                </Button>
              </>
            )}
          </>
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
          {d.isFixture
            ? serviceStatus
            : `API / Sub2API：${serviceStatus} · ChatGPT：${officialStatus}`}
        </button>
        {d.isFixture && (
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
        )}
        <Button
          aria-label="通知"
          icon="bell"
          onClick={() =>
            d.setEditor({
              title: "通知",
              description: notificationDescription,
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
          {d.isFixture ? (
            <div className="local-note">
              <span>
                存储空间 <small>128 GB / 1 TB</small>
              </span>
              <progress aria-label="演示存储空间" value={128} max={1024} />
              <small>{global ? "单用户 · 不包含团队权限" : "本地样例 · 不产生费用"}</small>
            </div>
          ) : (
            <div className="local-note">
              <small>存储用量尚未接入</small>
            </div>
          )}
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
          {sourceUnavailable ? (
            <SourceContentEmpty page={d.page} onOpenSource={() => d.go("source")} />
          ) : missingPageData && !global && d.page !== "project" ? (
            <ProjectContentEmpty page={d.page} />
          ) : homes.includes(d.page) ? (
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
function ProjectContentEmpty({ page }: { page: PageId }) {
  return (
    <section className="v2-visual-page" role="status">
      <h1>{pages[page][0]}</h1>
      <p>尚未选择真实项目。创建或选择项目后，才会读取此页面的内容。</p>
    </section>
  );
}
function SourceContentEmpty({ page, onOpenSource }: { page: PageId; onOpenSource: () => void }) {
  return (
    <section className="v2-visual-page" role="status">
      <h1>{pages[page][0]}</h1>
      <p>当前项目尚未导入真实来源，故事与剧本内容暂不可读取。</p>
      <Button onClick={onOpenSource}>前往来源输入</Button>
    </section>
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
      aria-label={label}
      title={label}
      onClick={() => d.go(page)}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}
