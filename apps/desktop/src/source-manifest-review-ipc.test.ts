import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import ts from "typescript";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  SourceManifestReviewClient,
  SourceManifestResponse,
  SourceManifestPreparedReview,
} from "./api-client";
import {
  createSourceManifestReviewController,
  type SourceManifestReviewConfirmation,
  type SourceManifestReviewOperationResult,
} from "./source-manifest-review";
import {
  registerSourceManifestReviewHandlers,
  type SourceManifestReviewIpcDependencies,
} from "./source-manifest-review-ipc";

const identity = {
  project_id: `prj_${"a".repeat(32)}`,
  version_id: `ver_${"b".repeat(32)}`,
  content_hash: `sha256:${"c".repeat(64)}`,
  expected_revision: 3,
};

const artifactId = `art_${"d".repeat(32)}`;
const submissionId = `sub_${"e".repeat(32)}`;
const requestId = "88ed7974-adc3-4e35-a5c8-38b9674fc45c";
const confirmation: SourceManifestReviewConfirmation = {
  project_id: identity.project_id,
  version_id: identity.version_id,
  content_hash: identity.content_hash,
  gate: "G1",
  action: "submit",
  head_revision: 3,
  review_evidence_revision: 1,
  report_id: `rpt_${"f".repeat(32)}`,
  report_hash: `sha256:${"1".repeat(64)}`,
  rationale: "合成理由 <script>not interpreted</script>",
  title: "送审来源版本",
  description: "仅将当前精确来源版本送审；不会自动签署或批准。",
  account_notice:
    "同一 local-user 账户以 writer/producer 角色操作，允许自审；不代表两个独立人类的审批。",
};
const cancelled: SourceManifestReviewOperationResult = {
  kind: "CANCELLED",
  phase: "confirm_submit",
  identity,
  completed_actions: [],
  receipts: [],
};
type Controller = ReturnType<typeof createSourceManifestReviewController>;

function harness(controller?: Controller) {
  const frame = { isDestroyed: vi.fn(() => false), detached: false, url: "http://127.0.0.1:5173" };
  const webContents = Object.assign(new EventEmitter(), {
    mainFrame: frame,
    isDestroyed: vi.fn(() => false),
  });
  const origin = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: vi.fn(() => false),
  });
  const window = origin as unknown as BrowserWindow;
  const run = vi.fn<Controller["run"]>().mockResolvedValue(cancelled);
  const show = vi
    .fn<SourceManifestReviewIpcDependencies["showMessageBox"]>()
    .mockResolvedValue({ response: 0, checkboxChecked: false });
  const getMainWindow = vi.fn((): BrowserWindow | null => window);
  const getController = vi.fn((): Controller | null => controller ?? { run });
  const listeners = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
  >();
  registerSourceManifestReviewHandlers((channel, listener) => listeners.set(channel, listener), {
    getMainWindow,
    getController,
    showMessageBox: show,
  });
  const event = { sender: webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const invoke = (
    channel = "source-manifest:submit",
    args: unknown[] = [identity],
    caller = event,
  ) => listeners.get(channel)!(caller, ...args);
  const listenerCount = () => origin.eventNames().length + webContents.eventNames().length;
  return {
    frame,
    webContents,
    origin,
    window,
    run,
    show,
    getMainWindow,
    getController,
    listeners,
    event,
    invoke,
    listenerCount,
  };
}

function manifest(inReview = false): SourceManifestResponse {
  return {
    request_id: requestId,
    data: {
      project_id: identity.project_id,
      head: {
        artifact_id: artifactId,
        latest_version_id: identity.version_id,
        review_version_id: inReview ? identity.version_id : null,
        review_submission_id: inReview ? submissionId : null,
        accepted_version_id: null,
        revision: 3,
        review_evidence_revision: 1,
        updated_at: new Date().toISOString(),
      },
      latest_version: {
        id: identity.version_id,
        artifact_id: artifactId,
        version_number: 1,
        schema_version: "1.0.0",
        content_hash: identity.content_hash,
        content: { documents: [], scope_type: "full_work" },
        parent_version_id: null,
        change_summary: "Synthetic",
        created_at: new Date().toISOString(),
      },
      review_version: null,
      accepted_version: null,
    },
  };
}

