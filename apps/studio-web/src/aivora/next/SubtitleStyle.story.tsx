import { useState } from "react";
import { subtitleStyleData } from "./adapters";
import { sampleProjectJson } from "./adapters/sampleProject";
import { SubtitleStyle } from "./SubtitleStyle";
import { StoryFrame } from "./stories/StoryFrame";

/** Example page with a line from 《雨夜旧书店》. */
const STATES = [
  { id: "clear", label: "清楚白字" },
  { id: "bold", label: "醒目黄字" },
  { id: "project", label: "按 project.json" },
];

/** The example project.json has dialogue but no saved style, so nothing is chosen yet. */
const FROM_PROJECT = subtitleStyleData(sampleProjectJson());

export function SubtitleStyleStory({ state = "clear" }: { state?: string }) {
  const fromProject = state === "project" && FROM_PROJECT.ok ? FROM_PROJECT.props : null;
  const [value, setValue] = useState(
    fromProject ? fromProject.value : state === "bold" ? "bold" : "clear",
  );
  const [log, setLog] = useState<string>();
  return (
    <StoryFrame story="subtitle-style" states={STATES} state={state} log={log}>
      <SubtitleStyle
        value={value}
        sampleLine={fromProject?.sampleLine ?? "你来晚了。这家店，下个月就没了。"}
        sampleSource={fromProject?.sampleSource ?? "第 1 场第 16 个镜头"}
        onChange={setValue}
        onApply={(id) => setLog(`用这个样式 ${id}`)}
      />
    </StoryFrame>
  );
}
