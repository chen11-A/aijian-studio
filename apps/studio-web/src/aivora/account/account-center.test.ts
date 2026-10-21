import { afterEach, describe, expect, it } from "vitest";
import { connectedAccountSlots } from "./account-connections";
import {
  checkXaiApiKey,
  openXaiSandboxSession,
  readXaiSession,
  writeXaiSession,
  XAI_SESSION_KEY,
  xaiMembershipView,
} from "./xai-account";
import {
  choiceValue,
  getModelCenterSnapshot,
  parseChoiceValue,
  selectCenteredModel,
  subscribeModelCenter,
  MODEL_CENTER_KEY,
} from "./model-center";
import { openAivoraPage } from "./navigation";
import {
  sandboxCancel,
  sandboxMarkFailed,
  sandboxMarkUnknown,
  sandboxQuery,
  sandboxSubmit,
  sandboxVoiceResult,
} from "./sandbox-task";

const key = "xai-sandbox-test-key-value";

afterEach(() => window.localStorage.clear());

describe("xAI sandbox account", () => {
  it("rejects a password and never stores the full key", () => {
    expect(checkXaiApiKey("super-grok-password").ok).toBe(false);
    expect(checkXaiApiKey(" xai-key-value").ok).toBe(false);
    expect(checkXaiApiKey("xai-short").ok).toBe(false);
    expect(openXaiSandboxSession(key, key).ok).toBe(false);
    const opened = openXaiSandboxSession(key, "2026-10-21T00:00:00.000Z");
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(readXaiSession({ getItem: () => "not-json" })).toBeNull();
    expect(readXaiSession({ getItem: () => null })).toBeNull();
    expect(
      readXaiSession({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBeNull();
    expect(writeXaiSession({ setItem() {}, removeItem() {} }, null)).toBe(true);
    expect(
      writeXaiSession({ setItem() {}, removeItem() {} }, { ...opened.session, keyHint: "no" }),
    ).toBe(false);
    expect(
      writeXaiSession(
        {
          setItem() {
            throw new Error("full");
          },
          removeItem() {},
        },
        opened.session,
      ),
    ).toBe(false);
    expect(JSON.stringify(opened.session).includes(key)).toBe(false);
    expect(opened.session.keyHint).toBe("alue");
    expect(opened.session.liveProbe).toBe("not_performed");
    expect(opened.session.membership.balance).toBe("unknown");
    expect(opened.session.membership.consumerPlan).toBe("not_an_api_entitlement");
    expect(writeXaiSession(window.localStorage, opened.session)).toBe(true);
    expect(window.localStorage.getItem(XAI_SESSION_KEY)).not.toContain(key);
    expect(readXaiSession(window.localStorage)?.keyHint).toBe("alue");
  });

  it("describes prepaid credits without a zero balance", () => {
    const membership = xaiMembershipView();
    expect(membership.billingMethod).toBe("prepaid_credits");
    expect(membership.balance).not.toBe("0");
    expect(membership.budgetRelation).toContain("不预留");
    expect(membership.benefits.join(" ")).toContain("SuperGrok");
  });
});

describe("connected accounts", () => {
  it("lists ChatGPT plan models and keeps Grok subscription quota unavailable", () => {
    const opened = openXaiSandboxSession(key, "2026-10-21T00:00:00.000Z");
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const [chatgpt, grok] = connectedAccountSlots({
      chatgpt: {
        provider: "CHATGPT_OFFICIAL",
        runtime: "DESKTOP",
        state: "CONNECTED",
        useScope: "LOCAL_PERSONAL",
        secureStorage: "AVAILABLE",
        activeProfileId: "profile-1",
        profiles: [
          {
            id: "profile-1",
            label: "个人",
            email: "person@example.com",
            connected: true,
            planUsage: true,
          },
        ],
        lastError: null,
        liveVerified: false,
      },
      chatgptModels: [{ slug: "gpt-test", displayName: "GPT Test" }],
      xai: opened.session,
    });
    expect(chatgpt.method).toBe("官方 OAuth");
    expect(chatgpt.connected).toBe(true);
    expect(chatgpt.models.map((model) => model.id)).toEqual(["gpt-test"]);
    expect(chatgpt.quota).toContain("未知");
    expect(grok.method).toBe("官方 API Key");
    expect(grok.quota).toContain("不能使用 Grok 订阅额度");
    expect(grok.models.map((model) => model.id)).toEqual(["grok-4.7", "grok-imagine-image-2.0"]);
    expect(grok.difference).toContain("不预留");

    const [signedOut] = connectedAccountSlots({
      chatgpt: {
        provider: "CHATGPT_OFFICIAL",
        runtime: "DESKTOP",
        state: "IDENTITY_ONLY",
        useScope: "LOCAL_PERSONAL",
        secureStorage: "AVAILABLE",
        activeProfileId: "profile-1",
        profiles: [
          {
            id: "profile-1",
            label: "个人",
            email: "person@example.com",
            connected: true,
            planUsage: false,
          },
        ],
        lastError: null,
        liveVerified: false,
      },
      chatgptModels: [{ slug: "gpt-test", displayName: "GPT Test" }],
    });
    expect(signedOut.connected).toBe(false);
    expect(signedOut.models).toEqual([]);
    expect(signedOut.quota).toContain("套餐未授权");

    const base = signedOut && {
      provider: "CHATGPT_OFFICIAL" as const,
      runtime: "DESKTOP" as const,
      useScope: "LOCAL_PERSONAL" as const,
      secureStorage: "AVAILABLE" as const,
      activeProfileId: null,
      profiles: [],
      lastError: null,
      liveVerified: false,
      state: "NOT_CONNECTED" as const,
    };
    const waiting = connectedAccountSlots({
      chatgpt: { ...base, state: "AWAITING_BROWSER" },
      chatgptLoading: false,
    })[0];
    const again = connectedAccountSlots({
      chatgpt: { ...base, state: "REAUTH_REQUIRED" },
    })[0];
    const loading = connectedAccountSlots({ chatgpt: base, chatgptLoading: true })[0];
    const preview = connectedAccountSlots({})[0];
    const nameless = connectedAccountSlots({
      chatgpt: {
        ...base,
        state: "CONNECTED",
        activeProfileId: "profile-1",
        profiles: [
          { id: "profile-1", label: "个人", email: null, connected: true, planUsage: true },
        ],
      },
      chatgptModels: [{ slug: "gpt-test", displayName: "GPT Test" }],
    })[0];
    expect(waiting.state).toContain("等待浏览器");
    expect(again.quota).toContain("未知");
    expect(loading.state).toBe("正在读取");
    expect(preview.state).toContain("桌面");
    expect(nameless.state).toBe("已连接");
    expect(connectedAccountSlots({ xai: null })[1].connected).toBe(false);
  });
});

describe("model center", () => {
  it("keeps one choice per capability and drops an invalid write", () => {
    expect(selectCenteredModel("TEXT", { provider: "XAI_API", modelId: "grok-4.7" })).toBe(true);
    expect(
      selectCenteredModel("IMAGE", {
        provider: "XAI_API",
        modelId: "grok-imagine-image-2.0",
      }),
    ).toBe(true);
    expect(selectCenteredModel("TEXT", { provider: "XAI_API", modelId: "bad id" })).toBe(false);
    expect(getModelCenterSnapshot().choices.TEXT?.modelId).toBe("grok-4.7");
    expect(getModelCenterSnapshot().choices.IMAGE?.modelId).toBe("grok-imagine-image-2.0");
    selectCenteredModel("TEXT", null);
    expect(getModelCenterSnapshot().choices.TEXT).toBeUndefined();
  });

  it("parses stored choices and ignores a broken store", () => {
    const choice = { provider: "CONNECTION" as const, connectionId: "conn-1", modelId: "text-1" };
    expect(choiceValue(choice)).toBe("connection:conn-1:text-1");
    expect(parseChoiceValue("connection:conn-1:text-1")).toEqual(choice);
    expect(parseChoiceValue("connection:")).toBeNull();
    expect(parseChoiceValue("connection:only")).toBeNull();
    expect(parseChoiceValue("nope")).toBeNull();
    expect(parseChoiceValue("chatgpt:bad id")).toBeNull();
    window.localStorage.setItem(MODEL_CENTER_KEY, "not-json");
    expect(getModelCenterSnapshot().choices).toEqual({});
    window.localStorage.setItem(
      MODEL_CENTER_KEY,
      JSON.stringify({
        version: 2,
        choices: { TEXT: { provider: "XAI_API", modelId: "grok-4.7" } },
      }),
    );
    expect(getModelCenterSnapshot().choices).toEqual({});
    window.localStorage.setItem(
      MODEL_CENTER_KEY,
      JSON.stringify({ version: 1, choices: { TEXT: { provider: "XAI_API", modelId: "bad id" } } }),
    );
    expect(getModelCenterSnapshot().choices).toEqual({});
    window.localStorage.setItem(MODEL_CENTER_KEY, JSON.stringify({ version: 1, choices: {} }));
    expect(getModelCenterSnapshot().version).toBe(1);
    const memory = new Map<string, string>();
    const storage = {
      getItem: (name: string) => memory.get(name) ?? null,
      setItem: (name: string, value: string) => memory.set(name, value),
      removeItem: (name: string) => memory.delete(name),
    } as unknown as Storage;
    expect(selectCenteredModel("TEXT", { provider: "XAI_API", modelId: "grok-4.7" }, storage)).toBe(
      true,
    );
    expect(storage.getItem(MODEL_CENTER_KEY)).toContain("grok-4.7");
    const blocked = {
      getItem: () => null,
      setItem() {
        throw new Error("full");
      },
      removeItem() {},
    } as unknown as Storage;
    expect(selectCenteredModel("TEXT", { provider: "XAI_API", modelId: "grok-4.7" }, blocked)).toBe(
      false,
    );
    const seen = { calls: 0 };
    const stop = subscribeModelCenter(() => {
      seen.calls += 1;
    });
    window.dispatchEvent(new StorageEvent("storage", { key: MODEL_CENTER_KEY }));
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key: MODEL_CENTER_KEY }));
    expect(seen.calls).toBe(1);
    const heard = { page: "" };
    const onPage = (event: Event) => {
      heard.page = String((event as CustomEvent).detail);
    };
    window.addEventListener("aivora-open-page", onPage);
    openAivoraPage("services");
    window.removeEventListener("aivora-open-page", onPage);
    expect(heard.page).toBe("services");
  });
});

