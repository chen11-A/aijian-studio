export type OfficialModelReference = {
  provider: "CHATGPT_OFFICIAL";
  profileId: string;
  modelSlug: string;
};
export type ModelPreference = {
  defaultModel: OfficialModelReference | null;
  projectOverrides: Record<string, OfficialModelReference>;
};
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export const MODEL_PREFERENCE_KEY = "aivora.official-model-preference.v1";

export const emptyModelPreference = (): ModelPreference => ({
  defaultModel: null,
  projectOverrides: {},
});
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const modelReference = (value: unknown): value is OfficialModelReference =>
  record(value) &&
  exactKeys(value, ["provider", "profileId", "modelSlug"]) &&
  value.provider === "CHATGPT_OFFICIAL" &&
  typeof value.profileId === "string" &&
  /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.profileId) &&
  typeof value.modelSlug === "string" &&
  value.modelSlug.length > 0 &&
  value.modelSlug.length <= 256 &&
  value.modelSlug.trim() === value.modelSlug;

function valid(value: unknown): value is ModelPreference & { version: 1 } {
  if (!record(value) || !exactKeys(value, ["version", "defaultModel", "projectOverrides"]))
    return false;
  if (value.version !== 1 || (value.defaultModel !== null && !modelReference(value.defaultModel)))
    return false;
  if (!record(value.projectOverrides) || Object.keys(value.projectOverrides).length > 100)
    return false;
  return Object.entries(value.projectOverrides).every(
    ([projectId, choice]) => /^prj_[a-f\d]{32}$/i.test(projectId) && modelReference(choice),
  );
}

export function readModelPreference(storage: PreferenceStorage): {
  value: ModelPreference;
  error: boolean;
} {
  try {
    const raw = storage.getItem(MODEL_PREFERENCE_KEY);
    if (raw === null) return { value: emptyModelPreference(), error: false };
    const parsed: unknown = JSON.parse(raw);
    if (!valid(parsed)) return { value: emptyModelPreference(), error: true };
    return {
      value: { defaultModel: parsed.defaultModel, projectOverrides: parsed.projectOverrides },
      error: false,
    };
  } catch {
    return { value: emptyModelPreference(), error: true };
  }
}
export function saveModelPreference(storage: PreferenceStorage, value: ModelPreference): boolean {
  const payload = { version: 1 as const, ...value };
  if (!valid(payload)) return false;
  try {
    storage.setItem(MODEL_PREFERENCE_KEY, JSON.stringify(payload));
    return storage.getItem(MODEL_PREFERENCE_KEY) === JSON.stringify(payload);
  } catch {
    return false;
  }
}
export function resolveModelPreference(
  value: ModelPreference,
  projectId: string,
  profileId: string | null,
  models: readonly string[],
): { modelSlug: string; source: "default" | "project" | "none"; verified: boolean } {
  const override = value.projectOverrides[projectId];
  const choice = override ?? value.defaultModel;
  if (!choice) return { modelSlug: "", source: "none", verified: false };
  return {
    modelSlug: choice.modelSlug,
    source: override ? "project" : "default",
    verified: profileId === choice.profileId && models.includes(choice.modelSlug),
  };
}
