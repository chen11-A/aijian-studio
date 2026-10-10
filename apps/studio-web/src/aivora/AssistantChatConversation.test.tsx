import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantChatBridge } from "@aijian/contracts/official-text";
import { AssistantChatConversation } from "./AssistantChatConversation";
import type { AssistantSelectionPublication } from "./assistantSelection";

const projectId = `prj_${"a".repeat(32)}`;
const episodeId = `ep_${"b".repeat(32)}`;
const profileId = "123e4567-e89b-42d3-a456-426614174000";
const operationId = "123e4567-e89b-42d3-a456-426614174001";
const previewId = "123e4567-e89b-42d3-a456-426614174002";
const selection: AssistantSelectionPublication = {
  kind: "AVAILABLE",
  selection: {
    projectId,
    episodeId,
    page: "script",
    objectKind: "SCRIPT_SCENE",
    objectId: `scn_${"c".repeat(32)}`,
    versionId: `ver_${"d".repeat(32)}`,
    contentHash: `sha256:${"e".repeat(64)}`,
    headRevision: 2,
    excerpt: "本地预览片段，不应出现在 preview IPC 参数中",
  },
};
function bridge(): AssistantChatBridge {
  return {
    listPending: vi.fn(async () => ({ kind: "OK" as const, operationIds: [] })),
    preview: vi.fn(async () => ({
      kind: "READY" as const,
      previewId,
      operationId,
      inputHash: `sha256:${"f".repeat(64)}`,
      outboundText: "主进程最终发送正文",
      includedSources: ["场次"],
      historyOmitted: 2,
      contextTruncated: false,
    })),
    send: vi.fn(async () => ({
      kind: "COMPLETED" as const,
      operationId,
      text: "请加强人物动机。",
    })),
    discardPreview: vi.fn(async () => undefined),
    getOperation: vi.fn(async () => ({ kind: "NOT_FOUND" as const, operationId })),
  };
}
const scope = { projectId, episodeId, page: "script" };
function view(
  api: AssistantChatBridge | undefined = bridge(),
  overrides: Record<string, unknown> = {},
) {
  return render(
    <AssistantChatConversation
      bridge={api}
      scope={scope}
      profileId={profileId}
      model="text-one"
      modelVerified
      publication={selection}
      included
      setIncluded={vi.fn()}
      onOpenServices={vi.fn()}
      onOpenEditor={vi.fn()}
      {...overrides}
    />,
  );
}
beforeEach(() => vi.clearAllMocks());

