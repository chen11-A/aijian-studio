import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  OfficialTextGenerate,
  OfficialTextOperation,
  OfficialTextReserve,
} from "@aijian/contracts/official-text";
import { OFFICIAL_TEXT_CHANNELS, validOperation } from "./official-text-contract";
import {
  createOfficialTextClient,
  type OfficialTextPersistenceClient,
} from "./official-text-client";
import { registerOfficialTextHandlers } from "./official-text-ipc";
import {
  textRequestHash,
  type ChatGPTTextCommand,
  type ChatGPTTextOptions,
  type ChatGPTTextResult,
} from "./chatgpt-auth-generation";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const operation = "11111111-1111-4111-8111-111111111111";
const profile = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const command: OfficialTextGenerate = {
  projectId: project,
  episodeId: episode,
  base: null,
  operationId: operation,
  model: "synthetic-fixture",
  text: "Synthetic prompt, no live inference",
};
const request: OfficialTextReserve = {
  operation_id: operation,
  profile_id: profile,
  model: command.model,
  input_text: command.text,
  instructions: null,
  base: null,
  request_hash: textRequestHash(command),
};
function pending(): OfficialTextOperation {
  return {
    project_id: project,
    episode_id: episode,
    request: { ...request },
    status: "REMOTE_UNKNOWN",
    error_code: null,
    created_at: "2026-10-08T06:00:00Z",
    proposal: null,
    adoption: null,
  };
}
function completed(): OfficialTextOperation {
  return {
    ...pending(),
    status: "COMPLETED",
    proposal: {
      version_id: `ver_${"c".repeat(32)}`,
      content_hash: `sha256:${"d".repeat(64)}`,
      result: {
        operation_id: operation,
        profile_id: profile,
        model: command.model,
        request_hash: request.request_hash,
        text: "Synthetic generated fixture only",
        completed_at: "2026-10-08T06:01:00Z",
      },
    },
  };
}
function fixture() {
  let saved: OfficialTextOperation | null = null;
  const api: OfficialTextPersistenceClient = {
    listOfficialText: vi.fn<OfficialTextPersistenceClient["listOfficialText"]>(async () => ({
      kind: "OK",
      operations: saved ? [saved] : [],
    })),
    getOfficialText: vi.fn<OfficialTextPersistenceClient["getOfficialText"]>(async () =>
      saved ? { kind: "OK", operation: saved } : { kind: "ERROR", code: "OFFICIAL_TEXT_NOT_FOUND" },
    ),
    reserveOfficialText: vi.fn<OfficialTextPersistenceClient["reserveOfficialText"]>(async () => {
      saved = pending();
      return { kind: "OK", operation: saved, replayed: false };
    }),
    completeOfficialText: vi.fn<OfficialTextPersistenceClient["completeOfficialText"]>(async () => {
      saved = completed();
      return { kind: "OK", operation: saved, replayed: false };
    }),
    markOfficialTextNotSent: vi.fn<OfficialTextPersistenceClient["markOfficialTextNotSent"]>(
      async () => ({ kind: "UNKNOWN" }),
    ),
    adoptOfficialText: vi.fn<OfficialTextPersistenceClient["adoptOfficialText"]>(async () => ({
      kind: "UNKNOWN",
    })),
  };
  const runtime = {
    generateText: vi.fn(
      async (
        input: ChatGPTTextCommand,
        options: ChatGPTTextOptions,
      ): Promise<ChatGPTTextResult> => {
        await options.beforeSend({
          operationId: operation,
          profileId: profile,
          model: command.model,
          requestHash: textRequestHash(input),
        });
        return {
          kind: "COMPLETED",
          operationId: operation,
          profileId: profile,
          model: command.model,
          text: completed().proposal!.result.text,
          completedAt: "2026-10-08T06:01:00Z",
          requestHash: request.request_hash,
        };
      },
    ),
  };
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  registerOfficialTextHandlers<boolean>(
    (channel, handler) => handlers.set(channel, handler),
    () => api,
    (event) => event,
    () => runtime,
  );
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(true, ...args);
  return {
    api,
    runtime,
    handlers,
    invoke,
    saved: (value: OfficialTextOperation | null) => {
      saved = value;
    },
  };
}

