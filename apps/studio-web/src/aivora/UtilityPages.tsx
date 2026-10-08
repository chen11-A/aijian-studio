import { useEffect, useRef, useState } from "react";
import { useDemo } from "./model";
import { Button, FlowFooter } from "./Common";
import { Icon } from "./Icon";
import { SettingsPage } from "./SettingsPage";
import { ProviderConnectionForm } from "./ProviderConnectionForm";
import { Sub2APIConnectionManagement } from "./Sub2APIConnectionManagement";
import { ChatGPTConnectionCard } from "./chatgpt-auth/ChatGPTConnectionCard";
import { rememberServiceEntryChoice } from "./FirstRunServiceChoice";
import { capabilityLabels, providerPresets } from "../domain/provider-settings-model";
import "./provider-connection-form.css";
import avatar from "./assets/v2/avatar.png";
import male from "./assets/v2/male.png";
import rival from "./assets/v2/rival.png";
import "./v2-utility.css";

export function UtilityPages() {
  const d = useDemo();
  if (d.page === "services") return <Services />;
  if (d.page === "costs") return <Costs />;
  if (d.page === "voice") return <Voice />;
  return <SettingsPage />;
}
function Heading({ title, management = false }: { title: string; management?: boolean }) {
  const d = useDemo();
  return (
    <header className="page-title v2-utility-heading">
      <div>
        <h1>{title}</h1>
        <p>
          {management
            ? "管理你的创作与设置，不改变原始内容。"
            : `《${d.value("title")}》本地演示样例 · 所有状态仅用于界面与流程复刻。`}
        </p>
      </div>
      <Button onClick={() => d.go(management ? "project" : "assembly")}>
        {management ? "返回项目" : "详细设置"}
      </Button>
    </header>
  );
}
function LocalState() {
  const d = useDemo();
  if (d.scenario === "normal") return null;
  return (
    <div className="v2-utility-state" role="status" aria-busy={d.scenario === "loading"}>
      <Icon name="folder" />
      <h3>
        {d.scenario === "loading"
          ? "正在读取演示内容"
          : d.scenario === "error"
            ? "暂时无法读取内容"
            : d.scenario === "empty"
              ? "还没有内容"
              : "真实能力未接入"}
      </h3>
      <p>已有字段与草稿保留。</p>
      <Button onClick={() => d.setScenario("normal")}>
        {d.scenario === "error" ? "重试演示" : "查看样例"}
      </Button>
    </div>
  );
}
function Services() {
  const d = useDemo();
  const settings = d.providerSettings;
  const state = settings.state;
  const official = useRef<HTMLDivElement>(null);
  const apiConfig = useRef<HTMLElement>(null);
  const entry = d.value("serviceEntry");
  const [serviceTab, setServiceTab] = useState<"api" | "chatgpt">(entry === "chatgpt" ? "chatgpt" : "api");
  const useApi = () => {
    rememberServiceEntryChoice("api");
    d.put("serviceEntry", "api");
    setServiceTab("api");
  };
  useEffect(() => {
    if (serviceTab === "api" && entry === "api") apiConfig.current?.focus();
    if (serviceTab === "chatgpt") official.current?.focus();
  }, [entry, serviceTab]);
  return (
    <div className="v2-utility-page v2-utility-management">
      <Heading title="AI 服务" management />
      {!d.isFixture && <div className="service-connection-switch" role="group" aria-label="AI 连接类型">
        <Button aria-pressed={serviceTab === "api"} primary={serviceTab === "api"} onClick={() => setServiceTab("api")}>API / Sub2API</Button>
        <Button aria-pressed={serviceTab === "chatgpt"} primary={serviceTab === "chatgpt"} onClick={() => setServiceTab("chatgpt")}>ChatGPT 官方账号</Button>
      </div>}
      {!d.isFixture && <div ref={official} tabIndex={-1} hidden={serviceTab !== "chatgpt"} className="official-service-panel">
        {serviceTab === "chatgpt" && <ChatGPTConnectionCard
          onConnected={() => { rememberServiceEntryChoice("chatgpt"); }}
          onUseApi={useApi}
        />}
      </div>}
      <div className="v2-service-body provider-settings" hidden={!d.isFixture && serviceTab !== "api"}>
        <section
          className="v2-utility-card v2-service-list connections-panel"
          aria-labelledby="service-connections-title"
        >
          <header>
            <div>
              <h2 id="service-connections-title">
                <Icon name="spark" size={16} />
                已配置连接
              </h2>
              <p>密钥仅由本地系统凭据库保存，项目只引用连接标识。</p>
            </div>
            {state.kind === "ready" && <b>{state.response.data.length}</b>}
          </header>
          {settings.saveError && <p role="alert">{settings.saveError}</p>}
          {state.kind === "loading" && <div role="status">正在读取安全配置…</div>}
          {state.kind === "error" && (
            <div role="alert">
              <strong>配置读取失败</strong>
              <Button onClick={() => void settings.load()}>重新读取</Button>
            </div>
          )}
          {state.kind === "ready" && state.response.data.length === 0 && (
            <div className="settings-empty">
              <strong>还没有模型连接</strong>
              <p>可添加 API 连接，或切换到 ChatGPT 官方账号。</p>
            </div>
          )}
          {state.kind === "ready" &&
            state.response.data.map((connection) => (
              <article className="connection-card" key={connection.id}>
                <header>
                  <div>
                    <strong>{connection.display_name}</strong>
                    <span>
                      {connection.provider_kind === "CPA_LOOPBACK"
                        ? "CPA 本地连接"
                        : providerPresets[connection.provider_kind].label}
                    </span>
                  </div>
                  <i>
                    {connection.credential_status === "CONFIGURED"
                      ? "密钥已配置"
                      : connection.credential_status === "UNAVAILABLE"
                        ? "凭据库不可用"
                        : "无需密钥 / 未配置"}
                  </i>
                </header>
                <code>{connection.base_url}</code>
                <div className="connection-models">
                  {connection.models.length === 0 ? (
                    <span>尚未登记模型 ID</span>
                  ) : (
                    connection.models.map((model) => (
                      <span key={model.model_id}>
                        <strong>{model.model_id}</strong>
                        <small>
                          {model.capabilities.map((item) => capabilityLabels[item]).join(" · ")}
                        </small>
                      </span>
                    ))
                  )}
                </div>
                {connection.provider_kind === "SUB2API" && (
                  <Sub2APIConnectionManagement connection={connection} onReload={settings.load} />
                )}
                {settings.confirmingId === connection.id ? (
                  <div role="alert">
                    <span>同时移除系统凭据？</span>
                    <Button onClick={() => void settings.remove(connection.id)}>确认移除</Button>
                    <Button onClick={() => settings.setConfirmingId(null)}>取消</Button>
                  </div>
                ) : (
                  <Button onClick={() => settings.setConfirmingId(connection.id)}>移除连接</Button>
                )}
              </article>
            ))}
        </section>
        <section ref={apiConfig} tabIndex={-1} className="v2-utility-card v2-service-config" aria-labelledby="service-new-title">
          <h2 id="service-new-title">
            <Icon name="settings" size={16} />
            添加模型供应商
          </h2>
          <p>此处配置 API Key。ChatGPT 官方账号使用上方独立入口。</p>
          <ProviderConnectionForm
            busy={settings.saving}
            error={settings.saveError}
            onSubmit={settings.create}
          />
        </section>
      </div>
    </div>
  );
}
function Costs() {
  const d = useDemo();
  const budget = () =>
    d.edit("演示预算设置", [
      {
        key: "budget",
        label: "预算上限（人民币）",
        value: d.value("budget", "150.00"),
        type: "number",
        min: 0,
        required: true,
      },
      {
        key: "costPeriod",
        label: "账单周期",
        value: d.value("costPeriod", "本月"),
        options: ["本月", "最近 7 天", "全部"],
      },
    ]);
  const sampleLedger = () =>
    d.setEditor({
      title: "固定演示账单 · 仅作界面测试",
      description:
        "这些金额不代表真实调用或扣费。\n项目,能力,演示金额\n星夜之城,镜头视频,57.00\n星夜之城,图像素材,20.74\n星夜之城,故事规划,8.66\n真实费用,未知,未知\n\n仅预览 CSV 文本，不创建账单文件。",
    });
  return (
    <div className="v2-utility-page v2-utility-management">
      <Heading title="用量" management />
      <div className="v2-cost-body">
        <div className="v2-cost-summary">
          {["本月费用", "预留预算", "已结算费用"].map((label, index) => (
            <section className="v2-utility-card" key={label}>
              <h2>
                <Icon name="clock" size={16} />
                {label}
              </h2>
              <strong>—</strong>
              <p>未连接账本 · 不编造金额</p>
              {index === 1 && (
                <button
                  className="v2-detail-tool"
                  onClick={d.isFixture ? budget : undefined}
                  disabled={!d.isFixture}
                  title={d.isFixture ? undefined : "真实预算账本尚未接入，本页不保存预算修改"}
                >
                  {d.isFixture ? "预算设置" : "预算设置待接入"}
                </button>
              )}
            </section>
          ))}
        </div>
        <section className="v2-utility-card v2-cost-ledger">
          <h2>
            <Icon name="book" size={16} />
            用量与费用明细
          </h2>
          <div className="v2-cost-table-head">
            {["时间", "任务 / 服务", "估算", "预留", "结算", "状态"].map((v) => (
              <span key={v}>{v}</span>
            ))}
          </div>
          <div
            className="v2-cost-rows"
            data-scroll-region="cost-ledger-rows"
            data-design-addition="long-list-scroll"
          >
            {d.scenario !== "normal" ? (
              <LocalState />
            ) : (
              <>
                <p>账本尚未接入；已有界面不代表已经发生调用或费用。</p>
                <Button onClick={() => d.go("services")}>前往 AI 服务</Button>
                {d.isFixture && (
                  <button className="v2-cost-sample" onClick={sampleLedger}>
                    查看固定演示账单
                  </button>
                )}
              </>
            )}
          </div>
        </section>
        <p className="v2-cost-foot">正式费用使用人民币两位小数；保留原币种账单与换算依据。</p>
      </div>
    </div>
  );
}
function Voice() {
  const d = useDemo();
  if (!d.isFixture)
    return (
      <div className="v2-utility-page v2-utility-management">
        <Heading title="声音制作" />
        <section className="native-pending-review" role="status">
          <h2>真实语音制作待接入</h2>
          <p>声线授权、真实语音任务和对白对齐尚未接入本页。不会提供默认对白或模拟生成结果。</p>
          <p>已有本地音频可在素材库导入，并在成片组装中作为 BGM / SFX 使用。</p>
          <div className="actions">
            <Button onClick={() => d.go("assets")}>打开真实素材库</Button>
            <Button onClick={() => d.go("script")}>编辑本集对白</Button>
          </div>
        </section>
      </div>
    );
  const selected = d.characters.find((p) => p.id === d.selectedCharacter);
  const key = (name: string) => `character-${d.selectedCharacter}-${name}`;
  const tone = () =>
    d.edit("声音方向与对白", [
      {
        key: key("tone"),
        label: "声音方向",
        value: d.value(key("tone"), "沉静、克制"),
        options: ["温柔沉静", "清澈明亮", "低沉克制"],
      },
      ...["这段记忆，从来不属于我。", "你终于回来了。", "我们以前，是不是见过？"].map(
        (line, index) => ({
          key: key(`voiceLine-${index}`),
          label: `对白 ${index + 1}`,
          value: d.value(key(`voiceLine-${index}`), line),
        }),
      ),
      {
        key: key("voiceSpeed"),
        label: "语速",
        value: d.value(key("voiceSpeed"), "自然 · 1.0×"),
        options: ["舒缓 · 0.9×", "自然 · 1.0×", "紧凑 · 1.1×"],
      },
    ]);
  return (
    <div className="v2-utility-page v2-voice-page">
      <header className="page-title v2-utility-heading">
        <div>
          <h1>声音</h1>
          <p>《{d.value("title")}》本地演示样例 · 所有状态仅用于界面与流程复刻。</p>
        </div>
        <Button onClick={tone}>详细设置</Button>
      </header>
      <div className="v2-voice-body">
        <aside className="v2-utility-card v2-voice-roster">
          <h2>
            <Icon name="users" size={16} />
            角色声音
          </h2>
          <div className="v2-voice-people">
            {d.characters.map((person, index) => (
              <button
                key={person.id}
                aria-pressed={d.selectedCharacter === person.id}
                onClick={() => d.setSelectedCharacter(person.id)}
              >
                <img src={[avatar, male, rival][index % 3] ?? person.image} alt="" />
                <span>
                  <strong>{person.name}</strong>
                  <small>声线未接入</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <div className="v2-voice-work">
          <section className="v2-utility-card v2-voice-lines">
            <h2>
              <Icon name="audio" size={16} />
              对白 / 配音
            </h2>
            <button className="v2-voice-dialogue" onClick={tone}>
              {selected?.name}：“{d.value(key("voiceLine-0"), "这段记忆，从来不属于我。")}”
            </button>
            <label>
              目标语言
              <select
                value={d.value(key("voiceLanguage"), "跟随项目 · 中文")}
                onChange={(e) => d.put(key("voiceLanguage"), e.target.value)}
              >
                <option>跟随项目 · 中文</option>
                <option>简体中文</option>
              </select>
            </label>
            <div className="v2-voice-actions">
              <Button disabled title="没有可播放的音频文件">
                试听
              </Button>
              <Button disabled title="语音生成服务未接入">
                生成配音
              </Button>
            </div>
            {d.scenario !== "normal" && <LocalState />}
          </section>
          <section className="v2-utility-card v2-voice-mix">
            <h2>
              <Icon name="audio" size={16} />
              对白 / 音乐 / 音效
            </h2>
            {[
              ["对白", "voiceVolume"],
              ["背景音乐", "musicVolume"],
              ["环境声", "environmentVolume"],
            ].map(([label, name]) => (
              <label className="v2-mix-row" key={name}>
                <span>{label}</span>
                <input
                  aria-label={label === "对白" ? "配音音量" : `${label}音量`}
                  type="range"
                  min="0"
                  max="100"
                  value={d.value(key(name!), "68")}
                  onChange={(e) => d.put(key(name!), e.target.value)}
                />
                <span title="没有真实音频，音量仅为设定">—</span>
              </label>
            ))}
          </section>
        </div>
      </div>
      <FlowFooter
        secondaryLabel="哪里不对？"
        secondaryAction={() => d.focusAssistant("请核对当前角色声音方案")}
        label="保存声音方案"
        reason={
          d.value(key("voiceApplied")) === "true"
            ? "设定已应用 · 未生成音频"
            : "无真实音频 · 试听与生成均未接入"
        }
        action={() => {
          d.put(key("voiceApplied"), "true");
          d.notify("声音设定已应用到演示剧集，未生成音频");
          d.go("assembly");
        }}
      />
    </div>
  );
}
