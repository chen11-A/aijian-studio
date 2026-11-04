import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { ShotPlanPreparation, HumanShotPlanRequest } from "@aijian/contracts/shot-plan";
import type { ChatGPTStatus } from "@aijian/contracts/chatgpt-auth";
import type {
  OfficialDirectorCompletion,
  OfficialDirectorGenerate,
  OfficialDirectorOperation,
  OfficialDirectorPrepared,
  OfficialDirectorReserve,
} from "@aijian/contracts/official-director";
import {
  createOfficialDirectorClient,
  type OfficialDirectorPersistenceClient,
} from "./official-director-client";
import {
  OFFICIAL_DIRECTOR_CHANNELS as CHANNELS,
  canonical,
  hash,
  validGenerate,
  validOperation,
  validPrepared,
} from "./official-director-contract";
import { registerOfficialDirectorHandlers } from "./official-director-ipc";
import {
  textRequestHash,
  type ChatGPTTextCommand,
  type ChatGPTTextOptions,
  type ChatGPTTextResult,
} from "./chatgpt-auth-generation";
import { createLocalApiClient } from "./api-client";

const preparation = JSON.parse(
  readFileSync("../../packages/contracts/fixtures/shot-plan/preparation.json", "utf8"),
) as { data: ShotPlanPreparation };
const human = JSON.parse(
  readFileSync("../../packages/contracts/fixtures/shot-plan/human-request.json", "utf8"),
) as HumanShotPlanRequest;
const project = preparation.data.project_id;
const episode = preparation.data.episode_id;
const operation = "11111111-1111-4111-8111-111111111111";
const profile = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const command: OfficialDirectorGenerate = {
  projectId: project,
  episodeId: episode,
  operationId: operation,
  expectedProfileId: profile,
  model: "fixture-director",
  authority: preparation.data.authority,
  storyboardBase: preparation.data.storyboard_base,
  intent: "Preserve all synthetic script coverage",
  options: { target_shot_count: null, pacing: "BALANCED" },
};
function prepared(): OfficialDirectorPrepared {
  const base = {
    operation_id: operation,
    profile_id: profile,
    model: command.model,
    authority: command.authority,
    storyboard_base: command.storyboardBase,
    intent: command.intent,
    options: command.options,
  };
  const input_text = canonical({
    prompt_version: "official.director.plan.v1",
    project_id: project,
    episode_id: episode,
    authority: base.authority,
    storyboard_base: base.storyboard_base,
    intent: base.intent,
    options: base.options,
    confirmed_script: preparation.data.script_stored_content,
    production_brief: preparation.data.production_brief_stored_content,
  });
  const instructions =
    "Return exactly one closed synthetic JSON director proposal; no live inference.";
  return {
    ...base,
    input_text,
    instructions,
    request_hash: textRequestHash({
      operationId: operation,
      model: command.model,
      text: input_text,
      instructions,
    }),
    script_stored_content: preparation.data.script_stored_content,
    production_brief_stored_content: preparation.data.production_brief_stored_content,
  };
}
const content = { ...human.content, provenance: "AI" as const };
function pending(): OfficialDirectorOperation {
  return {
    project_id: project,
    episode_id: episode,
    request: prepared(),
    status: "REMOTE_UNKNOWN",
    error_code: null,
    created_at: "2026-10-08T06:00:00Z",
    task_id: `task_${"a".repeat(32)}`,
    attempt_id: `att_${"b".repeat(32)}`,
    attempt_status: "REMOTE_UNKNOWN",
    proposal: null,
    completion: null,
    adoption: null,
    rejection: null,
    validation_issues: [],
  };
}
function completion(text = JSON.stringify(content)): OfficialDirectorCompletion {
  return {
    operation_id: operation,
    profile_id: profile,
    model: command.model,
    request_hash: prepared().request_hash,
    response_id: "resp_fixture_director",
    text,
    completed_at: "2026-10-08T06:01:00Z",
  };
}
function completed(): OfficialDirectorOperation {
  return {
    ...pending(),
    status: "COMPLETED",
    attempt_status: "SUCCEEDED",
    completion: completion(),
    proposal: {
      version_id: `ver_${"c".repeat(32)}`,
      content_hash: hash(content),
      content,
      capability_losses: [],
    },
  };
}
const status: ChatGPTStatus = {
  provider: "CHATGPT_OFFICIAL",
  runtime: "DESKTOP",
  state: "CONNECTED",
  useScope: "LOCAL_PERSONAL",
  secureStorage: "AVAILABLE",
  activeProfileId: profile,
  profiles: [],
  lastError: null,
  liveVerified: false,
};
function fixture() {
  let saved: OfficialDirectorOperation | null = null;
  let allowed = true;
  const api: OfficialDirectorPersistenceClient = {
    listOfficialDirector: vi.fn<OfficialDirectorPersistenceClient["listOfficialDirector"]>(
      async () => ({ kind: "OK", operations: saved ? [saved] : [], hasMore: false }),
    ),
    getOfficialDirector: vi.fn<OfficialDirectorPersistenceClient["getOfficialDirector"]>(
      async () =>
        saved
          ? { kind: "OK", operation: saved }
          : { kind: "ERROR", code: "OFFICIAL_DIRECTOR_NOT_FOUND" },
    ),
    prepareOfficialDirector: vi.fn<OfficialDirectorPersistenceClient["prepareOfficialDirector"]>(
      async () => ({ kind: "OK", request: prepared() }),
    ),
    reserveOfficialDirector: vi.fn<OfficialDirectorPersistenceClient["reserveOfficialDirector"]>(
      async () => {
        saved = pending();
        return { kind: "OK", operation: saved, replayed: false };
      },
    ),
    completeOfficialDirector: vi.fn<OfficialDirectorPersistenceClient["completeOfficialDirector"]>(
      async (_project, _episode, input) => {
        saved =
          input.text === completion().text
            ? completed()
            : {
                ...pending(),
                status: "INVALID",
                attempt_status: "FAILED",
                error_code: "OFFICIAL_DIRECTOR_INVALID_OUTPUT",
                completion: input,
                validation_issues: [{ code: "OUTPUT_INVALID", message: "Synthetic invalid JSON" }],
              };
        return { kind: "OK", operation: saved, replayed: false };
      },
    ),
    markOfficialDirectorNotSent: vi.fn<
      OfficialDirectorPersistenceClient["markOfficialDirectorNotSent"]
    >(async (_project, _episode, _operation, code) => {
      saved = {
        ...pending(),
        status: "NOT_SENT",
        attempt_status: "NOT_SUBMITTED",
        error_code: code,
      };
      return { kind: "OK", operation: saved, replayed: false };
    }),
    adoptOfficialDirector: vi.fn<OfficialDirectorPersistenceClient["adoptOfficialDirector"]>(
      async () => ({ kind: "UNKNOWN" }),
    ),
    rejectOfficialDirector: vi.fn<OfficialDirectorPersistenceClient["rejectOfficialDirector"]>(
      async () => ({ kind: "UNKNOWN" }),
    ),
  };
  const runtime = {
    status: vi.fn(async () => status),
    generateText: vi.fn(
      async (
        input: ChatGPTTextCommand,
        options: ChatGPTTextOptions,
      ): Promise<ChatGPTTextResult> => {
        try {
          await options.beforeSend({
            operationId: operation,
            profileId: profile,
            model: command.model,
            requestHash: textRequestHash(input),
          });
        } catch {
          return { kind: "NOT_SENT", operationId: operation, code: "CONNECTION_UNAVAILABLE" };
        }
        return {
          kind: "COMPLETED",
          operationId: operation,
          profileId: profile,
          model: command.model,
          requestHash: textRequestHash(input),
          text: completion().text,
          responseId: completion().response_id,
          completedAt: completion().completed_at,
        };
      },
    ),
  };
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  registerOfficialDirectorHandlers<boolean>(
    (channel, handler) => handlers.set(channel, handler),
    () => api,
    (event) => event && allowed,
    () => runtime,
  );
  return {
    api,
    runtime,
    handlers,
    invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)?.(true, ...args),
    saved: (value: OfficialDirectorOperation | null) => {
      saved = value;
    },
    allowed: (value: boolean) => {
      allowed = value;
    },
  };
}

