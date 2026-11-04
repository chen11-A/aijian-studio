import { useState } from "react";
import { SubtitleStyle } from "./SubtitleStyle";
import { StoryFrame } from "./stories/StoryFrame";

/** Example page with a line from 《雨夜旧书店》. */
const STATES = [
  { id: "clear", label: "清楚白字" },
  { id: "bold", label: "醒目黄字" },
];

export function SubtitleStyleStory({ state = "clear" }: { state?: string }) {
  const [value, setValue] = useState(state === "bold" ? "bold" : "clear");
  const [log, setLog] = useState<string>();
  return (
    <StoryFrame story="subtitle-style" states={STATES} state={state} log={log}>
      <SubtitleStyle
        value={value}
        sampleLine="你来晚了。这家店，下个月就没了。"
        sampleSource="第 1 场第 16 个镜头"
        onChange={setValue}
        onApply={(id) => setLog(`用这个样式 ${id}`)}
      />
    </StoryFrame>
  );
}
