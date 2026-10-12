import {
  localReviewCommand,
  localReviewOperation,
  localReviewRejection,
  type LocalMediaReviewCommand,
  type LocalMediaReviewGateway,
  type LocalMediaReviewOperation,
} from "@aijian/contracts/local-media-review";
import { impactUuid } from "@aijian/contracts/script-confirmation-impact";
import { sameMediaInput } from "@aijian/contracts/media-preparation";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type LocalReviewJournal =
  { kind: "EMPTY" } | { kind: "BLOCKED" } | { kind: "PENDING"; command: LocalMediaReviewCommand };
export const LOCAL_REVIEW_SESSION_INTENTS = new Map<string, LocalMediaReviewCommand>();
const key = (p: string, e: string) => `aivora.local-media-review.pending.v1.${p}.${e}`;
export function readLocalReviewJournal(s: StoragePort, p: string, e: string): LocalReviewJournal {
  try {
    const raw = s.getItem(key(p, e));
    if (raw === null) return { kind: "EMPTY" };
    const value: unknown = JSON.parse(raw);
    return localReviewCommand(value, p, e)
      ? { kind: "PENDING", command: value }
      : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}
export function preserveLocalReviewJournal(s: StoragePort, c: LocalMediaReviewCommand): boolean {
  const { project_id: p, episode_id: e } = c.payload.input;
  if (!localReviewCommand(c, p, e)) return false;
  let journal = readLocalReviewJournal(s, p, e);
  if (journal.kind === "EMPTY") {
    try {
      s.setItem(key(p, e), JSON.stringify(c));
    } catch {
      return false;
    }
    journal = readLocalReviewJournal(s, p, e);
  }
  return journal.kind === "PENDING" && sameMediaInput(journal.command, c);
}
function close(s: StoragePort, c: LocalMediaReviewCommand): boolean {
  const { project_id: p, episode_id: e } = c.payload.input;
  const journal = readLocalReviewJournal(s, p, e);
  if (journal.kind !== "PENDING" || !sameMediaInput(journal.command, c)) return false;
  try {
    s.removeItem(key(p, e));
    if (readLocalReviewJournal(s, p, e).kind === "EMPTY") return true;
  } catch {
    // The original intent stays held in memory and is never replaced or resent.
  }
  preserveLocalReviewJournal(s, c);
  return false;
}
export type LocalReviewWriteResult =
  | { kind: "SAVED"; operation: LocalMediaReviewOperation }
  | { kind: "REJECTED"; code: string }
  | { kind: "UNKNOWN" };
export async function submitLocalReview(
  api: LocalMediaReviewGateway,
  storage: StoragePort,
  command: LocalMediaReviewCommand,
  active: () => boolean,
  recover = false,
): Promise<LocalReviewWriteResult> {
  const { project_id: p, episode_id: e } = command.payload.input;
  if (
    !localReviewCommand(command, p, e) ||
    (!recover && readLocalReviewJournal(storage, p, e).kind !== "EMPTY") ||
    !preserveLocalReviewJournal(storage, command)
  )
    return { kind: "UNKNOWN" };
  let result;
  try {
    result = await (recover
      ? api.getLocalMediaReviewOperation(p, e, command)
      : api.saveLocalMediaReview(p, e, command));
  } catch {
    result = null;
  }
  if (
    result?.kind === "FOUND" &&
    impactUuid(result.receipt.request_id) &&
    (await localReviewOperation(result.receipt.data, p, e, command)) &&
    active() &&
    close(storage, command)
  )
    return { kind: "SAVED", operation: result.receipt.data };
  if (!recover && localReviewRejection(result) && active() && close(storage, command))
    return { kind: "REJECTED", code: result.code };
  preserveLocalReviewJournal(storage, command);
  return { kind: "UNKNOWN" };
}
