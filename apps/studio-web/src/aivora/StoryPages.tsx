import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { art, sourceText } from "./data";
import { useDemo } from "./model";
import { Button, FlowFooter, PageTitle, Pill } from "./Common";
import { Icon } from "./Icon";
import { selectProductionSourceStage } from "./adapters/productionSourceStage";
import "./v2-story.css";

function Card({
  title,
  icon = "book",
  children,
  className = "",
}: {
  title: string;
  icon?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`v2-story-card ${className}`}>
      <h2>
        <Icon name={icon} size={19} />
        {title}
      </h2>
      {children}
    </section>
  );
}
function EmotionCurve() {
  const plot = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 213, height: 110 });
  useLayoutEffect(() => {
    const element = plot.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0)
        setSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const points = [0.8, 0.58, 0.68, 0.15, 0.47].map((value, index) => [
    2 + (index * (size.width - 4)) / 4,
    value * size.height,
  ]);
  return (
    <svg
      ref={plot}
      className="v2-emotion"
      viewBox={`0 0 ${size.width} ${size.height}`}
      aria-label="示例情绪曲线"
    >
      {[0, 0.5, 1].map((value) => (
        <line
          key={value}
          x1="0"
          y1={value * size.height}
          x2={size.width}
          y2={value * size.height}
          stroke="#173c59"
        />
      ))}
      <polyline
        points={points.map((point) => point.join(",")).join(" ")}
        stroke="#a685ff"
        strokeWidth="2.2"
        fill="none"
      />
      {points.map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="3.5" fill="#68d8ff" />
      ))}
    </svg>
  );
}
const checks = [
  "保留记忆交易的设定",
  "人物动机是否清楚",
  "是否采用开放结尾",
  "整体基调保持克制",
  "原文与推断分开标识",
];
const beats = [
  "发现异常记忆",
  "追查记忆黑市",
  "自己的过去被改写",
  "决定公开城市真相",
  "保留一段开放的未来",
];
const scriptLabels = ["场景描述", "苏晚", "动作", "程野", "剪辑意图"];
const scriptLines = [
  "雨水沿着屋檐落下。路面倒映着城市霓虹。苏晚在街角停住脚步。",
  "“这段记忆，从来不属于我。”",
  "她回头看向人群。程野站在光影交界处，迟迟没有开口。",
  "“记忆可以被修改，选择不能。”",
  "保留一拍停顿，再切城市反应空镜。",
];
export function StoryPages() {
  const d = useDemo();
  const live = useRef(d);
  live.current = d;
  const file = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState(false);
  useEffect(() => {
    if (d.page === "story" && d.value("sourceReviewSubmitted") === "true")
      void d.readRealStoryWorkspace();
  }, [d.page]);
  const sourceVersion = d.value("sourceVersion", "1");
  const sourceNavigation = selectProductionSourceStage(d.sourceStage);
  const showSourceStage = () => {
    if (sourceNavigation.target === "story") d.go("story");
    else if (sourceNavigation.target) d.go("source");
  };
  const scene = Number(d.value("scriptScene", "8"));
  const previewStory = () =>
    d.setEditor({
      title: "星夜之城 · 故事插画",
      image: art.hero,
      images: [
        { src: art.hero, title: "星夜之城 · 故事插画" },
        { src: art.portraitFull, title: "苏晚 · 肖像原图" },
      ],
    });
  const viewEvidence = () =>
    d.setEditor({
      title: "原文依据 · 第一章",
      description: d.value("source"),
      presentation: "drawer",
    });
  function replaceSource(text: string) {
    d.put("source", text);
    d.put("sourceVersion", String(Number(sourceVersion) + 1));
    d.put("sourceApproved", "false");
    d.put("storyConfirmed", "false");
    checks.forEach((_, i) => d.put(`storyCheck${i}`, "false"));
  }
  async function importFile(file: File | undefined) {
    if (file) await d.importRealSource(file);
  }
  function reviewSource() {
    const reviewedSource = d.value("source");
    d.setEditor({
      title: `来源审核 · v${sourceVersion}`,
      description: reviewedSource,
      presentation: "drawer",
      confirm: "提交真实来源审核",
      validate: () => {
        const current = live.current;
        if (current.page !== "source" || current.scenario !== "normal")
          return "当前来源尚不可核对，请返回正常来源状态。";
        if (!current.value("source").trim()) return "请先选择或粘贴来源文本。";
        if (
          current.value("sourceVersion", "1") !== sourceVersion ||
          current.value("source") !== reviewedSource
        )
          return "来源已变化，请关闭抽屉并重新核对。";
      },
      save: () => {
        void d.reviewRealSource().then((submitted) => {
          if (submitted) d.go("story");
        });
      },
    });
  }
  function confirmStory() {
    const snapshot = (current: typeof d) =>
      JSON.stringify(
        [
          "source",
          "sourceVersion",
          "summary",
          "conflict",
          ...checks.map((_, i) => `storyCheck${i}`),
          ...beats.map((_, i) => `event-${i}`),
        ].map((key) => current.value(key)),
      );
    const reviewedContent = snapshot(d);
    d.setEditor({
      title: "确认故事理解",
      description: "核对当前来源和五项故事设定。确认后进入角色与世界；仅改变本次演示状态。",
      presentation: "drawer",
      confirm: "确认并进入角色",
      validate: () => {
        const current = live.current;
        if (current.page !== "story" || current.scenario !== "normal")
          return "当前故事尚不可核对，请返回正常故事状态。";
        if (
          current.value("sourceApproved") !== "true" ||
          current.value("storySourceVersion") !== current.value("sourceVersion", "1")
        )
          return "请先回到来源页审核当前版本。";
        const missing = checks.filter(
          (_, i) => current.value(`storyCheck${i}`, i === 0 ? "true" : "false") !== "true",
        );
        if (missing.length) return `请先核对以下设定：${missing.join("、")}。`;
        if (snapshot(current) !== reviewedContent) return "故事内容已变化，请关闭抽屉并重新核对。";
      },
      save: () => {
        d.put("storyConfirmed", "true");
        d.go("characters");
      },
    });
  }
  const summary = d.value(
    "summary",
    "在记忆可以交易的未来城市，苏晚追查一段不属于自己的记忆，逐渐发现整座城市的秘密。",
  );
  const conflict = d.value(
    "conflict",
    "真实记忆与人造记忆之间：追寻真相，是否意味着放弃被编造的幸福？",
  );
  return (
    <>
      <PageTitle
        actions={
          <>
            {d.page === "story" && (
              <Button icon="expand" data-preview="true" onClick={previewStory}>
                大屏预览
              </Button>
            )}
            <Button onClick={viewEvidence}>查看原文</Button>
          </>
        }
      />
      {d.page === "story" && (
        <p className="v2-source-support" role="status">
          来源状态：{sourceNavigation.status}。
          {sourceNavigation.baselineNote ?? "当前状态来自本地工作区。"}
          {d.storyWorkspaceState === "loading"
            ? " 正在读取故事工作区。"
            : d.storyWorkspaceState === "error"
              ? " 当前状态读取失败，请稍后重试。"
              : ""}
          {sourceNavigation.target && (
            <Button onClick={showSourceStage}>{sourceNavigation.label}</Button>
          )}
        </p>
      )}
      {d.page === "source" ? (
        <div className="v2-source-body">
          <Card title="导入或粘贴故事" className="v2-source-entry">
            <div className="v2-source-tabs">
              <Button aria-pressed={!paste} onClick={() => setPaste(false)}>
                导入文本
              </Button>
              <Button aria-pressed={paste} onClick={() => setPaste(true)}>
                粘贴故事
              </Button>
            </div>
            {paste ? (
              <textarea
                className="v2-source-drop v2-source-editor"
                aria-label="原文正文"
                value={d.value("source")}
                onChange={(e) => replaceSource(e.target.value)}
              />
            ) : (
              <div
                className="v2-source-drop"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void importFile(e.dataTransfer.files[0]);
                }}
              >
                <Icon name="export" size={40} />
                <h3>将小说或剧本拖到这里</h3>
                <p>仅支持 UTF-8 TXT；通过本地工作区导入，来源审核前不会推进故事。</p>
                <Button onClick={() => file.current?.click()}>选择样例文本</Button>
              </div>
            )}
            <input
              ref={file}
              type="file"
              className="sr-only"
              aria-label="替换原文文件"
              accept=".txt,text/plain"
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
            <label className="v2-source-name">
              项目名称
              <input value={d.value("title")} onChange={(e) => d.put("title", e.target.value)} />
            </label>
            <p className="v2-source-support">
              TXT 来源摄取与坐标由本地工作区处理；审核结果未知时不会自动重试。
            </p>
          </Card>
          <div className="v2-source-side">
            <Card title="来源预览" className="v2-source-preview">
              <div className="v2-source-excerpt">
                {d.scenario === "empty" ? "尚未选择文本。" : d.value("source")}
              </div>
              <Pill tone={d.value("importedName") ? "" : "v2-source-built-in"}>
                {d.value("importedName", "内置文本 · 样例")}
              </Pill>
              <p className="v2-source-support" role="status">
                来源状态：{sourceNavigation.status}。
                {sourceNavigation.baselineNote ?? "尚未收到可用来源版本。"}
              </p>
              <div className="actions">
                <Button onClick={() => void d.refreshRealSourceStage()}>刷新来源状态</Button>
                {sourceNavigation.target && (
                  <Button onClick={showSourceStage}>{sourceNavigation.label}</Button>
                )}
              </div>
            </Card>
            <Card title="隐私边界" icon="review">
              <p>提交后会由本地工作区核对来源；尚未接受的版本会保持待审状态。</p>
              <button
                className="text-button v2-source-reset"
                onClick={() => {
                  replaceSource(sourceText);
                  d.put("importedName", "");
                }}
              >
                恢复内置样例
              </button>
            </Card>
          </div>
        </div>
      ) : d.page === "story" ? (
        <div className="v2-story-body">
          <div className="v2-story-top">
            <button className="v2-story-hero" aria-label="预览故事插画" onClick={previewStory}>
              {d.scenario === "empty" ? (
                <span>尚无故事插画</span>
              ) : (
                <img src={art.hero} alt="星夜之城：雨夜中相遇的苏晚与程野" />
              )}
            </button>
            <div className="v2-story-keys">
              <Card title="故事一句话" icon="spark">
                <button
                  className="v2-story-copy"
                  onClick={() =>
                    d.edit("编辑故事一句话", [
                      {
                        key: "summary",
                        label: "故事一句话",
                        type: "textarea",
                        value: summary,
                        required: true,
                      },
                    ])
                  }
                >
                  {summary}
                </button>
                <div className="v2-story-tags">
                  <Pill>近未来</Pill>
                  <Pill>记忆交易</Pill>
                  <Pill>人物成长</Pill>
                </div>
              </Card>
              <Card title="核心冲突" icon="globe">
                <button
                  className="v2-story-copy"
                  onClick={() =>
                    d.edit("编辑核心冲突", [
                      {
                        key: "conflict",
                        label: "核心冲突",
                        type: "textarea",
                        value: conflict,
                        required: true,
                      },
                    ])
                  }
                >
                  {conflict}
                </button>
                <div className="v2-story-tags">
                  <Pill>身份认同</Pill>
                  <Pill>真实与选择</Pill>
                </div>
              </Card>
            </div>
          </div>
          <div className="v2-story-bottom">
            <Card title="主要人物" icon="users">
              <div className="v2-story-people">
                {d.characters.slice(0, 3).map((person, i) => (
                  <button
                    key={person.id}
                    onClick={() => {
                      d.setSelectedCharacter(person.id);
                      d.go("character");
                    }}
                  >
                    <img src={person.image} alt="" />
                    <span>
                      <strong>{person.name}</strong>
                      <small>
                        {
                          [
                            "记忆修复师 · 追寻真相",
                            "神经工程师 · 隐藏过去",
                            "记忆集团顾问 · 关键对手",
                          ][i]
                        }
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <button className="v2-card-bottom-link" onClick={() => d.go("characters")}>
                {"查看角色关系　›"}
              </button>
            </Card>
            <Card title="剧情结构" icon="book">
              <ol className="v2-story-beats">
                {beats.map((line, i) => (
                  <li key={line}>
                    <b>{i + 1}</b>
                    <span>{["开端", "发展", "转折", "高潮", "结局"][i]}</span>
                    <button
                      onClick={() =>
                        d.edit("修改剧情事件", [
                          {
                            key: `event-${i}`,
                            label: "事件内容",
                            value: d.value(`event-${i}`, line),
                            required: true,
                          },
                        ])
                      }
                    >
                      {d.value(`event-${i}`, line)}
                    </button>
                  </li>
                ))}
              </ol>
            </Card>
            <Card title="情绪曲线" icon="spark">
              <EmotionCurve />
              <small className="v2-card-bottom-link">示例节奏 · 非质量评分</small>
            </Card>
            <Card title="待你确认" icon="review">
              <div className="v2-story-checks">
                {checks.map((label, i) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={d.value(`storyCheck${i}`, i === 0 ? "true" : "false") === "true"}
                      onChange={(e) => {
                        d.put(`storyCheck${i}`, String(e.target.checked));
                        d.put("storyConfirmed", "false");
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="v2-script-body">
          <Card title="场次" className="v2-script-index">
            <div className="v2-script-scene-list">
              {[
                1,
                2,
                3,
                8,
                ...Array.from({ length: Number(d.value("extraScenes", "0")) }, (_, i) => 9 + i),
              ].map((id) => (
                <Button
                  key={id}
                  aria-pressed={scene === id}
                  onClick={() => d.put("scriptScene", String(id))}
                >
                  {String(id).padStart(2, "0")} ·{" "}
                  {(
                    {
                      1: "记忆修复中心",
                      2: "城市街口",
                      3: "地下记忆市场",
                      8: "雨夜街道",
                    } as Record<number, string>
                  )[id] ?? "新场次"}
                </Button>
              ))}
            </div>
            <button
              className="v2-extra-scene text-button"
              onClick={() => {
                const count = Number(d.value("extraScenes", "0")) + 1;
                d.put("extraScenes", String(count));
                d.put("scriptScene", String(count + 8));
              }}
            >
              新增场次
            </button>
          </Card>
          <Card
            title={`场次 ${String(scene).padStart(2, "0")} · ${scene === 8 ? "雨夜街道 · 夜 / 外" : "故事场景"}`}
            icon="film"
            className="v2-script-paper"
          >
            <p className="v2-script-provenance">演示剧本 · 所有对白与场次均为样例</p>
            <div className="v2-script-lines">
              {scriptLabels.map((label, i) => (
                <label key={label}>
                  {label}
                  <textarea
                    aria-label={i === 0 ? "场次动作" : i === 1 ? "对白编辑" : label}
                    value={d.value(`script-${scene}-${i}`, scriptLines[i])}
                    onChange={(e) => {
                      d.put(`script-${scene}-${i}`, e.target.value);
                      d.put("scriptSaved", "false");
                    }}
                  />
                </label>
              ))}
            </div>
          </Card>
        </div>
      )}
      <FlowFooter
        secondaryLabel="哪里不对？"
        secondaryAction={() =>
          d.focusAssistant(
            `修改当前${d.page === "source" ? "来源" : d.page === "story" ? "故事理解" : "剧本"}：`,
          )
        }
        label={
          d.page === "source"
            ? "开始理解故事"
            : d.page === "story"
              ? "确认故事理解"
              : "确认样例剧本"
        }
        reason={
          d.page === "source"
            ? "当前选择：内置故事样例"
            : d.page === "story"
              ? "样例初稿 · 确认仅改变演示状态"
              : "剧本文本可局部滚动 · 画布与操作栏固定"
        }
        disabled={d.page === "source" && !d.value("source").trim()}
        action={
          d.page === "source"
            ? reviewSource
            : d.page === "story"
              ? confirmStory
              : () => {
                  d.put("scriptSaved", "true");
                  d.notify("剧本演示版本已确认");
                }
        }
      />
    </>
  );
}
