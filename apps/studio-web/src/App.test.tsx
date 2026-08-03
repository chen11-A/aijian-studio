import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { App } from "./App";
import type {
  HealthResponse,
  ProjectData,
  SourceDocumentListResponse,
  SourceDocumentResponse,
  StudioTransport,
} from "./api/studio";

const requestId = "9e049ad6-2b22-4e2d-8d48-e5bd78ee0e11";
const healthyResponse: HealthResponse = {
  data: { status: "ok", service: "aijian-api", version: "0.1.0" },
  request_id: requestId,
};
const project: ProjectData = {
  id: `prj_${"a".repeat(32)}`,
  name: "雾城来信",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  source_language: "zh-CN",
  status: "active",
  revision: 1,
  created_at: "2026-08-03T03:00:00Z",
  updated_at: "2026-08-03T03:00:00Z",
};
const sourceResponse: SourceDocumentResponse = {
  data: {
    id: `src_${"b".repeat(32)}`,
    project_id: project.id,
    filename: "雾城来信.txt",
    media_type: "text/plain",
    encoding: "utf-8",
    byte_size: 28,
    raw_sha256: "c".repeat(64),
    imported_at: "2026-08-03T03:10:00Z",
    chapter_count: 1,
    block_count: 2,
    blocks: [
      {
        id: `srcb_${"d".repeat(32)}`,
        ordinal: 0,
        kind: "chapter_heading",
        chapter_index: 1,
        text: "第一章 初见",
        normalized_start_byte: 0,
        normalized_end_byte: 16,
        content_sha256: "e".repeat(64),
      },
      {
        id: `srcb_${"f".repeat(32)}`,
        ordinal: 1,
        kind: "paragraph",
        chapter_index: 1,
        text: "雨落在霓虹灯下。",
        normalized_start_byte: 17,
        normalized_end_byte: 44,
        content_sha256: "1".repeat(64),
      },
    ],
  },
  request_id: requestId,
};
const sourceSummary: SourceDocumentListResponse["data"][number] = {
  id: sourceResponse.data.id,
  project_id: sourceResponse.data.project_id,
  filename: sourceResponse.data.filename,
  media_type: sourceResponse.data.media_type,
  encoding: sourceResponse.data.encoding,
  byte_size: sourceResponse.data.byte_size,
  raw_sha256: sourceResponse.data.raw_sha256,
  imported_at: sourceResponse.data.imported_at,
  chapter_count: sourceResponse.data.chapter_count,
  block_count: sourceResponse.data.block_count,
};

function studioTransport(projects: ProjectData[] = []): StudioTransport {
  return {
    getHealth: vi.fn().mockResolvedValue(healthyResponse),
    listProjects: vi.fn().mockResolvedValue({ data: projects, request_id: requestId }),
    createProject: vi.fn().mockResolvedValue({ data: project, request_id: requestId }),
    getProject: vi
      .fn()
      .mockResolvedValue({ data: { ...project, revision: 2 }, request_id: requestId }),
    listSources: vi.fn().mockResolvedValue({ data: [], request_id: requestId }),
    getSource: vi.fn().mockResolvedValue(sourceResponse),
    importTextSource: vi.fn().mockResolvedValue(sourceResponse),
  };
}

test("shows a connected, actionable empty workspace", async () => {
  render(<App transport={studioTransport()} />);

  expect(screen.getByText("正在连接创作引擎…")).toBeInTheDocument();
  expect(await screen.findByText("还没有制作项目")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "创建第一个项目" })).toBeEnabled();
  expect(screen.getByText("创作引擎已连接")).toBeInTheDocument();
});