function prepared(action: "signoff" | "decision"): SourceManifestPreparedReview {
  const expires = new Date(Date.now() + 300_000).toISOString();
  return {
    request_id: requestId,
    data: {
      confirmation_token: "synthetic-private-token",
      report: {
        id: confirmation.report_id!,
        artifact_id: artifactId,
        version_id: identity.version_id,
        gate: "G1",
        submission_id: submissionId,
        policy_code: "g1.source-manifest",
        policy_version: "1",
        head_revision: 3,
        review_evidence_revision: 1,
        report: {
          ready: true,
          blocking: [],
          policy_code: "g1.source-manifest",
          policy_version: "1",
          policy_snapshot_hash: `sha256:${"2".repeat(64)}`,
        },
        report_hash: confirmation.report_hash!,
        created_at: new Date().toISOString(),
        expires_at: expires,
      },
      challenge: {
        id: `chg_${"3".repeat(32)}`,
        artifact_id: artifactId,
        version_id: identity.version_id,
        gate: "G1",
        action,
        readiness_report_id: confirmation.report_id!,
        head_revision: action === "decision" ? 4 : 3,
        review_evidence_revision: 1,
        created_at: new Date().toISOString(),
        expires_at: expires,
        consumed_at: null,
      },
    },
  };
}

function client() {
  return {
    getSourceManifestForReview: vi
      .fn<SourceManifestReviewClient["getSourceManifestForReview"]>()
      .mockResolvedValue({ kind: "SUCCEEDED", receipt: manifest() }),
    prepareSourceManifestSubmit: vi.fn<SourceManifestReviewClient["prepareSourceManifestSubmit"]>(),
    submitSourceManifestReview: vi.fn<SourceManifestReviewClient["submitSourceManifestReview"]>(),
    prepareSourceManifestSignoff:
      vi.fn<SourceManifestReviewClient["prepareSourceManifestSignoff"]>(),
    signoffSourceManifestReview: vi.fn<SourceManifestReviewClient["signoffSourceManifestReview"]>(),
    prepareSourceManifestDecision:
      vi.fn<SourceManifestReviewClient["prepareSourceManifestDecision"]>(),
    decideSourceManifestReview: vi.fn<SourceManifestReviewClient["decideSourceManifestReview"]>(),
    copySourceManifestDraft: vi.fn<SourceManifestReviewClient["copySourceManifestDraft"]>(),
  };
}

afterEach(() => vi.useRealTimers());

