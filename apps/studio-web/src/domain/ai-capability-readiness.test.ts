import { describe, expect, it } from "vitest";
import type { ChatGPTStatus } from "@aijian/contracts/chatgpt-auth";
import type { ProviderConnectionData } from "../api/studio";
import { DESKTOP_REQUIRED } from "../aivora/chatgpt-auth/transport";
import {
  assessCapabilities,
  assessChatGPTConnection,
  assessConfiguredConnection,
} from "./ai-capability-readiness";

const profile = { id: "fixture", label: "Fixture", email: null, connected: true, planUsage: true };
const authorized: ChatGPTStatus = {
  ...DESKTOP_REQUIRED,
  runtime: "DESKTOP",
  secureStorage: "AVAILABLE",
  state: "CONNECTED",
  activeProfileId: profile.id,
  profiles: [profile],
};
const xai: ProviderConnectionData = {
  id: "pcn_" + "1".repeat(32),
  display_name: "Grok API",
  provider_kind: "XAI",
  base_url: "https://api.x.ai/v1",
  enabled: true,
  credential_status: "CONFIGURED",
  revision: 1,
  models: [{ model_id: "fixture", capabilities: ["TEXT", "IMAGE", "VIDEO", "SPEECH"] }],
  created_at: "2026-10-10T00:00:00Z",
  updated_at: "2026-10-10T00:00:00Z",
};
const providers = (data: ProviderConnectionData[] = []) => ({
  kind: "ready" as const,
  response: { data, request_id: "req_fixture" },
});
const check = (status = authorized, extra = {}) =>
  assessChatGPTConnection({
    status,
    loading: false,
    busy: false,
    statusReadFailed: false,
    ...extra,
  });

describe("local capability evidence", () => {
  it("does not equate plan authorization or a liveVerified flag with real model validation", () => {
    expect(check()).toBe("AUTHORIZED_UNVERIFIED");
    expect(check({ ...authorized, liveVerified: true })).toBe("AUTHORIZED_UNVERIFIED");
    const rows = assessCapabilities(check(), providers());
    expect(rows[0].state).toBe("AUTHORIZED_UNVERIFIED");
    expect(rows.slice(1).map((row) => row.state)).toEqual(Array(3).fill("NOT_INTEGRATED"));
  });
  it.each([
    [{ loading: true }, "CHECKING"],
    [{ busy: true }, "CHECKING"],
    [{ statusReadFailed: true }, "UNKNOWN"],
  ])("invalidates old account readiness for %j", (extra, result) => {
    expect(check(authorized, extra)).toBe(result);
  });
  it.each([
    [{ runtime: "DESKTOP_REQUIRED" }, "DESKTOP_REQUIRED"],
    [{ secureStorage: "UNAVAILABLE" }, "CREDENTIAL_UNAVAILABLE"],
    [{ state: "AWAITING_BROWSER" }, "CHECKING"],
    [{ state: "REAUTH_REQUIRED" }, "REAUTH_REQUIRED"],
    [{ activeProfileId: null }, "DISCONNECTED"],
    [{ state: "IDENTITY_ONLY" }, "PLAN_REQUIRED"],
    [{ profiles: [{ ...profile, planUsage: false }] }, "PLAN_REQUIRED"],
    [{ state: "NOT_CONNECTED" }, "DISCONNECTED"],
  ] as const)("keeps auth state %j distinct", (patch, result) => {
    expect(check({ ...authorized, ...patch } as ChatGPTStatus)).toBe(result);
  });
  it.each([
    [{ enabled: false }, "DISABLED"],
    [{ credential_status: "UNAVAILABLE" }, "CREDENTIAL_UNAVAILABLE"],
    [{ credential_status: "MISSING" }, "CREDENTIAL_MISSING"],
    [{ models: [] }, "MODEL_MISSING"],
  ] as const)("excludes unusable API configuration %j", (patch, result) => {
    const connection = { ...xai, ...patch } as ProviderConnectionData;
    expect(assessConfiguredConnection(connection)).toBe(result);
    expect(
      assessCapabilities("DISCONNECTED", providers([connection]))[0].configuredSources,
    ).toEqual([]);
  });
  it("accepts keyless local Ollama only as unverified configuration", () => {
    expect(
      assessConfiguredConnection({ ...xai, provider_kind: "OLLAMA", credential_status: "MISSING" }),
    ).toBe("CONFIGURED_UNVERIFIED");
  });
  it("does not turn a Grok API record into a SuperGrok login or working media adapter", () => {
    const rows = assessCapabilities("DISCONNECTED", providers([xai]));
    expect(rows[0].state).toBe("CONFIGURED_UNVERIFIED");
    expect(rows[2]).toMatchObject({
      state: "NOT_INTEGRATED",
      configuredSources: [{ id: xai.id, label: "Grok API" }],
    });
  });
  it("keeps both GPT authorization and independently configured media sources visible", () => {
    const rows = assessCapabilities(check(), providers([xai]));
    expect(rows[0].state).toBe("AUTHORIZED_UNVERIFIED");
    expect(rows[2].configuredSources).toHaveLength(1);
    expect(rows[2].state).toBe("NOT_INTEGRATED");
  });
  it("does not collapse unread or failed directories into an empty account", () => {
    expect(assessCapabilities("DISCONNECTED", { kind: "error" })[0].state).toBe("UNKNOWN");
    expect(assessCapabilities("DISCONNECTED", { kind: "loading" })[0].state).toBe("UNKNOWN");
    expect(assessCapabilities("UNKNOWN", providers())[0].state).toBe("UNKNOWN");
    expect(assessCapabilities("CHECKING", providers())[0].state).toBe("UNKNOWN");
    expect(assessCapabilities("DISCONNECTED", providers())[0].state).toBe("MISSING");
  });
  it("does not infer undeclared capabilities from a model name", () => {
    const rows = assessCapabilities(
      "DISCONNECTED",
      providers([{ ...xai, models: [{ model_id: "grok-imagine-video", capabilities: ["TEXT"] }] }]),
    );
    expect(rows[2].configuredSources).toEqual([]);
  });
});
