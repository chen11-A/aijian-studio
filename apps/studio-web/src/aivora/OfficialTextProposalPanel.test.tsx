import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  OfficialTextBridge,
  OfficialTextOperation,
  OfficialTextRead,
} from "@aijian/contracts/official-text";
import type { ChatGPTBridge } from "@aijian/contracts/chatgpt-auth";
import { OfficialTextProposalPanel } from "./OfficialTextProposalPanel";
const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const id = "11111111-1111-4111-8111-111111111111";
const operation: OfficialTextOperation = {
  project_id: project,
  episode_id: episode,
  status: "COMPLETED",
  error_code: null,
  created_at: "2026-10-08T06:00:00Z",
  request: {
    operation_id: id,
    profile_id: "22222222-2222-4222-8222-222222222222",
    model: "synthetic-test-model",
    input_text: "Synthetic prompt",
    instructions: null,
    base: null,
    request_hash: `sha256:${"c".repeat(64)}`,
  },
  proposal: {
    version_id: `ver_${"d".repeat(32)}`,
    content_hash: `sha256:${"e".repeat(64)}`,
    result: {
      operation_id: id,
      profile_id: "22222222-2222-4222-8222-222222222222",
      model: "synthetic-test-model",
      request_hash: `sha256:${"c".repeat(64)}`,
      text: "Synthetic proposal text only",
      completed_at: "2026-10-08T06:01:00Z",
    },
  },
  adoption: null,
};
function fixture(operations = [operation]) {
  const adopted = {
    ...operation,
    adoption: {
      script_version_id: `ver_${"f".repeat(32)}`,
      script_content_hash: `sha256:${"a".repeat(64)}`,
      actor_id: "human",
      adopted_at: "2026-10-08T06:02:00Z",
    },
  };
  const bridge: OfficialTextBridge = {
    list: vi.fn<OfficialTextBridge["list"]>(async () => ({ kind: "OK", operations })),
    get: vi.fn<OfficialTextBridge["get"]>(async () => ({ kind: "OK", operation })),
    generate: vi.fn<OfficialTextBridge["generate"]>(async () => ({ kind: "OK", operation })),
    adopt: vi.fn<OfficialTextBridge["adopt"]>(async () => ({ kind: "OK", operation: adopted })),
  };
  window.aijianOfficialText = bridge;
  return { bridge, adopted };
}
afterEach(() => {
  cleanup();
  delete window.aijianOfficialText;
  delete window.aijianChatGPT;
});
function show() {
  fireEvent.click(screen.getByText("官方 ChatGPT 文本建议"));
}

