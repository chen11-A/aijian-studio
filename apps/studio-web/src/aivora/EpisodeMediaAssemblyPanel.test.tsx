import "@testing-library/jest-dom/vitest";
import { createHash, webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSEMBLY_MONITOR_SIZES,
  ASSEMBLY_VIEW_POSITIONS,
  EpisodeMediaAssemblyPanel,
} from "./EpisodeMediaAssemblyPanel";
import { assemblyScriptSources } from "@aijian/contracts/assembly-script-provenance";
import { ASSEMBLY_SESSION_HEADS, useEpisodeAssembly } from "./useEpisodeAssembly";
import { bindAssemblyShot } from "./adapters/assemblyStoryboard";
import { ASSEMBLY_SESSION_INTENTS } from "./adapters/assemblyExact";
import type { AssemblyExactGateway, AssemblyExactCommand } from "@aijian/contracts/assembly-exact";
import { impactCanonical } from "@aijian/contracts/script-confirmation-impact";
import type { ScriptVersion } from "./adapters/episodeScript";
import { staticAnimaticContent } from "./adapters/episodeMediaAssembly";
import type { AssetLibraryGateway, AssetVersion, MediaAsset } from "./adapters/assetLibrary";
import type {
  AssemblyContent,
  AssemblyReceipt,
  EpisodeMediaAssemblyGateway,
} from "./adapters/episodeMediaAssembly";

const projectId = `prj_${"1".repeat(32)}`,
  episodeId = `ep_${"8".repeat(32)}`;
