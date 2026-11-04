import { useEffect, useRef, useState } from "react";
import type { UiNotice } from "../../film/contracts3j";
import { noticeMatches, statusLine, type StatusLine } from "./noticeCopy";

/** How long one message stays in the status bar (3J-U04), and how long it takes to fade. */
export const NOTICE_SHOW_MS = 5000;
export const NOTICE_FADE_MS = 400;
/** The task center keeps this many past messages. */
export const NOTICE_LOG_SIZE = 30;

export type LoggedNotice = StatusLine & { id: number; at: Date };

export type StatusNotice = {
  /** The message to show now, or null when the status bar shows only the save state. */
  line: StatusLine | null;
  /** True for the last NOTICE_FADE_MS before the line goes away. */
  fading: boolean;
  /** Past messages, newest first, for the task center. */
  log: readonly LoggedNotice[];
};

/**
 * The status-bar message (3J-U04). The workspace keeps the sentence it wants shown (`shown`)
 * and announces every message as an aivora-notice event; this hook turns them into one line
 * that fades after five seconds and goes into the log.
 *
 * Chat replies are announced too, but they do not change `shown`, so they never reach the
 * status bar: they are already in the chat.
 */
export function useStatusNotice(shown: string): StatusNotice {
  const last = useRef<UiNotice | null>(null);
  const handled = useRef<UiNotice | null>(null);
  const previous = useRef("");
  const nextId = useRef(0);
  // The fade timers belong to the line on show, not to one run of the effect: a chat reply
  // re-runs the effect without replacing the line, and must not cancel its fade.
  const timers = useRef<number[]>([]);
  const stopTimers = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };
  const [heard, setHeard] = useState(0);
  const [state, setState] = useState<StatusNotice>({ line: null, fading: false, log: [] });

  useEffect(() => stopTimers, []);

  useEffect(() => {
    const listen = (event: Event) => {
      last.current = (event as CustomEvent<UiNotice>).detail ?? null;
      setHeard((count) => count + 1);
    };
    window.addEventListener("aivora-notice", listen);
    return () => window.removeEventListener("aivora-notice", listen);
  }, []);

  useEffect(() => {
    const changed = shown !== previous.current;
    previous.current = shown;
    const event = last.current;
    // The same sentence again counts as new only when its own event came with it.
    const repeated = !changed && event !== null && event !== handled.current;
    if (!changed && !(repeated && noticeMatches(event, shown))) return;
    handled.current = event;
    const line = statusLine(shown, event && noticeMatches(event, shown) ? event : null);
    stopTimers();
    if (!line) {
      setState((current) => ({ ...current, line: null, fading: false }));
      return;
    }
    nextId.current += 1;
    const entry: LoggedNotice = { ...line, id: nextId.current, at: new Date() };
    setState((current) => ({
      line,
      fading: false,
      log: [entry, ...current.log].slice(0, NOTICE_LOG_SIZE),
    }));
    timers.current = [
      window.setTimeout(
        () => setState((current) => ({ ...current, fading: true })),
        NOTICE_SHOW_MS - NOTICE_FADE_MS,
      ),
      window.setTimeout(
        () => setState((current) => ({ ...current, line: null, fading: false })),
        NOTICE_SHOW_MS,
      ),
    ];
  }, [shown, heard]);

  return state;
}
