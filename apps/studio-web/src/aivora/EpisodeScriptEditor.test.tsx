import { createHash, webcrypto } from "node:crypto";
import { impactCanonical } from "@aijian/contracts/script-confirmation-impact";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createStudioTransport } from "../api/studio";
import { EpisodeScriptEditor } from "./EpisodeScriptEditor";
import type {
  ConfirmationGateway,
  ScriptConfirmationStatus,
  ScriptGateway,
  ScriptVersion,
  ScriptWriteCommand,
  SourceBindingGateway,
} from "./adapters/episodeScript";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
// These sibling workflows have their own integration suites. The editor, scene
// controls, script adapter, and durable journals remain real in this suite.
vi.mock("./OfficialTextProposalPanel", () => ({ OfficialTextProposalPanel: () => null }));
vi.mock("./AcceptedSourceSummarySeed", () => ({ AcceptedSourceSummarySeed: () => null }));

const contentHash = (v: unknown) =>
  `sha256:${createHash("sha256").update(impactCanonical(v)).digest("hex")}`;
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
    author_actor_id: "local-user",
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

function twoSceneScript(): ScriptVersion {
  const saved = script();
  saved.content.scenes.push({
    scene_id: `scn_${"a".repeat(32)}`,
    ordinal: 2,
    heading: "Second scene",
    blocks: [
      {
        block_id: `sblk_${"c".repeat(32)}`,
        ordinal: 1,
        kind: "DIALOGUE",
        text: "Second dialogue",
        speaker: "Second speaker",
        delivery: "ON_SCREEN",
      },
      {
        block_id: `sblk_${"d".repeat(32)}`,
        ordinal: 2,
        kind: "ACTION",
        text: "Second action",
        speaker: null,
        delivery: null,
      },
    ],
  });
  return saved;
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
    getEpisodeScriptWriteOperation: vi
      .fn<NonNullable<ScriptGateway["getEpisodeScriptWriteOperation"]>>()
      .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
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
          version_number: (payload.expected_revision ?? 0) + 1,
          head_revision: (payload.expected_revision ?? 0) + 1,
          parent_version_id: payload.parent_version_id,
          change_summary: payload.change_summary,
        };
        saved.content_hash = contentHash(payload.content);
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
    getEpisodeScriptConfirmationOperation: vi
      .fn<ConfirmationGateway["getEpisodeScriptConfirmationOperation"]>()
      .mockImplementation(async (project_id, episode_id, operation_id, payload) =>
        confirmation.confirmation
          ? {
              kind: "FOUND",
              receipt: {
                request_id: "original",
                data: {
                  project_id,
                  episode_id,
                  operation_id,
                  payload,
                  lookup: {
                    coverage: "UNCOVERED_LEGACY",
                    confirmation: confirmation.confirmation,
                    report: null,
                  },
                },
              },
            }
          : { kind: "REMOTE_UNKNOWN" },
      ),
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
            actor_id: "local-user",
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
  // The editor consumes these local script/source/confirmation methods. The
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
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operation);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    expect(api.getEpisodeScriptConfirmationOperation).toHaveBeenCalledTimes(1);
  });

  test("UNKNOWN save retains its original body after current-head read and failed original read", async () => {
    const api = setup();
    api.createEpisodeScriptVersion.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    mount();
    await ready();
    change("动作内容", "Unsaved");
    click("保存草稿版本");
    expect(await screen.findByText(/提交结果未知；已持久锁定原操作/)).toBeVisible();
    const raw = localStorage.getItem(`aivora.episode-script.pending.v1.${project}.${episode}`);
    click("舍弃草稿并读取");
    await screen.findByText(/已读取当前剧本；原提交仍未知/);
    expect(screen.queryByRole("button", { name: "结束未知记录" })).toBeNull();
    click("只读核对原保存操作");
    expect(await screen.findByText(/原保存仍无法归因/)).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿版本" })).toBeDisabled();
    expect(localStorage.getItem(`aivora.episode-script.pending.v1.${project}.${episode}`)).toBe(
      raw,
    );
    expect(api.createEpisodeScriptVersion).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("动作内容")).toBeDisabled();
  });

  test("reopened UNKNOWN requires original GET then an explicit current-head read before editing", async () => {
    const api = setup();
    const normalSave = api.createEpisodeScriptVersion.getMockImplementation()!;
    api.createEpisodeScriptVersion.mockImplementation(async (...args) => {
      await normalSave(...args);
      return { kind: "REMOTE_UNKNOWN" };
    });
    const view = mount();
    await ready();
    change("动作内容", "Full original changed body");
    click("保存草稿版本");
    await screen.findByText(/提交结果未知；已持久锁定原操作/);
    const key = `aivora.episode-script.pending.v1.${project}.${episode}`;
    const raw = localStorage.getItem(key)!;
    view.unmount();
    mount();
    await waitFor(() => expect(screen.getByLabelText("动作内容")).toBeDisabled());
    expect(localStorage.getItem(key)).toBe(raw);
    expect(api.createEpisodeScriptVersion).toHaveBeenCalledTimes(1);
    api.getEpisodeScriptWriteOperation.mockImplementation(async (p, e, id, payload) => {
      const found = await api.getEpisodeScriptVersion(p, e, `ver_${"7".repeat(32)}`);
      if (found.kind !== "FOUND") return { kind: "REMOTE_UNKNOWN" };
      return {
        kind: "FOUND",
        receipt: {
          request_id: operation,
          data: {
            operation_id: id,
            project_id: p,
            episode_id: e,
            idempotency_key_hash: contentHash({ value: id }),
            request_hash: contentHash({
              project_id: p,
              episode_id: e,
              actor_id: found.receipt.data.author_actor_id,
              payload,
            }),
            version: found.receipt.data,
          },
        },
      };
    });
    click("只读核对原保存操作");
    await screen.findByText(/原保存操作已核实为草稿版本 2/);
    expect(localStorage.getItem(key)).toBeNull();
    expect(screen.getByLabelText("动作内容")).toBeDisabled();
    expect(api.createEpisodeScriptVersion).toHaveBeenCalledTimes(1);
    click("重新读取");
    await screen.findByText("已读取当前分集剧本。");
    expect(screen.getByLabelText("动作内容")).toBeEnabled();
    expect(screen.getByLabelText("动作内容")).toHaveValue("Full original changed body");
  });

  test("A to B to A ignores a late original write read and retains A original body", async () => {
    const api = setup();
    api.createEpisodeScriptVersion.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    const view = mount();
    await ready();
    change("动作内容", "Original A body");
    click("保存草稿版本");
    await screen.findByText(/提交结果未知；已持久锁定原操作/);
    const key = `aivora.episode-script.pending.v1.${project}.${episode}`;
    const raw = localStorage.getItem(key)!;
    const pending = JSON.parse(raw) as { command: ScriptWriteCommand };
    const payload = pending.command.payload;
    const original: ScriptVersion = {
      ...script(),
      version_id: `ver_${"7".repeat(32)}`,
      version_number: 2,
      head_revision: 2,
      parent_version_id: payload.parent_version_id,
      content: payload.content,
      content_hash: contentHash(payload.content),
      change_summary: payload.change_summary,
    };
    let settle!: (
      value: Awaited<ReturnType<NonNullable<ScriptGateway["getEpisodeScriptWriteOperation"]>>>,
    ) => void;
    api.getEpisodeScriptWriteOperation.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    click("只读核对原保存操作");
    const otherProject = `prj_${"a".repeat(32)}`,
      otherEpisode = `ep_${"a".repeat(32)}`;
    api.getEpisodeScript.mockImplementation(async (p, e) => ({
      kind: "FOUND",
      receipt: {
        request_id: operation,
        data: {
          ...script(),
          project_id: p,
          episode_id: e,
          content: { ...script().content, project_id: p, episode_id: e },
        },
      },
    }));
    view.rerender(
      <EpisodeScriptEditor
        projectId={otherProject}
        episodeId={otherEpisode}
        briefVersionId={null}
      />,
    );
    await screen.findByDisplayValue("Original action");
    view.rerender(
      <EpisodeScriptEditor projectId={project} episodeId={episode} briefVersionId={brief} />,
    );
    await waitFor(() => expect(screen.getByLabelText("动作内容")).toBeDisabled());
    await act(async () =>
      settle({
        kind: "FOUND",
        receipt: {
          request_id: operation,
          data: {
            operation_id: operation,
            project_id: project,
            episode_id: episode,
            idempotency_key_hash: contentHash({ value: operation }),
            request_hash: contentHash({
              project_id: project,
              episode_id: episode,
              actor_id: "local-user",
              payload,
            }),
            version: original,
          },
        },
      }),
    );
    expect(localStorage.getItem(key)).toBe(raw);
    expect(screen.queryByText(/原保存操作已核实/)).toBeNull();
    expect(screen.getByRole("button", { name: "保存草稿版本" })).toBeDisabled();
    expect(api.createEpisodeScriptVersion).toHaveBeenCalledTimes(1);
  });

  test("UNKNOWN confirmation survives current-state GET and missing original-operation GET", async () => {
    const api = setup();
    api.createEpisodeScriptConfirmation.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    mount();
    await ready();
    click("确认此剧本版本");
    expect(await screen.findByText(/确认结果未知；原操作已持久锁定/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "结束未知确认记录" })).toBeNull();
    click("只读核对确认状态");
    await screen.findByText(/已读取当前状态；原提交仍待完整身份核对/);
    click("只读核对原确认提交");
    expect(await screen.findByText(/原确认仍无法归因；未知锁定保留/)).toBeVisible();
    expect(screen.getByRole("button", { name: "确认此剧本版本" })).toBeDisabled();
    expect(localStorage.length).toBeGreaterThan(0);
    expect(api.createEpisodeScriptConfirmation).toHaveBeenCalledTimes(1);
  });

  test.each(["missing", "replacement"])(
    "owned UNKNOWN confirmation protects navigation after %s storage",
    async (mutation) => {
      const api = setup();
      api.createEpisodeScriptConfirmation.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
      const setter = vi.fn<(guard: (() => boolean) | null) => void>();
      render(
        <EpisodeScriptEditor
          projectId={project}
          episodeId={episode}
          briefVersionId={brief}
          setNavigationGuard={setter}
        />,
      );
      await ready();
      click("确认此剧本版本");
      await screen.findByText(/确认结果未知；原操作已持久锁定/);
      const key = `aivora.episode-script.confirmation.pending.v1.${project}.${episode}`;
      const original = JSON.parse(localStorage.getItem(key)!);
      if (mutation === "missing") localStorage.removeItem(key);
      else
        localStorage.setItem(
          key,
          JSON.stringify({
            ...original,
            payload: { ...original.payload, expected_head_revision: 99 },
          }),
        );
      const guard = setter.mock.calls.at(-1)?.[0];
      let allowed: boolean | undefined;
      act(() => {
        allowed = guard?.();
      });
      expect(allowed).toBe(mutation === "missing");
      expect(JSON.parse(localStorage.getItem(key)!).payload.expected_head_revision).toBe(
        mutation === "missing" ? 1 : 99,
      );
      expect(screen.getByRole("button", { name: "确认此剧本版本" })).toBeDisabled();
      expect(api.createEpisodeScriptConfirmation).toHaveBeenCalledTimes(1);
    },
  );

  test.each([403, 409, 422])("save rejection %s never announces success", async (status) => {
    const api = setup();
    api.createEpisodeScriptVersion.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status,
      code:
        status === 403
          ? "SIDECAR_REQUEST_REJECTED"
          : status === 409
            ? "SCRIPT_CONFLICT"
            : "SCRIPT_INPUT_REJECTED",
      request_id: operation,
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
      code: "SCRIPT_CONFIRMATION_CONFLICT",
      request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
    expect(await screen.findByText(/草稿版本 1 已保存并精确读回/)).toBeVisible();
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
  test("whole-episode readthrough edits two scenes in one draft, saves and reopens the same version", async () => {
    const original = twoSceneScript();
    const api = setup(original);
    const mounted = mount();
    await ready();
    click("全分集读本");
    const first = screen.getByRole("region", { name: "读本场次 1 · Original scene" });
    const second = screen.getByRole("region", { name: "读本场次 2 · Second scene" });
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(within(first).getByLabelText("动作内容"), {
      target: { value: "First readthrough edit" },
    });
    fireEvent.change(within(second).getByLabelText("对白内容"), {
      target: { value: "Second readthrough edit" },
    });
    fireEvent.click(within(second).getByRole("button", { name: "编辑此场次" }));
    expect(screen.getByLabelText("场次标题")).toHaveValue("Second scene");
    expect(screen.getByLabelText("对白内容")).toHaveValue("Second readthrough edit");
    click("全分集读本");
    expect(
      within(screen.getByRole("region", { name: "读本场次 1 · Original scene" })).getByLabelText(
        "动作内容",
      ),
    ).toHaveValue("First readthrough edit");
    expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
    expect(api.createEpisodeScriptConfirmation).not.toHaveBeenCalled();
    click("保存草稿版本");
    await screen.findByText(/草稿版本 2 已保存并精确读回/);
    const command = api.createEpisodeScriptVersion.mock.calls[0]?.[3];
    expect(command).toMatchObject({ parent_version_id: original.version_id, expected_revision: 1 });
    expect(command?.content.scenes.map((scene) => scene.scene_id)).toEqual(
      original.content.scenes.map((scene) => scene.scene_id),
    );
    expect(command?.content.scenes[1]?.blocks[0]).toEqual({
      ...original.content.scenes[1]!.blocks[0],
      text: "Second readthrough edit",
    });
    mounted.unmount();
    mount();
    await ready();
    click("全分集读本");
    expect(
      within(screen.getByRole("region", { name: "读本场次 2 · Second scene" })).getByLabelText(
        "对白内容",
      ),
    ).toHaveValue("Second readthrough edit");
    expect(api.createEpisodeScriptVersion).toHaveBeenCalledTimes(1);
  });

  test("readthrough reorder and deletion affect only the exact scene and preserve other identities", async () => {
    const original = twoSceneScript();
    const api = setup(original);
    mount();
    await ready();
    click("全分集读本");
    const second = screen.getByRole("region", { name: "读本场次 2 · Second scene" });
    fireEvent.click(within(second).getAllByRole("button", { name: "上移此段" })[1]!);
    fireEvent.click(within(second).getAllByRole("button", { name: "删除此段" })[1]!);
    click("保存草稿版本");
    await screen.findByText(/草稿版本 2 已保存并精确读回/);
    const saved = api.createEpisodeScriptVersion.mock.calls[0]?.[3].content;
    expect(saved?.scenes[0]).toEqual(original.content.scenes[0]);
    expect(saved?.scenes[1]?.blocks).toEqual([
      { ...original.content.scenes[1]!.blocks[1], ordinal: 1 },
    ]);
  });

  test("readthrough navigation keeps unsaved edits and resets its view on another episode", async () => {
    const api = setup(twoSceneScript());
    const setter = vi.fn();
    const mounted = render(
      <EpisodeScriptEditor
        projectId={project}
        episodeId={episode}
        briefVersionId={brief}
        setNavigationGuard={setter}
      />,
    );
    await ready();
    click("全分集读本");
    const second = screen.getByRole("region", { name: "读本场次 2 · Second scene" });
    fireEvent.change(within(second).getByLabelText("对白内容"), {
      target: { value: "Unsaved readthrough" },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(setter.mock.calls.at(-1)?.[0]?.()).toBe(false);
    expect(confirm).toHaveBeenCalled();
    expect(within(second).getByLabelText("对白内容")).toHaveValue("Unsaved readthrough");
    expect(api.createEpisodeScriptVersion).not.toHaveBeenCalled();
    api.getEpisodeScript.mockResolvedValue({ kind: "EMPTY" });
    mounted.rerender(
      <EpisodeScriptEditor
        projectId={project}
        episodeId={`ep_${"f".repeat(32)}`}
        briefVersionId={brief}
        setNavigationGuard={setter}
      />,
    );
    await screen.findByText("此剧集还没有场次。从添加场次开始。");
    expect(screen.queryByRole("region", { name: "全分集读本编辑" })).toBeNull();
    expect(screen.getByRole("button", { name: "全分集读本" })).toBeDisabled();
    expect(screen.queryByDisplayValue("Unsaved readthrough")).toBeNull();
  });

  test("readthrough view changes do not release or replay an UNKNOWN write journal", async () => {
    const api = setup(twoSceneScript());
    api.createEpisodeScriptVersion.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    mount();
    await ready();
    click("全分集读本");
    fireEvent.change(
      within(screen.getByRole("region", { name: "读本场次 2 · Second scene" })).getByLabelText(
        "对白内容",
      ),
      { target: { value: "Unknown readthrough edit" } },
    );
    click("保存草稿版本");
    await screen.findByText(/提交结果未知；已持久锁定原操作/);
    const before = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index)!,
    ).map((key) => [key, localStorage.getItem(key)]);
    click("场次编辑");
    click("全分集读本");
    expect(
      within(screen.getByRole("region", { name: "读本场次 2 · Second scene" })).getByLabelText(
        "对白内容",
      ),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存草稿版本" })).toBeDisabled();
    expect(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).map(
        (key) => [key, localStorage.getItem(key)],
      ),
    ).toEqual(before);
    expect(api.createEpisodeScriptVersion).toHaveBeenCalledTimes(1);
    expect(api.createEpisodeScriptConfirmation).not.toHaveBeenCalled();
  });
});
