import { useEffect, useRef } from "react";

/**
 * UIR-01: closes a pop-up menu the usual way. While `open`, Esc closes it, and so does a press
 * anywhere outside the elements matching `inside` (the menu and the button that opens it, so
 * that button can still toggle). Choosing an item, or changing shot or page, is up to the
 * caller: those are not events this hook can see.
 */
export function useDismiss(open: boolean, close: () => void, inside: string): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") latest.current();
    };
    const onPress = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(inside)) return;
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, [open, inside]);
}