test("creates and opens a project from the keyboard-friendly dialog", async () => {
  const transport = studioTransport();
  render(<App transport={transport} />);
  await screen.findByText("还没有制作项目");

  fireEvent.click(screen.getByRole("button", { name: "创建第一个项目" }));
  const name = screen.getByRole("textbox", { name: "项目名称" });
  fireEvent.change(name, { target: { value: "雾城来信" } });
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

  await waitFor(() => expect(transport.createProject).toHaveBeenCalledOnce());
  expect(await screen.findByRole("heading", { name: "雾城来信" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("imports a TXT file and shows traceable chapter blocks", async () => {
  const transport = studioTransport([project]);
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });
  const file = new File(["第一章 初见\n雨落在霓虹灯下。"], "雾城来信.txt", {
    type: "text/plain",
  });

  fireEvent.change(screen.getByLabelText("选择 TXT 文件"), { target: { files: [file] } });

  await waitFor(() => expect(transport.importTextSource).toHaveBeenCalledOnce());
  expect(await screen.findByText("已解析 1 章 · 2 个文本块")).toBeInTheDocument();
  expect(screen.getByText("第一章 初见")).toBeInTheDocument();
  expect(screen.getByText("雨落在霓虹灯下。")).toBeInTheDocument();
});

test("restores the latest persisted source when a project opens", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.listSources).mockResolvedValueOnce({
    data: [sourceSummary],
    request_id: requestId,
  });
  render(<App transport={transport} />);

  await waitFor(() => expect(transport.listSources).toHaveBeenCalledWith(project.id));
  expect(await screen.findByText("已解析 1 章 · 2 个文本块")).toBeInTheDocument();
  expect(transport.getSource).toHaveBeenCalledWith(project.id, sourceResponse.data.id);
});

test("shows a recoverable connection error", async () => {
  const transport = studioTransport();
  vi.mocked(transport.getHealth)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(healthyResponse);
  render(<App transport={transport} />);

  expect(await screen.findByRole("heading", { name: "创作引擎未连接" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新连接" }));

  await waitFor(() => expect(transport.getHealth).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("还没有制作项目")).toBeInTheDocument();
});

test("keeps project input when creation fails and supports Escape", async () => {
  const transport = studioTransport();
  vi.mocked(transport.createProject).mockRejectedValueOnce(new Error("conflict"));
  render(<App transport={transport} />);
  await screen.findByText("还没有制作项目");

  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), {
    target: { value: "失败后保留" },
  });
  fireEvent.change(screen.getByLabelText("单集目标时长"), { target: { value: "120" } });
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("已输入内容不会丢失");
  expect(screen.getByRole("textbox", { name: "项目名称" })).toHaveValue("失败后保留");
  expect(transport.createProject).toHaveBeenCalledWith(
    expect.objectContaining({ target_duration_seconds: 120 }),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("rejects unsupported and oversized files before transport", async () => {
  const transport = studioTransport([project]);
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });
  const input = screen.getByLabelText("选择 TXT 文件");

  fireEvent.change(input, {
    target: { files: [new File(["text"], "story.md", { type: "text/markdown" })] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("扩展名为 .txt");

  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.txt")] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("超过 5 MiB");
  expect(transport.importTextSource).not.toHaveBeenCalled();
});

test("shows an actionable import error and accepts drag-and-drop", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.importTextSource).mockRejectedValueOnce(new Error("duplicate"));
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });
  const dropZone = screen.getByText("拖入 TXT，或点击选择").closest("label");
  expect(dropZone).not.toBeNull();

  fireEvent.drop(dropZone!, {
    dataTransfer: { files: [new File(["第一章"], "story.txt", { type: "text/plain" })] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent("UTF-8 文本且尚未导入");
});

test("switches between project cards and tolerates an invalid legacy date", async () => {
  const second = {
    ...project,
    id: `prj_${"2".repeat(32)}`,
    name: "夜航",
    updated_at: "invalid-date",
  };
  render(<App transport={studioTransport([project, second])} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /夜航/ }));

  expect(await screen.findByRole("heading", { name: "夜航" })).toBeInTheDocument();
  expect(screen.getByText("刚刚更新")).toBeInTheDocument();
});

test("ignores a stale source restore after the user switches projects", async () => {
  const second = {
    ...project,
    id: `prj_${"2".repeat(32)}`,
    name: "夜航",
  };
  const transport = studioTransport([project, second]);
  let resolveFirstRestore: ((value: SourceDocumentListResponse) => void) | undefined;
  vi.mocked(transport.listSources)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstRestore = resolve;
        }),
    )
    .mockResolvedValueOnce({ data: [], request_id: requestId });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /夜航/ }));
  expect(await screen.findByRole("heading", { name: "夜航" })).toBeInTheDocument();
  resolveFirstRestore?.({ data: [sourceSummary], request_id: requestId });

  await waitFor(() => expect(transport.listSources).toHaveBeenCalledTimes(2));
  expect(transport.getSource).not.toHaveBeenCalled();
});

test("does not show an imported source under a project selected while upload was pending", async () => {
  const second = {
    ...project,
    id: `prj_${"2".repeat(32)}`,
    name: "夜航",
  };
  const transport = studioTransport([project, second]);
  let resolveImport: ((value: SourceDocumentResponse) => void) | undefined;
  vi.mocked(transport.importTextSource).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
  );
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.change(screen.getByLabelText("选择 TXT 文件"), {
    target: { files: [new File(["第一章 初见"], "story.txt", { type: "text/plain" })] },
  });
  await waitFor(() => expect(transport.importTextSource).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: /夜航/ }));
  expect(await screen.findByRole("heading", { name: "夜航" })).toBeInTheDocument();
  resolveImport?.(sourceResponse);

  await waitFor(() => expect(transport.listSources).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("第一章 初见")).not.toBeInTheDocument();
});
