import {
  candidateCommand,
  candidateOperation,
  candidateRejection,
  sameMediaInput,
  type ManualMediaCandidateCommand,
  type ManualMediaCandidateGateway,
  type ManualMediaCandidateVersion,
} from "@aijian/contracts/manual-media-candidate";
import { impactUuid } from "@aijian/contracts/script-confirmation-impact";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CandidateJournal =
  | { kind: "EMPTY" }
  | { kind: "BLOCKED" }
  | { kind: "PENDING"; command: ManualMediaCandidateCommand };
export type CandidateResult =
  | { kind: "SAVED"; version: ManualMediaCandidateVersion }
  | { kind: "REJECTED"; code: string }
  | { kind: "UNKNOWN" };
const key = (p: string, e: string) => `aivora.manual-media-candidate.pending.v1.${p}.${e}`;
export function readCandidateJournal(s: StoragePort, p: string, e: string): CandidateJournal {
  try {
    const raw = s.getItem(key(p, e));
    if (raw === null) return { kind: "EMPTY" };
    const v: unknown = JSON.parse(raw);
    return candidateCommand(v, p, e) ? { kind: "PENDING", command: v } : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}
export function preserveCandidateJournal(s: StoragePort, c: ManualMediaCandidateCommand): boolean {
  const { project_id: p, episode_id: e } = c.payload.input;
  if (!candidateCommand(c, p, e)) return false;
  let current = readCandidateJournal(s, p, e);
  if (current.kind === "EMPTY") {
    try {
      s.setItem(key(p, e), JSON.stringify(c));
    } catch {
      return false;
    }
    current = readCandidateJournal(s, p, e);
  }
  return current.kind === "PENDING" && sameMediaInput(current.command, c);
}
export function closeCandidateJournal(s: StoragePort, c: ManualMediaCandidateCommand): boolean {
  const { project_id: p, episode_id: e } = c.payload.input;
  const journal = readCandidateJournal(s, p, e);
  if (journal.kind !== "PENDING" || !sameMediaInput(journal.command, c)) {
    preserveCandidateJournal(s, c);
    return false;
  }
  try {
    s.removeItem(key(p, e));
    return readCandidateJournal(s, p, e).kind === "EMPTY";
  } catch {
    return false;
  }
}
export async function saveCandidate(
  api: ManualMediaCandidateGateway,
  s: StoragePort,
  c: ManualMediaCandidateCommand,
  active: () => boolean = () => true,
): Promise<CandidateResult> {
  const { project_id: p, episode_id: e } = c.payload.input;
  if (readCandidateJournal(s, p, e).kind !== "EMPTY" || !preserveCandidateJournal(s, c))
    return { kind: "UNKNOWN" };
  let r;
  try {
    r = await api.saveManualMediaCandidate(p, e, c);
  } catch {
    r = null;
  }
  if (
    r?.kind === "FOUND" &&
    impactUuid(r.receipt.request_id) &&
    (await candidateOperation(r.receipt.data, p, e, c)) &&
    active() &&
    closeCandidateJournal(s, c)
  )
    return { kind: "SAVED", version: r.receipt.data.version };
  if (candidateRejection(r) && active() && closeCandidateJournal(s, c))
    return { kind: "REJECTED", code: r.code };
  preserveCandidateJournal(s, c);
  return { kind: "UNKNOWN" };
}
export async function recoverCandidate(
  api: ManualMediaCandidateGateway,
  s: StoragePort,
  c: ManualMediaCandidateCommand,
  active: () => boolean = () => true,
): Promise<CandidateResult> {
  const { project_id: p, episode_id: e } = c.payload.input;
  if (!preserveCandidateJournal(s, c)) return { kind: "UNKNOWN" };
  let r;
  try {
    r = await api.getManualMediaCandidateOperation(p, e, c);
  } catch {
    r = null;
  }
  if (
    r?.kind === "FOUND" &&
    impactUuid(r.receipt.request_id) &&
    (await candidateOperation(r.receipt.data, p, e, c)) &&
    active() &&
    closeCandidateJournal(s, c)
  )
    return { kind: "SAVED", version: r.receipt.data.version };
  preserveCandidateJournal(s, c);
  return { kind: "UNKNOWN" };
}
