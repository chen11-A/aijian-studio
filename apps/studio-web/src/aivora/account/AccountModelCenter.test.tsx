import "@testing-library/jest-dom/vitest";
import type { GrokLoginBridge, GrokLoginStatus } from "@aijian/contracts/grok-auth";
import { cleanup, fireEvent, render, screen, act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountModelCenter } from "./AccountModelCenter";
import { GrokConnectionProvider } from "../grok-auth/GrokConnectionContext";
import { XAI_SESSION_KEY } from "./xai-account";
import {
  ChangeCostNotice,
  FormalDeliveryChecklist,
  SandboxMediaTaskDesk,
  SandboxVoicePlan,
} from "./SandboxSurfaces";
import { CurrentModelLink } from "./CurrentModelLink";
import { useFollowCenteredChatModel } from "./follow-centered-model";
import { selectCenteredModel } from "./model-center";
import type { ProviderConnectionData } from "../../api/studio";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete window.aijianGrok;
});

describe("account and model center", () => {
  it("connects a sandbox key without keeping it or offering a second model picker", () => {
    const save = vi.fn();
    render(<AccountModelCenter onSaveXaiKey={save} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("还没有连接能提供文本模型的账号。")).toBeInTheDocument();
    expect(screen.getByText("还没有连接能提供配音模型的账号。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用 Grok 账号登录" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "连接 API Key" })).toHaveLength(3);
    fireEvent.click(screen.getByText("控制台密钥（高级备用）"));
    fireEvent.change(screen.getByLabelText("xAI 密钥"), {
      target: { value: "not-a-grok-login" },
    });
    fireEvent.click(screen.getByRole("button", { name: "连接 API Key（沙箱）" }));
    expect(screen.getByRole("status")).toHaveTextContent("xai-");
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("xAI 密钥"), {
      target: { value: "xai-sandbox-test-key-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "连接 API Key（沙箱）" }));
    expect(screen.getByRole("status")).toHaveTextContent("未访问 api.x.ai");
    expect(window.localStorage.getItem(XAI_SESSION_KEY)).not.toContain(
      "xai-sandbox-test-key-value",
    );
    const accounts = screen.getByLabelText("已连接账号");
    expect(accounts).toHaveTextContent("未知");
    expect(accounts).toHaveTextContent("不预留");
    expect(accounts).toHaveTextContent("不是订阅额度");
    expect(screen.getByLabelText("Grok 密钥 可用模型")).toHaveTextContent("grok-4.7");
    expect(screen.queryByRole("button", { name: "购买套餐" })).not.toBeInTheDocument();

    const text = screen.getByRole("combobox", { name: "文本模型" });
    expect(text).toBeEnabled();
    fireEvent.change(text, { target: { value: "xai:grok-4.7" } });
    expect(text).toHaveValue("xai:grok-4.7");
    expect(screen.getByRole("combobox", { name: "视频模型" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "配音模型" })).toHaveTextContent("Grok TTS");
    fireEvent.change(text, { target: { value: "" } });
    expect(screen.getByRole("status")).toHaveTextContent("已清空");
    fireEvent.click(screen.getByRole("button", { name: "断开沙箱" }));
    expect(screen.getByRole("status")).toHaveTextContent("已断开");
    expect(window.localStorage.getItem(XAI_SESSION_KEY)).toBeNull();
  });

  it("saves a key into the credential store and reports a refused save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<AccountModelCenter onSaveXaiKey={save} onOpenChatGpt={() => undefined} />);
    fireEvent.click(screen.getByText("控制台密钥（高级备用）"));
    fireEvent.click(screen.getByRole("button", { name: "打开 ChatGPT 登录" }));
    fireEvent.change(screen.getByLabelText("xAI 密钥"), {
      target: { value: "xai-sandbox-test-key-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "写入凭据库（不调用模型）" }));
    expect(save).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("已提交到本机凭据库");

    save.mockRejectedValueOnce(new Error("nope"));
    fireEvent.change(screen.getByLabelText("xAI 密钥"), {
      target: { value: "xai-sandbox-test-key-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "写入凭据库（不调用模型）" }));
    expect(await screen.findByRole("status")).toHaveTextContent("凭据库没有确认保存");

    view.rerender(
      <AccountModelCenter
        onSaveXaiKey={save}
        connections={
          [
            {
              id: "conn-1",
              provider_kind: "XAI",
              display_name: "已有 xAI",
              models: [{ model_id: "grok-4.7", capabilities: ["TEXT"] }],
            },
          ] as ProviderConnectionData[]
        }
      />,
    );
    fireEvent.change(screen.getByLabelText("xAI 密钥"), {
      target: { value: "xai-sandbox-test-key-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "写入凭据库（不调用模型）" }));
    expect(screen.getByRole("status")).toHaveTextContent("已经有 xAI 连接");
  });

  it("offers only the capabilities a single Grok login listed, and keeps the choice", async () => {
    const signedIn: GrokLoginStatus = {
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "person@example.test",
      lastError: null,
    };
    const bridge: GrokLoginBridge = {
      status: vi.fn(async () => signedIn),
      signIn: vi.fn(async () => ({ kind: "OK" as const, status: signedIn })),
      cancel: vi.fn(async () => ({ kind: "CANCELLED" as const, status: signedIn })),
      signOut: vi.fn(async () => ({ kind: "OK" as const, status: signedIn })),
      models: vi.fn(async () => ({
        kind: "OK" as const,
        models: [
          { id: "grok-4.7", label: "Grok 4.7" },
          {
            id: "grok-imagine-image-2.0",
            label: "Grok Imagine Image 2.0",
            outputModalities: ["image"],
          },
          { id: "grok-imagine-video-1.5", label: "Grok Imagine Video 1.5" },
        ],
      })),
      completeText: vi.fn(async () => ({
        kind: "ERROR" as const,
        code: "TEXT_FAILED",
        billingAccountKind: "grok_login" as const,
      })),
    };
    window.aijianGrok = bridge;
    const view = render(
      <GrokConnectionProvider>
        <AccountModelCenter />
      </GrokConnectionProvider>,
    );
    const text = await screen.findByRole("combobox", { name: "文本模型" });
    expect(text).toBeEnabled();
    expect(screen.getByRole("option", { name: "Grok 4.7 · Grok 账号" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "图像模型" })).toHaveTextContent(
      "Grok Imagine Image 2.0 · Grok 账号",
    );
    expect(screen.getByRole("combobox", { name: "视频模型" })).toHaveTextContent(
      "Grok Imagine Video 1.5 · Grok 账号",
    );
    expect(screen.queryByRole("combobox", { name: "配音模型" })).not.toBeInTheDocument();
    expect(screen.getByText("Grok 账号暂不提供配音模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "连接 API Key" })).toBeInTheDocument();

    fireEvent.change(text, { target: { value: "grok:grok-4.7" } });
    expect(text).toHaveValue("grok:grok-4.7");
    view.unmount();
    render(
      <GrokConnectionProvider>
        <AccountModelCenter />
      </GrokConnectionProvider>,
    );
    expect(await screen.findByRole("combobox", { name: "文本模型" })).toHaveValue("grok:grok-4.7");
    await waitFor(() => expect(bridge.models).toHaveBeenCalled());
    delete window.aijianGrok;
  });
});

describe("completed sandbox surfaces", () => {
  it("shows the media task desk and the unfinished delivery checklist", () => {
    render(
      <>
        <SandboxMediaTaskDesk />
        <FormalDeliveryChecklist />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "沙箱提交" }));
    expect(screen.getByRole("status")).toHaveTextContent("queued");
    expect(screen.getByLabelText("媒体任务沙箱")).toHaveTextContent("不预留预算");
    expect(screen.getByLabelText("正式交付清单")).toHaveTextContent("未完成");
    expect(screen.getByLabelText("正式交付清单")).not.toHaveTextContent("已签发");
    fireEvent.click(screen.getByRole("button", { name: "沙箱查询" }));
    fireEvent.click(screen.getByRole("button", { name: "沙箱取消" }));
    expect(screen.getByRole("status")).toHaveTextContent("cancelled");
    fireEvent.click(screen.getByRole("button", { name: "沙箱提交" }));
    fireEvent.click(screen.getByRole("button", { name: "沙箱查询" }));
    fireEvent.click(screen.getByRole("button", { name: "沙箱标记未知" }));
    expect(screen.getByRole("status")).toHaveTextContent("unknown");
    fireEvent.click(screen.getByRole("button", { name: "沙箱标记失败" }));
    expect(screen.getByRole("status")).toHaveTextContent("unknown");
  });

  it("walks the voice sandbox and the cost notice without a file", () => {
    const openCosts = vi.fn();
    render(
      <>
        <SandboxVoicePlan />
        <ChangeCostNotice onOpenCosts={openCosts} />
        <CurrentModelLink capability="TEXT" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "沙箱试听" }));
    expect(screen.getByRole("status")).toHaveTextContent("声线使用同意");
    fireEvent.change(screen.getByLabelText("配音对白"), { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "沙箱生成配音" }));
    expect(screen.getByRole("status")).toHaveTextContent("未生成文件");
    fireEvent.click(screen.getByRole("button", { name: "查看作品用量" }));
    expect(openCosts).toHaveBeenCalledOnce();
    const heard = { page: "" };
    const onPage = (event: Event) => {
      heard.page = String((event as CustomEvent).detail);
    };
    window.addEventListener("aivora-open-page", onPage);
    fireEvent.click(screen.getAllByRole("button", { name: "在模型中心更改" })[0]!);
    window.removeEventListener("aivora-open-page", onPage);
    expect(heard.page).toBe("services");
  });
});

function FollowHarness({
  models,
  setModel,
  onClear,
}: {
  models: readonly { slug: string }[];
  setModel: (slug: string) => void;
  onClear: () => void;
}) {
  useFollowCenteredChatModel({ models, setModel, onClear });
  return null;
}

describe("centered chat model", () => {
  it("applies a ChatGPT choice and clears it only after one was applied", () => {
    const setModel = vi.fn();
    const onClear = vi.fn();
    const view = render(
      <FollowHarness models={[{ slug: "gpt-test" }]} setModel={setModel} onClear={onClear} />,
    );
    expect(onClear).not.toHaveBeenCalled();
    act(() => {
      selectCenteredModel("TEXT", { provider: "CHATGPT_OFFICIAL", modelId: "missing" });
    });
    expect(setModel).not.toHaveBeenCalled();
    act(() => {
      selectCenteredModel("TEXT", { provider: "CHATGPT_OFFICIAL", modelId: "gpt-test" });
    });
    expect(setModel).toHaveBeenCalledWith("gpt-test");
    act(() => {
      selectCenteredModel("TEXT", null);
    });
    expect(onClear).toHaveBeenCalledOnce();
    view.unmount();
  });
});
