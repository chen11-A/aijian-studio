import { beforeAll, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  class FakeApp {
    listeners = new Map<string, Array<(...args: any[]) => void>>();
    isPackaged = false;
    quitCalls = 0;
    on = vi.fn((name: string, listener: (...args: any[]) => void) => {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      return this;
    });
    emit = vi.fn((name: string, ...args: any[]) => {
      for (const listener of this.listeners.get(name) ?? []) listener(...args);
    });
    whenReady = vi.fn(async () => undefined);
    setPath = vi.fn();
    getPath = vi.fn(() => "C:\\d4-user-data");
    quit = vi.fn(() => {
      this.quitCalls += 1;
      const event = { preventDefault: vi.fn() };
      this.emit("before-quit", event);
      if (this.quitCalls > 1) this.emit("quit");
    });
  }

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    webContents = {
      mainFrame: {},
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };
    loadFile = vi.fn(async () => undefined);
    show = vi.fn();
    isDestroyed = vi.fn(() => false);
    on = vi.fn();
    once = vi.fn();
    constructor() {
      FakeBrowserWindow.instances.push(this);
    }
  }

  const app = new FakeApp();
  const handlers = new Map<string, (...args: any[]) => any>();
  const ipcMain = { handle: vi.fn((name: string, handler: (...args: any[]) => any) => handlers.set(name, handler)) };
  const ipcListeners = new Map<string, Set<(...args: any[]) => void>>();
  const exposed: Record<string, any> = {};
  const ipcRenderer = {
    invoke: vi.fn(async () => "ready"),
    on: vi.fn((name: string, listener: (...args: any[]) => void) => {
      const listeners = ipcListeners.get(name) ?? new Set();
      listeners.add(listener);
      ipcListeners.set(name, listeners);
    }),
    removeListener: vi.fn((name: string, listener: (...args: any[]) => void) => ipcListeners.get(name)?.delete(listener)),
  };
  const contextBridge = { exposeInMainWorld: vi.fn((_name: string, api: Record<string, any>) => Object.assign(exposed, api)) };
  const sidecarPlans: Array<any> = [];
  const startSidecar = vi.fn(async () => {
    const plan = sidecarPlans.shift();
    if (plan === "reject" || plan === undefined) throw new Error("mock sidecar start rejected");
    return await plan;
  });
  const createLocalApiClient = vi.fn((_fetch: unknown, session: unknown) => ({ session, getHealth: vi.fn() }));
  return {
    app,
    BrowserWindow: FakeBrowserWindow,
    ipcMain,
    handlers,
    ipcRenderer,
    contextBridge,
    exposed,
    ipcListeners,
    sidecarPlans,
    startSidecar,
    createLocalApiClient,
  };
});

vi.mock("electron", () => ({
  app: mock.app,
  BrowserWindow: mock.BrowserWindow,
  dialog: { showMessageBox: vi.fn() },
  ipcMain: mock.ipcMain,
  contextBridge: mock.contextBridge,
  ipcRenderer: mock.ipcRenderer,
}));
vi.mock("./api-client", () => ({ createLocalApiClient: mock.createLocalApiClient }));
vi.mock("./sidecar-process", () => ({ startSidecar: mock.startSidecar }));
vi.mock("./e2e-user-data", () => ({ resolveE2EUserDataDirectory: vi.fn(() => null) }));
vi.mock("./e2e-fake-timeline-run-response-fault", () => ({
  createE2EFakeTimelineRunResponseFault: vi.fn((fetcher) => fetcher),
  shouldEnableE2EFakeTimelineRunResponseFault: vi.fn(() => false),
}));
vi.mock("./e2e-proposal-run-response-fault", () => ({
  createE2EProposalRunResponseFault: vi.fn((fetcher) => fetcher),
  shouldEnableE2EProposalRunResponseFault: vi.fn(() => false),
}));
vi.mock("./agent-skill-catalog-ipc", () => ({ registerAgentSkillCatalogHandlers: vi.fn() }));
vi.mock("./artifact-proposal-contract", () => ({ registerArtifactProposalHandlers: vi.fn() }));
vi.mock("./episode-ipc", () => ({
  createTopLevelEpisodeClientFor: vi.fn(() => vi.fn()),
  registerEpisodeHandlers: vi.fn(),
}));
vi.mock("./fake-timeline-run-contract", () => ({ registerFakeTimelineRunHandlers: vi.fn() }));
vi.mock("./invalidation-operation-ipc", () => ({ registerInvalidationOperationHandlers: vi.fn() }));
vi.mock("./proposal-run-contract", () => ({ registerProposalRunHandlers: vi.fn() }));
vi.mock("./production-brief-ipc", () => ({
  registerProductionBriefHandlers: vi.fn(),
  resolveProductionBriefTopFrameClient: vi.fn(),
}));
vi.mock("./source-manifest-review", () => ({ createSourceManifestReviewController: vi.fn(() => ({})) }));
vi.mock("./source-manifest-review-ipc", () => ({ registerSourceManifestReviewHandlers: vi.fn() }));

