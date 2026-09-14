import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { art } from "./data";
import { useDemo } from "./model";
import { useCurrentObject } from "./useCurrentObject";
import { Button, FlowFooter, PageTitle } from "./Common";
import { Dropdown } from "./Dropdown";
import storyArt from "./assets/v2/story-art.png";
import cityWide from "./assets/v2/city-wide.png";
import street from "./assets/v2/street.png";
import front from "./assets/v2/front.png";
import side from "./assets/v2/side.png";
import medical from "./assets/v2/medical.png";
import "./v2-visual.css";
import "./v21-scene-r1.css";

export function ScenePage() {
  const { d, field, putField } = useCurrentObject();
  const [mediaAspect, setMediaAspect] = useState(16 / 9);
  if (!d.locations.length) {
    return (
      <section className="v2-visual-page">
        <h1>场景</h1>
        <p>尚未从已确认的故事资料读取场景。</p>
      </section>
    );
  }
  const location = d.locations.find((item) => item.id === d.selectedLocation) ?? d.locations[0]!;
  const views =
    location.id === 1
      ? [
          { name: "主参考图", label: "主参考", image: street },
          { name: "正向视角", label: "正向", image: cityWide },
          { name: "反向视角", label: "反向", image: street },
          { name: "高位视角", label: "高机位", image: cityWide },
          { name: "关键区域", label: "关键区域", image: street },
        ]
      : [
          {
            name: "主参考图",
            label: "主参考",
            image: location.image === "sea" ? art.sea : art.morning,
          },
        ];
  const view =
    location.id === 1 && field("view") === "全景"
      ? { name: "全景", label: "全景", image: art.streetWide }
      : (views.find((item) => item.name === field("view", "主参考图")) ?? views[0]!);
  const state = field("state", location.id === 1 ? "夜 · 雨" : "白天");
  const blocked = ["empty", "loading", "error"].includes(d.scenario);
  const details = () =>
    d.setEditor({
      title: `${location.name} · 详细设定`,
      presentation: "drawer",
      description:
        "本页为静态场景样例，缩略图复用随设计交付的参考素材。环境状态与镜头要求只保存为设定，不会自动改图。",
      fields: [
        {
          key: "description",
          label: "空间与叙事",
          value: field("description", "科技融入城市生活，保留真实街道的温度。"),
          type: "textarea",
        },
        { key: "lighting", label: "光线与氛围", value: field("lighting", "冷暖对比") },
        {
          key: "view",
          label: "参考视角",
          value: view.name,
          options:
            location.id === 1
              ? [...views.map((item) => item.name), "全景"]
              : views.map((item) => item.name),
        },
        {
          key: "confirmed",
          label: "当前场景确认",
          value: field("confirmed") === "true" ? "已确认" : "待确认",
          options: ["待确认", "已确认"],
        },
      ],
      confirm: "保存设定",
      save: (data) => {
        Object.entries(data)
          .filter(([key]) => key !== "confirmed")
          .forEach(([key, value]) => putField(key, value));
        const changed =
          data.description !== field("description", "科技融入城市生活，保留真实街道的温度。") ||
          data.lighting !== field("lighting", "冷暖对比");
        putField("confirmed", String(!changed && data.confirmed === "已确认"));
        d.put("assetsConfirmed", "false");
      },
    });
  const addScene = () =>
    d.edit("新增场景", [{ key: "name", label: "地点名称", value: "", required: true }], (data) => {
      const id = Date.now();
      d.setLocations((old) => [...old, { id, name: data.name!, image: "morning" }]);
      d.setSelectedLocation(id);
      d.put("assetsConfirmed", "false");
    });
  function confirmScenes() {
    if (blocked || !d.locations.length) return;
    d.setEditor({
      title: "核对本集全部场景",
      presentation: "drawer",
      description:
        d.locations
          .map(
            (item) =>
              `${item.name} · ${d.value(`scene-${item.id}-state`, item.id === 1 ? "夜 · 雨" : "白天")} · 静态参考`,
          )
          .join("\n\n") + "\n\n确认后进入分镜；以后编辑空间或环境将使场景确认失效。",
      confirm: "确认全部场景并进入分镜",
      save: () => {
        d.locations.forEach((item) => d.put(`scene-${item.id}-confirmed`, "true"));
        d.put(
          "assetsConfirmed",
          String(
            d.value("worldConfirmed") === "true" &&
              d.characters.every((person) => d.value(`locked-${person.id}`) === "true"),
          ),
        );
        d.go("storyboard");
      },
    });
  }
  return (
    <>
      <PageTitle
        actions={
          <>
            <Dropdown className="v2-visual-actions" summaryClassName="button" summary="详细信息">
              <div>
                <Button onClick={details}>场景设定与确认</Button>
                <Button onClick={addScene}>新增场景</Button>
              </div>
            </Dropdown>
          </>
        }
      />
      <div
        className="v2-scenes-body v21-scenes"
        style={{ "--v21-local-media-aspect": mediaAspect } as CSSProperties}
      >
        <div className="v2-scenes-toolbar">
          <select
            aria-label="当前地点"
            value={location.id}
            onChange={(event) => d.setSelectedLocation(Number(event.target.value))}
          >
            {d.locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            aria-label="环境状态"
            value={state}
            onChange={(event) => {
              putField("state", event.target.value);
              putField("confirmed", "false");
              d.put("assetsConfirmed", "false");
            }}
          >
            {["夜 · 雨", "白天", "傍晚", "夜 · 晴", "大雨", "雾天"].map((item) => (
              <option key={item} value={item}>
                环境：{item === "夜 · 雨" ? "雨夜" : item}
              </option>
            ))}
          </select>
          <Button onClick={details}>空间设定</Button>
        </div>
        <div className="v21-scene-stage" style={{ "--scene-aspect": mediaAspect } as CSSProperties}>
          {blocked ? (
            <div className="v2-scenes-hero v2-visual-empty" role="status">
              <h2>
                {d.scenario === "empty"
                  ? "尚无场景参考"
                  : d.scenario === "loading"
                    ? "正在加载场景参考"
                    : "场景参考加载失败"}
              </h2>
              <Button onClick={() => d.setScenario("normal")}>
                {d.scenario === "error" ? "重试" : "查看样例参考"}
              </Button>
            </div>
          ) : (
            <button
              className="v2-scenes-hero v2-visual-image"
              aria-label="放大场景"
              onClick={() =>
                d.setEditor({ title: `${location.name} · ${view.label}`, image: view.image })
              }
            >
              <img
                src={view.image}
                alt={`${location.name} ${view.label}样例参考`}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalHeight) setMediaAspect(image.naturalWidth / image.naturalHeight);
                }}
              />
            </button>
          )}
        </div>
        <div className="v2-scenes-references">
          {views.map((item) => (
            <button
              key={item.name}
              className={view.name === item.name ? "selected" : ""}
              aria-pressed={view.name === item.name}
              onClick={() => putField("view", item.name)}
            >
              <img src={item.image} alt={`${item.label}样例缩略图`} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <aside className="v21-scene-info" aria-label="当前场景设定" tabIndex={0}>
          <div className="v21-scene-info-heading">
            <h2>环境与空间</h2>
            <Button onClick={details}>编辑设定</Button>
          </div>
          <dl>
            <div>
              <dt>环境</dt>
              <dd>{state}</dd>
            </div>
            <div>
              <dt>光线</dt>
              <dd>{field("lighting", "冷暖对比")}</dd>
            </div>
            <div>
              <dt>视角</dt>
              <dd>{view.label}</dd>
            </div>
          </dl>
          <div className="v21-scene-description">
            <h3>空间与叙事</h3>
            <p>{field("description", "科技融入城市生活，保留真实街道的温度。")}</p>
          </div>
          <p className="v21-scene-confirmation">
            {field("confirmed") === "true" ? "当前场景已确认" : "当前场景待确认"}
          </p>
        </aside>
      </div>
      <FlowFooter
        label="确认场景并进入分镜"
        secondaryLabel="哪里不对？"
        secondaryAction={() => d.focusAssistant(`调整场景「${location.name}」的${state}状态：`)}
        disabled={blocked}
        reason={blocked ? "请先检查场景参考与环境设定" : "静态场景参考 · 不是视频"}
        action={confirmScenes}
      />
    </>
  );
}

export function AssetsPage() {
  const d = useDemo();
  const file = useRef<HTMLInputElement>(null);
  const query = d.value("assetQuery");
  const category = d.value("assetCategory", "全部");
  const mediaType = d.value("assetType", "全部");
  const gallery = [
    { id: "story", name: "故事参考", image: storyArt, category: "场景" },
    { id: "city", name: "世界主视觉", image: cityWide, category: "场景" },
    { id: "front", name: "角色正面", image: front, category: "角色" },
    { id: "street", name: "场景参考", image: street, category: "场景" },
    { id: "side", name: "角色侧面", image: side, category: "角色" },
    { id: "medical", name: "服装参考", image: medical, category: "角色" },
    ...d.localAssets,
  ];
  const list = gallery.filter(
    (item) =>
      (mediaType === "全部" || mediaType === "图片") &&
      (category === "全部" || item.category === category) &&
      item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selected =
    d.scenario === "empty"
      ? undefined
      : (list.find((item) => item.id === d.value("assetSelected")) ?? list[0]);
  const filtered = query || category !== "全部";
  const preview = (item: (typeof gallery)[number]) => {
    d.put("assetSelected", item.id);
    d.setEditor({
      title: item.name,
      image: item.image,
      presentation: "drawer",
      description: `${item.category} · ${item.category === "本地导入" ? "当前会话内的本地图片" : "内置设计样例"}\n引用位置：项目创作参考`,
      confirm: d.references.includes(item.name) ? "移除项目引用" : "添加项目引用",
      save: () =>
        d.setReferences((old) =>
          old.includes(item.name) ? old.filter((name) => name !== item.name) : [...old, item.name],
        ),
    });
  };
  const openImage = (item: (typeof gallery)[number]) => {
    d.put("assetSelected", item.id);
    d.setEditor({ title: item.name, image: item.image });
  };
  const details = () =>
    d.setEditor({
      title: "素材筛选与引用",
      presentation: "drawer",
      description: `已引用：${d.references.join("、") || "暂无"}。本地导入仅保存在当前会话，刷新后恢复样例。`,
      fields: [
        { key: "assetQuery", label: "搜索素材", value: query },
        {
          key: "assetCategory",
          label: "素材分类",
          value: category,
          options: ["全部", "角色", "场景", "本地导入"],
        },
      ],
      confirm: "应用筛选",
      save: (values) => Object.entries(values).forEach(([key, value]) => d.put(key, value)),
    });
  return (
    <>
      <PageTitle actions={<Button onClick={details}>详细信息</Button>} />
      <input
        ref={file}
        className="sr-only"
        aria-label="导入素材文件"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={async (event) => {
          const files = [...(event.target.files ?? [])];
          for (const item of files) {
            if (
              !["image/png", "image/jpeg", "image/webp"].includes(item.type) ||
              item.size > 10_000_000
            ) {
              d.notify("支持 10MB 以内的 PNG、JPEG、WebP 图片");
              continue;
            }
            const image = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("读取失败"));
              reader.readAsDataURL(item);
            }).catch(() => "");
            if (image)
              d.setLocalAssets((old) => [
                ...old,
                { id: `${Date.now()}-${item.name}`, name: item.name, image, category: "本地导入" },
              ]);
            else d.notify(`${item.name}读取失败`);
          }
          event.target.value = "";
        }}
      />
      <div className="v2-assets-body">
        <div className="v2-assets-toolbar">
          <div role="group" aria-label="素材类型">
            {["全部", "图片", "视频", "音频", "文档"].map((type) => (
              <button
                key={type}
                className={mediaType === type ? "selected" : ""}
                aria-pressed={mediaType === type}
                onClick={() => d.put("assetType", type)}
              >
                {type}
              </button>
            ))}
          </div>
          <Button onClick={() => file.current?.click()}>导入素材</Button>
        </div>
        <div className="v2-assets-grid">
          {d.scenario === "empty" || !list.length ? (
            <div className="v2-visual-empty">
              <h2>{d.scenario === "empty" ? "项目尚无素材" : "没有匹配的素材"}</h2>
              <p>
                {["视频", "音频"].includes(mediaType)
                  ? "当前仅有内置图片样例，尚无真实视频或音频。"
                  : "试试其他名称或分类。"}
              </p>
              <Button
                onClick={() => {
                  d.setScenario("normal");
                  d.put("assetType", "全部");
                  d.put("assetCategory", "全部");
                  d.put("assetQuery", "");
                }}
              >
                查看全部样例
              </Button>
            </div>
          ) : (
            list.map((item) => (
              <article key={item.id} className="v2-assets-card">
                <button
                  className="v2-assets-card-image"
                  aria-label={`大屏查看${item.name}`}
                  onClick={() => openImage(item)}
                >
                  <img src={item.image} alt={item.name} />
                </button>
                <button
                  className="v2-assets-card-info"
                  aria-label={`${item.name}详情与引用`}
                  onClick={() => preview(item)}
                >
                  <strong>{item.name}</strong>
                  <small>
                    {item.category === "本地导入"
                      ? "本地导入 · 当前会话"
                      : "内置样例 · 非正式可发布资产"}
                    {d.references.includes(item.name) ? " · 已引用" : ""}
                  </small>
                </button>
              </article>
            ))
          )}
        </div>
      </div>
      <FlowFooter
        label="查看选中素材"
        secondaryLabel="返回项目"
        secondaryAction={() => d.go("project")}
        reason={
          filtered
            ? `筛选：${category}${query ? ` · ${query}` : ""} · ${list.length} 项`
            : "素材网格可内部滚动 · 图片按比例显示"
        }
        disabled={!selected}
        action={() => selected && openImage(selected)}
      />
    </>
  );
}
