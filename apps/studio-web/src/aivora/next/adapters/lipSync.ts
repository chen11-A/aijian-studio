import type { FilmShot, FilmTake } from "../../film/project";

/** What a shot card or a timeline clip says about lip sync. */
export type LipSyncTag = { text: string; title: string; failed: boolean };

/** Read the existing chosen-version marker; retain the legacy first-done fallback.
 * This presentation rule is not media availability, export selection or verification. */
function inUse(shot: FilmShot): FilmTake | undefined {
  return shot.selectedTakeId
    ? shot.takes.find((take) => take.id === shot.selectedTakeId)
    : shot.takes.find((take) => take.status === "done");
}

/** Legacy raw markers have no current producer or verified alignment observation.
 * Preserve their original state and selection while making the evidence limit explicit. */
export function lipSyncTag(shot: FilmShot): LipSyncTag | null {
  const take = inUse(shot);
  if (!take) return null;
  const raw = take.lipSync as unknown;
  const state =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object" && "lipSync" in raw
        ? String((raw as { lipSync: unknown }).lipSync)
        : "";
  if (state === "done")
    return { text: "口型待核验", title: "历史口型标记为已完成，实际对齐尚未核验。", failed: false };
  if (state === "pending")
    return {
      text: "口型待核验",
      title: "历史口型标记为待处理，当前未核验实际口型状态。",
      failed: false,
    };
  if (state === "failed") {
    return {
      text: "口型待核验",
      title: "历史口型标记为失败，实际对齐与声音尚未核验。",
      failed: true,
    };
  }
  return null;
}
