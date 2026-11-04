import type {
  OfficialDirectorGenerate,
  OfficialDirectorOperation,
} from "@aijian/contracts/official-director";
import { sameStoryboardJson } from "./episodeStoryboard";

export type DirectorStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DirectorCommand =
  | { kind: "GENERATE"; operationId: string; expectedRequest: string }
  | {
      kind: "ADOPT" | "REJECT";
      operationId: string;
      versionId: string;
      contentHash: string;
      reason: string | null;
    };
export type DirectorJournal =
  { kind: "EMPTY" } | { kind: "BLOCKED" } | { kind: "PENDING"; command: DirectorCommand };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, names: string[]) =>
  Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const key = (project: string, episode: string) =>
  `aivora.official-director.pending.v1.${project}.${episode}`;

export function validDirectorCommand(value: unknown): value is DirectorCommand {
  if (!record(value) || typeof value.operationId !== "string" || !uuid.test(value.operationId))
    return false;
  if (value.kind === "GENERATE") {
    if (
      !exactKeys(value, ["kind", "operationId", "expectedRequest"]) ||
      typeof value.expectedRequest !== "string" ||
      value.expectedRequest.length > 1_000_000
    )
      return false;
    try {
      return record(JSON.parse(value.expectedRequest));
    } catch {
      return false;
    }
  }
  return (
    (value.kind === "ADOPT" || value.kind === "REJECT") &&
    exactKeys(value, ["kind", "operationId", "versionId", "contentHash", "reason"]) &&
    typeof value.versionId === "string" &&
    /^ver_[0-9a-f]{32}$/.test(value.versionId) &&
    typeof value.contentHash === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(value.contentHash) &&
    (value.kind === "ADOPT"
      ? value.reason === null
      : typeof value.reason === "string" &&
        !!value.reason.trim() &&
        [...value.reason].length <= 2000 &&
        !value.reason.includes("\0"))
  );
}
export function readDirectorJournal(
  storage: DirectorStorage | null,
  project: string,
  episode: string,
): DirectorJournal {
  if (!storage) return { kind: "BLOCKED" };
  try {
    const raw = storage.getItem(key(project, episode));
    if (raw === null) return { kind: "EMPTY" };
    if (raw.length > 1_000_500) return { kind: "BLOCKED" };
    const value: unknown = JSON.parse(raw);
    return validDirectorCommand(value) ? { kind: "PENDING", command: value } : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}
export function persistDirectorCommand(
  storage: DirectorStorage,
  project: string,
  episode: string,
  command: DirectorCommand,
): boolean {
  if (
    !validDirectorCommand(command) ||
    readDirectorJournal(storage, project, episode).kind !== "EMPTY"
  )
    return false;
  try {
    storage.setItem(key(project, episode), JSON.stringify(command));
    const journal = readDirectorJournal(storage, project, episode);
    return journal.kind === "PENDING" && sameStoryboardJson(journal.command, command);
  } catch {
    return false;
  }
}
export function clearDirectorCommand(
  storage: DirectorStorage,
  project: string,
  episode: string,
  command: DirectorCommand,
): boolean {
  const journal = readDirectorJournal(storage, project, episode);
  if (journal.kind !== "PENDING" || !sameStoryboardJson(journal.command, command)) return false;
  try {
    storage.removeItem(key(project, episode));
    return readDirectorJournal(storage, project, episode).kind === "EMPTY";
  } catch {
    return false;
  }
}
export function directorGenerationCommand(input: OfficialDirectorGenerate): DirectorCommand {
  return {
    kind: "GENERATE",
    operationId: input.operationId,
    expectedRequest: JSON.stringify({
      model: input.model,
      authority: input.authority,
      storyboard_base: input.storyboardBase,
      intent: input.intent,
      options: input.options,
    }),
  };
}
export function matchesDirectorCommand(
  operation: OfficialDirectorOperation,
  command: DirectorCommand,
) {
  if (operation.request.operation_id !== command.operationId) return false;
  if (command.kind === "GENERATE")
    return sameStoryboardJson(JSON.parse(command.expectedRequest), {
      model: operation.request.model,
      authority: operation.request.authority,
      storyboard_base: operation.request.storyboard_base,
      intent: operation.request.intent,
      options: operation.request.options,
    });
  if (
    operation.proposal?.version_id !== command.versionId ||
    operation.proposal.content_hash !== command.contentHash
  )
    return false;
  return command.kind === "ADOPT"
    ? operation.adoption?.proposal_version_id === command.versionId &&
        operation.adoption.proposal_content_hash === command.contentHash
    : operation.rejection?.reason === command.reason;
}
