import React, { useMemo, useState } from 'react';
import './aivora-ui-demo.css';

type Stage = '故事' | '角色与世界' | '分镜' | '制作' | '审片';
type WorldDetail = '时代与城市' | '科技设定' | '社会与生活' | '世界规则';

const stages: Stage[] = ['故事', '角色与世界', '分镜', '制作', '审片'];

const initialWorld = {
  title: '星夜之城',
  subtitle: '记忆藏着另一个世界',
  tags: ['近未来', '滨海都市', '记忆科技', '现实主义电影感'],
  summary:
    '2045 年，记忆可以被读取、交易和修改。科技已经融入日常生活，而真实记忆与人工记忆之间的冲突正在改变这座城市，也影响着每个人的命运。',
};

const detailCopy: Record<WorldDetail, string> = {
  时代与城市: '近未来 2045 年，滨海都市。现代城市基底保持真实，只在医疗、广告和公共设施中体现近未来科技。',
  科技设定: '记忆读取、记忆交易与记忆修改已经商品化，但关键记忆仍受监管与伦理约束。',
  社会与生活: '人们可以保存、交换甚至重塑部分记忆，科技已融入普通人的工作、社交和消费。',
  世界规则: '真实记忆与人工记忆之间存在不可完全消除的差异；高风险记忆修改必须留下可追溯记录。',
};

