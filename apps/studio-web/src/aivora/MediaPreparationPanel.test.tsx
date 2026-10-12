import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import f from "../../../../packages/contracts/fixtures/media-preparation.json";
import { MEDIA_PREPARATION_SELECTIONS, MediaPreparationPanel } from "./MediaPreparationPanel";
import { MediaPages } from "./MediaPages";
import type {
  MediaPreparationGateway,
  MediaPreparationOperation,
  MediaPreparationPage,
} from "@aijian/contracts/media-preparation";
import type { StoryboardGateway, StoryboardVersion } from "./adapters/episodeStoryboard";
import type * as Model from "./model";

const state = vi.hoisted(() => ({
  page: "generation",
  isFixture: false,
  backendProjectId: "",
  selectedEpisodeId: "",
  shots: [],
  total: 0,
  annotations: [],
  go: vi.fn(),
  setNavigationGuard: vi.fn(),
}));
vi.mock("./model", async (load) => ({ ...(await load<typeof Model>()), useDemo: () => state }));
const version = f.board as StoryboardVersion;
function gateway() {
  return {
    listMediaPreparations: vi
      .fn<MediaPreparationGateway["listMediaPreparations"]>()
      .mockResolvedValue({
        kind: "FOUND",
        receipt: { data: f.page as MediaPreparationPage, request_id: f.request_id },
      }),
    getMediaPreparation: vi.fn<MediaPreparationGateway["getMediaPreparation"]>().mockResolvedValue({
      kind: "FOUND",
      receipt: {
        data: f.operation.version as MediaPreparationOperation["version"],
        request_id: f.request_id,
      },
    }),
    saveMediaPreparation: vi
      .fn<MediaPreparationGateway["saveMediaPreparation"]>()
      .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    getMediaPreparationOperation: vi
      .fn<MediaPreparationGateway["getMediaPreparationOperation"]>()
      .mockResolvedValue({
        kind: "FOUND",
        receipt: { data: f.operation as MediaPreparationOperation, request_id: f.request_id },
      }),
    getEpisodeStoryboard: vi
      .fn<StoryboardGateway["getEpisodeStoryboard"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: version, request_id: f.request_id } }),
    getEpisodeStoryboardVersion: vi.fn<StoryboardGateway["getEpisodeStoryboardVersion"]>(),
  };
}
beforeEach(() => {
  localStorage.clear();
  MEDIA_PREPARATION_SELECTIONS.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.aijian;
});
test("production generation route uses current episode and actual desktop transport", async () => {
  const api = gateway();
  state.backendProjectId = f.project_id;
  state.selectedEpisodeId = f.episode_id;
  window.aijian = api as unknown as Window["aijian"];
  render(<MediaPages />);
  expect(await screen.findByLabelText("完整提示词")).toBeVisible();
  expect(api.listMediaPreparations).toHaveBeenCalledExactlyOnceWith(
    f.project_id,
    f.episode_id,
    undefined,
  );
  expect(api.getEpisodeStoryboard).toHaveBeenCalledWith(f.project_id, f.episode_id);
  fireEvent.change(screen.getByLabelText("完整提示词"), { target: { value: "生产入口完整输入" } });
  fireEvent.click(screen.getByRole("button", { name: "另存制作请求" }));
  await waitFor(() => expect(api.saveMediaPreparation).toHaveBeenCalledOnce());
  expect(api.saveMediaPreparation.mock.calls[0]![2].payload.input.prompt).toBe("生产入口完整输入");
  await screen.findByText(/写入结果未知/);
  expect(screen.getByRole("button", { name: "另存制作请求" })).toBeDisabled();
});
test("read history and exact detail preserve unsaved input; dirty navigation asks before discard", async () => {
  const api = gateway();
  let guard: (() => boolean) | null = null;
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <MediaPreparationPanel
      sessionIntents={new Map()}
      projectId={f.project_id}
      episodeId={f.episode_id}
      gateway={api}
      setNavigationGuard={(g) => {
        guard = g;
      }}
    />,
  );
  await screen.findByLabelText("完整提示词");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "重新读取保存历史" })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("完整提示词"), { target: { value: "保留未保存输入" } });
  fireEvent.click(screen.getByRole("button", { name: "重新读取保存历史" }));
  await waitFor(() => expect(api.listMediaPreparations).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "核对请求 1" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "核对请求 1" }));
  await screen.findByLabelText("精确请求详情");
  expect(screen.getByLabelText("完整提示词")).toHaveValue("保留未保存输入");
  expect(guard!()).toBe(false);
  expect(confirm).toHaveBeenCalledOnce();
  confirm.mockRestore();
});
test("restored pending journal offers GET recovery and cannot submit again", async () => {
  const api = gateway();
  localStorage.setItem(
    `aivora.media-preparation.pending.v1.${f.project_id}.${f.episode_id}`,
    JSON.stringify(f.command),
  );
  render(
    <MediaPreparationPanel
      sessionIntents={new Map()}
      projectId={f.project_id}
      episodeId={f.episode_id}
      gateway={api}
    />,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "只读核对原操作" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "只读核对原操作" }));
  await screen.findByText(/完整制作请求已保存/);
  expect(api.getMediaPreparationOperation).toHaveBeenCalledExactlyOnceWith(
    f.project_id,
    f.episode_id,
    f.command,
  );
  expect(api.saveMediaPreparation).not.toHaveBeenCalled();
});
test("A B A old detail cannot appear after the newer generation", async () => {
  const api = gateway();
  let finish!: (v: Awaited<ReturnType<MediaPreparationGateway["getMediaPreparation"]>>) => void;
  api.getMediaPreparation.mockReturnValueOnce(
    new Promise((yes) => {
      finish = yes;
    }),
  );
  const view = render(
    <MediaPreparationPanel
      sessionIntents={new Map()}
      projectId={f.project_id}
      episodeId={f.episode_id}
      gateway={api}
    />,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "核对请求 1" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "核对请求 1" }));
  view.rerender(
    <MediaPreparationPanel
      sessionIntents={new Map()}
      projectId={f.project_id}
      episodeId={`ep_${"f".repeat(32)}`}
      gateway={api}
    />,
  );
  view.rerender(
    <MediaPreparationPanel
      sessionIntents={new Map()}
      projectId={f.project_id}
      episodeId={f.episode_id}
      gateway={api}
    />,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "核对请求 1" })).toBeEnabled());
  await act(async () =>
    finish({
      kind: "FOUND",
      receipt: {
        data: f.operation.version as MediaPreparationOperation["version"],
        request_id: f.request_id,
      },
    }),
  );
  expect(screen.queryByLabelText("精确请求详情")).toBeNull();
});
test("unavailable browser-only transport cannot silently write preparation data", () => {
  render(
    <MediaPreparationPanel
      sessionIntents={new Map()}
      projectId={f.project_id}
      episodeId={f.episode_id}
      gateway={{}}
    />,
  );
  expect(screen.getByText(/缺少媒体请求准备接口/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "另存制作请求" })).toBeNull();
});

