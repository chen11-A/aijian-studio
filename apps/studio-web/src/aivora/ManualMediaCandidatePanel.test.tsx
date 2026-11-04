import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import f from "../../../../packages/contracts/fixtures/manual-media-candidate.json";
import { ManualMediaCandidatePanel } from "./ManualMediaCandidatePanel";
import { AssemblyManualCandidates } from "./AssemblyManualCandidates";
import { MediaPreparationWorkflow } from "./MediaPreparationWorkflow";
import {
  mediaHash,
  type MediaPreparationVersion,
  type MediaPreparationGateway,
} from "@aijian/contracts/media-preparation";
import type {
  ManualMediaCandidateGateway,
  ManualMediaCandidateVersion,
  ManualMediaCandidatePage,
  ManualMediaCandidateCommand,
} from "@aijian/contracts/manual-media-candidate";
import type { AssetLibraryGateway, MediaAsset } from "./adapters/assetLibrary";
import type { AssemblyContent } from "./adapters/episodeMediaAssembly";
import type { StudioTransport } from "../api/studio";
import type { MediaInputLeave } from "./MediaInputLeave";
import { emptyAssembly } from "./adapters/assemblyEditing";
import { bindAssemblyShot } from "./adapters/assemblyStoryboard";

const preparation = f.preparation as MediaPreparationVersion;
function gateway() {
  const assets = {
    listProjectMediaAssets: vi.fn().mockResolvedValue({
      kind: "LISTED",
      receipt: { data: f.assets as unknown as MediaAsset[], request_id: f.request_id },
    }),
  } as unknown as AssetLibraryGateway;
  return {
    listManualMediaCandidates: vi
      .fn<ManualMediaCandidateGateway["listManualMediaCandidates"]>()
      .mockResolvedValue({
        kind: "FOUND",
        receipt: { data: f.candidate_page as ManualMediaCandidatePage, request_id: f.request_id },
      }),
    getManualMediaCandidate: vi
      .fn<ManualMediaCandidateGateway["getManualMediaCandidate"]>()
      .mockResolvedValue({
        kind: "FOUND",
        receipt: {
          data: f.candidate_operation.version as ManualMediaCandidateVersion,
          request_id: f.request_id,
        },
      }),
    saveManualMediaCandidate: vi
      .fn<ManualMediaCandidateGateway["saveManualMediaCandidate"]>()
      .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    getManualMediaCandidateOperation: vi
      .fn<ManualMediaCandidateGateway["getManualMediaCandidateOperation"]>()
      .mockImplementation(async (_p, _e, c) => {
        const version = structuredClone(
          f.candidate_operation.version,
        ) as ManualMediaCandidateVersion;
        version.version_id = `ver_${"9".repeat(32)}`;
        version.version_number = 2;
        version.parent_version_id = c.payload.parent_version_id;
        version.content.input = c.payload.input;
        version.content_hash = (await mediaHash(version.content))!;
        return {
          kind: "FOUND",
          receipt: {
            data: { operation_id: c.operation_id, payload: c.payload, version },
            request_id: f.request_id,
          },
        };
      }),
    getMediaPreparation: vi.fn<MediaPreparationGateway["getMediaPreparation"]>().mockResolvedValue({
      kind: "FOUND",
      receipt: { data: preparation, request_id: f.request_id },
    }),
    listMediaPreparations: vi.fn().mockResolvedValue({
      kind: "FOUND",
      receipt: { data: f.preparation_page, request_id: f.request_id },
    }),
    saveMediaPreparation: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    getMediaPreparationOperation: vi.fn(),
    getEpisodeStoryboard: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: f.board, request_id: f.request_id } }),
    getEpisodeStoryboardVersion: vi.fn(),
    assetLibrary: assets,
  };
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function fillCandidate() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "使用已查看的制作请求关联素材" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "使用已查看的制作请求关联素材" }));
  await waitFor(() =>
    expect(screen.getByLabelText("精确本地素材版本").querySelectorAll("option")).toHaveLength(2),
  );
  fireEvent.change(screen.getByLabelText("精确本地素材版本"), {
    target: { value: `${f.assets[0]!.id}/${f.assets[0]!.latest_version.id}` },
  });
  fireEvent.change(screen.getByLabelText("完整手工关联说明"), {
    target: { value: "尚未保存的精确完整关联输入" },
  });
}
test("actual candidate panel keeps unsaved note while inspecting history; UNKNOWN survives true remount and uses original GET only", async () => {
  const api = gateway(),
    owned = new Map<string, ManualMediaCandidateCommand>();
  let leave: MediaInputLeave | null = null;
  const props = {
    projectId: f.project_id,
    episodeId: f.episode_id,
    gateway: api,
    preparation,
    sessionIntents: owned,
    registerLeaveCheck: (c: MediaInputLeave | null) => {
      leave = c;
    },
  };
  const view = render(<ManualMediaCandidatePanel {...props} />);
  await fillCandidate();
  fireEvent.click(screen.getByRole("button", { name: /查看候选 1/ }));
  await screen.findByText(f.candidate_operation.version.content.input.association_note);
  expect(screen.getByLabelText("完整手工关联说明")).toHaveValue("尚未保存的精确完整关联输入");
  expect(leave!.preserve()).toBe(true);
  expect(leave!.dirty()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "保存手工候选关联" }));
  await screen.findByText(/候选关联UNKNOWN/);
  expect(api.saveManualMediaCandidate).toHaveBeenCalledOnce();
  const command = api.saveManualMediaCandidate.mock.calls[0]![2];
  expect(command.payload.input.preparation_version_id).toBe(preparation.version_id);
  expect(command.payload.input.asset_version_id).toBe(f.assets[0]!.latest_version.id);
  view.unmount();
  render(<ManualMediaCandidatePanel {...props} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "只读核对原候选关联" })).toBeEnabled(),
  );
  expect(screen.getByRole("button", { name: "保存手工候选关联" })).toBeDisabled();
  expect(screen.getByLabelText("完整手工关联说明")).toHaveValue(
    command.payload.input.association_note,
  );
  fireEvent.click(screen.getByRole("button", { name: "只读核对原候选关联" }));
  await screen.findByText(/手工候选已持久保存/);
  expect(api.getManualMediaCandidateOperation).toHaveBeenCalledExactlyOnceWith(
    f.project_id,
    f.episode_id,
    command,
  );
  expect(api.saveManualMediaCandidate).toHaveBeenCalledOnce();
  expect(localStorage.length).toBe(0);
});
test("production workflow combines both real child dirty guards into one confirm without clearing either input", async () => {
  const api = gateway();
  let guard: (() => boolean) | null = null;
  render(
    <MediaPreparationWorkflow
      projectId={f.project_id}
      episodeId={f.episode_id}
      gateway={api as unknown as StudioTransport}
      setNavigationGuard={(g) => {
        guard = g;
      }}
      go={vi.fn()}
    />,
  );
  await screen.findByLabelText("完整提示词");
  fireEvent.change(screen.getByLabelText("完整提示词"), {
    target: { value: "制作输入保持未保存" },
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "核对请求 1" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "核对请求 1" }));
  await screen.findByLabelText("精确请求详情");
  fireEvent.click(screen.getByText("关联本地素材为手工候选 · 草稿", { selector: "summary" }));
  await fillCandidate();
  expect(guard!()).toBe(false);
  expect(window.confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("完整提示词")).toHaveValue("制作输入保持未保存");
  expect(screen.getByLabelText("完整手工关联说明")).toHaveValue("尚未保存的精确完整关联输入");
  let finish!: (r: { kind: "REMOTE_UNKNOWN" }) => void;
  api.saveManualMediaCandidate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存手工候选关联" }));
  await waitFor(() => expect(api.saveManualMediaCandidate).toHaveBeenCalledOnce());
  act(() => expect(guard!()).toBe(false));
  expect(window.confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("完整提示词")).toHaveValue("制作输入保持未保存");
  expect(screen.getByText("手工候选正在保存或核对，请等待本次结果再离开。")).toBeVisible();
  expect(screen.queryByText("手工候选原输入日志无法完整保留，请先准确核对。")).toBeNull();
  await act(async () => finish({ kind: "REMOTE_UNKNOWN" }));
});
test("candidate late detail from A B A never replaces current history or unsaved input", async () => {
  const api = gateway(),
    owned = new Map<string, ManualMediaCandidateCommand>();
  let finish!: (
    r: Awaited<ReturnType<ManualMediaCandidateGateway["getManualMediaCandidate"]>>,
  ) => void;
  api.getManualMediaCandidate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const props = {
    projectId: f.project_id,
    episodeId: f.episode_id,
    gateway: api,
    preparation,
    sessionIntents: owned,
  };
  const view = render(<ManualMediaCandidatePanel {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /查看候选 1/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /查看候选 1/ }));
  view.rerender(<ManualMediaCandidatePanel {...props} episodeId={`ep_${"0".repeat(32)}`} />);
  view.rerender(<ManualMediaCandidatePanel {...props} />);
  await fillCandidate();
  await act(async () =>
    finish({
      kind: "FOUND",
      receipt: {
        data: f.candidate_operation.version as ManualMediaCandidateVersion,
        request_id: f.request_id,
      },
    }),
  );
  expect(screen.queryByText(/已保存候选 ver_/)).toBeNull();
  expect(screen.getByLabelText("完整手工关联说明")).toHaveValue("尚未保存的精确完整关联输入");
});
test("actual assembly explicit candidate adoption only edits exact unsaved segment; refreshed history never auto-selects", async () => {
  const api = gateway(),
    onEdit = vi.fn((_c: AssemblyContent) => true),
    onSelect = vi.fn();
  const content = emptyAssembly(f.project_id, f.episode_id);
  const view = render(
    <AssemblyManualCandidates
      content={content}
      selectedId=""
      locked={false}
      gateway={api}
      onEdit={onEdit}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByText("手工本地候选 · 明确选入装配", { selector: "summary" }));
  await waitFor(() =>
    expect(screen.getByLabelText("精确手工候选").querySelectorAll("option")).toHaveLength(2),
  );
  expect(screen.getByLabelText("精确手工候选")).toHaveValue("");
  expect(onEdit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("精确手工候选"), {
    target: { value: f.candidate_operation.version.version_id },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "将候选新增为画面片段" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "将候选新增为画面片段" }));
  expect(onEdit).toHaveBeenCalledOnce();
  const next = onEdit.mock.calls[0]![0] as AssemblyContent;
  expect(next.visual_segments[0]!.manual_candidate_ref).toEqual(
    f.assembly_operation.version.content.visual_segments[0]!.manual_candidate_ref,
  );
  expect(next.visual_segments[0]!.media).toEqual(
    f.assembly_operation.version.content.visual_segments[0]!.media,
  );
  expect(next.total_frames).toBe(preparation.content.snapshot.shot.duration_frames);
  expect(screen.getByText(/已完成手工选入操作；装配保存状态以上方读回结果为准/)).toBeVisible();
  expect(api.saveManualMediaCandidate).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  view.rerender(
    <AssemblyManualCandidates
      content={next}
      selectedId={next.visual_segments[0]!.segment_id}
      locked={false}
      gateway={api}
      onEdit={onEdit}
      onSelect={onSelect}
    />,
  );
  expect(screen.queryByText(/已手工选入未保存装配/)).toBeNull();
  expect(screen.getByText(/已完成手工选入操作；装配保存状态以上方读回结果为准/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "以候选替换所选画面片段" }));
  expect(onEdit).toHaveBeenCalledOnce();
  expect(window.confirm).toHaveBeenCalledOnce();
  const unbound = bindAssemblyShot(next, next.visual_segments[0]!.segment_id, null);
  expect(unbound.visual_segments[0]).not.toHaveProperty("manual_candidate_ref");
});
test("incompatible exact timebase cannot silently round candidate frames", async () => {
  const api = gateway(),
    onEdit = vi.fn((_c: AssemblyContent) => true),
    content = emptyAssembly(f.project_id, f.episode_id);
  content.sequence_timebase.frame_rate = { num: 24, den: 1 };
  render(
    <AssemblyManualCandidates
      content={content}
      selectedId=""
      locked={false}
      gateway={api}
      onEdit={onEdit}
      onSelect={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("手工本地候选 · 明确选入装配", { selector: "summary" }));
  await waitFor(() =>
    expect(screen.getByLabelText("精确手工候选").querySelectorAll("option")).toHaveLength(2),
  );
  fireEvent.change(screen.getByLabelText("精确手工候选"), {
    target: { value: f.candidate_operation.version.version_id },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("不会自动换算帧");
  expect(screen.getByRole("button", { name: "将候选新增为画面片段" })).toBeDisabled();
  expect(onEdit).not.toHaveBeenCalled();
});
