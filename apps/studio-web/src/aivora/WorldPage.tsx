import { Button, FlowFooter, PageTitle, Pill } from "./Common";
import { useDemo } from "./model";
import cityWide from "./assets/v2/city-wide.png";
import "./v2-visual.css";

export function WorldPage() {
  const d = useDemo();
  const activeProject = d.projects.find((project) => String(project.id) === d.value("projectId"));
  const summary = d.value("worldNote");
  if (!activeProject) {
    return (
      <section className="v2-visual-page" role="status">
        <h1>世界观</h1>
        <p>尚未选择真实项目，无法读取世界设定或确认世界观。</p>
      </section>
    );
  }
  const details = () =>
    d.setEditor({
      title: "详细世界设定",
      presentation: "drawer",
      description: "当前世界草稿 · 演示数据。修改设定不会自动生成或替换参考画面。",
      fields: [
        {
          key: "worldNote",
          label: "世界定位与核心规则",
          type: "textarea",
          value: summary,
          required: true,
        },
        { key: "worldEra", label: "时代背景", value: d.value("worldEra") },
        {
          key: "worldLocation",
          label: "地理与城市",
          value: d.value("worldLocation"),
        },
        {
          key: "worldTechnology",
          label: "科技边界",
          value: d.value("worldTechnology"),
        },
        {
          key: "worldStyle",
          label: "视觉方向",
          value: d.value("worldStyle"),
          options: ["现实主义电影感", "都市电影质感", "柔和青春叙事"],
        },
      ],
      confirm: "保存设定",
      save: (values) => {
        d.put("worldConfirmed", "false");
        d.put("assetsConfirmed", "false");
        Object.entries(values).forEach(([key, value]) => d.put(key, value));
        d.notify("世界设定已保存为演示草稿");
      },
    });
  const blocked = ["empty", "loading", "error"].includes(d.scenario);
  return (
    <>
      <PageTitle actions={<Button onClick={details}>详细设定</Button>} />
      <div className="v2-world-body">
        {blocked ? (
          <div className="v2-world-hero v2-visual-empty" role="status">
            <h2>
              {d.scenario === "empty"
                ? "尚无世界参考"
                : d.scenario === "loading"
                  ? "正在加载世界参考"
                  : "世界参考加载失败"}
            </h2>
            <Button onClick={() => d.setScenario("normal")}>
              {d.scenario === "error" ? "重试" : "查看样例参考"}
            </Button>
          </div>
        ) : (
          <button
            className="v2-world-hero v2-visual-image"
            aria-label="全屏查看世界观"
            onClick={() =>
              d.setEditor({ title: `${d.value("title")} · 世界参考`, image: cityWide })
            }
          >
            <img src={cityWide} alt="星夜之城 · 滨海都市世界观参考" />
          </button>
        )}
        <section className="v2-world-summary">
          <h2>{d.value("title")}</h2>
          <div className="v2-world-tags">
            {[
              d.value("worldEra"),
              d.value("worldLocation"),
              d.value("worldTechnology"),
              d.value("worldStyle"),
            ]
              .filter(Boolean)
              .map((tag) => (
                <Pill key={tag}>{tag}</Pill>
              ))}
          </div>
          <p>{summary}</p>
        </section>
      </div>
      <FlowFooter
        label="确认世界观"
        secondaryLabel="哪里不对？"
        secondaryAction={() => d.focusAssistant(`修改「${d.value("title")}」的世界观：`)}
        disabled={blocked}
        reason={blocked ? "请先读取完整世界设定与参考" : "世界视觉仅为样例 · 下一项是场景"}
        action={() => {
          d.put("worldConfirmed", "true");
          d.go("scenes");
        }}
      />
    </>
  );
}
