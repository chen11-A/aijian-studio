import { describe, expect, it } from "vitest";
import {
  readModelPreference,
  saveModelPreference,
  resolveModelPreference,
  type ModelPreference,
} from "./modelPreference";

const profileId = "11111111-1111-4111-8111-111111111111";
const projectId = `prj_${"a".repeat(32)}`;
const selected = { provider: "CHATGPT_OFFICIAL" as const, profileId, modelSlug: "text-one" };

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
  };
}

describe("official model preference", () => {
  it("round trips a versioned non-secret default and explicit project override", () => {
    const store = storage();
    const value: ModelPreference = {
      defaultModel: selected,
      projectOverrides: { [projectId]: { ...selected, modelSlug: "text-two" } },
    };
    expect(saveModelPreference(store, value)).toBe(true);
    expect(readModelPreference(store)).toEqual({ value, error: false });
    expect(resolveModelPreference(value, projectId, profileId, ["text-one", "text-two"])).toEqual({
      modelSlug: "text-two",
      source: "project",
      verified: true,
    });
    expect(resolveModelPreference(value, "different", profileId, ["text-one"])).toEqual({
      modelSlug: "text-one",
      source: "default",
      verified: true,
    });
  });

  it("keeps saved choices pending until the matching account catalog is verified", () => {
    const value: ModelPreference = { defaultModel: selected, projectOverrides: {} };
    expect(resolveModelPreference(value, projectId, null, [])).toEqual({
      modelSlug: "text-one",
      source: "default",
      verified: false,
    });
    expect(resolveModelPreference(value, projectId, "other", ["text-one"]).verified).toBe(false);
    expect(resolveModelPreference(value, projectId, profileId, ["other"]).verified).toBe(false);
  });

  it("rejects malformed or secret-bearing persisted values and reports unavailable storage", () => {
    const broken = {
      getItem: () =>
        JSON.stringify({
          version: 1,
          defaultModel: selected,
          accessToken: "secret",
          projectOverrides: {},
        }),
      setItem: () => undefined,
    };
    expect(readModelPreference(broken)).toEqual({
      value: { defaultModel: null, projectOverrides: {} },
      error: true,
    });
    expect(
      saveModelPreference(
        {
          getItem: () => null,
          setItem: () => {
            throw Error("blocked");
          },
        },
        { defaultModel: selected, projectOverrides: {} },
      ),
    ).toBe(false);
  });
});