describe("exact source review arguments and lifetime", () => {
  test.each([
    "child",
    "other sender",
    "missing frame",
    "undefined frame",
    "destroyed frame",
    "detached frame",
    "destroyed contents",
    "destroyed window",
    "missing window",
  ])("rejects %s before controller lookup", async (mode) => {
    const h = harness();
    let event = h.event;
    if (mode === "child")
      event = { ...event, senderFrame: { ...h.frame } } as unknown as IpcMainInvokeEvent;
    if (mode === "other sender") event = { ...event, sender: {} } as IpcMainInvokeEvent;
    if (mode === "missing frame") event = { ...event, senderFrame: null };
    if (mode === "undefined frame")
      event = { ...event, senderFrame: undefined } as unknown as IpcMainInvokeEvent;
    if (mode === "destroyed frame") h.frame.isDestroyed.mockReturnValue(true);
    if (mode === "detached frame") h.frame.detached = true;
    if (mode === "destroyed contents") h.webContents.isDestroyed.mockReturnValue(true);
    if (mode === "destroyed window") h.origin.isDestroyed.mockReturnValue(true);
    if (mode === "missing window") h.getMainWindow.mockReturnValue(null);
    await expect(h.invoke(undefined, [{ actor: "attacker" }], event)).rejects.toThrow(
      "Local API is not available",
    );
    expect(h.getController).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
    expect(h.show).not.toHaveBeenCalled();
    expect(h.listenerCount()).toBe(0);
  });

  const invalidArgs: unknown[][] = [
    [],
    [identity, {}],
    [null],
    [[]],
    ["value"],
    [{}],
    [{ ...identity, intent: "submit" }],
    [{ ...identity, actor: "local-user" }],
    [{ ...identity, signal: {} }],
    [{ ...identity, confirm: true }],
    [{ ...identity, project_id: "prj_BAD" }],
    [{ ...identity, version_id: 1 }],
    [{ ...identity, content_hash: "sha256:BAD" }],
    [{ ...identity, expected_revision: "3" }],
    [{ ...identity, expected_revision: 0 }],
    [{ ...identity, expected_revision: 1.5 }],
    [{ ...identity, expected_revision: Number.MAX_SAFE_INTEGER }],
    [{ ...identity, expected_revision: Infinity }],
  ];
  test.each(invalidArgs.map((args) => ({ args })))(
    "rejects malformed arguments %# with zero controller calls",
    async ({ args }) => {
      const h = harness();
      await expect(h.invoke(undefined, args)).rejects.toThrow("exact canonical arguments");
      expect(h.getController).not.toHaveBeenCalled();
      expect(h.listenerCount()).toBe(0);
    },
  );
  test.each([undefined, null, 1, "", " spaced ", "x".repeat(1001)])(
    "rejects noncanonical rationale %#",
    async (rationale) => {
      const h = harness();
      await expect(
        h.invoke("source-manifest:confirm-baseline", [{ ...identity, rationale }]),
      ).rejects.toThrow("exact canonical arguments");
      expect(h.getController).not.toHaveBeenCalled();
    },
  );
  test("registers exactly three channels, snapshots inputs and returns results unchanged", async () => {
    const h = harness();
    expect([...h.listeners.keys()]).toEqual([
      "source-manifest:submit",
      "source-manifest:confirm-baseline",
      "source-manifest:copy-draft",
    ]);
    const cases = [
      ["source-manifest:submit", "submit"],
      ["source-manifest:confirm-baseline", "confirm_baseline"],
      ["source-manifest:copy-draft", "copy_draft"],
    ] as const;
    for (const [channel, intent] of cases) {
      const input =
        intent === "confirm_baseline"
          ? { ...identity, rationale: "😀".repeat(1000) }
          : { ...identity };
      const pending = h.invoke(channel, [input]);
      input.project_id = `prj_${"9".repeat(32)}`;
      expect(await pending).toBe(cancelled);
      expect(h.run.mock.lastCall?.[0]).toEqual({
        ...input,
        project_id: identity.project_id,
        intent,
      });
      expect(h.listenerCount()).toBe(0);
    }
  });
  test("fails closed when the main controller is unavailable", async () => {
    const h = harness();
    h.getController.mockReturnValue(null);
    await expect(h.invoke()).rejects.toThrow("Local API is not available");
    expect(h.listenerCount()).toBe(0);
  });
  test.each([0, 1, 2, -1, undefined])(
    "only native response 1 approves, response=%s",
    async (response) => {
      const h = harness();
      const signal = new AbortController().signal;
      h.show.mockResolvedValue(
        response === undefined ? undefined! : { response, checkboxChecked: false },
      );
      let accepted;
      h.run.mockImplementation(async (_input, context) => {
        accepted = await context!.confirm!(
          {
            ...confirmation,
            token: "must-not-leak",
            report: { body: "private" },
          } as SourceManifestReviewConfirmation,
          signal,
        );
        return cancelled;
      });
      await h.invoke();
      expect(accepted).toBe(response === 1);
      const [parent, options] = h.show.mock.calls[0]!;
      expect(parent).toBe(h.window);
      expect(options.signal).toBe(signal);
      expect(options).toMatchObject({
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        buttons: ["取消", "确认送审来源版本"],
      });
      for (const expected of [
        identity.project_id,
        identity.version_id,
        `来源内容 hash：${identity.content_hash}`,
        `报告 hash：${confirmation.report_hash}`,
        confirmation.rationale!,
        confirmation.account_notice,
      ])
        expect(options.detail).toContain(expected);
      expect(JSON.stringify(options)).not.toMatch(/must-not-leak|private|confirmation_token/);
      expect(h.listenerCount()).toBe(0);
    },
  );
  test.each(["throw", "reject", "abort", "replace window", "replace frame", "changed URL"])(
    "does not approve after %s",
    async (mode) => {
      const h = harness();
      const stop = new AbortController();
      let accepted;
      h.show.mockImplementation(() => {
        if (mode === "throw") throw new Error("private details");
        if (mode === "reject") return Promise.reject(new Error("private details"));
        if (mode === "abort") stop.abort();
        if (mode === "replace window") h.getMainWindow.mockReturnValue({} as BrowserWindow);
        if (mode === "replace frame") h.webContents.mainFrame = { ...h.frame };
        if (mode === "changed URL") h.frame.url = "http://127.0.0.1:5173/other";
        return Promise.resolve({ response: 1, checkboxChecked: false });
      });
      h.run.mockImplementation(async (_input, context) => {
        accepted = await context!.confirm!(confirmation, stop.signal);
        return cancelled;
      });
      await h.invoke();
      expect(accepted).toBe(false);
      expect(h.listenerCount()).toBe(0);
    },
  );
  test.each(["already aborted", "closed", "destroyed", "renderer gone", "navigation"])(
    "cancels before showing a dialog on %s",
    async (mode) => {
      const h = harness();
      const stop = new AbortController();
      let accepted;
      h.run.mockImplementation(async (_input, context) => {
        if (mode === "already aborted") stop.abort();
        if (mode === "closed") h.origin.emit("closed");
        if (mode === "destroyed") h.webContents.emit("destroyed");
        if (mode === "renderer gone") h.webContents.emit("render-process-gone");
        if (mode === "navigation")
          h.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
        accepted = await context!.confirm!(confirmation, stop.signal);
        return cancelled;
      });
      await h.invoke();
      expect(accepted).toBe(false);
      expect(h.show).not.toHaveBeenCalled();
      expect(h.listenerCount()).toBe(0);
    },
  );
  test("ignores child/same-document navigation and displays null report values safely", async () => {
    const h = harness();
    h.run.mockImplementation(async (_input, context) => {
      h.webContents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
      h.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
      await context!.confirm!(
        { ...confirmation, report_id: null, report_hash: null, rationale: null },
        new AbortController().signal,
      );
      return cancelled;
    });
    await h.invoke();
    expect(h.show.mock.calls[0]![1].detail).toContain("报告 hash：无\n理由：无");
  });
  test("releases operation listeners even if controller unexpectedly throws", async () => {
    const h = harness();
    h.run.mockRejectedValue(new Error("controller failure"));
    await expect(h.invoke()).rejects.toThrow("Local API is not available");
    expect(h.listenerCount()).toBe(0);
  });
});

