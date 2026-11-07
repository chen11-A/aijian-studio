import { generationFailurePolicy, storyCreationFailurePolicy } from "./generation-failure-policy";
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { attestGenerationAccount, stableGenerationAccount } from "./generation-dispatch-account";
import { registerStoryFilmHandlers } from "./story-film-ipc";

const session = { origin: "http://127.0.0.1:56121", token: "s".repeat(43) };
const project = `prj_${"b".repeat(32)}`;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");

describe("main-owned generation identity and failure configuration", () => {
  it("uses stable subject/endpoint, never a refresh token or changing scope revision", () => {
    expect(stableGenerationAccount("unknown", "https://api.x.ai")).toBeNull();
    expect(stableGenerationAccount("", "https://api.x.ai")).toBeNull();
    expect(stableGenerationAccount("subject", "https://api.x.ai")).toBe(
      stableGenerationAccount("subject", "https://api.x.ai"),
    );
    expect(stableGenerationAccount("subject", "https://api.x.ai/v1")).toBe(
      stableGenerationAccount("subject", "https://api.x.ai/"),
    );
    expect(stableGenerationAccount("other", "https://api.x.ai")).not.toBe(
      stableGenerationAccount("subject", "https://api.x.ai"),
    );
    expect(stableGenerationAccount("subject", "https://different.example")).not.toBe(
      stableGenerationAccount("subject", "https://api.x.ai"),
    );
  });

  it("attests exact wire bytes, bearer and attempt without exposing the account to renderer", async () => {
    const account = { bearer: "private-current-access-token", accountSha256: "a".repeat(64) };
    const calls: RequestInit[] = [];
    const fetcher = vi.fn(async (_input, init) => {
      calls.push(init);
      return new Response(
        JSON.stringify({ data: { status: "BLOCKED", message: "设置预算" }, request_id: "r" }),
      );
    }) as unknown as typeof fetch;
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    registerStoryFilmHandlers<boolean>(
      (channel, callback) => handlers.set(channel, callback),
      (event) => event,
      () => session,
      async () => account,
      fetcher,
    );
    const result = await handlers.get("story-film:create")?.(true, project, {
      scene_label: "一场",
      narration: "一句",
      provider: "grok_subscription",
      confirmed: false,
    });
    const request = calls[0]!;
    const headers = request.headers as Record<string, string>;
    const assertion = JSON.parse(
      Buffer.from(headers["X-Aivora-Generation-Account"]!, "base64url").toString(),
    );
    const message = [
      "aivora-video-account-v1",
      project,
      headers["Idempotency-Key"],
      hash(request.body as string),
      hash(account.bearer),
      account.accountSha256,
      String(assertion.expires),
    ].join("\n");
    expect(assertion.signature).toBe(
      createHmac("sha256", session.token).update(message).digest("hex"),
    );
    expect(headers["X-Aivora-Media-Bearer"]).toBe(account.bearer);
    expect(JSON.stringify(result)).not.toContain(account.bearer);
    expect(JSON.stringify(result)).not.toContain(account.accountSha256);
    expect(() =>
      attestGenerationAccount({
        sessionKey: session.token,
        projectId: project,
        idempotencyKey: "attempt",
        body: "{}",
        account: { ...account, accountSha256: "forged" },
      }),
    ).toThrow();
  });

  it("configures only an explicit strict limit/revision through authorized main frame", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            state: "CONFIGURED",
            revision: 1,
            failure_limit: 2,
            scope: "GROK_VIDEO_SUBMIT_FAILURES",
          }),
        ),
    ) as unknown as typeof fetch;
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    registerStoryFilmHandlers<boolean>(
      (channel, callback) => handlers.set(channel, callback),
      (event) => event,
      () => session,
      async () => null,
      fetcher,
    );
    const configure = handlers.get("story-film:configure-failure-policy")!;
    await expect(
      configure(false, project, { expected_revision: 0, failure_limit: 2 }),
    ).rejects.toThrow("authorized");
    for (const value of [
      { expected_revision: 0, failure_limit: true },
      { expected_revision: 0, failure_limit: -1 },
      { expected_revision: 0, failure_limit: 1, account: "forged" },
      { expected_revision: 0.1, failure_limit: 1 },
    ])
      await expect(configure(true, project, value)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await configure(true, project, { expected_revision: 0, failure_limit: 2 }),
    ).toMatchObject({ kind: "POLICY", policy: { failure_limit: 2 } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

it("preserves unknown config writes and never guesses success from malformed readback", async () => {
  const update = { expected_revision: 0, failure_limit: 1 };
  const network = vi.fn(async () => {
    throw new Error("private-path-and-token");
  }) as unknown as typeof fetch;
  expect(await generationFailurePolicy(network, session, project, update)).toEqual({
    kind: "FAILED",
    code: "WRITE_UNCONFIRMED",
  });
  expect(await generationFailurePolicy(network, session, project)).toEqual({
    kind: "FAILED",
    code: "UNAVAILABLE",
  });
  const conflict = vi.fn(
    async () => new Response("private response", { status: 409 }),
  ) as unknown as typeof fetch;
  expect(await generationFailurePolicy(conflict, session, project, update)).toEqual({
    kind: "FAILED",
    code: "POLICY_CHANGED",
  });
  const malformed = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          state: "CONFIGURED",
          revision: 1,
          failure_limit: 1,
          scope: "GROK_VIDEO_SUBMIT_FAILURES",
          usage: "fabricated",
        }),
      ),
  ) as unknown as typeof fetch;
  expect(await generationFailurePolicy(malformed, session, project, update)).toEqual({
    kind: "FAILED",
    code: "WRITE_UNCONFIRMED",
  });
  expect(network).toHaveBeenCalledTimes(2);
});

