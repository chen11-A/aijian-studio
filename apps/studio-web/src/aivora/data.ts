import hero from "./assets/v2/story-art.png";
import portrait from "./assets/v2/avatar.png";
import portraitFull from "./assets/v2/portrait.png";
import rival from "./assets/v2/rival.png";
import character from "./assets/character.jpg";
import multiview from "./assets/multiview.jpg";
import city from "./assets/v2/city-wide.png";
import street from "./assets/v2/street.png";
import morning from "./assets/morning.jpg";
import sea from "./assets/sea.jpg";
import town from "./assets/town.jpg";
import male from "./assets/v2/male.png";
import streetWide from "./assets/street-wide.jpg";
import streetForward from "./assets/street-forward.jpg";
import streetReverse from "./assets/street-reverse.jpg";
import streetHigh from "./assets/street-high.jpg";

export const art = {
  hero,
  portrait,
  portraitFull,
  rival,
  character,
  multiview,
  city,
  street,
  morning,
  sea,
  town,
  male,
  streetWide,
  streetForward,
  streetReverse,
  streetHigh,
};
export const pages = {
  launch: ["开始一个好故事", "从一个想法，到一部作品。", -1, "首次启动 / 继续上次"],
  home: [
    "你的故事，从这里开始",
    "写下一点灵感，让故事慢慢生长。",
    -1,
    "空输入 / 已输入 / 导入中 / 文件不支持",
  ],
  project: ["创作首页", "在记忆与现实之间，寻找属于自己的光。", 0, "无项目 / 有项目 / 待继续"],
  projects: ["项目中心", "每一个故事，都值得被看见。", -1, "空列表 / 搜索无结果 / 归档项目"],
  source: [
    "故事输入与来源",
    "保留原始文字，让每一个设定都有迹可循。",
    0,
    "无来源 / 待审核 / 已审核 / 来源变化",
  ],
  story: ["故事理解", "先理解故事，再让想象成为画面。", 0, "分析中 / 歧义待确认 / 可继续 / 需复核"],
  script: ["剧本", "把事件、动作和对白，组织成可以拍摄的场次。", 0, "无场次 / 未保存 / 已确认"],
  characters: [
    "角色与世界",
    "他们是谁，又为什么在这座城市相遇。",
    1,
    "无角色 / 关系未确认 / 信息齐备",
  ],
  character: [
    "角色模型与本集造型",
    "锁定身份，让角色在每一个镜头里保持一致。",
    1,
    "缺参考 / 待选候选 / 身份锁定 / 造型待确认",
  ],
  world: [
    "世界观",
    "建立故事的视觉规则，让世界可信而完整。",
    1,
    "缺设定 / 缺画面 / 有候选 / 已确认",
  ],
  scenes: [
    "场景",
    "同一个地点，不同的视角、时间与天气。",
    1,
    "无地点 / 缺视角 / 状态待确认 / 可使用",
  ],
  storyboard: ["分镜", "用镜头讲故事，用预演找到节奏。", 2, "无镜头 / 未确认 / 上游变化 / 已确认"],
  generation: [
    "制作",
    "逐镜头选择表现，再组装成完整的作品。",
    3,
    "排队 / 运行 / 失败 / 暂停 / 有候选 / 费用未知",
  ],
  assembly: [
    "成片组装",
    "把画面、对白与声音，编织成一个故事。",
    3,
    "缺镜头 / 缺音频 / 待保存 / 有组装版本",
  ],
  review: [
    "审片",
    "看完整个故事，把修改留在准确的位置。",
    4,
    "无媒体 / 未审核 / 有批注 / 审核完成",
  ],
  changes: [
    "修改方案",
    "看清影响范围，再决定如何修改。",
    4,
    "无方案 / 范围待确认 / 费用未知 / 失败 / 完成",
  ],
  assets: [
    "素材库",
    "让角色、场景和声音，成为可以复用的创作资产。",
    1,
    "空库 / 无结果 / 不可用 / 已引用",
  ],
  voice: ["声音制作", "赋予每一句对白合适的声音与呼吸。", 3, "无对白 / 缺声线 / 待生成 / 可试听"],
  export: [
    "成片预览与导出",
    "检查交付设置，为你的故事准备最后一步。",
    4,
    "无成片 / 检查未通过 / 导出中 / 失败 / 已有输出",
  ],
  services: [
    "AI 服务与模型",
    "按能力组织服务，让每项创作有合适的工具。",
    -1,
    "未配置 / 连接中 / 不可用 / 可用",
  ],
  costs: ["用量与费用", "了解每一次创作的投入。", -1, "无用量 / 有明细 / 预算临界 / 费用未知"],
  settings: [
    "用户中心与设置",
    "按照你的习惯，安排创作空间。",
    -1,
    "未修改 / 待保存 / 校验失败 / 保存完成",
  ],
  projectSettings: [
    "项目设置",
    "作品、剧集与画幅，共同组成创作的起点。",
    0,
    "未修改 / 未保存 / 校验失败",
  ],
} as const;
export type PageId = keyof typeof pages;
export type Scenario = "normal" | "empty" | "loading" | "error" | "unavailable";
export const stages: { label: string; page: PageId }[] = [
  { label: "故事", page: "story" },
  { label: "角色与世界", page: "characters" },
  { label: "分镜", page: "storyboard" },
  { label: "制作", page: "generation" },
  { label: "审片", page: "review" },
];
export const flow: PageId[] = [
  "source",
  "story",
  "characters",
  "character",
  "world",
  "scenes",
  "storyboard",
  "generation",
  "assembly",
  "review",
  "changes",
  "export",
];
export const projectNav: {
  label: string;
  page: PageId;
  icon: string;
  group?: string;
  child?: boolean;
}[] = [
  { label: "创作首页", page: "project", icon: "home" },
  { label: "故事 / 剧本", page: "story", icon: "book" },
  { label: "角色", page: "characters", icon: "users", group: "角色与世界", child: true },
  { label: "世界观", page: "world", icon: "globe", child: true },
  { label: "场景", page: "scenes", icon: "image", child: true },
  { label: "分镜", page: "storyboard", icon: "film" },
  { label: "制作", page: "generation", icon: "film" },
  { label: "审片", page: "review", icon: "review" },
  { label: "素材", page: "assets", icon: "folder", group: "资源与交付" },
  { label: "导出", page: "export", icon: "export" },
];
export const initialProjects = [
  {
    id: 1,
    name: "星夜之城",
    episode: "第 1 集 · 重逢",
    image: hero,
    status: "进行中",
    favorite: true,
    updated: "2026-09-06 14:30",
  },
  {
    id: 2,
    name: "晨光",
    episode: "第 1 集 · 新生",
    image: morning,
    status: "草稿",
    favorite: false,
    updated: "2026-09-03 10:12",
  },
  {
    id: 3,
    name: "她与海",
    episode: "全 3 集",
    image: sea,
    status: "已完成",
    favorite: false,
    updated: "2026-08-28 18:20",
  },
  {
    id: 4,
    name: "城市回声",
    episode: "第 1 集 · 回声",
    image: town,
    status: "草稿",
    favorite: false,
    updated: "2026-08-18 11:05",
  },
];
export const initialCharacters = [
  {
    id: 1,
    name: "苏晚",
    role: "女主 · 记忆修复师",
    image: portrait,
    note: "理性、敏锐，正在寻找一段遗失的记忆。",
  },
  {
    id: 2,
    name: "程野",
    role: "神经工程师 · 隐藏过去",
    image: male,
    note: "旧友还是陌生人？他似乎知道那场事故的真相。",
  },
  {
    id: 3,
    name: "沈岚",
    role: "记忆集团顾问 · 关键对手",
    image: rival,
    note: "记忆集团顾问，掌握着改变城市的秘密。",
  },
];
export const initialShots = [
  {
    id: 1,
    name: "城市入夜",
    image: city,
    duration: 30,
    note: "全景 · 缓缓推进，建立城市与人物的距离。",
  },
  { id: 2, name: "走进雨幕", image: street, duration: 30, note: "中景 · 跟随苏晚穿过街道。" },
  { id: 3, name: "似曾相识", image: hero, duration: 30, note: "近景 · 回头，欲言又止。" },
  { id: 4, name: "街角的来客", image: town, duration: 30, note: "远景 · 程野站在暖色灯光下。" },
  { id: 5, name: "记忆碎片", image: portrait, duration: 30, note: "特写 · 意识中闪过熟悉的面孔。" },
  { id: 6, name: "那年晨光", image: morning, duration: 30, note: "闪回 · 在晨光中短暂相认。" },
  { id: 7, name: "未说出的名字", image: hero, duration: 30, note: "近景 · 对视，保留一秒沉默。" },
  { id: 8, name: "新的开始", image: city, duration: 30, note: "全景 · 灯光亮起，城市继续向前。" },
];
export const sourceText =
  "第一章 · 记忆黑市\n\n雨落在滨海城的霓虹灯上。苏晚发现，一段陌生的记忆正在自己的脑海里反复出现。";
export function seconds(value: number) {
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(value % 60)
    .toString()
    .padStart(2, "0")}`;
}
