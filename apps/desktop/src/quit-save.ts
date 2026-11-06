import { randomUUID } from "node:crypto";
import type { FilmFlushAck, FilmFlushRequest, FilmFlushStatus } from "@aijian/contracts/quit-save";
export type QuitIntent = "window" | "application";
export type UnsafeQuitChoice = "retry" | "cancel" | "discard";
type Target = { owner: number; send: (request: FilmFlushRequest) => void };
type Host = {
  target: () => Target | null;
  ask: (status: Exclude<FilmFlushStatus, "saved">) => Promise<UnsafeQuitChoice>;
  finish: (intent: QuitIntent) => Promise<void>;
  emptyTargetSaved?: () => boolean;
  timeoutMs?: number;
  requestId?: () => string;
};
/** A close request keeps its renderer alive until a real save ACK or explicit discard. */
export function createQuitSaveCoordinator(host: Host) {
  let active: Promise<"closed" | "cancelled"> | null = null;
  let pending: {
    requestId: string;
    owner: number;
    resolve: (status: FilmFlushStatus) => void;
  } | null = null;
  let finished = false;
  let intent: QuitIntent = "window";
  async function flush(): Promise<FilmFlushStatus> {
    let target: Target | null;
    try {
      target = host.target();
    } catch {
      return "unknown";
    }
    if (!target) return host.emptyTargetSaved?.() ? "saved" : "unknown";
    const requestId = (host.requestId ?? randomUUID)();
    return new Promise((resolve) => {
      const complete = (status: FilmFlushStatus) => {
        clearTimeout(timer);
        if (pending?.requestId === requestId) pending = null;
        resolve(status);
      };
      const timer = setTimeout(() => complete("unknown"), host.timeoutMs ?? 30000);
      pending = { requestId, owner: target.owner, resolve: complete };
      try {
        target.send({ requestId });
      } catch {
        complete("unknown");
      }
    });
  }
  async function run(): Promise<"closed" | "cancelled"> {
    for (;;) {
      const status = await flush();
      let choice: UnsafeQuitChoice;
      if (status === "saved") choice = "discard";
      else {
        try {
          choice = await host.ask(status);
        } catch {
          return "cancelled";
        }
      }
      if (choice === "cancel") return "cancelled";
      if (choice === "retry") continue;
      const acceptedIntent = intent;
      await host.finish(acceptedIntent);
      if (acceptedIntent === "window" && intent === "application") await host.finish("application");
      finished = intent === "application";
      return "closed";
    }
  }
  return {
    request(nextIntent: QuitIntent = "application") {
      if (!active) intent = nextIntent;
      else if (nextIntent === "application") intent = "application";
      if (finished) return Promise.resolve("closed" as const);
      if (!active) {
        active = run().finally(() => {
          active = null;
        });
      }
      return active;
    },
    acknowledge(owner: number, value: unknown): boolean {
      if (!pending || !value || typeof value !== "object" || Array.isArray(value)) return false;
      const ack = value as Partial<FilmFlushAck>;
      if (
        Object.keys(ack).sort().join() !== "requestId,status" ||
        ack.requestId !== pending.requestId ||
        owner !== pending.owner ||
        !["saved", "failed", "busy", "unknown"].includes(ack.status ?? "")
      )
        return false;
      pending.resolve(ack.status!);
      return true;
    },
  };
}

/** Called only after saved/discard approval: block new input before asynchronous cleanup. */
export async function finishApprovedApplicationQuit(host: {
  lockWindow: () => void;
  stopPreview: () => Promise<void>;
  stopSidecar: () => Promise<void>;
  exit: () => void;
}) {
  host.lockWindow();
  await Promise.resolve()
    .then(host.stopPreview)
    .catch(() => undefined);
  await Promise.resolve()
    .then(host.stopSidecar)
    .catch(() => undefined);
  host.exit();
}