describe("official proposal review in the original script editor", () => {
  it("restores persisted text without generation and adopts only after explicit exact review", async () => {
    const { bridge } = fixture();
    const onAdopted = vi.fn(async () => undefined);
    render(
      <OfficialTextProposalPanel
        projectId={project}
        episodeId={episode}
        base={null}
        disabled={false}
        onBusyChange={vi.fn()}
        onAdopted={onAdopted}
      />,
    );
    show();
    expect(await screen.findByText("Synthetic proposal text only")).toBeVisible();
    expect(bridge.generate).not.toHaveBeenCalled();
    expect(bridge.adopt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认将此建议追加为新剧本草稿" }));
    await waitFor(() => expect(onAdopted).toHaveBeenCalledOnce());
    expect(bridge.adopt).toHaveBeenCalledExactlyOnceWith(project, episode, id, {
      proposal_version_id: operation.proposal!.version_id,
      proposal_content_hash: operation.proposal!.content_hash,
      confirm: true,
    });
  });
  it("blocks stale bases and dirty script edits without overwriting", async () => {
    const { bridge } = fixture();
    const props = {
      projectId: project,
      episodeId: episode,
      onBusyChange: vi.fn(),
      onAdopted: vi.fn(async () => undefined),
    };
    const page = render(<OfficialTextProposalPanel {...props} base={null} disabled />);
    show();
    await screen.findByText("Synthetic proposal text only");
    expect(screen.getByRole("button", { name: "确认将此建议追加为新剧本草稿" })).toBeDisabled();
    page.rerender(
      <OfficialTextProposalPanel
        {...props}
        base={{
          version_id: `ver_${"a".repeat(32)}`,
          content_hash: `sha256:${"b".repeat(64)}`,
          head_revision: 1,
        }}
        disabled={false}
      />,
    );
    expect(screen.getByText("此建议的剧本基准已过期；不能覆盖当前剧本。")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认将此建议追加为新剧本草稿" })).toBeDisabled();
    expect(bridge.adopt).not.toHaveBeenCalled();
  });
  it("blocks duplicate adoption while pending and does not apply late results after unmount", async () => {
    const { bridge, adopted } = fixture();
    let resolve!: (result: OfficialTextRead) => void;
    vi.mocked(bridge.adopt).mockImplementation(
      async () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onAdopted = vi.fn(async () => undefined);
    const page = render(
      <OfficialTextProposalPanel
        projectId={project}
        episodeId={episode}
        base={null}
        disabled={false}
        onBusyChange={vi.fn()}
        onAdopted={onAdopted}
      />,
    );
    show();
    await screen.findByText("Synthetic proposal text only");
    const button = screen.getByRole("button", { name: "确认将此建议追加为新剧本草稿" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(bridge.adopt).toHaveBeenCalledOnce();
    page.unmount();
    await act(async () => {
      resolve({ kind: "OK", operation: adopted });
    });
    expect(onAdopted).not.toHaveBeenCalled();
  });
  it("keeps remote unknown generation disabled and provides only explicit read recovery", async () => {
    const { bridge } = fixture([{ ...operation, status: "REMOTE_UNKNOWN", proposal: null }]);
    render(
      <OfficialTextProposalPanel
        projectId={project}
        episodeId={episode}
        base={null}
        disabled={false}
        onBusyChange={vi.fn()}
        onAdopted={vi.fn(async () => undefined)}
      />,
    );
    show();
    expect(await screen.findByText(/本集有发送结果未知的操作/)).toBeVisible();
    expect(screen.getByRole("button", { name: "审阅并生成一次建议" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "只读核对建议" }));
    await waitFor(() => expect(bridge.list).toHaveBeenCalledTimes(2));
    expect(bridge.generate).not.toHaveBeenCalled();
  });
  it("submits only typed prompt after explicit model choice and preserves it when native approval is cancelled", async () => {
    const { bridge } = fixture([]);
    const models = vi.fn<ChatGPTBridge["models"]>(async () => ({
      kind: "OK",
      models: [{ slug: "synthetic-test-model", displayName: "Synthetic fixture" }],
    }));
    window.aijianChatGPT = {
      models,
      status: async () => {
        throw new Error("Not used in this synthetic fixture");
      },
      signIn: async () => {
        throw new Error("No live authorization");
      },
      signOut: async () => {
        throw new Error("No live authorization");
      },
      selectProfile: async () => {
        throw new Error("No live authorization");
      },
      cancel: async () => {
        throw new Error("No live authorization");
      },
    };
    vi.mocked(bridge.generate).mockResolvedValue({
      kind: "NOT_SENT",
      operationId: id,
      code: "TEXT_REQUEST_CANCELLED",
    });
    const onAdopted = vi.fn(async () => undefined);
    render(
      <OfficialTextProposalPanel
        projectId={project}
        episodeId={episode}
        base={null}
        disabled={false}
        onBusyChange={vi.fn()}
        onAdopted={onAdopted}
      />,
    );
    show();
    await screen.findByText("本集还没有官方文本建议。");
    expect(models).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("此次发送的文本"), {
      target: { value: "Explicit synthetic prompt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "读取官方可用模型" }));
    await screen.findByRole("option", { name: "Synthetic fixture" });
    fireEvent.click(screen.getByRole("button", { name: "审阅并生成一次建议" }));
    await screen.findByText("此次请求未发送（TEXT_REQUEST_CANCELLED）。");
    expect(bridge.generate).toHaveBeenCalledExactlyOnceWith({
      projectId: project,
      episodeId: episode,
      base: null,
      operationId: expect.any(String),
      model: "synthetic-test-model",
      text: "Explicit synthetic prompt",
    });
    expect(screen.getByLabelText("此次发送的文本")).toHaveValue("Explicit synthetic prompt");
    expect(onAdopted).not.toHaveBeenCalled();
  });
});
