import type { DraftReviewRevisionSource } from "./draftReviewRevision";
import { revisionRecoveryKey } from "./draftReviewRevisionRecovery";

export type DraftReviewRevisionInput = {
  noteIds: string[];
  segmentIds: string[];
  instruction: string;
  candidateOperationId: string;
  changeSummary: string;
  outcome: "NEEDS_MORE_WORK" | "MANUALLY_CHECKED";
  reason: string;
};
export const emptyRevisionInput: DraftReviewRevisionInput = {
  noteIds: [],
  segmentIds: [],
  instruction: "",
  candidateOperationId: "",
  changeSummary: "",
  outcome: "NEEDS_MORE_WORK",
  reason: "",
};
export type RevisionInputCacheStatus = "READY" | "INVALID" | "UNAVAILABLE";
export function revisionInputKey(job: DraftReviewRevisionSource, part = "compose"): string {
  return `${revisionRecoveryKey(job).replace(":pending:", ":input:")}:${part}`;
}
export function parseRevisionInput(value: unknown): DraftReviewRevisionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(emptyRevisionInput);
  const list = (value: unknown, pattern: RegExp, max: number) =>
    Array.isArray(value) &&
    value.length <= max &&
    new Set(value).size === value.length &&
    value.every((id) => typeof id === "string" && pattern.test(id));
  const text = (value: unknown) =>
    typeof value === "string" &&
    [...value].length <= 2000 &&
    !value.includes("\0") &&
    new TextDecoder().decode(new TextEncoder().encode(value)) === value;
  if (
    Object.keys(input).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(input, key)) ||
    !list(input.noteIds, /^drn_[0-9a-f]{32}$/, 50) ||
    !list(input.segmentIds, /^seg_[a-z0-9._-]{1,80}$/, 100) ||
    !text(input.instruction) ||
    !text(input.changeSummary) ||
    !text(input.reason) ||
    typeof input.candidateOperationId !== "string" ||
    (input.candidateOperationId !== "" && !/^dmp_[0-9a-f]{32}$/.test(input.candidateOperationId)) ||
    (input.outcome !== "NEEDS_MORE_WORK" && input.outcome !== "MANUALLY_CHECKED")
  )
    return null;
  return input as DraftReviewRevisionInput;
}
export function readRevisionInput(key: string): {
  input: DraftReviewRevisionInput;
  status: RevisionInputCacheStatus;
} {
  try {
    const text = localStorage.getItem(key);
    if (text === null) return { input: emptyRevisionInput, status: "READY" };
    if (text.length > 30000) return { input: emptyRevisionInput, status: "INVALID" };
    try {
      const input = parseRevisionInput(JSON.parse(text));
      return input ? { input, status: "READY" } : { input: emptyRevisionInput, status: "INVALID" };
    } catch {
      return { input: emptyRevisionInput, status: "INVALID" };
    }
  } catch {
    return { input: emptyRevisionInput, status: "UNAVAILABLE" };
  }
}
