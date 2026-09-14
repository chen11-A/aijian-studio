import { useRef, useState } from "react";
import { stages } from "./data";
import { useDemo } from "./model";
import { Button, FlowFooter, Pill } from "./Common";
import { Icon, Logo } from "./Icon";
import storyArt from "./assets/v2/story-art.png";
import streetArt from "./assets/v2/street.png";
import cityArt from "./assets/v2/city-wide.png";
import "./v2-home.css";

const projectImages = [storyArt, streetArt, cityArt];
export function HomePages() {
  const d = useDemo();
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
      (data) => {
        if (d.workspaceState !== "connected") {
          d.notify("请先连接本地工作区，再创建真实项目。");
          return false;
        }
        const title = data.title!.trim();
        if (!title) return false;
        void d
          .createRealProject({
            name: title,
            aspect_ratio: "9:16",
            target_duration_seconds: 60,
            source_language: "zh-CN",
          })
          .then((outcome) => {
            if (outcome.kind === "SUCCEEDED") d.go("source");
          });
      },
    );
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
  const manageProject = (id: number) => {
    const project = d.projects.find((item) => item.id === id);
    if (!project) return;
    d.setEditor({
      title: `管理 ${project.name}`,
      fields: [
        { key: "name", label: "项目名称", value: project.name, required: true },
        {
          key: "action",
          label: "操作",
          value: "重命名",
          options: ["重命名", "收藏 / 取消收藏", "归档", "删除"],
        },
      ],
      confirm: "确认修改演示项目",
      save: (data) => {
        if (data.action === "删除") {
          setTimeout(
            () =>
              d.setEditor({
                title: `删除 ${project.name}？`,
                description: "仅移除当前内存中的演示项目，刷新后样例恢复。",
                confirm: "确认删除",
                save: () => {
                  d.setProjects((old) => old.filter((item) => item.id !== id));
                  if (Number(d.value("projectId", "1")) === id) {
                    const next = d.projects.find((item) => item.id !== id);
                    d.put("projectId", String(next?.id ?? ""));
                    d.put("title", next?.name ?? "新故事");
                  }
                  d.notify("演示项目已删除");
                },
              }),
            0,
          );
          return;
        }
        d.setProjects((old) =>
          old.map((item) =>
            item.id === id
              ? {
                  ...item,
                  name: data.name!.trim(),
                  favorite: data.action === "收藏 / 取消收藏" ? !item.favorite : item.favorite,
                  status: data.action === "归档" ? "已归档" : item.status,
                }
              : item,
          ),
        );
        if (Number(d.value("projectId", "1")) === id) d.put("title", data.name!.trim());
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
          const inspiration = "都市悬疑 · 遗失的记忆：写下属于你的故事。";
          d.put("input", inspiration);
          d.put("source", inspiration);
          d.put("sourceApproved", "false");
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
        ? project.status !== "已归档"
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
          <p>《{d.value("title")}》本地演示样例 · 所有状态仅用于界面与流程复刻。</p>
        </div>
        <Button onClick={() => d.go("projectSettings")}>项目设置</Button>
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
              <p>近未来记忆都市。当前查看的是内置演示快照，可从故事理解开始逐页核对。</p>
            </section>
            <Button onClick={() => d.go("projectSettings")}>项目设置</Button>
            <Button onClick={() => d.go("script")}>查看剧本</Button>
          </div>
        </div>
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
