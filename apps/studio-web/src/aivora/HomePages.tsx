import { useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import type { ProjectData } from "../api/studio";
import { stages } from "./data";
import { useDemo } from "./model";
import { Button, FlowFooter, Pill } from "./Common";
import { Icon, Logo } from "./Icon";
import storyArt from "./assets/v2/story-art.png";
import streetArt from "./assets/v2/street.png";
import cityArt from "./assets/v2/city-wide.png";
import {
  closePendingProjectUpdate,
  readPendingProjectUpdate,
  readProjectUpdateJournal,
  updateManagedProject,
} from "./adapters/projectManagement";
import type { ProjectJournalState } from "./adapters/projectManagement";
import "./v2-home.css";

const projectImages = [storyArt, streetArt, cityArt];
export function HomePages() {
  const d = useDemo();
  const live = useRef(d);
  live.current = d;
  const transport = useMemo(createStudioTransport, []);
  const managementStorage = useMemo(() => {
    try { return window.localStorage; } catch { return null; }
  }, []);
  const managementInFlight = useRef(false);
  const managedProjectRef = useRef<string | null>(null);
  const [managedProjectId, setManagedProjectId] = useState<string | null>(null);
  const [managementJournal, setManagementJournal] = useState<ProjectJournalState>({ kind: "EMPTY" });
  const [managementNotice, setManagementNotice] = useState("");
  const [managementBusy, setManagementBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  const newProject = () =>
    d.edit(
      "新建项目",
      [
        { key: "title", label: "作品名称", value: "", required: true },
        { key: "input", label: "故事灵感", type: "textarea", value: d.value("input") },
      ],
      async (data) => {
        if (d.workspaceState !== "connected") {
          d.notify("请先连接本地工作区，再创建真实项目。");
          return false;
        }
        const title = data.title!.trim();
        if (!title) return false;
        const outcome = await d.createRealProject({
          name: title,
          aspect_ratio: "9:16",
          target_duration_seconds: 60,
          source_language: "zh-CN",
        });
        if (outcome.kind === "SUCCEEDED") d.go("source");
        return outcome.kind === "SUCCEEDED" ? undefined : false;
      },
    );
  const newEpisode = () =>
    d.setEditor({
      title: "新建剧集",
      fields: [{ key: "title", label: "剧集名称", value: "", required: true }],
      confirm: "创建剧集",
      save: (data) => {
        const title = data.title?.trim();
        if (!title) return false;
        void d.createRealEpisode({ title });
      },
    });
  const openProject = (id: number) => {
    const project = d.projects.find((item) => item.id === id);
    if (!project) return;
    if (!project.backendId) {
      d.notify("该项目没有本地工作区标识，无法打开。");
      return;
    }
    void d.selectRealProject(id);
    d.go("project");
  };
  const showManagedProject = (project: ProjectData) => {
    const current = live.current;
    const card = current.projects.find((item) => item.backendId === project.id);
    if (!card || (card.revision ?? 0) > project.revision) return;
    current.setProjects((old) => old.map((item) =>
      item.backendId === project.id && (item.revision ?? 0) <= project.revision
        ? { ...item, name: project.name,
            status: project.status === "archived" ? "已归档" : "进行中",
            updated: project.updated_at, revision: project.revision,
            episode: `REV ${project.revision}` }
        : item));
    if (current.backendProjectId === project.id &&
      current.value("projectId") === String(card.id)) current.put("title", project.name);
  };
  const refreshManagedJournal = (projectId: string) => {
    setManagementJournal(managementStorage
      ? readProjectUpdateJournal(managementStorage, projectId)
      : { kind: "BLOCKED" });
  };
  const inspectPendingManagement = async (close: boolean) => {
    const projectId = managedProjectRef.current;
    if (!projectId || !managementStorage || managementInFlight.current) return;
    managementInFlight.current = true;
    setManagementBusy(true);
    const result = close
      ? await closePendingProjectUpdate(transport, managementStorage, projectId)
      : await readPendingProjectUpdate(transport, managementStorage, projectId);
    managementInFlight.current = false;
    setManagementBusy(false);
    if (result.kind === "CURRENT") showManagedProject(result.project);
    if (managedProjectRef.current === projectId) {
      refreshManagedJournal(projectId);
      setManagementNotice(result.kind === "CURRENT"
        ? `${close ? "本地未知记录已结束。" : "已读取权威项目状态。"}${result.targetReached
          ? "当前字段已达到目标；无法归因于原 PATCH。" : "当前字段未达到原目标。"}`
        : result.kind === "UNAVAILABLE" ? result.message
          : "项目状态读取未知；原操作仍锁定，未重新提交。 ");
    }
  };
  const manageProject = (id: number) => {
    const project = d.projects.find((item) => item.id === id);
    if (!project) return;
    if (!project.backendId || d.isFixture) {
      d.notify("只有已连接的真实项目可修改；样例不能提交项目更新。");
      return;
    }
    const projectRevision = project.revision;
    if (typeof projectRevision !== "number" ||
      !Number.isSafeInteger(projectRevision) || projectRevision <= 0) {
      d.notify("项目修订号不可用；请刷新项目列表后再修改。");
      return;
    }
    managedProjectRef.current = project.backendId;
    setManagedProjectId(project.backendId);
    setManagementNotice("");
    const journal = managementStorage
      ? readProjectUpdateJournal(managementStorage, project.backendId)
      : { kind: "BLOCKED" as const };
    setManagementJournal(journal);
    if (journal.kind !== "EMPTY") {
      d.notify(journal.kind === "PENDING"
        ? "此项目有结果未知的更新；请在项目中心先读取权威状态。"
        : "本地项目更新记录无法读取；已阻止提交。");
      return;
    }
    const originalStatus = project.status === "已归档" ? "archived" : "active";
    d.setEditor({
      title: `管理 ${project.name}`,
      description: "重命名和归档写入本地工作区，并在读回后显示。归档仅改变分类，不停止在途任务、不删除产物。收藏与删除尚无持久合同，当前不可执行。",
      fields: [
        { key: "name", label: "项目名称", value: project.name, required: true },
        {
          key: "action",
          label: "操作",
          value: "重命名",
          options: ["重命名", originalStatus === "archived" ? "恢复项目" : "归档",
            "收藏 / 取消收藏（待接入）", "删除（待影响核对）"],
        },
      ],
      confirm: "保存真实项目修改",
      validate: () => {
        const current = live.current.projects.find((item) => item.backendId === project.backendId);
        if (!current || typeof current.revision !== "number" ||
          !Number.isSafeInteger(current.revision) || current.revision <= 0 ||
          current.revision !== projectRevision)
          return "项目列表已变化，请关闭窗口、刷新项目列表后重新核对。";
      },
      save: async (data) => {
        const targetName = (data.name ?? "").trim();
        if (data.action?.startsWith("收藏") || data.action?.startsWith("删除")) {
          d.notify(data.action.startsWith("删除")
            ? "尚无删除影响清单和确认合同；未删除项目或任何产物。"
            : "收藏尚无持久合同；未修改项目或界面状态。");
          return false;
        }
        if (!targetName || [...targetName].length > 80 || /[\u0000-\u001f\u007f]/.test(targetName)) {
          d.notify("项目名称需为 1 至 80 个字符且不能含控制字符。");
          return false;
        }
        if (!managementStorage || !transport.updateProject || managementInFlight.current) {
          d.notify("当前桌面版本缺少项目更新能力或更新正在进行；未提交。");
          return false;
        }
        const current = live.current.projects.find((item) => item.backendId === project.backendId);
        if (!current || typeof current.revision !== "number" ||
          !Number.isSafeInteger(current.revision) || current.revision <= 0 ||
          current.revision !== projectRevision ||
          managedProjectRef.current !== project.backendId) {
          d.notify("项目身份或修订已变化；未提交，请刷新项目列表。");
          return false;
        }
        const nextStatus = data.action === "归档" ? "archived"
          : data.action === "恢复项目" ? "active" : undefined;
        const nameChanged = targetName !== project.name;
        if (!nameChanged && nextStatus === undefined) {
          d.notify("项目名称未变化；未发出更新请求。");
          return false;
        }
        managementInFlight.current = true;
        setManagementBusy(true);
        const result = await updateManagedProject(transport, managementStorage, project.backendId, {
          expectedRevision: projectRevision,
          ...(nameChanged ? { name: targetName } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
        });
        managementInFlight.current = false;
        setManagementBusy(false);
        if (result.kind === "APPLIED" || result.kind === "REJECTED") {
          if (result.project) showManagedProject(result.project);
        } else if (result.kind === "UNKNOWN" && result.current) {
          showManagedProject(result.current);
        }
        if (managedProjectRef.current === project.backendId) {
          refreshManagedJournal(project.backendId);
          const notice = result.kind === "APPLIED"
            ? "项目已由更新回执与权威 GET 双重核对。"
            : result.kind === "REJECTED"
              ? `项目更新被明确拒绝：${result.status} / ${result.code}。已读取当前项目，未宣称保存。`
              : result.kind === "UNKNOWN"
                ? `更新结果未知；${result.targetReached ? "当前字段已达目标，但不能归因原 PATCH。" :
                  "当前字段尚未确认达到目标。"}原操作已锁定，不能重复提交。`
                : result.kind === "TRACKED" ? "已有未确认的原更新；没有重复 PATCH。"
                  : result.message;
          setManagementNotice(notice);
          d.notify(notice);
        }
        return result.kind === "APPLIED" ? undefined : false;
      },
    });
  };
  const input = (
    <input
      ref={file}
      className="sr-only"
      aria-label="导入故事文件"
      type="file"
      accept=".txt,text/plain"
      onChange={(event) => {
        const selected = event.target.files?.[0];
        if (selected) void d.importRealSource(selected);
      }}
    />
  );
  const importOptions = () =>
    d.setEditor({
      title: "从已有内容开始",
      description: "选择一个已有入口。导入来源需要先连接本地工作区。",
      fields: [
        {
          key: "reference",
          label: "参考图片",
          value: "雨夜街道",
          options: ["雨夜街道", "角色多视图", "城市光影"],
        },
        {
          key: "action",
          label: "下一步",
          value: "导入小说 / 剧本",
          options: ["导入小说 / 剧本", "添加参考图片", "从灵感模板开始"],
        },
      ],
      save: (data) => {
        if (data.action === "导入小说 / 剧本") setTimeout(() => file.current?.click(), 0);
        else if (data.action === "添加参考图片") {
          d.setReferences((old) => [...new Set([...old, data.reference!])]);
          d.notify("参考图片已加入当前界面会话");
        } else {
          d.notify("请在来源页选择“原创灵感”创建创作简报草稿；不会把灵感写入外部原文。");
          d.put("c3DraftIntent", "original");
          d.go("source");
        }
      },
    });
  const header = (title: string) => (
    <header className="page-title v2-home-heading">
      <div>
        <h1>{title}</h1>
        <p>
          {d.page === "project"
            ? d.workspaceState === "connected"
              ? `已连接本地工作区 · ${d.projects.length} 个项目。`
              : "正在读取本地工作区项目。"
            : "管理已读取的本地项目。"}
        </p>
      </div>
      <div className="actions">
        {d.page === "project" && (
          <Button aria-label="打开项目中心" onClick={() => d.go("projects")}>
            项目中心
          </Button>
        )}
        <Button onClick={() => d.go("project")}>
          {d.page === "project" ? "项目设置" : "返回项目"}
        </Button>
      </div>
    </header>
  );
  const state = (empty: string) => {
    const mode =
      d.workspaceState === "loading"
        ? "loading"
        : d.workspaceState === "error"
          ? "error"
          : d.workspaceState === "connected" && !d.projects.length
            ? "empty"
            : d.scenario;
    return mode === "normal" ? null : (
      <div className={`v2-home-state ${mode}`} role="status" aria-busy={mode === "loading"}>
        <Icon name={mode === "error" ? "review" : "folder"} size={28} />
        <h2>
          {mode === "loading"
            ? "正在读取本地项目"
            : mode === "error"
              ? "本地工作区暂时无法读取"
              : mode === "empty"
                ? empty
                : "真实创作服务尚未接入"}
        </h2>
        <p>
          {mode === "error"
            ? "请检查桌面服务后重试。"
            : mode === "empty"
              ? "创建项目后会显示在这里。"
              : "正在等待桌面服务返回项目列表。"}
        </p>
        <Button onClick={() => void d.connectRealWorkspace()} disabled={mode === "loading"}>
          {mode === "error" ? "重试读取" : mode === "empty" ? "刷新项目列表" : "正在读取"}
        </Button>
      </div>
    );
  };
  const projects = d.projects.filter(
    (project) =>
      project.name.includes(query) &&
      (filter === "全部"
        ? true
        : filter === "收藏"
          ? project.favorite
          : project.status === filter),
  );
  if (d.page === "launch")
    return (
      <div className="v2-launch">
        <div className="v2-launch-art">
          <img src={storyArt} alt="星夜之城 · 样例插画" />
        </div>
        <div className="v2-launch-copy">
          <div className="v2-launch-brand">
            <Logo />
            <strong>AIVORA</strong>
          </div>
          <h1>把故事，变成看得见的世界。</h1>
          <p>一个创作入口，走完故事、角色与世界、分镜、制作和审片。</p>
          <Button primary disabled={d.scenario === "loading"} onClick={() => d.go("home")}>
            {d.scenario === "loading" ? "正在初始化" : "进入 UI 演示"}
          </Button>
          <Pill>本地样例 · 不调用生成服务</Pill>
          {d.scenario === "error" && (
            <div className="v2-launch-error" role="alert">
              初始化失败，入口仍保留。<Button onClick={() => d.setScenario("normal")}>重试</Button>
            </div>
          )}
          <small>DESKTOP CREATOR / V2.0</small>
        </div>
      </div>
    );
  if (d.page === "home")
    return (
      <div className="v2-home-page v2-management-home">
        {input}
        {header("创作首页")}
        <div className="v2-home-body">
          <section className="v2-welcome">
            <h2>
              <Icon name="home" size={16} />
              欢迎回来，{d.value("userName", "陈")}
            </h2>
            <button className="v2-welcome-copy" onClick={importOptions}>
              继续已有的演示项目，或从一段故事开始。
            </button>
            <Button primary onClick={newProject}>
              新建项目
            </Button>
            <Button
              onClick={() => void d.connectRealWorkspace()}
              disabled={d.workspaceState === "loading"}
            >
              {d.workspaceState === "connected"
                ? "本地工作区已连接"
                : d.workspaceState === "loading"
                  ? "正在连接"
                  : "连接本地工作区"}
            </Button>
          </section>
          <div className="v2-recent-heading">
            <h2>最近项目</h2>
            <button onClick={() => d.go("projects")}>全部项目 →</button>
          </div>
          <div className="v2-recent-list">
            {state("还没有项目") ??
              (projects.length ? (
                projects.map((project) => (
                  <article className="v2-recent-card" key={project.id}>
                    <button className="v2-recent-art" onClick={() => openProject(project.id)}>
                      <img
                        src={projectImages[project.id - 1] ?? project.image}
                        alt={`${project.name}封面`}
                      />
                    </button>
                    <div>
                      <h3>{project.name}</h3>
                      <Button onClick={() => openProject(project.id)}>打开</Button>
                    </div>
                    <p>工作阶段尚未从本地工作区读取</p>
                  </article>
                ))
              ) : (
                <div className="v2-home-state">
                  <h2>还没有项目</h2>
                  <Button onClick={newProject}>新建项目</Button>
                </div>
              ))}
          </div>
          <p className="v2-home-foot">项目列表来自本地工作区；界面不声明视频、费用或发布状态。</p>
        </div>
      </div>
    );
  if (d.page === "projects")
    return (
      <div className="v2-home-page v2-management-home">
        {input}
        {header("项目中心")}
        <div className="v2-projects-body">
          <div className="v2-project-search">
            <label>
              搜索项目
              <input
                placeholder="输入项目名称…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="筛选项目"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {["全部", "进行中", "草稿", "已完成", "已归档", "收藏"].map((label) => (
                <option key={label}>{label}</option>
              ))}
            </select>
            <Button primary onClick={newProject}>
              新建项目
            </Button>
            <Button
              onClick={() => void d.connectRealWorkspace()}
              disabled={d.workspaceState === "loading"}
            >
              {d.workspaceState === "connected"
                ? "本地工作区已连接"
                : d.workspaceState === "loading"
                  ? "正在连接"
                  : "连接本地工作区"}
            </Button>
          </div>
          {filter === "收藏" &&
            <p role="status">收藏尚无项目持久字段，此筛选无法给出真实结果。</p>}
          {(filter === "草稿" || filter === "已完成") &&
            <p role="status">项目接口目前只提供进行中与已归档状态，无法判断此筛选。</p>}
          {managedProjectId && managementJournal.kind !== "EMPTY" && (
            <div role="alert" className="v2-home-state">
              <p>项目 <code>{managedProjectId}</code> 的更新记录
                {managementJournal.kind === "PENDING" ? "结果未确认。" : "无法安全读取。"}</p>
              {managementJournal.kind === "PENDING" && (
                <div className="actions">
                  <Button disabled={managementBusy}
                    onClick={() => void inspectPendingManagement(false)}>查询当前项目状态</Button>
                  <Button disabled={managementBusy}
                    onClick={() => void inspectPendingManagement(true)}>
                    核对并结束本地未知记录
                  </Button>
                </div>
              )}
              <p>查询只说明当前项目字段，不证明原 PATCH 已执行；本地记录未结束前不能再次提交。</p>
            </div>
          )}
          {managementNotice && <p role="status">{managementNotice}</p>}
          <div className="v2-project-table">
            <div className="v2-project-table-head">
              <span>项目</span>
              <span>当前页面</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            <div className="v2-project-rows" data-scroll-region="projects-rows">
              {state("还没有项目") ??
                (projects.length ? (
                  projects.map((project) => (
                    <div className="v2-project-row" key={project.id}>
                      <div>
                        <img src={projectImages[project.id - 1] ?? project.image} alt="" />
                        <button title={project.name} onClick={() => manageProject(project.id)}>
                          {project.name}
                        </button>
                      </div>
                      <span>尚未读取</span>
                      <span>
                        <Pill>{project.status}</Pill>
                      </span>
                      <div>
                        <Button onClick={() => openProject(project.id)}>打开项目</Button>
                        <button
                          className="v2-project-more"
                          aria-label={`管理${project.name}`}
                          onClick={() => manageProject(project.id)}
                        >
                          ···
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="v2-home-state">
                    <h2>没有符合条件的项目</h2>
                    <Button
                      onClick={() => {
                        setQuery("");
                        setFilter("全部");
                      }}
                    >
                      清除筛选
                    </Button>
                  </div>
                ))}
            </div>
          </div>
          <p className="v2-home-foot">
            {projects.length} 个本地项目 · 列表可内部滚动，整个工作台不滚动
          </p>
        </div>
      </div>
    );
  const currentProject = d.projects.find((project) => String(project.id) === d.value("projectId"));
  if (!currentProject)
    return (
      <div className="v2-home-page v2-project-home">
        <header className="page-title v2-home-heading">
          <div>
            <h1>项目创作首页</h1>
            <p>尚未选择真实项目。</p>
          </div>
          <div className="actions">
            <Button aria-label="打开项目中心" onClick={() => d.go("projects")}>
              项目中心
            </Button>
          </div>
        </header>
        <div className="v2-project-home-body">{state("还没有项目")}</div>
      </div>
    );
  return (
    <div className="v2-home-page v2-project-home">
      {input}
      <header className="page-title v2-home-heading">
        <div>
          <h1>项目创作首页</h1>
          <p>《{d.value("title")}》的本地工作区项目。</p>
        </div>
        <div className="actions">
          <Button aria-label="打开项目中心" onClick={() => d.go("projects")}>
            项目中心
          </Button>
          <Button onClick={() => d.go("projectSettings")}>项目设置</Button>
        </div>
      </header>
      <div className="v2-project-home-body">
        <div className="v2-project-overview">
          <div className="v2-project-cover">
            {state("还没有视觉参考") ?? (
              <button
                onClick={() =>
                  d.setEditor({ title: `${d.value("title")} · 参考插画`, image: storyArt })
                }
              >
                <img src={storyArt} alt={`${d.value("title")}参考插画`} />
              </button>
            )}
          </div>
          <div className="v2-project-summary">
            <section>
              <h2>
                <Icon name="home" size={16} />
                {d.value("title")}
              </h2>
              <p>
                {d.isFixture
                  ? "近未来记忆都市。当前查看的是内置演示快照，可从故事理解开始逐页核对。"
                  : "当前展示的是本地工作区项目与剧集状态；后续内容以已读取的来源与审核状态为准。"}
              </p>
            </section>
            <Button onClick={() => d.go("projectSettings")}>项目设置</Button>
            <Button onClick={() => d.go("script")}>查看剧本</Button>
          </div>
        </div>
        <section className="v2-story-card" aria-label="真实剧集">
          <h2>剧集</h2>
          {d.episodeState === "loading" ? (
            <p role="status">正在读取本地工作区剧集。</p>
          ) : d.episodeState === "unavailable" ? (
            <p role="status">当前版本暂不支持剧集操作。</p>
          ) : d.episodeState === "storage-error" ? (
            <p role="status">本地选择记录不可用，已保守锁定剧集创建。</p>
          ) : d.episodeState === "error" ? (
            <p role="status">真实剧集读取失败；已清空当前选择，请刷新后重试。</p>
          ) : d.episodes.length ? (
            <ul>
              {d.episodes.map((episode) => (
                <li key={episode.id}>
                  <Button onClick={() => void d.selectRealEpisode(episode.id)}>
                    {episode.title}
                  </Button>
                  {d.selectedEpisodeId === episode.id ? " · 当前剧集" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">本地工作区尚未返回剧集。</p>
          )}
          <div className="actions">
            <Button onClick={() => void d.refreshRealEpisodes()}>刷新剧集列表</Button>
            <Button onClick={newEpisode} disabled={d.episodeState === "storage-error"}>
              新建剧集
            </Button>
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
          </div>
        </section>
        <div className="v2-project-stages">
          {stages.map((stage, index) => (
            <button key={stage.page} onClick={() => d.go(stage.page)}>
              <h2>
                <Icon name={["book", "users", "film", "spark", "review"][index]!} size={16} />
                {stage.label}
              </h2>
              <span>{["样例初稿", "参考样例", "静帧预演", "未接入服务", "批注示例"][index]}</span>
              <p>
                可浏览界面
                <br />
                不触发生成
              </p>
            </button>
          ))}
        </div>
      </div>
      <FlowFooter
        label="继续故事理解"
        action={() => d.go("story")}
        secondaryLabel="项目中心"
        secondaryAction={() => d.go("projects")}
        reason="保持五阶段 · 演示数据独立"
      />
    </div>
  );
}
