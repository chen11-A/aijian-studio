import { useEffect, useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import type { ProjectData } from "../api/studio";
import { useDemo } from "./model";
import { Button, FlowFooter } from "./Common";
import { Icon } from "./Icon";
import avatar from "./assets/v2/avatar.png";
import { readAppPreferences, saveAppPreferences } from "./adapters/appPreferences";
import { hasAsciiControlCharacter } from "./textValidation";
import type { AppPreferencesGateway, AppPreferencesResponse } from "./adapters/appPreferences";
import {
  closePendingProjectUpdate,
  readPendingProjectUpdate,
  readProjectUpdateJournal,
  updateManagedProject,
} from "./adapters/projectManagement";
import type { ProjectJournalState } from "./adapters/projectManagement";

export function SettingsPage() {
  const d = useDemo();
  if (!d.isFixture && d.page === "settings") return <PersistedUserSettings />;
  if (!d.isFixture && d.page === "projectSettings")
    return (
      <PersistedProjectSettings key={d.backendProjectId ?? "none"} projectId={d.backendProjectId} />
    );
  return <FixtureSettingsPage />;
}

function FixtureSettingsPage() {
  const d = useDemo();
  const form = useRef<HTMLFormElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const project = d.page === "projectSettings";
  const category = d.value("settingsCategory", "个人资料");
  const categories = ["个人资料", "界面语言", "外观", "创作默认值", "隐私"];
  const defaults: Record<string, string> = project
    ? {
        title: d.value("title"),
        episode: d.value("episode"),
        projectDescription: "一个关于记忆、选择与重逢的故事。",
        ratio: "16:9",
        projectTimebase: "24/1 帧每秒",
        projectLanguage: "简体中文",
        generationPolicy: "分阶段 · 高成本任务等待确认",
        thirdPartyPolicy: "默认不发送任何样例外数据",
        versionPolicy: "修改生成新版本，不覆盖旧结果",
      }
    : {
        userName: "陈",
        bio: "每一个故事，都值得被看见。",
        savePath: "本地创作目录（演示）",
        uiLanguage: "简体中文",
        uiTheme: "深蓝电影工作台",
        profileAvatar: avatar,
      };
  const prefix = `draft-${d.page}-${project ? d.value("projectId", "1") : "user"}-`;
  const field = (key: string) => d.value(prefix + key, d.value(key, defaults[key]));
  const change = (key: string, value: string) => {
    d.put(prefix + key, value);
    d.put("settingsSaved", "false");
  };
  const dirty = Object.keys(defaults).some((key) => field(key) !== d.value(key, defaults[key]));
  const cancel = () => {
    Object.keys(defaults).forEach((key) => d.put(prefix + key, d.value(key, defaults[key])));
    d.put("settingsSaved", "false");
    d.notify("已恢复上次应用的演示设置");
  };
  const leave = () => {
    if (dirty)
      d.setEditor({
        title: "离开未保存的设置？",
        description: "本次草稿会继续保留，返回后仍可编辑。已应用设置不变。",
        confirm: "保留草稿并返回",
        save: () => d.go("project"),
      });
    else d.go("project");
  };
  const apply = () => {
    for (const key of Object.keys(defaults)) d.put(key, field(key));
    if (project)
      d.setProjects((old) =>
        old.map((item) =>
          item.id === Number(d.value("projectId", "1"))
            ? { ...item, name: field("title").trim(), episode: field("episode") }
            : item,
        ),
      );
    d.put("settingsSaved", "true");
    d.notify("设置已应用到演示内存，未修改磁盘或系统配置");
  };
  const extraProject = () =>
    d.setEditor({
      title: "剧集与项目说明",
      fields: [
        {
          key: "episode",
          label: "当前剧集",
          value: field("episode"),
          options: ["第 1 集 · 重逢", "第 2 集 · 回声"],
        },
        {
          key: "projectDescription",
          label: "项目说明",
          type: "textarea",
          value: field("projectDescription"),
        },
      ],
      save: (data) => {
        change("episode", data.episode!);
        change("projectDescription", data.projectDescription!);
      },
    });
  const row = (key: string, label: string, options?: string[]) => (
    <label key={key}>
      {label}
      {options ? (
        <select value={field(key)} onChange={(e) => change(key, e.target.value)}>
          {options.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      ) : (
        <input
          value={field(key)}
          required={key === "title" || key === "userName"}
          onChange={(e) => change(key, e.target.value)}
        />
      )}
    </label>
  );
  const state = d.scenario !== "normal" && (
    <div className="v2-settings-state" role="status" aria-busy={d.scenario === "loading"}>
      <span>
        {d.scenario === "loading"
          ? "正在加载设置；草稿保留"
          : d.scenario === "error"
            ? "演示保存错误；输入内容已保留"
            : d.scenario === "empty"
              ? "还没有自定义设置，显示默认值"
              : "系统设置未接入，仅支持本地演示"}
      </span>
      <Button onClick={() => d.setScenario("normal")}>
        {d.scenario === "error" ? "重试演示" : "查看样例"}
      </Button>
    </div>
  );
  return (
    <div
      className={`v2-utility-page v2-settings-page ${project ? "v2-project-settings" : "v2-utility-management"}`}
    >
      <header className="page-title v2-utility-heading">
        <div>
          <h1>{project ? "项目设置" : "用户设置"}</h1>
          <p>
            {project
              ? `《${d.value("title")}》本地演示样例 · 所有状态仅用于界面与流程复刻。`
              : "管理你的创作与设置，不改变原始内容。"}
          </p>
        </div>
        <Button onClick={leave}>返回项目</Button>
      </header>
      <form
        ref={form}
        className="v2-settings-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (project && !field("title").trim()) {
            d.notify("作品名称不能为空白");
            return;
          }
          if (d.scenario === "error") {
            d.notify("演示保存错误，已保留当前草稿");
            return;
          }
          if (
            project &&
            (field("ratio") !== d.value("ratio", "16:9") ||
              field("projectTimebase") !== d.value("projectTimebase", "24/1 帧每秒"))
          ) {
            d.setEditor({
              title: "确认修改项目画幅或时基",
              description:
                "本次只更新演示设置。已有参考图片、镜头和批注不会被重新生成或覆盖，仍保留原始时基。",
              confirm: "保存演示设置",
              save: apply,
            });
          } else apply();
        }}
      >
        {project ? (
          <>
            <section className="v2-utility-card v2-project-settings-card">
              <h2>
                <Icon name="settings" size={16} />
                项目基础设置
              </h2>
              <div className="v2-project-settings-fields">
                {row("title", "项目名称")}
                {row("ratio", "示例画幅", ["16:9", "9:16", "1:1"])}
                {row("projectTimebase", "演示时基", ["24/1 帧每秒", "25/1 帧每秒", "30/1 帧每秒"])}
                {row("projectLanguage", "内容语言", ["简体中文"])}
              </div>
              <Button onClick={extraProject}>剧集与项目说明</Button>
            </section>
            <section className="v2-utility-card v2-project-settings-card">
              <h2>
                <Icon name="settings" size={16} />
                创作与隐私策略
              </h2>
              <div className="v2-project-settings-fields">
                {row("generationPolicy", "生成策略", ["分阶段 · 高成本任务等待确认"])}
                <label>
                  预算
                  <input readOnly value="尚未连接费用服务" />
                </label>
                {row("thirdPartyPolicy", "第三方发送", ["默认不发送任何样例外数据"])}
                {row("versionPolicy", "版本策略", ["修改生成新版本，不覆盖旧结果"])}
              </div>
              {state}
            </section>
          </>
        ) : (
          <>
            <aside className="v2-utility-card v2-settings-categories">
              <h2>
                <Icon name="settings" size={16} />
                设置分类
              </h2>
              {categories.map((label) => (
                <Button
                  key={label}
                  aria-pressed={category === label}
                  onClick={() => d.put("settingsCategory", label)}
                >
                  {label}
                </Button>
              ))}
            </aside>
            <section className="v2-utility-card v2-profile">
              <h2>
                <Icon name="users" size={16} />
                {category}
              </h2>
              <div className="v2-profile-content" data-scroll-region="settings-fields">
                {category === "个人资料" ? (
                  <>
                    <div className="v2-profile-picture">
                      <img src={field("profileAvatar")} alt="演示头像" />
                      <Button onClick={() => imageInput.current?.click()}>更换头像</Button>
                      <input
                        ref={imageInput}
                        type="file"
                        className="sr-only"
                        accept="image/png,image/jpeg,image/webp"
                        aria-label="选择头像图片"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          if (
                            !/^image\/(png|jpeg|webp)$/.test(file.type) ||
                            file.size > 2_000_000
                          ) {
                            d.notify("请选择 2MB 内的 PNG、JPEG 或 WebP 图片");
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => change("profileAvatar", String(reader.result));
                          reader.onerror = () => d.notify("头像读取失败，原头像仍保留");
                          reader.readAsDataURL(file);
                        }}
                      />
                    </div>
                    <div className="v2-profile-fields">
                      {row("userName", "昵称")}
                      {row("uiLanguage", "界面语言", ["简体中文"])}
                      {row("uiTheme", "外观", ["深蓝电影工作台"])}
                    </div>
                  </>
                ) : category === "界面语言" || category === "外观与语言" ? (
                  <div className="v2-settings-other">
                    {row("uiLanguage", "界面语言", ["简体中文"])}
                    <p>当前演示只提供中文文案；译文尚未接入。</p>
                  </div>
                ) : category === "外观" ? (
                  <div className="v2-settings-other">
                    {row("uiTheme", "外观", ["深蓝电影工作台"])}
                    <p>当前视觉母版使用深色工作台。</p>
                  </div>
                ) : category === "创作默认值" || category === "保存与缓存" ? (
                  <div className="v2-settings-other">
                    <label>
                      创作签名
                      <textarea
                        value={field("bio")}
                        onChange={(e) => change("bio", e.target.value)}
                      />
                    </label>
                    {row("savePath", "演示保存位置")}
                    <p>此路径仅是演示字段，浏览器不会创建目录或写入项目。</p>
                    <Button disabled title="需要正式桌面目录选择能力">
                      选择系统目录 · 未接入
                    </Button>
                  </div>
                ) : (
                  <div className="v2-settings-other">
                    <dl>
                      <dt>镜头排序</dt>
                      <dd>聚焦镜头后，Alt + 左 / 右</dd>
                      <dt>关闭弹窗</dt>
                      <dd>Escape</dd>
                      <dt>控件导航</dt>
                      <dd>Tab / Shift + Tab</dd>
                    </dl>
                    <p>无真实凭据、在线模型和项目持久化；导入文本只在当前内存中读取。</p>
                    <Button
                      onClick={() =>
                        d.setEditor({
                          title: "清理本次演示会话？",
                          description:
                            "仅清理 AI 会话、附件引用与输入草稿，项目、镜头、批注及磁盘不变。",
                          confirm: "清理演示会话",
                          save: () => {
                            d.setMessages([]);
                            d.setReferences([]);
                            d.setAiDraft("");
                            d.notify("演示会话已清理");
                          },
                        })
                      }
                    >
                      清理演示缓存
                    </Button>
                  </div>
                )}
                {state}
              </div>
            </section>
          </>
        )}
      </form>
      <FlowFooter
        secondaryLabel="取消"
        secondaryAction={cancel}
        label={project ? "保存项目设置" : "保存用户设置"}
        reason={
          d.value("settingsSaved") === "true"
            ? "已应用 · 仅本次演示"
            : dirty
              ? "有未保存的设置草稿"
              : project
                ? "ViewPolicy 不写入 Project · 不参与产物哈希"
                : "只修改演示设置 · 无团队与权限表"
        }
        action={() => form.current?.requestSubmit()}
      />
    </div>
  );
}

