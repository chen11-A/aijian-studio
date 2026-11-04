import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../../packages/contracts/fixtures/storyboard-environment.json";
import { createStudioTransport } from "../api/studio";
import { EpisodeStoryboardPanel } from "./EpisodeStoryboardPanel";
import { StoryboardWorkspaceView } from "./StoryboardWorkspaceView";
import { StoryboardEnvironmentBindings } from "./StoryboardEnvironmentBindings";
import { referenceImpact } from "./storyboardReferenceImpact";
import { storyboardPreviewContentHash } from "./adapters/storyboardAssemblyPreview";
import {
  cloneStoryboardContent,
  validStoryboardContent,
  withStoryboardEnvironment,
  withStoryboardPlanning,
  withStoryboardShots,
  withStoryboardVisualBasis,
  type StoryboardContent,
  type StoryboardGateway,
  type StoryboardVersion,
} from "./adapters/episodeStoryboard";
import type { CreativeVersion } from "./adapters/creativeLibrary";
import type { AssetLibraryGateway, MediaAsset } from "./adapters/assetLibrary";
import { asset as seedAsset } from "./CharacterReferenceAssets.testFixtures";
import type * as Common from "./Common";
import type { WorkspaceParts } from "./CreativeWorkspaceFrame";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
vi.mock("./Common", async (load) => ({
  ...(await load<typeof Common>()),
  PageTitle: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header>,
}));
vi.mock("./CreativeWorkspaceFrame", () => ({
  CreativeWorkspaceFrame: (p: WorkspaceParts) => (
    <>
      <aside>
        {p.outline}
        {p.outlineAction}
      </aside>
      <header>{p.tools}</header>
      <main>{p.children}</main>
      <aside>{p.properties}</aside>
      <footer>
        {p.notice}
        {p.status}
        {p.actions}
      </footer>
    </>
  ),
}));

const project = fixture.request.content.project_id,
  episode = fixture.request.content.episode_id;
const requestId = fixture.response.request_id;
const library = fixture.library_response.data as CreativeVersion;
const variant = `scv_${"1".repeat(32)}`,
  worldRef = `erf_${"1".repeat(32)}`,
  stateRef = `erf_${"3".repeat(32)}`;
const guard = vi.fn();
let heads: Map<string, StoryboardVersion>,
  versions: Map<string, StoryboardVersion>,
  operations: Map<string, StoryboardVersion>;
