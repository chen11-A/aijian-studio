import { useEffect, useRef } from "react";

/** Ctrl+J, or ⌘J on a Mac, without Shift or Alt. */
export function isAssistantKey(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "j"
  );
}

/**
 * 4A-U11: Ctrl+J opens and closes the AI 助手 wherever the page shows it: a page with
 * 「属性 | AI 助手」 tabs switches tabs, a page that only has the assistant moves into its
 * input and back out. Only the part of the page that is shown listens.
 */
export function useAssistantKey(toggle: () => void, enabled = true): void {
  const latest = useRef(toggle);
  useEffect(() => {
    latest.current = toggle;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isAssistantKey(event)) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
