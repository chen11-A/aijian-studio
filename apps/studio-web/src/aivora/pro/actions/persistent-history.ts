import type { FilmHistoryEntry, FilmHistoryReason } from "@aijian/contracts/film-history";
import { upgradeFilm, type FilmProject } from "../../film/project";
import type { FilmSaveLease } from "../film-persistence";
export const HISTORY_REASON_LABEL: Record<FilmHistoryReason, string> = {
  manual: "手动保存的版本",
  "before-batch-generation": "批量生成前自动存的",
  "before-pipeline": "整部制作前自动存的",
  "before-restore": "恢复历史前保留的当前版本",
};
function recordText(value: unknown): string {
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : value;
  return JSON.stringify(normalize(value));
}
export async function historyRecordHash(value: unknown) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(recordText(value))),
    ),
  ]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
export function historyEntryView(entry: FilmHistoryEntry) {
  return {
    id: entry.id,
    when: new Date(entry.createdAt).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    why: HISTORY_REASON_LABEL[entry.reason],
    summary: `${entry.summary.scenes} 场 · ${entry.summary.shots} 个镜头 · ${entry.summary.done} 个做好了`,
  };
}
export type HistoryHost = {
  current: () => FilmProject | null;
  apply: (next: FilmProject) => void;
  acquire: (id: string) => Promise<FilmSaveLease>;
};
/** Save and adopt canonical media while holding the normal save lease. */
export async function prepareHistoryInput(
  base: FilmProject,
  host: HistoryHost,
  providedLease?: FilmSaveLease,
) {
  const bridge = window.aijian;
  if (
    !bridge?.readFilmProject ||
    !bridge.captureFilmHistory ||
    !bridge.restoreFilmHistory ||
    !bridge.listFilmHistory
  )
    throw new Error("HISTORY_UNSUPPORTED");
  const lease = providedLease ?? (await host.acquire(base.id));
  const own = !providedLease;
  let accepted = base;
  const current = () => host.current() === accepted;
  try {
    if (!current()) throw new Error("HISTORY_STALE");
    await lease.save(accepted, current);
    const raw = await bridge.readFilmProject(base.id);
    if (!current()) throw new Error("HISTORY_STALE");
    if (!raw || raw.id !== base.id) throw new Error("HISTORY_SAVE_FAILED");
    const canonical = upgradeFilm(raw);
    if (!canonical || canonical.id !== base.id) throw new Error("HISTORY_SAVE_FAILED");
    host.apply(canonical);
    accepted = host.current()!;
    if (!accepted || accepted.id !== base.id) throw new Error("HISTORY_STALE");
    // Make the adopted ref the lease's saved checkpoint, so release cannot replay pre-restore data.
    await lease.save(accepted, current);
    const stored = await bridge.readFilmProject(base.id);
    if (!current()) throw new Error("HISTORY_STALE");
    if (!stored || stored.id !== base.id) throw new Error("HISTORY_SAVE_FAILED");
    const expectedHash = await historyRecordHash(stored);
    if (!current()) throw new Error("HISTORY_STALE");
    return {
      film: accepted,
      expectedHash,
      lease,
      current,
      release: async () => {
        if (own) await lease.release();
      },
    };
  } catch (error) {
    if (own) await lease.release();
    throw error;
  }
}