function asset(kind: "video" | "image" | "audio", digit: string): MediaAsset {
  const version: AssetVersion = {
    id: `asv_${digit.repeat(32)}`,
    ordinal: 1,
    filename: `${kind}-local.${kind === "audio" ? "wav" : kind === "video" ? "mp4" : "png"}`,
    kind,
    mime_type: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : "image/png",
    byte_size: 4,
    sha256: digit.repeat(64),
    rights_status: "PENDING_REVIEW",
    source_kind: "LOCAL_IMPORT",
    technical_metadata: {},
    created_at: "2026-10-08",
    availability: "VERIFIED",
  };
  return {
    id: `asset_${digit.repeat(32)}`,
    project_id: projectId,
    created_at: "2026-10-08",
    latest_version: version,
    versions: [version],
    episode_references: [],
  };
}
const library = [asset("video", "2"), asset("image", "3"), asset("audio", "4")];
function makeReceipt(
  content: AssemblyContent,
  parent: string | null,
  revision: number,
): AssemblyReceipt {
  return {
    request_id: "11111111-1111-4111-8111-111111111111",
    data: {
      artifact_id: `art_${"5".repeat(32)}`,
      version_id: `ver_${String(revision).repeat(32)}`,
      content_hash: `sha256:${createHash("sha256").update(impactCanonical(content)).digest("hex")}`,
      head_revision: revision,
      parent_version_id: parent,
      content,
      ...(content.script_provenance?.mode === "DRAFT"
        ? {
            script_source_status: {
              state: "DRAFT_UNCONFIRMED" as const,
              latest_confirmation: null,
              newer_draft_available: false,
              dialogue_segment_ids: assemblyScriptSources(content)
                .filter((s) => s.kind === "DIALOGUE")
                .map((s) => s.segmentId),
              subtitle_segment_ids: assemblyScriptSources(content)
                .filter((s) => s.kind === "SUBTITLE")
                .map((s) => s.segmentId),
            },
          }
        : {}),
      playback_status: "BLOCKED_MEDIA_PROBE",
      export_status: "NO_EXPORT_CLAIM",
      media_checks: library.map((item) => ({
        media: {
          asset_id: item.id,
          asset_version_id: item.latest_version.id,
          sha256: item.latest_version.sha256,
        },
        kind: item.latest_version.kind,
        availability: "VERIFIED",
        technical_status:
          item.latest_version.kind === "image" ? "STILL_HEADER_ONLY" : "PENDING_MEDIA_PROBE",
        rights_status: "PENDING_REVIEW",
      })),
    },
  };
}
function setup() {
  let stored: AssemblyReceipt | null = null;
  const assets: AssetLibraryGateway = {
    listProjectMediaAssets: vi.fn().mockResolvedValue({
      kind: "LISTED",
      receipt: { request_id: "library-test", data: library },
    }),
    getProjectMediaAsset: vi.fn(),
    importProjectMediaAssetFromPicker: vi.fn(),
    importProjectMediaAssetVersionFromPicker: vi.fn(),
    readProjectMediaAssetPreview: vi.fn(async (_p: string, id: string) => {
      const item = library.find((candidate) => candidate.id === id)!;
      return {
        kind: "READY" as const,
        mime_type: item.latest_version.mime_type,
        sha256: item.latest_version.sha256,
        bytes: new Uint8Array(4),
      };
    }),
    addProjectMediaAssetEpisodeReference: vi.fn(),
    removeProjectMediaAssetEpisodeReference: vi.fn(),
    deleteProjectMediaAsset: vi.fn(),
  };
  const operations = new Map<string, Awaited<ReturnType<AssemblyExactGateway["saveExact"]>>>();
  const assembly: EpisodeMediaAssemblyGateway & AssemblyExactGateway = {
    readLatest: vi.fn(async () =>
      stored
        ? { kind: "FOUND" as const, receipt: stored }
        : { kind: "NOT_FOUND" as const, request_id: "empty" },
    ),
    createVersion: vi.fn(),
    saveExact: vi.fn(async (_p: string, _e: string, command: AssemblyExactCommand) => {
      stored = makeReceipt(
        command.payload.content,
        command.payload.parent_version_id,
        (command.payload.expected_revision ?? 0) + 1,
      );
      const result = {
        kind: "FOUND" as const,
        receipt: {
          request_id: stored.request_id,
          data: {
            operation_id: command.operation_id,
            payload: command.payload,
            result_revision: stored.data.head_revision,
            version: stored.data,
          },
        },
      };
      operations.set(command.operation_id, result);
      return result;
    }),
    getOriginal: vi.fn(async (_p: string, _e: string, command: AssemblyExactCommand) => {
      const result = operations.get(command.operation_id);
      return result?.kind === "FOUND" ? result : { kind: "REMOTE_UNKNOWN" as const };
    }),
  };
  const setNavigationGuard = vi.fn<(guard: (() => boolean) | null) => void>();
  return { assets, assembly, setNavigationGuard, stored: () => stored };
}
function draftContent() {
  const item = library[1]!;
  return staticAnimaticContent(projectId, episodeId, [
    {
      media: {
        asset_id: item.id,
        asset_version_id: item.latest_version.id,
        sha256: item.latest_version.sha256,
      },
      frames: 50,
    },
  ]);
}
function unloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}
async function add(kind: "video" | "image" | "audio") {
  const choice = library.find((item) => item.latest_version.kind === kind)!;
  fireEvent.change(screen.getByLabelText("选择已导入素材版本"), {
    target: { value: `${choice.id}/${choice.latest_version.id}` },
  });
  fireEvent.click(
    screen.getByRole("button", { name: kind === "audio" ? "加入音频片段" : "加入画面轨" }),
  );
}
beforeEach(() => {
  localStorage.clear();
  ASSEMBLY_SESSION_INTENTS.clear();
  ASSEMBLY_SESSION_HEADS.clear();
  ASSEMBLY_VIEW_POSITIONS.clear();
  ASSEMBLY_MONITOR_SIZES.clear();
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:verified-local-original"),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native local-media episode assembly panel", () => {
  it("reopens the same verified saved segment and frame after the audio-only view without any save", async () => {
    const api = setup();
    const content = draftContent();
    content.visual_segments.push({
      ...content.visual_segments[0]!,
      segment_id: `seg_${"9".repeat(32)}`,
      start_frame: 50,
      end_frame: 100,
    });
    content.total_frames = 100;
    const saved = makeReceipt(content, null, 1);
    vi.mocked(api.assembly.readLatest).mockResolvedValue({ kind: "FOUND", receipt: saved });
    const props = { ...api, projectId, episodeId };
    const first = render(<EpisodeMediaAssemblyPanel {...props} />);
    await screen.findByText("已读回保存版本");
    const segments = within(screen.getByRole("list", { name: "画面片段" })).getAllByRole("button");
    await waitFor(() => expect(segments[1]).toBeEnabled());
    fireEvent.click(segments[1]!);
    fireEvent.change(screen.getByLabelText("剪切位置（序列帧）"), { target: { value: "85" } });
    first.unmount();
    const voice = render(<EpisodeMediaAssemblyPanel {...props} audioOnly />);
    await screen.findByText("已读回保存版本");
    fireEvent.change(screen.getByLabelText("剪切位置（序列帧）"), { target: { value: "12" } });
    voice.unmount();
    render(<EpisodeMediaAssemblyPanel {...props} />);
    await waitFor(() => expect(screen.getByLabelText("剪切位置（序列帧）")).toHaveValue(85));
    expect(
      within(screen.getByRole("list", { name: "画面片段" })).getAllByRole("button")[1],
    ).toHaveAttribute("aria-pressed", "true");
    expect(api.assembly.saveExact).not.toHaveBeenCalled();
    expect(api.assembly.createVersion).not.toHaveBeenCalled();
    expect(api.assembly.getOriginal).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("does not apply a saved position to a changed version or another episode", async () => {
    const api = setup();
    const content = draftContent(),
      saved = makeReceipt(content, null, 1);
    ASSEMBLY_VIEW_POSITIONS.set(`${projectId}/${episodeId}/assembly`, {
      versionId: `ver_${"9".repeat(32)}`,
      hash: saved.data.content_hash,
      segmentId: content.visual_segments[0]!.segment_id,
      frame: 30,
    });
    vi.mocked(api.assembly.readLatest).mockResolvedValue({ kind: "FOUND", receipt: saved });
    const view = render(
      <EpisodeMediaAssemblyPanel {...api} projectId={projectId} episodeId={episodeId} />,
    );
    await screen.findByText(/未套用原片段与帧定位/);
    expect(screen.getByLabelText("剪切位置（序列帧）")).toHaveValue(0);
    expect(
      within(screen.getByRole("list", { name: "画面片段" })).getByRole("button"),
    ).toHaveAttribute("aria-pressed", "false");
    view.unmount();
    const otherEpisode = `ep_${"a".repeat(32)}`;
    vi.mocked(api.assembly.readLatest).mockResolvedValue({
      kind: "FOUND",
      receipt: makeReceipt({ ...content, episode_id: otherEpisode }, null, 1),
    });
    render(<EpisodeMediaAssemblyPanel {...api} projectId={projectId} episodeId={otherEpisode} />);
    await screen.findByText("已读回保存版本");
    expect(screen.getByLabelText("剪切位置（序列帧）")).toHaveValue(0);
    expect(api.assembly.saveExact).not.toHaveBeenCalled();
  });
  it("authors imported dialogue audio through undo, save, readback and reopen without rewriting old versions", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const dialogueEpisode = `ep_${"a".repeat(32)}`;
    const blockId = `sblk_${"b".repeat(32)}`;
    const source: ScriptVersion = {
      project_id: projectId,
      episode_id: dialogueEpisode,
      version_id: `ver_${"c".repeat(32)}`,
      version_number: 1,
      head_revision: 1,
      parent_version_id: null,
      content_hash: `sha256:${"d".repeat(64)}`,
      author_actor_id: "local-user",
      change_summary: "Recorded dialogue source",
      created_at: "2026-10-09T00:00:00Z",
      content: {
        schema_version: "1.0.0",
        project_id: projectId,
        episode_id: dialogueEpisode,
        scenes: [
          {
            scene_id: `scn_${"e".repeat(32)}`,
            ordinal: 1,
            heading: "码头 · 夜",
            blocks: [
              {
                block_id: blockId,
                ordinal: 1,
                kind: "DIALOGUE",
                speaker: "阿岚 🎙",
                text: "出发吧。",
                delivery: "ON_SCREEN",
              },
            ],
          },
        ],
      },
    };
    const script = {
      getEpisodeScript: vi
        .fn()
        .mockResolvedValue({ kind: "FOUND", receipt: { data: source, request_id: "script" } }),
      getEpisodeScriptVersion: vi
        .fn()
        .mockResolvedValue({ kind: "FOUND", receipt: { data: source, request_id: "script-pin" } }),
    };
    const env = setup();
    let view = render(
      <EpisodeMediaAssemblyPanel
        projectId={projectId}
        episodeId={dialogueEpisode}
        script={script}
        {...env}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("选择已导入素材版本")).toBeEnabled());
    await add("image");
    await add("audio");
    fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
    await screen.findByText("已从项目重新读回装配版本。");
    const old = env.stored()!;
    fireEvent.click(screen.getByText(/^对白轨 ·/, { selector: "summary" }));
    fireEvent.change(await screen.findByLabelText("本集已保存剧本对白"), {
      target: { value: blockId },
    });
    fireEvent.click(screen.getByRole("button", { name: "绑定所选音频为对白轨" }));
    expect(screen.getByText("有未保存修改")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "音频片段" })).getByRole("button", {
        name: /^DIALOGUE/,
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByText("已撤销本地修改。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
    await screen.findByText("已从项目重新读回装配版本。");
    const audio = env.stored()!.data.content.audio_segments[0]!;
    expect(audio).toMatchObject({
      track_kind: "DIALOGUE",
      script_version_id: source.version_id,
      script_block_id: blockId,
      delivery: "ON_SCREEN",
      speaker_id: `spk_${createHash("sha256")
        .update(JSON.stringify([projectId, dialogueEpisode, source.version_id, "阿岚 🎙"]), "utf8")
        .digest("hex")
        .slice(0, 32)}`,
    });
    expect(audio.media).toEqual(old.data.content.audio_segments[0]!.media);
    expect(audio.source_in_sample).toBe(old.data.content.audio_segments[0]!.source_in_sample);
    expect(old.data.content.audio_segments[0]!.track_kind).toBe("BGM");
    view.unmount();
    view = render(
      <EpisodeMediaAssemblyPanel
        projectId={projectId}
        episodeId={dialogueEpisode}
        script={script}
        {...env}
      />,
    );
    await screen.findByText("已从项目重新读回装配版本。");
    fireEvent.click(
      within(screen.getByRole("list", { name: "音频片段" })).getByRole("button", {
        name: /^DIALOGUE/,
      }),
    );
    fireEvent.click(screen.getByText(/^对白轨 ·/, { selector: "summary" }));
    await screen.findByText(`固定对白：${source.version_id} / ${blockId}`);
    expect(env.assembly.saveExact).toHaveBeenCalledTimes(2);
    expect(env.stored()!.data.parent_version_id).toBe(old.data.version_id);
    expect(script.getEpisodeScriptVersion).toHaveBeenCalledWith(
      projectId,
      dialogueEpisode,
      source.version_id,
    );
    const boundVersion = env.stored()!;
    fireEvent.click(screen.getByRole("button", { name: "改为 BGM 并移除对白绑定" }));
    fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
    await screen.findByText("已从项目重新读回装配版本。");
    expect(env.stored()!.data.content.audio_segments[0]).toMatchObject({
      track_kind: "BGM",
      script_version_id: null,
      script_block_id: null,
      speaker_id: null,
      delivery: null,
    });
    expect(screen.queryByText(/先前写入结果未知/)).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(boundVersion.data.content.audio_segments[0]!.track_kind).toBe("DIALOGUE");
    view.unmount();
    render(
      <EpisodeMediaAssemblyPanel
        projectId={projectId}
        episodeId={dialogueEpisode}
        script={script}
        {...env}
      />,
    );
    await screen.findByText("已从项目重新读回装配版本。");
    expect(
      within(screen.getByRole("list", { name: "音频片段" })).getByRole("button", { name: /^BGM/ }),
    ).toBeInTheDocument();
    expect(env.assembly.saveExact).toHaveBeenCalledTimes(3);
  });
  it("saves exact shot links through undo, readback and reopening without changing old content", async () => {
    const env = setup();
    let view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    const original = draftContent();
    act(() => {
      view.result.current.edit(original);
    });
    await act(async () => {
      await view.result.current.save();
    });
    const first = env.stored()!;
    const reference = {
      storyboard_version_id: `ver_${"c".repeat(32)}`,
      shot_id: `shp_${"d".repeat(32)}`,
    };
    act(() => {
      view.result.current.edit(
        bindAssemblyShot(original, original.visual_segments[0]!.segment_id, reference),
      );
    });
    act(() => {
      view.result.current.undo();
    });
    expect(view.result.current.content).toEqual(original);
    act(() => {
      view.result.current.undo(true);
    });
    await act(async () => {
      await view.result.current.save();
    });
    expect(view.result.current.writeUnknown).toBe(false);
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.content.visual_segments[0]!.storyboard_ref).toEqual(reference);
    expect(first.data.content.visual_segments[0]).not.toHaveProperty("storyboard_ref");
    view.unmount();
    view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    expect(view.result.current.content.visual_segments[0]!.storyboard_ref).toEqual(reference);
    expect(view.result.current.content.total_frames).toBe(original.total_frames);
  });
  it("adds/cuts/trims/reorders/deletes true asset references and saves/reopens the rational sequence", async () => {
    const env = setup();
    const view = render(
      <EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />,
    );
    await waitFor(() => expect(screen.getByLabelText("选择已导入素材版本")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("序列帧率"), { target: { value: "3" } });
    await add("video");
    await waitFor(() =>
      expect(screen.getByLabelText("所选视频原件")).toHaveAttribute(
        "src",
        "blob:verified-local-original",
      ),
    );
    fireEvent.change(screen.getByLabelText("剪切位置（序列帧）"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "在此帧分割" }));
    expect(
      within(screen.getByRole("list", { name: "画面片段" })).getAllByRole("button"),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "向后移动" }));
    const clips = within(screen.getByRole("list", { name: "画面片段" })).getAllByRole("button");
    fireEvent.click(clips[0]!);
    fireEvent.change(screen.getByLabelText("片段时长（帧）"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("视频源入点（帧）"), { target: { value: "32" } });
    fireEvent.click(screen.getByRole("button", { name: "应用裁剪" }));
    await add("image");
    fireEvent.click(screen.getByRole("button", { name: "删除所选片段" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    await add("audio");
    fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
    await waitFor(() => expect(screen.getByText("已从项目重新读回装配版本。")).toBeInTheDocument());
    const saved = env.stored()!.data.content;
    expect(saved.sequence_timebase.frame_rate).toEqual({ num: 30000, den: 1001 });
    expect(
      saved.visual_segments.map((clip) => [clip.start_frame, clip.end_frame, clip.source_in_frame]),
    ).toEqual([
      [0, 20, 32],
      [20, 50, 0],
    ]);
    expect(saved.audio_segments[0]!.track_kind).toBe("BGM");
    expect(localStorage.length).toBe(0);
    view.unmount();
    render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await waitFor(() => expect(screen.getByText("已从项目重新读回装配版本。")).toBeInTheDocument());
    expect(
      within(screen.getByRole("list", { name: "画面片段" })).getAllByRole("button"),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole("list", { name: "音频片段" })).getAllByRole("button"),
    ).toHaveLength(1);
    expect(env.assembly.saveExact).toHaveBeenCalledTimes(1);
  });
  it("keeps unknown writes locked across reopen and never resubmits", async () => {
    const env = setup();
    vi.mocked(env.assembly.saveExact).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    const view = render(
      <EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />,
    );
    await waitFor(() => expect(screen.getByLabelText("选择已导入素材版本")).toBeEnabled());
    await add("video");
    fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("先前写入结果未知"));
    view.unmount();
    render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeDisabled();
    expect(env.assembly.saveExact).toHaveBeenCalledTimes(1);
  });
  it.each(["replaced", "removed"])(
    "a late source rejection cannot clear a %s unresolved journal or allow resend",
    async (mutation) => {
      const env = setup();
      let resolve!: (r: Awaited<ReturnType<AssemblyExactGateway["saveExact"]>>) => void;
      vi.mocked(env.assembly.saveExact).mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
      await waitFor(() => expect(view.result.current.locked).toBe(false));
      act(() => {
        view.result.current.edit(draftContent());
      });
      let saving!: Promise<void>;
      act(() => {
        saving = view.result.current.save();
      });
      const key = `aivora.assembly-exact.pending.v2.${projectId}.${episodeId}`,
        original = localStorage.getItem(key)!;
      if (mutation === "replaced") localStorage.setItem(key, "another-unresolved-record");
      else localStorage.removeItem(key);
      await act(async () => {
        resolve({
          kind: "DEFINITE_SERVER_ERROR",
          status: 409,
          code: "SCRIPT_CONFIRMATION_SUPERSEDED",
          request_id: "11111111-1111-4111-8111-111111111111",
        });
        await saving;
      });
      expect(localStorage.getItem(key)).toBe(
        mutation === "replaced" ? "another-unresolved-record" : original,
      );
      await act(async () => {
        await view.result.current.load();
        await view.result.current.save();
      });
      expect(view.result.current.writeUnknown).toBe(true);
      expect(view.result.current.locked).toBe(true);
      expect(env.assembly.saveExact).toHaveBeenCalledOnce();
    },
  );
  it("a matching latest head cannot unlock UNKNOWN; exact original GET does, then reads current head", async () => {
    const env = setup(),
      c = draftContent();
    c.subtitle_segments = [
      {
        segment_id: "seg_confirmed",
        start_frame: 0,
        end_frame: 20,
        text: "旧确认。",
        render_profile: "noto-cjk-sc-bottom-v1",
        script_ref: {
          script_version_id: `ver_${"a".repeat(32)}`,
          script_block_id: `sblk_${"b".repeat(32)}`,
          script_content_hash: `sha256:${"c".repeat(64)}`,
        },
      },
    ];
    c.script_provenance = {
      mode: "CONFIRMED",
      confirmation_id: `esc_${"d".repeat(32)}`,
      script_version_id: `ver_${"a".repeat(32)}`,
      script_content_hash: `sha256:${"c".repeat(64)}`,
    };
    vi.mocked(env.assembly.saveExact).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    const view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    act(() => {
      view.result.current.edit(c);
    });
    await act(async () => {
      await view.result.current.save();
    });
    expect(view.result.current.writeUnknown).toBe(true);
    const r = makeReceipt(c, null, 1);
    r.data.script_source_status = {
      state: "CONFIRMATION_SUPERSEDED",
      latest_confirmation: {
        confirmation_id: `esc_${"e".repeat(32)}`,
        project_id: projectId,
        episode_id: episodeId,
        artifact_id: `art_${"f".repeat(32)}`,
        version_id: `ver_${"e".repeat(32)}`,
        content_hash: `sha256:${"f".repeat(64)}`,
        head_revision: 2,
        actor_id: "local-user",
        confirmed_at: "2026-10-11T00:00:00Z",
      },
      newer_draft_available: false,
      dialogue_segment_ids: [],
      subtitle_segment_ids: ["seg_confirmed"],
    };
    vi.mocked(env.assembly.readLatest).mockResolvedValue({ kind: "FOUND", receipt: r });
    await act(async () => {
      await view.result.current.load();
    });
    expect(view.result.current.writeUnknown).toBe(true);
    expect(env.assembly.getOriginal).not.toHaveBeenCalled();
    const pending = JSON.parse(
      localStorage.getItem(`aivora.assembly-exact.pending.v2.${projectId}.${episodeId}`)!,
    ) as AssemblyExactCommand;
    vi.mocked(env.assembly.getOriginal).mockResolvedValue({
      kind: "FOUND",
      receipt: {
        request_id: r.request_id,
        data: {
          operation_id: pending.operation_id,
          payload: pending.payload,
          result_revision: 1,
          version: r.data,
        },
      },
    });
    await act(async () => {
      await view.result.current.recover();
    });
    expect(view.result.current.writeUnknown).toBe(false);
    expect(view.result.current.version!.script_source_status!.state).toBe(
      "CONFIRMATION_SUPERSEDED",
    );
    expect(env.assembly.saveExact).toHaveBeenCalledOnce();
    expect(
      localStorage.getItem(`aivora.assembly-exact.pending.v2.${projectId}.${episodeId}`),
    ).toBeNull();
  });
  it("guards the latest dirty edits on navigation and close, and requires discard for a manual reload", async () => {
    const env = setup();
    const view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    const guard = env.setNavigationGuard.mock.calls.at(-1)?.[0];
    expect(guard).toBeTypeOf("function");
    expect(guard?.()).toBe(true);
    expect(unloadPrevented()).toBe(false);
    act(() => {
      view.result.current.edit(draftContent());
    });
    vi.mocked(window.confirm).mockReturnValue(false);
    act(() => {
      expect(guard?.()).toBe(false);
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("放弃"));
    expect(unloadPrevented()).toBe(true);
    await act(async () => {
      await view.result.current.load();
    });
    expect(env.assembly.readLatest).toHaveBeenCalledTimes(1);
    expect(view.result.current.content.visual_segments).toHaveLength(1);
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => {
      await view.result.current.load();
    });
    expect(env.assembly.readLatest).toHaveBeenCalledTimes(2);
    expect(view.result.current.dirty).toBe(false);
    act(() => {
      view.result.current.edit(draftContent());
    });
    act(() => {
      expect(guard?.()).toBe(true);
    });
    expect(view.result.current.dirty).toBe(false);
    expect(unloadPrevented()).toBe(false);
    view.unmount();
    expect(env.setNavigationGuard).toHaveBeenLastCalledWith(null);
  });
  it("blocks duplicate work and leaving during save/readback without prompting to discard the submitted edit", async () => {
    const env = setup();
    const view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    const guard = env.setNavigationGuard.mock.calls.at(-1)?.[0];
    act(() => {
      view.result.current.edit(draftContent());
    });
    let finishSave: () => void = () => {
      throw new Error("save was not started");
    };
    const originalSave = vi.mocked(env.assembly.saveExact).getMockImplementation();
    if (!originalSave) throw new Error("save fixture is missing");
    vi.mocked(env.assembly.saveExact).mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          finishSave = () => {
            void originalSave(...args).then(resolve);
          };
        }),
    );
    let finishRead: () => void = () => {
      throw new Error("readback was not started");
    };
    vi.mocked(env.assembly.readLatest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve({ kind: "FOUND", receipt: env.stored()! });
        }),
    );
    vi.mocked(window.confirm).mockReturnValue(false);
    let saving: Promise<void>;
    act(() => {
      const current = view.result.current;
      saving = current.save();
      void current.save();
      void current.load();
      expect(guard?.()).toBe(false);
    });
    expect(env.assembly.saveExact).toHaveBeenCalledTimes(1);
    expect(env.assembly.readLatest).toHaveBeenCalledTimes(1);
    expect(unloadPrevented()).toBe(true);
    await act(async () => {
      finishSave();
    });
    await waitFor(() => expect(env.assembly.readLatest).toHaveBeenCalledTimes(2));
    act(() => {
      expect(guard?.()).toBe(false);
    });
    expect(unloadPrevented()).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
    await act(async () => {
      finishRead();
      await saving;
    });
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.writeUnknown).toBe(false);
    expect(env.assembly.saveExact).toHaveBeenCalledTimes(1);
    expect(guard?.()).toBe(true);
    expect(unloadPrevented()).toBe(false);
  });
  it("preserves unresolved submitted edits on reload and protects pending writes even after a clean reopen", async () => {
    const env = setup();
    vi.mocked(env.assembly.saveExact).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    let view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    act(() => {
      view.result.current.edit(draftContent());
    });
    await act(async () => {
      await view.result.current.save();
    });
    const marker = localStorage.getItem(
      `aivora.assembly-exact.pending.v2.${projectId}.${episodeId}`,
    );
    await act(async () => {
      await view.result.current.load();
    });
    expect(view.result.current.content.visual_segments).toHaveLength(1);
    expect(view.result.current.writeUnknown).toBe(true);
    view.unmount();
    view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.busy).toBe(false));
    expect(view.result.current.dirty).toBe(true);
    const guard = env.setNavigationGuard.mock.calls.at(-1)?.[0];
    vi.mocked(window.confirm).mockReturnValue(false);
    act(() => {
      expect(guard?.()).toBe(false);
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("核对"));
    expect(unloadPrevented()).toBe(true);
    vi.mocked(window.confirm).mockReturnValue(true);
    act(() => {
      expect(guard?.()).toBe(true);
    });
    expect(localStorage.getItem(`aivora.assembly-exact.pending.v2.${projectId}.${episodeId}`)).toBe(
      marker,
    );
    expect(env.assembly.saveExact).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched preview bytes and explicitly preserves an unsupported source", async () => {
    const env = setup();
    vi.mocked(env.assets.readProjectMediaAssetPreview).mockResolvedValue({
      kind: "READY",
      mime_type: "video/mp4",
      sha256: "0".repeat(64),
      bytes: new Uint8Array(4),
    });
    render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await waitFor(() => expect(screen.getByLabelText("选择已导入素材版本")).toBeEnabled());
    await add("video");
    await waitFor(() =>
      expect(screen.getByText("原素材字节、大小或哈希身份不符；未播放。")).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("所选视频原件")).not.toBeInTheDocument();
    expect(env.assembly.saveExact).not.toHaveBeenCalled();
  });
});

