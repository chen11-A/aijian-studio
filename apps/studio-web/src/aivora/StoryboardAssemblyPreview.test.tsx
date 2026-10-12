import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStudioTransport } from "../api/studio";
import { StoryboardAssemblyPreview } from "./StoryboardAssemblyPreview";
import { EpisodeStoryboardPanel } from "./EpisodeStoryboardPanel";
import { StoryboardWorkspaceView } from "./StoryboardWorkspaceView";
import {
  readStoryboardAssembly,
  storyboardAssemblyLinks,
  storyboardPreviewContentHash,
} from "./adapters/storyboardAssemblyPreview";
import { emptyStoryboardContent, type StoryboardVersion } from "./adapters/episodeStoryboard";
import {
  staticAnimaticContent,
  type AssemblyVersion,
  type AssemblyGatewayResult,
} from "./adapters/episodeMediaAssembly";
import type { DraftExportGateway } from "./adapters/draftExport";
import type * as Common from "./Common";
import type { WorkspaceParts } from "./CreativeWorkspaceFrame";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
// Keep the actual editors and playback controller; only their app-context shell
// is isolated, as in the existing editor tests. This is not native-window QA.
vi.mock("./Common", async (load) => {
  const actual = await load<typeof Common>();
  return {
    ...actual,
    PageTitle: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header>,
  };
});
vi.mock("./CreativeWorkspaceFrame", () => ({
  CreativeWorkspaceFrame: (parts: WorkspaceParts) => (
    <>
      <aside>
        {parts.outline}
        {parts.outlineAction}
      </aside>
      <header>{parts.tools}</header>
      <main>{parts.children}</main>
      <aside>{parts.properties}</aside>
      <footer>
        {parts.notice}
        {parts.status}
        {parts.actions}
      </footer>
    </>
  ),
}));
const projectId = `prj_${"1".repeat(32)}`;
const episodeId = `ep_${"2".repeat(32)}`;
const request_id = "123e4567-e89b-42d3-a456-426614174000";
let storyboard: StoryboardVersion;
let assembly: AssemblyVersion;
let result: AssemblyGatewayResult;
const readLatest = vi.fn();
const createVersion = vi.fn();
let exports: DraftExportGateway;
const props = () => ({ projectId, episodeId, version: storyboard, dirty: false, disabled: false });
const read = () => fireEvent.click(screen.getByRole("button", { name: "读取本集已保存装配" }));
const receipt = () => ({ kind: "FOUND" as const, receipt: { data: assembly, request_id } });
async function hashAssembly() {
  assembly.content_hash = await storyboardPreviewContentHash(assembly.content);
  result = receipt();
}
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  storyboard = {
    project_id: projectId,
    episode_id: episodeId,
    version_id: `ver_${"3".repeat(32)}`,
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content: {
      ...emptyStoryboardContent(projectId, episodeId),
      fps: 25,
      shots: [1, 2].map((i) => ({
        shot_id: `shp_${String(i).repeat(32)}`,
        ordinal: i,
        title: `第${i}镜`,
        duration_frames: 50,
        description: "真实素材对应的手工镜头",
        camera: "中景",
        action: "相遇",
        dialogue: "你好",
        script_scene_id: null,
        character_ids: [],
        location_id: null,
      })),
    },
    content_hash: "",
    author_actor_id: "local-user",
    change_summary: "手工保存",
    created_at: "2026-10-11T04:00:00Z",
  };
  storyboard.content_hash = await storyboardPreviewContentHash(storyboard.content);
  const media = {
    asset_id: `asset_${"4".repeat(32)}`,
    asset_version_id: `asv_${"5".repeat(32)}`,
    sha256: "6".repeat(64),
  };
  const content = staticAnimaticContent(projectId, episodeId, [
    { media, frames: 50 },
    { media, frames: 50 },
  ]);
  content.visual_segments.forEach((segment, i) => {
    segment.storyboard_ref = {
      storyboard_version_id: storyboard.version_id,
      shot_id: storyboard.content.shots[i]!.shot_id,
    };
  });
  assembly = {
    artifact_id: `art_${"7".repeat(32)}`,
    version_id: `ver_${"8".repeat(32)}`,
    head_revision: 1,
    parent_version_id: null,
    content_hash: "",
    content,
    media_checks: [
      {
        media,
        kind: "image",
        availability: "VERIFIED",
        technical_status: "STILL_HEADER_ONLY",
        rights_status: "PENDING_REVIEW",
      },
    ],
    playback_status: "DRAFT_STATIC_ANIMATIC",
    export_status: "NO_EXPORT_CLAIM",
  };
  await hashAssembly();
  readLatest.mockReset().mockImplementation(async () => result);
  createVersion.mockReset();
  exports = {
    list: vi
      .fn()
      .mockResolvedValue({ kind: "LISTED", receipt: { data: { items: [] }, request_id } }),
    get: vi.fn(),
    createPreview: vi.fn(),
    createFromPicker: vi.fn(),
    cancel: vi.fn(),
    preview: vi.fn(),
    reveal: vi.fn(),
  };
  vi.mocked(createStudioTransport).mockReturnValue({
    episodeMediaAssembly: { readLatest, createVersion },
    draftExports: exports,
    getEpisodeStoryboard: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: storyboard, request_id } }),
    getEpisodeStoryboardVersion: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: storyboard, request_id } }),
    createEpisodeStoryboardVersion: vi.fn(),
  } as unknown as ReturnType<typeof createStudioTransport>);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("exact storyboard to saved assembly playback", () => {
  it("does no automatic assembly read or encode, and selects one hash-verified same-episode snapshot", async () => {
    render(<StoryboardAssemblyPreview {...props()} dirty />);
    expect(readLatest).not.toHaveBeenCalled();
    expect(exports.list).not.toHaveBeenCalled();
    read();
    await screen.findByText(`装配输入版本：${assembly.version_id}`);
    expect(readLatest).toHaveBeenCalledExactlyOnceWith(projectId, episodeId);
    expect(screen.getByText(/分镜有未保存修改/)).toBeInTheDocument();
    await waitFor(() => expect(exports.list).toHaveBeenCalledExactlyOnceWith(projectId, episodeId));
    fireEvent.click(screen.getByRole("button", { name: "展开连续预览" }));
    expect(screen.getByText(`预览输入版本：${assembly.version_id}`)).toBeInTheDocument();
    expect(exports.createPreview).not.toHaveBeenCalled();
    expect(exports.createFromPicker).not.toHaveBeenCalled();
    expect(createVersion).not.toHaveBeenCalled();
  });
  it.each(["old", "unlinked", "missing"])(
    "lists %s links without making a different version playable",
    async (kind) => {
      if (kind === "old")
        assembly.content.visual_segments[0]!.storyboard_ref!.storyboard_version_id = `ver_${"9".repeat(32)}`;
      if (kind === "unlinked") delete assembly.content.visual_segments[0]!.storyboard_ref;
      if (kind === "missing")
        assembly.content.visual_segments[1]!.storyboard_ref!.shot_id =
          storyboard.content.shots[0]!.shot_id;
      await hashAssembly();
      render(<StoryboardAssemblyPreview {...props()} />);
      read();
      await screen.findByText(`装配输入版本：${assembly.version_id}`);
      expect(screen.queryByRole("button", { name: "展开连续预览" })).not.toBeInTheDocument();
      expect(exports.list).not.toHaveBeenCalled();
    },
  );
  it("keeps previous evidence visibly historical on a failed explicit refresh, with playback closed", async () => {
    render(<StoryboardAssemblyPreview {...props()} />);
    read();
    await screen.findByRole("button", { name: "展开连续预览" });
    result = { kind: "REMOTE_UNKNOWN" };
    read();
    await screen.findByText(/装配核对结果未知/);
    expect(screen.getByText(/以下是上次核对的历史记录/)).toBeInTheDocument();
    expect(screen.getByText(`装配输入版本：${assembly.version_id}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展开连续预览" })).not.toBeInTheDocument();
    expect(readLatest).toHaveBeenCalledTimes(2);
    expect(exports.createPreview).not.toHaveBeenCalled();
  });
  it("ignores an A→B→A late read and duplicate clicks without losing parent input", async () => {
    let resolve!: (value: AssemblyGatewayResult) => void;
    readLatest.mockReturnValueOnce(
      new Promise<AssemblyGatewayResult>((done) => {
        resolve = done;
      }),
    );
    const view = render(<StoryboardAssemblyPreview {...props()} />);
    read();
    await waitFor(() => expect(readLatest).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "正在读取关联装配…" }));
    const other = structuredClone(storyboard);
    other.project_id = other.content.project_id = `prj_${"a".repeat(32)}`;
    other.episode_id = other.content.episode_id = `ep_${"b".repeat(32)}`;
    view.rerender(
      <StoryboardAssemblyPreview
        {...props()}
        projectId={other.project_id}
        episodeId={other.episode_id}
        version={other}
      />,
    );
    view.rerender(<StoryboardAssemblyPreview {...props()} dirty />);
    await act(async () => {
      resolve(receipt());
    });
    expect(screen.queryByText(`装配输入版本：${assembly.version_id}`)).not.toBeInTheDocument();
    expect(screen.getByText(/分镜有未保存修改/)).toBeInTheDocument();
    expect(readLatest).toHaveBeenCalledTimes(1);
    read();
    await screen.findByText(`装配输入版本：${assembly.version_id}`);
  });
  it("requires a new explicit read when the saved storyboard version changes", async () => {
    const view = render(<StoryboardAssemblyPreview {...props()} />);
    read();
    await screen.findByRole("button", { name: "展开连续预览" });
    const updated = { ...storyboard, version_id: `ver_${"c".repeat(32)}` };
    view.rerender(<StoryboardAssemblyPreview {...props()} version={updated} />);
    expect(screen.queryByRole("button", { name: "展开连续预览" })).not.toBeInTheDocument();
    expect(readLatest).toHaveBeenCalledTimes(1);
    read();
    await screen.findByText(/2 个画面片段未关联此精确分镜版本/);
    expect(screen.queryByRole("button", { name: "展开连续预览" })).not.toBeInTheDocument();
  });
  it("projects the saved dialogue identity and missing-file state without a voice call or media rebind", async () => {
    const media = {
      asset_id: `asset_${"a".repeat(32)}`,
      asset_version_id: `asv_${"b".repeat(32)}`,
      sha256: "c".repeat(64),
    };
    const script = `ver_${"d".repeat(32)}`;
    const block = `sblk_${"e".repeat(32)}`;
    const speaker = `spk_${"f".repeat(32)}`;
    assembly.content.audio_segments = [
      {
        segment_id: "seg_dialogue_1",
        track_kind: "DIALOGUE",
        media,
        start_frame: 5,
        end_frame: 40,
        source_in_sample: 4800,
        script_version_id: script,
        script_block_id: block,
        speaker_id: speaker,
        delivery: "OFF_SCREEN",
      },
    ];
    assembly.media_checks.push({
      media,
      kind: "audio",
      availability: "MISSING",
      technical_status: "PENDING_MEDIA_PROBE",
      rights_status: "PENDING_REVIEW",
    });
    assembly.playback_status = "BLOCKED_MEDIA_BYTES";
    await hashAssembly();
    render(<StoryboardAssemblyPreview {...props()} />);
    read();
    await screen.findByText(`装配输入版本：${assembly.version_id}`);
    expect(
      screen.getByText(new RegExp(`剧本 ${script}.*对白 ${block}.*发言角色 ${speaker}`)),
    ).toBeInTheDocument();
    expect(screen.getByText(/原件丢失/)).toBeInTheDocument();
    expect(createVersion).not.toHaveBeenCalled();
    expect(exports.createPreview).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "wires the actual storyboard entry (workspace=%s) without discarding edits",
    async (workspace) => {
      const Component = workspace ? StoryboardWorkspaceView : EpisodeStoryboardPanel;
      render(
        <Component projectId={projectId} episodeId={episodeId} setNavigationGuard={vi.fn()} />,
      );
      await screen.findByDisplayValue("第1镜");
      fireEvent.change(screen.getByLabelText("镜头标题"), {
        target: { value: "尚未保存的新标题" },
      });
      if (workspace) fireEvent.click(screen.getByRole("button", { name: "文字预演" }));
      read();
      await screen.findByText(`装配输入版本：${assembly.version_id}`);
      if (workspace) fireEvent.click(screen.getByRole("button", { name: "返回镜头编辑" }));
      expect(screen.getByLabelText("镜头标题")).toHaveValue("尚未保存的新标题");
      expect(createVersion).not.toHaveBeenCalled();
      expect(exports.createPreview).not.toHaveBeenCalled();
    },
  );
});

describe("bounded receipt and exact link validation", () => {
  it.each(["project", "episode", "hash", "request", "source-hash"])(
    "rejects %s contradictions as unknown",
    async (kind) => {
      if (kind === "project") assembly.content.project_id = `prj_${"a".repeat(32)}`;
      if (kind === "episode") assembly.content.episode_id = `ep_${"b".repeat(32)}`;
      if (kind === "hash") assembly.content_hash = `sha256:${"0".repeat(64)}`;
      if (kind === "request")
        result = { kind: "FOUND", receipt: { data: assembly, request_id: "wrong" } };
      if (kind === "source-hash") storyboard.content_hash = `sha256:${"0".repeat(64)}`;
      expect(await readStoryboardAssembly({ readLatest }, storyboard)).toEqual({ kind: "UNKNOWN" });
      expect(createVersion).not.toHaveBeenCalled();
    },
  );
  it("distinguishes exact rational duration and actual sequence order without rebinding clips", () => {
    assembly.content.sequence_timebase.frame_rate = { num: 24000, den: 1001 };
    const first = storyboardAssemblyLinks(storyboard, assembly);
    expect(first.canPreview).toBe(true);
    expect(first.shots.every((item) => !item.durationMatches)).toBe(true);
    assembly.content.visual_segments[0]!.storyboard_ref!.shot_id =
      storyboard.content.shots[1]!.shot_id;
    assembly.content.visual_segments[1]!.storyboard_ref!.shot_id =
      storyboard.content.shots[0]!.shot_id;
    const reversed = storyboardAssemblyLinks(storyboard, assembly);
    expect(reversed.canPreview).toBe(true);
    expect(reversed.orderMatches).toBe(false);
    expect(reversed.shots[0]!.segments[0]!.segment_id).toBe(
      assembly.content.visual_segments[1]!.segment_id,
    );
  });
  it("retains explicit not-found and thrown read as distinct empty and unknown, without retry", async () => {
    readLatest.mockResolvedValueOnce({ kind: "NOT_FOUND", request_id });
    expect(await readStoryboardAssembly({ readLatest }, storyboard)).toEqual({ kind: "EMPTY" });
    readLatest.mockRejectedValueOnce(new Error("read failed"));
    expect(await readStoryboardAssembly({ readLatest }, storyboard)).toEqual({ kind: "UNKNOWN" });
    expect(readLatest).toHaveBeenCalledTimes(2);
  });
});
