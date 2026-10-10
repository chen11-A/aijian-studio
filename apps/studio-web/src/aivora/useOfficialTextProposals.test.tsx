import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  OfficialTextBridge,
  OfficialTextOperation,
  OfficialTextRead,
} from "@aijian/contracts/official-text";
import type { ChatGPTBridge } from "@aijian/contracts/chatgpt-auth";
import { DESKTOP_REQUIRED } from "./chatgpt-auth/transport";
import { useOfficialTextProposals } from "./useOfficialTextProposals";
import {
  OfficialConnectionProvider,
  useOfficialConnection,
} from "./chatgpt-auth/ChatGPTConnectionContext";

const project = `prj_${"a".repeat(32)}`,
  episode = `ep_${"b".repeat(32)}`;
const id = "11111111-1111-4111-8111-111111111111";
const hash = `sha256:${"c".repeat(64)}`;
function operation(): OfficialTextOperation {
  return {
    project_id: project,
    episode_id: episode,
    status: "COMPLETED",
    error_code: null,
    created_at: "2026-10-10T00:00:00Z",
    request: {
      operation_id: id,
      profile_id: id,
      model: "synthetic",
      input_text: "Input",
      instructions: null,
      base: null,
      request_hash: hash,
    },
    proposal: {
      version_id: `ver_${"d".repeat(32)}`,
      content_hash: hash,
      result: {
        operation_id: id,
        profile_id: id,
        model: "synthetic",
        request_hash: hash,
        text: "Proposal",
        completed_at: "2026-10-10T00:00:00Z",
      },
    },
    adoption: null,
  };
}
function fixture(operations: OfficialTextOperation[] = []) {
  const bridge = {
    list: vi.fn<OfficialTextBridge["list"]>().mockResolvedValue({ kind: "OK", operations }),
    get: vi.fn<OfficialTextBridge["get"]>().mockResolvedValue({ kind: "UNKNOWN" }),
    generate: vi
      .fn<OfficialTextBridge["generate"]>()
      .mockResolvedValue({ kind: "OK", operation: operation() }),
    adopt: vi.fn<OfficialTextBridge["adopt"]>().mockResolvedValue({ kind: "UNKNOWN" }),
  };
  const models = vi.fn<ChatGPTBridge["models"]>().mockResolvedValue({
    kind: "OK",
    profileId: id,
    models: [{ slug: "synthetic", displayName: "Synthetic test model" }],
  });
  window.aijianOfficialText = bridge;
  window.aijianChatGPT = {
    models,
    status: async () => ({
      ...DESKTOP_REQUIRED,
      runtime: "DESKTOP" as const,
      state: "CONNECTED" as const,
      secureStorage: "AVAILABLE" as const,
      useScope: "LOCAL_PERSONAL" as const,
      activeProfileId: id,
      profiles: [{ id, label: "Fixture account", email: null, connected: true, planUsage: true }],
    }),
    signIn: async () => {
      throw new Error("No live authorization in this test");
    },
    signOut: async () => {
      throw new Error("No live authorization in this test");
    },
    selectProfile: async () => {
      throw new Error("No live authorization in this test");
    },
    cancel: async () => {
      throw new Error("No live authorization in this test");
    },
  };
  const props = {
    projectId: project,
    episodeId: episode,
    base: null,
    disabled: false,
    onBusyChange: vi.fn(),
    onAdopted: vi.fn(async () => undefined),
  };
  return { bridge, models, props };
}
async function authorized(props: ReturnType<typeof fixture>["props"]) {
  const view = renderHook(
    () => ({
      account: useOfficialConnection()!,
      proposal: useOfficialTextProposals(props),
    }),
    { wrapper: OfficialConnectionProvider },
  );
  await waitFor(() => expect(view.result.current.account.connection.loading).toBe(false));
  await act(async () => view.result.current.account.readModels());
  act(() => expect(view.result.current.account.setProjectModel(project, "synthetic")).toBe(true));
  return {
    result: {
      get current() {
        return view.result.current.proposal;
      },
    },
    unmount: view.unmount,
  };
}
beforeEach(() => vi.spyOn(crypto, "randomUUID").mockReturnValue(id));
afterEach(() => {
  cleanup();
  delete window.aijianOfficialText;
  delete window.aijianChatGPT;
  vi.restoreAllMocks();
});

