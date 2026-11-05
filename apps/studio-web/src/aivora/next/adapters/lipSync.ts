import type { FilmShot, FilmTake } from "../../film/project";

/** What a shot card or a timeline clip says about lip sync. */
export type LipSyncTag = { text: string; title: string; failed: boolean };

/**
 * The take the cut uses: the chosen one, or with none chosen, the first one that is done.
 * Same rule as chosenExport.
 */
function inUse(shot: FilmShot): FilmTake | undefined {
  return shot.selectedTakeId
    ? shot.takes.find((take) => take.id === shot.selectedTakeId)
    : shot.takes.find((take) => take.status === "done");
}

/**
 * 4B-U07: 「口型」 on a close shot whose speaker talks on screen (GPT's C11 decides which ones go
 * through lip sync, 4B-B06), 「口型未对上」 when it failed. Reads the take in use; a narration or
 * far shot never gets a lip sync state, so it shows nothing. Accepts the state as C11's object
 * ({ lipSync }) or as the bare word.
 */
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
  if (state === "done") return { text: "口型", title: "嘴型和台词对上了", failed: false };
  if (state === "pending") return { text: "口型", title: "正在对口型", failed: false };
  if (state === "failed") {
    return {
      text: "口型未对上",
      title: "口型未对上，可重试。现在用的是没有口型的版本加单独配音。",
      failed: true,
    };
  }
  return null;
}
