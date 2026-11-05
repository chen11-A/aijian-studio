import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import "./next.css";
import "./ContextMenu.css";
import { useDismiss } from "./wiring/dismiss";

/** One line of a right-click menu. Every word is shown as it is. */
export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  /** Why it cannot be done now: the item is gray, says why on hover, and does nothing. */
  disabledReason?: string;
  /** Deleting and the like: red, and kept at the end by the caller. */
  danger?: boolean;
  /** A line above this item, between groups. */
  divided?: boolean;
};

export type ContextMenuAt = { x: number; y: number };

export type ContextMenuProps = {
  /** Where the right-click was, in window coordinates; null when closed. */
  at: ContextMenuAt | null;
  /** What the menu is for, for example 「镜头 3 的操作」. */
  label: string;
  items: readonly ContextMenuItem[];
  onClose: () => void;
};

/**
 * 5-3-02: the right-click menu on cards, clips and scenes. It holds the same things as the
 * 「更多」 next to them, opens where the pointer is, stays inside the window, and closes on Esc,
 * a press outside, or choosing an item. ↑ / ↓ move between items.
 */
export function ContextMenu({ at, label, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<ContextMenuAt | null>(at);
  useDismiss(at !== null, onClose, ".nx-context-menu");
  useLayoutEffect(() => {
    setPlace(at);
    const box = ref.current;
    if (!at || !box) return;
    const rect = box.getBoundingClientRect();
    const right = document.documentElement.clientWidth;
    const bottom = document.documentElement.clientHeight;
    if (right > 0 && bottom > 0) {
      setPlace({
        x: Math.max(4, Math.min(at.x, right - rect.width - 4)),
        y: Math.max(4, Math.min(at.y, bottom - rect.height - 4)),
      });
    }
    box.querySelector<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [at]);
  if (!at) return null;
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    // The page's own arrow keys (the playhead, the cuts) leave this press alone.
    event.preventDefault();
    const list = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ) ?? []),
    ];
    if (list.length === 0) return;
    const now = list.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? list.length - 1
          : event.key === "ArrowDown"
            ? (now + 1) % list.length
            : (now - 1 + list.length) % list.length;
    list[next]?.focus();
  };
  const shown = place ?? at;
  return (
    <div
      ref={ref}
      className="nx-root nx-context-menu"
      role="menu"
      aria-label={label}
      data-overlay=""
      style={{ left: shown.x, top: shown.y }}
      onKeyDown={move}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <Fragment key={item.label}>
          {item.divided ? <div className="nx-context-sep" role="separator" /> : null}
          <button
            type="button"
            role="menuitem"
            className={item.danger ? "nx-context-danger" : undefined}
            aria-disabled={item.disabledReason ? true : undefined}
            title={item.disabledReason}
            onClick={() => {
              if (item.disabledReason) return;
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Where a right-click menu is open. `open` is the onContextMenu handler: it keeps the browser's
 * own menu away and puts this one where the pointer is.
 */
export function useContextMenu(): {
  at: ContextMenuAt | null;
  open: (event: MouseEvent) => void;
  close: () => void;
} {
  const [at, setAt] = useState<ContextMenuAt | null>(null);
  return {
    at,
    open: (event) => {
      event.preventDefault();
      setAt({ x: event.clientX, y: event.clientY });
    },
    close: () => setAt(null),
  };
}