describe("real B2 controller through the native adapter", () => {
  test("keeps one project BUSY across calls and aborts the native signal on document loss", async () => {
    const c = client();
    const h = harness(createSourceManifestReviewController(c));
    let nativeSignal: AbortSignal | undefined;
    h.show.mockImplementation((_window, options) => {
      nativeSignal = options.signal;
      return new Promise(() => {});
    });
    const pending = h.invoke("source-manifest:copy-draft");
    await vi.waitFor(() => expect(h.show).toHaveBeenCalledOnce());
    expect(await h.invoke("source-manifest:copy-draft")).toMatchObject({
      kind: "BUSY",
      completed_actions: [],
    });
    expect(c.getSourceManifestForReview).toHaveBeenCalledOnce();
    h.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(await pending).toMatchObject({ kind: "CANCELLED", completed_actions: [] });
    expect(nativeSignal?.aborted).toBe(true);
    expect(c.copySourceManifestDraft).not.toHaveBeenCalled();
    expect(h.listenerCount()).toBe(0);
  });
  test("production five-minute expiry aborts the native signal and late approval never copies", async () => {
    vi.useFakeTimers();
    const c = client();
    const h = harness(createSourceManifestReviewController(c));
    let resolveDialog!: (value: { response: number; checkboxChecked: boolean }) => void;
    let signal: AbortSignal | undefined;
    h.show.mockImplementation((_window, options) => {
      signal = options.signal;
      return new Promise((resolveAnswer) => {
        resolveDialog = resolveAnswer;
      });
    });
    const pending = h.invoke("source-manifest:copy-draft");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await pending).toMatchObject({ kind: "EXPIRED", completed_actions: [] });
    expect(signal?.aborted).toBe(true);
    resolveDialog({ response: 1, checkboxChecked: false });
    await Promise.resolve();
    expect(c.copySourceManifestDraft).not.toHaveBeenCalled();
    expect(h.listenerCount()).toBe(0);
  });
  test.each(["cancel decision", "unknown decision"])(
    "uses two independent native confirmations and retains signoff on %s",
    async (mode) => {
      const c = client();
      c.getSourceManifestForReview.mockResolvedValue({
        kind: "SUCCEEDED",
        receipt: manifest(true),
      });
      const signing = prepared("signoff");
      const deciding = prepared("decision");
      deciding.data.report = structuredClone(signing.data.report);
      c.prepareSourceManifestSignoff.mockResolvedValue({ kind: "SUCCEEDED", receipt: signing });
      c.signoffSourceManifestReview.mockResolvedValue({
        kind: "SUCCEEDED",
        receipt: {
          request_id: requestId,
          data: {
            head: {
              ...manifest(true).data.head,
              revision: 4,
              accepted_version_id: null,
              review_version_id: identity.version_id,
            },
            signoffs: ["writer", "producer"].map((role, i) => ({
              id: `sig_${String(i + 1).repeat(32)}`,
              artifact_id: artifactId,
              version_id: identity.version_id,
              submission_id: submissionId,
              gate: "G1",
              role,
              actor_id: "local-user",
              review_evidence_revision: 1,
              readiness_report_id: signing.data.report.id,
              self_review: true,
              signed_at: new Date().toISOString(),
              supersedes_signoff_id: null,
            })),
          },
        },
      });
      c.prepareSourceManifestDecision.mockResolvedValue({ kind: "SUCCEEDED", receipt: deciding });
      c.decideSourceManifestReview.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
      const h = harness(createSourceManifestReviewController(c));
      h.show.mockResolvedValueOnce({ response: 1, checkboxChecked: false }).mockResolvedValueOnce({
        response: mode === "cancel decision" ? 0 : 1,
        checkboxChecked: false,
      });
      const result = await h.invoke("source-manifest:confirm-baseline", [
        { ...identity, rationale: "合成基线确认" },
      ]);
      expect(result).toMatchObject({
        kind: mode === "cancel decision" ? "CANCELLED" : "REMOTE_UNKNOWN",
        completed_actions: ["signoff"],
        receipts: [{ action: "signoff", report_id: confirmation.report_id }],
      });
      expect(h.show).toHaveBeenCalledTimes(2);
      expect(h.show.mock.calls.every(([parent]) => parent === h.window)).toBe(true);
      expect(h.show.mock.calls[0]![1].detail).toContain("动作：signoff");
      expect(h.show.mock.calls[1]![1].detail).toContain("动作：decision");
      expect(h.show.mock.calls[0]![1].signal).not.toBe(h.show.mock.calls[1]![1].signal);
      expect(c.decideSourceManifestReview).toHaveBeenCalledTimes(
        mode === "cancel decision" ? 0 : 1,
      );
      expect(JSON.stringify(result)).not.toContain("synthetic-private-token");
      expect(h.listenerCount()).toBe(0);
    },
  );
});

