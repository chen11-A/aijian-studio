import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import type { BrowserWindow, IpcMainInvokeEvent, OpenDialogReturnValue } from "electron";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import { createMediaToolchainClient, type MediaToolchainClient } from "./media-toolchain-client";
import {
  MEDIA_TOOLCHAIN_CHANNELS,
  isMediaToolchainStatus,
  type MediaToolchainResult,
  type MediaToolchainStatus,
} from "./media-toolchain-contract";
import {
  MEDIA_TOOLCHAIN_PICKER_TIMEOUT_MS,
  registerMediaToolchainHandlers,
} from "./media-toolchain-ipc";

const directory = resolve("verified-media-tools");
const available: MediaToolchainStatus = {
  schema_version: 1,
  state: "AVAILABLE",
  source: "EXTERNAL",
  profile_id: "windows-x86_64-gyan-full-8.1.2-dev",
  version: "8.1.2",
  directory,
  diagnostic: "Verified tools are available for local DRAFT media operations.",
  can_probe: true,
  can_preview: true,
  can_draft_export: true,
  formal_release_approved: false,
};
const notConfigured: MediaToolchainStatus = {
  ...available,
  state: "NOT_CONFIGURED",
  source: "NONE",
  profile_id: null,
  version: null,
  directory: null,
  diagnostic: "No external toolchain selected.",
  can_probe: false,
  can_preview: false,
  can_draft_export: false,
};
const found = (status = available): MediaToolchainResult => ({ kind: "STATUS", status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function setup() {
  let windowDestroyed = false;
  let contentsDestroyed = false;
  let frameDestroyed = false;
  const frame = {
    url: "file:///studio/index.html",
    detached: false,
    isDestroyed: () => frameDestroyed,
  };
  const webContents = Object.assign(new EventEmitter(), {
    mainFrame: frame,
    isDestroyed: () => contentsDestroyed,
  });
  const window = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: () => windowDestroyed,
  });
  const client = {
    getMediaToolchainStatus: vi
      .fn<MediaToolchainClient["getMediaToolchainStatus"]>()
      .mockResolvedValue(found()),
    selectMediaToolchainDirectory: vi
      .fn<MediaToolchainClient["selectMediaToolchainDirectory"]>()
      .mockResolvedValue(found()),
    clearMediaToolchain: vi
      .fn<MediaToolchainClient["clearMediaToolchain"]>()
      .mockResolvedValue(found(notConfigured)),
  };
  let currentWindow: BrowserWindow | null = window as unknown as BrowserWindow;
  let currentClient: MediaToolchainClient | null = client;
  const picker = vi.fn<() => Promise<OpenDialogReturnValue>>().mockResolvedValue({
    canceled: false,
    filePaths: [directory],
  });
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
  >();
  registerMediaToolchainHandlers((channel, fn) => handlers.set(channel, fn), {
    getMainWindow: () => currentWindow,
    getClient: () => currentClient,
    showOpenDialog: picker,
  });
  const event = { sender: webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const invoke = (action: keyof typeof MEDIA_TOOLCHAIN_CHANNELS, ...args: unknown[]) =>
    handlers.get(MEDIA_TOOLCHAIN_CHANNELS[action])!(event, ...args);
  const expectClean = () => {
    expect(window.listenerCount("closed")).toBe(0);
    for (const name of ["destroyed", "render-process-gone", "did-start-navigation"])
      expect(webContents.listenerCount(name)).toBe(0);
  };
  return {
    invoke,
    client,
    picker,
    event,
    window,
    webContents,
    frame,
    handlers,
    expectClean,
    destroyWindow: () => {
      windowDestroyed = true;
    },
    destroyContents: () => {
      contentsDestroyed = true;
    },
    destroyFrame: () => {
      frameDestroyed = true;
    },
    replaceWindow: () => {
      currentWindow = {} as BrowserWindow;
    },
    replaceClient: () => {
      currentClient = { ...client };
    },
    clearWindow: () => {
      currentWindow = null;
    },
    clearClient: () => {
      currentClient = null;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("verified native media toolchain contract", () => {
  it("decodes the exact backend-model shared status fixtures", () => {
    const fixtures: unknown = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "../../packages/contracts/fixtures/local-media-toolchain-status.json",
        ),
        "utf8",
      ),
    );
    expect(Array.isArray(fixtures)).toBe(true);
    const statuses = fixtures as unknown[];
    expect(statuses).toHaveLength(6);
    expect(statuses.every(isMediaToolchainStatus)).toBe(true);
    expect((statuses as MediaToolchainStatus[]).slice(0, 4).map((status) => status.state)).toEqual([
      "AVAILABLE",
      "NOT_CONFIGURED",
      "INVALID",
      "UNSUPPORTED",
    ]);
    expect((statuses as MediaToolchainStatus[]).slice(4).map((status) => status.source)).toEqual([
      "DEVELOPMENT_OVERRIDE",
      "DEVELOPMENT_LOCAL",
    ]);
  });
  it("accepts exact available, not-configured, invalid and unsupported receipts", () => {
    expect(isMediaToolchainStatus(available)).toBe(true);
    expect(isMediaToolchainStatus(notConfigured)).toBe(true);
    expect(
      isMediaToolchainStatus({ ...notConfigured, state: "INVALID", source: "EXTERNAL", directory }),
    ).toBe(true);
    expect(isMediaToolchainStatus({ ...notConfigured, state: "UNSUPPORTED" })).toBe(true);
    expect(isMediaToolchainStatus({ ...available, source: "BUNDLED" })).toBe(true);
  });
  it("accepts only the pinned external profile and version while preserving bundled fallback", () => {
    expect(isMediaToolchainStatus(available)).toBe(true);
    for (const changed of [
      { ...available, profile_id: "unapproved-profile" },
      { ...available, version: "8.1.3" },
      { ...available, profile_id: `${available.profile_id} ` },
      { ...available, version: `${available.version} ` },
    ])
      expect(isMediaToolchainStatus(changed)).toBe(false);
    expect(
      isMediaToolchainStatus({
        ...available,
        source: "BUNDLED",
        profile_id: "existing-linux-dev",
        version: "7.1.1",
      }),
    ).toBe(true);
  });
  it("rejects missing/extra keys, coercion, wrong primitives and inflated capabilities", () => {
    for (const key of Object.keys(available)) {
      const incomplete = { ...available } as Record<string, unknown>;
      delete incomplete[key];
      expect(isMediaToolchainStatus(incomplete), key).toBe(false);
    }
    for (const candidate of [
      null,
      [],
      { data: available },
      { ...available, executable: "ffmpeg.exe" },
      { ...available, schema_version: "1" },
      { ...available, state: ["AVAILABLE"] },
      { ...available, source: ["EXTERNAL"] },
      { ...available, state: "UNKNOWN" },
      { ...available, source: "PATH" },
      { ...available, source: "NONE" },
      { ...available, profile_id: null },
      { ...available, version: null },
      { ...available, directory: null },
      { ...available, directory: 123 },
      { ...available, profile_id: "" },
      { ...available, version: "" },
      { ...available, directory: "bad\0path" },
      { ...available, diagnostic: "bad\nmessage" },
      { ...available, can_probe: 1 },
      { ...available, can_preview: false },
      { ...available, can_draft_export: false },
      { ...available, formal_release_approved: true },
      { ...notConfigured, can_probe: true },
      { ...notConfigured, source: "EXTERNAL" },
      { ...notConfigured, profile_id: "unexpected" },
      { ...notConfigured, version: "unexpected" },
      { ...notConfigured, directory },
      { ...available, profile_id: "p".repeat(129) },
      { ...available, version: "v".repeat(129) },
      { ...available, directory: "d".repeat(32_769) },
      { ...available, diagnostic: "d".repeat(2_049) },
    ])
      expect(isMediaToolchainStatus(candidate)).toBe(false);
  });
});

describe("verified media toolchain authenticated transport", () => {
  it("uses only the exact GET/PUT/DELETE routes, authentication and main-selected body", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(available))
      .mockResolvedValueOnce(response(available))
      .mockResolvedValueOnce(response(notConfigured));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43219",
      token: "t".repeat(43),
    });
    expect(await client.getMediaToolchainStatus()).toEqual(found());
    expect(await client.selectMediaToolchainDirectory(directory)).toEqual(found());
    expect(await client.clearMediaToolchain()).toEqual(found(notConfigured));
    expect(fetcher.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ["http://127.0.0.1:43219/api/v1/local-media-toolchain/status", "GET", undefined],
      [
        "http://127.0.0.1:43219/api/v1/local-media-toolchain/selection",
        "PUT",
        JSON.stringify({ directory }),
      ],
      ["http://127.0.0.1:43219/api/v1/local-media-toolchain/selection", "DELETE", undefined],
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init.headers.Authorization).toBe(`Bearer ${"t".repeat(43)}`);
      expect(init.headers.Origin).toBe("app://aijian");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it("preserves candidate INVALID then saved readback without resubmitting or silently clearing", async () => {
    const invalid = { ...notConfigured, state: "INVALID", source: "EXTERNAL", directory };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(response(available));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43219",
      token: "t".repeat(43),
    });
    expect(await client.selectMediaToolchainDirectory(directory)).toEqual({
      kind: "STATUS",
      status: invalid,
    });
    expect(await client.getMediaToolchainStatus()).toEqual(found());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("reports malformed, lost and non-200 responses as unknown, with no retries", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost PUT receipt"))
      .mockResolvedValueOnce(response({ ...available, formal_release_approved: true }))
      .mockResolvedValueOnce(response(notConfigured, 503))
      .mockResolvedValueOnce(new Response("not JSON"));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43219",
      token: "t".repeat(43),
    });
    expect(await client.selectMediaToolchainDirectory(directory)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(await client.getMediaToolchainStatus()).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await client.clearMediaToolchain()).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await client.getMediaToolchainStatus()).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("validates native directories before transport and fails closed if the transport rejects", async () => {
    const readHttp = vi.fn().mockRejectedValue(new Error("unavailable"));
    const client = createMediaToolchainClient(readHttp, {});
    for (const invalid of [
      "relative",
      "",
      `${directory}\0`,
      `${directory}\n`,
      join(directory, "x".repeat(32_769)),
    ])
      expect(() => client.selectMediaToolchainDirectory(invalid)).toThrow("native absolute");
    expect(readHttp).not.toHaveBeenCalled();
    expect(await client.clearMediaToolchain()).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(readHttp).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled sidecar and never retries an ambiguous clear", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43219",
      token: "t".repeat(43),
    });
    const pending = client.clearMediaToolchain();
    await vi.advanceTimersByTimeAsync(90_001);
    expect(await pending).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
  });
});

