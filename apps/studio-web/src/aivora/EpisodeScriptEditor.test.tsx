import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createStudioTransport } from "../api/studio";
import { EpisodeScriptEditor } from "./EpisodeScriptEditor";
import type {
  ConfirmationGateway,
  ScriptConfirmationStatus,
  ScriptGateway,
  ScriptVersion,
  SourceBindingGateway,
} from "./adapters/episodeScript";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
// These sibling workflows have their own integration suites. The editor, scene
// controls, script adapter, and durable journals remain real in this suite.
vi.mock("./OfficialTextProposalPanel", () => ({ OfficialTextProposalPanel: () => null }));
vi.mock("./AcceptedSourceSummarySeed", () => ({ AcceptedSourceSummarySeed: () => null }));

const project = `prj_${"1".repeat(32)}`;
const episode = `ep_${"2".repeat(32)}`;
const brief = `ver_${"b".repeat(32)}`;
const operation = "11111111-1111-4111-8111-111111111111";

function script(): ScriptVersion {
  return {
    project_id: project,
    episode_id: episode,
    version_id: `ver_${"3".repeat(32)}`,
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content_hash: `sha256:${"4".repeat(64)}`,
    author_actor_id: "local-test",
    created_at: "2026-10-10T00:00:00Z",
    change_summary: "Synthetic local fixture",
    content: {
      schema_version: "1.0.0",
      project_id: project,
      episode_id: episode,
      production_brief_version_id: brief,
      story_bible_version_id: null,
      source_extraction_version_id: null,
      source_proposal_acceptance_id: null,
      scenes: [
        {
          scene_id: `scn_${"5".repeat(32)}`,
          ordinal: 1,
          heading: "Original scene",
          blocks: [
            {
              block_id: `sblk_${"6".repeat(32)}`,
              ordinal: 1,
              kind: "ACTION",
              text: "Original action",
              speaker: null,
              delivery: null,
            },
          ],
        },
      ],
    },
  };
}

function unconfirmed(saved = script()): ScriptConfirmationStatus {
  return {
    project_id: project,
    episode_id: episode,
    latest_version_id: saved.version_id,
    latest_head_revision: saved.head_revision,
    current: false,
    confirmation: null,
  };
}

function setup(initial: ScriptVersion | null = script()) {
  let saved = initial;
  let confirmation = unconfirmed(initial ?? script());
  const api = {
    getEpisodeScript: vi
      .fn<ScriptGateway["getEpisodeScript"]>()
      .mockImplementation(async () =>
        saved ? { kind: "FOUND", receipt: { data: saved, request_id: "get" } } : { kind: "EMPTY" },
      ),
    getEpisodeScriptVersion: vi
      .fn<ScriptGateway["getEpisodeScriptVersion"]>()
      .mockImplementation(async () =>
        saved
          ? { kind: "FOUND", receipt: { data: saved, request_id: "exact" } }
          : { kind: "REMOTE_UNKNOWN" },
      ),
    createEpisodeScriptVersion: vi
      .fn<ScriptGateway["createEpisodeScriptVersion"]>()
      .mockImplementation(async (_project, _episode, _key, payload) => {
        saved = {
          ...script(),
          content: payload.content,
          version_id: `ver_${"7".repeat(32)}`,
          version_number: 2,
          head_revision: 2,
          parent_version_id: payload.parent_version_id,
          change_summary: payload.change_summary,
        };
        confirmation = unconfirmed(saved);
        return {
          kind: "CREATED",
          receipt: { data: { version: saved, replayed: false }, request_id: "post" },
        };
      }),
    getEpisodeScriptConfirmation: vi
      .fn<ConfirmationGateway["getEpisodeScriptConfirmation"]>()
      .mockImplementation(async () => ({
        kind: "FOUND",
        receipt: { data: confirmation, request_id: "get" },
      })),
    getEpisodeScriptConfirmationReceipt: vi
      .fn<ConfirmationGateway["getEpisodeScriptConfirmationReceipt"]>()
      .mockImplementation(async () => ({
        kind: "FOUND",
        receipt: { data: confirmation, request_id: "exact" },
      })),
    createEpisodeScriptConfirmation: vi
      .fn<ConfirmationGateway["createEpisodeScriptConfirmation"]>()
      .mockImplementation(async (_project, _episode, _key, payload) => {
        confirmation = {
          ...unconfirmed(saved ?? script()),
          current: true,
          confirmation: {
            confirmation_id: `esc_${"8".repeat(32)}`,
            project_id: project,
            episode_id: episode,
            artifact_id: `art_${"9".repeat(32)}`,
            version_id: payload.version_id,
            content_hash: payload.expected_content_hash,
            head_revision: payload.expected_head_revision,
            actor_id: "local-test",
            confirmed_at: "2026-10-10T00:00:00Z",
          },
        };
        return {
          kind: "CREATED",
          receipt: { data: { status: confirmation, replayed: false }, request_id: "post" },
        };
      }),
    getSourceExtraction: vi
      .fn<SourceBindingGateway["getSourceExtraction"]>()
      .mockResolvedValue({ kind: "NOT_FOUND" }),
    getSourceProposalAcceptanceForVersion: vi
      .fn<SourceBindingGateway["getSourceProposalAcceptanceForVersion"]>()
      .mockResolvedValue({ kind: "NOT_FOUND" }),
  };
  // The editor deliberately consumes only these eight gateway methods. The
  // omitted StudioTransport methods belong to the isolated sibling workflows.
  vi.mocked(createStudioTransport).mockReturnValue(
    api as unknown as ReturnType<typeof createStudioTransport>,
  );
  return api;
}

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
const mount = () =>
  render(<EpisodeScriptEditor projectId={project} episodeId={episode} briefVersionId={brief} />);
