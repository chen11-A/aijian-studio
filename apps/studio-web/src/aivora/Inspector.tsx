import { Button, Tabs } from "./Common";
import { Logo } from "./Icon";
import { pages } from "./data";
import { shotAtTime } from "./model";
import { mediaTimecode } from "./MediaPages";
import { useCurrentObject } from "./useCurrentObject";
import "./v2-inspector.css";

type Spec = {
  key: string;
  label: string;
  fallback: string;
  options?: string[];
  number?: [number, number];
  multiline?: boolean;
};
type Property = {
  label: string;
  value: string;
  note?: string;
  change?: (value: string) => void;
};
const spec = (key: string, label: string, fallback: string, options?: string[]): Spec => ({
  key,
  label,
  fallback,
  options,
});

export function Inspector() {
  const o = useCurrentObject();
  const { d, shot, person, family, field, putField } = o;
  const tabs =
    family === "shot"
      ? ["基础", "画面", "表演", "运镜", "参考"]
      : family === "character"
        ? ["身份", "外观", "声音", "关联"]
        : family === "generation"
          ? ["生成", "参数", "参考"]
          : family === "assembly"
            ? ["剪辑", "调色", "声音", "字幕"]
            : family === "story"
              ? ["基础", "结构", "依据"]
              : family === "review"
                ? ["批注", "镜头"]
                : ["设定", "版本"];
  const tab = d.value(`inspector-tab-${family}`, tabs[0]!);
  const actualTab = tabs.includes(tab) ? tab : tabs[0]!;
  let fields: Spec[] = [];
  if (family === "shot") {
    fields =
      actualTab === "基础"
        ? [
            spec(
              "framing",
              "镜头类型",
              shot.id === 1 ? "全景 (WS)" : shot.id === 3 ? "近景 (CU)" : "中近景 (MCU)",
              ["大远景 (ELS)", "全景 (WS)", "中景 (MS)", "中近景 (MCU)", "近景 (CU)", "特写 (ECU)"],
            ),
            spec("cameraHeight", "机位高度", "眼平视角", [
              "眼平视角",
              "低机位",
              "高机位",
              "俯视",
              "仰视",
            ]),
            spec("movement", "镜头运动", "慢推 (Slow Push-in)", [
              "固定",
              "慢推 (Slow Push-in)",
              "拉远",
              "横移",
              "跟随",
              "摇镜",
            ]),
            spec("focalLength", "镜头焦距", "50mm（等效）", [
              "24mm（等效）",
              "35mm（等效）",
              "50mm（等效）",
              "85mm（等效）",
            ]),
            spec("composition", "构图方式", "三分法", [
              "三分法",
              "中心构图",
              "对称",
              "框架构图",
              "引导线",
            ]),
          ]
        : actualTab === "画面"
          ? [
              spec("aspectRatio", "画面比例", "16:9", ["16:9", "9:16", "1:1", "2.39:1"]),
              spec("lighting", "光线方向", "侧逆光", [
                "侧逆光",
                "正面光",
                "侧光",
                "顶光",
                "环境光",
              ]),
              spec("palette", "色彩氛围", "冷蓝夜色 / 暖色街灯"),
              spec("focus", "对焦位置", "人物眼睛"),
            ]
          : actualTab === "表演"
            ? [
                spec("performance", "表演重点", shot.note),
                spec("eyeline", "视线方向", "画面右侧", [
                  "画面左侧",
                  "画面右侧",
                  "镜头方向",
                  "低头",
                  "远处",
                ]),
                spec("emotion", "情绪", "迟疑、克制"),
                { ...spec("dialogue", "对白", ""), multiline: true },
              ]
            : actualTab === "运镜"
              ? [
                  spec("movement", "镜头运动", "慢推 (Slow Push-in)", [
                    "固定",
                    "慢推 (Slow Push-in)",
                    "拉远",
                    "横移",
                    "跟随",
                    "摇镜",
                  ]),
                  spec("speed", "运动速度", "缓慢", ["缓慢", "匀速", "快速"]),
                  spec("startFraming", "起始景别", "中景"),
                  spec("endFraming", "结束景别", "近景"),
                ]
              : [
                  spec("scene", "关联场景", o.scene, [
                    "Scene 01 · 雨夜街道",
                    "Scene 02 · 记忆中的清晨",
                    "Scene 03 · 城市黄昏",
                  ]),
                  spec("sceneVersion", "场景参考版本", "v2", ["v1", "v2", "v3"]),
                  spec("characterVersion", "角色参考版本", "v4", ["v1", "v2", "v3", "v4"]),
                  spec("outfitVersion", "造型参考版本", "雨夜外套 v3", [
                    "日常职业装 v2",
                    "医院工作服 v1",
                    "雨夜外套 v3",
                    "居家服 v2",
                  ]),
                  spec("worldVersion", "世界观版本", "v2", ["v1", "v2"]),
                  spec("props", "关联道具", "记忆芯片"),
                ];
  } else if (family === "character") {
    fields =
      actualTab === "身份"
        ? [
            { ...spec("age", "年龄", person.id === 1 ? "26" : "28"), number: [1, 120] },
            spec("gender", "性别", person.id === 2 ? "男" : "女", ["女", "男", "未设定"]),
            spec("height", "身高", person.id === 2 ? "182 cm" : "168 cm"),
            spec("body", "体型", "偏瘦"),
            spec("personality", "性格", person.note),
            spec("tags", "标签", "都市 / 科幻 / 成长"),
          ]
        : actualTab === "外观"
          ? [
              spec("version", "角色版本", "v4", ["v1", "v2", "v3", "v4"]),
              spec("faceVersion", "面部参考", "face_v4"),
              spec("bodyVersion", "身体参考", "body_v2"),
              spec("appearance", "外观要点", person.id === 1 ? "深色长发，银色耳饰" : "待补充"),
              spec("outfit", "当前造型", "日常职业装 v2"),
            ]
          : actualTab === "声音"
            ? [
                spec("voiceVersion", "声音版本", `${person.name}_voice_v2`),
                spec("tone", "声线", "沉静、克制"),
                { ...spec("voiceSpeed", "语速", "1.0"), number: [0.5, 2] },
              ]
            : [
                spec("organization", "所属组织", "记忆修复中心"),
                spec("relatedScenes", "常用场景", "研究所、城市街道、住所"),
                spec("props", "关键道具", "记忆芯片、工作证"),
                spec("visualKeywords", "视觉关键词", "冷色调、都市、科技、克制"),
              ];
  } else if (family === "generation") {
    fields =
      actualTab === "生成"
        ? [
            spec("method", "生成方式", "图生视频", ["图生视频", "首尾帧", "多参考"]),
            spec("model", "模型设置", "Aivora-Video Pro · 演示", [
              "Aivora-Video Pro · 演示",
              "Aivora-Video Fast · 演示",
            ]),
            spec("quality", "生成质量", "高质量", ["标准", "高质量"]),
            spec("resolution", "分辨率", "1080p", ["720p", "1080p", "4K"]),
            spec("fps", "帧率", "24 fps", ["24 fps", "25 fps", "30 fps"]),
          ]
        : actualTab === "参数"
          ? [
              { ...spec("seed", "随机种子", "42"), number: [0, 2147483647] },
              { ...spec("prompt", "PromptPlan", shot.note), multiline: true },
              spec("negativePrompt", "负面提示", "脸部漂移、手部畸变"),
            ]
          : [
              spec(
                "character",
                "角色引用",
                `${o.character.name} ${o.shotField("characterVersion", "v4")}`,
              ),
              spec("scene", "场景引用", o.scene),
              spec("outfit", "服装引用", o.shotField("outfitVersion", "雨夜外套 v3")),
            ];
  } else if (family === "assembly") {
    fields =
      actualTab === "剪辑"
        ? [
            spec("track", "轨道", "视频 V1", [
              "视频 V1",
              "对白 A1",
              "音乐 A2",
              "音效 A3",
              "字幕 S1",
            ]),
            { ...spec("in", "入点（秒）", "0"), number: [0, shot.duration] },
            { ...spec("out", "出点（秒）", String(shot.duration)), number: [0, shot.duration] },
            { ...spec("speed", "速度", "1"), number: [0.1, 4] },
            { ...spec("scale", "缩放（%）", "100"), number: [10, 300] },
            { ...spec("opacity", "不透明度（%）", "100"), number: [0, 100] },
            spec("blend", "混合模式", "正常", ["正常", "叠加", "滤色", "正片叠底"]),
          ]
        : actualTab === "调色"
          ? [
              { ...spec("exposure", "曝光", "0"), number: [-5, 5] },
              { ...spec("saturation", "饱和度（%）", "100"), number: [0, 200] },
              spec("lut", "风格预设", "原始", ["原始", "冷蓝夜景", "温暖晨光"]),
            ]
          : actualTab === "声音"
            ? [
                { ...spec("volume", "音量（dB）", "0"), number: [-60, 12] },
                spec("fadeIn", "淡入（秒）", "0.2"),
                spec("fadeOut", "淡出（秒）", "0.2"),
              ]
            : [
                spec("subtitle", "字幕内容", d.value("subtitle", "我总觉得，这座城市藏着什么……")),
                spec("fontSize", "字号", "32"),
                spec("position", "字幕位置", "底部居中", ["底部居中", "中部居中", "顶部居中"]),
              ];
  } else if (family === "story") {
    fields =
      actualTab === "基础"
        ? [
            spec("genre", "类型设置", "都市 / 悬疑 / 科幻"),
            spec("era", "时代设置", "近未来 · 2045"),
            spec("duration", "剧集时长", "3–5 分钟"),
            spec("aspectRatio", "比例", "16:9", ["16:9", "9:16", "1:1"]),
            spec("visualReference", "视觉参考", "近未来都市 / 冷暖对比"),
          ]
        : actualTab === "结构"
          ? [
              spec("opening", "开场", "林晚回到雨夜的旧街"),
              spec("middle", "中段", "陆沉的出现带来记忆线索"),
              spec("climax", "高潮", "记忆中的清晨与现实交织"),
              spec("ending", "结尾", "未说出的名字留下悬念"),
            ]
          : [
              { ...spec("source", "原文依据", d.value("source")), multiline: true },
              spec("ambiguity", "待确认事项", "陆沉的身份与遗失七天的关系"),
            ];
  } else if (family === "world" || family === "scenes") {
    fields =
      actualTab === "设定"
        ? [
            spec("category", "分类", family === "world" ? "城市" : "外景", [
              "城市",
              "自然",
              "生活",
              "内景",
              "外景",
            ]),
            spec("era", "时间背景", "近未来"),
            spec("style", "视觉风格", "写实电影感"),
            spec("lighting", "光线与氛围", "冷暖对比"),
            spec("description", "设定说明", d.value("worldNote")),
          ]
        : [
            spec("version", "当前版本", "v2", ["v1", "v2", "v3"]),
            spec("status", "确认状态", "待确认", ["待确认", "已确认"]),
            spec("reference", "来源参考", "故事理解 · 世界观设定"),
          ];
  }
  const changeDuration = (value: string) => {
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration < 0.5 || duration > 30) return;
    const start = d.shots
      .slice(
        0,
        d.shots.findIndex((item) => item.id === shot.id),
      )
      .reduce((sum, item) => sum + item.duration, 0);
    d.setPlaying(false);
    d.setTime(start);
    d.setShots((old) => old.map((item) => (item.id === shot.id ? { ...item, duration } : item)));
  };
  const changeIdentity = (key: "name" | "role", value: string) => {
    if (person[key] === value) return;
    d.setCharacters((old) =>
      old.map((item) => (item.id === person.id ? { ...item, [key]: value } : item)),
    );
    d.put(`locked-${person.id}`, "false");
    d.put("assetsConfirmed", "false");
  };
  const reviewShot = shotAtTime(d.shots, d.time) ?? shot;
  const currentLabel =
    family === "review"
      ? `Shot ${String(reviewShot.id).padStart(3, "0")} · ${reviewShot.name}`
      : o.label;
  const currentDetail =
    family === "review"
      ? `${mediaTimecode(d.time)} · ${reviewShot.duration.toFixed(1)}s · ${reviewShot.note}`
      : o.detail;
  const plans = d.outfits.filter(
    (item) => item.characterId === person.id && item.episode === d.value("episode"),
  );
  const outfit = plans.find((item) => String(item.id) === field("outfitId")) ?? plans[0];
  const sceneRange =
    outfit?.characterId === 1 ? ["08–09", "01–04", "05–07", "10–13"][outfit.id - 100] : undefined;
  const hasViews = person.id === 1 && d.scenario !== "empty";
  const activeAnnotation = d.annotations.find((item) =>
    item.end > item.start ? d.time >= item.start && d.time < item.end : d.time === item.start,
  );
  const sourceApproved =
    d.value("sourceApproved") === "true" &&
    d.value("storySourceVersion") === d.value("sourceVersion", "1");
  let properties: Property[] = [];
  if (family === "story") {
    properties = [
      {
        label: "来源",
        value: d.value("importedName", "第 1 章 · 第 3 段"),
        note: "演示来源位置备注，不建立片段绑定",
      },
      { label: "来源类型", value: d.value("importedName") ? "SOURCE / 本地导入" : "SOURCE / 示例" },
      { label: "批准状态", value: sourceApproved ? "已确认当前来源" : "待确认" },
      { label: "证据片段", value: d.value("source").trim() ? "示例原文 · 待核对" : "尚未提供原文" },
      {
        label: "影响范围",
        value: "故事 / 角色 / 世界",
        note: "设计中的影响范围，未执行生成或修改",
      },
    ];
  } else if (family === "character") {
    properties = [
      { label: "当前角色", value: `${person.name} · 演示身份` },
      { label: "三视图", value: hasViews ? "正面 / 侧面 / 背面" : "侧面 / 背面待补齐" },
      {
        label: "当前服装",
        value: outfit?.name ?? "尚未选择本集服装",
        change: outfit ? (value) => putField("outfit", value) : undefined,
      },
      {
        label: "适用场次",
        value: sceneRange ?? "场次待指定",
        note: "源图的场次标签，不代表场次到镜头的绑定",
      },
      {
        label: "角色状态",
        value: field("stateNote", outfit?.id === 100 ? "雨夜 · 潮湿" : "日常 · 样例"),
        change: (value) => putField("stateNote", value),
      },
      {
        label: "参考覆盖",
        value:
          d.scenario === "loading"
            ? "正在读取参考"
            : d.scenario === "error"
              ? "参考加载失败"
              : hasViews
                ? "3 / 3 样例"
                : "三视图未齐备",
      },
    ];
  } else if (family === "review") {
    properties = [
      { label: "当前批注", value: activeAnnotation ? activeAnnotation.text : "未选择批注" },
      { label: "整集时间", value: mediaTimecode(d.time) },
      { label: "目标镜头", value: `SHOT ${String(reviewShot.id).padStart(3, "0")}` },
      {
        label: "修改范围",
        value: activeAnnotation?.category ?? "表演 / 剪辑建议",
        note: "批注建议类别，未执行修改",
      },
      { label: "锁定内容", value: "暂无锁定记录", note: "未把参考角色、服装或场景声明为已锁定" },
      {
        label: "执行状态",
        value: d.value("reviewDone") === "true" ? "审片已完成 · 尚未执行修改" : "尚未生成修改方案",
      },
    ];
  }
  const detailsKey = `inspector-details-${d.page}`;
  const detailsOpen = d.value(detailsKey) === "true";
  const scrollKey = `inspector-scroll-${o.scope}`;
  const detailContent = (
    <>
      <h3 className="v2-inspector-object">{currentLabel}</h3>
      <Tabs
        items={tabs}
        value={actualTab}
        onChange={(value) => d.put(`inspector-tab-${family}`, value)}
      />
      <div className="inspector-fields">
        {(family === "shot" || family === "generation") && (
          <label>
            时长（秒）
            <input
              aria-label="属性镜头时长"
              type="number"
              min="0.5"
              max="30"
              step="0.5"
              value={shot.duration}
              onChange={(event) => changeDuration(event.target.value)}
            />
          </label>
        )}
        {family === "character" && actualTab === "身份" && (
          <>
            <label>
              姓名
              <input
                value={person.name}
                onChange={(event) => changeIdentity("name", event.target.value)}
              />
            </label>
            <label>
              身份与职业
              <input
                value={person.role}
                onChange={(event) => changeIdentity("role", event.target.value)}
              />
            </label>
          </>
        )}
        {family === "shot" && actualTab === "参考" && (
          <label>
            关联角色
            <select
              value={o.character.id}
              onChange={(event) => putField("characterId", event.target.value)}
            >
              {d.characters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {fields.map((item) => (
          <label key={item.key}>
            {item.label}
            {item.options ? (
              <select
                value={field(item.key, item.fallback)}
                onChange={(event) => putField(item.key, event.target.value)}
              >
                {item.options.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            ) : item.multiline ? (
              <textarea
                value={field(item.key, item.fallback)}
                onChange={(event) => putField(item.key, event.target.value)}
              />
            ) : (
              <input
                type={item.number ? "number" : "text"}
                min={item.number?.[0]}
                max={item.number?.[1]}
                step="any"
                value={field(item.key, item.fallback)}
                onChange={(event) => {
                  const value = event.target.value;
                  if (
                    item.number &&
                    (value === "" ||
                      Number(value) < item.number[0] ||
                      Number(value) > item.number[1])
                  )
                    return;
                  putField(item.key, value);
                }}
              />
            )}
          </label>
        ))}
        {family === "shot" && <ActionBeats />}
        {family === "review" && (
          <>
            <dl>
              <dt>当前时码</dt>
              <dd>{d.time.toFixed(2)}s</dd>
              <dt>参考版本</dt>
              <dd>v0.3 · 演示</dd>
              <dt>当前镜头</dt>
              <dd>{currentLabel}</dd>
              <dt>镜头参数</dt>
              <dd>{currentDetail}</dd>
            </dl>
            {d.annotations
              .filter((item) => d.time >= item.start && d.time <= item.end)
              .map((item) => (
                <article className="inspector-note" key={item.id}>
                  <small>
                    {item.category} · {item.start}–{item.end}s
                  </small>
                  <p>{item.text}</p>
                </article>
              ))}
            <Button onClick={() => d.go("changes")}>进入修改方案 →</Button>
          </>
        )}
        {!fields.length && family !== "review" && (
          <p>此页提供项目级操作。请选择故事、角色或镜头，查看对应的创作属性。</p>
        )}
      </div>
      <div className="v2-inspector-reference">
        <small>本次演示内保存 · 切换模式保留</small>
        <Button
          icon="link"
          onClick={() => {
            d.setReferences((old) => [...new Set([...old, `${currentLabel} · ${currentDetail}`])]);
            d.focusAssistant(`关于「${currentLabel}」：`);
          }}
        >
          引用到 AI
        </Button>
      </div>
    </>
  );
  return (
    <aside className="inspector v2-inspector" aria-label="专业属性">
      <header>
        <Logo />
        <div>
          <h2>Inspector</h2>
          <p>当前对象 · 演示属性</p>
        </div>
      </header>
      <div className="v2-inspector-context-row">
        <span className="v2-inspector-context">{pages[d.page][0]}</span>
      </div>
      <div
        className="v2-inspector-scroll"
        data-scroll-region="inspector-properties"
        aria-label="对象属性内容"
        onScroll={(event) => d.put(scrollKey, String(event.currentTarget.scrollTop))}
        ref={(element) => {
          if (element && Math.abs(element.scrollTop - Number(d.value(scrollKey, "0"))) > 1)
            element.scrollTop = Number(d.value(scrollKey, "0"));
        }}
      >
        <h3 className="v2-inspector-section">对象属性</h3>
        {properties.length ? (
          <>
            <div className="v2-inspector-properties">
              {properties.map((property) => (
                <label key={property.label}>
                  <span>{property.label}</span>
                  <input
                    value={property.value}
                    title={property.note ?? property.value}
                    readOnly={!property.change}
                    onChange={(event) => property.change?.(event.target.value)}
                  />
                </label>
              ))}
            </div>
            <details
              className="v2-inspector-details"
              open={detailsOpen}
              onToggle={(event) => {
                const next = event.currentTarget.open;
                if (next !== detailsOpen) d.put(detailsKey, String(next));
              }}
            >
              <summary
                role="button"
                aria-expanded={detailsOpen}
                onClick={(event) => {
                  event.preventDefault();
                  d.put(detailsKey, String(!detailsOpen));
                }}
              >
                技术详情 <span aria-hidden="true">﹀</span>
              </summary>
              <div className="v2-inspector-detail-content" hidden={!detailsOpen}>
                {detailContent}
              </div>
            </details>
          </>
        ) : (
          <div className="v2-inspector-detail-content">{detailContent}</div>
        )}
      </div>
      <footer>
        <p>只显示演示属性；切换页签不应用、不丢弃本地草稿。</p>
      </footer>
    </aside>
  );
}

function ActionBeats() {
  const o = useCurrentObject();
  const { d, shot } = o;
  const fallback = [
    { start: 0, end: 0.25, action: "建立视线与人物位置" },
    { start: 0.25, end: 0.625, action: "动作推进，保持情绪克制" },
    { start: 0.625, end: 1, action: "动作收束，保留短暂停顿" },
  ];
  const beats = JSON.parse(o.field("beats", JSON.stringify(fallback))) as typeof fallback;
  return (
    <section className="action-beats">
      <h3>镜头脚本 / 动作分解</h3>
      <small>演示动作 · 时间随镜头时长同步</small>
      {beats.map((beat, index) => (
        <button
          key={index}
          onClick={() =>
            d.edit(
              "编辑动作段",
              [
                {
                  key: "start",
                  label: "开始（秒）",
                  value: String(Number((beat.start * shot.duration).toFixed(2))),
                  type: "number",
                  min: 0,
                  max: shot.duration,
                  required: true,
                },
                {
                  key: "end",
                  label: "结束（秒）",
                  value: String(Number((beat.end * shot.duration).toFixed(2))),
                  type: "number",
                  min: 0,
                  max: shot.duration,
                  required: true,
                },
                {
                  key: "action",
                  label: "动作",
                  value: beat.action,
                  type: "textarea",
                  required: true,
                },
              ],
              (data) => {
                const start = Number(data.start) / shot.duration;
                const end = Number(data.end) / shot.duration;
                if (
                  start >= end ||
                  start < (beats[index - 1]?.end ?? 0) ||
                  end > (beats[index + 1]?.start ?? 1)
                ) {
                  d.notify("未保存：动作段不得倒序、重叠或超出镜头时长");
                  return false;
                }
                o.putField(
                  "beats",
                  JSON.stringify(
                    beats.map((item, i) =>
                      i === index ? { start, end, action: data.action! } : item,
                    ),
                  ),
                );
              },
            )
          }
        >
          <strong>
            {(beat.start * shot.duration).toFixed(1)}–{(beat.end * shot.duration).toFixed(1)}s
          </strong>
          <span>{beat.action}</span>
        </button>
      ))}
    </section>
  );
}