describe("verified media toolchain native IPC", () => {
  it("cancels only unconfirmed selection on same-document settings cleanup", async () => {
    const h = setup();
    const picker = deferred<OpenDialogReturnValue>();
    h.picker.mockReturnValueOnce(picker.promise);
    const pending = h.invoke("select");
    await Promise.resolve();
    h.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    expect(await h.invoke("cancelSelection")).toEqual({ kind: "CANCELLED" });
    expect(await h.invoke("select")).toEqual({ kind: "PICKER_BUSY" });
    picker.resolve({ canceled: false, filePaths: [directory] });
    expect(await pending).toEqual({ kind: "PICKER_CANCELLED" });
    expect(h.client.selectMediaToolchainDirectory).not.toHaveBeenCalled();
    expect(await h.invoke("cancelSelection")).toEqual({ kind: "NO_PENDING_SELECTION" });
    expect(await h.invoke("select")).toEqual(found());
    expect(h.client.selectMediaToolchainDirectory).toHaveBeenCalledTimes(1);
    h.expectClean();
  });
  it("never claims cancellation can roll back an already submitted setting", async () => {
    const h = setup();
    const submitted = deferred<MediaToolchainResult>();
    h.client.selectMediaToolchainDirectory.mockReturnValueOnce(submitted.promise);
    const pending = h.invoke("select");
    for (
      let index = 0;
      index < 10 && !h.client.selectMediaToolchainDirectory.mock.calls.length;
      index++
    )
      await Promise.resolve();
    expect(h.client.selectMediaToolchainDirectory).toHaveBeenCalledTimes(1);
    expect(await h.invoke("cancelSelection")).toEqual({ kind: "ALREADY_SUBMITTED" });
    submitted.resolve(found());
    expect(await pending).toEqual(found());
    expect(await h.invoke("cancelSelection")).toEqual({ kind: "NO_PENDING_SELECTION" });
    h.expectClean();
  });
  it("opens a main-owned existing-directory picker and passes only the selected directory", async () => {
    const h = setup();
    expect(await h.invoke("select")).toEqual(found());
    expect(h.picker).toHaveBeenCalledExactlyOnceWith(h.window, {
      title: expect.stringContaining("ffmpeg.exe"),
      buttonLabel: expect.any(String),
      properties: ["openDirectory", "dontAddToRecent"],
    });
    expect(h.client.selectMediaToolchainDirectory).toHaveBeenCalledExactlyOnceWith(directory);
    expect(await h.invoke("status")).toEqual(found());
    expect(await h.invoke("clear")).toEqual(found(notConfigured));
    h.expectClean();
  });
  it("rejects every renderer argument including path injection for every channel", async () => {
    const h = setup();
    for (const action of ["status", "select", "clear", "cancelSelection"] as const)
      for (const injected of [directory, { directory }, undefined, null])
        await expect(h.invoke(action, injected)).rejects.toThrow("no arguments");
    expect(h.picker).not.toHaveBeenCalled();
    for (const method of Object.values(h.client)) expect(method).not.toHaveBeenCalled();
    h.expectClean();
  });
  it("rejects untrusted, nested, detached and destroyed senders before any operation", async () => {
    for (const change of [
      (h: ReturnType<typeof setup>) => {
        h.event.sender = {} as IpcMainInvokeEvent["sender"];
      },
      (h: ReturnType<typeof setup>) => {
        Object.assign(h.event, { senderFrame: {} });
      },
      (h: ReturnType<typeof setup>) => {
        Object.assign(h.event, { senderFrame: null });
      },
      (h: ReturnType<typeof setup>) => {
        h.frame.detached = true;
      },
      (h: ReturnType<typeof setup>) => h.destroyWindow(),
      (h: ReturnType<typeof setup>) => h.destroyContents(),
      (h: ReturnType<typeof setup>) => h.destroyFrame(),
      (h: ReturnType<typeof setup>) => h.clearWindow(),
      (h: ReturnType<typeof setup>) => h.clearClient(),
    ]) {
      const h = setup();
      change(h);
      for (const action of ["status", "select", "clear", "cancelSelection"] as const)
        await expect(h.invoke(action)).rejects.toThrow("not authorized");
      expect(h.picker).not.toHaveBeenCalled();
      for (const method of Object.values(h.client)) expect(method).not.toHaveBeenCalled();
      h.expectClean();
    }
  });
  it("does not mutate on cancellation, picker failure, multiple paths or invalid paths", async () => {
    const h = setup();
    h.picker
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })
      .mockRejectedValueOnce(new Error("native dialog failed"))
      .mockResolvedValueOnce({ canceled: false, filePaths: [] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [directory, directory] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["relative"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [`${directory}\0`] });
    expect(await h.invoke("select")).toEqual({ kind: "PICKER_CANCELLED" });
    for (let i = 0; i < 5; i++)
      expect(await h.invoke("select")).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(h.client.selectMediaToolchainDirectory).not.toHaveBeenCalled();
    expect(await h.invoke("select")).toEqual(found());
    h.expectClean();
  });
  it("serializes selection and clear, rejects duplicate picker clicks and avoids premature reads", async () => {
    const h = setup();
    const pendingPicker = deferred<OpenDialogReturnValue>();
    h.picker.mockReturnValueOnce(pendingPicker.promise);
    const pending = h.invoke("select");
    expect(await h.invoke("select")).toEqual({ kind: "PICKER_BUSY" });
    expect(await h.invoke("clear")).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await h.invoke("status")).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(h.client.clearMediaToolchain).not.toHaveBeenCalled();
    expect(h.client.getMediaToolchainStatus).not.toHaveBeenCalled();
    const pendingWrite = deferred<MediaToolchainResult>();
    h.client.selectMediaToolchainDirectory.mockReturnValueOnce(pendingWrite.promise);
    pendingPicker.resolve({ canceled: false, filePaths: [directory] });
    await vi.waitFor(() => expect(h.client.selectMediaToolchainDirectory).toHaveBeenCalledOnce());
    expect(await h.invoke("clear")).toEqual({ kind: "REMOTE_UNKNOWN" });
    pendingWrite.resolve(found());
    expect(await pending).toEqual(found());
    const pendingClear = deferred<MediaToolchainResult>();
    h.client.clearMediaToolchain.mockReturnValueOnce(pendingClear.promise);
    const clearing = h.invoke("clear");
    expect(await h.invoke("select")).toEqual({ kind: "PICKER_BUSY" });
    expect(await h.invoke("clear")).toEqual({ kind: "REMOTE_UNKNOWN" });
    pendingClear.resolve({ kind: "REMOTE_UNKNOWN" });
    expect(await clearing).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await h.invoke("status")).toEqual(found());
    h.expectClean();
  });
  it("rejects a stale status read that overlaps a later mutation", async () => {
    const h = setup();
    const read = deferred<MediaToolchainResult>();
    h.client.getMediaToolchainStatus.mockReturnValueOnce(read.promise);
    const pending = h.invoke("status");
    expect(await h.invoke("clear")).toEqual(found(notConfigured));
    read.resolve(found());
    expect(await pending).toEqual({ kind: "REMOTE_UNKNOWN" });
    h.expectClean();
  });
  it("rechecks original sender, document and client after every asynchronous picker", async () => {
    for (const change of [
      (h: ReturnType<typeof setup>) =>
        h.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false }),
      (h: ReturnType<typeof setup>) => h.webContents.emit("render-process-gone"),
      (h: ReturnType<typeof setup>) => h.webContents.emit("destroyed"),
      (h: ReturnType<typeof setup>) => h.window.emit("closed"),
      (h: ReturnType<typeof setup>) => {
        h.frame.url = "https://untrusted.example/";
      },
      (h: ReturnType<typeof setup>) => {
        h.frame.detached = true;
      },
      (h: ReturnType<typeof setup>) => h.destroyFrame(),
      (h: ReturnType<typeof setup>) => h.destroyContents(),
      (h: ReturnType<typeof setup>) => h.destroyWindow(),
      (h: ReturnType<typeof setup>) => h.replaceWindow(),
      (h: ReturnType<typeof setup>) => h.replaceClient(),
      (h: ReturnType<typeof setup>) => {
        Object.assign(h.event, { senderFrame: {} });
      },
    ]) {
      const h = setup();
      const picker = deferred<OpenDialogReturnValue>();
      h.picker.mockReturnValueOnce(picker.promise);
      const pending = h.invoke("select");
      await vi.waitFor(() => expect(h.picker).toHaveBeenCalledOnce());
      change(h);
      picker.resolve({ canceled: false, filePaths: [directory] });
      await expect(pending).rejects.toThrow("sender changed");
      expect(h.client.selectMediaToolchainDirectory).not.toHaveBeenCalled();
      h.expectClean();
    }
  });
  it("rejects cancellation after navigation and reauthenticates read/clear responses", async () => {
    const h = setup();
    const picker = deferred<OpenDialogReturnValue>();
    h.picker.mockReturnValueOnce(picker.promise);
    const pending = h.invoke("select");
    await vi.waitFor(() => expect(h.picker).toHaveBeenCalledOnce());
    h.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    picker.resolve({ canceled: true, filePaths: [] });
    await expect(pending).rejects.toThrow("sender changed");
    for (const action of ["status", "clear"] as const) {
      const read = deferred<MediaToolchainResult>();
      const method =
        action === "status" ? h.client.getMediaToolchainStatus : h.client.clearMediaToolchain;
      method.mockReturnValueOnce(read.promise);
      const result = h.invoke(action);
      h.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      read.resolve(found());
      await expect(result).rejects.toThrow("sender changed");
    }
    h.expectClean();
  });
  it("does not return a selection receipt to a replaced document after the sidecar write", async () => {
    const h = setup();
    const write = deferred<MediaToolchainResult>();
    h.client.selectMediaToolchainDirectory.mockReturnValueOnce(write.promise);
    const pending = h.invoke("select");
    await vi.waitFor(() => expect(h.client.selectMediaToolchainDirectory).toHaveBeenCalledOnce());
    h.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    write.resolve(found());
    await expect(pending).rejects.toThrow("sender changed");
    expect(h.client.selectMediaToolchainDirectory).toHaveBeenCalledTimes(1);
    expect(await h.invoke("status")).toEqual(found());
    h.expectClean();
  });
  it("does not invalidate the main document for an unrelated subframe navigation", async () => {
    const h = setup();
    const picker = deferred<OpenDialogReturnValue>();
    h.picker.mockReturnValueOnce(picker.promise);
    const pending = h.invoke("select");
    h.webContents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    h.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    picker.resolve({ canceled: false, filePaths: [directory] });
    expect(await pending).toEqual(found());
    h.expectClean();
  });
  it("times out without late submission and retains the busy lock until the dialog closes", async () => {
    vi.useFakeTimers();
    const h = setup();
    const picker = deferred<OpenDialogReturnValue>();
    h.picker.mockReturnValueOnce(picker.promise);
    const pending = h.invoke("select");
    await vi.advanceTimersByTimeAsync(MEDIA_TOOLCHAIN_PICKER_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await h.invoke("select")).toEqual({ kind: "PICKER_BUSY" });
    expect(await h.invoke("clear")).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(h.client.selectMediaToolchainDirectory).not.toHaveBeenCalled();
    picker.resolve({ canceled: false, filePaths: [directory] });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.client.selectMediaToolchainDirectory).not.toHaveBeenCalled();
    expect(await h.invoke("clear")).toEqual(found(notConfigured));
    expect(h.picker).toHaveBeenCalledTimes(1);
    h.expectClean();
  });
  it("drops any runtime renderer arguments in the sandboxed preload", () => {
    const source = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const surfaces = new Map<string, Record<string, (...args: unknown[]) => unknown>>();
    const invoke = vi.fn();
    runInNewContext(compiled, {
      exports: {},
      require: (id: string) => {
        if (id !== "electron") throw new Error(`Unexpected preload runtime import ${id}`);
        return {
          contextBridge: {
            exposeInMainWorld: (
              name: string,
              value: Record<string, (...args: unknown[]) => unknown>,
            ) => surfaces.set(name, value),
          },
          ipcRenderer: { invoke },
        };
      },
    });
    for (const [method, channel] of [
      ["getMediaToolchainStatus", MEDIA_TOOLCHAIN_CHANNELS.status],
      ["selectMediaToolchain", MEDIA_TOOLCHAIN_CHANNELS.select],
      ["clearMediaToolchain", MEDIA_TOOLCHAIN_CHANNELS.clear],
      ["cancelMediaToolchainSelection", MEDIA_TOOLCHAIN_CHANNELS.cancelSelection],
    ] as const) {
      surfaces.get("aijian")![method]!(directory, { directory });
      expect(invoke).toHaveBeenLastCalledWith(channel);
    }
  });
});
