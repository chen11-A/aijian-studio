import { useState } from "react";
import { pages } from "./data";
import { useDemo } from "./model";
import { Button } from "./Common";
import { Icon, Logo } from "./Icon";
import { Dropdown } from "./Dropdown";
import { FixtureAssistantPanel } from "./FixtureAssistantPanel";
import { AssistantTaskQueue } from "./AssistantTaskQueue";
import { AssistantContext, AssistantServiceStatus, assistantServiceLabel } from "./AssistantStatus";
import "./v2-assistant.css";
import "./assistant-workbench.css";

export function AssistantPanel() {
  const d = useDemo();
  return d.isFixture ? (
    <FixtureAssistantPanel />
  ) : (
    <ProductionAssistantPanel key={d.backendProjectId ?? "no-project"} />
  );
}

function ProductionAssistantPanel() {
  const d = useDemo();
  const [tab, setTab] = useState("对话");
  const pageLabel = pages[d.page][0];
  const disabledReason =
    "自由对话、附件与语音尚未接入可审批的发送流程。请使用故事页的来源提取；本面板不保存会话或上传文件。";
  const closeAssistant = () => {
    if (d.professional) d.selectRightTab("inspector");
    else {
      d.setAiOpen(false);
      d.put("managementAI", "false");
    }
  };
  return (
    <aside className="assistant-panel v2-assistant assistant-workbench" aria-label="Aivora AI 助手">
      <header>
        <Logo />
        <div>
          <h2>Aivora AI</h2>
          <p role="status">{assistantServiceLabel(d.providerSettings.state)}</p>
        </div>
      </header>
      <div className="v2-ai-context-row">
        <button
          className="v2-ai-context-chip"
          aria-label="上下文"
          onClick={() => setTab(tab === "上下文" ? "对话" : "上下文")}
        >
          {tab === "对话" ? pageLabel : tab}
        </button>
        {!d.professional && (
          <button className="assistant-collapse" onClick={closeAssistant} aria-label="收起助手面板">
            收起
          </button>
        )}
        <Dropdown
          className="v2-ai-menu"
          label="助手工具"
          title="项目、任务和上下文"
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
                onClick={() => setTab(value)}
              >
                {value}
              </button>
            ))}
            <button onClick={closeAssistant}>
              {d.professional ? "查看对象属性" : "收起助手面板"}
            </button>
          </nav>
        </Dropdown>
      </div>
      <div className="assistant-body" data-scroll-region="ai-chat">
        {(tab === "对话" || tab === "建议") && (
          <>
            <section className="v2-ai-detail" aria-label="助手工作范围">
              <h3>当前作品的下一步</h3>
              <p>这里显示本地作品、服务配置和真实任务。自由对话尚未接入，以下为操作指引。</p>
              {!d.backendProjectId ? (
                <>
                  <p>先新建或打开作品，再整理来源或原创灵感。</p>
                  <Button onClick={() => d.go("projects")}>打开项目中心</Button>
                </>
              ) : (
                <>
                  <p>
                    导入来源后完成审核，再到故事页选择文本连接与来源块。生成结果需人工审阅、接纳。
                  </p>
                  <div className="suggestions">
                    <Button onClick={() => d.go("source")}>整理来源与原创灵感</Button>
                    <Button onClick={() => d.go("story")}>打开来源提取</Button>
                    <Button onClick={() => d.go("script")}>编写分集剧本</Button>
                  </div>
                  <p>外部调用需另行确认发送范围与费用。导航和读取状态不会调用模型。</p>
                </>
              )}
            </section>
            <AssistantServiceStatus />
          </>
        )}
        {tab === "任务" && (
          <section className="v2-ai-detail">
            <AssistantTaskQueue />
          </section>
        )}
        {tab === "上下文" && <AssistantContext />}
      </div>
      <div className="ai-composer" aria-describedby="assistant-send-unavailable">
        <textarea
          aria-label="AI 输入"
          disabled
          value=""
          readOnly
          placeholder="自由对话尚未接入，请先使用来源提取"
        />
        <p id="assistant-send-unavailable">{disabledReason}</p>
        <div className="v2-composer-tools">
          {[
            ["AI 图片附件", "image"],
            ["AI 附件", "attach"],
            ["引用素材", "folder"],
            ["语音输入暂未接入", "mic"],
          ].map(([label, icon]) => (
            <Button key={label} aria-label={label} disabled title={disabledReason}>
              <Icon name={icon ?? "attach"} size={18} />
            </Button>
          ))}
          <button
            className="button primary send-button"
            aria-label="发送消息"
            type="button"
            disabled
            title={disabledReason}
            aria-describedby="assistant-send-unavailable"
          >
            <Icon name="send" size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