export default function AivoraUiDemo() {
  const [mode, setMode] = useState<'普通模式' | '专业模式'>('普通模式');
  const [stage, setStage] = useState<Stage>('角色与世界');
  const [detailOpen, setDetailOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revision, setRevision] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState(
    '世界观初稿已完成。我根据故事确定了近未来滨海都市、记忆科技，以及“真实记忆 vs. 人造记忆”的核心规则。整体感觉符合你的想象吗？',
  );

  const stageIndex = useMemo(() => stages.indexOf(stage), [stage]);

  const applyRevision = () => {
    if (!revision.trim()) return;
    setAssistantMessage(
      `收到。我会按“${revision.trim()}”调整视觉方向，并保持已经确认的故事事实不变。这个演示只更新 UI 状态，不调用真实 AI。`,
    );
    setRevision('');
    setRevisionOpen(false);
    setConfirmed(false);
  };

  return (
    <div className="aivora-demo-shell">
      <header className="aivora-topbar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">AIVORA</div>
            <div className="brand-sub">AI Story & Motion Studio</div>
          </div>
        </div>
        <button className="project-switch">星夜之城 <span>⌄</span></button>
        <div className="top-spacer" />
        <div className="mode-switch" aria-label="模式切换">
          {(['普通模式', '专业模式'] as const).map((item) => (
            <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>{item}</button>
          ))}
        </div>
        <div className="save-state">☁ 已保存 10:24</div>
        <div className="user-pill">陈</div>
      </header>

      <aside className="left-nav">
        <nav>
          <button>⌂ <span>创作</span></button>
          <button className="section">▣ <span>故事</span></button>
          <button className="section expanded">◉ <span>角色与世界</span><b>⌄</b></button>
          <button className="sub">角色</button>
          <button className="sub active">世界观</button>
          <button className="sub">场景</button>
          <button>▧ <span>分镜</span></button>
          <button>▣ <span>制作</span></button>
          <button>▤ <span>审片</span></button>
          <div className="nav-separator" />
          <button>✣ <span>素材</span></button>
          <button>⇩ <span>导出</span></button>
          <div className="nav-separator" />
          <button>⚙ <span>AI 服务</span></button>
          <button>⚙ <span>设置</span></button>
        </nav>
        <div className="storage-card">
          <span>项目存储</span><b>128 GB / 1 TB</b>
          <div><i /></div>
        </div>
      </aside>

      <main className="main-area">
        <div className="stage-bar" aria-label="创作阶段">
          {stages.map((item, index) => (
            <React.Fragment key={item}>
              <button className={stage === item ? 'current' : index < stageIndex ? 'done' : ''} onClick={() => setStage(item)}>
                <span>{index + 1}</span>{item}
              </button>
              {index < stages.length - 1 && <em>›</em>}
            </React.Fragment>
          ))}
        </div>

        <section className="world-page">
          <div className="page-heading-row">
            <div>
              <h1>世界观设定</h1>
              <p>基于你的故事，Aivora 已生成这个世界的视觉风格与基础设定。请确认是否符合你的想象，或告诉我需要调整的地方。</p>
            </div>
            <button className="detail-link" onClick={() => setDetailOpen(true)}>详细设定 ›</button>
          </div>

          <div className="hero-card">
            <div className="hero-placeholder" role="img" aria-label="星夜之城 16:9 世界主视觉演示占位">
              <div className="hero-glow" />
              <div className="moon" />
              <div className="skyline">
                {Array.from({ length: 18 }).map((_, i) => <span key={i} style={{ height: `${28 + ((i * 17) % 55)}%` }} />)}
              </div>
              <div className="water" />
              <div className="hero-copy">
                <strong>星夜之城</strong>
                <span>记忆藏着另一个世界</span>
              </div>
              <div className="demo-chip">UI DEMO · 16:9</div>
            </div>
          </div>

          <div className="world-meta">
            <h2>{initialWorld.title}</h2>
            <p className="subtitle">{initialWorld.subtitle}</p>
            <div className="tag-row">{initialWorld.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            <p className="world-summary">{initialWorld.summary}</p>
          </div>

          {mode === '专业模式' && (
            <div className="pro-preview">
              <strong>专业模式 · World Inspector（UI Demo）</strong>
              <span>Visual Baseline · Location Profile · Environment State · Canon / Evidence · References</span>
            </div>
          )}

          <div className="action-row">
            <button className="secondary-cta" onClick={() => setRevisionOpen((v) => !v)}>
              <strong>哪里不对？</strong><span>告诉 Aivora 你想调整什么</span>
            </button>
            <button className="primary-cta" onClick={() => { setConfirmed(true); setAssistantMessage('世界观已在 UI Demo 中标记为“已确认”。下一项将进入场景设定。'); }}>
              <strong>{confirmed ? '已确认世界观' : '确认世界观 →'}</strong><span>{confirmed ? '演示状态已更新' : '进入下一项：场景'}</span>
            </button>
          </div>

          {revisionOpen && (
            <div className="revision-panel">
              <textarea value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="例如：城市更现实一些，少一点赛博朋克；科技只融入医疗与公共设施。" />
              <div><button onClick={() => setRevisionOpen(false)}>取消</button><button className="apply" onClick={applyRevision}>应用到演示</button></div>
            </div>
          )}
        </section>
      </main>

      <aside className="assistant-panel">
        <div className="assistant-head"><div className="assistant-logo">A</div><div><strong>Aivora AI</strong><span>● 在线 · 你的创作伙伴</span></div></div>
        <div className="assistant-card"><p>{assistantMessage}</p></div>
        <div className="assistant-card compact">
          <b>你可以这样说：</b>
          <button onClick={() => setRevision('城市更现实一些，少一点赛博朋克')}>城市更现实一些</button>
          <button onClick={() => setRevision('增加更多与记忆科技有关的城市细节')}>增加更多科技设定</button>
          <button onClick={() => setRevision('强化真实记忆与人工记忆冲突的戏剧性')}>强化记忆冲突</button>
        </div>
        <div className="assistant-input"><input placeholder="输入你的想法…" value={revision} onChange={(e) => setRevision(e.target.value)} /><button onClick={() => { setRevisionOpen(true); }}>➤</button></div>
      </aside>

      {detailOpen && (
        <div className="drawer-backdrop" onClick={() => setDetailOpen(false)}>
          <section className="detail-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head"><div><span>普通模式 · 按需展开</span><h2>世界观详细设定</h2></div><button onClick={() => setDetailOpen(false)}>×</button></div>
            {(Object.keys(detailCopy) as WorldDetail[]).map((key) => (
              <details key={key}><summary>{key}</summary><p>{detailCopy[key]}</p></details>
            ))}
            <div className="drawer-note">这些详细字段在普通模式默认收起；专业模式将通过 World Inspector 展开控制层。</div>
          </section>
        </div>
      )}
    </div>
  );
}
