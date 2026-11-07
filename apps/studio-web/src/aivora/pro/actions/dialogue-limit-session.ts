import type { FilmProject } from "../../film/project";
/** Session memory only: no project/history/portable serialization or authority. */
const pending = new Map<string, { takeId: string; id: string }>();
export function rememberDialogueLimit(
  projectId: string,
  shotId: string,
  takeId: string,
  data: Record<string, unknown>,
) {
  const key = JSON.stringify([projectId, shotId]),
    id = data.dialogue_limit_evidence_id;
  pending.delete(key);
  if (typeof id !== "string" || !/^dle_[a-f0-9]{32}$/.test(id)) return;
  while (pending.size >= 64) pending.delete(pending.keys().next().value!);
  pending.set(key, { takeId, id });
}
/** Main still revalidates the live registry, canonical creative input and selected version. */
export function dialogueLimitEvidence(film: FilmProject, shotId: string): string | undefined {
  const item = pending.get(JSON.stringify([film.id, shotId]));
  if (!item) return;
  const shots = film.shots.filter((shot) => shot.id === shotId);
  if (
    shots.length !== 1 ||
    shots[0]!.takes.filter((take) => take.id === item.takeId && take.status === "failed").length !==
      1
  )
    return;
  return item.id;
}