describe("dedicated trusted AI director IPC with offline fixtures", () => {
  it("requires a selected account before preparation and rejects a changed account", async () => {
    const missing = fixture();
    const legacy = { ...command };
    delete legacy.expectedProfileId;
    expect(await missing.invoke(CHANNELS.generate, legacy)).toMatchObject({
      kind: "NOT_SENT",
      code: "ACCOUNT_SELECTION_REQUIRED",
    });
    expect(missing.api.prepareOfficialDirector).not.toHaveBeenCalled();
    missing.saved(pending());
    expect(await missing.invoke(CHANNELS.generate, legacy)).toMatchObject({
      kind: "OK",
      operation: pending(),
    });
    expect(missing.api.prepareOfficialDirector).not.toHaveBeenCalled();
    const changed = fixture();
    expect(
      await changed.invoke(CHANNELS.generate, { ...command, expectedProfileId: requestId }),
    ).toMatchObject({ kind: "NOT_SENT", code: "ACCOUNT_MISMATCH" });
    expect(changed.api.prepareOfficialDirector).not.toHaveBeenCalled();
  });
  it("freezes server prompt, reserves exact ledger identity before send and reads persisted completion once", async () => {
    const test = fixture();
    expect(await test.invoke(CHANNELS.generate, command)).toEqual({
      kind: "OK",
      operation: completed(),
    });
    const input = test.runtime.generateText.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      text: prepared().input_text,
      instructions: prepared().instructions,
    });
    const reserve: OfficialDirectorReserve = {
      operation_id: operation,
      profile_id: profile,
      model: command.model,
      authority: command.authority,
      storyboard_base: command.storyboardBase,
      intent: command.intent,
      options: command.options,
      request_hash: prepared().request_hash,
    };
    expect(test.api.reserveOfficialDirector).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      reserve,
    );
    expect(test.api.completeOfficialDirector).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      completion(),
    );
    expect(await test.invoke(CHANNELS.generate, command)).toEqual({
      kind: "OK",
      operation: completed(),
    });
    expect(test.runtime.generateText).toHaveBeenCalledOnce();
  });
  it("keeps existing unknown remote operations read-only across a reconstructed main bridge", async () => {
    const test = fixture();
    test.saved(pending());
    expect(await test.invoke(CHANNELS.generate, command)).toEqual({
      kind: "OK",
      operation: pending(),
    });
    expect(test.runtime.status).not.toHaveBeenCalled();
    expect(test.runtime.generateText).not.toHaveBeenCalled();
    expect(await test.invoke(CHANNELS.generate, { ...command, intent: "changed" })).toMatchObject({
      kind: "NOT_SENT",
      code: "OPERATION_REUSED",
    });
  });
  it("exposes only five narrow literal channels and rejects renderer completions/prompt imports/frames", async () => {
    const test = fixture();
    expect([...test.handlers.keys()].sort()).toEqual(Object.values(CHANNELS).sort());
    for (const extra of [
      { text: "fake" },
      { responseId: "resp_forged" },
      { instructions: "fake" },
      { profileId: profile },
    ]) {
      expect(validGenerate({ ...command, ...extra })).toBe(false);
      await expect(test.invoke(CHANNELS.generate, { ...command, ...extra })).rejects.toThrow();
    }
    await expect(test.handlers.get(CHANNELS.generate)?.(false, command)).rejects.toThrow("sender");
    expect(test.runtime.generateText).not.toHaveBeenCalled();
  });
  it("retains ambiguous local reservations for read recovery and never authorizes resend", async () => {
    const test = fixture();
    vi.mocked(test.api.reserveOfficialDirector).mockResolvedValue({ kind: "UNKNOWN" });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "RESERVATION_UNCONFIRMED",
    });
    expect(test.api.completeOfficialDirector).not.toHaveBeenCalled();
    vi.mocked(test.api.reserveOfficialDirector).mockImplementation(async () => {
      test.saved(pending());
      return { kind: "UNKNOWN" };
    });
    expect(await test.invoke(CHANNELS.generate, command)).toEqual({
      kind: "OK",
      operation: pending(),
    });
    expect(await test.invoke(CHANNELS.generate, command)).toEqual({
      kind: "OK",
      operation: pending(),
    });
    expect(test.runtime.generateText).toHaveBeenCalledTimes(2);
  });
  it("blocks a replayed or mismatched reservation before remote send", async () => {
    const test = fixture();
    vi.mocked(test.api.reserveOfficialDirector).mockResolvedValue({
      kind: "OK",
      operation: pending(),
      replayed: true,
    });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({ kind: "REMOTE_UNKNOWN" });
    vi.mocked(test.api.reserveOfficialDirector).mockResolvedValue({
      kind: "OK",
      operation: { ...pending(), request: { ...prepared(), profile_id: operation } },
      replayed: false,
    });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({ kind: "REMOTE_UNKNOWN" });
    expect(test.api.completeOfficialDirector).not.toHaveBeenCalled();
  });
  it("native cancellation creates no remote operation, while proved no-send after reserve is durably settled", async () => {
    const test = fixture();
    test.runtime.generateText.mockResolvedValueOnce({
      kind: "NOT_SENT",
      operationId: operation,
      code: "REQUEST_NOT_APPROVED",
    });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "REQUEST_NOT_APPROVED",
    });
    expect(test.api.reserveOfficialDirector).not.toHaveBeenCalled();
    vi.mocked(test.api.reserveOfficialDirector).mockImplementation(async () => {
      test.saved(pending());
      test.allowed(false);
      return { kind: "OK", operation: pending(), replayed: false };
    });
    const result = await test.invoke(CHANNELS.generate, command);
    expect(result).toMatchObject({
      kind: "OK",
      operation: { status: "NOT_SENT", attempt_status: "NOT_SUBMITTED" },
    });
    expect(test.api.markOfficialDirectorNotSent).toHaveBeenCalledOnce();
    expect(test.api.completeOfficialDirector).not.toHaveBeenCalled();
  });
  it("rejects session/profile changes during native approval before reservation", async () => {
    const test = fixture();
    test.runtime.status
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce({ ...status, activeProfileId: operation });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({ kind: "NOT_SENT" });
    expect(test.api.reserveOfficialDirector).not.toHaveBeenCalled();
  });
  it("forwards invalid JSON raw bytes and trustworthy response ID to retained backend rejection", async () => {
    const test = fixture();
    const original = test.runtime.generateText.getMockImplementation();
    if (!original) throw new Error("Missing fixture");
    test.runtime.generateText.mockImplementation(async (input, options) => {
      const result = await original(input, options);
      return result.kind === "COMPLETED"
        ? { ...result, text: "invalid JSON\0 exact bytes" }
        : result;
    });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "OK",
      operation: {
        status: "INVALID",
        completion: { text: "invalid JSON\0 exact bytes", response_id: "resp_fixture_director" },
      },
    });
    expect(test.api.completeOfficialDirector).toHaveBeenCalledOnce();
  });
  it.each([undefined, "", "\0forged"])(
    "does not submit completion without valid trusted response ID (%s)",
    async (responseId) => {
      const test = fixture();
      const original = test.runtime.generateText.getMockImplementation();
      if (!original) throw new Error("Missing fixture");
      test.runtime.generateText.mockImplementation(async (input, options) => {
        const result = await original(input, options);
        return result.kind === "COMPLETED" ? { ...result, responseId } : result;
      });
      expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
        kind: "REMOTE_UNKNOWN",
        code: "COMPLETION_IDENTITY_MISMATCH",
      });
      expect(test.api.completeOfficialDirector).not.toHaveBeenCalled();
    },
  );
  it("completion write/read ambiguity never converts into another remote attempt", async () => {
    const test = fixture();
    vi.mocked(test.api.completeOfficialDirector).mockRejectedValue(
      new Error("offline transport loss"),
    );
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "RESULT_PERSISTENCE_UNCONFIRMED",
    });
    expect(await test.invoke(CHANNELS.generate, command)).toEqual({
      kind: "OK",
      operation: pending(),
    });
    expect(test.runtime.generateText).toHaveBeenCalledOnce();
  });
  it("blocks concurrent generate commands while preserving the first operation", async () => {
    const test = fixture();
    let resolve: ((result: ChatGPTTextResult) => void) | undefined;
    test.runtime.generateText.mockImplementation(
      async (_input, _options) =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = test.invoke(CHANNELS.generate, command);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "GENERATION_BUSY",
    });
    if (!resolve) throw new Error("Missing fixture resolver");
    resolve({ kind: "NOT_SENT", operationId: operation, code: "REQUEST_NOT_APPROVED" });
    expect(await first).toMatchObject({ kind: "NOT_SENT", code: "REQUEST_NOT_APPROVED" });
    expect(test.runtime.generateText).toHaveBeenCalledOnce();
  });
  it.each([
    { profileId: operation },
    { model: "forged" },
    { requestHash: `sha256:${"f".repeat(64)}` },
    { operationId: profile },
  ])("rejects trusted-completion identity mismatches (%j)", async (patch) => {
    const test = fixture();
    const original = test.runtime.generateText.getMockImplementation();
    if (!original) throw new Error("Missing fixture");
    test.runtime.generateText.mockImplementation(async (input, options) => {
      const result = await original(input, options);
      return result.kind === "COMPLETED" ? { ...result, ...patch } : result;
    });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "COMPLETION_IDENTITY_MISMATCH",
    });
    expect(test.api.completeOfficialDirector).not.toHaveBeenCalled();
  });
  it("requires explicit human exact-hash decisions and verified immutable readback", async () => {
    const test = fixture();
    const saved = completed();
    test.saved(saved);
    const input = {
      proposal_version_id: saved.proposal?.version_id,
      proposal_content_hash: saved.proposal?.content_hash,
      confirm: true,
    };
    await expect(
      test.invoke(CHANNELS.adopt, project, episode, operation, { ...input, confirm: false }),
    ).rejects.toThrow();
    vi.mocked(test.api.adoptOfficialDirector).mockImplementation(async () => {
      const adopted = {
        ...saved,
        adoption: {
          proposal_version_id: saved.proposal?.version_id ?? "",
          proposal_content_hash: saved.proposal?.content_hash ?? "",
          storyboard_version_id: `ver_${"d".repeat(32)}`,
          storyboard_content_hash: `sha256:${"e".repeat(64)}`,
          actor_id: "human:fixture",
          adopted_at: "2026-10-08T06:03:00Z",
        },
      };
      test.saved(adopted);
      return { kind: "OK", operation: adopted, replayed: false };
    });
    expect(await test.invoke(CHANNELS.adopt, project, episode, operation, input)).toMatchObject({
      kind: "OK",
      operation: { adoption: { actor_id: "human:fixture" } },
    });
    expect(test.runtime.generateText).not.toHaveBeenCalled();
    test.saved(saved);
    vi.mocked(test.api.rejectOfficialDirector).mockImplementation(
      async (_project, _episode, _operation, reject) => {
        const rejected = {
          ...saved,
          rejection: {
            actor_id: "human:fixture",
            rejected_at: "2026-10-08T06:03:00Z",
            reason: reject.reason,
          },
        };
        test.saved(rejected);
        return { kind: "OK", operation: rejected, replayed: false };
      },
    );
    expect(
      await test.invoke(CHANNELS.reject, project, episode, operation, {
        ...input,
        reason: "Revise fixture pacing",
      }),
    ).toMatchObject({ kind: "OK", operation: { rejection: { reason: "Revise fixture pacing" } } });
  });
});