it("saves literal subtitle IDs and exact frames, protects unapplied input, and reopens unchanged", async () => {
  const env = setup();
  const view = render(
    <EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />,
  );
  await screen.findByText("从项目素材库选择真实视频、图片或音频，开始本集剪辑草稿。");
  await add("image");
  fireEvent.click(screen.getByRole("button", { name: "添加文字字幕" }));
  fireEvent.change(screen.getByLabelText("字幕文字"), {
    target: { value: "你好 AIVORA\n100% 字幕" },
  });
  fireEvent.change(screen.getByLabelText("字幕入点（帧）"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("字幕出点（不含此帧）"), { target: { value: "20" } });
  expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeDisabled();
  expect(unloadPrevented()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
  fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
  await waitFor(() => expect(env.stored()?.data.content.subtitle_segments).toHaveLength(1));
  await screen.findByText("已从项目重新读回装配版本。");
  const first = env.stored()!.data.content.subtitle_segments[0]!;
  expect(first).toMatchObject({
    text: "你好 AIVORA\n100% 字幕",
    start_frame: 3,
    end_frame: 20,
    render_profile: "noto-cjk-sc-bottom-v1",
  });
  expect(unloadPrevented()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "编辑字幕" }));
  fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "修改字幕" } });
  expect(unloadPrevented()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "放弃字幕输入" }));
  expect(unloadPrevented()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "编辑字幕" }));
  fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "修改字幕" } });
  fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
  fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
  await waitFor(() => expect(env.stored()?.data.head_revision).toBe(2));
  await screen.findByText("已从项目重新读回装配版本。");
  expect(env.stored()!.data.content.subtitle_segments[0]!.segment_id).toBe(first.segment_id);
  view.unmount();
  render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
  await screen.findByText("修改字幕");
  fireEvent.click(screen.getByRole("button", { name: "删除字幕" }));
  expect(screen.queryByText("修改字幕")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(screen.getByText("修改字幕")).toBeInTheDocument();
});

