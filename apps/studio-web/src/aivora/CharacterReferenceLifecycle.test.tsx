import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManualCreativeEditor } from "./ManualCreativeEditor";
import { makeGateway, project, requestId } from "./ManualCreativeEditor.testFixtures";
import { emptyCreativeContent } from "./adapters/creativeLibrary";
import { createStudioTransport } from "../api/studio";
import { asset } from "./CharacterReferenceAssets.testFixtures";
import type * as Common from "./Common";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
vi.mock("./Common", async (load) => ({
  ...(await load<typeof Common>()),
  PageTitle: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header>,
}));
let service: ReturnType<typeof makeGateway>;
const guard = vi.fn<(value: (() => boolean) | null) => void>();
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  guard.mockClear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  service = makeGateway();
  const initial = emptyCreativeContent(project);
  initial.characters = [
    {
      character_id: `chr_${"1".repeat(32)}`,
      ordinal: 1,
      name: "林舟",
      role: "",
      description: "",
      appearance: "",
      personality: "",
    },
  ];
  await service.api.createProjectCreativeLibraryVersion(project, requestId, {
    content: initial,
    parent_version_id: null,
    expected_revision: null,
    change_summary: "initial",
  });
  vi.mocked(service.api.createProjectCreativeLibraryVersion).mockClear();
  vi.mocked(createStudioTransport).mockReturnValue({
    ...service.api,
    assetLibrary: {
      listProjectMediaAssets: vi
        .fn()
        .mockResolvedValue({ kind: "LISTED", receipt: { data: [asset], request_id: requestId } }),
    },
  } as unknown as ReturnType<typeof createStudioTransport>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const mount = () =>
  render(<ManualCreativeEditor kind="characters" projectId={project} setNavigationGuard={guard} />);
async function add(costume = false) {
  await screen.findByDisplayValue("林舟");
  if (costume) {
    fireEvent.click(screen.getByRole("button", { name: "新增服装版本" }));
    fireEvent.change(screen.getByLabelText("服装名称"), { target: { value: "雨衣" } });
    fireEvent.change(screen.getByLabelText("参考归属"), {
      target: { value: (screen.getByLabelText("参考归属") as HTMLSelectElement).options[1]!.value },
    });
  }
  await screen.findByText("真实登记参考.png");
  fireEvent.change(screen.getByLabelText("参考素材"), { target: { value: asset.id } });
  fireEvent.change(screen.getByLabelText("参考素材版本"), {
    target: { value: asset.latest_version.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "关联选中参考" }));
  fireEvent.change(screen.getByLabelText("参考说明"), { target: { value: "正面参考" } });
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
it("persists exact V3 references with existing CAS/readback while preserving legacy history", async () => {
  const old = service.heads.get(project)!;
  const view = mount();
  await add();
  expect(service.api.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
  submit();
  await screen.findByText(/已保存，并已回读核对/);
  const saved = service.heads.get(project)!;
  expect(saved.content.schema_version === "1.2.0" && saved.content.references[0]).toMatchObject({
    asset_id: asset.id,
    asset_version_id: asset.latest_version.id,
    asset_sha256: asset.latest_version.sha256,
    label: "正面参考",
  });
  expect(service.api.getProjectCreativeLibraryVersion).toHaveBeenCalledWith(
    project,
    saved.version_id,
  );
  expect(service.versions.get(old.version_id)!.content).toEqual(old.content);
  view.unmount();
  mount();
  await screen.findByDisplayValue("正面参考");
});
it("keeps UNKNOWN reference input locked through reopening and only checks on explicit action", async () => {
  const view = mount();
  await add();
  vi.mocked(service.api.createProjectCreativeLibraryVersion).mockResolvedValueOnce({
    kind: "REMOTE_UNKNOWN",
  });
  submit();
  await screen.findByText(/保存结果待核对/);
  const original = vi.mocked(service.api.createProjectCreativeLibraryVersion).mock.calls[0];
  view.unmount();
  mount();
  await screen.findByDisplayValue("正面参考");
  expect(screen.getByLabelText("参考说明")).toBeDisabled();
  expect(service.api.createProjectCreativeLibraryVersion).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "核对原提交" }));
  await screen.findByText(/已保存，并已回读核对/);
  expect(vi.mocked(service.api.createProjectCreativeLibraryVersion).mock.calls[1]).toEqual(
    original,
  );
});
it("rejects altered V3 receipts without replacing reference input or retrying", async () => {
  mount();
  await add();
  const create = service.api.createProjectCreativeLibraryVersion;
  const real = vi.mocked(create).getMockImplementation()!;
  vi.mocked(create).mockImplementationOnce(async (...args) => {
    const result = await real(...args);
    if (result.kind !== "CREATED") throw new Error("Fixture failed");
    const receipt = structuredClone(result.receipt);
    if (receipt.data.version.content.schema_version !== "1.2.0")
      throw new Error("Missing reference schema");
    receipt.data.version.content.references[0]!.asset_sha256 = "f".repeat(64);
    return { kind: "CREATED", receipt };
  });
  submit();
  await screen.findByText(/保存结果待核对/);
  expect(screen.getByDisplayValue("正面参考")).toBeDisabled();
  expect(create).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(`aivora.creative-library.pending.v1.${project}`)).not.toBeNull();
});
it("guards unsaved reference text and confirms costume reference removal while retaining history", async () => {
  mount();
  await add(true);
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  expect(guard.mock.calls.at(-1)?.[0]?.()).toBe(false);
  expect(screen.getByDisplayValue("正面参考")).toBeInTheDocument();
  submit();
  await screen.findByText(/已保存，并已回读核对/);
  const historic = service.heads.get(project)!;
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "删除服装：雨衣" }));
  expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining("1 个参考关联"));
  expect(screen.getByDisplayValue("正面参考")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "删除服装：雨衣" }));
  expect(screen.queryByLabelText("参考说明")).not.toBeInTheDocument();
  submit();
  await screen.findByText(/已保存，并已回读核对/);
  expect(historic.content.schema_version === "1.2.0" && historic.content.references).toHaveLength(
    1,
  );
  expect(service.heads.get(project)!.content.schema_version).toBe("1.2.0");
});

it("keeps the shared reference draft through episode A→B→A without rebinding or submitting", async () => {
  const view = mount();
  await add();
  for (const episodeId of ["ep_first", "ep_second", "ep_first"]) {
    view.rerender(
      <ManualCreativeEditor
        kind="characters"
        projectId={project}
        episodeId={episodeId}
        setNavigationGuard={guard}
      />,
    );
    expect(screen.getByDisplayValue("正面参考")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(asset.latest_version.id))).toBeInTheDocument();
  }
  expect(service.api.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
});

it("rejects blank reference labels before creating a pending write", async () => {
  mount();
  await add();
  fireEvent.change(screen.getByLabelText("参考说明"), { target: { value: " " } });
  submit();
  await screen.findByText(/请填写角色和场景名称/);
  expect(service.api.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
  expect(localStorage.getItem(`aivora.creative-library.pending.v1.${project}`)).toBeNull();
});