describe("production assistant conversation", () => {
  async function readyToSend(api: AssistantChatBridge) {
    view(api);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "请给建议" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    await screen.findByText("主进程最终发送正文");
  }
  it("can preview after StrictMode effect setup and cleanup", async () => {
    const api = bridge();
    render(
      <StrictMode>
        <AssistantChatConversation
          bridge={api}
          scope={scope}
          profileId={profileId}
          model="text-one"
          modelVerified
          publication={selection}
          included
          setIncluded={vi.fn()}
          onOpenServices={vi.fn()}
          onOpenEditor={vi.fn()}
        />
      </StrictMode>,
    );
    await waitFor(() => expect(api.listPending).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "仍可预览" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    await screen.findByText("主进程最终发送正文");
  });
  it("does not offer preview or send without a verified model and desktop bridge", () => {
    const openServices = vi.fn();
    view(undefined, { modelVerified: false, onOpenServices: openServices });
    expect(screen.getByText(/选择已核验的官方文字模型/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览发送内容" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "打开 AI 服务" }));
    expect(openServices).toHaveBeenCalledOnce();
  });

  it("previews the native outbound text, sends only saved reference metadata, and displays advice", async () => {
    const api = bridge();
    view(api);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "帮我检查这一场" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    await screen.findByText("主进程最终发送正文");
    expect(screen.getByText(/已省略 2 条较早消息/)).toBeInTheDocument();
    const request = vi.mocked(api.preview).mock.calls[0]![0];
    expect(request).toMatchObject({
      scope,
      userText: "帮我检查这一场",
      model: "text-one",
      expectedProfileId: profileId,
      references: [
        {
          objectKind: "SCRIPT_SCENE",
          objectId: selection.kind === "AVAILABLE" ? selection.selection.objectId : "",
          versionId: selection.kind === "AVAILABLE" ? selection.selection.versionId : "",
        },
      ],
    });
    expect(JSON.stringify(request)).not.toContain("本地预览片段");
    fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
    await screen.findByText("请加强人物动机。");
    expect(api.send).toHaveBeenCalledOnce();
    expect(screen.getByText(/建议，不会修改作品/)).toBeInTheDocument();
  });

  it("scrolls only the message log to a new reply and leaves the empty state still", async () => {
    const api = bridge();
    const { container } = view(api);
    const log = screen.getByRole("log");
    const panel = container.querySelector(".assistant-chat") as HTMLElement;
    panel.scrollTop = 17;
    expect(log.scrollTop).toBe(0);
    expect(panel.scrollTop).toBe(17);

    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    });
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return {
          top: this.classList.contains("is-assistant") ? 250 : this === log ? 100 : 0,
        } as DOMRect;
      });
    try {
      await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
      fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
        target: { value: "请给建议" },
      });
      fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
      await screen.findByText("主进程最终发送正文");
      fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
      await screen.findByText("请加强人物动机。");
      await waitFor(() => expect(log.scrollTop).toBe(150));
      expect(panel.scrollTop).toBe(17);
      expect(document.documentElement.scrollTop).toBe(0);

      log.scrollTop = 0;
      fireEvent.scroll(log);
      fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
        target: { value: "再给一个建议" },
      });
      fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
      await screen.findByText("主进程最终发送正文");
      fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
      await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2));
      expect(log.scrollTop).toBe(0);
      expect(panel.scrollTop).toBe(17);
    } finally {
      rect.mockRestore();
    }
  });

  it("shows reference opt-in and source states, and offers copy and editor navigation for a reply", async () => {
    const api = bridge();
    const setIncluded = vi.fn();
    const onOpenEditor = vi.fn();
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard },
    });
    const rendered = view(api, { included: false, setIncluded, onOpenEditor });
    expect(screen.getByText("当前内容不随消息发送。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /选中内容及必要的前后/ }));
    expect(setIncluded).toHaveBeenCalledWith(true);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "检查人物动机" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    await screen.findByText("主进程最终发送正文");
    expect(vi.mocked(api.preview).mock.calls[0]![0].references).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
    await screen.findByText("请加强人物动机。");
    fireEvent.click(screen.getByRole("button", { name: "复制建议" }));
    expect(clipboard).toHaveBeenCalledWith("请加强人物动机。");
    fireEvent.click(screen.getByRole("button", { name: "去作品编辑或审阅" }));
    expect(onOpenEditor).toHaveBeenCalledOnce();
    for (const [kind, message] of [
      ["UNSAVED", "未保存修改"],
      ["UNAVAILABLE", "尚未可靠读取"],
      ["DIRECTOR_VIEW", "导演提案"],
    ] as const) {
      rendered.rerender(
        <AssistantChatConversation
          bridge={api}
          scope={scope}
          profileId={profileId}
          model="text-one"
          modelVerified
          publication={{ kind }}
          included={false}
          setIncluded={setIncluded}
          onOpenServices={vi.fn()}
          onOpenEditor={onOpenEditor}
        />,
      );
      expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
    }
  });

  it("discards a stale preview when text or page changes and blocks stale send", async () => {
    const api = bridge();
    const result = view(api);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "第一版" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    await screen.findByText("主进程最终发送正文");
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "第二版" },
    });
    await waitFor(() => expect(api.discardPreview).toHaveBeenCalledWith(previewId));
    expect(screen.queryByRole("button", { name: "确认发送" })).not.toBeInTheDocument();
    result.rerender(
      <AssistantChatConversation
        bridge={api}
        scope={{ ...scope, page: "storyboard" }}
        profileId={profileId}
        model="text-one"
        modelVerified
        publication={{ kind: "NONE" }}
        included={false}
        setIncluded={vi.fn()}
        onOpenServices={vi.fn()}
        onOpenEditor={vi.fn()}
      />,
    );
    expect(api.send).not.toHaveBeenCalled();
  });

  it("blocks a new send when a persisted unknown operation exists and only queries it read-only", async () => {
    const api = bridge();
    vi.mocked(api.listPending).mockResolvedValue({ kind: "OK", operationIds: [operationId] });
    vi.mocked(api.getOperation).mockResolvedValue({
      kind: "REMOTE_UNKNOWN",
      operationId,
      code: "RESULT_UNKNOWN",
    });
    view(api);
    await screen.findByText(/结果待核对/);
    expect(screen.getByRole("button", { name: "预览发送内容" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "只读核对结果" }));
    await waitFor(() =>
      expect(api.getOperation).toHaveBeenCalledWith({
        operationId,
        expectedProfileId: profileId,
        scope,
      }),
    );
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.send).not.toHaveBeenCalled();
  });

  it("keeps an unknown operation blocking after page changes even when the new page query is empty", async () => {
    const api = bridge();
    vi.mocked(api.listPending)
      .mockResolvedValueOnce({ kind: "OK", operationIds: [operationId] })
      .mockResolvedValue({ kind: "OK", operationIds: [] });
    const props = {
      bridge: api,
      profileId,
      model: "text-one",
      modelVerified: true,
      publication: selection,
      included: true,
      setIncluded: vi.fn(),
      onOpenServices: vi.fn(),
      onOpenEditor: vi.fn(),
    };
    const rendered = render(<AssistantChatConversation {...props} scope={scope} />);
    await screen.findByText(/原请求结果待核对/);
    rendered.rerender(
      <AssistantChatConversation
        {...props}
        scope={{ ...scope, page: "storyboard" }}
        publication={{ kind: "NONE" }}
        included={false}
      />,
    );
    await waitFor(() => expect(api.listPending).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "预览发送内容" })).toBeDisabled();
    expect(screen.getByText(/原请求结果待核对/)).toBeInTheDocument();
  });

  it("cannot use a new session to bypass a pending operation", async () => {
    const api = bridge();
    vi.mocked(api.listPending).mockResolvedValue({ kind: "OK", operationIds: [operationId] });
    view(api);
    await screen.findByText(/原请求结果待核对/);
    expect(screen.getByRole("button", { name: "新会话" })).toBeDisabled();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("allows an explicit new session after a completed reply and clears only local visible history", async () => {
    const api = bridge();
    view(api);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "旧问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    await screen.findByText("主进程最终发送正文");
    fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
    await screen.findByText("请加强人物动机。");
    fireEvent.click(screen.getByRole("button", { name: "新会话" }));
    await screen.findByText(/已开始新的本地会话/);
    expect(screen.queryByText("请加强人物动机。")).not.toBeInTheDocument();
  });

  it("discards a late preview after the selected saved version changes, with zero sends", async () => {
    const api = bridge();
    let resolvePreview:
      ((value: Awaited<ReturnType<AssistantChatBridge["preview"]>>) => void) | undefined;
    vi.mocked(api.preview).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const props = {
      bridge: api,
      scope,
      profileId,
      model: "text-one",
      modelVerified: true,
      included: true,
      setIncluded: vi.fn(),
      onOpenServices: vi.fn(),
      onOpenEditor: vi.fn(),
    };
    const rendered = render(<AssistantChatConversation {...props} publication={selection} />);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "看此片段" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    const changed: AssistantSelectionPublication =
      selection.kind === "AVAILABLE"
        ? {
            kind: "AVAILABLE",
            selection: { ...selection.selection, contentHash: `sha256:${"9".repeat(64)}` },
          }
        : selection;
    rendered.rerender(<AssistantChatConversation {...props} publication={changed} />);
    resolvePreview?.({
      kind: "READY",
      previewId,
      operationId,
      inputHash: `sha256:${"f".repeat(64)}`,
      outboundText: "旧版本正文",
      includedSources: [],
      historyOmitted: 0,
      contextTruncated: false,
    });
    await waitFor(() => expect(api.discardPreview).toHaveBeenCalledWith(previewId));
    expect(screen.queryByText("旧版本正文")).not.toBeInTheDocument();
    expect(api.send).not.toHaveBeenCalled();
  });

  it("does not submit on ordinary Enter while composing Chinese; Ctrl+Enter requests preview", async () => {
    const api = bridge();
    view(api);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    const input = screen.getByRole("textbox", { name: "给 AI 助手的消息" });
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, ctrlKey: true });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api.preview).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(api.preview).toHaveBeenCalledOnce());
  });

  it("keeps preview errors explicit and does not send", async () => {
    const api = bridge();
    vi.mocked(api.preview).mockResolvedValue({ kind: "NOT_READY", code: "STALE_VERSION" });
    view(api);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "检查场次" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    await screen.findByText(/STALE_VERSION/);
    expect(api.send).not.toHaveBeenCalled();
  });

  it("does not send after a preview transport exception", async () => {
    const api = bridge();
    vi.mocked(api.preview).mockRejectedValue(new Error("network"));
    view(api);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "检查场次" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    await screen.findByText(/发送预览结果不明/);
    expect(api.send).not.toHaveBeenCalled();
  });

  it.each(["ERROR", "THROW"] as const)(
    "blocks preview when pending inventory is %s",
    async (mode) => {
      const api = bridge();
      if (mode === "ERROR")
        vi.mocked(api.listPending).mockResolvedValue({ kind: "ERROR", code: "UNAVAILABLE" });
      else vi.mocked(api.listPending).mockRejectedValue(new Error("offline"));
      view(api);
      await screen.findByText(/无法核对待处理请求/);
      expect(screen.getByRole("button", { name: "预览发送内容" })).toBeDisabled();
      expect(api.preview).not.toHaveBeenCalled();
    },
  );

  it.each([
    "COMPLETED",
    "NOT_SENT",
    "COMPLETED_UNAVAILABLE",
    "REMOTE_UNKNOWN",
    "NOT_FOUND",
  ] as const)("keeps %s pending resolution explicit", async (kind) => {
    const api = bridge();
    vi.mocked(api.listPending).mockResolvedValue({ kind: "OK", operationIds: [operationId] });
    vi.mocked(api.getOperation).mockResolvedValue(
      kind === "COMPLETED"
        ? { kind, operationId, text: "恢复的建议" }
        : kind === "NOT_SENT"
          ? { kind, operationId, code: "DECLINED" }
          : kind === "REMOTE_UNKNOWN"
            ? { kind, operationId, code: "RESULT_UNKNOWN" }
            : { kind, operationId },
    );
    view(api);
    await screen.findByText(/原请求结果待核对/);
    fireEvent.click(screen.getByRole("button", { name: "只读核对结果" }));
    if (kind === "COMPLETED") await screen.findByText("恢复的建议");
    else if (kind === "NOT_SENT") await screen.findByText(/已核对原请求未发送/);
    else if (kind === "COMPLETED_UNAVAILABLE")
      await screen.findByText(/回复正文在本次运行中不可恢复/);
    else await screen.findByText(/原请求结果仍待核对/);
    if (kind === "COMPLETED" || kind === "NOT_SENT")
      expect(screen.queryByText(/原请求结果待核对/)).not.toBeInTheDocument();
    else expect(screen.getByRole("button", { name: "新会话" })).toBeDisabled();
    expect(api.send).not.toHaveBeenCalled();
  });

  it("leaves an unknown operation blocked when its read-only query fails", async () => {
    const api = bridge();
    vi.mocked(api.listPending).mockResolvedValue({ kind: "OK", operationIds: [operationId] });
    vi.mocked(api.getOperation).mockRejectedValue(new Error("read"));
    view(api);
    await screen.findByText(/原请求结果待核对/);
    fireEvent.click(screen.getByRole("button", { name: "只读核对结果" }));
    await screen.findByText(/只读核对失败/);
    expect(screen.getByRole("button", { name: "新会话" })).toBeDisabled();
  });

  it.each(["NOT_SENT", "REMOTE_UNKNOWN"] as const)(
    "treats %s as a distinct one-shot result",
    async (kind) => {
      const api = bridge();
      vi.mocked(api.send).mockResolvedValue(
        kind === "NOT_SENT"
          ? { kind, operationId, code: "DECLINED" }
          : { kind, operationId, code: "RESULT_UNKNOWN" },
      );
      await readyToSend(api);
      fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
      if (kind === "NOT_SENT") await screen.findByText(/请求未发送/);
      else await screen.findByText(/发送结果待核对/);
      expect(api.send).toHaveBeenCalledOnce();
      if (kind === "REMOTE_UNKNOWN")
        expect(screen.getByRole("button", { name: "预览发送内容" })).toBeDisabled();
      else expect(screen.getByRole("button", { name: "预览发送内容" })).toBeEnabled();
    },
  );

  it("blocks subsequent sends after an unsettled send exception", async () => {
    const api = bridge();
    vi.mocked(api.send).mockRejectedValue(new Error("transport"));
    await readyToSend(api);
    fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
    await screen.findByText(/发送结果未知/);
    expect(screen.getByRole("button", { name: "新会话" })).toBeDisabled();
    expect(api.send).toHaveBeenCalledOnce();
  });

  it("keeps an in-flight completed reply in the same conversation when page changes", async () => {
    const api = bridge();
    let complete: ((value: Awaited<ReturnType<AssistantChatBridge["send"]>>) => void) | undefined;
    vi.mocked(api.send).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const props = {
      bridge: api,
      profileId,
      model: "text-one",
      modelVerified: true,
      publication: selection,
      included: true,
      setIncluded: vi.fn(),
      onOpenServices: vi.fn(),
      onOpenEditor: vi.fn(),
    };
    const rendered = render(<AssistantChatConversation {...props} scope={scope} />);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "这一场如何" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    await screen.findByText("主进程最终发送正文");
    fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
    rendered.rerender(
      <AssistantChatConversation
        {...props}
        scope={{ ...scope, page: "storyboard" }}
        publication={{ kind: "NONE" }}
        included={false}
      />,
    );
    complete?.({ kind: "COMPLETED", operationId, text: "已发送后返回的建议" });
    await screen.findByText("已发送后返回的建议");
    expect(screen.getByText(/基于发送时旧上下文/)).toBeInTheDocument();
  });

  it("does not insert an old A reply after switching A to B and back to A", async () => {
    const api = bridge();
    let complete: ((value: Awaited<ReturnType<AssistantChatBridge["send"]>>) => void) | undefined;
    vi.mocked(api.send).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const props = {
      bridge: api,
      scope,
      model: "text-one",
      modelVerified: true,
      publication: selection,
      included: true,
      setIncluded: vi.fn(),
      onOpenServices: vi.fn(),
      onOpenEditor: vi.fn(),
    };
    const rendered = render(<AssistantChatConversation {...props} profileId={profileId} />);
    await waitFor(() => expect(api.listPending).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole("textbox", { name: "给 AI 助手的消息" }), {
      target: { value: "A旧问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览发送内容" }));
    await screen.findByText("主进程最终发送正文");
    fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
    rendered.rerender(
      <AssistantChatConversation {...props} profileId="123e4567-e89b-42d3-a456-426614174099" />,
    );
    rendered.rerender(<AssistantChatConversation {...props} profileId={profileId} />);
    await act(async () => complete?.({ kind: "COMPLETED", operationId, text: "旧A回复" }));
    expect(screen.queryByText("旧A回复")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "给 AI 助手的消息" })).toHaveValue("");
  });

  it("does not apply a delayed scoped operation query after A to B to A", async () => {
    const api = bridge();
    let answer:
      ((value: Awaited<ReturnType<AssistantChatBridge["getOperation"]>>) => void) | undefined;
    vi.mocked(api.listPending)
      .mockResolvedValueOnce({ kind: "OK", operationIds: [operationId] })
      .mockResolvedValue({ kind: "OK", operationIds: [] });
    vi.mocked(api.getOperation).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const props = {
      bridge: api,
      profileId,
      model: "text-one",
      modelVerified: true,
      publication: selection,
      included: true,
      setIncluded: vi.fn(),
      onOpenServices: vi.fn(),
      onOpenEditor: vi.fn(),
    };
    const rendered = render(<AssistantChatConversation {...props} scope={scope} />);
    await screen.findByText(/原请求结果待核对/);
    fireEvent.click(screen.getByRole("button", { name: "只读核对结果" }));
    expect(api.getOperation).toHaveBeenCalledWith({
      operationId,
      expectedProfileId: profileId,
      scope,
    });
    rendered.rerender(
      <AssistantChatConversation
        {...props}
        scope={{ ...scope, projectId: `prj_${"9".repeat(32)}` }}
      />,
    );
    rendered.rerender(<AssistantChatConversation {...props} scope={scope} />);
    await act(async () => answer?.({ kind: "COMPLETED", operationId, text: "旧作用域结果" }));
    expect(screen.queryByText("旧作用域结果")).not.toBeInTheDocument();
  });
});
