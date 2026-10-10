import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ChatGPTBridge, ChatGPTStatus } from "./transport";
import { DESKTOP_REQUIRED } from "./transport";
import { OfficialConnectionProvider, useOfficialConnection } from "./ChatGPTConnectionContext";
import { MODEL_PREFERENCE_KEY } from "./modelPreference";
import { ChatGPTConnectionControls } from "./ChatGPTConnectionCard";
import { useOfficialTextProposals } from "../useOfficialTextProposals";
import type { OfficialTextBridge } from "@aijian/contracts/official-text";

const profileId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const projectId = `prj_${"a".repeat(32)}`;
const connected = (id: string): ChatGPTStatus => ({
  ...DESKTOP_REQUIRED,
  runtime: "DESKTOP",
  state: "CONNECTED",
  secureStorage: "AVAILABLE",
  useScope: "LOCAL_PERSONAL",
  activeProfileId: id,
  profiles: [
    { id: profileId, label: "One", email: null, connected: true, planUsage: true },
    { id: otherId, label: "Two", email: null, connected: true, planUsage: true },
  ],
});

function fixture() {
  let status = connected(profileId);
  const bridge: ChatGPTBridge = {
    status: vi.fn(async () => status),
    models: vi.fn(async () => ({
      kind: "OK" as const,
      profileId: status.activeProfileId!,
      models: [
        { slug: "text-one", displayName: "Text One" },
        { slug: "text-two", displayName: "Text Two" },
      ],
    })),
    signIn: vi.fn(),
    signOut: vi.fn(async () => ({
      kind: "OK" as const,
      status: {
        ...DESKTOP_REQUIRED,
        runtime: "DESKTOP" as const,
        secureStorage: "AVAILABLE" as const,
      },
    })),
    selectProfile: vi.fn(async (id: string) => {
      status = connected(id);
      return { kind: "OK" as const, status };
    }),
    cancel: vi.fn(),
  };
  window.aijianChatGPT = bridge;
  return {
    bridge,
    setStatus: (value: ChatGPTStatus) => {
      status = value;
    },
  };
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <OfficialConnectionProvider>{children}</OfficialConnectionProvider>
);
function CardHarness() {
  const account = useOfficialConnection()!;
  return (
    <>
      <ChatGPTConnectionControls connection={account.connection} selection={account} />
      <output data-testid="choice-verified">{String(account.resolve(projectId).verified)}</output>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  delete window.aijianChatGPT;
  delete window.aijianOfficialText;
});

