import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { UtilityPages } from "./UtilityPages";
import { EditorDialog } from "./Common";
import { createAivoraSampleFixture, DemoProvider, useDemo } from "./model";
import type { ProviderConnectionListResponse } from "../api/studio";

afterEach(() => {
  cleanup();
  delete window.aijian;
});
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

const requestId = "req_" + "1".repeat(32);
const connection = (
  id = "pcn_" + "1".repeat(32),
): ProviderConnectionListResponse["data"][number] => ({
  id,
  provider_kind: "OPENAI",
  display_name: "OpenAI 制作",
  base_url: "https://api.openai.com/v1",
  enabled: true,
  revision: 1,
  credential_status: "CONFIGURED",
  models: [{ model_id: "gpt-test", capabilities: ["TEXT"] }],
  created_at: "2026-09-14T00:00:00Z",
  updated_at: "2026-09-14T00:00:00Z",
});
function response(
  data: ProviderConnectionListResponse["data"] = [],
): ProviderConnectionListResponse {
  return { data, request_id: requestId };
}
function desktop(
  overrides: Partial<
    Record<
      "listProviderConnections" | "createProviderConnection" | "deleteProviderConnection",
      ReturnType<typeof vi.fn>
    >
  > = {},
): NonNullable<Window["aijian"]> {
  return {
    health: vi.fn().mockResolvedValue({ status: "ok" }),
    listProjects: vi.fn().mockResolvedValue({ data: [], request_id: requestId }),
    listSources: vi.fn().mockResolvedValue({ data: [], request_id: requestId }),
    listProviderConnections: vi.fn().mockResolvedValue(response()),
    createProviderConnection: vi
      .fn()
      .mockResolvedValue({ data: connection(), request_id: requestId }),
    deleteProviderConnection: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as NonNullable<Window["aijian"]>;
}
function UtilityHarness() {
  const demo = useDemo();
  useEffect(() => {
    demo.go("services");
  }, [demo]);
  return <UtilityPages />;
}
function open(bridge = desktop()) {
  window.aijian = bridge;
  render(
    <DemoProvider>
      <UtilityHarness />
    </DemoProvider>,
  );
  return bridge;
}
function UtilityPageHarness({
  page,
  scenario = "normal",
}: {
  page: "costs" | "voice";
  scenario?: "empty" | "error" | "loading" | "normal" | "unavailable";
}) {
  const demo = useDemo();
  useEffect(() => {
    demo.go(page);
    demo.setScenario(scenario);
  }, [page, scenario]);
  return (
    <>
      <UtilityPages />
      <EditorDialog />
      <output aria-label="utility-page-state">
        {JSON.stringify({
          page: demo.page,
          budget: demo.value("budget"),
          language: demo.value(`character-${demo.selectedCharacter}-voiceLanguage`),
          volume: demo.value(`character-${demo.selectedCharacter}-voiceVolume`),
          draft: demo.aiDraft,
          scenario: demo.scenario,
        })}
      </output>
    </>
  );
}
function openUtilityPage(
  page: "costs" | "voice",
  scenario?: "empty" | "error" | "loading" | "normal" | "unavailable",
) {
  render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <UtilityPageHarness page={page} scenario={scenario} />
    </DemoProvider>,
  );
}
async function ready() {
  await screen.findByRole("heading", { name: "AI 服务" });
}
async function submitConnection() {
  fireEvent.change(screen.getByLabelText("连接名称"), { target: { value: "正式 OpenAI" } });
  fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: "sk-secret-123" } });
  fireEvent.change(screen.getByLabelText("剧本 / 提示词"), { target: { value: "gpt-5" } });
  fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
}