describe("closed authenticated main-only director client", () => {
  it("decodes exact frozen evidence and accepts equivalent object key ordering", async () => {
    expect(validPrepared(prepared())).toBe(true);
    expect(validOperation(completed(), project, episode, operation)).toBe(true);
    const input = {
      operation_id: operation,
      profile_id: profile,
      model: command.model,
      authority: {
        script: command.authority.script,
        production_brief: command.authority.production_brief,
        mode: "ORIGINAL" as const,
      },
      storyboard_base: command.storyboardBase,
      intent: command.intent,
      options: { pacing: "BALANCED" as const, target_shot_count: null },
    };
    const http = vi.fn(async () => ({
      status: 200,
      requestId,
      payload: { data: { request: prepared() }, request_id: requestId },
    }));
    expect(
      await createOfficialDirectorClient(http, {}).prepareOfficialDirector(project, episode, input),
    ).toEqual({ kind: "OK", request: prepared() });
    expect(http).toHaveBeenCalledOnce();
  });
  it("preserves malformed raw JSON/NUL in INVALID receipts without treating it as an artifact", () => {
    const invalid = {
      ...pending(),
      status: "INVALID",
      attempt_status: "FAILED",
      error_code: "OFFICIAL_DIRECTOR_INVALID_OUTPUT",
      completion: completion("invalid\0 JSON"),
      validation_issues: [{ code: "OUTPUT_INVALID", message: "Malformed synthetic fixture" }],
    };
    expect(validOperation(invalid, project, episode, operation)).toBe(true);
    expect(
      validOperation({ ...invalid, completion: completion("") }, project, episode, operation),
    ).toBe(true);
    expect(validOperation({ ...invalid, proposal: completed().proposal }, project, episode)).toBe(
      false,
    );
  });
  it.each([
    { access_token: "forged" },
    { episode_id: `ep_${"f".repeat(32)}` },
    { attempt_id: "fake" },
    { attempt_status: "SUCCEEDED" },
    { validation_issues: [{ code: "FAKE", message: "not valid on UNKNOWN" }] },
  ])("rejects inconsistent backend evidence (%j)", async (patch) => {
    const http = vi.fn(async () => ({
      status: 200,
      requestId,
      payload: { data: { ...pending(), ...patch }, request_id: requestId },
    }));
    expect(
      await createOfficialDirectorClient(http, {}).getOfficialDirector(project, episode, operation),
    ).toEqual({ kind: "UNKNOWN" });
    expect(http).toHaveBeenCalledOnce();
  });
  it("rejects corrupt frozen prompt/proof/hash, unrelated completion artifact and malformed capability losses", () => {
    expect(validPrepared({ ...prepared(), input_text: "wrong prompt" })).toBe(false);
    expect(validPrepared({ ...prepared(), request_hash: `sha256:${"f".repeat(64)}` })).toBe(false);
    expect(validPrepared({ ...prepared(), script_stored_content: {} })).toBe(false);
    expect(validOperation({ ...completed(), completion: completion("{}") }, project, episode)).toBe(
      false,
    );
    expect(
      validOperation(
        {
          ...completed(),
          proposal: {
            ...completed().proposal,
            capability_losses: [{ code: "FORGED", severity: "OK", shot_id: null, message: "bad" }],
          },
        },
        project,
        episode,
      ),
    ).toBe(false);
  });
  it("uses fixed authenticated sidecar route, one attempt and correlated request IDs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: pending(), request_id: requestId }), {
        headers: { "X-Request-ID": requestId },
      }),
    );
    const api = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    expect(await api.getOfficialDirector(project, episode, operation)).toEqual({
      kind: "OK",
      operation: pending(),
    });
    expect(fetcher.mock.lastCall?.[0]).toBe(
      `http://127.0.0.1:43124/api/v1/projects/${project}/episodes/${episode}/official-director/${operation}`,
    );
    expect(fetcher.mock.lastCall?.[1]?.headers).toMatchObject({
      Origin: "app://aijian",
      Authorization: `Bearer ${"t".repeat(43)}`,
    });
    fetcher.mockRejectedValue(new Error("offline"));
    expect(await api.getOfficialDirector(project, episode, operation)).toEqual({ kind: "UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("actual sandbox preload exposes five commands without runtime modules or credential/result writes", async () => {
    const source = readFileSync("src/preload.ts", "utf8");
    const invoke = vi.fn().mockResolvedValue({ kind: "UNKNOWN" });
    const bridges = new Map<string, Record<string, (...args: unknown[]) => Promise<unknown>>>();
    runInNewContext(
      ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
        .outputText,
      {
        exports: {},
        require: (name: string) => {
          expect(name).toBe("electron");
          return {
            contextBridge: {
              exposeInMainWorld: (
                name: string,
                value: Record<string, (...args: unknown[]) => Promise<unknown>>,
              ) => bridges.set(name, value),
            },
            ipcRenderer: { invoke },
          };
        },
      },
    );
    const bridge = bridges.get("aijianOfficialDirector");
    expect(Object.keys(bridge ?? {}).sort()).toEqual(
      ["list", "get", "generate", "adopt", "reject"].sort(),
    );
    await bridge?.generate?.(command);
    expect(invoke).toHaveBeenLastCalledWith(CHANNELS.generate, command);
    for (const channel of Object.values(CHANNELS)) expect(source).toContain(`"${channel}"`);
    expect(source).not.toMatch(
      /official-director:(?:complete|reserve|prepare)|accessToken|refreshToken/,
    );
  });
});