async function ready() {
  await waitFor(() => expect(screen.getByRole("button", { name: "确认此剧本版本" })).toBeEnabled());
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operation);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("episode script editor persistence workflow", () => {
  test("save pins parent/revision and confirmation is a separate exact-version action", async () => {
    const api = setup();
    mount();
    await ready();
    change("动作内容", "Human edit");
    expect(screen.getByRole("button", { name: "确认此剧本版本" })).toBeDisabled();
    click("保存草稿版本");
    expect(await screen.findByText(/草稿版本 2 已保存并精确读回/)).toBeVisible();
    expect(api.createEpisodeScriptVersion.mock.calls[0]?.[3]).toMatchObject({
      parent_version_id: script().version_id,
      expected_revision: 1,
      content: {
        production_brief_version_id: brief,
        scenes: [{ blocks: [{ text: "Human edit" }] }],
      },
    });
    expect(api.createEpisodeScriptConfirmation).not.toHaveBeenCalled();
    await ready();
    click("确认此剧本版本");
    expect(await screen.findByText("当前剧本版本已人工确认，确认回执已精确读回。")).toBeVisible();
    expect(api.createEpisodeScriptConfirmation.mock.calls[0]?.[3]).toMatchObject({
      version_id: `ver_${"7".repeat(32)}`,
      expected_head_revision: 2,
      confirm: true,
    });
    expect(api.getEpisodeScriptConfirmationReceipt).toHaveBeenCalledTimes(1);
  });

  test("UNKNOWN save can only be read and explicitly closed, never replayed", async () => {
    const api = setup();
    api.createEpisodeScriptVersion.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    mount();
    await ready();
    change("动作内容", "Unsaved");
    click("保存草稿版本");
    expect(await screen.findByText(/提交结果未知；已持久锁定原操作/)).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿版本" })).toBeDisabled();
    click("舍弃草稿并读取");
    click((await screen.findByRole("button", { name: "结束未知记录" })).textContent ?? "");
    expect(await screen.findByText(/已结束未知提交记录；未归因原提交结果/)).toBeVisible();
    expect(api.createEpisodeScriptVersion).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("动作内容")).toHaveValue("Original action");
  });

  test("UNKNOWN confirmation requires GET before explicit journal closure", async () => {
    const api = setup();
    api.createEpisodeScriptConfirmation.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    mount();
    await ready();
    click("确认此剧本版本");
    expect(await screen.findByText(/确认结果未知；原操作已持久锁定/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "结束未知确认记录" })).toBeNull();
    click("只读核对确认状态");
    fireEvent.click(await screen.findByRole("button", { name: "结束未知确认记录" }));
    expect(await screen.findByText(/已结束未知确认记录；未归因原提交/)).toBeVisible();
    expect(api.createEpisodeScriptConfirmation).toHaveBeenCalledTimes(1);
  });

  test.each([403, 409, 422])("save rejection %s never announces success", async (status) => {
    const api = setup();
    api.createEpisodeScriptVersion.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status,
      code: "DENIED",
      request_id: "post",
    });
    mount();
    await ready();
    change("动作内容", "Unsaved");
    click("保存草稿版本");
    expect(
      await screen.findByText(status === 409 ? /剧本修订冲突；草稿保留/ : /草稿保存被拒绝/),
    ).toBeVisible();
    expect(screen.getByLabelText("动作内容")).toHaveValue("Unsaved");
    expect(api.getEpisodeScriptVersion).not.toHaveBeenCalled();
  });

  test("confirmation rejection requires another authoritative read", async () => {
    const api = setup();
    api.createEpisodeScriptConfirmation.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "CONFLICT",
      request_id: "post",
    });
    mount();
    await ready();
    click("确认此剧本版本");
    expect(await screen.findByText(/剧本确认被拒绝/)).toBeVisible();
    expect(screen.getByRole("button", { name: "确认此剧本版本" })).toBeDisabled();
    expect(api.getEpisodeScriptConfirmationReceipt).not.toHaveBeenCalled();
    click("只读核对确认状态");
    await ready();
    expect(api.createEpisodeScriptConfirmation).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["场次标题", " ", /场次标题需为/],
    ["场次标题", "字".repeat(241), /场次标题需为/],
    ["动作内容", " ", /每段内容需为/],
    ["动作内容", "字".repeat(20001), /每段内容需为/],
    ["修改说明", " ", /修改说明需为/],
    ["修改说明", "字".repeat(241), /修改说明需为/],
  ] as const)("invalid %s blocks POST (%#)", async (field, value, message) => {
    const api = setup();
    mount();
    await ready();
    change("动作内容", "Dirty draft");
    change(field, value);
    click("保存草稿版本");
    expect(await screen.findByText(message)).toBeVisible();
    expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
  });

  test("legacy dialogue cannot be confirmed until explicit delivery is saved", async () => {
    const initial = script();
    const block = initial.content.scenes[0]?.blocks[0];
    if (!block) throw new Error("fixture missing block");
    Object.assign(block, { kind: "DIALOGUE", speaker: "Actor", delivery: null });
    const api = setup(initial);
    mount();
    expect(await screen.findByText(/旧稿对白呈现方式待补齐/)).toBeVisible();
    expect(screen.getByRole("button", { name: "确认此剧本版本" })).toBeDisabled();
    change("对白内容", "Updated dialogue");
    click("保存草稿版本");
    expect(await screen.findByText("对白必须填写说话人，并明确画内或画外。")).toBeVisible();
    expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
    change("对白呈现", "OFF_SCREEN");
    click("保存草稿版本");
    expect(await screen.findByText(/草稿版本 2 已保存并精确读回/)).toBeVisible();
    await ready();
    expect(
      api.createEpisodeScriptVersion.mock.calls[0]?.[3].content.scenes[0]?.blocks[0]?.delivery,
    ).toBe("OFF_SCREEN");
    expect(block.delivery).toBeNull();
  });

  test.each(["scene", "save", "confirm"] as const)(
    "UUID failure during %s makes no mutation request",
    async (action) => {
      const api = setup();
      mount();
      await ready();
      vi.mocked(crypto.randomUUID).mockImplementation(() => {
        throw new Error("unavailable");
      });
      if (action === "save") {
        change("动作内容", "Dirty");
        click("保存草稿版本");
      }
      if (action === "scene") click("新增场次");
      if (action === "confirm") click("确认此剧本版本");
      expect(await screen.findByText(/无法生成/)).toBeVisible();
      expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
      expect(api.createEpisodeScriptConfirmation).not.toHaveBeenCalled();
    },
  );

  test("scene insert, move and deletion preserve contiguous saved ordinals", async () => {
    const api = setup();
    mount();
    await ready();
    click("新增场次");
    change("场次标题", "Added scene");
    click("添加动作");
    change("动作内容", "Added action");
    click("上移此场");
    expect(screen.getByRole("button", { name: "01 · Added scene" })).toBeVisible();
    click("下移此场");
    click("删除此场");
    click("保存草稿版本");
    // Returning to the original content is clean, so no save should be sent.
    expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存草稿版本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "01 · Original scene" })).toBeVisible();
  });

  test("source read failure prevents first save until explicit successful read", async () => {
    const api = setup(null);
    api.getSourceExtraction.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    mount();
    await screen.findByText("尚无持久剧本草稿");
    expect(screen.getByRole("button", { name: "保存草稿版本" })).toBeDisabled();
    click("重新核对已采纳来源");
    expect(await screen.findByText(/来源接纳状态无法核实/)).toBeVisible();
    api.getSourceExtraction.mockResolvedValue({ kind: "NOT_FOUND" });
    click("重新核对已采纳来源");
    expect(await screen.findByText("当前没有可绑定的已采纳来源。")).toBeVisible();
    click("新增场次");
    click("添加对白");
    change("说话人", "Actor");
    change("对白内容", "First dialogue");
    change("对白呈现", "ON_SCREEN");
    click("保存草稿版本");
    expect(await screen.findByText(/草稿版本 2 已保存并精确读回/)).toBeVisible();
    expect(api.createEpisodeScriptVersion.mock.calls[0]?.[3]).toMatchObject({
      parent_version_id: null,
      expected_revision: null,
    });
  });

  test("navigation guard rejects dirty leave unless user explicitly discards", async () => {
    setup();
    const setter = vi.fn<(guard: (() => boolean) | null) => void>();
    const mounted = render(
      <EpisodeScriptEditor
        projectId={project}
        episodeId={episode}
        briefVersionId={brief}
        setNavigationGuard={setter}
      />,
    );
    await ready();
    const guard = setter.mock.calls.at(-1)?.[0];
    if (!guard) throw new Error("guard not installed");
    expect(guard()).toBe(true);
    change("动作内容", "Dirty");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(guard()).toBe(false);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true);
    act(() => expect(guard()).toBe(true));
    expect(screen.getByLabelText("动作内容")).toHaveValue("Original action");
    mounted.unmount();
    expect(setter).toHaveBeenLastCalledWith(null);
  });

  test("read failure does not use fixture content or allow edits", async () => {
    const api = setup();
    api.getEpisodeScript.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    mount();
    expect(await screen.findByText("剧本状态无法核实，已暂停编辑与提交。")).toBeVisible();
    expect(screen.queryByLabelText("动作内容")).toBeNull();
    expect(screen.getByRole("button", { name: "新增场次" })).toBeDisabled();
    click("重新读取");
    expect(await screen.findByText("无法核实当前剧本，仍阻止提交。")).toBeVisible();
    expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
  });
});