let api: StoryboardGateway, asset: MediaAsset;
let list: ReturnType<typeof vi.fn<AssetLibraryGateway["listProjectMediaAssets"]>>;
let preview: ReturnType<typeof vi.fn<AssetLibraryGateway["readProjectMediaAssetPreview"]>>;
const original = () => structuredClone(fixture.response.data) as StoryboardVersion;
const body = () => structuredClone(fixture.request.content) as StoryboardContent;
const key = (p: string, e: string) => `${p}/${e}`;
function mount(kind: "old" | "workspace", id = episode) {
  const Component = kind === "old" ? EpisodeStoryboardPanel : StoryboardWorkspaceView;
  return render(
    <Component key={id} projectId={project} episodeId={id} setNavigationGuard={guard} />,
  );
}
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  guard.mockClear();
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const initial = original();
  // Begin at a real old planning shape; promotion happens only on a user choice.
  const env = body();
  if (env.schema_version !== "1.4.0") throw new Error("Fixture");
  initial.content = {
    ...env,
    schema_version: "1.3.0",
    shots: env.shots.map((shot) => {
      const { environment_binding: _binding, ...rest } = shot;
      expect(_binding.reference_ids).toHaveLength(3);
      return rest;
    }),
  };
  initial.content_hash = await storyboardPreviewContentHash(initial.content);
  heads = new Map([[key(project, episode), initial]]);
  versions = new Map([[initial.version_id, initial]]);
  operations = new Map();
  let serial = 0;
  api = {
    getEpisodeStoryboard: vi.fn<StoryboardGateway["getEpisodeStoryboard"]>(async (p, e) => {
      const v = heads.get(key(p, e));
      return v ? { kind: "FOUND", receipt: { data: v, request_id: requestId } } : { kind: "EMPTY" };
    }),
    getEpisodeStoryboardVersion: vi.fn<StoryboardGateway["getEpisodeStoryboardVersion"]>(
      async (p, e, id) => {
        const v = versions.get(id);
        return v?.project_id === p && v.episode_id === e
          ? { kind: "FOUND", receipt: { data: v, request_id: requestId } }
          : { kind: "REMOTE_UNKNOWN" };
      },
    ),
    createEpisodeStoryboardVersion: vi.fn<StoryboardGateway["createEpisodeStoryboardVersion"]>(
      async (p, e, op, payload) => {
        const existing = operations.get(op);
        if (existing)
          return {
            kind: "CREATED",
            receipt: { data: { version: existing, replayed: true }, request_id: requestId },
          };
        const prior = heads.get(key(p, e)),
          revision = (prior?.head_revision ?? 0) + 1;
        const v: StoryboardVersion = {
          ...original(),
          project_id: p,
          episode_id: e,
          version_id: `ver_${(++serial).toString(16).padStart(32, "0")}`,
          parent_version_id: payload.parent_version_id,
          version_number: revision,
          head_revision: revision,
          content: cloneStoryboardContent(payload.content),
          content_hash: await storyboardPreviewContentHash(payload.content),
          change_summary: payload.change_summary,
        };
        heads.set(key(p, e), v);
        versions.set(v.version_id, v);
        operations.set(op, v);
        return {
          kind: "CREATED",
          receipt: { data: { version: v, replayed: false }, request_id: requestId },
        };
      },
    ),
  };
  asset = structuredClone(seedAsset);
  const ref = fixture.library_request.content.environment_references[0]!;
  asset.id = ref.asset_id;
  asset.latest_version.id = ref.asset_version_id;
  asset.latest_version.sha256 = ref.asset_sha256;
  asset.versions = [asset.latest_version];
  list = vi
    .fn<AssetLibraryGateway["listProjectMediaAssets"]>()
    .mockResolvedValue({ kind: "LISTED", receipt: { data: [asset], request_id: requestId } });
  preview = vi
    .fn<AssetLibraryGateway["readProjectMediaAssetPreview"]>()
    .mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
  vi.mocked(createStudioTransport).mockReturnValue({
    ...api,
    getEpisodeScript: vi.fn().mockResolvedValue({ kind: "EMPTY" }),
    getProjectCreativeLibraryVersion: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: fixture.library_response }),
    assetLibrary: { listProjectMediaAssets: list, readProjectMediaAssetPreview: preview },
  } as unknown as ReturnType<typeof createStudioTransport>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["old", "workspace"] as const)(
  "%s real editor saves exact environment picks and the other entry restores the same object",
  async (kind) => {
    const view = mount(kind);
    await waitFor(() => expect(screen.getByLabelText("本镜地点状态")).toBeEnabled());
    fill("本镜地点状态", variant);
    await waitFor(() => expect(screen.getByLabelText("环境参考：雨后状态")).toBeEnabled());
    fireEvent.click(screen.getByLabelText("环境参考：雨后状态"));
    fireEvent.click(screen.getByLabelText("环境参考：世界材质"));
    fill("镜头标题", "未保存环境镜头");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    expect(guard.mock.calls.at(-1)![0]()).toBe(false);
    expect(preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
    await screen.findByText(/已保存，并已回读核对/);
    const saved = heads.get(key(project, episode))!;
    expect(saved.content.schema_version).toBe("1.4.0");
    if (saved.content.schema_version !== "1.4.0") throw new Error("Missing environment");
    expect(saved.content.shots[0]!.environment_binding).toEqual({
      variant_id: variant,
      reference_ids: [stateRef, worldRef],
    });
    expect(saved.content.shots[1]!.environment_binding).toEqual({
      variant_id: null,
      reference_ids: [],
    });
    expect(saved.content.shots[0]!.continuity_notes).toBe(
      fixture.request.content.shots[0]!.continuity_notes,
    );
    expect(versions.get(fixture.response.data.version_id)!.content.schema_version).toBe("1.3.0");
    view.unmount();
    mount(kind === "old" ? "workspace" : "old");
    await screen.findByDisplayValue("未保存环境镜头");
    await waitFor(() => expect(screen.getByLabelText("本镜地点状态")).toHaveValue(variant));
    await waitFor(() => expect(screen.getByLabelText("环境参考：雨后状态")).toBeChecked());
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fill("本镜地点状态", "");
    expect(screen.getByLabelText("环境参考：雨后状态")).toBeChecked();
    fill("本镜地点状态", "");
    expect(screen.queryByLabelText("环境参考：雨后状态")).toBeNull();
    expect(screen.getByLabelText("环境参考：世界材质")).toBeChecked();
    expect(heads.get(key(project, episode))).toBe(saved);
    expect(api.createEpisodeStoryboardVersion).toHaveBeenCalledTimes(1);
  },
);

it.each(["old", "workspace"] as const)(
  "%s UNKNOWN save survives reopening with the original exact body and no automatic resend",
  async (kind) => {
    const view = mount(kind);
    await waitFor(() => expect(screen.getByLabelText("本镜地点状态")).toBeEnabled());
    fill("本镜地点状态", variant);
    await waitFor(() => expect(screen.getByLabelText("环境参考：雨后状态")).toBeEnabled());
    fireEvent.click(screen.getByLabelText("环境参考：雨后状态"));
    vi.mocked(api.createEpisodeStoryboardVersion).mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
    fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
    await screen.findAllByText(/保存结果待核对/);
    expect(screen.getByLabelText("本镜地点状态")).toBeDisabled();
    const pending = localStorage.getItem(
      `aivora.episode-storyboard.pending.v1.${project}.${episode}`,
    );
    expect(JSON.parse(pending!).payload.content.shots[0].environment_binding.reference_ids).toEqual(
      [stateRef],
    );
    view.unmount();
    mount(kind === "old" ? "workspace" : "old");
    await screen.findByText(/已恢复原提交内容/);
    expect(api.createEpisodeStoryboardVersion).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`aivora.episode-storyboard.pending.v1.${project}.${episode}`)).toBe(
      pending,
    );
    expect(screen.getByLabelText("本镜地点状态")).toBeDisabled();
  },
);

