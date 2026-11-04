import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatGPTBridge, ChatGPTStatus } from "./transport";
import { DESKTOP_REQUIRED } from "./transport";
import { useChatGPTConnection } from "./useChatGPTConnection";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const model = { slug: "fixture-text", displayName: "Fixture text" };

function connected(id: string): ChatGPTStatus {
  return {
    ...DESKTOP_REQUIRED,
    runtime: "DESKTOP",
    state: "CONNECTED",
    secureStorage: "AVAILABLE",
    useScope: "LOCAL_PERSONAL",
    activeProfileId: id,
    profiles: [{ id, label: "Fixture account", email: null, connected: true, planUsage: true }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  let current = connected(A);
  let failStatus = false;
  const bridge: ChatGPTBridge = {
    status: vi.fn(async () => {
      if (failStatus) throw new Error("fixture status read failed");
      return current;
    }),
    models: vi.fn(async () => ({ kind: "OK" as const, profileId: A, models: [model] })),
    signIn: vi.fn(async () => ({ kind: "OK" as const, status: current })),
    selectProfile: vi.fn(async () => ({ kind: "OK" as const, status: current })),
    signOut: vi.fn(async () => {
      current = { ...DESKTOP_REQUIRED, runtime: "DESKTOP", secureStorage: "AVAILABLE" };
      return { kind: "OK" as const, status: current };
    }),
    cancel: vi.fn(async () => ({ kind: "CANCELLED" as const, status: current })),
  };
  return {
    bridge,
    changeAccount: (id: string) => {
      current = connected(id);
    },
    failNextStatus: () => {
      failStatus = true;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("official model catalog identity", () => {
  it("publishes a catalog only after the same account is confirmed before and after the read", async () => {
    const f = fixture();
    const view = renderHook(() => useChatGPTConnection(f.bridge));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await act(async () => view.result.current.readModels());
    expect(view.result.current.models).toEqual([model]);
    expect(view.result.current.modelsProfileId).toBe(A);
    view.unmount();
  });

  it("discards A's in-flight catalog when the account changes to B", async () => {
    const f = fixture();
    const pending = deferred<Awaited<ReturnType<ChatGPTBridge["models"]>>>();
    vi.mocked(f.bridge.models).mockImplementationOnce(() => pending.promise);
    const view = renderHook(() => useChatGPTConnection(f.bridge));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    let read!: Promise<void>;
    act(() => {
      read = view.result.current.readModels();
    });
    await waitFor(() => expect(f.bridge.models).toHaveBeenCalledOnce());
    f.changeAccount(B);
    await act(async () => {
      pending.resolve({ kind: "OK", models: [model], profileId: A });
      await read;
    });
    expect(view.result.current.status.activeProfileId).toBe(B);
    expect(view.result.current.models).toEqual([]);
    expect(view.result.current.modelsProfileId).toBeNull();
    view.unmount();
  });

  it("clears a previous catalog and marks authorization unknown when status refresh fails", async () => {
    const f = fixture();
    const view = renderHook(() => useChatGPTConnection(f.bridge));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await act(async () => view.result.current.readModels());
    f.failNextStatus();
    await act(async () => view.result.current.load());
    expect(view.result.current.statusReadFailed).toBe(true);
    expect(view.result.current.models).toEqual([]);
    expect(view.result.current.modelsProfileId).toBeNull();
    view.unmount();
  });

  it("clears a catalog on sign-out and refuses an unbound legacy response", async () => {
    const f = fixture();
    const view = renderHook(() => useChatGPTConnection(f.bridge));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await act(async () => view.result.current.readModels());
    await act(async () => view.result.current.signOut());
    expect(view.result.current.models).toEqual([]);
    expect(view.result.current.modelsProfileId).toBeNull();
    f.changeAccount(A);
    await act(async () => view.result.current.load());
    vi.mocked(f.bridge.models).mockResolvedValueOnce({ kind: "OK", models: [model] });
    await act(async () => view.result.current.readModels());
    expect(view.result.current.models).toEqual([]);
    expect(view.result.current.modelsProfileId).toBeNull();
    view.unmount();
  });

  it("clears A's catalog when selecting B and ignores an older status response", async () => {
    const f = fixture();
    const view = renderHook(() => useChatGPTConnection(f.bridge));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await act(async () => view.result.current.readModels());
    expect(view.result.current.modelsProfileId).toBe(A);
    const oldRead = deferred<ChatGPTStatus>();
    vi.mocked(f.bridge.status).mockImplementationOnce(() => oldRead.promise);
    let loading!: Promise<void>;
    act(() => {
      loading = view.result.current.load();
    });
    f.changeAccount(B);
    await act(async () => view.result.current.select(B));
    await act(async () => {
      oldRead.resolve(connected(A));
      await loading;
    });
    expect(view.result.current.status.activeProfileId).toBe(B);
    expect(view.result.current.models).toEqual([]);
    expect(view.result.current.modelsProfileId).toBeNull();
    view.unmount();
  });

  it("keeps a catalog exception unknown, then allows a fresh checked retry", async () => {
    const f = fixture();
    vi.mocked(f.bridge.models).mockRejectedValueOnce(new Error("fixture catalog failure"));
    const view = renderHook(() => useChatGPTConnection(f.bridge));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await act(async () => view.result.current.readModels());
    expect(view.result.current.statusReadFailed).toBe(true);
    expect(view.result.current.models).toEqual([]);
    expect(view.result.current.modelsProfileId).toBeNull();
    await act(async () => view.result.current.readModels());
    expect(view.result.current.statusReadFailed).toBe(false);
    expect(view.result.current.modelsProfileId).toBe(A);
    view.unmount();
  });

  it("does not overlap a second operation with an in-flight catalog or publish a failed read", async () => {
    const f = fixture();
    const pending = deferred<Awaited<ReturnType<ChatGPTBridge["models"]>>>();
    vi.mocked(f.bridge.models).mockImplementationOnce(() => pending.promise);
    const view = renderHook(() => useChatGPTConnection(f.bridge));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    let read!: Promise<void>;
    act(() => {
      read = view.result.current.readModels();
    });
    await waitFor(() => expect(f.bridge.models).toHaveBeenCalledOnce());
    await act(async () => view.result.current.signOut());
    expect(f.bridge.signOut).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ kind: "ERROR", code: "MODEL_CATALOG_INVALID" });
      await read;
    });
    expect(view.result.current.models).toEqual([]);
    expect(view.result.current.modelsProfileId).toBeNull();
    expect(view.result.current.statusReadFailed).toBe(true);
    view.unmount();
  });
});