it("decodes genuine schema41 Pydantic offline records for every lifecycle state without rewriting evidence", () => {
  const records = JSON.parse(
    readFileSync("../../packages/contracts/fixtures/official-director.json", "utf8"),
  ) as {
    preparation: { request: OfficialDirectorPrepared };
    unknown: OfficialDirectorOperation;
    completed: OfficialDirectorOperation;
    adopted: OfficialDirectorOperation;
    rejected: OfficialDirectorOperation;
    invalid: OfficialDirectorOperation;
    notSent: OfficialDirectorOperation;
  };
  expect(validPrepared(records.preparation.request)).toBe(true);
  for (const name of [
    "unknown",
    "completed",
    "adopted",
    "rejected",
    "invalid",
    "notSent",
  ] as const) {
    const value = records[name];
    expect(
      validOperation(value, value.project_id, value.episode_id, value.request.operation_id),
      name,
    ).toBe(true);
  }
});

describe("director fixed HTTP route and corruption matrix", () => {
  const reserve = (): OfficialDirectorReserve => ({
    operation_id: operation,
    profile_id: profile,
    model: command.model,
    authority: command.authority,
    storyboard_base: command.storyboardBase,
    intent: command.intent,
    options: command.options,
    request_hash: prepared().request_hash,
  });
  const adoption = () => ({
    proposal_version_id: completed().proposal?.version_id ?? "",
    proposal_content_hash: completed().proposal?.content_hash ?? "",
    confirm: true as const,
  });
  it("calls all eight authenticated fixed routes once with no prompt/result IPC", async () => {
    const http = vi.fn<Parameters<typeof createOfficialDirectorClient>[0]>();
    const api = createOfficialDirectorClient(http, {
      Origin: "app://aijian",
      Authorization: "Bearer fixture-main-only",
    });
    const root = `/api/v1/projects/${project}/episodes/${episode}/official-director`;
    const cases: [string, unknown, () => Promise<unknown>, string | undefined][] = [
      [root, [pending()], () => api.listOfficialDirector(project, episode), undefined],
      [
        `${root}/${operation}`,
        pending(),
        () => api.getOfficialDirector(project, episode, operation),
        undefined,
      ],
      [
        `${root}/preparation`,
        { request: prepared() },
        () => api.prepareOfficialDirector(project, episode, reserve()),
        "POST",
      ],
      [
        root,
        { operation: pending(), replayed: false },
        () => api.reserveOfficialDirector(project, episode, reserve()),
        "POST",
      ],
      [
        `${root}/${operation}/completion`,
        { operation: completed(), replayed: false },
        () => api.completeOfficialDirector(project, episode, completion()),
        "POST",
      ],
      [
        `${root}/${operation}/not-sent`,
        {
          operation: {
            ...pending(),
            status: "NOT_SENT",
            attempt_status: "NOT_SUBMITTED",
            error_code: "REQUEST_NOT_APPROVED",
          },
          replayed: false,
        },
        () => api.markOfficialDirectorNotSent(project, episode, operation, "REQUEST_NOT_APPROVED"),
        "POST",
      ],
      [
        `${root}/${operation}/adoption`,
        { operation: completed(), replayed: false },
        () => api.adoptOfficialDirector(project, episode, operation, adoption()),
        "POST",
      ],
      [
        `${root}/${operation}/rejection`,
        { operation: completed(), replayed: false },
        () =>
          api.rejectOfficialDirector(project, episode, operation, {
            ...adoption(),
            reason: "Fixture",
          }),
        "POST",
      ],
    ];
    for (const [path, data, action, method] of cases) {
      http.mockResolvedValueOnce({
        status: 200,
        requestId,
        payload: {
          data,
          request_id: requestId,
          ...(Array.isArray(data) ? { has_more: false } : {}),
        },
      });
      expect(await action()).toMatchObject({ kind: "OK" });
      expect(http.mock.lastCall?.[0]).toBe(path);
      expect(http.mock.lastCall?.[1]?.method).toBe(method);
      expect(http.mock.lastCall?.[1]?.headers).toMatchObject({
        Origin: "app://aijian",
        Authorization: "Bearer fixture-main-only",
      });
    }
    expect(http).toHaveBeenCalledTimes(8);
  });
  it("maps only correlated closed errors and never retries transport or malformed envelopes", async () => {
    const http = vi.fn<Parameters<typeof createOfficialDirectorClient>[0]>();
    const api = createOfficialDirectorClient(http, {});
    for (const status of [401, 403, 404, 409, 413, 422, 428]) {
      http.mockResolvedValueOnce({
        status,
        requestId,
        payload: { error: { code: "OFFICIAL_DIRECTOR_FAILED" }, request_id: requestId },
      });
      expect(await api.getOfficialDirector(project, episode, operation)).toEqual({
        kind: "ERROR",
        code: "OFFICIAL_DIRECTOR_FAILED",
      });
    }
    const invalid = [
      {
        status: 500,
        requestId,
        payload: { error: { code: "OFFICIAL_DIRECTOR_STORAGE_FAILED" }, request_id: requestId },
      },
      {
        status: 503,
        requestId,
        payload: { error: { code: "OFFICIAL_DIRECTOR_STORAGE_FAILED" }, request_id: requestId },
      },
      null,
      { status: 200, requestId, payload: { data: pending(), request_id: profile } },
      {
        status: 200,
        requestId,
        payload: { data: pending(), request_id: requestId, token: "fake" },
      },
      { status: 200, requestId: null, payload: { data: pending(), request_id: requestId } },
      {
        status: 302,
        requestId,
        payload: { error: { code: "OFFICIAL_DIRECTOR_FAILED" }, request_id: requestId },
      },
      {
        status: 409,
        requestId,
        payload: { error: { code: "invalid code" }, request_id: requestId },
      },
    ];
    for (const response of invalid) {
      http.mockResolvedValueOnce(response);
      expect(await api.getOfficialDirector(project, episode, operation)).toEqual({
        kind: "UNKNOWN",
      });
    }
    http.mockRejectedValueOnce(new Error("Offline transport"));
    expect(await api.getOfficialDirector(project, episode, operation)).toEqual({ kind: "UNKNOWN" });
    expect(http).toHaveBeenCalledTimes(16);
  });
  it("rejects malformed lists, preparations, mutations and outgoing human decisions", async () => {
    const http = vi.fn<Parameters<typeof createOfficialDirectorClient>[0]>();
    const api = createOfficialDirectorClient(http, {});
    const result = (data: unknown) => ({
      status: 200,
      requestId,
      payload: { data, request_id: requestId, ...(Array.isArray(data) ? { has_more: false } : {}) },
    });
    for (const data of [{}, [pending(), pending()], [{ ...pending(), accessToken: "fake" }]]) {
      http.mockResolvedValueOnce(result(data));
      expect(await api.listOfficialDirector(project, episode)).toEqual({ kind: "UNKNOWN" });
    }
    http.mockResolvedValueOnce(result({ request: { ...prepared(), intent: "wrong" } }));
    expect(await api.prepareOfficialDirector(project, episode, reserve())).toEqual({
      kind: "UNKNOWN",
    });
    for (const data of [
      { operation: pending(), replayed: "false" },
      { operation: pending(), replayed: false, credentials: "fake" },
    ]) {
      http.mockResolvedValueOnce(result(data));
      expect(await api.reserveOfficialDirector(project, episode, reserve())).toEqual({
        kind: "UNKNOWN",
      });
    }
    expect(() => api.getOfficialDirector("../escape", episode, operation)).toThrow("scope");
    expect(() => api.getOfficialDirector(project, episode, "../escape")).toThrow("operation");
    expect(() =>
      api.adoptOfficialDirector(project, episode, operation, {
        ...adoption(),
        confirm: false,
      } as unknown as Parameters<typeof api.adoptOfficialDirector>[3]),
    ).toThrow("adoption");
    expect(() =>
      api.rejectOfficialDirector(project, episode, operation, { ...adoption(), reason: "" }),
    ).toThrow("rejection");
  });
});