describe("sandbox task and voice", () => {
  it("walks submit, query, unknown and cancel without a second submit", () => {
    const queued = sandboxSubmit(null, "sandbox-1");
    expect(queued.status).toBe("queued");
    expect(sandboxSubmit(queued, "sandbox-2").id).toBe("sandbox-1");
    const running = sandboxQuery(queued);
    expect(running.status).toBe("running");
    const unknown = sandboxMarkUnknown(running);
    expect(unknown.status).toBe("unknown");
    expect(sandboxQuery(unknown).note).toContain("不会自动重试");
    expect(sandboxCancel(unknown).status).toBe("unknown");
    const candidate = sandboxQuery(running);
    expect(candidate.status).toBe("candidate");
    expect(candidate.note).toContain("没有媒体文件");
    expect(sandboxQuery(null).status).toBe("idle");
    expect(sandboxCancel(null).note).toContain("没有可取消");
    expect(sandboxCancel(candidate).note).toContain("不能再取消");
    const failed = sandboxMarkFailed(queued);
    expect(failed.status).toBe("failed");
    expect(sandboxMarkFailed(null).status).toBe("idle");
    expect(sandboxMarkUnknown(null).status).toBe("idle");
    expect(sandboxMarkUnknown(queued).status).toBe("queued");
    expect(sandboxQuery(sandboxCancel(queued)).note).toContain("沙箱任务已取消");
  });

  it("refuses voice playback without consent or a file", () => {
    expect(sandboxVoiceResult({ line: "你好", consent: false, action: "generate" })).toContain(
      "声线使用同意",
    );
    expect(sandboxVoiceResult({ line: "你好", consent: true, action: "audition" })).toContain(
      "没有音频文件",
    );
    expect(sandboxVoiceResult({ line: "你好", consent: true, action: "generate" })).toContain(
      "未生成文件",
    );
    expect(sandboxVoiceResult({ line: "  ", consent: true, action: "audition" })).toContain(
      "请先填写对白",
    );
  });
});