it("preserves a selected missing original and never substitutes the asset head or previews it", async () => {
  const content = body();
  heads.set(key(project, episode), original());
  asset.versions[0]!.availability = "MISSING";
  asset.latest_version = {
    ...asset.latest_version,
    id: `asv_${"f".repeat(32)}`,
    ordinal: 2,
    sha256: "f".repeat(64),
  };
  asset.versions.push(asset.latest_version);
  const edit = vi.fn();
  render(
    <StoryboardEnvironmentBindings
      content={content}
      shot={content.shots[0]!}
      library={library}
      locked={false}
      edit={edit}
    />,
  );
  await screen.findAllByText(/精确原件尚未可靠核对或已失效/);
  expect(screen.getByLabelText("环境参考：雨后状态")).toBeChecked();
  expect(screen.queryByRole("button", { name: "读取此参考预览" })).toBeNull();
  expect(preview).not.toHaveBeenCalled();
  expect(edit).not.toHaveBeenCalled();
});

it("keeps a contradictory saved receipt UNKNOWN, then explicitly verifies the original operation", async () => {
  mount("old");
  await waitFor(() => expect(screen.getByLabelText("本镜地点状态")).toBeEnabled());
  fill("本镜地点状态", variant);
  const create = vi.mocked(api.createEpisodeStoryboardVersion),
    real = create.getMockImplementation()!;
  create.mockImplementationOnce(async (...args) => {
    const result = await real(...args);
    if (result.kind !== "CREATED") throw new Error("Fixture");
    const receipt = structuredClone(result.receipt);
    if (receipt.data.version.content.schema_version !== "1.4.0") throw new Error("Fixture");
    receipt.data.version.content.shots[0]!.environment_binding.variant_id = null;
    return { kind: "CREATED", receipt };
  });
  fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
  await screen.findAllByText(/保存结果待核对/);
  expect(screen.getByLabelText("本镜地点状态")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
  expect(create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "核对原提交" }));
  await screen.findByText(/已保存，并已回读核对/);
  expect(create).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[1]!.slice(2)).toEqual(create.mock.calls[0]!.slice(2));
  expect(versions.size).toBe(2);
  expect(
    localStorage.getItem(`aivora.episode-storyboard.pending.v1.${project}.${episode}`),
  ).toBeNull();
});

