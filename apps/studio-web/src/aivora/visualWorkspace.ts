import {
  visualJson,
  visualWriteInput,
  visualTicketData,
  visualActionOutcomeMatches,
  visualLocalReviewActorMatches,
  visualProjectId,
  type VisualGateway,
  type VisualTicket,
  type VisualWrite,
  type VisualOperation,
} from "@aijian/contracts/visual-bible";
export type VisualPending =
  | { kind: "save"; project_id: string; key: string; payload: VisualWrite }
  | { kind: "review"; project_id: string; ticket: VisualTicket }
  | {
      kind: "inspection";
      project_id: string;
      asset_id: string;
      asset_version_id: string;
      sha256: string;
      operation_id: string;
    };
export type VisualJournal =
  { kind: "EMPTY" } | { kind: "BLOCKED" } | { kind: "PENDING"; value: VisualPending };
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
export function validVisualPending(v: unknown, p: string): v is VisualPending {
  if (!record(v) || v.project_id !== p || !visualProjectId(p)) return false;
  if (v.kind === "save")
    return (
      exact(v, ["kind", "project_id", "key", "payload"]) &&
      typeof v.key === "string" &&
      /^vbsave_[0-9a-f]{32}$/.test(v.key) &&
      visualWriteInput(v.payload, p)
    );
  if (v.kind === "review")
    return (
      exact(v, ["kind", "project_id", "ticket"]) &&
      visualTicketData(v.ticket) &&
      v.ticket.project_id === p
    );
  return (
    v.kind === "inspection" &&
    exact(v, ["kind", "project_id", "asset_id", "asset_version_id", "sha256", "operation_id"]) &&
    typeof v.asset_id === "string" &&
    /^asset_[0-9a-f]{32}$/.test(v.asset_id) &&
    typeof v.asset_version_id === "string" &&
    /^asv_[0-9a-f]{32}$/.test(v.asset_version_id) &&
    typeof v.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(v.sha256) &&
    typeof v.operation_id === "string" &&
    /^vinop_[0-9a-f]{32}$/.test(v.operation_id)
  );
}
const key = (p: string) => `aivora.visual-bible.pending.v1.${p}`;
export function readVisualJournal(p: string): VisualJournal {
  try {
    const raw = window.localStorage.getItem(key(p));
    if (raw === null) return { kind: "EMPTY" };
    if (new TextEncoder().encode(raw).length > 2200000) return { kind: "BLOCKED" };
    const value: unknown = JSON.parse(raw);
    return validVisualPending(value, p) ? { kind: "PENDING", value } : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}
export function writeVisualJournal(p: string, value: VisualPending | null): boolean {
  try {
    if (value === null) return false;
    else {
      if (!validVisualPending(value, p)) return false;
      const raw = JSON.stringify(value);
      if (new TextEncoder().encode(raw).length > 2200000) return false;
      window.localStorage.setItem(key(p), raw);
      if (window.localStorage.getItem(key(p)) !== raw) return false;
    }
    return true;
  } catch {
    return false;
  }
}
export function clearVisualJournal(p: string, original: VisualPending): boolean {
  const stored = readVisualJournal(p);
  if (stored.kind !== "PENDING" || visualJson(stored.value) !== visualJson(original)) return false;
  try {
    window.localStorage.removeItem(key(p));
    return readVisualJournal(p).kind === "EMPTY";
  } catch {
    return false;
  }
}
export function visualGateway(): VisualGateway | null {
  const g = window.aijian;
  const names: (keyof VisualGateway)[] = [
    "getVisualBible",
    "getVisualBibleVersion",
    "getVisualBibleReadiness",
    "getVisualBibleAuthority",
    "getVisualReviewState",
    "saveVisualBible",
    "getVisualSaveOperation",
    "readVisualReviewOperation",
    "getVisualInspectionOperation",
    "prepareVisualReview",
    "confirmVisualReview",
    "inspectVisualReference",
  ];
  return g && names.every((n) => typeof g[n] === "function") ? (g as VisualGateway) : null;
}
export function visualNewId(prefix: string): string | null {
  try {
    return `${prefix}_${window.crypto.randomUUID().replaceAll("-", "")}`;
  } catch {
    return null;
  }
}
export async function visualBrowserHash(value: unknown): Promise<string> {
  const digest = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(visualJson(value)).buffer,
  );
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export async function visualTicketMatches(
  ticket: VisualTicket,
  result: VisualOperation,
): Promise<boolean> {
  const input = ticket.input;
  const payload =
    input.action === "submit"
      ? {}
      : input.action === "signoff"
        ? { roles: input.roles }
        : { decision: input.decision, rationale: input.rationale, actor_role: "producer" };
  if (
    !visualLocalReviewActorMatches(result) ||
    result.report.report_hash !== (await visualBrowserHash(result.report.report))
  )
    return false;
  const hash = await visualBrowserHash({
    ...payload,
    _actor_id: result.actor_id,
    _actor_roles: result.actor_roles,
    _policy_snapshot_hash: result.policy_snapshot_hash,
  });
  return (
    result.project_id === ticket.project_id &&
    result.content_hash === ticket.content_hash &&
    result.challenge.id === ticket.challenge_id &&
    result.challenge.version_id === ticket.version_id &&
    result.challenge.head_revision === ticket.expected_revision &&
    result.challenge.action === ticket.input.action &&
    result.report.id === ticket.report_id &&
    result.report.report_hash === ticket.report_hash &&
    result.action_payload_hash === hash &&
    visualActionOutcomeMatches(input, result)
  );
}
