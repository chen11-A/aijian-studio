import { useRef } from "react";
import { useDemo } from "./model";
import { Button, FlowFooter } from "./Common";
import { Icon } from "./Icon";
import avatar from "./assets/v2/avatar.png";

export function SettingsPage() {
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
