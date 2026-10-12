import { createHash, webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssemblyExactGateway } from "@aijian/contracts/assembly-exact";
import { impactCanonical } from "@aijian/contracts/script-confirmation-impact";
import { assemblyScriptSources } from "@aijian/contracts/assembly-script-provenance";
import { ASSEMBLY_SESSION_INTENTS } from "./adapters/assemblyExact";
import { ASSEMBLY_SESSION_HEADS } from "./useEpisodeAssembly";
import { ASSEMBLY_VIEW_POSITIONS } from "./EpisodeMediaAssemblyPanel";
import { UtilityPages } from "./UtilityPages";
import { MediaPages } from "./MediaPages";
import { audioReceipt } from "../test/audioAssetProbeFixture";
import { noProbe } from "../test/mediaAssetProbeFixture";
import type { AudioAssetProbeGateway } from "./adapters/audioAssetProbe";
import { createStudioTransport } from "../api/studio";
import {
  staticAnimaticContent,
  type AssemblyContent,
  type AssemblyReceipt,
  type EpisodeMediaAssemblyGateway,
} from "./adapters/episodeMediaAssembly";
import type { AssetVersion, MediaAsset } from "./adapters/assetLibrary";
import type { ScriptVersion } from "./adapters/episodeScript";

const model = vi.hoisted(() => ({
  page: "voice",
  isFixture: false,
  professional: false,
  backendProjectId: `prj_${"a".repeat(32)}`,
  selectedEpisodeId: `ep_${"b".repeat(32)}`,
  shots: [],
  total: 0,
  annotations: [],
  go: vi.fn(),
  setNavigationGuard: vi.fn(),
}));
vi.mock("./model", () => ({ useDemo: () => model, shotAtTime: vi.fn() }));
vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
const project = model.backendProjectId,
  episode = model.selectedEpisodeId;
