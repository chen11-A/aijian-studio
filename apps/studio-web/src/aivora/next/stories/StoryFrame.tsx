import type { ReactNode } from "react";
import "../../pro/pro.css";
import "../next.css";
import "./stories.css";

export const STORY_PAGES = [
  { id: "task-center", name: "任务中心" },
  { id: "export-check", name: "导出前检查" },
  { id: "sound-panel", name: "声音" },
  { id: "take-picker", name: "一选多" },
  { id: "subtitle-style", name: "字幕样式" },
  { id: "cover-editor", name: "封面" },
  { id: "pipeline-steps", name: "一键成片步骤" },
] as const;

export type StoryId = (typeof STORY_PAGES)[number]["id"];

export type StoryState = { id: string; label: string };

/**
 * The page around a story: it renders inside .pro-root, so the components get the
 * workspace's colors, and it says plainly that everything shown is example data.
 */
export function StoryFrame({
  story,
  states,
  state,
  log,
  children,
}: {
  story: StoryId;
  states: readonly StoryState[];
  state: string;
  /** What the last click asked for. The example does not do anything real. */
  log?: string;
  children: ReactNode;
}) {
  // The notice comes first so a narrow window cuts off the end of the log, not the notice.
  const note = log ? `示例里不会真的去做。刚才点了：${log}` : "演示用的作品和数字，没有连到软件。";
  return (
    <div className="pro-root nx-story" data-story={story}>
      <header className="nx-story-bar">
        <strong className="nx-story-sample">示例数据</strong>
        <span className="nx-story-note" aria-live="polite" title={note}>
          {note}
        </span>
        <nav className="nx-story-nav" aria-label="示例状态">
          {states.map((item) => (
            <a
              key={item.id}
              href={`?story=${story}&state=${item.id}`}
              aria-current={item.id === state ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <nav className="nx-story-nav" aria-label="其他示例">
          {STORY_PAGES.map((item) => (
            <a
              key={item.id}
              href={`?story=${item.id}`}
              aria-current={item.id === story ? "page" : undefined}
            >
              {item.name}
            </a>
          ))}
        </nav>
      </header>
      <main className="nx-story-body">{children}</main>
    </div>
  );
}