describe("real provider service configuration", () => {
  it("reads an empty real connection list without inventing a provider", async () => {
    const bridge = open();
    await ready();
    expect(await screen.findByText("还没有模型连接")).toBeInTheDocument();
    expect(bridge.listProviderConnections).toHaveBeenCalledOnce();
    expect(bridge.createProviderConnection).not.toHaveBeenCalled();
  });

  it("shows a real configured connection and its capabilities", async () => {
    open(desktop({ listProviderConnections: vi.fn().mockResolvedValue(response([connection()])) }));
    await ready();
    expect(await screen.findByText("OpenAI 制作")).toBeInTheDocument();
    expect(screen.getByText("gpt-test")).toBeInTheDocument();
    expect(screen.getByText("剧本")).toBeInTheDocument();
  });

  it("keeps an unavailable credential visible without inventing a model capability", async () => {
    const unavailable = { ...connection(), credential_status: "UNAVAILABLE" as const, models: [] };
    open(desktop({ listProviderConnections: vi.fn().mockResolvedValue(response([unavailable])) }));
    await ready();
    expect(await screen.findByText("凭据库不可用")).toBeInTheDocument();
    expect(screen.getByText("尚未登记模型 ID")).toBeInTheDocument();
  });

  it("retries a failed list read", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response([connection()]));
    open(desktop({ listProviderConnections: list }));
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: "重新读取" }));
    expect(await screen.findByText("OpenAI 制作")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("requires at least one model before creating a connection", async () => {
    const bridge = open();
    await ready();
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: "sk-secret-123" } });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("至少填写一个");
    expect(bridge.createProviderConnection).not.toHaveBeenCalled();
  });

  it("uses the selected local provider preset, permits an empty key, and preserves an edited endpoint", async () => {
    const create = vi.fn().mockResolvedValue({ data: connection(), request_id: requestId });
    open(desktop({ createProviderConnection: create }));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^Ollama 本地/ }));
    expect(screen.getByLabelText("连接名称")).toHaveValue("Ollama 本地");
    expect(screen.getByLabelText("Base URL")).toHaveValue("http://127.0.0.1:11434/v1");
    expect(screen.getByText("本地服务可留空")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://localhost:11435/v1" },
    });
    fireEvent.change(screen.getByLabelText("剧本 / 提示词"), { target: { value: "qwen3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_kind: "OLLAMA",
          base_url: "http://localhost:11435/v1",
          models: [{ model_id: "qwen3", capabilities: ["TEXT"] }],
        }),
      ),
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("api_key");
  });

  it("locks the full form and submits one real create while saving", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response([connection()]));
    let finishCreate!: () => void;
    const create = vi.fn(
      () =>
        new Promise((resolve) => {
          finishCreate = () => resolve({ data: connection(), request_id: requestId });
        }),
    );
    const bridge = open(
      desktop({ listProviderConnections: list, createProviderConnection: create }),
    );
    await ready();
    await submitConnection();
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "正在安全保存…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^xAI/ })).toBeDisabled();
    expect(screen.getByLabelText("连接名称")).toBeDisabled();
    expect(screen.getByLabelText(/API Key/)).toBeDisabled();
    fireEvent.submit(document.getElementById("new-provider-connection")!);
    expect(create).toHaveBeenCalledOnce();
    finishCreate();
    await screen.findByText("OpenAI 制作");
    expect(screen.getByLabelText(/API Key/)).toHaveValue("");
    expect(bridge.createProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "正式 OpenAI",
        api_key: "sk-secret-123",
        models: [{ model_id: "gpt-5", capabilities: ["TEXT"] }],
      }),
    );
  });
  it("re-reads and reports a failed create without retaining the secret", async () => {
    const list = vi.fn().mockResolvedValue(response());
    const create = vi.fn().mockRejectedValue(new Error("write failed"));
    open(desktop({ listProviderConnections: list, createProviderConnection: create }));
    await ready();
    await submitConnection();
    expect(await screen.findByText(/连接未保存/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(/API Key/)).toHaveValue("sk-secret-123");
  });

  it("requires explicit confirmation before deleting a real connection", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    open(
      desktop({
        listProviderConnections: vi.fn().mockResolvedValue(response([connection()])),
        deleteProviderConnection: remove,
      }),
    );
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: "移除连接" }));
    expect(screen.getByText("同时移除系统凭据？")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(connection().id));
  });

  it("keeps the visible connection when deletion fails", async () => {
    const remove = vi.fn().mockRejectedValue(new Error("locked"));
    open(
      desktop({
        listProviderConnections: vi.fn().mockResolvedValue(response([connection()])),
        deleteProviderConnection: remove,
      }),
    );
    await ready();
    await screen.findByText("OpenAI 制作");
    fireEvent.click(screen.getByRole("button", { name: "移除连接" }));
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    expect(await screen.findByText("无法移除连接；原配置未被界面隐藏。")).toBeInTheDocument();
    expect(screen.getByText("OpenAI 制作")).toBeInTheDocument();
  });
});