describe("official text hook error and recovery boundaries without live calls", () => {
  test("manual model text cannot generate without a shared verified account", async () => {
    const { bridge, props } = fixture();
    const { result } = renderHook(() => useOfficialTextProposals(props));
    await waitFor(() => expect(result.current.readState).toBe("ready"));
    await act(async () => {
      result.current.setText("Input");
      result.current.setModel("synthetic");
    });
    await act(async () => result.current.generate());
    expect(bridge.generate).not.toHaveBeenCalled();
  });
  test("reading a populated directory never selects the first model automatically", async () => {
    const { props, models } = fixture();
    const { result } = renderHook(() => useOfficialTextProposals(props));
    await act(async () => result.current.loadModels());
    expect(result.current.models).toHaveLength(1);
    expect(result.current.model).toBe("");
    expect(models).toHaveBeenCalledOnce();
  });
  test.each(["absent", "error", "throw"])(
    "initial %s state fails closed and cannot generate",
    async (mode) => {
      const { bridge, props } = fixture();
      if (mode === "absent") delete window.aijianOfficialText;
      else if (mode === "throw") bridge.list.mockRejectedValue(new Error("offline"));
      else bridge.list.mockResolvedValue({ kind: "ERROR", code: "UNAVAILABLE" });
      const { result } = renderHook(() => useOfficialTextProposals(props));
      await waitFor(() => expect(result.current.readState).toBe("error"));
      await act(async () => {
        result.current.setText("Input");
        result.current.setModel("synthetic");
      });
      await act(async () => result.current.generate());
      expect(bridge.generate).not.toHaveBeenCalled();
    },
  );

  test.each(["empty", "error", "throw"])(
    "model catalog %s leaves no invented usable model",
    async (mode) => {
      const { models, props } = fixture();
      if (mode === "empty") models.mockResolvedValue({ kind: "OK", profileId: id, models: [] });
      else if (mode === "error") models.mockResolvedValue({ kind: "ERROR", code: "NO_ACCESS" });
      else models.mockRejectedValue(new Error("offline"));
      const { result } = renderHook(() => useOfficialTextProposals(props));
      await act(async () => result.current.loadModels());
      expect(result.current.model).toBe("");
      expect(result.current.models).toEqual([]);
      expect(result.current.notice).toMatch(
        mode === "empty" ? /没有可用模型/ : mode === "error" ? /NO_ACCESS/ : /读取失败/,
      );
      expect(result.current.busy).toBe(false);
    },
  );

  test.each(["error", "throw", "ok"])(
    "explicit read recovery %s never invokes generation",
    async (mode) => {
      const { bridge, props } = fixture();
      const { result } = renderHook(() => useOfficialTextProposals(props));
      await waitFor(() => expect(result.current.readState).toBe("ready"));
      if (mode === "error") bridge.list.mockResolvedValue({ kind: "UNKNOWN" });
      else if (mode === "throw") bridge.list.mockRejectedValue(new Error("offline"));
      await act(async () => result.current.reload());
      expect(result.current.readState).toBe(mode === "ok" ? "ready" : "error");
      expect(result.current.busy).toBe(false);
      expect(bridge.generate).not.toHaveBeenCalled();
    },
  );

  test.each(["completed", "existing", "not-sent", "unknown", "throw"])(
    "generation %s is one-shot and retains caller text",
    async (mode) => {
      const { bridge, props } = fixture([operation()]);
      if (mode === "existing")
        bridge.generate.mockResolvedValue({
          kind: "OK",
          operation: { ...operation(), status: "REMOTE_UNKNOWN", proposal: null },
        });
      if (mode === "not-sent")
        bridge.generate.mockResolvedValue({ kind: "NOT_SENT", code: "CANCELLED", operationId: id });
      if (mode === "unknown") bridge.generate.mockResolvedValue({ kind: "UNKNOWN" });
      if (mode === "throw") bridge.generate.mockRejectedValue(new Error("reply lost"));
      const { result } = await authorized(props);
      await waitFor(() => expect(result.current.readState).toBe("ready"));
      await act(async () => {
        result.current.setText("Exact synthetic text");
        result.current.setModel("synthetic");
        result.current.setInstructions("Exact instructions");
      });
      await act(async () => {
        const first = result.current.generate();
        const second = result.current.generate();
        await Promise.all([first, second]);
      });
      expect(bridge.generate).toHaveBeenCalledExactlyOnceWith({
        projectId: project,
        episodeId: episode,
        base: null,
        operationId: id,
        expectedProfileId: id,
        model: "synthetic",
        text: "Exact synthetic text",
        instructions: "Exact instructions",
      });
      expect(result.current.text).toBe("Exact synthetic text");
      expect(result.current.busy).toBe(false);
      expect(result.current.operations).toHaveLength(1);
      if (["unknown", "throw"].includes(mode)) {
        expect(result.current.readState).toBe("error");
        await act(async () => result.current.generate());
        expect(bridge.generate).toHaveBeenCalledTimes(1);
      }
      if (mode === "existing") expect(result.current.unknown).toBe(true);
    },
  );

  test.each(["changed", "unknown", "missing-receipt", "throw", "success"])(
    "adoption %s reloads only after a persisted receipt",
    async (mode) => {
      const { bridge, props } = fixture([operation()]);
      if (mode === "changed")
        bridge.adopt.mockResolvedValue({ kind: "ERROR", code: "OFFICIAL_TEXT_SCRIPT_CHANGED" });
      if (mode === "missing-receipt")
        bridge.adopt.mockResolvedValue({ kind: "OK", operation: operation() });
      if (mode === "throw") bridge.adopt.mockRejectedValue(new Error("lost reply"));
      if (mode === "success")
        bridge.adopt.mockResolvedValue({
          kind: "OK",
          operation: {
            ...operation(),
            adoption: {
              script_version_id: `ver_${"e".repeat(32)}`,
              script_content_hash: hash,
              actor_id: "synthetic-human",
              adopted_at: "2026-10-10T00:00:00Z",
            },
          },
        });
      const { result } = renderHook(() => useOfficialTextProposals(props));
      await waitFor(() => expect(result.current.readState).toBe("ready"));
      props.onAdopted.mockImplementation(async () => {
        expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
      });
      await act(async () => result.current.adopt(operation()));
      expect(bridge.adopt).toHaveBeenCalledExactlyOnceWith(project, episode, id, {
        proposal_version_id: operation().proposal!.version_id,
        proposal_content_hash: hash,
        confirm: true,
      });
      expect(props.onAdopted).toHaveBeenCalledTimes(mode === "success" ? 1 : 0);
      expect(result.current.readState).toBe(
        mode === "success" || mode === "changed" ? "ready" : "error",
      );
      expect(result.current.busy).toBe(false);
    },
  );

  test.each(["generate", "adopt", "reload", "loadModels"] as const)(
    "late %s after unmount cannot publish UI success",
    async (action) => {
      const { bridge, models, props } = fixture([operation()]);
      const { result, unmount } =
        action === "generate"
          ? await authorized(props)
          : renderHook(() => useOfficialTextProposals(props));
      await waitFor(() => expect(result.current.readState).toBe("ready"));
      let resolve!: () => void;
      const pending = new Promise<void>((done) => {
        resolve = done;
      });
      const response: OfficialTextRead = { kind: "OK", operation: operation() };
      bridge.generate.mockImplementation(async () => {
        await pending;
        return response;
      });
      bridge.adopt.mockImplementation(async () => {
        await pending;
        return response;
      });
      bridge.list.mockImplementation(async () => {
        await pending;
        return { kind: "OK", operations: [] };
      });
      models.mockImplementation(async () => {
        await pending;
        return { kind: "OK", profileId: id, models: [] };
      });
      await act(async () => {
        result.current.setText("Input");
        result.current.setModel("synthetic");
      });
      let flight: Promise<void>;
      act(() => {
        flight = action === "adopt" ? result.current.adopt(operation()) : result.current[action]();
      });
      unmount();
      await act(async () => {
        resolve();
        await flight;
      });
      expect(props.onAdopted).not.toHaveBeenCalled();
      expect(props.onBusyChange.mock.calls).toEqual([[true]]);
    },
  );
});
