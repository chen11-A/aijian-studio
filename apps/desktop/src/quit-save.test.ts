import { afterEach, expect, it, vi } from "vitest";
import type { FilmFlushRequest } from "@aijian/contracts/quit-save";
import { createQuitSaveCoordinator, finishApprovedApplicationQuit } from "./quit-save";
afterEach(() => vi.useRealTimers());
function fixture() {
  const sent: FilmFlushRequest[] = [];
  const finish = vi.fn(async (_intent: "window" | "application") => undefined);
  const ask = vi.fn(async () => "cancel" as "retry" | "cancel" | "discard");
  let id = 0;
  const coordinator = createQuitSaveCoordinator({
    target: () => ({
      owner: 7,
      send: (request) => {
        sent.push(request);
      },
    }),
    finish,
    ask,
    requestId: () => `request-${++id}`,
    timeoutMs: 10000,
  });
  return { sent, finish, ask, ...coordinator };
}
it("holds repeated close/quit requests beyond 1.5s until the actual authorized matching save ACK", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const closing = f.request();
  expect(f.request()).toBe(closing);
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.finish).not.toHaveBeenCalled();
  expect(f.ask).not.toHaveBeenCalled();
  expect(f.acknowledge(8, { requestId: "request-1", status: "saved" })).toBe(false);
  expect(f.acknowledge(7, { requestId: "old", status: "saved" })).toBe(false);
  expect(f.acknowledge(7, { requestId: "request-1", status: "saved", path: "unexpected" })).toBe(
    false,
  );
  expect(f.acknowledge(7, { requestId: "request-1", status: "saved" })).toBe(true);
  expect(await closing).toBe("closed");
  expect(f.finish).toHaveBeenCalledExactlyOnceWith("application");
  expect(f.ask).not.toHaveBeenCalled();
  expect(f.acknowledge(7, { requestId: "request-1", status: "saved" })).toBe(false);
});
it.each(["failed", "busy", "unknown"] as const)(
  "keeps the window open for %s and allows a later retry with a new identity",
  async (status) => {
    const f = fixture();
    const first = f.request();
    f.acknowledge(7, { requestId: "request-1", status });
    expect(await first).toBe("cancelled");
    expect(f.finish).not.toHaveBeenCalled();
    expect(f.ask).toHaveBeenCalledWith(status);
    const second = f.request();
    expect(f.sent[1]!.requestId).not.toBe(f.sent[0]!.requestId);
    expect(f.acknowledge(7, { requestId: "request-1", status: "saved" })).toBe(false);
    f.acknowledge(7, { requestId: "request-2", status: "saved" });
    expect(await second).toBe("closed");
  },
);
it("treats timeout as unknown, ignores its late ACK, and only closes after explicit discard", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.ask.mockResolvedValueOnce("discard");
  const pending = f.request();
  await vi.advanceTimersByTimeAsync(10000);
  expect(await pending).toBe("closed");
  expect(f.ask).toHaveBeenCalledWith("unknown");
  expect(f.finish).toHaveBeenCalledOnce();
  expect(f.acknowledge(7, { requestId: "request-1", status: "saved" })).toBe(false);
});
it("retries a failed attempt within the same close request without accepting the old ACK", async () => {
  const f = fixture();
  f.ask.mockResolvedValueOnce("retry");
  const pending = f.request();
  f.acknowledge(7, { requestId: "request-1", status: "failed" });
  await vi.waitFor(() => expect(f.sent).toHaveLength(2));
  expect(f.acknowledge(7, { requestId: "request-1", status: "saved" })).toBe(false);
  f.acknowledge(7, { requestId: "request-2", status: "saved" });
  expect(await pending).toBe("closed");
  expect(f.finish).toHaveBeenCalledOnce();
});
it("preserves macOS window-only close and allows a later application quit/new window", async () => {
  const f = fixture();
  const first = f.request("window");
  f.acknowledge(7, { requestId: "request-1", status: "saved" });
  await first;
  expect(f.finish).toHaveBeenLastCalledWith("window");
  const next = f.request("application");
  f.acknowledge(7, { requestId: "request-2", status: "saved" });
  await next;
  expect(f.finish).toHaveBeenLastCalledWith("application");
});
it("upgrades an overlapping window close to an application quit without a second flush", async () => {
  const f = fixture();
  const first = f.request("window");
  expect(f.request("application")).toBe(first);
  f.acknowledge(7, { requestId: "request-1", status: "saved" });
  await first;
  expect(f.finish).toHaveBeenCalledExactlyOnceWith("application");
  expect(f.sent).toHaveLength(1);
});
it("defaults to preserving the app when sending or showing the failure choice fails", async () => {
  const finish = vi.fn();
  const ask = vi.fn(async () => {
    throw new Error("dialog unavailable");
  });
  const f = createQuitSaveCoordinator({
    target: () => ({
      owner: 1,
      send: () => {
        throw new Error("renderer unavailable");
      },
    }),
    ask,
    finish,
  });
  expect(await f.request()).toBe("cancelled");
  expect(finish).not.toHaveBeenCalled();
});
it("locks the actual approved application finish before delayed cleanup; failed/cancelled attempts leave input available", async () => {
  let enabled = true,
    visible = true,
    release!: () => void;
  const actions: string[] = [];
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finish = vi.fn(async () =>
    finishApprovedApplicationQuit({
      lockWindow: () => {
        enabled = false;
        visible = false;
        actions.push("lock");
      },
      stopPreview: async () => {
        actions.push("preview");
        await cleanup;
      },
      stopSidecar: async () => {
        actions.push("sidecar");
      },
      exit: () => {
        actions.push("exit");
      },
    }),
  );
  let requestId = 0;
  const quit = createQuitSaveCoordinator({
    target: () => ({ owner: 7, send: () => undefined }),
    requestId: () => `lock-${++requestId}`,
    ask: async () => "cancel",
    finish,
  });
  const failed = quit.request();
  quit.acknowledge(7, { requestId: "lock-1", status: "failed" });
  expect(await failed).toBe("cancelled");
  expect(enabled).toBe(true);
  expect(visible).toBe(true);
  expect(actions).toEqual([]);
  const approved = quit.request();
  quit.acknowledge(7, { requestId: "lock-2", status: "saved" });
  await vi.waitFor(() => expect(actions).toEqual(["lock", "preview"]));
  expect(enabled).toBe(false);
  expect(visible).toBe(false);
  expect(actions).not.toContain("exit");
  release();
  expect(await approved).toBe("closed");
  expect(actions).toEqual(["lock", "preview", "sidecar", "exit"]);
});