function validProject(value: unknown, projectId: string): value is ProjectData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const project = value as Partial<ProjectData>;
  return (
    project.id === projectId &&
    typeof project.name === "string" &&
    project.name.length > 0 &&
    project.aspect_ratio === "9:16" &&
    Number.isSafeInteger(project.target_duration_seconds) &&
    (project.target_duration_seconds ?? 0) >= 30 &&
    project.source_language === "zh-CN" &&
    (project.status === "active" || project.status === "archived") &&
    Number.isSafeInteger(project.revision) &&
    (project.revision ?? 0) >= 1 &&
    typeof project.updated_at === "string"
  );
}

function PersistedProjectSettings({ projectId }: { projectId: string | null }) {
  const d = useDemo();
  const live = useRef(d);
  live.current = d;
  const transport = useMemo(createStudioTransport, []);
  const storage = useMemo(() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, []);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const [current, setCurrent] = useState<ProjectData | null>(null);
  const [draft, setDraft] = useState("");
  const [journal, setJournal] = useState<ProjectJournalState>({ kind: "EMPTY" });
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [notice, setNotice] = useState("");
  const dirty = !!current && draft !== current.name;
  const episode = d.episodes.find((item) => item.id === d.selectedEpisodeId);

  function showProject(project: ProjectData) {
    const active = live.current;
    if (active.backendProjectId !== project.id) return;
    const card = active.projects.find((item) => item.backendId === project.id);
    if (card && (card.revision ?? 0) > project.revision) return;
    active.setProjects((old) =>
      old.map((item) =>
        item.backendId === project.id && (item.revision ?? 0) <= project.revision
          ? {
              ...item,
              name: project.name,
              revision: project.revision,
              status: project.status === "archived" ? "已归档" : "进行中",
              updated: project.updated_at,
              episode: `REV ${project.revision}`,
            }
          : item,
      ),
    );
    active.put("title", project.name);
  }

  useEffect(() => {
    const request = ++epoch.current;
    setCurrent(null);
    setDraft("");
    setLoading(true);
    setReadError(false);
    setNotice("");
    if (!projectId || !storage) {
      setLoading(false);
      setReadError(true);
      return () => {
        epoch.current += 1;
      };
    }
    setJournal(readProjectUpdateJournal(storage, projectId));
    void transport.getProject(projectId).then(
      (response) => {
        if (epoch.current !== request) return;
        setLoading(false);
        if (!validProject(response.data, projectId)) {
          setReadError(true);
          setNotice("项目读取内容无效；未填入演示默认设置。");
          return;
        }
        setCurrent(response.data);
        setDraft(response.data.name);
        showProject(response.data);
      },
      () => {
        if (epoch.current !== request) return;
        setLoading(false);
        setReadError(true);
        setNotice("项目设置读取失败；未填入演示默认设置。");
      },
    );
    return () => {
      epoch.current += 1;
    };
  }, [projectId, storage, transport]);

  async function readProject(closePending: boolean) {
    if (!projectId || !storage || inFlight.current) return;
    const request = ++epoch.current;
    inFlight.current = true;
    setLoading(true);
    const pending = readProjectUpdateJournal(storage, projectId);
    const result =
      pending.kind === "PENDING"
        ? closePending
          ? await closePendingProjectUpdate(transport, storage, projectId)
          : await readPendingProjectUpdate(transport, storage, projectId)
        : await (async () => {
            try {
              const response = await transport.getProject(projectId);
              return validProject(response.data, projectId)
                ? { kind: "CURRENT" as const, project: response.data, targetReached: false }
                : { kind: "UNKNOWN" as const };
            } catch {
              return { kind: "UNKNOWN" as const };
            }
          })();
    inFlight.current = false;
    if (epoch.current !== request) return;
    setLoading(false);
    setJournal(readProjectUpdateJournal(storage, projectId));
    if (result.kind !== "CURRENT" || !validProject(result.project, projectId)) {
      setReadError(true);
      setNotice(
        result.kind === "UNAVAILABLE" ? result.message : "项目当前状态无法核实，仍阻止保存。",
      );
      return;
    }
    const hadDirtyDraft = dirty;
    setCurrent(result.project);
    showProject(result.project);
    if (!hadDirtyDraft || (closePending && result.targetReached)) setDraft(result.project.name);
    setReadError(false);
    setNotice(
      pending.kind === "PENDING"
        ? closePending
          ? "未知记录已结束；当前项目已读回，无法归因原 PATCH。"
          : "已只读核对当前项目；原更新仍锁定，无法归因。"
        : hadDirtyDraft
          ? "已读取最新项目；未保存草稿保留，请核对后提交。"
          : "已从本地工作区读取当前项目设置。",
    );
  }

  async function save() {
    if (
      !projectId ||
      !storage ||
      !current ||
      !transport.updateProject ||
      !dirty ||
      loading ||
      readError ||
      journal.kind !== "EMPTY" ||
      inFlight.current
    )
      return;
    const name = draft.trim();
    if (!name || [...name].length > 80 || hasAsciiControlCharacter(name)) {
      setNotice("项目名称需为 1 至 80 个字符，且不能含控制字符。");
      return;
    }
    if (name === current.name) {
      setDraft(name);
      return;
    }
    const request = ++epoch.current;
    inFlight.current = true;
    setLoading(true);
    setNotice("正在保存项目名称并从本地工作区读回…");
    const result = await updateManagedProject(transport, storage, projectId, {
      expectedRevision: current.revision,
      name,
    });
    inFlight.current = false;
    if (epoch.current !== request) return;
    setLoading(false);
    setJournal(readProjectUpdateJournal(storage, projectId));
    if (result.kind === "APPLIED" && validProject(result.project, projectId)) {
      setCurrent(result.project);
      setDraft(result.project.name);
      showProject(result.project);
      setNotice("项目名称已保存，并从本地工作区读回确认。");
    } else if (result.kind === "APPLIED") {
      setReadError(true);
      setNotice("项目更新回执不符合当前项目合同，未宣称保存；请重新读取。 ");
    } else if (result.kind === "REJECTED") {
      if (result.project && validProject(result.project, projectId)) {
        setCurrent(result.project);
        showProject(result.project);
      }
      setReadError(true);
      setNotice(`项目更新被拒绝（${result.status} / ${result.code}）；草稿保留，请重新读取。`);
    } else if (result.kind === "UNKNOWN") {
      if (result.current && validProject(result.current, projectId)) {
        setCurrent(result.current);
        showProject(result.current);
      }
      setNotice("项目更新结果未知；原操作已锁定，草稿保留且不会自动重试。请只读核对。");
    } else if (result.kind === "TRACKED") {
      setNotice("已有原项目更新待核对，未重复提交。");
    } else setNotice(result.message);
  }

  const leave = () => {
    if (inFlight.current) {
      setNotice("项目设置正在核对，请等待当前操作结束。");
      return;
    }
    const target = projectId ? "project" : "projects";
    if (!dirty) {
      d.go(target);
      return;
    }
    d.setEditor({
      title: "离开未保存的项目名称？",
      description: "离开会丢弃当前草稿；已保存的项目名称不会变化。",
      confirm: "放弃草稿并返回",
      save: () => d.go(target),
    });
  };

  return (
    <div className="v2-utility-page v2-settings-page v2-project-settings">
      <header className="page-title v2-utility-heading">
        <div>
          <h1>项目设置</h1>
          <p>
            {current
              ? `《${current.name}》 · 本地工作区项目 · 修订 ${current.revision}`
              : "正在核对本地工作区项目。"}
          </p>
        </div>
        <Button onClick={leave}>返回{projectId ? "项目" : "项目中心"}</Button>
      </header>
      <div className="v2-settings-body">
        <section className="v2-utility-card v2-project-settings-card">
          <h2>
            <Icon name="settings" size={16} />
            项目基础设置
          </h2>
          <div className="v2-project-settings-fields">
            <label>
              项目名称
              <input
                value={draft}
                disabled={!current || loading || journal.kind !== "EMPTY"}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <label>
              画幅（创建时确定）
              <input readOnly value={current?.aspect_ratio ?? "待读取"} />
            </label>
            <label>
              目标时长（创建时确定）
              <input
                readOnly
                value={current ? `${current.target_duration_seconds} 秒` : "待读取"}
              />
            </label>
            <label>
              来源语言（创建时确定）
              <input
                readOnly
                value={current?.source_language === "zh-CN" ? "简体中文" : "待读取"}
              />
            </label>
            <label>
              时基
              <input readOnly value="未提供项目持久设置" />
            </label>
            <label>
              当前剧集（独立选择）
              <input readOnly value={episode?.title ?? "尚未选择剧集"} />
            </label>
            <label>
              项目说明
              <input readOnly value="未提供项目持久设置" />
            </label>
            <Button disabled title="项目说明尚无持久保存接口">
              编辑项目说明 · 待接入
            </Button>
          </div>
        </section>
        <section className="v2-utility-card v2-project-settings-card">
          <h2>
            <Icon name="settings" size={16} />
            创作与隐私策略
          </h2>
          <div className="v2-project-settings-fields">
            <label>
              项目状态
              <input
                readOnly
                value={current?.status === "archived" ? "已归档" : current ? "进行中" : "待读取"}
              />
            </label>
            <label>
              生成策略
              <input readOnly value="暂无可变的项目持久设置" />
            </label>
            <label>
              第三方发送
              <input readOnly value="暂无可变的项目持久设置" />
            </label>
            <label>
              版本策略
              <input readOnly value="暂无可变的项目持久设置" />
            </label>
            <label>
              预算
              <input readOnly value="请在创作简报核对预算意向；费用服务未接入" />
            </label>
          </div>
          <p>归档与恢复请在项目中心管理；本页仅保存项目名称。</p>
        </section>
        <section className="v2-utility-card" aria-label="项目设置状态">
          {loading && (
            <p role="status" aria-busy="true">
              正在读取或保存项目设置…
            </p>
          )}
          {readError && <p role="alert">项目状态无法核实，保存已暂停。</p>}
          {!projectId && <p role="alert">请先选择真实项目。</p>}
          {!storage && <p role="alert">本地更新记录不可用，无法安全保存。</p>}
          {!transport.updateProject && <p role="alert">桌面版本缺少项目更新接口。</p>}
          {journal.kind === "PENDING" && <p role="alert">上次项目更新结果未知，不会自动重试。</p>}
          {journal.kind === "BLOCKED" && <p role="alert">本地项目更新记录不可读取。</p>}
          {notice && <p role="status">{notice}</p>}
          <Button
            disabled={loading || !projectId || !storage}
            onClick={() => void readProject(false)}
          >
            重新读取项目
          </Button>
          {journal.kind === "PENDING" && (
            <Button disabled={loading} onClick={() => void readProject(true)}>
              核对并结束未知记录
            </Button>
          )}
        </section>
      </div>
      <FlowFooter
        secondaryLabel="取消"
        secondaryAction={() => {
          if (inFlight.current) return;
          if (current) setDraft(current.name);
          setNotice("已取消未保存的项目名称草稿。");
        }}
        label="保存项目名称"
        action={() => void save()}
        disabled={
          !current ||
          !dirty ||
          loading ||
          readError ||
          !storage ||
          !transport.updateProject ||
          journal.kind !== "EMPTY"
        }
        reason={
          journal.kind !== "EMPTY"
            ? "原更新待核对，已阻止再次提交"
            : readError
              ? "请重新读取项目"
              : dirty
                ? "有未保存的项目名称草稿"
                : current
                  ? `已读取项目修订 ${current.revision}`
                  : "尚未读取项目"
        }
      />
    </div>
  );
}

