import type { PendingReview } from "./draftReview";

/** Only in-flight commands live here. The authoritative notes are in the workspace database. */
export function readPendingReview(key: string): PendingReview | null | undefined {
  try {
    const text = localStorage.getItem(key);
    if (text === null) return null;
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !("kind" in parsed) || !("command" in parsed))
      return undefined;
    const value = parsed.command;
    if (!value || typeof value !== "object") return undefined;
    const command = value as Record<string, unknown>;
    if (
      typeof command.assembly_version_id !== "string" ||
      !/^ver_[0-9a-f]{32}$/.test(command.assembly_version_id) ||
      typeof command.assembly_content_hash !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(command.assembly_content_hash) ||
      typeof command.output_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(command.output_sha256) ||
      typeof command.output_bytes !== "number" ||
      !Number.isSafeInteger(command.output_bytes) ||
      command.output_bytes < 1
    )
      return undefined;
    const validText = (value: unknown) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 2000 &&
      !value.includes("\0");
    if (
      parsed.kind === "create" &&
      Object.keys(parsed).length === 2 &&
      Object.keys(command).length === 7 &&
      typeof command.note_id === "string" &&
      /^drn_[0-9a-f]{32}$/.test(command.note_id) &&
      typeof command.frame_index === "number" &&
      Number.isSafeInteger(command.frame_index) &&
      command.frame_index >= 0 &&
      command.frame_index < 1_000_000 &&
      validText(command.text)
    )
      return parsed as PendingReview;
    if (
      parsed.kind === "resolve" &&
      Object.keys(parsed).length === 3 &&
      "noteId" in parsed &&
      typeof parsed.noteId === "string" &&
      /^drn_[0-9a-f]{32}$/.test(parsed.noteId) &&
      Object.keys(command).length === 7 &&
      typeof command.resolution_id === "string" &&
      /^drr_[0-9a-f]{32}$/.test(command.resolution_id) &&
      command.expected_revision === 1 &&
      validText(command.reason)
    )
      return parsed as PendingReview;
    return undefined;
  } catch {
    return undefined;
  }
}