function deferred<T = void>() {
  const callbacks: Array<(value: T) => void> = [];
  return {
    exited: { then: (callback: (value: T) => void) => callbacks.push(callback) },
    resolve: (value: T) => callbacks.forEach((callback) => callback(value)),
  };
}

function sidecar(session: string) {
  const lifecycle = deferred();
  return { session, exited: lifecycle.exited, resolve: lifecycle.resolve, stop: vi.fn(async () => undefined) };
}

async function flush() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe("D4 supplement against fixed main/preload source", () => {
  let first: ReturnType<typeof sidecar>;
  let replacement: ReturnType<typeof sidecar>;
  let mainFrame: object;

  beforeAll(async () => {
    first = sidecar("session-1");
    replacement = sidecar("session-2");
    mock.sidecarPlans.push(first, new Promise((resolve) => ((globalThis as any).__d4ReplacementResolve = resolve)));
    await import("./main");
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!mock.BrowserWindow.instances[0])
      throw new Error(
        JSON.stringify({
          browserInstances: mock.BrowserWindow.instances.length,
          startSidecarCalls: mock.startSidecar.mock.calls.length,
          quitCalls: mock.app.quitCalls,
        }),
      );
    mainFrame = mock.BrowserWindow.instances[0]!.webContents.mainFrame;
  });

  it("rejects business IPC immediately on sidecar loss and adopts a new session", async () => {
    const webContents = mock.BrowserWindow.instances[0]!.webContents;
    expect(mock.handlers.get("sidecar:lifecycle:get")!({ sender: webContents, senderFrame: mainFrame })).toBe("ready");
    first.resolve(undefined);
    await flush();
    expect(() => mock.handlers.get("health:get")!({ sender: webContents, senderFrame: mainFrame })).toThrow(
      "Local API is not available",
    );
    (globalThis as any).__d4ReplacementResolve(replacement);
    await flush();
    expect(mock.createLocalApiClient).toHaveBeenCalledWith(expect.anything(), "session-2");
    expect(mock.startSidecar).toHaveBeenCalledTimes(2);
    const sends = mock.BrowserWindow.instances[0]!.webContents.send.mock.calls.map((call: any[]) => call[1]);
    expect(sends).toContain("degraded");
    expect(sends).toContain("ready");
  });

  it("ignores an old generation and does not loop after restart rejection", async () => {
    first.resolve(undefined);
    await flush();
    expect(mock.startSidecar).toHaveBeenCalledTimes(2);
    const before = mock.BrowserWindow.instances[0]!.webContents.send.mock.calls.length;
    first.resolve(undefined);
    await flush();
    expect(mock.BrowserWindow.instances[0]!.webContents.send.mock.calls.length).toBe(before);
    expect(mock.startSidecar).toHaveBeenCalledTimes(2);
  });

  it("enforces current top-frame lifecycle access", () => {
    const handler = mock.handlers.get("sidecar:lifecycle:get")!;
    expect(() => handler({ sender: {}, senderFrame: mainFrame })).toThrow("Sidecar lifecycle is not available");
    expect(handler({ sender: mock.BrowserWindow.instances[0]!.webContents, senderFrame: mainFrame })).toBe("ready");
  });

  it("filters invalid preload states and stops callbacks after unsubscribe", async () => {
    await import("./preload");
    const received: string[] = [];
    const unsubscribe = mock.exposed.subscribeSidecarLifecycle((state: string) => received.push(state));
    const emit = (value: unknown) => {
      for (const listener of mock.ipcListeners.get("sidecar:lifecycle:changed") ?? []) listener({}, value);
    };
    emit("not-a-state");
    emit("ready");
    unsubscribe();
    emit("degraded");
    expect(received).toEqual(["ready"]);
    await expect(mock.exposed.getSidecarLifecycleState()).resolves.toBe("ready");
  });

  it("stops the active replacement on normal quit without restarting", async () => {
    mock.app.quit();
    await flush();
    expect(replacement.stop).toHaveBeenCalledOnce();
    expect(mock.startSidecar).toHaveBeenCalledTimes(2);
    const sends = mock.BrowserWindow.instances[0]!.webContents.send.mock.calls.map((call: any[]) => call[1]);
    expect(sends).toContain("stopping");
  });
});

