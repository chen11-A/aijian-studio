import type { CreateProjectInput } from "../../api/studio";
import { isProjectAspectRatio } from "@aijian/contracts/project-aspect";

export const PROJECT_CREATE_JOURNAL_KEY = "aivora.project-create.intent.v1";
export type ProjectCreateIntent = {
  version: 1;
  client_intent_id: string;
  input: CreateProjectInput;
};
export type ProjectCreateJournalRead =
  | { kind: "READY"; intent: ProjectCreateIntent | null }
  | { kind: "BLOCKED"; intent: ProjectCreateIntent | null };
type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function validProjectCreateInput(value: unknown): value is CreateProjectInput {
  return (
    record(value) &&
    exact(value, ["name", "aspect_ratio", "target_duration_seconds", "source_language"]) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    [...value.name].length <= 80 &&
    !Array.from(value.name).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    isProjectAspectRatio(value.aspect_ratio) &&
    Number.isInteger(value.target_duration_seconds) &&
    Number(value.target_duration_seconds) >= 30 &&
    Number(value.target_duration_seconds) <= 180 &&
    value.source_language === "zh-CN"
  );
}
function parse(raw: string | null): ProjectCreateIntent | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !record(value) ||
    !exact(value, ["version", "client_intent_id", "input"]) ||
    value.version !== 1 ||
    typeof value.client_intent_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.client_intent_id,
    ) ||
    !validProjectCreateInput(value.input)
  )
    throw new Error("Invalid project creation intent");
  return value as ProjectCreateIntent;
}

/** Local single-renderer write guard, never a server receipt or a cross-window CAS. */
export class ProjectCreateJournal {
  private retainedRaw: string | null = null;
  private blocked = false;
  constructor(private readonly storage: JournalStorage | null) {}
  private retained(): ProjectCreateIntent | null {
    try {
      return parse(this.retainedRaw);
    } catch {
      return null;
    }
  }
  read(): ProjectCreateJournalRead {
    if (!this.storage) return { kind: "BLOCKED", intent: this.retained() };
    try {
      let raw = this.storage.getItem(PROJECT_CREATE_JOURNAL_KEY);
      if (this.retainedRaw !== null && raw === null) {
        // Restore only a missing owned intent. A substituted/corrupt record is never overwritten.
        this.storage.setItem(PROJECT_CREATE_JOURNAL_KEY, this.retainedRaw);
        raw = this.storage.getItem(PROJECT_CREATE_JOURNAL_KEY);
      }
      if (this.retainedRaw !== null && raw !== this.retainedRaw) this.blocked = true;
      if (raw !== null && this.retainedRaw === null) this.retainedRaw = raw;
      const intent = parse(raw);
      return { kind: this.blocked ? "BLOCKED" : "READY", intent: this.retained() ?? intent };
    } catch {
      this.blocked = true;
      return { kind: "BLOCKED", intent: this.retained() };
    }
  }
  begin(input: CreateProjectInput): ProjectCreateIntent | null {
    if (!validProjectCreateInput(input) || !this.storage) return null;
    const state = this.read();
    if (state.kind !== "READY" || state.intent) return null;
    const intent: ProjectCreateIntent = {
      version: 1,
      client_intent_id: crypto.randomUUID(),
      input: {
        name: input.name,
        aspect_ratio: input.aspect_ratio,
        target_duration_seconds: input.target_duration_seconds,
        source_language: input.source_language,
      },
    };
    const raw = JSON.stringify(intent);
    try {
      // Validation precedes serialization, so invalid numbers cannot become JSON null.
      this.retainedRaw = raw;
      this.storage.setItem(PROJECT_CREATE_JOURNAL_KEY, raw);
      if (this.storage.getItem(PROJECT_CREATE_JOURNAL_KEY) !== raw)
        throw new Error("Intent not durable");
      return parse(raw);
    } catch {
      this.blocked = true;
      return null;
    }
  }
  /** Called only after this live direct POST matches the full captured input. */
  complete(intent: ProjectCreateIntent): boolean {
    if (!this.storage || this.blocked || JSON.stringify(intent) !== this.retainedRaw) return false;
    try {
      if (this.storage.getItem(PROJECT_CREATE_JOURNAL_KEY) !== this.retainedRaw) return false;
      this.storage.removeItem(PROJECT_CREATE_JOURNAL_KEY);
      if (this.storage.getItem(PROJECT_CREATE_JOURNAL_KEY) !== null)
        throw new Error("Intent not removed");
      this.retainedRaw = null;
      return true;
    } catch {
      this.blocked = true;
      // Removal/readback failure remains uncertain; best effort retains the original local intent.
      this.read();
      return false;
    }
  }
}
