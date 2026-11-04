import { useState } from "react";
import { CoverEditor } from "./CoverEditor";
import { StoryFrame } from "./stories/StoryFrame";

/** Example page. The 「AI 生成」 switch starts on, as it does by default. */
const STATES = [
  { id: "on", label: "标识打开" },
  { id: "off", label: "标识关掉" },
  { id: "untitled", label: "还没写片名" },
];

export function CoverEditorStory({ state = "on" }: { state?: string }) {
  const [title, setTitle] = useState(state === "untitled" ? "" : "雨夜旧书店");
  const [subtitle, setSubtitle] = useState("第 1 集");
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
