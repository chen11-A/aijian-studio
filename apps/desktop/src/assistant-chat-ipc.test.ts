import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registerAssistantChatHandlers } from "./assistant-chat-ipc";
import { createAssistantReceiptStore, type AssistantReceiptStore } from "./assistant-chat-receipts";
import {
  textRequestHash,
  type ChatGPTTextCommand,
  type ChatGPTTextOptions,
  type ChatGPTTextResult,
} from "./chatgpt-auth-generation";
import type { ChatGPTStatus } from "@aijian/contracts/chatgpt-auth";
import type { AssistantChatPreviewRequest } from "@aijian/contracts/official-text";
import type { AssistantContextClient } from "./assistant-chat-context";

const sessionId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const otherProfile = "33333333-3333-4333-8333-333333333333";
const scope = { projectId: null, episodeId: null, page: "home" };
const request = {
  sessionId,
  scope,
  userText: "怎样让开场更紧张？",
  model: "fixture",
  expectedProfileId: profileId,
  references: [],
};
const directories: string[] = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "aivora-assistant-ipc-test-"));
  directories.push(root);
  return root;
}
afterEach(async () => {
  for (const path of directories.splice(0)) {
    if (!resolve(path).startsWith(resolve(tmpdir(), "aivora-assistant-ipc-test-")))
      throw new Error("Unexpected test cleanup path");
    await rm(path, { recursive: true, force: true });
  }
});
type Handler = (event: { allowed: boolean }, ...args: unknown[]) => Promise<unknown>;
type Harness = ReturnType<typeof harness>;
function harness(
  receipts: AssistantReceiptStore,
  client: AssistantContextClient = {} as AssistantContextClient,
) {
  const handlers = new Map<string, Handler>();
  const event = { allowed: true };
  let activeProfile = profileId;
  let epoch = 0;
  let providerCalls = 0;
  let approval: (() => Promise<boolean>) | null = null;
  let afterProvider: (() => void) | null = null;
  let wrongHash = false;
  let outcome: "COMPLETED" | "REMOTE_UNKNOWN" | "NOT_SENT" = "COMPLETED";
  const status = async (): Promise<ChatGPTStatus> => ({
    provider: "CHATGPT_OFFICIAL",
    runtime: "DESKTOP",
    state: "CONNECTED",
    useScope: "LOCAL_PERSONAL",
    secureStorage: "AVAILABLE",
    activeProfileId: activeProfile,
    profiles: [],
    lastError: null,
    liveVerified: false,
  });
  const generateText = vi.fn(
    async (
      command: ChatGPTTextCommand,
      options: ChatGPTTextOptions,
    ): Promise<ChatGPTTextResult> => {
      if (approval && !(await approval()))
        return { kind: "NOT_SENT", operationId: command.operationId, code: "REQUEST_NOT_APPROVED" };
      try {
        await options.beforeSend({
          operationId: command.operationId,
          profileId: activeProfile,
          model: command.model,
          requestHash: wrongHash ? "sha256:" + "0".repeat(64) : textRequestHash(command),
        });
      } catch (error) {
        return {
          kind: "NOT_SENT",
          operationId: command.operationId,
          code: error instanceof Error ? error.message : "UNKNOWN",
        };
      }
      if (outcome === "NOT_SENT")
        return { kind: "NOT_SENT", operationId: command.operationId, code: "SESSION_CHANGED" };
      providerCalls++;
      afterProvider?.();
      return outcome === "COMPLETED"
        ? {
            kind: "COMPLETED",
            operationId: command.operationId,
            profileId: activeProfile,
            model: command.model,
            requestHash: textRequestHash(command),
            text: "可以先压缩镜头节奏。",
            completedAt: "now",
          }
        : { kind: "REMOTE_UNKNOWN", operationId: command.operationId, code: "NETWORK_UNKNOWN" };
    },
  );
  registerAssistantChatHandlers<{ allowed: boolean }>(
    (channel, handler) => handlers.set(channel, handler),
    () => client,
    (input) => input.allowed,
    () => ({ status, generateText }),
    receipts,
    () => epoch,
  );
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(`assistant-chat:${channel}`);
    if (!handler) throw new Error(`Missing handler ${channel}`);
    return handler(event, ...args);
  };
  return {
    invoke,
    event,
    generateText,
    get providerCalls() {
      return providerCalls;
    },
    switchProfile(value: string) {
      activeProfile = value;
      epoch++;
    },
    setProfileWithoutEpoch(value: string) {
      activeProfile = value;
    },
    approveWith(value: () => Promise<boolean>) {
      approval = value;
    },
    unknown() {
      outcome = "REMOTE_UNKNOWN";
    },
    notSentAfterReserve() {
      outcome = "NOT_SENT";
    },
    afterProvider(value: () => void) {
      afterProvider = value;
    },
    useWrongHash() {
      wrongHash = true;
    },
  };
}
async function ready(app: Harness, input: AssistantChatPreviewRequest = request) {
  const preview = await app.invoke("preview", input);
  expect(preview).toMatchObject({ kind: "READY" });
  return preview as {
    kind: "READY";
    previewId: string;
    operationId: string;
    inputHash: string;
    outboundText: string;
  };
}
const sendOf = (preview: Awaited<ReturnType<typeof ready>>) => ({
  previewId: preview.previewId,
  operationId: preview.operationId,
  inputHash: preview.inputHash,
  expectedProfileId: profileId,
});
function scriptClient() {
  const projectId = "prj_" + "a".repeat(32);
  const episodeId = "ep_" + "b".repeat(32);
  const versionId = "ver_" + "c".repeat(32);
  const sceneId = "scn_" + "d".repeat(32);
  let contentHash = "sha256:" + "e".repeat(64);
  const client = {
    getProject: vi.fn(async () => ({ data: { id: projectId, name: "项目" } })),
    getEpisode: vi.fn(async () => ({
      data: { id: episodeId, project_id: projectId, title: "第一集" },
    })),
    getEpisodeScript: vi.fn(async () => ({
      kind: "FOUND",
      receipt: {
        data: {
          version_id: versionId,
          head_revision: 1,
          content_hash: contentHash,
          content: { scenes: [{ scene_id: sceneId, ordinal: 1, heading: "夜巷", blocks: [] }] },
        },
      },
    })),
    getEpisodeStoryboard: vi.fn(),
    getProjectCreativeLibrary: vi.fn(),
  } as unknown as AssistantContextClient;
  const input: AssistantChatPreviewRequest = {
    ...request,
    scope: { projectId, episodeId, page: "script" },
    references: [
      { objectKind: "SCRIPT_SCENE", objectId: sceneId, versionId, contentHash, headRevision: 1 },
    ],
  };
  return {
    client,
    input,
    changeHead() {
      contentHash = "sha256:" + "f".repeat(64);
    },
  };
}

