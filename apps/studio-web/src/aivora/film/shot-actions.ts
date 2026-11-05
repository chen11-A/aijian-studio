import type { FilmShot } from "./project";

const split = (text: string) =>
  ((typeof text === "string" ? text : "").match(/[^\r\n。！？!?]+[。！？!?]*/gu) ?? [])
    .map((part) => part.trim())
    .filter(Boolean);

/** The card has one main action; the full ordered movement remains separate and persisted. */
export function shotActions(shot: Pick<FilmShot, "action" | "actionBeats">): string[] {
  const saved = Array.isArray(shot.actionBeats)
    ? shot.actionBeats.filter((part): part is string => typeof part === "string" && !!part.trim())
    : [];
  // A later manual edit to the main action invalidates the old sequence.
  return saved.length && saved[0] === (shot.action ?? "").trim() ? saved : split(shot.action);
}

export function withShotActions<T extends FilmShot>(shot: T, actions: readonly string[]): T {
  const parts = actions.flatMap(split);
  const next = { ...shot, action: parts[0] ?? "" };
  if (parts.length > 1) next.actionBeats = parts;
  else delete next.actionBeats;
  return next;
}

export const shotActionText = (shot: Pick<FilmShot, "action" | "actionBeats">) =>
  shotActions(shot).join("\n");