describe("shared official model selection", () => {
  it("inherits the service default, supports project override and restores the default without inference", async () => {
    const { bridge } = fixture();
    const { result } = renderHook(() => useOfficialConnection()!, { wrapper });
    await waitFor(() => expect(result.current.connection.loading).toBe(false));
    await act(async () => result.current.connection.readModels());
    expect(result.current.catalogProfileId).toBe(profileId);
    act(() => expect(result.current.setDefaultModel("text-one")).toBe(true));
    expect(result.current.resolve(projectId)).toEqual({
      modelSlug: "text-one",
      source: "default",
      verified: true,
    });
    act(() => expect(result.current.setProjectModel(projectId, "text-two")).toBe(true));
    expect(result.current.resolve(projectId)).toEqual({
      modelSlug: "text-two",
      source: "project",
      verified: true,
    });
    act(() => expect(result.current.restoreProjectDefault(projectId)).toBe(true));
    expect(result.current.resolve(projectId).modelSlug).toBe("text-one");
    expect(bridge.models).toHaveBeenCalledOnce();
  });

  it("requires catalog revalidation after remount and invalidates on account switch", async () => {
    fixture();
    const first = renderHook(() => useOfficialConnection()!, { wrapper });
    await waitFor(() => expect(first.result.current.connection.loading).toBe(false));
    await act(async () => first.result.current.connection.readModels());
    act(() => expect(first.result.current.setDefaultModel("text-one")).toBe(true));
    first.unmount();
    const second = renderHook(() => useOfficialConnection()!, { wrapper });
    await waitFor(() => expect(second.result.current.connection.loading).toBe(false));
    expect(second.result.current.resolve(projectId)).toEqual({
      modelSlug: "text-one",
      source: "default",
      verified: false,
    });
    await act(async () => second.result.current.connection.readModels());
    expect(second.result.current.resolve(projectId).verified).toBe(true);
    await act(async () => second.result.current.connection.select(otherId));
    expect(second.result.current.resolve(projectId).verified).toBe(false);
  });

  it("inherits the service choice in a project and prevents submission after a silent account change", async () => {
    const auth = fixture();
    const generate = vi.fn();
    window.aijianOfficialText = {
      list: vi.fn(async () => ({ kind: "OK", operations: [] })),
      generate,
    } as unknown as OfficialTextBridge;
    const { result } = renderHook(
      () => ({
        account: useOfficialConnection()!,
        proposal: useOfficialTextProposals({
          projectId,
          episodeId: `ep_${"b".repeat(32)}`,
          base: null,
          disabled: false,
          onBusyChange: vi.fn(),
          onAdopted: vi.fn(),
        }),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.proposal.readState).toBe("ready"));
    await act(async () => result.current.proposal.loadModels());
    expect(result.current.proposal.model).toBe("");
    act(() => result.current.account.setDefaultModel("text-one"));
    expect(result.current.proposal.model).toBe("text-one");
    expect(result.current.proposal.modelSource).toBe("default");
    act(() => result.current.proposal.setModel("text-two"));
    expect(result.current.proposal.modelSource).toBe("project");
    expect(result.current.proposal.model).toBe("text-two");
    act(() => result.current.proposal.restoreDefaultModel());
    expect(result.current.proposal.model).toBe("text-one");
    act(() => result.current.proposal.setText("Local synthetic input"));
    auth.setStatus(connected(otherId));
    await act(async () => result.current.proposal.generate());
    expect(generate).not.toHaveBeenCalled();
    expect(result.current.proposal.notice).toMatch(/账号或模型目录已变化/);
  });

  it("passes the verified profile to a new text request", async () => {
    fixture();
    const generate = vi.fn(async () => ({
      kind: "NOT_SENT" as const,
      code: "CANCELLED",
      operationId: "synthetic",
    }));
    window.aijianOfficialText = {
      list: vi.fn(async () => ({ kind: "OK", operations: [] })),
      generate,
    } as unknown as OfficialTextBridge;
    const { result } = renderHook(
      () => ({
        account: useOfficialConnection()!,
        proposal: useOfficialTextProposals({
          projectId,
          episodeId: `ep_${"b".repeat(32)}`,
          base: null,
          disabled: false,
          onBusyChange: vi.fn(),
          onAdopted: vi.fn(),
        }),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.proposal.readState).toBe("ready"));
    await act(async () => result.current.account.connection.readModels());
    act(() => {
      result.current.account.setDefaultModel("text-one");
      result.current.proposal.setText("Synthetic input");
    });
    await act(async () => result.current.proposal.generate());
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ expectedProfileId: profileId }),
    );
  });

  it("blocks a previously verified choice after storage failure or external preference change", async () => {
    fixture();
    const { result } = renderHook(() => useOfficialConnection()!, { wrapper });
    await waitFor(() => expect(result.current.connection.loading).toBe(false));
    await act(async () => result.current.connection.readModels());
    act(() => expect(result.current.setDefaultModel("text-one")).toBe(true));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("blocked");
    });
    act(() => expect(result.current.setProjectModel(projectId, "text-two")).toBe(false));
    expect(result.current.preferenceError).toBe(true);
    expect(result.current.resolve(projectId).verified).toBe(false);
    setItem.mockRestore();
    const external = {
      version: 1,
      defaultModel: { provider: "CHATGPT_OFFICIAL", profileId, modelSlug: "text-two" },
      projectOverrides: {},
    };
    localStorage.setItem(MODEL_PREFERENCE_KEY, JSON.stringify(external));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: MODEL_PREFERENCE_KEY })));
    expect(result.current.preferenceIssue).toBe("CONFLICT");
    act(() => expect(result.current.setProjectModel(projectId, "text-one")).toBe(false));
    act(() => result.current.reloadPreference());
    expect(result.current.preferenceError).toBe(false);
    expect(result.current.resolve(projectId).verified).toBe(false);
    await act(async () => result.current.readModels());
    expect(result.current.resolve(projectId)).toEqual({
      modelSlug: "text-two",
      source: "default",
      verified: true,
    });
  });

  it("requires explicit reselection after A to B to A, while ordinary status refresh keeps the choice", async () => {
    fixture();
    const { result } = renderHook(() => useOfficialConnection()!, { wrapper });
    await waitFor(() => expect(result.current.connection.loading).toBe(false));
    await act(async () => result.current.connection.readModels());
    act(() => expect(result.current.setDefaultModel("text-one")).toBe(true));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(result.current.resolve(projectId).verified).toBe(true);
    await act(async () => result.current.connection.load());
    await act(async () => result.current.connection.readModels());
    expect(result.current.resolve(projectId).verified).toBe(true);
    await act(async () => result.current.connection.select(otherId));
    await act(async () => result.current.connection.select(profileId));
    await act(async () => result.current.connection.readModels());
    expect(result.current.requiresReselection).toBe(true);
    expect(result.current.resolve(projectId).verified).toBe(false);
    act(() => expect(result.current.setDefaultModel("text-one")).toBe(true));
    expect(result.current.resolve(projectId).verified).toBe(true);
  });

  it("keeps a saved preference pending after logout and relogin to the same profile", async () => {
    const auth = fixture();
    const { result } = renderHook(() => useOfficialConnection()!, { wrapper });
    await waitFor(() => expect(result.current.connection.loading).toBe(false));
    await act(async () => result.current.readModels());
    act(() => expect(result.current.setDefaultModel("text-one")).toBe(true));
    await act(async () => result.current.connection.signOut());
    vi.mocked(auth.bridge.signIn).mockResolvedValueOnce({
      kind: "OK",
      status: connected(profileId),
    });
    await act(async () => result.current.connection.signIn("LOCAL_PERSONAL"));
    await act(async () => result.current.readModels());
    expect(result.current.requiresReselection).toBe(true);
    expect(result.current.resolve(projectId)).toEqual({
      modelSlug: "text-one",
      source: "default",
      verified: false,
    });
    act(() => expect(result.current.setDefaultModel("text-one")).toBe(true));
    expect(result.current.resolve(projectId).verified).toBe(true);
  });

  it("lets the user confirm the only model again after A to B to A", async () => {
    const auth = fixture();
    vi.mocked(auth.bridge.models).mockImplementation(async () => ({
      kind: "OK",
      profileId: (await auth.bridge.status()).activeProfileId!,
      models: [{ slug: "text-one", displayName: "Text One" }],
    }));
    render(
      <OfficialConnectionProvider>
        <CardHarness />
      </OfficialConnectionProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "读取此账号的可用模型" }));
    const picker = await screen.findByRole("combobox", { name: "默认官方文本模型" });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.change(picker, { target: { value: "text-one" } });
    expect(screen.getByTestId("choice-verified")).toHaveTextContent("true");
    const selectOther = () =>
      screen
        .getAllByRole("button", { name: "使用此账号" })
        .find((button) => !button.hasAttribute("disabled"))!;
    fireEvent.click(selectOther());
    await waitFor(() => expect(auth.bridge.selectProfile).toHaveBeenCalledWith(otherId));
    fireEvent.click(selectOther());
    await waitFor(() => expect(auth.bridge.selectProfile).toHaveBeenCalledWith(profileId));
    fireEvent.click(await screen.findByRole("button", { name: "读取此账号的可用模型" }));
    await waitFor(() => expect(picker).toBeEnabled());
    expect(picker).toHaveValue("");
    expect(screen.getByRole("option", { name: "请重新选择模型" })).toBeInTheDocument();
    expect(screen.getByTestId("choice-verified")).toHaveTextContent("false");
    fireEvent.change(picker, { target: { value: "text-one" } });
    expect(screen.getByTestId("choice-verified")).toHaveTextContent("true");
  });

  it.each(["episode", "unmount"] as const)(
    "does not send an old text request when %s changes during model revalidation",
    async (change) => {
      const auth = fixture();
      const generate = vi.fn();
      window.aijianOfficialText = {
        list: vi.fn(async () => ({ kind: "OK", operations: [] })),
        generate,
      } as unknown as OfficialTextBridge;
      const episodeId = `ep_${"b".repeat(32)}`;
      const view = renderHook(
        (scope: { projectId: string; episodeId: string }) => ({
          account: useOfficialConnection()!,
          proposal: useOfficialTextProposals({
            ...scope,
            base: null,
            disabled: false,
            onBusyChange: vi.fn(),
            onAdopted: vi.fn(),
          }),
        }),
        { initialProps: { projectId, episodeId }, wrapper },
      );
      await waitFor(() => expect(view.result.current.proposal.readState).toBe("ready"));
      await waitFor(() => expect(view.result.current.account.connection.loading).toBe(false));
      await act(async () => view.result.current.account.readModels());
      act(() => {
        view.result.current.account.setDefaultModel("text-one");
        view.result.current.proposal.setText("Old episode input");
      });
      let release!: (value: Awaited<ReturnType<ChatGPTBridge["models"]>>) => void;
      vi.mocked(auth.bridge.models).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      let pending!: Promise<void>;
      act(() => {
        pending = view.result.current.proposal.generate();
      });
      await waitFor(() => expect(auth.bridge.models).toHaveBeenCalledTimes(2));
      if (change === "episode") view.rerender({ projectId, episodeId: `ep_${"c".repeat(32)}` });
      else view.unmount();
      await act(async () => {
        release({ kind: "OK", profileId, models: [{ slug: "text-one", displayName: "Text One" }] });
        await pending;
      });
      expect(generate).not.toHaveBeenCalled();
    },
  );
});
