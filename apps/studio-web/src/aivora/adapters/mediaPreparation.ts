import {
  mediaCommand,
  mediaOperation,
  mediaRejection,
  sameMediaInput,
  type MediaPreparationCommand,
  type MediaPreparationGateway,
  type MediaPreparationVersion,
} from "@aijian/contracts/media-preparation";
import { impactUuid } from "@aijian/contracts/script-confirmation-impact";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PreparationJournal =
  { kind: "EMPTY" } | { kind: "BLOCKED" } | { kind: "PENDING"; command: MediaPreparationCommand };
export type PreparationResult =
  | { kind: "SAVED"; version: MediaPreparationVersion }
  | { kind: "REJECTED"; code: string }
  | { kind: "UNKNOWN" };
const key = (p: string, e: string) => `aivora.media-preparation.pending.v1.${p}.${e}`;
export function readPreparationJournal(s: StoragePort, p: string, e: string): PreparationJournal {
  try {
    const raw = s.getItem(key(p, e));
    if (raw === null) return { kind: "EMPTY" };
    const v: unknown = JSON.parse(raw);
    return mediaCommand(v, p, e) ? { kind: "PENDING", command: v } : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}
export function preservePreparationJournal(s: StoragePort, c: MediaPreparationCommand): boolean {
  const { project_id: p, episode_id: e } = c.payload.input;
  if (!mediaCommand(c, p, e)) return false;
  let current = readPreparationJournal(s, p, e);
  if (current.kind === "EMPTY") {
    try {
      s.setItem(key(p, e), JSON.stringify(c));
    } catch {
      return false;
    }
    current = readPreparationJournal(s, p, e);
  }
  return current.kind === "PENDING" && sameMediaInput(current.command, c);
}
export function closePreparationJournal(s: StoragePort, c: MediaPreparationCommand): boolean {
  if (!preservePreparationJournal(s, c)) return false;
  const { project_id: p, episode_id: e } = c.payload.input;
  try {
    s.removeItem(key(p, e));
    return readPreparationJournal(s, p, e).kind === "EMPTY";
  } catch {
    return false;
  }
}
export async function savePreparation(
  api: MediaPreparationGateway,
  s: StoragePort,
  c: MediaPreparationCommand,
  active: () => boolean = () => true,
): Promise<PreparationResult> {
  const { project_id: p, episode_id: e } = c.payload.input;
  if (readPreparationJournal(s, p, e).kind !== "EMPTY" || !preservePreparationJournal(s, c))
    return { kind: "UNKNOWN" };
  let r;
  try {
    r = await api.saveMediaPreparation(p, e, c);
  } catch {
    r = null;
  }
  if (
    r?.kind === "FOUND" &&
    impactUuid(r.receipt.request_id) &&
    (await mediaOperation(r.receipt.data, p, e, c)) &&
    active() &&
    closePreparationJournal(s, c)
  )
    return { kind: "SAVED", version: r.receipt.data.version };
  if (mediaRejection(r) && active() && closePreparationJournal(s, c))
    return { kind: "REJECTED", code: r.code };
  preservePreparationJournal(s, c);
  return { kind: "UNKNOWN" };
}
export async function recoverPreparation(
  api: MediaPreparationGateway,
  s: StoragePort,
  c: MediaPreparationCommand,
  active: () => boolean = () => true,
): Promise<PreparationResult> {
  const { project_id: p, episode_id: e } = c.payload.input;
  if (!preservePreparationJournal(s, c)) return { kind: "UNKNOWN" };
  let r;
  try {
    r = await api.getMediaPreparationOperation(p, e, c);
  } catch {
    r = null;
  }
  if (
    r?.kind === "FOUND" &&
    impactUuid(r.receipt.request_id) &&
    (await mediaOperation(r.receipt.data, p, e, c)) &&
    active() &&
    closePreparationJournal(s, c)
  )
    return { kind: "SAVED", version: r.receipt.data.version };
  preservePreparationJournal(s, c);
  return { kind: "UNKNOWN" };
}
