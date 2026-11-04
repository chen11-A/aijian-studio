import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManualCreativeEditor } from "./ManualCreativeEditor";
import { makeGateway, other, project, requestId } from "./ManualCreativeEditor.testFixtures";
import { emptyCreativeContent } from "./adapters/creativeLibrary";
import { createStudioTransport } from "../api/studio";
import type * as Common from "./Common";
import type { CreativeGateway } from "./adapters/creativeLibrary";

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
  const content = emptyCreativeContent(project);
  content.characters = ["林舟", "周岚"].map((name, index) => ({
    character_id: `chr_${String(index + 1).repeat(32)}`,
    ordinal: index + 1,
    name,
    role: "",
    description: "",
    appearance: "",
    personality: "",
  }));
  await service.api.createProjectCreativeLibraryVersion(project, requestId, {
    content,
    parent_version_id: null,
    expected_revision: null,
    change_summary: "initial",
  });
  vi.mocked(service.api.createProjectCreativeLibraryVersion).mockClear();
  vi.mocked(createStudioTransport).mockReturnValue(
    service.api as ReturnType<typeof createStudioTransport>,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(id = project) {
  return render(
    <ManualCreativeEditor key={id} kind="characters" projectId={id} setNavigationGuard={guard} />,
  );
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
async function addDetails() {
  await screen.findByDisplayValue("林舟");
  fill("添加关系对象", `chr_${"2".repeat(32)}`);
  fill("关系名称", "同事");
  fill("关系说明", "多年协作");
  fireEvent.click(screen.getByRole("button", { name: "新增服装版本" }));
  fill("服装名称", "夜间雨衣");
  fill("服装说明", "深蓝色，右袖有磨损");
}
async function save() {
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText(/已保存，并已回读核对/);
}

it("saves directed relationships and costume versions via the same exact-readback operation, retaining legacy history", async () => {
  const legacy = service.heads.get(project)!;
  const view = mount();
  await addDetails();
  expect(service.api.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
  expect(guard.mock.calls.at(-1)?.[0]).toBeTypeOf("function");
  await save();
  const saved = service.heads.get(project)!;
  expect(saved.content.schema_version).toBe("1.1.0");
  if (saved.content.schema_version !== "1.1.0") throw new Error("Missing versioned details");
  expect(saved.content.relationships[0]).toMatchObject({
    from_character_id: `chr_${"1".repeat(32)}`,
    to_character_id: `chr_${"2".repeat(32)}`,
    label: "同事",
  });
  expect(saved.content.costumes[0]).toMatchObject({
    character_id: `chr_${"1".repeat(32)}`,
    name: "夜间雨衣",
  });
  expect(service.versions.get(legacy.version_id)?.content).toEqual(legacy.content);
  expect(service.api.getProjectCreativeLibraryVersion).toHaveBeenCalledWith(
    project,
    saved.version_id,
  );
  view.unmount();
  mount();
  await screen.findByDisplayValue("夜间雨衣");
  expect(screen.getByDisplayValue("多年协作")).toBeInTheDocument();
});

it("removes only current draft references on explicit character deletion, retaining saved versions", async () => {
  mount();
  await addDetails();
  await save();
  const historic = service.heads.get(project)!;
  fireEvent.click(screen.getByRole("button", { name: "删除角色" }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("1 条关系、1 个服装"));
  await save();
  const next = service.heads.get(project)!.content;
  expect(next.characters).toHaveLength(1);
  expect(next.schema_version === "1.1.0" && next.relationships).toEqual([]);
  expect(next.schema_version === "1.1.0" && next.costumes).toEqual([]);
  expect(historic.content.schema_version === "1.1.0" && historic.content.costumes).toHaveLength(1);
});

it("preserves UNKNOWN details for explicit recovery after reopening without automatic resend", async () => {
  const view = mount();
  await addDetails();
  vi.mocked(service.api.createProjectCreativeLibraryVersion).mockResolvedValueOnce({
    kind: "REMOTE_UNKNOWN",
  });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText(/保存结果待核对/);
  const originalCall = vi.mocked(service.api.createProjectCreativeLibraryVersion).mock.calls[0]!;
  view.unmount();
  mount();
  await screen.findByDisplayValue("夜间雨衣");
  expect(service.api.createProjectCreativeLibraryVersion).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("服装说明")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "核对原提交" }));
  await screen.findByText(/已保存，并已回读核对/);
  expect(vi.mocked(service.api.createProjectCreativeLibraryVersion).mock.calls[1]).toEqual(
    originalCall,
  );
});

it("blocks blank detail saves and protects unsaved input on project navigation", async () => {
  const view = mount();
  await addDetails();
  fill("服装名称", "  ");
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText(/请填写角色和场景名称、关系和服装名称/);
  expect(service.api.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(guard.mock.calls.at(-1)?.[0]?.()).toBe(false);
  expect(screen.getByDisplayValue("多年协作")).toBeInTheDocument();
  view.rerender(
    <ManualCreativeEditor
      key={other}
      kind="characters"
      projectId={other}
      setNavigationGuard={guard}
    />,
  );
  await waitFor(() => expect(screen.getByText("还没有角色")).toBeInTheDocument());
  expect(screen.queryByDisplayValue("多年协作")).not.toBeInTheDocument();
});

it("keeps a mismatched detail receipt pending and rejects automatic recovery", async () => {
  mount();
  await addDetails();
  const create = service.api.createProjectCreativeLibraryVersion;
  const realCreate = vi.mocked(create).getMockImplementation()!;
  vi.mocked(create).mockImplementationOnce(async (...args) => {
    const saved = await realCreate(...args);
    if (saved.kind !== "CREATED") throw new Error("Expected saved fixture version");
    const receipt = structuredClone(saved.receipt);
    if (receipt.data.version.content.schema_version !== "1.1.0")
      throw new Error("Missing detail schema");
    receipt.data.version.content.costumes[0]!.description = "坏回执";
    return { kind: "CREATED", receipt };
  });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText(/保存结果待核对/);
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByDisplayValue("深蓝色，右袖有磨损")).toBeDisabled();
  expect(screen.queryByDisplayValue("坏回执")).not.toBeInTheDocument();
  expect(localStorage.getItem(`aivora.creative-library.pending.v1.${project}`)).not.toBeNull();
});

it("preserves current detail versions through A to B to A and rejects the old A reply", async () => {
  const legacy = service.heads.get(project)!;
  const first = mount();
  await addDetails();
  await save();
  first.unmount();
  let reply: (
    value: Awaited<ReturnType<CreativeGateway["getProjectCreativeLibrary"]>>,
  ) => void = () => {
    throw new Error("Missing pending read");
  };
  vi.mocked(service.api.getProjectCreativeLibrary).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const view = mount();
  await screen.findByText("正在读取作品设定");
  view.rerender(
    <ManualCreativeEditor
      key={other}
      kind="characters"
      projectId={other}
      setNavigationGuard={guard}
    />,
  );
  await screen.findByText("还没有角色");
  view.rerender(
    <ManualCreativeEditor
      key={project}
      kind="characters"
      projectId={project}
      setNavigationGuard={guard}
    />,
  );
  await screen.findByDisplayValue("夜间雨衣");
  await act(async () => {
    reply({ kind: "FOUND", receipt: { data: legacy, request_id: requestId } });
  });
  expect(screen.getByDisplayValue("夜间雨衣")).toBeInTheDocument();
  expect(screen.getByDisplayValue("多年协作")).toBeInTheDocument();
});