const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(impactCanonical(value)).digest("hex")}`;
function assets(projectId = project): MediaAsset[] {
  return ["image", "audio"].map((kind, index) => {
    const digit = index ? "d" : "c";
    const version: AssetVersion = {
      id: `asv_${digit.repeat(32)}`,
      ordinal: 1,
      filename: kind === "audio" ? "本地录音.wav" : "本地画面.png",
      kind: kind as "image" | "audio",
      mime_type: kind === "audio" ? "audio/wav" : "image/png",
      byte_size: 4,
      sha256: digit.repeat(64),
      rights_status: "PENDING_REVIEW",
      source_kind: "LOCAL_IMPORT",
      technical_metadata: {},
      created_at: "2026-10-11",
      availability: "VERIFIED",
    };
    return {
      id: `asset_${digit.repeat(32)}`,
      project_id: projectId,
      latest_version: version,
      versions: [version],
      episode_references: [],
      created_at: "2026-10-11",
    };
  });
}
function source(projectId = project, episodeId = episode): ScriptVersion {
  const content: ScriptVersion["content"] = {
    schema_version: "1.0.0",
    project_id: projectId,
    episode_id: episodeId,
    scenes: [
      {
        scene_id: `scn_${"e".repeat(32)}`,
        ordinal: 1,
        heading: "码头",
        blocks: [
          {
            block_id: `sblk_${"f".repeat(32)}`,
            ordinal: 1,
            kind: "DIALOGUE",
            speaker: "林舟",
            text: "等雨停了再走。",
            delivery: "OFF_SCREEN",
          },
        ],
      },
    ],
  };
  return {
    project_id: projectId,
    episode_id: episodeId,
    version_id: `ver_${"1".repeat(32)}`,
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content,
    content_hash: hash(content),
    author_actor_id: "human",
    change_summary: "saved dialogue",
    created_at: "2026-10-11T00:00:00Z",
  };
}
function receipt(content: AssemblyContent, revision = 1): AssemblyReceipt {
  return {
    request_id: "11111111-1111-4111-8111-111111111111",
    data: {
      artifact_id: `art_${"2".repeat(32)}`,
      version_id: `ver_${String(revision).repeat(32)}`,
      content_hash: hash(content),
      head_revision: revision,
      parent_version_id: revision > 1 ? `ver_${String(revision - 1).repeat(32)}` : null,
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
      media_checks: assets(content.project_id).map((item) => ({
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
  const records = new Map<string, AssemblyReceipt>();
  const initial = (p: string, e: string) => {
    const media = assets(p)[0]!;
    return receipt(
      staticAnimaticContent(p, e, [
        {
          media: {
            asset_id: media.id,
            asset_version_id: media.latest_version.id,
            sha256: media.latest_version.sha256,
          },
          frames: 100,
        },
      ]),
    );
  };
  const read = vi.fn<EpisodeMediaAssemblyGateway["readLatest"]>(async (p: string, e: string) => ({
    kind: "FOUND" as const,
    receipt: records.get(`${p}/${e}`) ?? initial(p, e),
  }));
  const operations = new Map<string, Awaited<ReturnType<AssemblyExactGateway["saveExact"]>>>();
  const create = vi.fn<AssemblyExactGateway["saveExact"]>(async (p, e, command) => {
    const saved = receipt(command.payload.content, (command.payload.expected_revision ?? 0) + 1);
    records.set(`${p}/${e}`, saved);
    const result = {
      kind: "FOUND" as const,
      receipt: {
        request_id: saved.request_id,
        data: {
          operation_id: command.operation_id,
          payload: command.payload,
          result_revision: saved.data.head_revision,
          version: saved.data,
        },
      },
    };
    operations.set(command.operation_id, result);
    return result;
  });
  const original = vi.fn<AssemblyExactGateway["getOriginal"]>(async (_p, _e, command) => {
    const operation = operations.get(command.operation_id);
    return operation?.kind === "FOUND" ? operation : { kind: "REMOTE_UNKNOWN" };
  });
  const getScript = vi.fn(async (p: string, e: string) => ({
    kind: "FOUND" as const,
    receipt: { request_id: "script", data: source(p, e) },
  }));
  const transport = {
    episodeMediaAssembly: {
      readLatest: read,
      createVersion: vi.fn(),
      saveExact: create,
      getOriginal: original,
    },
    assetLibrary: {
      listProjectMediaAssets: vi.fn(async (p: string) => ({
        kind: "LISTED",
        receipt: { data: assets(p), request_id: "assets" },
      })),
      readProjectMediaAssetPreview: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" })),
    },
    getEpisodeScript: getScript,
    getEpisodeScriptVersion: getScript,
  };
  vi.mocked(createStudioTransport).mockReturnValue(
    transport as unknown as ReturnType<typeof createStudioTransport>,
  );
  return { read, create, original, getScript, records, transport };
}
beforeEach(() => {
  ASSEMBLY_SESSION_INTENTS.clear();
  ASSEMBLY_SESSION_HEADS.clear();
  ASSEMBLY_VIEW_POSITIONS.clear();
  localStorage.clear();
  model.page = "voice";
  model.backendProjectId = project;
  model.selectedEpisodeId = episode;
  model.professional = false;
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function addAudio() {
  const select = await screen.findByLabelText("选择已导入素材版本");
  await waitFor(() => expect(select).not.toBeDisabled());
  const item = assets()[1]!;
  fireEvent.change(select, { target: { value: `${item.id}/${item.latest_version.id}` } });
  fireEvent.click(screen.getByRole("button", { name: "加入音频片段" }));
}
it("saves a real audio reference bound to exact dialogue and reopens the same object from assembly in both modes", async () => {
  const api = setup();
  const view = render(<UtilityPages />);
  await addAudio();
  expect(screen.queryByRole("list", { name: "画面片段" })).not.toBeInTheDocument();
  expect(
    within(screen.getByLabelText("选择已导入素材版本")).queryByText(/本地画面/),
  ).not.toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText("本集已保存剧本对白"), {
    target: { value: `sblk_${"f".repeat(32)}` },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "绑定所选音频为对白轨" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "绑定所选音频为对白轨" }));
  fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce());
  await screen.findByText("已从项目重新读回装配版本。");
  const saved = api.records.get(`${project}/${episode}`)!;
  expect(saved.data.content.audio_segments[0]).toMatchObject({
    track_kind: "DIALOGUE",
    script_version_id: source().version_id,
    script_block_id: `sblk_${"f".repeat(32)}`,
    delivery: "OFF_SCREEN",
  });
  expect(saved.data.content.visual_segments).toHaveLength(1);
  view.unmount();
  model.page = "assembly";
  const assembly = render(<MediaPages />);
  await screen.findByText("已从项目重新读回装配版本。");
  expect(screen.getByRole("button", { name: /DIALOGUE · 本地录音/ })).toBeInTheDocument();
  assembly.unmount();
  model.page = "voice";
  model.professional = true;
  render(<UtilityPages />);
  await screen.findByText("已从项目重新读回装配版本。");
  expect(screen.getByRole("button", { name: /DIALOGUE · 本地录音/ })).toBeInTheDocument();
  expect(api.create).toHaveBeenCalledOnce();
});
it("protects unapplied trim inputs until apply or explicit discard without writing", async () => {
  const api = setup();
  render(<UtilityPages />);
  await addAudio();
  fireEvent.change(screen.getByLabelText("片段时长（帧）"), { target: { value: "20" } });
  expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "绑定所选音频为对白轨" })).toBeDisabled();
  const event = new Event("beforeunload", { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  const guard = model.setNavigationGuard.mock.calls.at(-1)![0] as () => boolean;
  expect(guard()).toBe(false);
  expect(screen.getByLabelText("片段时长（帧）")).toHaveValue(20);
  fireEvent.click(screen.getByRole("button", { name: "放弃未应用裁剪" }));
  expect(screen.getByLabelText("片段时长（帧）")).toHaveValue(50);
  expect(api.create).not.toHaveBeenCalled();
});
it("isolates two projects and two episodes and discards the stale A reply after A to B to A", async () => {
  const api = setup();
  let resolve!: (value: Awaited<ReturnType<typeof api.read>>) => void;
  api.read.mockImplementationOnce(
    () =>
      new Promise((reply) => {
        resolve = reply;
      }),
  );
  const view = render(<UtilityPages />);
  model.backendProjectId = `prj_${"0".repeat(32)}`;
  model.selectedEpisodeId = `ep_${"9".repeat(32)}`;
  view.rerender(<UtilityPages />);
  await screen.findByText("已从项目重新读回装配版本。");
  model.backendProjectId = project;
  model.selectedEpisodeId = episode;
  view.rerender(<UtilityPages />);
  await screen.findByText("已从项目重新读回装配版本。");
  await act(async () => {
    resolve({ kind: "FOUND", receipt: receipt(staticAnimaticContent(project, episode, [])) });
  });
  expect(screen.getByText(/1 个画面 · 0 个声音/)).toBeInTheDocument();
  expect(api.read).toHaveBeenCalledWith(`prj_${"0".repeat(32)}`, `ep_${"9".repeat(32)}`);
  expect(api.create).not.toHaveBeenCalled();
});
it("does not resend an unknown audio save on reopen and uses read-only reconciliation", async () => {
  const api = setup();
  api.create.mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
  const view = render(<UtilityPages />);
  await addAudio();
  fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
  await screen.findByText(/原保存结果UNKNOWN/);
  view.unmount();
  render(<UtilityPages />);
  await screen.findByText(/先前写入尚未核实/);
  fireEvent.click(screen.getByRole("button", { name: "重新读取装配与素材" }));
  await waitFor(() => expect(api.read.mock.calls.length).toBeGreaterThan(2));
  expect(api.original).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "只读准确核对原装配保存" }));
  await waitFor(() => expect(api.original).toHaveBeenCalledOnce());
  expect(api.create).toHaveBeenCalledOnce();
  expect(api.transport.episodeMediaAssembly.createVersion).not.toHaveBeenCalled();
});

it("uses the selected audio version's durable source rate for splitting without a new encode or assembly write", async () => {
  const api = setup();
  const sourceAudio = assets()[1]!;
  const sourceReceipt = audioReceipt(sourceAudio);
  const probe = {
    getAudioAssetProbeEvidence: vi
      .fn<AudioAssetProbeGateway["getAudioAssetProbeEvidence"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: sourceReceipt }),
    probeSelectedAudioAssetVersion: vi
      .fn<AudioAssetProbeGateway["probeSelectedAudioAssetVersion"]>()
      .mockResolvedValue({ kind: "PROBE_UNKNOWN" }),
  };
  Object.assign(api.transport, { audioAssetProbe: probe });
  render(<UtilityPages />);
  await addAudio();
  await screen.findByText(/源采样率 32000 Hz/);
  expect(probe.getAudioAssetProbeEvidence).toHaveBeenCalledExactlyOnceWith(
    project,
    sourceAudio.id,
    sourceAudio.latest_version.id,
  );
  expect(probe.probeSelectedAudioAssetVersion).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("片段时长（帧）"), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "应用裁剪" }));
  // A sequence frame at 25fps maps to 1280 samples in this original, regardless of decoder rate.
  fireEvent.change(screen.getByLabelText("剪切位置（序列帧）"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "在此帧分割" }));
  fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce());
  const saved = api.records.get(`${project}/${episode}`)!;
  expect(saved.data.content.audio_segments).toHaveLength(2);
  expect(saved.data.content.audio_segments[1]!.source_in_sample).toBe(1280);
});

it("does not probe automatically or use newer-version audio evidence for the selected original", async () => {
  const api = setup();
  const sourceAudio = assets()[1]!;
  const wrong = audioReceipt(sourceAudio);
  wrong.data.version_id = `asv_${"9".repeat(32)}`;
  const probe = {
    getAudioAssetProbeEvidence: vi
      .fn<AudioAssetProbeGateway["getAudioAssetProbeEvidence"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: wrong }),
    probeSelectedAudioAssetVersion: vi
      .fn<AudioAssetProbeGateway["probeSelectedAudioAssetVersion"]>()
      .mockResolvedValue(noProbe),
  };
  Object.assign(api.transport, { audioAssetProbe: probe });
  render(<UtilityPages />);
  await addAudio();
  await screen.findByText(/版本、哈希或结构不匹配/);
  expect(screen.queryByText(/源采样率 32000 Hz/)).not.toBeInTheDocument();
  expect(probe.probeSelectedAudioAssetVersion).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
});
