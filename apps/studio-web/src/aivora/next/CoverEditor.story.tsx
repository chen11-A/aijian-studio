import { useState } from "react";
import { coverEditorData } from "./adapters";
import { sampleProjectJson } from "./adapters/sampleProject";
import { CoverEditor } from "./CoverEditor";
import { StoryFrame } from "./stories/StoryFrame";

/** Example page. The 「AI 生成」 switch starts on, as it does by default. */
const STATES = [
  { id: "on", label: "标识打开" },
  { id: "off", label: "标识关掉" },
  { id: "untitled", label: "还没写片名" },
  { id: "project", label: "按 project.json" },
];

/** The example project.json through coverEditorData. Stills are not loaded. */
const FROM_PROJECT = coverEditorData(sampleProjectJson(), { mediaUrl: () => "" });

export function CoverEditorStory({ state = "on" }: { state?: string }) {
  const fromProject = state === "project" && FROM_PROJECT.ok ? FROM_PROJECT.props : null;
  const [title, setTitle] = useState(
    fromProject ? fromProject.title : state === "untitled" ? "" : "雨夜旧书店",
  );
  const [subtitle, setSubtitle] = useState(fromProject ? (fromProject.subtitle ?? "") : "第 1 集");
  const [log, setLog] = useState<string>();
  return (
    <StoryFrame story="cover-editor" states={STATES} state={state} log={log}>
      <CoverEditor
        title={title}
        subtitle={subtitle}
        defaultAiMark={state !== "off"}
        onTitleChange={setTitle}
        onSubtitleChange={setSubtitle}
        onAiMarkChange={(on) => setLog(on ? "打开「AI 生成」标识" : "关掉「AI 生成」标识")}
        onSave={() => setLog("用这个封面")}
      />
    </StoryFrame>
  );
}
