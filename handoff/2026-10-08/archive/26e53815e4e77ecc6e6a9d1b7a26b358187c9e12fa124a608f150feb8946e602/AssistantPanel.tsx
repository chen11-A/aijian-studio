import { useEffect, useRef, useState } from "react";
import { pages } from "./data";
import { useDemo } from "./model";
import { Button } from "./Common";
import { Icon, Logo } from "./Icon";
import { useCurrentObject } from "./useCurrentObject";
import "./v2-assistant.css";
import { Dropdown } from "./Dropdown";

export function AssistantPanel() {
  const d = useDemo();
  const object = useCurrentObject();
  const [tab, setTab] = useState("对话");
  const body = useRef<HTMLDivElement>(null);
  const messageCount = useRef(d.messages.length);
  const savedScroll = d.value(`assistant-scroll-${d.page}`, "0");
  const pageLabel =
    (
      {
        source: "来源输入",
        generation: "镜头生成",
        voice: "声音",
        assets: "素材",
        export: "导出",
        project: "项目创作首页",
        characters: "角色总览",
      } as Record<string, string>
    )[d.page] ?? pages[d.page][0];
  const suggestions =
    d.page === "story"
      ? ["更清楚地说明核心冲突", "核对主要人物关系", "查看这项判断的依据"]
      : d.page === "character" || d.page === "characters"
        ? ["侧面发型更利落一些", "检查三视图与配饰", "查看换装出现的场次"]
        : d.page === "review"
          ? ["定位当前批注", "解释点批注与范围", "看看哪些问题可以剪辑解决"]
          : ["解释当前对象", "查看已有参考素材", "调整当前内容"];
  const copy =
    d.page === "story"
      ? "样例故事已整理为插画、人物、结构与待确认项。请先核对故事方向，再确认进入角色。"
      : d.page === "character" || d.page === "characters"
        ? "三个视角使用同一角色样例。右侧服装卡独立选择，不会把人物压扁，也不会挤走三视图。"
        : d.page === "review"
          ? "这里只记录批注，不在看片时修改视频。完成审核后，统一生成修改方案。"
          : "先看主区域中的样例内容。需要调整时，告诉我对象与变化；界面演示不会自动调用生成服务。";
  useEffect(() => {
    if (body.current) body.current.scrollTop = Number(savedScroll);
  }, [d.page, savedScroll]);
  useEffect(() => {
    if (d.messages.length > messageCount.current && body.current)
      body.current.scrollTop = body.current.scrollHeight;
    messageCount.current = d.messages.length;
  }, [d.messages.length]);
  const chooseTab = (value: string) => {
    setTab(value);
  };
  const history = () =>
    d.setEditor({
      title: "本次演示会话",
      presentation: "drawer",
      description: d.messages.length
        ? d.messages
            .map(
              (message, index) =>
                `${message.role === "user" ? "你 · 本地记录" : "历史演示说明"}：${message.text}${d.value(`ai-message-context-${index}`) ? `\n关联对象：${d.value(`ai-message-context-${index}`)}` : ""}`,
            )
            .join("\n\n")
        : "尚未开始对话。消息仅保存在本次演示中，未发送给 AI 服务。",
    });
  function send() {
    const text = d.aiDraft.trim();
    if (!text) return;
    d.put(
      `ai-message-context-${d.messages.length}`,
      `${d.value("title")} · ${object.label} · ${object.detail}${d.references.length ? ` · 引用：${d.references.join("、")}` : ""}`,
    );
    d.setMessages((old) => [...old, { role: "user", text }]);
    d.setAiDraft("");
    chooseTab("对话");
    d.notify("消息已保存到本地演示会话；AI 服务未连接，尚未发送");
  }
  const attach = (files: FileList | null) => {
    const names = Array.from(files ?? [], (file) => file.name);
    d.setReferences((old) => [...new Set([...old, ...names])]);
  };
  const referenceOptions = [
    ...new Set([
      ...d.characters.map((person) => `${person.name} · 多视图`),
      ...d.locations.map((location) => location.name),
      ...d.localAssets.map((asset) => asset.name),
      "城市全景",
    ]),
  ];
  const referenceAsset = () =>
    d.setEditor({
      title: "引用演示素材",
      fields: [
        {
          key: "asset",
          label: "选择素材",
          value: referenceOptions[0] ?? "城市全景",
          options: referenceOptions,
        },
      ],
      save: (data) => d.setReferences((old) => [...new Set([...old, data.asset!])]),
    });
  return (
    <aside className="assistant-panel v2-assistant" aria-label="Aivora AI 助手">
      <header>
        <Logo />
        <div>
          <h2>Aivora AI</h2>
          <p>创作伙伴 · 未连接真实服务</p>
        </div>
      </header>
      <div className="v2-ai-context-row">
        <button
          className="v2-ai-context-chip"
          aria-label="上下文"
          title={`${object.label} · ${object.detail}`}
          onClick={() => chooseTab(tab === "上下文" ? "对话" : "上下文")}
        >
          {tab === "对话" ? pageLabel : tab}
        </button>
        <Dropdown
          className="v2-ai-menu"
          label="助手工具"
          title="对话、建议、任务和上下文"
          summary={
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
              <circle cx="4" cy="9" r="1.5" />
              <circle cx="9" cy="9" r="1.5" />
              <circle cx="14" cy="9" r="1.5" />
            </svg>
          }
        >
          <nav aria-label="助手内容">
            {["对话", "建议", "任务", "上下文"].map((value) => (
              <button
                key={value}
                aria-label={`切换到${value}`}
                aria-pressed={tab === value}
                onClick={() => chooseTab(value)}
              >
                {value}
              </button>
            ))}
            <button
              onClick={() => {
                history();
              }}
            >
              会话历史
            </button>
            <button
              onClick={() => {
                if (d.professional) d.selectRightTab("inspector");
                else {
                  d.setAiOpen(false);
                  d.put("managementAI", "false");
                }
              }}
            >
              收起助手面板
            </button>
          </nav>
        </Dropdown>
      </div>
      <div
        ref={body}
        className="assistant-body"
        data-scroll-region="ai-chat"
        onScroll={(event) =>
          d.put(`assistant-scroll-${d.page}`, String(event.currentTarget.scrollTop))
        }
      >
        {(tab === "对话" || tab === "建议") && (
          <>
            <section className="ai-welcome">
              <h3>
                <Icon name="spark" size={16} />
                {tab === "建议" ? "围绕当前创作的建议" : "当前创作上下文"}
              </h3>
              <p>{copy}</p>
              <span className="v2-ai-sample">示例说明 · 非实时回复</span>
            </section>
            <div className="suggestions">
              {suggestions.map((text) => (
                <button key={text} onClick={() => d.setAiDraft(text)}>
                  {text}
                </button>
              ))}
            </div>
          </>
        )}
        {tab === "对话" &&
          d.messages.map((message, index) => (
            <div className={`message ${message.role}`} key={index}>
              <small>
                {message.role === "user" ? "你 · 本地消息，未发送" : "历史演示说明 · 非实时回复"}
              </small>
              <p>{message.text}</p>
              {d.value(`ai-message-context-${index}`) && (
                <button
                  className="v2-ai-message-context"
                  onClick={() =>
                    d.setEditor({
                      title: "发送时的上下文快照",
                      presentation: "drawer",
                      description: d.value(`ai-message-context-${index}`),
                    })
                  }
                >
                  查看关联对象与引用
                </button>
              )}
              {message.role === "assistant" && (
                <Button onClick={() => d.propose("AI 修改建议 · 旧演示记录", message.text)}>
                  查看方案
                </Button>
              )}
            </div>
          ))}
        {tab === "任务" && (
          <section className="v2-ai-detail">
            <h3>本次演示任务</h3>
            {!d.tasks.length && <p>还没有任务。导航和页面切换不会触发生成。</p>}
            {d.tasks.map((task) => (
              <button key={task.id} className="task-row" onClick={() => d.go(task.page)}>
                <strong>{task.name}</strong>
                <small>{task.status}</small>
              </button>
            ))}
          </section>
        )}
        {tab === "上下文" && (
          <section className="v2-ai-detail">
            <h3>当前创作上下文</h3>
            <dl>
              <dt>作品</dt>
              <dd>{d.value("title")}</dd>
              <dt>剧集</dt>
              <dd>{d.value("episode")}</dd>
              <dt>页面</dt>
              <dd>{pageLabel}</dd>
              <dt>当前对象</dt>
              <dd>{object.label}</dd>
              <dt>对象详情</dt>
              <dd>{object.detail}</dd>
              {object.isShot && (
                <>
                  <dt>当前时间</dt>
                  <dd>{d.time.toFixed(2)}s</dd>
                  <dt>引用版本</dt>
                  <dd>
                    {object.shotField("sceneVersion", "v2")} ·{" "}
                    {object.shotField("outfitVersion", "雨夜外套 v3")}
                  </dd>
                </>
              )}
              <dt>属性分组</dt>
              <dd>{d.value(`inspector-tab-${object.family}`, "基础")}</dd>
              {d.page === "review" && (
                <>
                  <dt>当前批注</dt>
                  <dd>
                    {d.annotations
                      .filter((item) => d.time >= item.start && d.time <= item.end)
                      .map((item) => item.text)
                      .join("；") || "此时点无批注"}
                  </dd>
                </>
              )}
            </dl>
            <Button
              onClick={() =>
                d.setReferences((old) => [
                  ...new Set([...old, `${object.label} · ${object.detail}`]),
                ])
              }
            >
              引用当前对象
            </Button>
          </section>
        )}
      </div>
      <form
        className="ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label="AI 输入"
          placeholder="输入想法，附上图片或素材…"
          value={d.aiDraft}
          onChange={(event) => d.setAiDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="reference-chips" aria-label="当前上下文与附件引用">
          <button
            type="button"
            className="v2-composer-context"
            title={`${object.label} · ${object.detail}`}
            onClick={() => chooseTab("上下文")}
          >
            {pageLabel}
          </button>
          {d.references.map((reference) => (
            <button
              type="button"
              key={reference}
              onClick={() => d.setReferences((old) => old.filter((item) => item !== reference))}
              aria-label={`移除引用 ${reference}`}
              title={reference}
            >
              {reference} ×
            </button>
          ))}
        </div>
        <div className="v2-composer-tools">
          <label className="icon-button file-button" title="添加参考图片">
            <Icon name="image" size={18} />
            <span className="sr-only">添加参考图片</span>
            <input
              aria-label="AI 图片附件"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => attach(event.target.files)}
            />
          </label>
          <label className="icon-button file-button" title="添加文件">
            <Icon name="attach" size={18} />
            <span className="sr-only">添加附件</span>
            <input
              aria-label="AI 附件"
              type="file"
              multiple
              onChange={(event) => attach(event.target.files)}
            />
          </label>
          <Button aria-label="引用素材" onClick={referenceAsset}>
            <Icon name="folder" size={18} />
          </Button>
          <Button
            aria-label="语音输入暂未接入"
            onClick={() =>
              d.setEditor({
                title: "语音输入尚未接入",
                description: "演示版未连接语音服务，也不会请求麦克风权限。请使用文字输入。",
              })
            }
          >
            <Icon name="mic" size={18} />
          </Button>
          <button
            className="button primary send-button"
            aria-label="发送消息"
            title={d.aiDraft.trim() ? "保存到本地会话，未发送给 AI 服务" : "请输入消息"}
            disabled={!d.aiDraft.trim()}
            type="submit"
          >
            <Icon name="send" size={18} />
          </button>
        </div>
      </form>
    </aside>
  );
}
