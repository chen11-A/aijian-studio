/**
 * 4C-U03: the person's own defaults, kept on this computer (not in a work): where exports go,
 * whether a new cover says 「AI 生成」, and the beginner mode of one version per shot. The
 * preview sound keeps its own key, aivora.sound, as before.
 */
export type AppPrefs = {
  /** Empty: ask the desktop for its default folder. */
  exportDir: string;
  /** A new cover starts with 「AI 生成」 on. */
  aiMark: boolean;
  /** One version per shot, and 「一次出几个」 is not offered. */
  beginner: boolean;
};

const KEY = "aivora.prefs";
const DEFAULTS: AppPrefs = { exportDir: "", aiMark: true, beginner: false };

export function readPrefs(): AppPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const value = JSON.parse(raw) as Partial<AppPrefs>;
    return {
      exportDir: typeof value.exportDir === "string" ? value.exportDir : "",
      aiMark: value.aiMark !== false,
      beginner: value.beginner === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function writePrefs(next: AppPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or blocked storage keeps the choice for this session only.
  }
}

const GROUPS = "aivora.board.groups";

/** 4C-U05: whether a group of a shot's properties was left open; defaultOpen until it was touched. */
export function readGroupOpen(id: string, defaultOpen: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(GROUPS);
    const value = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return typeof value[id] === "boolean" ? value[id] : defaultOpen;
  } catch {
    return defaultOpen;
  }
}

export function writeGroupOpen(id: string, open: boolean): void {
  try {
    const raw = window.localStorage.getItem(GROUPS);
    const value = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(GROUPS, JSON.stringify({ ...value, [id]: open }));
  } catch {
    // A full or blocked storage keeps the group as it is for this session only.
  }
}