describe("utility page local settings", () => {
  it("edits a cost budget locally and labels the ledger sample as fixed demonstration data", async () => {
    openUtilityPage("costs");
    await screen.findByRole("heading", { name: "用量" });
    fireEvent.click(screen.getByRole("button", { name: "预算设置" }));
    fireEvent.change(screen.getByLabelText("预算上限（人民币）"), { target: { value: "280.00" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(JSON.parse(screen.getByLabelText("utility-page-state").textContent ?? "{}").budget).toBe(
      "280.00",
    );
    fireEvent.click(screen.getByRole("button", { name: "查看固定演示账单" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("这些金额不代表真实调用或扣费");
  });

  it("keeps voice choices local and makes unavailable audio actions non-operational", async () => {
    openUtilityPage("voice");
    await screen.findByRole("heading", { name: "声音" });
    fireEvent.click(screen.getByRole("button", { name: /程野/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "目标语言" }), {
      target: { value: "简体中文" },
    });
    fireEvent.change(screen.getByLabelText("配音音量"), { target: { value: "42" } });
    expect(screen.getByRole("button", { name: "试听" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "生成配音" })).toBeDisabled();
    expect(
      JSON.parse(screen.getByLabelText("utility-page-state").textContent ?? "{}"),
    ).toMatchObject({ language: "简体中文", volume: "42" });
    fireEvent.click(screen.getByRole("button", { name: "保存声音方案" }));
    await waitFor(() =>
      expect(JSON.parse(screen.getByLabelText("utility-page-state").textContent ?? "{}").page).toBe(
        "assembly",
      ),
    );
  });

  it("makes cost navigation and unavailable-state recovery explicit local actions", async () => {
    openUtilityPage("costs", "error");
    await screen.findByText("暂时无法读取内容");
    fireEvent.click(screen.getByRole("button", { name: "重试演示" }));
    expect(
      JSON.parse(screen.getByLabelText("utility-page-state").textContent ?? "{}").scenario,
    ).toBe("normal");
    fireEvent.click(screen.getByRole("button", { name: "前往 AI 服务" }));
    await waitFor(() =>
      expect(JSON.parse(screen.getByLabelText("utility-page-state").textContent ?? "{}").page).toBe(
        "services",
      ),
    );
  });

  it("opens editable voice direction locally and focuses the assistant with a non-generating request", async () => {
    openUtilityPage("voice");
    await screen.findByRole("heading", { name: "声音" });
    fireEvent.click(screen.getByRole("button", { name: "详细设置" }));
    fireEvent.change(screen.getByLabelText("声音方向"), { target: { value: "清澈明亮" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    fireEvent.click(screen.getByRole("button", { name: "哪里不对？" }));
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByLabelText("utility-page-state").textContent ?? "{}").draft,
      ).toBe("请核对当前角色声音方案"),
    );
  });

  it.each([
    ["loading", "正在读取演示内容", true],
    ["empty", "还没有内容", false],
    ["unavailable", "真实能力未接入", false],
  ] as const)(
    "renders the %s utility state without manufacturing ledger data",
    async (scenario, heading, busy) => {
      openUtilityPage("costs", scenario);
      const state = (await screen.findByText(heading)).closest("[role='status']")!;
      expect(state).toHaveTextContent(heading);
      expect(state).toHaveAttribute("aria-busy", String(busy));
      fireEvent.click(screen.getByRole("button", { name: "查看样例" }));
      expect(
        JSON.parse(screen.getByLabelText("utility-page-state").textContent ?? "{}").scenario,
      ).toBe("normal");
    },
  );
});
