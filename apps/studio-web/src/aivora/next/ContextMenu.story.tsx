import { useState } from "react";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { StoryFrame } from "./stories/StoryFrame";

/** Example page: the right-click menu of a shot card of 「晚照书店」. Nothing is changed. */
const STATES = [
  { id: "open", label: "打开" },
  { id: "first", label: "第一个镜头" },
  { id: "closed", label: "没打开" },
];

/** Next to the card; one object, so the menu does not move again on every click. */
const BESIDE_CARD = { x: 180, y: 150 };

export function ContextMenuStory({ state = "open" }: { state?: string }) {
  const [log, setLog] = useState<string>();
  const menu = useContextMenu();
  const [dismissed, setDismissed] = useState(state === "closed");
  // The example opens next to the card, so the page shows the menu without a right-click.
  const shown = menu.at ?? (dismissed ? null : BESIDE_CARD);
  const items: ContextMenuItem[] = [
    {
      label: "前移",
      onSelect: () => setLog("前移镜头 3"),
      disabledReason: state === "first" ? "已经是第一个镜头了" : undefined,
    },
    { label: "后移", onSelect: () => setLog("后移镜头 3") },
    { label: "出 4 张候选", onSelect: () => setLog("出 4 张候选") },
    { label: "重新生成画面", onSelect: () => setLog("重新生成画面") },
    { label: "删除这一镜", onSelect: () => setLog("删除镜头 3"), danger: true, divided: true },
  ];
  return (
    <StoryFrame story="context-menu" states={STATES} state={state} log={log}>
      <div className="nx-root nx-context-demo nx-story-narrow">
        <p className="nx-muted">
          在镜头卡、时间线片段、场次上点右键，菜单里的事和旁边「更多」里的一样。
        </p>
        <button type="button" className="nx-btn" onContextMenu={menu.open}>
          镜头 3 · 近景（在这里点右键）
        </button>
        <ContextMenu
          at={shown}
          label="镜头 3 的操作"
          items={items}
          onClose={() => {
            menu.close();
            setDismissed(true);
          }}
        />
      </div>
    </StoryFrame>
  );
}