type PreferenceDraft = { user_name: string; display_bio: string };

function PersistedUserSettings() {
  const d = useDemo();
  const live = useRef(d);
  live.current = d;
  const form = useRef<HTMLFormElement>(null);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const [category, setCategory] = useState("个人资料");
  const [current, setCurrent] = useState<AppPreferencesResponse | null>(null);
  const [draft, setDraft] = useState<PreferenceDraft>({ user_name: "", display_bio: "" });
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [saveUnknown, setSaveUnknown] = useState(false);
  const [notice, setNotice] = useState("");
  const transport = useMemo(
    () => createStudioTransport() as unknown as Partial<AppPreferencesGateway>,
    [],
  );
  const gateway = useMemo<AppPreferencesGateway | null>(
    () =>
      typeof transport.getAppPreferences === "function" &&
      typeof transport.saveAppPreferences === "function"
        ? (transport as AppPreferencesGateway)
        : null,
    [transport],
  );
  const dirty =
    !!current &&
    (draft.user_name !== current.data.user_name || draft.display_bio !== current.data.display_bio);

  useEffect(() => {
    const request = ++epoch.current;
    void readAppPreferences(gateway).then((result) => {
      if (epoch.current !== request) return;
      setLoading(false);
      if (result.kind === "READY") {
        setCurrent(result.response);
        setDraft({
          user_name: result.response.data.user_name,
          display_bio: result.response.data.display_bio,
        });
        setReadError(false);
        live.current.put("userName", result.response.data.user_name || "本地用户");
        live.current.put("bio", result.response.data.display_bio);
      } else {
        setReadError(true);
        setNotice("本地偏好读取失败；未写入默认设置。请重新读取。");
      }
    });
    return () => {
      epoch.current += 1;
    };
  }, [gateway]);

  async function refresh() {
    if (inFlight.current) return;
    const request = ++epoch.current;
    inFlight.current = true;
    setLoading(true);
    const result = await readAppPreferences(gateway);
    inFlight.current = false;
    if (epoch.current !== request) return;
    setLoading(false);
    if (result.kind !== "READY") {
      setReadError(true);
      setNotice("偏好读取失败；当前草稿和原已读值均保留，未提交保存。");
      return;
    }
    const matchesDraft =
      result.response.data.user_name === draft.user_name.trim() &&
      result.response.data.display_bio === draft.display_bio.replace(/\r\n/g, "\n");
    setCurrent(result.response);
    if (!dirty || matchesDraft)
      setDraft({
        user_name: result.response.data.user_name,
        display_bio: result.response.data.display_bio,
      });
    setReadError(false);
    setSaveUnknown(false);
    d.put("userName", result.response.data.user_name || "本地用户");
    d.put("bio", result.response.data.display_bio);
    setNotice(
      saveUnknown && matchesDraft && dirty
        ? "已读到与草稿一致的持久设置；先前提交结果无法单独归因。"
        : dirty
          ? "已读到最新设置；未保存草稿仍保留，请核对后再提交。"
          : "已读取当前持久设置。",
    );
  }

  async function save() {
    if (!current || readError || saveUnknown || inFlight.current || !dirty) return;
    const request = ++epoch.current;
    inFlight.current = true;
    setLoading(true);
    setNotice("正在保存并核对持久设置…");
    const result = await saveAppPreferences(gateway, current, draft.user_name, draft.display_bio);
    inFlight.current = false;
    if (epoch.current !== request) return;
    setLoading(false);
    if (result.kind === "SAVED") {
      setCurrent(result.response);
      setDraft({
        user_name: result.response.data.user_name,
        display_bio: result.response.data.display_bio,
      });
      d.put("userName", result.response.data.user_name);
      d.put("bio", result.response.data.display_bio);
      setNotice("设置已保存并从本地工作区读回。");
    } else if (result.kind === "INVALID_INPUT") {
      setNotice(result.message);
    } else if (result.kind === "REJECTED") {
      setReadError(result.status !== 422);
      setNotice(
        result.status === 409
          ? "设置修订已变化或存储状态异常；草稿保留，请重新读取后核对。"
          : result.status === 422
            ? "设置输入未通过校验；草稿保留，请修改后再保存。"
            : `设置保存被拒绝（${result.status} / ${result.code}）；草稿保留。`,
      );
    } else {
      setSaveUnknown(true);
      setNotice("保存结果未知；草稿保留且已阻止再次提交。请只读核对当前设置。");
    }
  }

  const cancel = () => {
    if (!current || inFlight.current) return;
    setDraft({ user_name: current.data.user_name, display_bio: current.data.display_bio });
    setNotice("已放弃未保存草稿，恢复上次读到的持久设置。");
  };
  const leave = () => {
    const target = d.backendProjectId ? "project" : "projects";
    if (!dirty) {
      d.go(target);
      return;
    }
    d.setEditor({
      title: "放弃未保存的用户设置？",
      description: "离开会丢弃当前草稿，已保存的设置不会变化。",
      confirm: "放弃草稿并返回",
      save: () => d.go(target),
    });
  };

  return (
    <div className="v2-utility-page v2-settings-page v2-utility-management">
      <header className="page-title v2-utility-heading">
        <div>
          <h1>用户设置</h1>
          <p>本机用户偏好，保存后从本地工作区读回。</p>
        </div>
        <Button onClick={leave}>返回{d.backendProjectId ? "项目" : "项目中心"}</Button>
      </header>
      <form
        ref={form}
        className="v2-settings-body"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <aside className="v2-utility-card v2-settings-categories">
          <h2>
            <Icon name="settings" size={16} />
            设置分类
          </h2>
          {["个人资料", "界面语言", "外观", "创作默认值"].map((label) => (
            <Button
              key={label}
              aria-pressed={category === label}
              onClick={() => setCategory(label)}
            >
              {label}
            </Button>
          ))}
        </aside>
        <section className="v2-utility-card v2-profile">
          <h2>
            <Icon name="users" size={16} />
            {category}
          </h2>
          <div className="v2-profile-content" data-scroll-region="settings-fields">
            {category === "个人资料" && (
              <label>
                昵称
                <input
                  value={draft.user_name}
                  disabled={!current || loading}
                  placeholder="设置本机昵称"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraft((old) => ({ ...old, user_name: value }));
                  }}
                />
              </label>
            )}
            {category === "创作默认值" && (
              <label>
                创作签名
                <textarea
                  value={draft.display_bio}
                  disabled={!current || loading}
                  placeholder="可留空"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraft((old) => ({ ...old, display_bio: value }));
                  }}
                />
              </label>
            )}
            {category === "界面语言" && <p>界面语言：简体中文（当前版本）</p>}
            {category === "外观" && <p>外观：深色电影工作台（当前版本）</p>}
            {!gateway && <p role="alert">当前桌面版本缺少用户偏好接口，无法读取或保存。</p>}
            {loading && (
              <p role="status" aria-busy="true">
                正在读取或保存本地偏好…
              </p>
            )}
            {readError && <p role="alert">偏好状态无法核实，保存已暂停。</p>}
            {saveUnknown && <p role="alert">上次保存结果未知，不会自动重复提交。</p>}
            {notice && <p role="status">{notice}</p>}
            <Button disabled={!gateway || loading} onClick={() => void refresh()}>
              重新读取已保存设置
            </Button>
          </div>
        </section>
      </form>
      <FlowFooter
        secondaryLabel="取消"
        secondaryAction={cancel}
        label="保存用户设置"
        action={() => form.current?.requestSubmit()}
        disabled={!current || !gateway || !dirty || loading || readError || saveUnknown}
        reason={
          saveUnknown
            ? "保存结果未知；请先只读核对"
            : readError
              ? "当前设置未能核实；请重新读取"
              : loading
                ? "正在读取或保存"
                : dirty
                  ? "有未保存的设置草稿"
                  : current?.data.saved
                    ? `已保存 · 修订 ${current.data.revision}`
                    : "尚未保存本机偏好"
        }
      />
    </div>
  );
}