describe("director no-send and read-only recovery failures", () => {
  it("lists and gets only exact narrow scoped operations", async () => {
    const test = fixture();
    test.saved(pending());
    expect(await test.invoke(CHANNELS.list, project, episode)).toEqual({
      kind: "OK",
      operations: [pending()],
      hasMore: false,
    });
    expect(await test.invoke(CHANNELS.get, project, episode, operation)).toEqual({
      kind: "OK",
      operation: pending(),
    });
    for (const [channel, args] of [
      [CHANNELS.list, [project, episode, "extra"]],
      [CHANNELS.get, [project, episode, "invalid"]],
      [CHANNELS.get, ["invalid", episode, operation]],
    ] as const)
      await expect(test.invoke(channel, ...args)).rejects.toThrow();
  });
  it.each(["throw", "unknown", "error"])(
    "failed prior operation read blocks generation (%s)",
    async (kind) => {
      const test = fixture();
      if (kind === "throw")
        vi.mocked(test.api.getOfficialDirector).mockRejectedValue(new Error("Offline"));
      else
        vi.mocked(test.api.getOfficialDirector).mockResolvedValue(
          kind === "unknown" ? { kind: "UNKNOWN" } : { kind: "ERROR", code: "SCOPE_FAILED" },
        );
      expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
        kind: "NOT_SENT",
        code: "OPERATION_READ_FAILED",
      });
      expect(test.runtime.generateText).not.toHaveBeenCalled();
    },
  );
  it("fails before reservation for unauthorized or unavailable profiles and preparations", async () => {
    const test = fixture();
    test.runtime.status.mockResolvedValueOnce({ ...status, state: "NOT_CONNECTED" });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "PLAN_USAGE_NOT_AUTHORIZED",
    });
    test.runtime.status.mockRejectedValueOnce(new Error("Store unavailable"));
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "PREPARATION_FAILED",
    });
    vi.mocked(test.api.prepareOfficialDirector).mockResolvedValueOnce({ kind: "UNKNOWN" });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "PREPARATION_UNCONFIRMED",
    });
    vi.mocked(test.api.prepareOfficialDirector).mockResolvedValueOnce({
      kind: "ERROR",
      code: "SHOT_PLAN_SCRIPT_STALE",
    });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "SHOT_PLAN_SCRIPT_STALE",
    });
    vi.mocked(test.api.prepareOfficialDirector).mockResolvedValueOnce({
      kind: "OK",
      request: { ...prepared(), intent: "changed" },
    });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "PREPARATION_IDENTITY_MISMATCH",
    });
    expect(test.api.reserveOfficialDirector).not.toHaveBeenCalled();
  });
  it("never converts thrown generation or reserve/read ambiguity into another remote request", async () => {
    const test = fixture();
    test.runtime.generateText.mockRejectedValueOnce(new Error("Interrupted"));
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "GENERATION_UNSETTLED",
    });
    vi.mocked(test.api.reserveOfficialDirector).mockImplementationOnce(async () => {
      vi.mocked(test.api.getOfficialDirector).mockRejectedValue(new Error("Read failed"));
      throw new Error("Write ambiguous");
    });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "RESERVATION_FAILED",
    });
    expect(test.api.completeOfficialDirector).not.toHaveBeenCalled();
  });
  it("preserves unknown before-send proof settlement failures and remote transport outcomes", async () => {
    const test = fixture();
    vi.mocked(test.api.reserveOfficialDirector).mockImplementation(async () => {
      test.saved(pending());
      test.allowed(false);
      return { kind: "OK", operation: pending(), replayed: false };
    });
    vi.mocked(test.api.markOfficialDirectorNotSent).mockResolvedValueOnce({ kind: "UNKNOWN" });
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "NOT_SENT_PERSISTENCE_UNCONFIRMED",
    });
    test.allowed(true);
    test.saved(null);
    vi.mocked(test.api.markOfficialDirectorNotSent).mockRejectedValueOnce(
      new Error("Settlement failed"),
    );
    expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "NOT_SENT_PERSISTENCE_UNCONFIRMED",
    });
    const second = fixture();
    second.runtime.generateText.mockResolvedValue({
      kind: "REMOTE_UNKNOWN",
      operationId: operation,
      code: "CONNECTION_UNAVAILABLE",
    });
    expect(await second.invoke(CHANNELS.generate, command)).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "CONNECTION_UNAVAILABLE",
    });
  });
  it("returns UNKNOWN on unverified decision receipts, errors, stale hashes and throws", async () => {
    const test = fixture();
    const input = {
      proposal_version_id: completed().proposal?.version_id,
      proposal_content_hash: completed().proposal?.content_hash,
      confirm: true,
    };
    vi.mocked(test.api.adoptOfficialDirector).mockResolvedValueOnce({
      kind: "ERROR",
      code: "SHOT_PLAN_STORYBOARD_STALE",
    });
    expect(await test.invoke(CHANNELS.adopt, project, episode, operation, input)).toEqual({
      kind: "ERROR",
      code: "SHOT_PLAN_STORYBOARD_STALE",
    });
    test.saved(completed());
    expect(await test.invoke(CHANNELS.adopt, project, episode, operation, input)).toEqual({
      kind: "UNKNOWN",
    });
    vi.mocked(test.api.adoptOfficialDirector).mockRejectedValueOnce(new Error("Write uncertain"));
    expect(await test.invoke(CHANNELS.adopt, project, episode, operation, input)).toEqual({
      kind: "UNKNOWN",
    });
    await expect(
      test.invoke(CHANNELS.reject, project, episode, operation, { ...input, reason: "" }),
    ).rejects.toThrow();
  });
});