it("restores separate episode environment choices through A to B to A", async () => {
  const first = original(),
    other = original();
  other.episode_id = `ep_${"c".repeat(32)}`;
  other.content.episode_id = other.episode_id;
  other.version_id = `ver_${"c".repeat(32)}`;
  if (other.content.schema_version !== "1.4.0") throw new Error("Fixture");
  other.content.shots[0]!.environment_binding = { variant_id: null, reference_ids: [worldRef] };
  other.content_hash = await storyboardPreviewContentHash(other.content);
  heads.set(key(project, episode), first);
  heads.set(key(project, other.episode_id), other);
  versions.set(first.version_id, first);
  versions.set(other.version_id, other);
  const view = mount("old");
  await waitFor(() => expect(screen.getByLabelText("本镜地点状态")).toHaveValue(variant));
  view.rerender(
    <EpisodeStoryboardPanel
      key={other.episode_id}
      projectId={project}
      episodeId={other.episode_id}
      setNavigationGuard={guard}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText("环境参考：世界材质")).toBeChecked());
  expect(screen.getByLabelText("本镜地点状态")).toHaveValue("");
  view.rerender(
    <EpisodeStoryboardPanel
      key={episode}
      projectId={project}
      episodeId={episode}
      setNavigationGuard={guard}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText("本镜地点状态")).toHaveValue(variant));
  // The saved binding is visible before its exact library finishes loading.
  // Verify the asynchronously materialized reference, not the placeholder state.
  await waitFor(() => expect(screen.getByLabelText("环境参考：雨后状态")).toBeChecked());
  expect(api.createEpisodeStoryboardVersion).not.toHaveBeenCalled();
});

it("rejects stale callbacks after episode, basis, location or concurrent binding changes", async () => {
  const content = body(),
    edit = vi.fn();
  render(
    <StoryboardEnvironmentBindings
      content={content}
      shot={content.shots[0]!}
      library={library}
      locked={false}
      edit={edit}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText("环境参考：雨后状态")).toBeEnabled());
  fireEvent.click(screen.getByLabelText("环境参考：雨后状态"));
  const callback = edit.mock.calls[0]![0] as (v: StoryboardContent) => StoryboardContent;
  for (const change of [
    { episode_id: `ep_${"f".repeat(32)}` },
    { creative_library_version_id: `ver_${"f".repeat(32)}` },
  ]) {
    const newer = { ...content, ...change };
    expect(callback(newer)).toBe(newer);
  }
  const newer = withStoryboardEnvironment(content, content.shots[0]!.shot_id, {
    variant_id: variant,
    reference_ids: [worldRef],
  });
  expect(callback(newer)).toBe(newer);
  const wrongLocation = cloneStoryboardContent(content);
  wrongLocation.shots[0]!.location_id = null;
  expect(callback(wrongLocation)).toBe(wrongLocation);
});