describe("D4 browser fallback helper", () => {
  it("returns null state and a no-op unsubscribe without a bridge", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    const { createStudioTransport } = await import("../../studio-web/src/api/studio");
    const transport = createStudioTransport();
    await expect(transport.getSidecarLifecycleState?.()).resolves.toBeNull();
    expect(transport.subscribeSidecarLifecycle?.(() => undefined)).toBeTypeOf("function");
  });
});

async function resetMainScenario(plans: any[], query: string) {
  mock.app.listeners.clear();
  mock.app.quitCalls = 0;
  mock.BrowserWindow.instances.length = 0;
  mock.handlers.clear();
  mock.ipcListeners.clear();
  mock.sidecarPlans.length = 0;
  mock.sidecarPlans.push(...plans);
  mock.startSidecar.mockClear();
  mock.createLocalApiClient.mockClear();
  await vi.resetModules();
  await import(`./main?${query}`);
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("D4 isolated restart rejection and pending-quit scenarios", () => {
  it("keeps degraded and does not loop when replacement start rejects", async () => {
    const first = sidecar("reject-first");
    await resetMainScenario([first, "reject"], "d4-restart-reject");
    first.resolve(undefined);
    await flush();
    expect(mock.startSidecar).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mock.startSidecar).toHaveBeenCalledTimes(2);
    const state = mock.handlers.get("sidecar:lifecycle:get")!({
      sender: mock.BrowserWindow.instances[0]!.webContents,
      senderFrame: mock.BrowserWindow.instances[0]!.webContents.mainFrame,
    });
    expect(state).toBe("degraded");
  });

  it("stops a pending replacement when quit begins and never publishes ready", async () => {
    const first = sidecar("pending-first");
    const replacement = sidecar("pending-replacement");
    let resolveReplacement!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolveReplacement = resolve;
    });
    await resetMainScenario([first, pending], "d4-pending-quit");
    first.resolve(undefined);
    await flush();
    expect(mock.startSidecar).toHaveBeenCalledTimes(2);
    mock.app.quit();
    resolveReplacement(replacement);
    await flush();
    expect(replacement.stop).toHaveBeenCalledOnce();
    expect(mock.startSidecar).toHaveBeenCalledTimes(2);
    const sends = mock.BrowserWindow.instances[0]!.webContents.send.mock.calls.map((call: any[]) => call[1]);
    expect(sends).toContain("stopping");
    expect(sends.filter((state: string) => state === "ready")).toHaveLength(1);
  });
});
