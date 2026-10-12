import {
  assemblyExactCommand,
  assemblyExactOperation,
  assemblyExactRejection,
  type AssemblyExactCommand,
  type AssemblyExactGateway,
  type AssemblyExactOperation,
} from "@aijian/contracts/assembly-exact";
import { impactUuid } from "@aijian/contracts/script-confirmation-impact";
import { sameMediaInput } from "@aijian/contracts/media-preparation";
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type AssemblyExactJournal =
  | { kind: "EMPTY" }
  | { kind: "BLOCKED" }
  | { kind: "LEGACY_BLOCKED" }
  | { kind: "PENDING"; command: AssemblyExactCommand };
export const ASSEMBLY_SESSION_INTENTS = new Map<string, AssemblyExactCommand>();
const key = (p: string, e: string) => `aivora.assembly-exact.pending.v2.${p}.${e}`;
export function readAssemblyExactJournal(
  s: StoragePort,
  p: string,
  e: string,
): AssemblyExactJournal {
  try {
    if (s.getItem(`aivora:episode-media-assembly:pending:${p}:${e}`) !== null)
      return { kind: "LEGACY_BLOCKED" };
    const raw = s.getItem(key(p, e));
    if (raw === null) return { kind: "EMPTY" };
    const v: unknown = JSON.parse(raw);
    return assemblyExactCommand(v, p, e) ? { kind: "PENDING", command: v } : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}
export function preserveAssemblyExactJournal(s: StoragePort, c: AssemblyExactCommand): boolean {
  const { project_id: p, episode_id: e } = c.payload.content;
  if (!assemblyExactCommand(c, p, e)) return false;
  let j = readAssemblyExactJournal(s, p, e);
  if (j.kind === "EMPTY") {
    try {
      s.setItem(key(p, e), JSON.stringify(c));
    } catch {
      return false;
    }
    j = readAssemblyExactJournal(s, p, e);
  }
  return j.kind === "PENDING" && sameMediaInput(j.command, c);
}
function close(s: StoragePort, c: AssemblyExactCommand): boolean {
  const { project_id: p, episode_id: e } = c.payload.content;
  const journal = readAssemblyExactJournal(s, p, e);
  if (journal.kind !== "PENDING" || !sameMediaInput(journal.command, c)) {
    preserveAssemblyExactJournal(s, c);
    return false;
  }
  try {
    s.removeItem(key(p, e));
    return readAssemblyExactJournal(s, p, e).kind === "EMPTY";
  } catch {
    return false;
  }
}
export type AssemblyExactResult =
  | { kind: "SAVED"; operation: AssemblyExactOperation }
  | { kind: "REJECTED"; code: string }
  | { kind: "UNKNOWN" };
export async function submitAssemblyExact(
  api: AssemblyExactGateway,
  s: StoragePort,
  c: AssemblyExactCommand,
  active: () => boolean,
  recover = false,
): Promise<AssemblyExactResult> {
  const { project_id: p, episode_id: e } = c.payload.content;
  if (
    (!recover && readAssemblyExactJournal(s, p, e).kind !== "EMPTY") ||
    !preserveAssemblyExactJournal(s, c)
  )
    return { kind: "UNKNOWN" };
  let r;
  try {
    r = await (recover ? api.getOriginal(p, e, c) : api.saveExact(p, e, c));
  } catch {
    r = null;
  }
  if (
    r?.kind === "FOUND" &&
    impactUuid(r.receipt.request_id) &&
    (await assemblyExactOperation(r.receipt.data, p, e, c)) &&
    active() &&
    close(s, c)
  )
    return { kind: "SAVED", operation: r.receipt.data };
  if (!recover && assemblyExactRejection(r) && active() && close(s, c))
    return { kind: "REJECTED", code: r.code };
  preserveAssemblyExactJournal(s, c);
  return { kind: "UNKNOWN" };
}
