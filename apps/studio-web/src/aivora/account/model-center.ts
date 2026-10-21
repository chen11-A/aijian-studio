import type { Capability } from "../../domain/provider-settings-model";

/** The only persisted model choice. Other screens read it and do not offer a picker. */
export const MODEL_CENTER_KEY = "aivora.model-center.v1";

export type CenterProvider = "XAI_API" | "CHATGPT_OFFICIAL" | "CONNECTION";

export type CenterChoice = {
  provider: CenterProvider;
  modelId: string;
  connectionId?: string;
};

export type ModelCenterState = {
  version: 1;
  choices: Partial<Record<Capability, CenterChoice>>;
};

export const EMPTY_MODEL_CENTER: ModelCenterState = { version: 1, choices: {} };

const listeners = new Set<() => void>();
let cacheRaw: string | null | undefined;
let cacheValue: ModelCenterState = EMPTY_MODEL_CENTER;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/\s/.test(value)
  );
}

function isChoice(value: unknown): value is CenterChoice {
  if (typeof value !== "object" || value === null) return false;
  const choice = value as Partial<CenterChoice>;
  if (!validId(choice.modelId)) return false;
  if (choice.provider === "CONNECTION") return validId(choice.connectionId);
  if (choice.provider === "XAI_API" || choice.provider === "CHATGPT_OFFICIAL")
    return choice.connectionId === undefined;
  return false;
}

function parse(raw: string | null): ModelCenterState {
  if (!raw) return EMPTY_MODEL_CENTER;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return EMPTY_MODEL_CENTER;
    const record = value as { version?: unknown; choices?: unknown };
    if (record.version !== 1 || typeof record.choices !== "object" || record.choices === null)
      return EMPTY_MODEL_CENTER;
    const choices: ModelCenterState["choices"] = {};
    for (const capability of ["TEXT", "IMAGE", "VIDEO", "SPEECH"] as const) {
      const choice = (record.choices as Record<string, unknown>)[capability];
      if (choice === undefined) continue;
      if (!isChoice(choice)) return EMPTY_MODEL_CENTER;
      choices[capability] = choice;
    }
    return { version: 1, choices };
  } catch {
    return EMPTY_MODEL_CENTER;
  }
}

export function getModelCenterSnapshot(): ModelCenterState {
  const storage = browserStorage();
  const raw = storage ? storage.getItem(MODEL_CENTER_KEY) : null;
  if (raw === cacheRaw && cacheRaw !== undefined) return cacheValue;
  cacheRaw = raw;
  cacheValue = parse(raw);
  return cacheValue;
}

export function subscribeModelCenter(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === MODEL_CENTER_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function emit(raw: string | null, value: ModelCenterState) {
  cacheRaw = raw;
  cacheValue = value;
  for (const listener of listeners) listener();
}

export function selectCenteredModel(
  capability: Capability,
  choice: CenterChoice | null,
  storage: Storage = window.localStorage,
): boolean {
  if (choice && !isChoice(choice)) return false;
  const current = parse(storage.getItem(MODEL_CENTER_KEY));
  const choices = { ...current.choices };
  if (choice) choices[capability] = choice;
  else delete choices[capability];
  const next: ModelCenterState = { version: 1, choices };
  try {
    const raw = JSON.stringify(next);
    storage.setItem(MODEL_CENTER_KEY, raw);
    if (storage === window.localStorage) emit(raw, next);
    else emit(storage.getItem(MODEL_CENTER_KEY), parse(storage.getItem(MODEL_CENTER_KEY)));
    return true;
  } catch {
    return false;
  }
}

export function choiceValue(choice: CenterChoice): string {
  if (choice.provider === "CHATGPT_OFFICIAL") return `chatgpt:${choice.modelId}`;
  if (choice.provider === "XAI_API") return `xai:${choice.modelId}`;
  return `connection:${choice.connectionId}:${choice.modelId}`;
}

export function parseChoiceValue(value: string): CenterChoice | null {
  if (value.startsWith("chatgpt:")) {
    const modelId = value.slice("chatgpt:".length);
    return isChoice({ provider: "CHATGPT_OFFICIAL", modelId })
      ? { provider: "CHATGPT_OFFICIAL", modelId }
      : null;
  }
  if (value.startsWith("xai:")) {
    const modelId = value.slice("xai:".length);
    return isChoice({ provider: "XAI_API", modelId }) ? { provider: "XAI_API", modelId } : null;
  }
  if (value.startsWith("connection:")) {
    const rest = value.slice("connection:".length);
    const split = rest.indexOf(":");
    if (split <= 0) return null;
    const choice = {
      provider: "CONNECTION" as const,
      connectionId: rest.slice(0, split),
      modelId: rest.slice(split + 1),
    };
    return isChoice(choice) ? choice : null;
  }
  return null;
}