test("reopen restores the exact selected history version even beyond the first page without replacing input", async () => {
  const api = gateway();
  const props = {
    projectId: f.project_id,
    episodeId: f.episode_id,
    gateway: api,
    sessionIntents: new Map(),
  };
  const first = render(<MediaPreparationPanel {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "核对请求 1" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "核对请求 1" }));
  await screen.findByLabelText("精确请求详情");
  first.unmount();
  // Controlled validated history response omits the older selection; the exact GET remains authoritative.
  api.listMediaPreparations.mockResolvedValue({
    kind: "FOUND",
    receipt: {
      request_id: f.request_id,
      data: { ...f.page, items: [], next_cursor: null } as MediaPreparationPage,
    },
  });
  const onSelected = vi.fn();
  render(<MediaPreparationPanel {...props} onSelected={onSelected} />);
  await screen.findByLabelText("精确请求详情");
  expect(api.getMediaPreparation).toHaveBeenLastCalledWith(
    f.project_id,
    f.episode_id,
    f.operation.version.version_id,
  );
  expect(onSelected).toHaveBeenLastCalledWith(f.operation.version);
  expect(screen.getByLabelText("完整提示词")).toHaveValue("");
  expect(api.saveMediaPreparation).not.toHaveBeenCalled();
  expect(api.getMediaPreparationOperation).not.toHaveBeenCalled();
});

test("returning selection rejects a valid different hash and keeps UNKNOWN input with no resend", async () => {
  const api = gateway();
  MEDIA_PREPARATION_SELECTIONS.set(`${f.project_id}/${f.episode_id}`, {
    versionId: f.operation.version.version_id,
    hash: `sha256:${"f".repeat(64)}`,
  });
  localStorage.setItem(
    `aivora.media-preparation.pending.v1.${f.project_id}.${f.episode_id}`,
    JSON.stringify(f.command),
  );
  render(
    <MediaPreparationPanel
      projectId={f.project_id}
      episodeId={f.episode_id}
      gateway={api}
      sessionIntents={new Map()}
    />,
  );
  await screen.findByText(/原选制作请求版本或哈希无法核对/);
  expect(screen.queryByLabelText("精确请求详情")).toBeNull();
  expect(screen.getByLabelText("完整提示词")).toHaveValue(f.command.payload.input.prompt);
  expect(screen.getByRole("button", { name: "另存制作请求" })).toBeDisabled();
  expect(
    JSON.parse(
      localStorage.getItem(`aivora.media-preparation.pending.v1.${f.project_id}.${f.episode_id}`)!,
    ),
  ).toEqual(f.command);
  expect(api.saveMediaPreparation).not.toHaveBeenCalled();
  expect(api.getMediaPreparationOperation).not.toHaveBeenCalled();
});

test("a cached selection's late A read cannot replace the new A generation after B", async () => {
  const api = gateway();
  const selected = f.operation.version as MediaPreparationOperation["version"];
  MEDIA_PREPARATION_SELECTIONS.set(`${f.project_id}/${f.episode_id}`, {
    versionId: selected.version_id,
    hash: selected.content_hash,
  });
  let finish!: (
    result: Awaited<ReturnType<MediaPreparationGateway["getMediaPreparation"]>>,
  ) => void;
  api.getMediaPreparation.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onSelected = vi.fn();
  const props = {
    projectId: f.project_id,
    episodeId: f.episode_id,
    gateway: api,
    sessionIntents: new Map(),
    onSelected,
  };
  const view = render(<MediaPreparationPanel {...props} />);
  await waitFor(() => expect(api.getMediaPreparation).toHaveBeenCalledOnce());
  view.rerender(<MediaPreparationPanel {...props} episodeId={`ep_${"f".repeat(32)}`} />);
  view.rerender(<MediaPreparationPanel {...props} />);
  await screen.findByLabelText("精确请求详情");
  await waitFor(() => expect(onSelected).toHaveBeenLastCalledWith(selected));
  const calls = onSelected.mock.calls.length;
  await act(async () =>
    finish({
      kind: "FOUND",
      receipt: {
        request_id: f.request_id,
        data: { ...selected, content_hash: `sha256:${"f".repeat(64)}` },
      },
    }),
  );
  expect(onSelected).toHaveBeenCalledTimes(calls);
  expect(onSelected).toHaveBeenLastCalledWith(selected);
  expect(api.saveMediaPreparation).not.toHaveBeenCalled();
});
