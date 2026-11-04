import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { ManualCreativeEditor } from "./ManualCreativeEditor";
import { CharacterReferenceAssets } from "./CharacterReferenceAssets";
import { createStudioTransport } from "../api/studio";
import { makeGateway, project, other, requestId } from "./ManualCreativeEditor.testFixtures";
import { asset as originalAsset } from "./CharacterReferenceAssets.testFixtures";
import {
  emptyCreativeContent,
  cloneCreativeContent,
  validCreativeContent,
} from "./adapters/creativeLibrary";
import type { CreativeContent } from "./adapters/creativeLibrary";
import type { AssetLibraryGateway, MediaAsset } from "./adapters/assetLibrary";
import { withCreativeEnvironment } from "./adapters/creativeEnvironment";
import {
  removeCreativeCharacter,
  removeCreativeCostume,
  normalizeCreativeContent,
} from "./adapters/creativeCharacterDetails";
import type * as Common from "./Common";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
vi.mock("./Common", async (load) => ({
  ...(await load<typeof Common>()),
  PageTitle: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header>,
}));
let service: ReturnType<typeof makeGateway>;
let asset: MediaAsset;
let list: ReturnType<typeof vi.fn<AssetLibraryGateway["listProjectMediaAssets"]>>;
let preview: ReturnType<typeof vi.fn<AssetLibraryGateway["readProjectMediaAssetPreview"]>>;
const guard = vi.fn();
const sceneId = `loc_${"1".repeat(32)}`;
function seedContent() {
  const content = emptyCreativeContent(project);
  content.characters = [
    {
      character_id: `chr_${"b".repeat(32)}`,
      ordinal: 1,
      name: "林舟",
      role: "主角",
      description: "",
      appearance: "",
      personality: "",
    },
  ];
  content.scenes = [
    {
      scene_id: sceneId,
      ordinal: 1,
      name: "码头",
      description: "",
      location: "海港",
      time_of_day: "夜晚",
      weather: "雨",
      continuity: "保留窗边灯光",
    },
  ];
  return content;
}
async function seed(content = seedContent()) {
  await service.api.createProjectCreativeLibraryVersion(project, requestId, {
    content,
    parent_version_id: null,
    expected_revision: null,
    change_summary: "seed",
  });
}
function mount(
  kind: "world" | "scenes" = "scenes",
  id = project,
  episodeId = `ep_${"1".repeat(32)}`,
) {
  return render(
    <ManualCreativeEditor
      key={`${id}:${kind}`}
      kind={kind}
      projectId={id}
      episodeId={episodeId}
      setNavigationGuard={guard}
    />,
  );
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
async function chooseReference() {
  await waitFor(() => expect(screen.getByLabelText("环境参考素材")).toBeEnabled());
  fill("环境参考素材", asset.id);
  fill("环境参考版本", asset.versions[0]!.id);
  fireEvent.click(screen.getByRole("button", { name: "关联环境参考" }));
  fill("环境参考说明", "精确旧版参考");
}
async function save() {
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText(/已保存，并已回读核对/);
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  guard.mockClear();
  service = makeGateway();
  asset = structuredClone(originalAsset);
  asset.latest_version = {
    ...asset.latest_version,
    id: `asv_${"f".repeat(32)}`,
    ordinal: 2,
    sha256: "f".repeat(64),
    filename: "新版.png",
  };
  asset.versions.push(asset.latest_version);
  list = vi
    .fn<AssetLibraryGateway["listProjectMediaAssets"]>()
    .mockResolvedValue({ kind: "LISTED", receipt: { data: [asset], request_id: requestId } });
  preview = vi
    .fn<AssetLibraryGateway["readProjectMediaAssetPreview"]>()
    .mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
  vi.mocked(createStudioTransport).mockReturnValue({
    ...service.api,
    assetLibrary: { listProjectMediaAssets: list, readProjectMediaAssetPreview: preview },
  } as unknown as ReturnType<typeof createStudioTransport>);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("saves state and explicitly selected old original into the same immutable library, shared by two episodes", async () => {
  await seed();
  const view = mount();
  await screen.findByDisplayValue("码头");
  fireEvent.click(screen.getByRole("button", { name: "新增场景状态" }));
  fill("状态名称", "雨后凌晨");
  fill("状态视角", "朝西");
  fill("环境状态", "湿地面");
  await chooseReference();
  expect(preview).not.toHaveBeenCalled();
  await save();
  const saved = service.heads.get(project)!;
  expect(saved.content.schema_version).toBe("1.3.0");
  if (saved.content.schema_version !== "1.3.0") throw new Error("Missing environment");
  const variant = saved.content.scene_variants[0]!;
  expect(variant).toMatchObject({
    scene_id: sceneId,
    name: "雨后凌晨",
    view: "朝西",
    time_of_day: "夜晚",
    weather: "雨",
    continuity: "保留窗边灯光",
  });
  expect(saved.content.environment_references[0]).toMatchObject({
    scene_id: sceneId,
    variant_id: variant.variant_id,
    asset_version_id: asset.versions[0]!.id,
    asset_sha256: asset.versions[0]!.sha256,
  });
  expect(saved.content.characters[0]!.name).toBe("林舟");
  view.unmount();
  mount("scenes", project, `ep_${"2".repeat(32)}`);
  await screen.findByDisplayValue("码头");
  fill("查看场景状态", variant.variant_id);
  expect(screen.getByLabelText("状态名称")).toHaveValue("雨后凌晨");
  expect(screen.getByLabelText("环境参考说明").closest("div")).toHaveTextContent(
    asset.versions[0]!.id,
  );
  expect(service.versions.size).toBe(2);
  expect([...service.versions.values()][0]!.content.schema_version).toBe("1.0.0");
});
it("world references and state references survive changes from other real editor entries", async () => {
  await seed();
  const scene = mount();
  await screen.findByDisplayValue("码头");
  fireEvent.click(screen.getByRole("button", { name: "新增场景状态" }));
  fill("状态名称", "夜雨");
  await chooseReference();
  await save();
  scene.unmount();
  const world = mount("world");
  await screen.findByText("创建世界设定");
  fill("世界定位", "海港未来城市");
  await chooseReference();
  await save();
  const saved = service.heads.get(project)!.content;
  if (saved.schema_version !== "1.3.0") throw new Error("Missing environment");
  expect(saved.environment_references).toHaveLength(2);
  expect(saved.environment_references[1]!.scene_id).toBeNull();
  expect(saved.scene_variants[0]!.name).toBe("夜雨");
  world.unmount();
  mount();
  await screen.findByDisplayValue("码头");
  fill("空间与叙事", "更新地点说明");
  await save();
  const newest = service.heads.get(project)!.content;
  expect(newest.schema_version === "1.3.0" && newest.environment_references).toEqual(
    saved.environment_references,
  );
});
it("explicit state and scene removal delete only current owned associations and preserve saved versions", async () => {
  await seed();
  mount();
  await screen.findByDisplayValue("码头");
  fireEvent.click(screen.getByRole("button", { name: "新增场景状态" }));
  fill("状态名称", "夜雨");
  await chooseReference();
  await save();
  const historic = structuredClone(service.heads.get(project)!);
  fireEvent.click(screen.getByRole("button", { name: "删除场景状态" }));
  await save();
  const newest = service.heads.get(project)!.content;
  expect(newest.schema_version === "1.3.0" && newest.scene_variants).toEqual([]);
  expect(newest.schema_version === "1.3.0" && newest.environment_references).toEqual([]);
  expect(service.versions.get(historic.version_id)).toEqual(historic);
  fireEvent.click(screen.getByRole("button", { name: "删除场景" }));
  await save();
  expect(service.heads.get(project)!.content.characters).toHaveLength(1);
});
it("unknown save survives reopening without auto-resend and retains all exact state/reference input", async () => {
  await seed();
  const view = mount();
  await screen.findByDisplayValue("码头");
  fireEvent.click(screen.getByRole("button", { name: "新增场景状态" }));
  fill("状态名称", "夜雨");
  await chooseReference();
  vi.mocked(service.api.createProjectCreativeLibraryVersion).mockResolvedValueOnce({
    kind: "REMOTE_UNKNOWN",
  });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText(/保存结果待核对/);
  const calls = vi.mocked(service.api.createProjectCreativeLibraryVersion).mock.calls.length;
  view.unmount();
  mount();
  await screen.findByText(/已恢复原提交内容/);
  expect(service.api.createProjectCreativeLibraryVersion).toHaveBeenCalledTimes(calls);
  const pending = JSON.parse(
    localStorage.getItem(`aivora.creative-library.pending.v1.${project}`)!,
  );
  expect(pending.payload.content.scene_variants[0].name).toBe("夜雨");
  expect(pending.payload.content.environment_references[0].asset_version_id).toBe(
    asset.versions[0]!.id,
  );
});
it("keeps a historical association when originals disappear or reads become unknown without preview or head substitution", async () => {
  await seed();
  const view = mount();
  await screen.findByDisplayValue("码头");
  await chooseReference();
  await save();
  view.unmount();
  const missing = structuredClone(asset);
  missing.versions[0]!.availability = "MISSING";
  list.mockResolvedValueOnce({
    kind: "LISTED",
    receipt: { data: [missing], request_id: requestId },
  });
  mount();
  await screen.findByText(/原件缺失、变更或尚未核验/);
  expect(screen.queryByRole("button", { name: "读取此参考预览" })).not.toBeInTheDocument();
  expect(preview).not.toHaveBeenCalled();
  list.mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
  fireEvent.click(screen.getByRole("button", { name: "刷新登记素材" }));
  await screen.findByText(/素材状态未知，历史关联保留/);
  expect(screen.getByLabelText("环境参考说明")).toHaveValue("精确旧版参考");
  expect(screen.getByRole("button", { name: "关联环境参考" })).toBeDisabled();
});
it("rejects late asset results across two projects A to B to A", async () => {
  await seed();
  let finish!: (v: Awaited<ReturnType<AssetLibraryGateway["listProjectMediaAssets"]>>) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount("world");
  await waitFor(() => expect(list).toHaveBeenCalledWith(project));
  view.rerender(
    <ManualCreativeEditor key={other} kind="world" projectId={other} setNavigationGuard={guard} />,
  );
  await waitFor(() => expect(list).toHaveBeenCalledWith(other));
  list.mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
  view.rerender(
    <ManualCreativeEditor
      key={project}
      kind="world"
      projectId={project}
      setNavigationGuard={guard}
    />,
  );
  await screen.findByText(/素材状态未知或回执未核对/);
  await act(async () =>
    finish({ kind: "LISTED", receipt: { data: [asset], request_id: requestId } }),
  );
  expect(screen.getByRole("button", { name: "关联环境参考" })).toBeDisabled();
  expect(screen.queryByRole("option", { name: "新版.png" })).not.toBeInTheDocument();
});
it("blocks leaving with unsaved state fields and retains exact character/detail operations in schema 1.3", async () => {
  await seed();
  mount();
  await screen.findByDisplayValue("码头");
  fireEvent.click(screen.getByRole("button", { name: "新增场景状态" }));
  fill("状态名称", "夜雨");
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  expect(guard.mock.calls.at(-1)![0]()).toBe(false);
  const content = withCreativeEnvironment(seedContent());
  content.scene_variants = [
    {
      variant_id: `scv_${"1".repeat(32)}`,
      ordinal: 1,
      scene_id: sceneId,
      name: " 夜雨 ",
      view: "",
      time_of_day: "",
      weather: "",
      state: "",
      continuity: "",
    },
  ];
  const clone = cloneCreativeContent(content);
  if (clone.schema_version !== "1.3.0") throw new Error("Missing environment");
  clone.scene_variants[0]!.name = "changed";
  expect(content.scene_variants[0]!.name).toBe(" 夜雨 ");
  expect(removeCreativeCharacter(content, content.characters[0]!.character_id).schema_version).toBe(
    "1.3.0",
  );
  expect(removeCreativeCostume(content, "missing")).toEqual(content);
  const normalized = normalizeCreativeContent(content);
  expect(normalized.schema_version === "1.3.0" && normalized.scene_variants[0]!.name).toBe("夜雨");
  expect(validCreativeContent(normalized, project)).toBe(true);
});
it("adding a character reference to 1.3 preserves environment fields instead of downgrading", async () => {
  let latest: CreativeContent;
  function Harness() {
    const [content, edit] = useState<CreativeContent>(() => withCreativeEnvironment(seedContent()));
    latest = content;
    return (
      <CharacterReferenceAssets
        content={content}
        characterId={content.characters[0]!.character_id}
        locked={false}
        edit={edit}
        onNotice={vi.fn()}
      />
    );
  }
  render(<Harness />);
  await screen.findByRole("option", { name: "新版.png" });
  fill("参考素材", asset.id);
  fill("参考素材版本", asset.versions[0]!.id);
  fireEvent.click(screen.getByRole("button", { name: "关联选中参考" }));
  fill("参考说明", "身份参考");
  expect(latest!.schema_version).toBe("1.3.0");
  if (latest!.schema_version !== "1.3.0") throw new Error("Missing environment");
  expect(latest!.references).toHaveLength(1);
  expect(latest!.environment_references).toEqual([]);
  expect(latest!.scene_variants).toEqual([]);
});

it("restores each scene state cursor through scene A to B to A without moving reference ownership", async () => {
  await seed();
  mount();
  await screen.findByDisplayValue("码头");
  fireEvent.click(screen.getByRole("button", { name: "新增场景状态" }));
  fill("状态名称", "码头夜雨");
  await save();
  fireEvent.click(screen.getByRole("button", { name: "新增场景" }));
  fill("场景名称", "广场");
  fireEvent.click(screen.getByRole("button", { name: "新增场景状态" }));
  fill("状态名称", "广场清晨");
  await save();
  fireEvent.click(screen.getByRole("button", { name: /码头/ }));
  expect(screen.getByLabelText("状态名称")).toHaveValue("码头夜雨");
  fireEvent.click(screen.getByRole("button", { name: /广场/ }));
  expect(screen.getByLabelText("状态名称")).toHaveValue("广场清晨");
  fireEvent.click(screen.getByRole("button", { name: /码头/ }));
  expect(screen.getByLabelText("状态名称")).toHaveValue("码头夜雨");
  const saved = service.heads.get(project)!.content;
  expect(saved.schema_version === "1.3.0" && saved.scene_variants.map((item) => item.name)).toEqual(
    ["码头夜雨", "广场清晨"],
  );
});

it("rejects a contradictory saved environment receipt and preserves UNKNOWN instead of retrying", async () => {
  await seed();
  mount();
  await screen.findByDisplayValue("码头");
  fireEvent.click(screen.getByRole("button", { name: "新增场景状态" }));
  fill("状态名称", "夜雨");
  await chooseReference();
  const create = vi.mocked(service.api.createProjectCreativeLibraryVersion);
  const real = create.getMockImplementation()!;
  create.mockImplementationOnce(async (...args) => {
    const result = await real(...args);
    if (result.kind !== "CREATED") throw new Error("Fixture failure");
    const receipt = structuredClone(result.receipt);
    if (receipt.data.version.content.schema_version !== "1.3.0")
      throw new Error("Missing environment");
    receipt.data.version.content.environment_references[0]!.asset_version_id =
      asset.latest_version.id;
    return { kind: "CREATED", receipt };
  });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText(/保存结果待核对/);
  expect(screen.getByLabelText("状态名称")).toBeDisabled();
  expect(screen.getByLabelText("环境参考说明")).toHaveValue("精确旧版参考");
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  expect(create).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(`aivora.creative-library.pending.v1.${project}`)).not.toBeNull();
});