it("rejects status/proof inconsistencies and conflicting human decisions", () => {
  expect(validPrepared({ ...prepared(), profile_id: "forged" })).toBe(false);
  expect(validPrepared({ ...prepared(), options: { pacing: "FAST", target_shot_count: -1 } })).toBe(
    false,
  );
  const records = JSON.parse(
    readFileSync("../../packages/contracts/fixtures/official-director.json", "utf8"),
  ) as {
    notSent: OfficialDirectorOperation;
    adopted: OfficialDirectorOperation;
    rejected: OfficialDirectorOperation;
  };
  expect(
    validOperation(
      { ...records.notSent, attempt_status: "FAILED" },
      records.notSent.project_id,
      records.notSent.episode_id,
    ),
  ).toBe(false);
  expect(
    validOperation(
      {
        ...completed(),
        validation_issues: [
          { code: "WRONG", message: "Completed cannot have validation failures" },
        ],
      },
      project,
      episode,
    ),
  ).toBe(false);
  expect(
    validOperation(
      { ...records.adopted, rejection: records.rejected.rejection },
      records.adopted.project_id,
      records.adopted.episode_id,
    ),
  ).toBe(false);
  expect(validOperation({ ...completed(), adoption: { fake: "receipt" } }, project, episode)).toBe(
    false,
  );
});
it("blocks an unauthorized changed reservation callback identity and unverified decision readback", async () => {
  const test = fixture();
  test.runtime.generateText.mockImplementation(async (input, options) => {
    try {
      await options.beforeSend({
        operationId: operation,
        profileId: operation,
        model: command.model,
        requestHash: textRequestHash(input),
      });
    } catch {
      return { kind: "NOT_SENT", operationId: operation, code: "IDENTITY_CHANGED" };
    }
    throw new Error("Invalid metadata should not send");
  });
  expect(await test.invoke(CHANNELS.generate, command)).toMatchObject({
    kind: "NOT_SENT",
    code: "IDENTITY_CHANGED",
  });
  expect(test.api.reserveOfficialDirector).not.toHaveBeenCalled();
  const input = {
    proposal_version_id: completed().proposal?.version_id,
    proposal_content_hash: completed().proposal?.content_hash,
    confirm: true,
  };
  expect(await test.invoke(CHANNELS.adopt, project, episode, operation, input)).toEqual({
    kind: "UNKNOWN",
  });
  await expect(test.invoke(CHANNELS.reject, project, episode, "bad", input)).rejects.toThrow();
});
it("maximal valid human intent stays in frozen input without overflowing the native approval summary", async () => {
  const test = fixture();
  const intent = "🎥".repeat(4000);
  const original = prepared();
  const evidence = JSON.parse(original.input_text);
  evidence.intent = intent;
  const frozen = { ...original, intent, input_text: canonical(evidence) };
  frozen.request_hash = textRequestHash({
    operationId: operation,
    model: command.model,
    text: frozen.input_text,
    instructions: frozen.instructions,
  });
  vi.mocked(test.api.prepareOfficialDirector).mockResolvedValue({ kind: "OK", request: frozen });
  test.runtime.generateText.mockImplementation(async (input) => {
    expect(input.approvalContext?.length).toBeLessThanOrEqual(4000);
    expect(input.text).toContain(intent);
    return { kind: "NOT_SENT", operationId: operation, code: "REQUEST_NOT_APPROVED" };
  });
  expect(await test.invoke(CHANNELS.generate, { ...command, intent })).toMatchObject({
    kind: "NOT_SENT",
    code: "REQUEST_NOT_APPROVED",
  });
});