describe("assistant main IPC", () => {
  it("freezes one request, sends once, keeps metadata and loses plaintext on restart", async () => {
    const receipts = createAssistantReceiptStore(await directory());
    const app = harness(receipts);
    const preview = await ready(app);
    expect(preview.outboundText.match(/怎样让开场更紧张？/g)).toHaveLength(1);
    const result = await app.invoke("send", sendOf(preview));
    expect(result).toMatchObject({ kind: "COMPLETED", operationId: preview.operationId });
    expect(app.providerCalls).toBe(1);
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({ kind: "NOT_SENT" });
    const restarted = harness(receipts);
    expect(
      await restarted.invoke("get-operation", {
        operationId: preview.operationId,
        expectedProfileId: profileId,
        scope,
      }),
    ).toEqual({ kind: "COMPLETED_UNAVAILABLE", operationId: preview.operationId });
  });

  it("does not return a completed reply for another project and expires a session after account switching", async () => {
    const store = createAssistantReceiptStore(await directory());
    const saved = scriptClient();
    const app = harness(store, saved.client);
    const preview = await ready(app, saved.input);
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({ kind: "COMPLETED" });
    expect(
      await app.invoke("get-operation", {
        operationId: preview.operationId,
        expectedProfileId: profileId,
        scope: { ...saved.input.scope, page: "review" },
      }),
    ).toMatchObject({ kind: "COMPLETED" });
    const anotherScope = { projectId: "prj_" + "9".repeat(32), episodeId: null, page: "project" };
    expect(
      await app.invoke("get-operation", {
        operationId: preview.operationId,
        expectedProfileId: profileId,
        scope: anotherScope,
      }),
    ).toEqual({ kind: "NOT_FOUND", operationId: preview.operationId });
    expect(
      await app.invoke("get-operation", {
        operationId: preview.operationId,
        expectedProfileId: profileId,
        scope: { ...saved.input.scope, episodeId: "ep_" + "8".repeat(32) },
      }),
    ).toEqual({ kind: "NOT_FOUND", operationId: preview.operationId });
    app.switchProfile(otherProfile);
    app.switchProfile(profileId);
    expect(await app.invoke("preview", saved.input)).toEqual({
      kind: "NOT_READY",
      code: "ACCOUNT_CHANGED",
    });
  });

  it("holds unknown outcomes across new sessions, page changes and reconstructed main", async () => {
    const receipts = createAssistantReceiptStore(await directory());
    const app = harness(receipts);
    app.unknown();
    const preview = await ready(app);
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({ kind: "REMOTE_UNKNOWN" });
    expect(app.providerCalls).toBe(1);
    const another = harness(receipts);
    expect(
      await another.invoke("list-pending", {
        scope: { ...scope, page: "storyboard" },
        expectedProfileId: profileId,
      }),
    ).toEqual({ kind: "OK", operationIds: [preview.operationId] });
    expect(
      await another.invoke("preview", {
        ...request,
        sessionId: otherProfile,
        scope: { ...scope, page: "storyboard" },
      }),
    ).toEqual({ kind: "NOT_READY", code: "OUTSTANDING_UNKNOWN" });
    expect(another.providerCalls).toBe(0);
  });

  it("discards while native confirmation waits and never enters provider fetch", async () => {
    const app = harness(createAssistantReceiptStore(await directory()));
    let release: () => void = () => undefined;
    app.approveWith(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    const preview = await ready(app);
    const sending = app.invoke("send", sendOf(preview));
    await vi.waitFor(() => expect(app.generateText).toHaveBeenCalledTimes(1));
    await app.invoke("discard-preview", preview.previewId);
    release();
    expect(await sending).toMatchObject({ kind: "NOT_SENT" });
    expect(app.providerCalls).toBe(0);
  });

  it("refuses native decline, account roundtrip and scope reuse", async () => {
    const store = createAssistantReceiptStore(await directory());
    const app = harness(store);
    const preview = await ready(app);
    app.switchProfile(otherProfile);
    app.switchProfile(profileId);
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({
      kind: "NOT_SENT",
      code: "ACCOUNT_CHANGED",
    });
    const other = harness(store);
    await ready(other);
    expect(
      await other.invoke("preview", {
        ...request,
        scope: { projectId: "prj_" + "a".repeat(32), episodeId: null, page: "project" },
      }),
    ).toMatchObject({ kind: "NOT_READY", code: "SESSION_SCOPE_MISMATCH" });
    const fresh = await ready(other);
    other.approveWith(async () => false);
    expect(await other.invoke("send", sendOf(fresh))).toMatchObject({
      kind: "NOT_SENT",
      code: "REQUEST_NOT_APPROVED",
    });
    expect(other.providerCalls).toBe(0);
  });

  it("fails closed on receipt reservation failure and rejects unauthorized frames", async () => {
    const store = createAssistantReceiptStore(await directory());
    const app = harness({
      ...store,
      reserve: async () => {
        throw new Error("disk failure");
      },
    });
    const preview = await ready(app);
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({
      kind: "NOT_SENT",
      code: "ASSISTANT_RECEIPT_UNAVAILABLE",
    });
    expect(app.providerCalls).toBe(0);
    app.event.allowed = false;
    await expect(app.invoke("preview", request)).rejects.toThrow("not authorized");
  });

  it("expires an old preview when a new one replaces it without exhausting slots", async () => {
    const app = harness(createAssistantReceiptStore(await directory()));
    const first = await ready(app);
    let latest = first;
    for (let index = 0; index < 70; index++) latest = await ready(app);
    expect(await app.invoke("send", sendOf(first))).toMatchObject({
      kind: "NOT_SENT",
      code: "PREVIEW_MISMATCH",
    });
    expect(await app.invoke("send", sendOf(latest))).toMatchObject({ kind: "COMPLETED" });
    expect(app.providerCalls).toBe(1);
  });

  it("invalidates changed saved content after confirmation and before reservation", async () => {
    const saved = scriptClient();
    const app = harness(createAssistantReceiptStore(await directory()), saved.client);
    const preview = await ready(app, saved.input);
    app.approveWith(async () => {
      saved.changeHead();
      return true;
    });
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({
      kind: "NOT_SENT",
      code: "CONTEXT_CHANGED",
    });
    expect(app.providerCalls).toBe(0);
  });

  it("keeps a discarded reservation safely not sent after its durable write", async () => {
    const store = createAssistantReceiptStore(await directory());
    let previewId = "";
    const app = harness({
      ...store,
      reserve: async (receipt) => {
        await store.reserve(receipt);
        await app.invoke("discard-preview", previewId);
      },
    });
    const preview = await ready(app);
    previewId = preview.previewId;
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({
      kind: "NOT_SENT",
      code: "PREVIEW_INVALIDATED",
    });
    expect((await store.get(preview.operationId))?.status).toBe("NOT_SENT");
    expect(app.providerCalls).toBe(0);
  });

  it("conservatively retains unknown when completion or not-sent receipt update fails", async () => {
    const store = createAssistantReceiptStore(await directory());
    const failing = {
      ...store,
      finish: async () => {
        throw new Error("write failure");
      },
    };
    const first = harness(failing);
    const preview = await ready(first);
    expect(await first.invoke("send", sendOf(preview))).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "ASSISTANT_RECEIPT_UNAVAILABLE",
    });
    expect((await store.get(preview.operationId))?.status).toBe("REMOTE_UNKNOWN");
    const second = harness({ ...failing, pending: async () => [] });
    second.notSentAfterReserve();
    const other = await ready(second);
    expect(await second.invoke("send", sendOf(other))).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "ASSISTANT_RECEIPT_UNAVAILABLE",
    });
    expect(second.providerCalls).toBe(0);
  });

  it("reports query identity, no record, unknown and invalid requests without sending", async () => {
    const receipts = createAssistantReceiptStore(await directory());
    const app = harness(receipts);
    const preview = await ready(app);
    expect(
      await app.invoke("get-operation", {
        operationId: preview.operationId,
        expectedProfileId: profileId,
        scope,
      }),
    ).toEqual({ kind: "NOT_FOUND", operationId: preview.operationId });
    expect(await app.invoke("get-operation", {})).toMatchObject({
      kind: "ERROR",
      code: "REQUEST_INVALID",
    });
    expect(await app.invoke("list-pending", {})).toEqual({
      kind: "ERROR",
      code: "REQUEST_INVALID",
    });
    app.switchProfile(otherProfile);
    expect(
      await app.invoke("get-operation", {
        operationId: preview.operationId,
        expectedProfileId: profileId,
        scope,
      }),
    ).toMatchObject({ kind: "ERROR", code: "ACCOUNT_MISMATCH" });
    expect(await app.invoke("list-pending", { scope, expectedProfileId: profileId })).toEqual({
      kind: "ERROR",
      code: "ACCOUNT_MISMATCH",
    });
  });

  it("limits history and reports exactly how many older turns were omitted", async () => {
    const app = harness(createAssistantReceiptStore(await directory()));
    for (let index = 0; index < 7; index++) {
      const preview = await ready(app, { ...request, userText: `追问 ${index}` });
      expect(await app.invoke("send", sendOf(preview))).toMatchObject({ kind: "COMPLETED" });
    }
    const next = await app.invoke("preview", request);
    expect(next).toMatchObject({ kind: "READY", historyOmitted: 2 });
    expect(
      (next as { outboundText: string }).outboundText.match(/怎样让开场更紧张？/g),
    ).toHaveLength(1);
  });

  it("limits active sends and expires stale previews", async () => {
    const app = harness(createAssistantReceiptStore(await directory()));
    const first = await ready(app);
    const second = await ready(app, { ...request, sessionId: otherProfile });
    let release: () => void = () => undefined;
    app.approveWith(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    const sending = app.invoke("send", sendOf(first));
    await vi.waitFor(() => expect(app.generateText).toHaveBeenCalledTimes(1));
    expect(await app.invoke("send", sendOf(second))).toMatchObject({
      kind: "NOT_SENT",
      code: "SCOPE_BUSY",
    });
    expect(
      await app.invoke("preview", {
        ...request,
        sessionId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toEqual({ kind: "NOT_READY", code: "SCOPE_BUSY" });
    release();
    await sending;
    const old = await ready(app);
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60 * 1000);
    expect(await app.invoke("send", sendOf(old))).toMatchObject({
      kind: "NOT_SENT",
      code: "PREVIEW_EXPIRED",
    });
    now.mockRestore();
  });

  it("keeps changed account, context and operation identity out of the provider call", async () => {
    const receipts = createAssistantReceiptStore(await directory());
    const changedAccount = harness(receipts);
    const first = await ready(changedAccount);
    changedAccount.approveWith(async () => {
      changedAccount.switchProfile(otherProfile);
      return true;
    });
    expect(await changedAccount.invoke("send", sendOf(first))).toMatchObject({
      kind: "NOT_SENT",
      code: "PREVIEW_INVALIDATED",
    });
    expect(changedAccount.providerCalls).toBe(0);

    const saved = scriptClient();
    let name = "原项目名";
    vi.mocked(saved.client.getProject).mockImplementation(
      async () =>
        ({ data: { id: saved.input.scope.projectId, name } }) as Awaited<
          ReturnType<typeof saved.client.getProject>
        >,
    );
    const changedHeader = harness(receipts, saved.client);
    const second = await ready(changedHeader, saved.input);
    changedHeader.approveWith(async () => {
      name = "新项目名";
      return true;
    });
    expect(await changedHeader.invoke("send", sendOf(second))).toMatchObject({
      kind: "NOT_SENT",
      code: "CONTEXT_CHANGED",
    });
    expect(changedHeader.providerCalls).toBe(0);
  });

  it("keeps a receipt unknown if account changes after provider completion", async () => {
    const store = createAssistantReceiptStore(await directory());
    const app = harness(store);
    const preview = await ready(app);
    app.afterProvider(() => app.switchProfile(otherProfile));
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      code: "ACCOUNT_CHANGED",
    });
    expect((await store.get(preview.operationId))?.status).toBe("COMPLETED");
  });

  it("fails closed when an unknown receipt appears during approval", async () => {
    const store = createAssistantReceiptStore(await directory());
    const app = harness(store);
    const preview = await ready(app);
    app.approveWith(async () => {
      await store.reserve({
        operationId: "55555555-5555-4555-8555-555555555555",
        profileId,
        projectId: null,
        episodeId: null,
        inputHash: preview.inputHash,
        contextHash: "sha256:" + "a".repeat(64),
        status: "REMOTE_UNKNOWN",
        responseHash: null,
      });
      return true;
    });
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({
      kind: "NOT_SENT",
      code: "OUTSTANDING_UNKNOWN",
    });
    expect(app.providerCalls).toBe(0);
  });

  it("holds query results when profile changes during read or storage fails", async () => {
    const store = createAssistantReceiptStore(await directory());
    const first = harness(store);
    const preview = await ready(first);
    first.unknown();
    await first.invoke("send", sendOf(preview));
    expect(
      await first.invoke("get-operation", {
        operationId: preview.operationId,
        expectedProfileId: profileId,
        scope,
      }),
    ).toMatchObject({ kind: "REMOTE_UNKNOWN" });
    const changed = harness({
      ...store,
      get: async (id) => {
        const value = await store.get(id);
        changed.switchProfile(otherProfile);
        return value;
      },
    });
    expect(
      await changed.invoke("get-operation", {
        operationId: preview.operationId,
        expectedProfileId: profileId,
        scope,
      }),
    ).toMatchObject({ kind: "ERROR", code: "ACCOUNT_CHANGED" });
    const changedList = harness({
      ...store,
      pending: async (scope, profile) => {
        const values = await store.pending(scope, profile);
        changedList.switchProfile(otherProfile);
        return values;
      },
    });
    expect(
      await changedList.invoke("list-pending", { scope, expectedProfileId: profileId }),
    ).toEqual({ kind: "ERROR", code: "ACCOUNT_CHANGED" });
    const broken = harness({
      ...store,
      get: async () => {
        throw new Error("disk failed");
      },
      pending: async () => {
        throw new Error("disk failed");
      },
    });
    expect(
      await broken.invoke("get-operation", {
        operationId: preview.operationId,
        expectedProfileId: profileId,
        scope,
      }),
    ).toMatchObject({ kind: "ERROR", code: "ASSISTANT_RECEIPT_UNAVAILABLE" });
    expect(await broken.invoke("list-pending", { scope, expectedProfileId: profileId })).toEqual({
      kind: "ERROR",
      code: "ASSISTANT_RECEIPT_UNAVAILABLE",
    });
  });

  it("rejects a changed account or unavailable context during preview", async () => {
    const store = createAssistantReceiptStore(await directory());
    const accountApp = harness(store);
    accountApp.switchProfile(otherProfile);
    expect(await accountApp.invoke("preview", request)).toEqual({
      kind: "NOT_READY",
      code: "ACCOUNT_MISMATCH",
    });
    const saved = scriptClient();
    vi.mocked(saved.client.getProject).mockImplementation(async () => {
      contextApp.switchProfile(otherProfile);
      contextApp.switchProfile(profileId);
      return { data: { id: saved.input.scope.projectId, name: "项目" } } as Awaited<
        ReturnType<typeof saved.client.getProject>
      >;
    });
    const contextApp = harness(store, saved.client);
    expect(await contextApp.invoke("preview", saved.input)).toEqual({
      kind: "NOT_READY",
      code: "ACCOUNT_CHANGED",
    });
    vi.mocked(saved.client.getProject).mockRejectedValue(new Error("disk unavailable"));
    const missing = harness(store, saved.client);
    expect(await missing.invoke("preview", saved.input)).toEqual({
      kind: "NOT_READY",
      code: "CONTEXT_UNAVAILABLE",
    });
  });

  it("prunes expired previews and refuses pending unknown before native confirmation", async () => {
    const store = createAssistantReceiptStore(await directory());
    const app = harness(store);
    const old = await ready(app);
    const current = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(current + 6 * 60 * 1000);
    const fresh = await ready(app, { ...request, sessionId: otherProfile });
    clock.mockRestore();
    expect(await app.invoke("send", sendOf(old))).toMatchObject({
      kind: "NOT_SENT",
      code: "PREVIEW_MISMATCH",
    });
    await store.reserve({
      operationId: "66666666-6666-4666-8666-666666666666",
      profileId,
      projectId: null,
      episodeId: null,
      inputHash: fresh.inputHash,
      contextHash: "sha256:" + "a".repeat(64),
      status: "REMOTE_UNKNOWN",
      responseHash: null,
    });
    expect(await app.invoke("send", sendOf(fresh))).toMatchObject({
      kind: "NOT_SENT",
      code: "OUTSTANDING_UNKNOWN",
    });
    expect(app.generateText).not.toHaveBeenCalled();
  });

  it("rejects profile drift and altered runtime operation metadata before HTTP", async () => {
    const store = createAssistantReceiptStore(await directory());
    const profile = harness(store);
    const first = await ready(profile);
    profile.approveWith(async () => {
      profile.setProfileWithoutEpoch(otherProfile);
      return true;
    });
    expect(await profile.invoke("send", sendOf(first))).toMatchObject({
      kind: "NOT_SENT",
      code: "ACCOUNT_CHANGED",
    });
    expect(profile.providerCalls).toBe(0);
    const metadata = harness(store);
    const second = await ready(metadata);
    metadata.useWrongHash();
    expect(await metadata.invoke("send", sendOf(second))).toMatchObject({
      kind: "NOT_SENT",
      code: "OPERATION_MISMATCH",
    });
    expect(metadata.providerCalls).toBe(0);
  });

  it("returns not sent when runtime crashes before reservation", async () => {
    const app = harness(createAssistantReceiptStore(await directory()));
    const preview = await ready(app);
    app.generateText.mockRejectedValueOnce(new Error("runtime failure"));
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({
      kind: "NOT_SENT",
      code: "ASSISTANT_UNAVAILABLE",
    });
    expect(app.providerCalls).toBe(0);
  });

  it("rejects an invalid discard identity without touching a live preview", async () => {
    const app = harness(createAssistantReceiptStore(await directory()));
    const preview = await ready(app);
    await expect(app.invoke("discard-preview", "bad")).rejects.toThrow(
      "Invalid assistant preview ID",
    );
    expect(await app.invoke("send", sendOf(preview))).toMatchObject({ kind: "COMPLETED" });
  });
});
