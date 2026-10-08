import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualCreativeEditor } from "./ManualCreativeEditor";
import { createStudioTransport } from "../api/studio";
import { cloneCreativeContent, emptyCreativeContent } from "./adapters/creativeLibrary";
import type * as Common from "./Common";
import type { CreativeGateway, CreativeVersion } from "./adapters/creativeLibrary";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
vi.mock("./Common", async (load) => {
  const actual = await load<typeof Common>();
  return {
    ...actual,
    PageTitle: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header>,
  };
});
const project = `prj_${"a".repeat(32)}`;
const other = `prj_${"b".repeat(32)}`;
const requestId = "123e4567-e89b-42d3-a456-426614174000";
type Guard = (() => boolean) | null;
function makeGateway() {
  const heads = new Map<string, CreativeVersion>();
  const versions = new Map<string, CreativeVersion>();
  const operations = new Map<string, CreativeVersion>();
  let number = 0;
  const api: CreativeGateway = {
    getProjectCreativeLibrary: vi.fn<CreativeGateway["getProjectCreativeLibrary"]>(async (id) => {
      const current = heads.get(id);
      return current
        ? { kind: "FOUND", receipt: { data: current, request_id: requestId } }
        : { kind: "EMPTY" };
    }),
    getProjectCreativeLibraryVersion: vi.fn<CreativeGateway["getProjectCreativeLibraryVersion"]>(
      async (_id, versionId) => {
        const saved = versions.get(versionId);
        return saved
          ? { kind: "FOUND", receipt: { data: saved, request_id: requestId } }
          : { kind: "REMOTE_UNKNOWN" };
      },
    ),
    createProjectCreativeLibraryVersion: vi.fn<
      CreativeGateway["createProjectCreativeLibraryVersion"]
    >(async (id, operationId, payload) => {
      const existing = operations.get(operationId);
      if (existing)
        return {
          kind: "CREATED",
          receipt: { data: { version: existing, replayed: true }, request_id: requestId },
        };
      const count = (heads.get(id)?.head_revision ?? 0) + 1;
      const saved: CreativeVersion = {
        project_id: id,
        episode_id: null,
        version_id: `ver_${(++number).toString(16).padStart(32, "0")}`,
        version_number: count,
        head_revision: count,
        parent_version_id: payload.parent_version_id,
        content: cloneCreativeContent(payload.content),
        content_hash: `sha256:${number.toString(16).padStart(64, "0")}`,
        author_actor_id: "local-user",
        change_summary: payload.change_summary,
        created_at: "2026-10-08T03:00:00Z",
      };
      heads.set(id, saved);
      versions.set(saved.version_id, saved);
      operations.set(operationId, saved);
      return {
        kind: "CREATED",
        receipt: { data: { version: saved, replayed: false }, request_id: requestId },
      };
    }),
  };
  return { api, heads, versions };
}
const guard = vi.fn<(value: Guard) => void>();
let service: ReturnType<typeof makeGateway>;
function mount(kind: "characters" | "world" | "scenes" = "characters", id = project) {
  return render(
    <ManualCreativeEditor
      key={`${id}:${kind}`}
      kind={kind}
      projectId={id}
      setNavigationGuard={guard}
    />,
  );
}
async function save() {
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText(/已保存，并已回读核对/);
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  guard.mockClear();
  service = makeGateway();
  vi.mocked(createStudioTransport).mockReturnValue(
    service.api as ReturnType<typeof createStudioTransport>,
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("manual native creative editors", () => {
  it("creates from empty, edits, reorders and deletes characters; saved opaque identities survive reopening", async () => {
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: "创建第一个角色" }));
    fill("角色名称", "林澈");
    fill("身份与作用", "调查员");
    fireEvent.click(screen.getByRole("button", { name: "新增角色" }));
    fill("角色名称", "周岚");
    fireEvent.click(screen.getByRole("button", { name: "上移角色" }));
    expect(
      within(screen.getByRole("complementary", { name: "角色列表" })).getAllByRole("button")[0],
    ).toHaveTextContent("周岚");
    await save();
    const ids = service.heads.get(project)!.content.characters.map((item) => item.character_id);
    expect(ids.every((id) => /^chr_[0-9a-f]{32}$/.test(id))).toBe(true);
    view.unmount();
    mount();
    await screen.findByDisplayValue("周岚");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除角色" }));
    await save();
    expect(service.heads.get(project)!.content.characters.map((item) => item.name)).toEqual([
      "林澈",
    ]);
    expect(service.versions.size).toBe(2);
    expect([...service.versions.values()][0]!.content.characters).toHaveLength(2);
  });
  it("persists shared world and scene fields without erasing characters", async () => {
    const start = emptyCreativeContent(project);
    start.characters = [
      {
        character_id: `chr_${"c".repeat(32)}`,
        ordinal: 1,
        name: "林澈",
        role: "调查员",
        description: "",
        appearance: "",
        personality: "",
      },
    ];
    await service.api.createProjectCreativeLibraryVersion(project, requestId, {
      content: start,
      parent_version_id: null,
      expected_revision: null,
      change_summary: "initial",
    });
    const world = mount("world");
    await screen.findByText("创建世界设定");
    fill("世界定位", "海岸边的未来城市");
    fill("核心规则", "科技发展有明确边界");
    fill("时代背景", "近未来");
    await save();
    world.unmount();
    const scene = mount("scenes");
    fireEvent.click(await screen.findByRole("button", { name: "创建第一个场景" }));
    fill("场景名称", "旧街区");
    fill("地点", "海港东侧");
    fill("时间", "凌晨");
    fill("天气", "雨后");
    fill("连续性要求", "窗边留一盏暖灯");
    await save();
    scene.unmount();
    mount("world");
    await screen.findByDisplayValue("海岸边的未来城市");
    const content = service.heads.get(project)!.content;
    expect(content.episode_id).toBeNull();
    expect(content.characters[0]!.name).toBe("林澈");
    expect(content.scenes[0]).toMatchObject({
      name: "旧街区",
      weather: "雨后",
      continuity: "窗边留一盏暖灯",
    });
  });
  it("keeps unknown saves locked and recovers the identical operation after reopening", async () => {
    const create = service.api.createProjectCreativeLibraryVersion;
    vi.mocked(create).mockImplementationOnce(async (...args) => {
      const result = await makeGateway().api.createProjectCreativeLibraryVersion(...args);
      if (result.kind === "CREATED") {
        const saved = result.receipt.data.version;
        service.heads.set(project, saved);
        service.versions.set(saved.version_id, saved);
        vi.mocked(create).mockResolvedValue({
          kind: "CREATED",
          receipt: {
            data: { version: saved, replayed: true },
            request_id: requestId,
          },
        });
      }
      return { kind: "REMOTE_UNKNOWN" };
    });
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: "创建第一个角色" }));
    fill("角色名称", "林澈");
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText(/保存结果待核对/);
    expect(screen.getByLabelText("角色名称")).toBeDisabled();
    view.unmount();
    mount();
    await screen.findByRole("button", { name: "核对原提交" });
    fireEvent.click(screen.getByRole("button", { name: "核对原提交" }));
    await screen.findByText(/已保存，并已回读核对/);
    const calls = vi.mocked(create).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(screen.getByLabelText("角色名称")).not.toBeDisabled();
  });
  it("blocks busy navigation and asks before discarding dirty edits", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "创建第一个角色" }));
    fill("角色名称", "林澈");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    let allowed: boolean | undefined;
    act(() => {
      allowed = guard.mock.calls.at(-1)![0]?.();
    });
    expect(allowed).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("未保存"));
    let release!: (
      value: Awaited<ReturnType<CreativeGateway["createProjectCreativeLibraryVersion"]>>,
    ) => void;
    vi.mocked(service.api.createProjectCreativeLibraryVersion).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    act(() => {
      allowed = guard.mock.calls.at(-1)![0]?.();
    });
    expect(allowed).toBe(false);
    expect(screen.getByText(/正在读取或保存设定/)).toBeInTheDocument();
    await act(async () => {
      release({ kind: "REMOTE_UNKNOWN" });
    });
  });
  it("isolates projects and rejects late reads from the previous project", async () => {
    let release!: (
      value: Awaited<ReturnType<CreativeGateway["getProjectCreativeLibrary"]>>,
    ) => void;
    vi.mocked(service.api.getProjectCreativeLibrary).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = mount();
    view.rerender(
      <ManualCreativeEditor
        key={`${other}:characters`}
        kind="characters"
        projectId={other}
        setNavigationGuard={guard}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "创建第一个角色" }));
    fill("角色名称", "另一个作品的人物");
    await save();
    await act(async () => {
      release({ kind: "EMPTY" });
    });
    expect(screen.getByLabelText("角色名称")).toHaveValue("另一个作品的人物");
    expect(service.heads.has(project)).toBe(false);
    expect(service.heads.get(other)!.content.characters[0]!.name).toBe("另一个作品的人物");
  });
  it("shows read failures honestly and enables empty-state creation after retry", async () => {
    vi.mocked(service.api.getProjectCreativeLibrary).mockResolvedValueOnce({
      kind: "REMOTE_UNKNOWN",
    });
    mount();
    await screen.findByText("暂时无法读取设定");
    expect(screen.getByRole("button", { name: "新增角色" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建第一个角色" })).toBeEnabled(),
    );
  });
});