it("rejects unsupported subtitle text and overlap without silently saving or clipping", async () => {
  const env = setup();
  render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
  await screen.findByText("从项目素材库选择真实视频、图片或音频，开始本集剪辑草稿。");
  await add("image");
  fireEvent.click(screen.getByRole("button", { name: "添加文字字幕" }));
  fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "不支持😀" } });
  fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
  expect(screen.getByRole("alert")).toHaveTextContent("暂不支持 emoji");
  expect(env.assembly.saveExact).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "第一条" } });
  fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
  fireEvent.click(screen.getByRole("button", { name: "添加文字字幕" }));
  fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "重叠条目" } });
  fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
  expect(screen.getByText("字幕范围不能重叠；请调整入点或出点。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "放弃字幕输入" }));
  expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeEnabled();
});

it.each(["lower-revision", "missing-head", "contradictory-identity"] as const)(
  "keeps the submitted input and blocks another CAS when the head read is %s",
  async (fault) => {
    const env = setup();
    const view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    act(() => {
      view.result.current.edit(draftContent());
    });
    await act(async () => {
      await view.result.current.save();
    });
    const first = structuredClone(env.stored()!);
    act(() => {
      view.result.current.edit({ ...view.result.current.content, canvas_width: 180 });
    });
    vi.mocked(env.assembly.readLatest).mockImplementationOnce(async () => {
      if (fault === "missing-head") return { kind: "NOT_FOUND", request_id: "controlled-missing" };
      if (fault === "lower-revision") return { kind: "FOUND", receipt: first };
      const contradictory = makeReceipt(
        { ...draftContent(), canvas_width: 200 },
        first.data.version_id,
        2,
      );
      contradictory.data.version_id = `ver_${"f".repeat(32)}`;
      return { kind: "FOUND", receipt: contradictory };
    });
    await act(async () => {
      await view.result.current.save();
    });
    expect(view.result.current.content.canvas_width).toBe(180);
    expect(view.result.current.reliable).toBe(false);
    expect(view.result.current.locked).toBe(true);
    expect(view.result.current.writeUnknown).toBe(false);
    expect(view.result.current.journalKind).toBe("EMPTY");
    await act(async () => {
      await view.result.current.save();
    });
    expect(env.assembly.saveExact).toHaveBeenCalledTimes(2);
    expect(env.assembly.getOriginal).not.toHaveBeenCalled();
    await act(async () => {
      await view.result.current.load();
    });
    expect(view.result.current.reliable).toBe(true);
    expect(view.result.current.version?.head_revision).toBe(2);
    expect(view.result.current.content.canvas_width).toBe(180);
  },
);