describe("trusted official text proposal IPC (synthetic only)", () => {
  it("reserves before inference, persists before return, and never regenerates a known operation", async () => {
    const test = fixture();
    expect(await test.invoke(OFFICIAL_TEXT_CHANNELS.generate, command)).toEqual({
      kind: "OK",
      operation: completed(),
    });
    expect(test.api.reserveOfficialText).toHaveBeenCalledWith(project, episode, request);
    expect(test.api.completeOfficialText).toHaveBeenCalledOnce();
    expect(await test.invoke(OFFICIAL_TEXT_CHANNELS.generate, command)).toEqual({
      kind: "OK",
      operation: completed(),
    });
    expect(test.runtime.generateText).toHaveBeenCalledOnce();
  });
  it("exposes no result-writing renderer channel and rejects unexpected result bytes and frames", async () => {
    const test = fixture();
    expect([...test.handlers.keys()].sort()).toEqual(Object.values(OFFICIAL_TEXT_CHANNELS).sort());
    await expect(
      test.invoke(OFFICIAL_TEXT_CHANNELS.generate, { ...command, result: "fake" }),
    ).rejects.toThrow();
    await expect(
      test.handlers.get(OFFICIAL_TEXT_CHANNELS.generate)!(false, command),
    ).rejects.toThrow("sender");
    expect(test.runtime.generateText).not.toHaveBeenCalled();
    await expect(
      test.invoke(OFFICIAL_TEXT_CHANNELS.adopt, project, episode, operation, {
        confirm: true,
        text: "fake",
      }),
    ).rejects.toThrow();
  });
  it("stops before HTTP when durable reservation fails or is a replay", async () => {
    const test = fixture();
    vi.mocked(test.api.reserveOfficialText).mockResolvedValue({ kind: "UNKNOWN" });
    expect(await test.invoke(OFFICIAL_TEXT_CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "RESERVATION_UNCONFIRMED",
    });
    expect(test.api.completeOfficialText).not.toHaveBeenCalled();
    vi.mocked(test.api.reserveOfficialText).mockResolvedValue({
      kind: "OK",
      operation: pending(),
      replayed: true,
    });
    expect(await test.invoke(OFFICIAL_TEXT_CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
    });
  });
  it("blocks repeated clicks and preserves ambiguous remote outcomes across reconstruction", async () => {
    const test = fixture();
    let resolve!: (value: ChatGPTTextResult) => void;
    test.runtime.generateText.mockImplementationOnce(async (input, options) => {
      await options.beforeSend({
        operationId: operation,
        profileId: profile,
        model: command.model,
        requestHash: textRequestHash(input),
      });
      return await new Promise<ChatGPTTextResult>((done) => {
        resolve = done;
      });
    });
    const first = test.invoke(OFFICIAL_TEXT_CHANNELS.generate, command);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    expect(await test.invoke(OFFICIAL_TEXT_CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "GENERATION_BUSY",
    });
    resolve({ kind: "REMOTE_UNKNOWN", operationId: operation, code: "NETWORK_INTERRUPTED" });
    expect(await first).toMatchObject({ kind: "REMOTE_UNKNOWN" });
    const restarted = fixture();
    restarted.saved(pending());
    expect(await restarted.invoke(OFFICIAL_TEXT_CHANNELS.generate, command)).toEqual({
      kind: "OK",
      operation: pending(),
    });
    expect(restarted.runtime.generateText).not.toHaveBeenCalled();
  });
  it("does not declare success if local completion is lost or mismatched", async () => {
    const test = fixture();
    vi.mocked(test.api.completeOfficialText).mockResolvedValue({ kind: "UNKNOWN" });
    expect(await test.invoke(OFFICIAL_TEXT_CHANNELS.generate, command)).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "RESULT_PERSISTENCE_UNCONFIRMED",
    });
    expect(test.runtime.generateText).toHaveBeenCalledOnce();
  });
  it("rejects command reuse and mismatched reservation identity without returning official success", async () => {
    const test = fixture();
    test.saved(completed());
    expect(
      await test.invoke(OFFICIAL_TEXT_CHANNELS.generate, { ...command, text: "Changed request" }),
    ).toMatchObject({ kind: "NOT_SENT", code: "OPERATION_REUSED" });
    expect(test.runtime.generateText).not.toHaveBeenCalled();
    test.saved(null);
    vi.mocked(test.api.reserveOfficialText).mockResolvedValue({
      kind: "OK",
      replayed: false,
      operation: { ...pending(), request: { ...request, input_text: "Different durable bytes" } },
    });
    expect(await test.invoke(OFFICIAL_TEXT_CHANNELS.generate, command)).toMatchObject({
      kind: "NOT_SENT",
      code: "RESERVATION_UNCONFIRMED",
    });
    expect(test.api.completeOfficialText).not.toHaveBeenCalled();
  });
  it("converts a thrown post-inference persistence error into remote-unknown without another generation", async () => {
    const test = fixture();
    vi.mocked(test.api.completeOfficialText).mockRejectedValue(
      new Error("Synthetic transport loss"),
    );
    expect(await test.invoke(OFFICIAL_TEXT_CHANNELS.generate, command)).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "RESULT_PERSISTENCE_UNCONFIRMED",
    });
    expect(test.runtime.generateText).toHaveBeenCalledOnce();
    expect(await test.invoke(OFFICIAL_TEXT_CHANNELS.generate, command)).toEqual({
      kind: "OK",
      operation: pending(),
    });
    expect(test.runtime.generateText).toHaveBeenCalledOnce();
  });
  it("preload has only literal permitted channels and no runtime contracts require", () => {
    const source = readFileSync("src/preload.ts", "utf8");
    for (const channel of Object.values(OFFICIAL_TEXT_CHANNELS))
      expect(source).toContain(`"${channel}"`);
    expect(source).not.toMatch(/(?:import|require).*official-text.*(?:CHANNELS|validOperation)/);
  });
});

describe("closed main-only sidecar responses", () => {
  it("rejects wrong scope, credential extras, inconsistent states and request-id mismatches", async () => {
    expect(validOperation(completed(), project, episode, operation)).toBe(true);
    expect(
      validOperation({ ...completed(), access_token: "synthetic-secret" }, project, episode),
    ).toBe(false);
    expect(validOperation({ ...pending(), status: "COMPLETED" }, project, episode)).toBe(false);
    expect(validOperation(completed(), project, `ep_${"e".repeat(32)}`)).toBe(false);
    const http = vi.fn(async () => ({
      status: 200,
      payload: { data: completed(), request_id: requestId },
      requestId,
    }));
    const client = createOfficialTextClient(http, {});
    expect(await client.getOfficialText(project, episode, operation)).toEqual({
      kind: "OK",
      operation: completed(),
    });
    http.mockResolvedValue({
      status: 200,
      payload: { data: completed(), request_id: profile },
      requestId,
    });
    expect(await client.getOfficialText(project, episode, operation)).toEqual({ kind: "UNKNOWN" });
  });
});
