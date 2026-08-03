import { useCallback, useEffect, useMemo, useState } from "react";

import { createHealthTransport, type HealthResponse, type HealthTransport } from "./api/health";

type ConnectionState =
  { kind: "loading" } | { kind: "connected"; health: HealthResponse } | { kind: "error" };

interface AppProps {
  transport?: HealthTransport;
}

const navigation = [
  ["项目", "01"],
  ["故事工坊", "02"],
  ["分镜导演", "03"],
  ["素材中心", "04"],
  ["剪辑台", "05"],
  ["任务队列", "06"],
] as const;

const pipeline = [
  { index: "01", title: "导入故事", detail: "TXT / Markdown", status: "下一切片" },
  { index: "02", title: "拆解剧本", detail: "人物 · 场景 · 节拍", status: "待开发" },
  { index: "03", title: "导演分镜", detail: "镜头 · 提示词 · 连贯性", status: "待开发" },
] as const;

export function App({ transport }: AppProps) {
  const healthTransport = useMemo(() => transport ?? createHealthTransport(), [transport]);
  const [connection, setConnection] = useState<ConnectionState>({ kind: "loading" });

  const connect = useCallback(async () => {
    setConnection({ kind: "loading" });
    try {
      const health = await healthTransport.getHealth();
      setConnection({ kind: "connected", health });
    } catch {
      setConnection({ kind: "error" });
    }
  }, [healthTransport]);

  useEffect(() => {
    void connect();
  }, [connect]);

  return (
    <div className="studio-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Aijian Studio 首页">
          <span className="brand-mark" aria-hidden="true">
            剪
          </span>
          <span>
            <strong>AIJIAN</strong>
            <small>STUDIO</small>
          </span>
        </a>

        <nav className="primary-nav" aria-label="创作模块">
          <p className="nav-label">工作区</p>
          {navigation.map(([label, index], itemIndex) => (
            <button className={itemIndex === 0 ? "nav-item active" : "nav-item"} key={label}>
              <span>{index}</span>
              {label}
              {itemIndex > 0 && <i>即将推出</i>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="phase-dot" />
          <div>
            <strong>Phase 0</strong>
            <small>工程骨架 · 0.1.0</small>
          </div>
        </div>
      </aside>

      <main id="top" className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">个人创作空间</span>
            <h1>项目总览</h1>
          </div>
          <button className="primary-action" disabled title="项目创建将在下一切片开放">
            <span aria-hidden="true">＋</span> 新建项目
          </button>
        </header>

        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="edition">CREATOR PREVIEW</span>
            <h2 id="hero-title">
              <span>把一个故事，变成一部</span>
              <em>能继续创作的影片。</em>
            </h2>
            <p>从小说拆解、剧本编排到分镜、素材与剪辑，每一步都保留来源、版本和人工决定。</p>
          </div>
          <div className={`engine-status ${connection.kind}`} aria-live="polite">
            <span className="signal" aria-hidden="true" />
            {connection.kind === "loading" && (
              <div>
                <small>ENGINE STATUS</small>
                <strong>正在连接创作引擎…</strong>
                <p>正在校验本地服务契约</p>
              </div>
            )}
            {connection.kind === "connected" && (
              <div>
                <small>ENGINE STATUS</small>
                <strong>创作引擎已连接</strong>
                <p>
                  {connection.health.data.service} · v{connection.health.data.version}
                </p>
              </div>
            )}
            {connection.kind === "error" && (
              <div>
                <small>ENGINE STATUS</small>
                <strong>创作引擎未连接</strong>
                <p>请先启动本地 API，再重新连接</p>
                <button className="text-action" onClick={() => void connect()}>
                  重新连接
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="section-block" aria-labelledby="pipeline-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PRODUCTION PIPELINE</span>
              <h2 id="pipeline-title">从原作开始</h2>
            </div>
            <span className="milestone">首个可运行纵切</span>
          </div>

          <div className="pipeline-grid">
            {pipeline.map((step) => (
              <article className="pipeline-card" key={step.index}>
                <div className="card-index">{step.index}</div>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </div>
                <span>{step.status}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="foundation-note">
          <div className="note-symbol" aria-hidden="true">
            ◇
          </div>
          <div>
            <span className="eyebrow">当前完成</span>
            <h2>可验证的创作底座</h2>
            <p>
              前后端共享 OpenAPI 契约；浏览器使用同源传输，桌面端使用隔离 IPC。下一步接入随机端口
              sidecar 与项目导入，不把开发端口当作交付方案。
            </p>
          </div>
          <div className="foundation-tags" aria-label="已完成能力">
            <span>FastAPI</span>
            <span>Typed Contract</span>
            <span>React Workspace</span>
          </div>
        </section>
      </main>
    </div>
  );
}
