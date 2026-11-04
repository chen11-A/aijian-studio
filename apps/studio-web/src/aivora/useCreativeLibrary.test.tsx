import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CreativeGateway } from "./adapters/creativeLibrary";
import { useCreativeLibrary } from "./useCreativeLibrary";

const project = `prj_${"a".repeat(32)}`;
const guard = vi.fn<(value: (() => boolean) | null) => void>();
function gateway() {
  return {
    getProjectCreativeLibrary: vi
      .fn<CreativeGateway["getProjectCreativeLibrary"]>()
      .mockResolvedValue({ kind: "EMPTY" }),
    getProjectCreativeLibraryVersion: vi
      .fn<CreativeGateway["getProjectCreativeLibraryVersion"]>()
      .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    createProjectCreativeLibraryVersion: vi
      .fn<CreativeGateway["createProjectCreativeLibraryVersion"]>()
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
const mount = (id: string | null = project) => renderHook(() => useCreativeLibrary(id, guard));
async function ready() {
  const mounted = mount();
  await waitFor(() => expect(mounted.result.current.readState).toBe("empty"));
  return mounted;
}
function dirty(result: { current: ReturnType<typeof useCreativeLibrary> }) {
  act(() =>
    result.current.edit((value) => ({ ...value, world: { ...value.world, premise: "Unsaved" } })),
  );
}
describe("shared creative library hook recovery and navigation", () => {
  test.each([409, 428, 422])(
    "save rejection %s retains content and conflict locks until reload",
    async (status) => {
      const { result } = await ready();
      dirty(result);
      api.createProjectCreativeLibraryVersion.mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status,
        code: "REJECTED",
        request_id: "write",
      });
      await act(async () => {
        expect(await result.current.save()).toBe(false);
      });
      expect(result.current.content.world.premise).toBe("Unsaved");
      expect(result.current.dirty).toBe(true);
      expect(result.current.journal.kind).toBe("EMPTY");
      expect(result.current.locked).toBe(status !== 422);
      expect(result.current.notice).toContain(status === 422 ? "保存被拒绝" : "已有更新");
    },
  );
  test("UNKNOWN retains the original command and warns before leaving", async () => {
    const { result } = await ready();
    dirty(result);
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.canRecover).toBe(true);
    expect(result.current.journal.kind).toBe("PENDING");
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(api.createProjectCreativeLibraryVersion).toHaveBeenCalledTimes(1);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => {
      expect(leave()).toBe(true);
    });
    expect(confirm).toHaveBeenCalledWith("这次保存的结果还待核对，恢复记录已保留。离开此页吗？");
    expect(result.current.journal.kind).toBe("PENDING");
  });
  test("missing recovery command never becomes a new write", async () => {
    const { result } = await ready();
    await act(async () => {
      expect(await result.current.save(true)).toBe(false);
    });
    expect(result.current.notice).toContain("原提交恢复记录不可用");
    expect(api.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
  });
  test("UUID failure blocks saving before the transport", async () => {
    const { result } = await ready();
    dirty(result);
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("unavailable");
    });
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.notice).toContain("无法生成可靠的保存标识");
    expect(api.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
  });
  test("content validation prevents invalid world text from reaching transport", async () => {
    const { result } = await ready();
    act(() =>
      result.current.edit((value) => ({
        ...value,
        world: { ...value.world, premise: "x".repeat(20001) },
      })),
    );
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.notice).toContain("长文本最多 20000");
    expect(api.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
  });
  test("failed reload preserves the unsaved draft and exposes uncertainty", async () => {
    const { result } = await ready();
    dirty(result);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.getProjectCreativeLibrary.mockRejectedValue(new Error("offline"));
    await act(async () => result.current.reload());
    expect(result.current.readState).toBe("error");
    expect(result.current.content.world.premise).toBe("Unsaved");
    expect(result.current.notice).toContain("读取结果未知");
  });
  test("blocked storage journal is surfaced without overwriting it", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unreadable");
    });
    const { result } = await ready();
    expect(result.current.locked).toBe(true);
    expect(result.current.journal.kind).toBe("BLOCKED");
    expect(result.current.notice).toContain("本地恢复记录无法读取");
    expect(api.createProjectCreativeLibraryVersion).not.toHaveBeenCalled();
  });
  test("dirty reload and navigation require approval; confirmation discards only local edits", async () => {
    const { result } = await ready();
    expect(leave()).toBe(true);
    dirty(result);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => {
      expect(leave()).toBe(false);
    });
    await act(async () => result.current.reload());
    expect(api.getProjectCreativeLibrary).toHaveBeenCalledTimes(1);
    expect(result.current.content.world.premise).toBe("Unsaved");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true);
    act(() => {
      expect(leave()).toBe(true);
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.content.world.premise).toBe("");
  });
  test("busy read blocks navigation, edits and overlapping reloads", async () => {
    let resolve!: (value: { kind: "EMPTY" }) => void;
    api.getProjectCreativeLibrary.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result } = mount();
    act(() => {
      expect(leave()).toBe(false);
    });
    dirty(result);
    expect(result.current.dirty).toBe(false);
    await act(async () => {
      await result.current.reload();
      expect(await result.current.save()).toBe(false);
    });
    expect(api.getProjectCreativeLibrary).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ kind: "EMPTY" }));
    expect(result.current.busy).toBe(false);
  });
  test.each([401, 403, 404, 422])("read rejection %s locks edits", async (status) => {
    api.getProjectCreativeLibrary.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status,
      code: "REJECTED",
      request_id: "read",
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.readState).toBe("error"));
    expect(result.current.notice).toContain("读取被拒绝");
    expect(result.current.locked).toBe(true);
    dirty(result);
    expect(result.current.dirty).toBe(false);
  });
  test.each([null, "malformed"])("invalid scope %s never reaches the gateway", async (scope) => {
    const { result } = mount(scope);
    expect(result.current.readState).toBe("error");
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(api.getProjectCreativeLibrary).not.toHaveBeenCalled();
  });
  test("unavailable gateway stays locked", () => {
    available = false;
    const { result } = mount();
    expect(result.current.locked).toBe(true);
    expect(result.current.notice).toContain("未连接创作设定接口");
  });
});
