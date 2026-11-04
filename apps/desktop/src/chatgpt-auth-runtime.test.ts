import { describe, expect, it, vi } from "vitest";
import type { AuthData } from "./chatgpt-auth-storage";
import { createChatGPTRuntime } from "./chatgpt-auth-runtime";
import { fixtureFetch, json } from "./chatgpt-auth-test-fixture";
function setup(confirmed = true) {
  let saved: AuthData | null = null;
  const writes: AuthData[] = [];
  const store = {
    available: vi.fn(() => true),
    read: vi.fn(async () => saved),
    write: vi.fn(async (value: AuthData) => {
      saved = structuredClone(value);
      writes.push(saved);
    }),
  };
  const fetcher = fixtureFetch();
  const confirm = vi.fn(async () => confirmed);
  const authorize = vi.fn<NonNullable<Parameters<typeof createChatGPTRuntime>[0]["authorize"]>>(
    async () => ({
      clientId: "oaiapp_fixture",
      code: "fixture-code",
      verifier: "fixture-verifier",
      nonce: "fixture-nonce",
      redirectUri: "http://127.0.0.1:12345/auth/callback",
    }),
  );
  const confirmText = vi.fn(async () => confirmed);
  const runtime = createChatGPTRuntime({
    store,
    fetch: fetcher,
    confirmSignIn: confirm,
    confirmText,
    openBrowser: vi.fn(),
    authorize,
  });
  return { store, writes, runtime, fetcher, confirm, authorize, confirmText };
}
describe("official desktop account lifecycle using local fixtures only", () => {
  it("clears a model read error after recovery without claiming inference", async () => {
    const { runtime, fetcher } = setup();
    await runtime.signIn("LOCAL_PERSONAL");
    fetcher.mockResolvedValueOnce(new Response("private upstream body", { status: 403 }));
    expect(await runtime.models()).toMatchObject({ kind: "ERROR", code: "OPENAI_REQUEST_FAILED" });
    expect((await runtime.status()).lastError).toBe("OPENAI_REQUEST_FAILED");
    expect(await runtime.models()).toMatchObject({ kind: "OK" });
    expect(await runtime.status()).toMatchObject({
      state: "CONNECTED",
      lastError: null,
      liveVerified: false,
    });
  });
  it("status restores only protected local metadata and never contacts OpenAI", async () => {
    const { runtime, fetcher, authorize, store } = setup();
    expect(await runtime.status()).toMatchObject({
      state: "NOT_CONNECTED",
      profiles: [],
      liveVerified: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });
  it("does not create host, register, persist or fetch when native consent is declined", async () => {
    const { runtime, fetcher, authorize, store } = setup(false);
    expect((await runtime.signIn("LOCAL_PERSONAL")).kind).toBe("CANCELLED");
    expect(store.write).not.toHaveBeenCalled();
    expect(store.read).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });
  it("fails closed without secure storage", async () => {
    const { runtime, store, confirm } = setup();
    store.available.mockReturnValue(false);
    expect(await runtime.signIn("LOCAL_PERSONAL")).toMatchObject({
      kind: "ERROR",
      code: "SECURE_STORAGE_UNAVAILABLE",
    });
    expect(confirm).not.toHaveBeenCalled();
  });
  it("retains issued registration before exchange and exposes no credentials", async () => {
    const { runtime, writes, fetcher } = setup();
    expect(await runtime.signIn("LOCAL_PERSONAL")).toMatchObject({
      kind: "OK",
      status: { state: "CONNECTED", liveVerified: false },
    });
    expect(writes[0]?.profiles).toEqual([]);
    expect(writes[1]?.profiles[0]).toMatchObject({ clientId: "oaiapp_fixture", tokens: null });
    const status = await runtime.status();
    expect(JSON.stringify(status)).not.toMatch(
      /fixture-access|fixture-refresh|idToken|accessToken|clientId|nonce|verifier/,
    );
    expect(status.profiles[0]?.email).toBe("fixture@example.test");
    expect(await runtime.models()).toEqual({
      kind: "OK",
      profileId: status.activeProfileId,
      models: [{ slug: "fixture-text", displayName: "Fixture text" }],
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("backend-api"))).toBe(false);
  });
  it("clears local credentials and retains registration on sign out", async () => {
    const { runtime, writes } = setup();
    await runtime.signIn("LOCAL_PERSONAL");
    expect(await runtime.signOut()).toMatchObject({
      kind: "OK",
      status: { state: "NOT_CONNECTED" },
    });
    expect(writes.at(-1)?.profiles[0]).toMatchObject({ clientId: "oaiapp_fixture", tokens: null });
    expect(await runtime.models()).toEqual({ kind: "ERROR", code: "PLAN_USAGE_NOT_AUTHORIZED" });
  });
  it("reports remote revocation uncertainty separately from local sign out", async () => {
    const { runtime, fetcher } = setup();
    await runtime.signIn("LOCAL_PERSONAL");
    fetcher.mockRejectedValue(new Error("fixture unavailable"));
    expect(await runtime.signOut()).toMatchObject({
      kind: "OK",
      status: { state: "NOT_CONNECTED", lastError: "REMOTE_REVOCATION_UNCONFIRMED" },
    });
  });
  it("deduplicates and cancels pending native/browser authorization", async () => {
    const { runtime, confirm, fetcher, authorize } = setup();
    let finish: (value: boolean) => void = () => undefined;
    confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = runtime.signIn("LOCAL_PERSONAL");
    expect(await runtime.signIn("LOCAL_PERSONAL")).toMatchObject({
      kind: "ERROR",
      code: "OPERATION_IN_PROGRESS",
    });
    await runtime.cancel();
    finish(true);
    expect((await first).kind).toBe("CANCELLED");
    expect(fetcher).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });
  it("retains a registration after lost exchange, without claiming connection", async () => {
    const { runtime, fetcher, writes } = setup();
    fetcher.mockRejectedValue(new Error("lost reply"));
    expect(await runtime.signIn("LOCAL_PERSONAL")).toMatchObject({
      kind: "ERROR",
      status: { state: "NOT_CONNECTED" },
    });
    expect(writes.at(-1)?.profiles[0]?.clientId).toBe("oaiapp_fixture");
    expect(writes.at(-1)?.profiles[0]?.tokens).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

const generationInput = {
  operationId: "11111111-1111-4111-8111-111111111111",
  model: "fixture-text",
  text: "A short fixture script",
  approvalContext: "Fixture project / episode",
};
async function selectedInput(runtime: ReturnType<typeof createChatGPTRuntime>) {
  const expectedProfileId = (await runtime.status()).activeProfileId;
  if (!expectedProfileId) throw new Error("fixture missing selected account");
  return { ...generationInput, expectedProfileId };
}
function completionStream() {
  return new Response(
    `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_fixture", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Completed fixture script" }] }] } })}\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
describe("main-only generation and durable reservation", () => {
  it("approves exact input, reserves before HTTP, and returns trusted provenance once", async () => {
    const { runtime, fetcher, confirmText } = setup();
    await runtime.signIn("LOCAL_PERSONAL");
    const selected = await selectedInput(runtime);
    let reserved = false;
    const original = fetcher.getMockImplementation();
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/responses")) {
        expect(reserved).toBe(true);
        return completionStream();
      }
      if (!original) throw new Error("missing fixture");
      return original(url, init);
    });
    const beforeSend = vi.fn(async (metadata) => {
      expect(metadata.requestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      reserved = true;
    });
    const result = await runtime.generateText(selected, { beforeSend });
    expect(result).toMatchObject({
      kind: "COMPLETED",
      operationId: generationInput.operationId,
      model: "fixture-text",
      text: "Completed fixture script",
    });
    expect(confirmText).toHaveBeenCalledExactlyOnceWith({
      ...selected,
      profileLabel: "fixture@example.test",
      modelLabel: "Fixture text",
    });
    expect(await runtime.generateText(selected, { beforeSend })).toEqual(result);
    expect(beforeSend).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/responses"))).toHaveLength(
      1,
    );
    expect(
      await runtime.generateText({ ...selected, text: "changed" }, { beforeSend }),
    ).toMatchObject({ kind: "NOT_SENT", code: "OPERATION_MISMATCH" });
  });
  it("does not reserve or infer when native request approval is declined", async () => {
    const { runtime, fetcher, confirmText } = setup();
    await runtime.signIn("LOCAL_PERSONAL");
    const selected = await selectedInput(runtime);
    confirmText.mockResolvedValue(false);
    const beforeSend = vi.fn();
    expect(await runtime.generateText(selected, { beforeSend })).toMatchObject({
      kind: "NOT_SENT",
      code: "REQUEST_NOT_APPROVED",
    });
    expect(beforeSend).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/responses"))).toBe(false);
  });
  it("fails without remote send when durable reservation cannot be confirmed", async () => {
    const { runtime, fetcher } = setup();
    await runtime.signIn("LOCAL_PERSONAL");
    const selected = await selectedInput(runtime);
    const beforeSend = vi.fn(async () => {
      throw new Error("fixture ledger unavailable");
    });
    expect(await runtime.generateText(selected, { beforeSend })).toMatchObject({
      kind: "NOT_SENT",
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/responses"))).toBe(false);
  });
  it("retains unknown remote outcome after a dropped inference without retry", async () => {
    const { runtime, fetcher } = setup();
    await runtime.signIn("LOCAL_PERSONAL");
    const selected = await selectedInput(runtime);
    const original = fetcher.getMockImplementation();
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/responses")) throw new Error("fixture dropped after send");
      if (!original) throw new Error("missing fixture");
      return original(url, init);
    });
    const beforeSend = vi.fn(async () => undefined);
    expect(await runtime.generateText(selected, { beforeSend })).toMatchObject({
      kind: "REMOTE_UNKNOWN",
    });
    expect(await runtime.generateText(selected, { beforeSend })).toMatchObject({
      kind: "REMOTE_UNKNOWN",
    });
    expect(beforeSend).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/responses"))).toHaveLength(
      1,
    );
  });
});

it("preserves existing account during reauthorization, rejects mismatches and supports selection", async () => {
  const { runtime, authorize, store, writes } = setup();
  await runtime.signIn("LOCAL_PERSONAL");
  const status = await runtime.status();
  const id = status.activeProfileId;
  if (!id) throw new Error("fixture missing profile");
  expect(await runtime.selectProfile("missing")).toMatchObject({
    kind: "ERROR",
    code: "PROFILE_NOT_FOUND",
  });
  expect(await runtime.selectProfile(id)).toMatchObject({ kind: "OK" });
  expect(await runtime.signIn("LOCAL_PERSONAL", id)).toMatchObject({ kind: "OK" });
  expect(authorize.mock.calls.length).toBe(2);
  expect(writes.at(-1)?.profiles).toHaveLength(1);
  expect(await runtime.signIn("LOCAL_PERSONAL", "missing")).toMatchObject({
    kind: "ERROR",
    code: "PROFILE_NOT_FOUND",
  });
  expect(await runtime.signIn("LOCAL_PERSONAL", null)).toMatchObject({
    kind: "ERROR",
    code: "REGISTRATION_MISMATCH",
  });
  store.write.mockRejectedValueOnce(new Error("fixture write error"));
  expect(await runtime.selectProfile(id)).toMatchObject({ kind: "ERROR" });
  expect((await runtime.status()).activeProfileId).toBe(id);
});
it("returns to not-connected when protected token write fails", async () => {
  const { runtime, store } = setup();
  store.write.mockImplementation(async (data) => {
    if (data.profiles.some((profile) => profile.tokens))
      throw new Error("fixture secure write failed");
  });
  expect(await runtime.signIn("LOCAL_PERSONAL")).toMatchObject({
    kind: "ERROR",
    status: { state: "NOT_CONNECTED" },
  });
});
it("recovers a local status read failure without a remote request", async () => {
  const { runtime, store, fetcher } = setup();
  store.read.mockRejectedValueOnce(new Error("fixture read failed"));
  expect((await runtime.status()).lastError).toBe("CONNECTION_UNAVAILABLE");
  expect((await runtime.status()).state).toBe("NOT_CONNECTED");
  expect(store.read).toHaveBeenCalledTimes(2);
  expect(fetcher).not.toHaveBeenCalled();
});
it("blocks all other mutable operations while the native login dialog is pending", async () => {
  const { runtime, confirm } = setup();
  let finish: (value: boolean) => void = () => undefined;
  confirm.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = runtime.signIn("LOCAL_PERSONAL");
  expect((await runtime.status()).state).toBe("AWAITING_BROWSER");
  expect(await runtime.signOut()).toMatchObject({ code: "OPERATION_IN_PROGRESS" });
  expect(await runtime.selectProfile("id")).toMatchObject({ code: "OPERATION_IN_PROGRESS" });
  expect(await runtime.models()).toMatchObject({ code: "OPERATION_IN_PROGRESS" });
  expect(await runtime.generateText(generationInput, { beforeSend: vi.fn() })).toMatchObject({
    kind: "NOT_SENT",
    code: "OPERATION_IN_PROGRESS",
  });
  finish(false);
  await pending;
});
it("binds a pending model response to the requesting account and blocks account changes", async () => {
  const { runtime, fetcher } = setup();
  await runtime.signIn("LOCAL_PERSONAL");
  const profileId = (await runtime.status()).activeProfileId;
  if (!profileId) throw new Error("fixture missing active profile");
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = runtime.models();
  await vi.waitFor(() =>
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/models"))).toBe(true),
  );
  expect(await runtime.selectProfile(profileId)).toMatchObject({ code: "OPERATION_IN_PROGRESS" });
  expect(await runtime.signOut()).toMatchObject({ code: "OPERATION_IN_PROGRESS" });
  finish(
    json({ models: [{ slug: "fixture-text", display_name: "Fixture text", visibility: "list" }] }),
  );
  expect(await pending).toEqual({
    kind: "OK",
    profileId,
    models: [{ slug: "fixture-text", displayName: "Fixture text" }],
  });
});
it("rejects a changed selected account before catalog or inference", async () => {
  const { runtime, fetcher } = setup();
  await runtime.signIn("LOCAL_PERSONAL");
  const previousFetches = fetcher.mock.calls.length;
  expect(await runtime.generateText(generationInput, { beforeSend: vi.fn() })).toMatchObject({
    kind: "NOT_SENT",
    code: "ACCOUNT_SELECTION_REQUIRED",
  });
  const result = await runtime.generateText(
    { ...generationInput, expectedProfileId: "22222222-2222-4222-8222-222222222222" },
    { beforeSend: vi.fn() },
  );
  expect(result).toMatchObject({ kind: "NOT_SENT", code: "ACCOUNT_MISMATCH" });
  expect(fetcher).toHaveBeenCalledTimes(previousFetches);
});
it("refreshes expired credentials atomically and never retries uncertain rotation", async () => {
  const seed = setup();
  await seed.runtime.signIn("LOCAL_PERSONAL");
  const stored = seed.writes.at(-1);
  if (!stored?.profiles[0]?.tokens) throw new Error("fixture missing tokens");
  stored.profiles[0].tokens.expiresAt = 0;
  const fetcher = fixtureFetch();
  const store = {
    available: () => true,
    read: vi.fn(async () => structuredClone(stored)),
    write: vi.fn(async () => undefined),
  };
  const runtime = createChatGPTRuntime({
    store,
    fetch: fetcher,
    confirmSignIn: vi.fn(),
    openBrowser: vi.fn(),
  });
  await runtime.status();
  expect(await runtime.models()).toMatchObject({ kind: "OK" });
  expect(store.write).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain("grant_type=refresh_token");
  const failing = createChatGPTRuntime({
    store,
    fetch: vi.fn(async () => {
      throw new Error("uncertain refresh");
    }),
    confirmSignIn: vi.fn(),
    openBrowser: vi.fn(),
  });
  await failing.status();
  expect((await failing.models()).kind).toBe("ERROR");
  expect((await failing.status()).state).toBe("REAUTH_REQUIRED");
  expect(await failing.models()).toMatchObject({ code: "PLAN_USAGE_NOT_AUTHORIZED" });
});
it("requires reauthorization when an expired profile has no refresh token", async () => {
  const seed = setup();
  await seed.runtime.signIn("LOCAL_PERSONAL");
  const stored = seed.writes.at(-1);
  if (!stored?.profiles[0]?.tokens) throw new Error("fixture missing tokens");
  stored.profiles[0].tokens.expiresAt = 0;
  stored.profiles[0].tokens.refreshToken = null;
  const runtime = createChatGPTRuntime({
    store: { available: () => true, read: async () => stored, write: vi.fn() },
    fetch: fixtureFetch(),
    confirmSignIn: vi.fn(),
    openBrowser: vi.fn(),
  });
  await runtime.status();
  expect(await runtime.models()).toMatchObject({ code: "REAUTH_REQUIRED" });
  expect(await runtime.models()).toMatchObject({ code: "REAUTH_REQUIRED" });
  expect(await runtime.signOut()).toMatchObject({ kind: "OK", status: { state: "NOT_CONNECTED" } });
});

it("distinguishes authorization timeout from explicit cancellation without contacting OpenAI", async () => {
  vi.useFakeTimers();
  try {
    const { runtime, authorize, fetcher } = setup();
    authorize.mockImplementation(
      async (_input, _open, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("fixture aborted")), {
            once: true,
          });
        }),
    );
    const pending = runtime.signIn("LOCAL_PERSONAL");
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(await pending).toMatchObject({
      kind: "ERROR",
      code: "AUTH_ATTEMPT_EXPIRED",
      status: { state: "NOT_CONNECTED" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the approved command immutable while reporting main-only provider response ID", async () => {
  const { runtime, fetcher, confirmText } = setup();
  await runtime.signIn("LOCAL_PERSONAL");
  const original = fetcher.getMockImplementation();
  fetcher.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/responses")) {
      expect(JSON.parse(String(init?.body)).input[0].content).toBe(generationInput.text);
      return completionStream();
    }
    if (!original) throw new Error("Missing fixture");
    return original(url, init);
  });
  const command = await selectedInput(runtime);
  confirmText.mockImplementation(async () => {
    command.text = "Changed after approval opened";
    return true;
  });
  expect(await runtime.generateText(command, { beforeSend: vi.fn() })).toMatchObject({
    kind: "COMPLETED",
    responseId: "resp_fixture",
  });
});
it("director raw mode retains empty completed output for backend admission and leaves old callers strict", async () => {
  const { runtime, fetcher } = setup();
  await runtime.signIn("LOCAL_PERSONAL");
  const selected = await selectedInput(runtime);
  const original = fetcher.getMockImplementation();
  fetcher.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/responses"))
      return new Response(
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_fixture_empty", status: "completed", output: [] } })}\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    if (!original) throw new Error("Missing fixture");
    return original(url, init);
  });
  expect(
    await runtime.generateText(selected, { beforeSend: vi.fn(), allowEmptyOutput: true }),
  ).toMatchObject({ kind: "COMPLETED", text: "", responseId: "resp_fixture_empty" });
  expect(
    await runtime.generateText(
      { ...selected, operationId: "22222222-2222-4222-8222-222222222222" },
      { beforeSend: vi.fn() },
    ),
  ).toMatchObject({ kind: "REMOTE_UNKNOWN", code: "INFERENCE_EMPTY" });
});

it.each(["approval", "reservation"] as const)(
  "blocks a profile lifecycle change after %s before any provider request",
  async (phase) => {
    const { runtime, store, fetcher, confirmText } = setup();
    await runtime.signIn("LOCAL_PERSONAL");
    const selected = await selectedInput(runtime);
    const internal = store.write.mock.lastCall?.[0];
    if (!internal) throw new Error("Missing synthetic protected account");
    const change = () => {
      internal.activeId = null;
    };
    if (phase === "approval")
      confirmText.mockImplementation(async () => {
        change();
        return true;
      });
    const beforeSend = vi.fn(async (metadata) => {
      expect(Object.isFrozen(metadata)).toBe(true);
      if (phase === "reservation") change();
    });
    expect(await runtime.generateText(selected, { beforeSend })).toMatchObject({
      kind: "NOT_SENT",
      code: "GENERATION_SESSION_CHANGED",
    });
    expect(beforeSend).toHaveBeenCalledTimes(phase === "approval" ? 0 : 1);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/responses"))).toBe(false);
  },
);
