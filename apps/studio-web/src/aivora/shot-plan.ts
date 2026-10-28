/** Local shot list. Tests and the button use this. It does not call a model. */

export const MAX_CLIP_SECONDS = 15;
export const STYLE_REALISM =
  "写实电影感：自然光、真实镜头、人物有重量，动作遵守重力，不要卡通，不要血腥。";

const fight = [
  [
    "雨夜巷口",
    "林夏把阿凯推进巷口。",
    "全景",
    "低机位",
    "快",
    "硬切",
    "林夏从画面左侧推一把，阿凯退到墙边，两人都站着",
    "林夏咬着牙，阿凯睁大眼，短促的一句",
    5,
  ],
  [
    "躲开",
    "阿凯侧身躲开第一拳。",
    "中景",
    "侧面",
    "快",
    "硬切",
    "直拳落空，阿凯向右闪，拳风不碰到脸",
    "阿凯专注，林夏的眼神追着他",
    5,
  ],
  [
    "上步",
    "林夏踏水上步，直拳打向肩侧。",
    "中景",
    "平视",
    "快",
    "硬切",
    "上步，拳打向肩膀，不打头部",
    "林夏呼吸急，阿凯盯着来拳",
    5,
  ],
  [
    "格开",
    "阿凯格开手臂，退了半步。",
    "近景",
    "过肩",
    "中",
    "硬切",
    "小臂格挡，向后半步，脚踩在水里",
    "阿凯咬唇，林夏皱眉",
    5,
  ],
  [
    "对撞",
    "两人同时向前，肩撞在一起。",
    "中景",
    "平视",
    "快",
    "硬切",
    "肩对肩撞上，然后分开，没有倒地",
    "两人都吃痛，仍看着对方",
    6,
  ],
  [
    "低身",
    "林夏低身扫过，阿凯跳开。",
    "全景",
    "低机位",
    "快",
    "硬切",
    "低扫腿，阿凯跳起避开，落在两脚上",
    "林夏不抬头，阿凯落地时睁眼",
    6,
  ],
  [
    "对视",
    "雨更大了，他们停在对视里。",
    "近景",
    "平视",
    "慢",
    "叠化",
    "两人都放下重心，不再出招",
    "雨水顺着脸，眼神不再凶",
    5,
  ],
  [
    "离开",
    "阿凯放下手，说先离开这里。",
    "中景",
    "侧面",
    "慢",
    "叠化",
    "阿凯把手放下，林夏后退一步",
    "阿凯语气放轻，林夏点一下头",
    5,
  ],
] as const;

export type PlannedShot = {
  index: number;
  narration: string;
  subtitle: string;
  prompt: string;
  durationSeconds: number;
  shotSize: string;
  camera: string;
  rhythm: string;
  transition: string;
  action: string;
  performance: string;
};

export function fightSample(): string {
  return `雨夜巷战\n${fight.map((line) => line[1]).join("\n")}`;
}

export function planShots(story: string): PlannedShot[] {
  const text = story.trim();
  if (!text) throw new Error("需要一段故事才能拆镜");
  if (text.includes("雨夜巷战")) {
    return fight.map((row, index) => shotFrom(index + 1, row));
  }
  return offlineRotation(text);
}

/** Offline director. One shot per sentence. It never repeats a line or invents an action. */
export function offlineRotation(story: string): PlannedShot[] {
  const text = story.trim();
  if (!text) throw new Error("需要一段故事才能拆镜");
  return splitPieces(text)
    .slice(0, 10)
    .map((piece, index) =>
      shotFrom(index + 1, [`镜头${index + 1}`, piece, "全景", "平视", "中", "切", "", "", 5]),
    );
}

function splitPieces(text: string): string[] {
  const cleaned = text
    .replaceAll("！", "。")
    .replaceAll("？", "。")
    .replaceAll("；", "。")
    .replaceAll("\n", "。");
  const parts = cleaned
    .split("。")
    .map((part) => part.split(/\s+/).join(" ").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text.split(/\s+/).join(" ").trim()];
}

function shotFrom(index: number, row: readonly (string | number)[]): PlannedShot {
  const [title, line, size, camera, rhythm, transition, action, performance, duration] = row;
  const narration = String(line).trim();
  const seconds = Math.max(1, Math.min(Number(duration), MAX_CLIP_SECONDS));
  const subtitle = narration.length <= 28 ? narration : narration.slice(0, 28);
  const actionText = String(action).trim();
  const performanceText = String(performance).trim();
  const extras = [
    actionText ? `动作：${actionText}` : "",
    performanceText ? `表演：${performanceText}` : "",
  ].filter(Boolean);
  const prompt = [
    `${title}。${narration}景别${size}，机位${camera}，节奏${rhythm}，转场${transition}`,
    ...extras,
    STYLE_REALISM,
  ].join("。");
  return {
    index,
    narration,
    subtitle,
    prompt,
    durationSeconds: seconds,
    shotSize: String(size),
    camera: String(camera),
    rhythm: String(rhythm),
    transition: String(transition),
    action: String(action),
    performance: String(performance),
  };
}