describe("production main and sandbox preload wiring", () => {
  test("exposes actual fixed methods with erased type-only relative imports", async () => {
    const source = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    expect(compiled).not.toMatch(/require\(["']\./);
    expect(compiled).not.toContain("source-manifest-review");
    let bridge!: Record<string, (input: unknown) => Promise<unknown>>;
    const invoke = vi.fn().mockResolvedValue(cancelled);
    runInNewContext(compiled, {
      exports: {},
      require: (name: string) => {
        expect(name).toBe("electron");
        return {
          contextBridge: {
            exposeInMainWorld: (_name: string, value: typeof bridge) => {
              bridge = value;
            },
          },
          ipcRenderer: { invoke },
        };
      },
    });
    for (const [method, channel] of [
      ["submitSourceManifest", "source-manifest:submit"],
      ["confirmSourceManifestBaseline", "source-manifest:confirm-baseline"],
      ["copySourceManifestDraft", "source-manifest:copy-draft"],
    ]) {
      expect(await bridge[method!]!(identity)).toBe(cancelled);
      expect(invoke.mock.lastCall).toEqual([channel, identity]);
    }
    expect(source).not.toMatch(/ipcRenderer\.invoke\(channel|ipcRenderer\.send/);
  });
  test("creates the shared controller once after its main-only client and binds the real dialog", () => {
    const main = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
    expect(main.match(/createSourceManifestReviewController\(apiClient\)/g)).toHaveLength(1);
    expect(main).toContain("getController: () => sourceManifestReviewController");
    expect(main).toContain(
      "showMessageBox: (origin, options) => dialog.showMessageBox(origin, options)",
    );
    expect(main).toContain("registerSourceManifestReviewHandlers(");
    expect(main.indexOf("apiClient = createLocalApiClient(")).toBeLessThan(
      main.indexOf("createSourceManifestReviewController(apiClient)"),
    );
  });
});

describe("source manifest privileged IPC", () => {
  test("rejects a child frame before calling the controller", async () => {
    const frame = { isDestroyed: () => false, detached: false, url: "http://127.0.0.1:5173" };
    const webContents = Object.assign(new EventEmitter(), {
      mainFrame: frame,
      isDestroyed: () => false,
    });
    const window = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
    const run = vi.fn().mockResolvedValue({ kind: "CANCELLED" });
    const listeners = new Map<
      string,
      (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
    >();
    registerSourceManifestReviewHandlers((channel, listener) => listeners.set(channel, listener), {
      getMainWindow: () => window as unknown as BrowserWindow,
      getController: () => ({ run }),
      showMessageBox: vi.fn(),
    });
    const event = {
      sender: webContents,
      senderFrame: { ...frame },
    } as unknown as IpcMainInvokeEvent;
    await expect(listeners.get("source-manifest:submit")!(event, identity)).rejects.toThrow(
      "Local API is not available",
    );
    expect(run).not.toHaveBeenCalled();
  });
});
