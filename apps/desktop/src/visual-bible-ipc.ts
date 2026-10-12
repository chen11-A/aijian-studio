import type {
  BrowserWindow,
  IpcMainInvokeEvent,
  WebContentsDidStartNavigationEventParams,
} from "electron";
import {
  visualProjectId,
  visualVersionId,
  visualWriteInput,
  visualReviewInput,
} from "@aijian/contracts/visual-bible";
import { validVisualIdentity } from "./visual-bible-client";
import { createVisualReviewController, validVisualTicket } from "./visual-bible-review";
import { inspectVisualImage, type DecodedVisualImage } from "./visual-image-inspection";
import type { LocalApiClient } from "./api-client";

type Dependencies = {
  getWindow: () => BrowserWindow | null;
  getClient: () => LocalApiClient | null;
  confirm: (window: BrowserWindow, detail: string, signal: AbortSignal) => Promise<boolean>;
  decode: (bytes: Uint8Array) => DecodedVisualImage;
  decoderVersion: () => string;
};
export function registerVisualBibleHandlers(
  handle: (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  dependencies: Dependencies,
) {
  let controller: ReturnType<typeof createVisualReviewController> | null = null;
  let controllerClient: LocalApiClient | null = null;
  const documents = new WeakMap<BrowserWindow, { key: object }>();
  function authorized(event: IpcMainInvokeEvent) {
    const window = dependencies.getWindow(),
      frame = event.senderFrame,
      client = dependencies.getClient();
    if (
      !window ||
      window.isDestroyed() ||
      window.webContents.isDestroyed() ||
      !frame ||
      frame.isDestroyed() ||
      frame.detached ||
      frame !== window.webContents.mainFrame ||
      event.sender !== window.webContents ||
      !client
    )
      throw new Error("G5 native sender is unavailable");
    let document = documents.get(window);
    if (!document) {
      document = { key: {} };
      documents.set(window, document);
      const invalidate = () => {
        document!.key = {};
      };
      window.on("closed", invalidate);
      window.webContents.on("destroyed", invalidate);
      window.webContents.on("render-process-gone", invalidate);
      window.webContents.on(
        "did-start-navigation",
        (details: WebContentsDidStartNavigationEventParams) => {
          if (details.isMainFrame && !details.isSameDocument) invalidate();
        },
      );
    }
    const key = document.key;
    const current = () =>
      dependencies.getWindow() === window &&
      dependencies.getClient() === client &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      !frame.isDestroyed() &&
      !frame.detached &&
      frame === window.webContents.mainFrame &&
      documents.get(window)?.key === key;
    if (controllerClient !== client) {
      controllerClient = client;
      controller = createVisualReviewController(client);
    }
    return { window, client, key, current, controller: controller! };
  }
  const ids = (args: unknown[], count: number) =>
    args.length === count && visualProjectId(args[0]) && (count < 2 || visualVersionId(args[1]));
  const read = (
    channel: string,
    count: number,
    operation: (client: LocalApiClient, args: unknown[]) => Promise<unknown>,
    validate: (args: unknown[]) => boolean = (a) => ids(a, count),
  ) =>
    handle(channel, async (event, ...args) => {
      const origin = authorized(event);
      if (!validate(args)) throw new Error("G5 IPC requires canonical arguments");
      const result = await operation(origin.client, args);
      return origin.current() ? result : { kind: "REMOTE_UNKNOWN" };
    });
  read("visual-bible:review-state", 2, (c, a) =>
    c.getVisualReviewState(a[0] as string, a[1] as string),
  );
  read("visual-bible:index", 1, (c, a) => c.getVisualBible(a[0] as string));
  read(
    "visual-bible:history",
    2,
    (c, a) => c.listVisualBibleVersions(a[0] as string, a[1] as string | null),
    (a) => a.length === 2 && visualProjectId(a[0]) && (a[1] === null || visualVersionId(a[1])),
  );
  read("visual-bible:version", 2, (c, a) =>
    c.getVisualBibleVersion(a[0] as string, a[1] as string),
  );
  read("visual-bible:readiness", 2, (c, a) =>
    c.getVisualBibleReadiness(a[0] as string, a[1] as string),
  );
  read("visual-bible:authority", 2, (c, a) =>
    c.getVisualBibleAuthority(a[0] as string, a[1] as string),
  );
  read(
    "visual-bible:review-operation",
    3,
    (c, a) => c.readVisualReviewOperation(a[0] as string, a[1] as string, a[2] as string),
    (a) =>
      a.length === 3 &&
      visualProjectId(a[0]) &&
      visualVersionId(a[1]) &&
      typeof a[2] === "string" &&
      /^chg_[0-9a-f]{32}$/.test(a[2]),
  );
  read(
    "visual-bible:inspection-operation",
    2,
    (c, a) => c.getVisualInspectionOperation(a[0] as string, a[1] as string),
    (a) =>
      a.length === 2 &&
      visualProjectId(a[0]) &&
      typeof a[1] === "string" &&
      /^vinop_[0-9a-f]{32}$/.test(a[1]),
  );
  for (const [channel, recover] of [
    ["visual-bible:save", false],
    ["visual-bible:save-operation", true],
  ] as const) {
    handle(channel, async (event, ...args) => {
      const origin = authorized(event);
      if (
        args.length !== 3 ||
        !visualProjectId(args[0]) ||
        typeof args[1] !== "string" ||
        !/^vbsave_[0-9a-f]{32}$/.test(args[1]) ||
        !visualWriteInput(args[2], args[0])
      )
        throw new Error("G5 save requires exact closed content");
      const result = await (recover
        ? origin.client.getVisualSaveOperation(args[0], args[1], args[2])
        : origin.client.saveVisualBible(args[0], args[1], args[2]));
      return origin.current() ? result : { kind: "REMOTE_UNKNOWN" };
    });
  }
  handle("visual-bible:prepare", async (event, ...args) => {
    const origin = authorized(event);
    if (args.length !== 2 || !validVisualIdentity(args[0]) || !visualReviewInput(args[1]))
      throw new Error("G5 prepare requires exact identity and action");
    const result = await origin.controller.prepare(args[0], args[1], origin.key);
    return origin.current() ? result : { kind: "CANCELLED" };
  });
  handle("visual-bible:confirm", async (event, ...args) => {
    const origin = authorized(event);
    if (args.length !== 1 || !validVisualTicket(args[0]))
      throw new Error("G5 confirmation requires issued ticket");
    const abort = new AbortController();
    const cancel = () => abort.abort();
    const navigate = (details: WebContentsDidStartNavigationEventParams) => {
      if (details.isMainFrame && !details.isSameDocument) cancel();
    };
    origin.window.on("closed", cancel);
    origin.window.webContents.on("destroyed", cancel);
    origin.window.webContents.on("render-process-gone", cancel);
    origin.window.webContents.on("did-start-navigation", navigate);
    try {
      if (!origin.current()) cancel();
      return await origin.controller.confirm(
        args[0],
        origin.key,
        abort.signal,
        async (detail, signal) =>
          origin.current() &&
          !signal.aborted &&
          (await dependencies.confirm(origin.window, detail, signal)) &&
          origin.current() &&
          !signal.aborted,
      );
    } finally {
      abort.abort();
      origin.window.removeListener("closed", cancel);
      origin.window.webContents.removeListener("destroyed", cancel);
      origin.window.webContents.removeListener("render-process-gone", cancel);
      origin.window.webContents.removeListener("did-start-navigation", navigate);
    }
  });
  handle("visual-bible:inspect", async (event, ...args) => {
    const origin = authorized(event);
    const [p, a, v, hash, op] = args;
    if (
      args.length !== 5 ||
      !visualProjectId(p) ||
      typeof a !== "string" ||
      !/^asset_[0-9a-f]{32}$/.test(a) ||
      typeof v !== "string" ||
      !/^asv_[0-9a-f]{32}$/.test(v) ||
      typeof hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(hash) ||
      typeof op !== "string" ||
      !/^vinop_[0-9a-f]{32}$/.test(op)
    )
      throw new Error("Native inspection requires exact media identity");
    const preview = await origin.client.readProjectMediaAssetPreview(p, a, v);
    if (preview.kind !== "READY") return { kind: "REMOTE_UNKNOWN" };
    if (preview.sha256 !== hash || !origin.current()) return { kind: "CANCELLED" };
    let evidence;
    try {
      evidence = inspectVisualImage(
        preview.bytes,
        preview.mime_type,
        hash,
        op,
        dependencies.decoderVersion(),
        dependencies.decode,
      );
    } catch {
      return { kind: "CANCELLED" };
    }
    if (!origin.current()) return { kind: "CANCELLED" };
    const result = await origin.client.persistVisualInspection(p, a, v, evidence);
    return origin.current() ? result : { kind: "REMOTE_UNKNOWN" };
  });
}