it("attributes a historical original before separately accepting the newer current head", async () => {
  const env = setup();
  vi.mocked(env.assembly.saveExact).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
  const view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
  await waitFor(() => expect(view.result.current.locked).toBe(false));
  act(() => {
    view.result.current.edit(draftContent());
  });
  await act(async () => {
    await view.result.current.save();
  });
  const command = vi.mocked(env.assembly.saveExact).mock.calls[0]![2];
  const historical = makeReceipt(command.payload.content, null, 1).data;
  historical.head_revision = 5;
  vi.mocked(env.assembly.getOriginal).mockResolvedValue({
    kind: "FOUND",
    receipt: {
      request_id: command.operation_id,
      data: {
        operation_id: command.operation_id,
        payload: command.payload,
        result_revision: 1,
        version: historical,
      },
    },
  });
  const current = makeReceipt({ ...draftContent(), canvas_width: 220 }, `ver_${"4".repeat(32)}`, 5);
  vi.mocked(env.assembly.readLatest).mockResolvedValue({ kind: "FOUND", receipt: current });
  await act(async () => {
    await view.result.current.recover();
  });
  expect(view.result.current.writeUnknown).toBe(false);
  expect(view.result.current.reliable).toBe(true);
  expect(view.result.current.version?.version_id).toBe(current.data.version_id);
  expect(view.result.current.content.canvas_width).toBe(220);
  expect(env.assembly.saveExact).toHaveBeenCalledTimes(1);
  expect(env.assembly.getOriginal).toHaveBeenCalledTimes(1);
});

