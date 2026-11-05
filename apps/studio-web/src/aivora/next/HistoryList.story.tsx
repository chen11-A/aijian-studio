import { useState } from "react";
import { HistoryList, type HistoryEntry } from "./HistoryList";
import { StoryFrame } from "./stories/StoryFrame";

/** Example page: kept versions of 「晚照书店」. Nothing is restored. */
const STATES = [
  { id: "list", label: "有历史" },
  { id: "restoring", label: "正在恢复" },
  { id: "empty", label: "还没有" },
  { id: "none", label: "这个版本没有" },
];

const ENTRIES: HistoryEntry[] = [
  {
    id: "c",
    when: "今天 14:32",
    why: "批量生成前自动存的",
    summary: "3 场 · 28 个镜头 · 12 个做好了",
  },
  {
    id: "b",
    when: "今天 11:08",
    why: "批量生成前自动存的",
    summary: "3 场 · 28 个镜头 · 4 个做好了",
  },
  { id: "a", when: "昨天 21:40", why: "批量生成前自动存的", summary: "3 场 · 26 个镜头" },
];

export function HistoryListStory({ state = "list" }: { state?: string }) {
  const [log, setLog] = useState<string>();
  return (
    <StoryFrame story="history-list" states={STATES} state={state} log={log}>
      <div className="nx-story-narrow">
        <HistoryList
          entries={state === "none" ? null : state === "empty" ? [] : ENTRIES}
          restoring={state === "restoring" ? "b" : undefined}
          onRestore={(id) => setLog(`恢复到 ${ENTRIES.find((item) => item.id === id)?.when}`)}
        />
      </div>
    </StoryFrame>
  );
}