it.each([
  { state: "CONFIGURED", revision: 3, failure_limit: 2 },
  { state: "CONFIGURED", revision: 4, failure_limit: 1 },
  { state: "UNCONFIGURED", revision: 0, failure_limit: null },
])("does not call a shape-valid wrong PUT acknowledgement saved", async (policy) => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ ...policy, scope: "GROK_VIDEO_SUBMIT_FAILURES" })),
  ) as unknown as typeof fetch;
  expect(
    await generationFailurePolicy(fetcher, session, project, {
      expected_revision: 3,
      failure_limit: 2,
    }),
  ).toEqual({ kind: "FAILED", code: "WRITE_UNCONFIRMED" });
  expect(fetcher).toHaveBeenCalledOnce();
  // A fresh explicit GET may reveal a different current setting without making
  // the old PUT successful, and no automatic second PUT is ever issued.
  expect(await generationFailurePolicy(fetcher, session, project)).toMatchObject({
    kind: "POLICY",
    policy,
  });
});

it("keeps the parent scope separate and validates its exact config ACK through main", async () => {
  const update = { expected_revision: 3, failure_limit: 0 };
  const valid = {
    state: "CONFIGURED",
    revision: 4,
    failure_limit: 0,
    scope: "GROK_STORY_CREATION_FAILURES",
  };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(valid))) as unknown as typeof fetch;
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  registerStoryFilmHandlers<boolean>(
    (channel, fn) => handlers.set(channel, fn),
    (event) => event,
    () => session,
    async () => null,
    fetcher,
  );
  const configure = handlers.get("story-film:configure-creation-failure-policy")!;
  await expect(configure(false, project, update)).rejects.toThrow("authorized");
  await expect(configure(true, project, { ...update, scope: "forged" })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  expect(await configure(true, project, update)).toEqual({ kind: "POLICY", policy: valid });
  expect(String(vi.mocked(fetcher).mock.calls[0]![0])).toBe(
    `${session.origin}/api/v1/projects/${project}/story-creation-failure-policy`,
  );
  for (const policy of [
    { ...valid, revision: 3 },
    { ...valid, revision: 5 },
    { ...valid, failure_limit: 1 },
    { ...valid, state: "UNCONFIGURED", revision: 0, failure_limit: null },
    { ...valid, scope: "GROK_VIDEO_SUBMIT_FAILURES" },
  ]) {
    const reply = vi.fn(
      async () => new Response(JSON.stringify(policy)),
    ) as unknown as typeof fetch;
    expect(await storyCreationFailurePolicy(reply, session, project, update)).toEqual({
      kind: "FAILED",
      code: "WRITE_UNCONFIRMED",
    });
  }
});
