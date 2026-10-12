import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  newStoryboardShot,
  type StoryboardGateway,
  type StoryboardVersion,
} from "./adapters/episodeStoryboard";
import { useEpisodeStoryboard } from "./useEpisodeStoryboard";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const guard = vi.fn<(value: (() => boolean) | null) => void>();
function gateway() {
  return {
    getEpisodeStoryboard: vi
      .fn<StoryboardGateway["getEpisodeStoryboard"]>()
      .mockResolvedValue({ kind: "EMPTY" }),
    getEpisodeStoryboardVersion: vi
      .fn<StoryboardGateway["getEpisodeStoryboardVersion"]>()
      .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    createEpisodeStoryboardVersion: vi
      .fn<StoryboardGateway["createEpisodeStoryboardVersion"]>()
      .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
  };
}
let api = gateway();
let available = true;
vi.mock("../api/studio", () => ({ createStudioTransport: () => (available ? api : {}) }));
beforeEach(() => {
  api = gateway();
  available = true;
  localStorage.clear();
  guard.mockReset();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
const leave = () => guard.mock.calls.at(-1)?.[0]?.();
const mount = (p: string | null = project, e: string | null = episode) =>
  renderHook(() => useEpisodeStoryboard(p, e, guard));
async function ready() {
  const mounted = mount();
  await waitFor(() => expect(mounted.result.current.readState).toBe("empty"));
  return mounted;
}
function dirty(result: { current: ReturnType<typeof useEpisodeStoryboard> }) {
  act(() => result.current.edit((value) => ({ ...value, fps: 30 })));
}
describe("episode storyboard hook retains drafts at failed boundaries", () => {
  test("V2 choice input survives UNKNOWN reopening and only explicitly checks the same operation", async () => {
    const first = await ready();
    const chr = `chr_${"c".repeat(32)}`;
    act(() =>
      first.result.current.edit((current) => ({
        ...current,
        schema_version: "1.1.0",
        creative_library_version_id: `ver_${"d".repeat(32)}`,
        shots: [
          {
            ...newStoryboardShot(1, 24)!,
            character_ids: [chr],
            character_bindings: [
              {
                character_id: chr,
                costume_id: `cst_${"e".repeat(32)}`,
                reference_ids: [`crf_${"f".repeat(32)}`],
              },
            ],
          },
        ],
      })),
    );
    await act(async () => {
      expect(await first.result.current.save()).toBe(false);
    });
    const original = api.createEpisodeStoryboardVersion.mock.calls[0]!;
    first.unmount();
    const reopened = await ready();
    expect(reopened.result.current.content).toEqual(original[3].content);
    expect(reopened.result.current.locked).toBe(true);
    expect(api.createEpisodeStoryboardVersion).toHaveBeenCalledTimes(1);
    const saved: StoryboardVersion = {
      version_id: `ver_${"1".repeat(32)}`,
      project_id: project,
      episode_id: episode,
      version_number: 1,
      head_revision: 1,
      parent_version_id: null,
      content: original[3].content,
      content_hash: `sha256:${"2".repeat(64)}`,
      author_actor_id: "human",
      change_summary: original[3].change_summary,
      created_at: "2026-10-11T00:00:00Z",
    };
    api.createEpisodeStoryboardVersion.mockResolvedValueOnce({
      kind: "CREATED",
      receipt: { data: { version: saved, replayed: false }, request_id: "check" },
    });
    api.getEpisodeStoryboardVersion.mockResolvedValueOnce({
      kind: "FOUND",
      receipt: { data: saved, request_id: "check" },
    });
    await act(async () => {
      expect(await reopened.result.current.save(true)).toBe(true);
    });
    expect(api.createEpisodeStoryboardVersion.mock.calls[1]).toEqual(original);
    expect(reopened.result.current.content.schema_version).toBe("1.1.0");
  });
  test.each([null, "malformed"])("invalid project %s cannot read or save", async (scope) => {
    const { result } = mount(scope);
    expect(result.current.readState).toBe("error");
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(api.getEpisodeStoryboard).not.toHaveBeenCalled();
  });
  test.each([null, "malformed"])("invalid episode %s cannot read or save", async (scope) => {
    const { result } = mount(project, scope);
    expect(result.current.locked).toBe(true);
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(api.getEpisodeStoryboard).not.toHaveBeenCalled();
  });
  test("missing capability locks the editor", () => {
    available = false;
    const { result } = mount();
    expect(result.current.notice).toContain("未连接分镜接口");
    expect(result.current.locked).toBe(true);
  });
  test.each([403, 404])("read rejection %s locks editing", async (status) => {
    api.getEpisodeStoryboard.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status,
      code: "REJECTED",
      request_id: "read",
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.readState).toBe("error"));
    expect(result.current.notice).toContain("读取被拒绝");
    expect(result.current.locked).toBe(true);
  });
  test("failed read after explicit reload keeps the local draft", async () => {
    const { result } = await ready();
    dirty(result);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.getEpisodeStoryboard.mockRejectedValue(new Error("offline"));
    await act(async () => result.current.reload());
    expect(result.current.readState).toBe("error");
    expect(result.current.content.fps).toBe(30);
    expect(result.current.notice).toContain("读取结果未知");
  });
  test("UNKNOWN retains recovery and blocks another fresh command", async () => {
    const { result } = await ready();
    dirty(result);
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.canRecover).toBe(true);
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(api.createEpisodeStoryboardVersion).toHaveBeenCalledTimes(1);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => {
      expect(leave()).toBe(true);
    });
    expect(confirm).toHaveBeenCalledWith("这次保存的结果还待核对，恢复记录已保留。离开此页吗？");
    expect(result.current.journal.kind).toBe("PENDING");
  });
  test("inaccessible journal blocks editing even after a successful read", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = await ready();
    expect(result.current.notice).toContain("本地恢复记录无法读取");
    expect(result.current.journal.kind).toBe("BLOCKED");
    expect(result.current.locked).toBe(true);
  });
  test("dirty navigation and reload require approval, and unloading warns", async () => {
    const { result } = await ready();
    expect(leave()).toBe(true);
    dirty(result);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => {
      expect(leave()).toBe(false);
    });
    await act(async () => result.current.reload());
    expect(api.getEpisodeStoryboard).toHaveBeenCalledTimes(1);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true);
    act(() => {
      expect(leave()).toBe(true);
    });
    expect(result.current.content.fps).toBe(24);
    expect(result.current.dirty).toBe(false);
  });
  test("busy read blocks navigation, edits, writes and another reload", async () => {
    let finish!: (value: { kind: "EMPTY" }) => void;
    api.getEpisodeStoryboard.mockImplementation(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const { result } = mount();
    act(() => {
      expect(leave()).toBe(false);
    });
    dirty(result);
    expect(result.current.content.fps).toBe(24);
    await act(async () => {
      await result.current.reload();
      expect(await result.current.save()).toBe(false);
    });
    expect(api.getEpisodeStoryboard).toHaveBeenCalledTimes(1);
    await act(async () => finish({ kind: "EMPTY" }));
    expect(result.current.busy).toBe(false);
  });
  test.each([409, 428, 422])("save rejection %s retains a draft", async (status) => {
    const { result } = await ready();
    dirty(result);
    api.createEpisodeStoryboardVersion.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status,
      code: "REJECTED",
      request_id: "write",
    });
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.content.fps).toBe(30);
    expect(result.current.locked).toBe(status !== 422);
    expect(result.current.notice).toContain(status === 422 ? "保存被拒绝" : "已有更新");
  });
  test("missing recovery command cannot create a new version", async () => {
    const { result } = await ready();
    await act(async () => {
      expect(await result.current.save(true)).toBe(false);
    });
    expect(result.current.notice).toContain("原提交恢复记录不可用");
    expect(api.createEpisodeStoryboardVersion).not.toHaveBeenCalled();
  });
  test("invalid frame rate and UUID failure each stop before POST", async () => {
    const { result } = await ready();
    act(() => result.current.edit((value) => ({ ...value, fps: 0 })));
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.notice).toContain("帧率为 1 至 120");
    dirty(result);
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("unavailable");
    });
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.notice).toContain("无法生成可靠的保存标识");
    expect(api.createEpisodeStoryboardVersion).not.toHaveBeenCalled();
  });
});
