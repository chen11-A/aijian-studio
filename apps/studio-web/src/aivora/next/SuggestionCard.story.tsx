import { useState } from "react";
import type { SuggestionItem } from "./adapters/suggestionDiff";
import { SuggestionCard, type SuggestionCardProps } from "./SuggestionCard";
import { StoryFrame } from "./stories/StoryFrame";

/** Example page: the director's suggestion for 第 1 场「雨夜旧书店」 of the test novel. */
const STATES = [
  { id: "change", label: "6 个改成 4 个" },
  { id: "new", label: "还没有镜头" },
  { id: "scenes", label: "编剧分场" },
  { id: "busy", label: "正在换一个" },
  { id: "applied", label: "已放进去" },
];

const shot = (id: string, who: string, text: string, seconds: number): SuggestionItem => ({
  id,
  who,
  text,
  tail: `${seconds}s`,
});

const NOW = [
  shot("a1", "林晚", "雨夜，旧书店门口，林晚收伞推门进来", 3),
  shot("a2", "林晚", "风铃晃动的特写", 2),
  shot("a3", "沈砚", "沈砚在柜台后抬头", 2),
  shot("a4", "林晚", "林晚把湿透的信放在柜台上", 3),
  shot("a5", "沈砚", "沈砚看信封上的字迹，愣住", 3),
  shot("a6", "", "窗外一辆车停下，车灯扫过书架", 2),
];

const NEXT = [
  shot("b1", "林晚", "雨夜，旧书店门口，林晚收伞推门进来", 3),
  shot("b2", "沈砚", "沈砚在柜台后抬头，看见她肩上的雨", 3),
  shot("b3", "林晚", "林晚把湿透的信放在柜台上", 3),
  shot("b4", "", "门外传来刺耳的刹车声，两人同时看向窗外", 3),
];

const SCENES_NOW = [
  { id: "s1", text: "旧书店 · 雨夜重逢" },
  { id: "s2", text: "医院走廊 · 等消息" },
  { id: "s3", text: "天台 · 摊牌" },
];

const SCENES_NEXT = [
  { id: "t1", text: "旧书店 · 雨夜重逢" },
  { id: "t2", text: "车里 · 去医院的路上" },
  { id: "t3", text: "医院走廊 · 等消息" },
  { id: "t4", text: "天台 · 摊牌" },
];

function propsFor(state: string): Pick<SuggestionCardProps, "unit" | "current" | "proposed"> & {
  applied?: boolean;
  busy?: boolean;
} {
  switch (state) {
    case "new":
      return { unit: "shot", current: [], proposed: NEXT };
    case "scenes":
      return { unit: "scene", current: SCENES_NOW, proposed: SCENES_NEXT };
    case "busy":
      return { unit: "shot", current: NOW, proposed: NEXT, busy: true };
    case "applied":
      return { unit: "shot", current: NOW, proposed: NEXT, applied: true };
    default:
      return { unit: "shot", current: NOW, proposed: NEXT };
  }
}

export function SuggestionCardStory({ state = "change" }: { state?: string }) {
  const [log, setLog] = useState<string>();
  return (
    <StoryFrame story="suggestion-card" states={STATES} state={state} log={log}>
      <div className="nx-story-narrow">
        <SuggestionCard
          {...propsFor(state)}
          onApply={() => setLog("放进去")}
          onAnother={() => setLog("换一个")}
          onReject={() => setLog("不要")}
          onUndo={() => setLog("撤销")}
        />
      </div>
    </StoryFrame>
  );
}