it("resizes the mounted original without losing trim, subtitle or timecode drafts or issuing a write", async () => {
  const env = setup();
  render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
  await waitFor(() => expect(screen.getByLabelText("选择已导入素材版本")).toBeEnabled());
  await add("video");
  const video = (await screen.findByLabelText("所选视频原件")) as HTMLVideoElement;
  await waitFor(() => expect(video).toHaveAttribute("src", "blob:verified-local-original"));
  video.currentTime = 1.25;
  fireEvent.change(screen.getByLabelText("剪切位置（序列帧）"), { target: { value: "29" } });
  fireEvent.click(screen.getByRole("button", { name: "放大时间轴" }));
  const region = screen.getByRole("region", { name: "生产时间轴快捷键区域" });
  const code = screen.getByLabelText("定位时间码");
  fireEvent.change(code, { target: { value: "00:00:01:09" } });
  const duration = screen.getByLabelText("片段时长（帧）");
  fireEvent.change(duration, { target: { value: "37" } });
  const readCount = vi.mocked(env.assets.readProjectMediaAssetPreview).mock.calls.length;
  const storage = () =>
    Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]));
  for (const name of ["较大监看", "紧凑监看", "较大监看"]) {
    const beforeLayout = storage();
    fireEvent.click(screen.getByRole("button", { name }));
    expect(storage()).toEqual(beforeLayout);
    expect(screen.getByLabelText("所选视频原件")).toBe(video);
    expect(video.currentTime).toBe(1.25);
    expect(screen.getByLabelText("片段时长（帧）")).toBe(duration);
    expect(duration).toHaveValue(37);
    expect(code).toHaveValue("00:00:01:09");
    expect(screen.getByLabelText("剪切位置（序列帧）")).toHaveValue(29);
    expect(within(region).getByText("2×")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeDisabled();
    expect(unloadPrevented()).toBe(true);
  }
  fireEvent.click(screen.getByRole("button", { name: "应用裁剪" }));
  fireEvent.click(screen.getByRole("button", { name: "添加文字字幕" }));
  const subtitle = screen.getByLabelText("字幕文字");
  fireEvent.change(subtitle, { target: { value: "仍未应用的字幕\n原文保留" } });
  const beforeSubtitleLayout = storage();
  fireEvent.click(screen.getByRole("button", { name: "紧凑监看" }));
  expect(storage()).toEqual(beforeSubtitleLayout);
  expect(screen.getByLabelText("字幕文字")).toBe(subtitle);
  expect(subtitle).toHaveValue("仍未应用的字幕\n原文保留");
  expect(screen.getByLabelText("所选视频原件")).toBe(video);
  expect(env.assets.readProjectMediaAssetPreview).toHaveBeenCalledTimes(readCount);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(env.assembly.saveExact).not.toHaveBeenCalled();
  expect(env.assembly.getOriginal).not.toHaveBeenCalled();
  expect(unloadPrevented()).toBe(true);
});

