import type { FilmShot } from "../../film/project";

/** One continuity reminder in the app's words (C13, 4A-U05). */
export type ContinuityLine = { kind: string; title: string; text: string };

/** What each kind of reminder is about, said plainly. */
const TITLES: Record<string, string> = {
  missing_look: "外貌没写进这一镜",
  prop: "道具前后对不上",
  gaze: "看的方向反了",
  axis: "人物左右换了边",
  cut: "和上一镜接不上",
};

/**
 * The continuity reminders GPT's checks left on a shot (4A-B07). 3j-r1 keeps at most one note
 * per shot; gpt/work-4a keeps a list. Both are read, and empty notes are dropped.
 */
export function continuityNotes(shot: FilmShot): ContinuityLine[] {
  const raw = (shot as { continuity?: unknown }).continuity;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { kind, text } = item as { kind?: unknown; text?: unknown };
    const words = typeof text === "string" ? text.trim() : "";
    if (!words) return [];
    const type = typeof kind === "string" ? kind : "";
    return [{ kind: type, title: TITLES[type] ?? "场记提醒", text: words }];
  });
}