it("keeps unknown asset state after A to B to A and ignores the first A's late receipt", async () => {
  let resolve!: (v: Awaited<ReturnType<AssetLibraryGateway["listProjectMediaAssets"]>>) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const content = body();
  if (content.schema_version !== "1.4.0") throw new Error("Fixture");
  content.shots.forEach((shot) => {
    shot.environment_binding = { variant_id: null, reference_ids: [] };
  });
  const edit = vi.fn(),
    props = { shot: content.shots[0]!, library, locked: false, edit };
  const view = render(<StoryboardEnvironmentBindings {...props} content={content} />);
  await waitFor(() => expect(list).toHaveBeenCalledWith(project));
  view.rerender(
    <StoryboardEnvironmentBindings
      {...props}
      content={{ ...content, project_id: `prj_${"f".repeat(32)}` }}
    />,
  );
  await waitFor(() => expect(list).toHaveBeenCalledWith(`prj_${"f".repeat(32)}`));
  list.mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
  view.rerender(<StoryboardEnvironmentBindings {...props} content={content} />);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  await act(async () =>
    resolve({ kind: "LISTED", receipt: { data: [asset], request_id: requestId } }),
  );
  expect(screen.getByLabelText("环境参考：世界材质")).toBeDisabled();
  expect(edit).not.toHaveBeenCalled();
});

it("preserves characters, planning and blank environment fields through clones, new shots and G5 binding", () => {
  const content = body();
  if (content.schema_version !== "1.4.0") throw new Error("Fixture");
  const clone = cloneStoryboardContent(content);
  if (clone.schema_version !== "1.4.0") throw new Error("Clone");
  clone.shots[0]!.environment_binding.reference_ids.pop();
  expect(content.shots[0]!.environment_binding.reference_ids).toHaveLength(3);
  expect(
    withStoryboardPlanning(content, content.shots[0]!.shot_id, { coverage_notes: "新覆盖" })
      .schema_version,
  ).toBe("1.4.0");
  const next = { ...content.shots[0]!, shot_id: `shp_${"f".repeat(32)}`, ordinal: 3 };
  const { environment_binding: _binding, ...bare } = next;
  expect(_binding).toEqual(content.shots[0]!.environment_binding);
  const added = withStoryboardShots(content, [...content.shots, bare]);
  if (added.schema_version !== "1.4.0") throw new Error("Added");
  expect(added.shots[2]!.environment_binding).toEqual({ variant_id: null, reference_ids: [] });
  const pin = { version_id: `ver_${"f".repeat(32)}`, content_hash: `sha256:${"f".repeat(64)}` };
  expect(withStoryboardVisualBasis(content, library.version_id, pin)).toBe(content);
  content.shots.forEach((shot) => {
    shot.environment_binding = { variant_id: null, reference_ids: [] };
  });
  const bound = withStoryboardVisualBasis(content, library.version_id, pin);
  expect(bound.schema_version).toBe("1.4.0");
  expect(validStoryboardContent(bound, project, episode)).toBe(true);
  expect(
    withStoryboardEnvironment(bound, content.shots[0]!.shot_id, {
      variant_id: variant,
      reference_ids: [],
    }),
  ).toBe(bound);
});

it("marks only exact environment consumers on upgrade and blocks missing or moved state/reference ownership", () => {
  const content = body();
  if (content.schema_version !== "1.4.0") throw new Error("Fixture");
  content.shots[1]!.environment_binding = { variant_id: null, reference_ids: [] };
  const target = structuredClone(library);
  if (target.content.schema_version !== "1.3.0") throw new Error("Fixture");
  target.content.environment_references[2]!.asset_sha256 = "f".repeat(64);
  expect(referenceImpact("library", content, library, target).changed).toEqual([
    `镜头 1「${content.shots[0]!.title}」`,
  ]);
  target.content.scene_variants[0]!.scene_id = `loc_${"f".repeat(32)}`;
  expect(referenceImpact("library", content, library, target).missing).toContainEqual(
    expect.stringContaining("环境状态归属不一致"),
  );
  target.content.environment_references = [];
  expect(referenceImpact("library", content, library, target).missing).toContainEqual(
    expect.stringContaining("环境参考"),
  );
});