it("keeps the full original UNKNOWN journal and one UUID across layout toggles and reopening", async () => {
  const env = setup();
  vi.mocked(env.assembly.saveExact).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
  const props = { projectId, episodeId, ...env };
  const view = render(<EpisodeMediaAssemblyPanel {...props} />);
  await waitFor(() => expect(screen.getByLabelText("选择已导入素材版本")).toBeEnabled());
  await add("image");
  fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
  await screen.findByText("先前写入结果未知；保存已锁定，请准确核对原保存。");
  const before = Object.fromEntries(
    Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
  );
  expect(JSON.stringify(before)).toContain(
    vi.mocked(env.assembly.saveExact).mock.calls[0]![2].operation_id,
  );
  fireEvent.click(screen.getByRole("button", { name: "较大监看" }));
  fireEvent.click(screen.getByRole("button", { name: "紧凑监看" }));
  fireEvent.click(screen.getByRole("button", { name: "较大监看" }));
  view.unmount();
  render(<EpisodeMediaAssemblyPanel {...props} />);
  await screen.findByText("先前写入结果未知；保存已锁定，请准确核对原保存。");
  expect(screen.getByRole("button", { name: "较大监看" })).toHaveAttribute("aria-pressed", "true");
  expect(
    Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])),
  ).toEqual(before);
  expect(env.assembly.saveExact).toHaveBeenCalledTimes(1);
  expect(env.assembly.getOriginal).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeDisabled();
});
