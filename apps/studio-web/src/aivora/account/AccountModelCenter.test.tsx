import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountModelCenter } from "./AccountModelCenter";
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
});

describe("account and model center", () => {
  it("connects a sandbox key without keeping it or offering a second model picker", () => {
    const save = vi.fn();
    render(<AccountModelCenter onSaveXaiKey={save} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    expect(screen.getByRole("combobox", { name: "文本模型" })).toBeDisabled();
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
    expect(screen.getByRole("combobox", { name: "视频模型" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "配音模型" })).toBeDisabled();
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
