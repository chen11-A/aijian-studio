import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EpisodeCapability, EpisodeResponse, StudioTransport } from "../api/studio";
import { createAivoraSampleFixture, DemoProvider, useDemo } from "./model";
import {
  readWorkspaceSelection,
  WORKSPACE_SELECTION_STORAGE_KEY,
} from "./adapters/workspaceSelection";

const projectId = `prj_${"1".repeat(32)}`;
const episodeId = `ep_${"2".repeat(32)}`;
const receipt: EpisodeResponse = {
  request_id: "episode",
  data: {
    id: episodeId,
    project_id: projectId,
    title: "Read-back episode",
    position: "1",
    revision: "1",
    target_duration_seconds: null,
    is_default: true,
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
  },
};
let transport: Partial<StudioTransport>;
vi.mock("../api/studio", () => ({ createStudioTransport: () => transport }));
function gateway() {
  const episodes = {
    list: vi
      .fn<EpisodeCapability["list"]>()
      .mockResolvedValue({ data: [receipt.data], request_id: "list" }),
    get: vi.fn<EpisodeCapability["get"]>().mockResolvedValue(receipt),
    create: vi.fn<EpisodeCapability["create"]>().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
  };
  transport.episodes = episodes;
  return episodes;
}
function mount(withProject = true) {
  const fixture = createAivoraSampleFixture();
  fixture.projects = withProject ? [{ ...fixture.projects[0]!, id: 1, backendId: projectId }] : [];
  fixture.values.projectId = "1";
  return renderHook(useDemo, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <DemoProvider fixture={fixture}>{children}</DemoProvider>
    ),
  });
}
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "#projects");
  transport = {
    listProjects: vi.fn<StudioTransport["listProjects"]>(() => new Promise(() => {})),
    listProviderConnections: vi.fn().mockResolvedValue({ data: [] }),
    listProjectTasks: vi.fn().mockResolvedValue({ data: [] }),
    listInvalidationOperations: vi.fn().mockResolvedValue({ data: [], next_cursor: null }),
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("model episode authority and recovery", () => {
  test.each(["list", "get"] as const)(
    "%s failures retain an unselected error state",
    async (method) => {
      const api = gateway();
      api[method].mockRejectedValue(new Error("offline"));
      const { result } = mount();
      await act(async () => result.current.refreshRealEpisodes());
      expect(result.current.episodeState).toBe("error");
      expect(result.current.selectedEpisodeId).toBeNull();
      expect(result.current.value("episode")).toBe("");
      expect(api.create).not.toHaveBeenCalled();
    },
  );
  test("missing capability cannot create, list or read an episode", async () => {
    const { result } = mount();
    await act(async () => result.current.refreshRealEpisodes());
    expect(result.current.episodeState).toBe("unavailable");
    await act(async () => {
      expect(await result.current.selectRealEpisode(episodeId, projectId, true)).toBe(false);
      expect(await result.current.createRealEpisode({ title: "New" })).toEqual({
        kind: "UNAVAILABLE",
      });
    });
    expect(result.current.episodeCreateMarker).toBeNull();
  });
  test("no active project means no episode network operations", async () => {
    const api = gateway();
    const { result } = mount(false);
    await act(async () => {
      await result.current.refreshRealEpisodes();
      await result.current.refreshProductionBrief();
      await result.current.refreshRealSourceStage();
      await result.current.readRealStoryWorkspace();
      expect(await result.current.selectRealEpisode(episodeId)).toBe(false);
      expect(await result.current.createRealEpisode({ title: "New" })).toEqual({
        kind: "UNAVAILABLE",
      });
    });
    expect(result.current.episodeState).toBe("idle");
    expect(result.current.episodes).toEqual([]);
    expect(result.current.productionBriefState).toBe("empty");
    expect(result.current.sourceStage.kind).toBe("empty");
    expect(api.list).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });
  test("definitive rejection clears the marker without selecting an episode", async () => {
    const api = gateway();
    api.create.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "EPISODE_CREATE_CONFLICT",
      request_id: "conflict",
    });
    const { result } = mount();
    await act(async () => {
      expect(await result.current.createRealEpisode({ title: "New" })).toMatchObject({
        kind: "DEFINITE_SERVER_ERROR",
      });
    });
    expect(result.current.episodeCreateMarker).toBeNull();
    expect(result.current.selectedEpisodeId).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });
  test("pending creation is serialized and a refresh during POST cannot acknowledge it", async () => {
    const api = gateway();
    let finish!: (value: Awaited<ReturnType<EpisodeCapability["create"]>>) => void;
    api.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = mount();
    let pending!: ReturnType<typeof result.current.createRealEpisode>;
    act(() => {
      pending = result.current.createRealEpisode({ title: "New" });
    });
    expect(result.current.episodeCreateInFlight).toBe(true);
    expect(result.current.episodeCreateMarker).toBe("PENDING");
    await act(async () => {
      expect(await result.current.createRealEpisode({ title: "Duplicate" })).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
      await result.current.refreshRealEpisodes();
    });
    expect(result.current.episodeAcknowledgementReady).toBe(false);
    act(() => result.current.acknowledgeEpisodeCreation());
    expect(result.current.episodeCreateMarker).toBe("PENDING");
    await act(async () => {
      finish({ kind: "REMOTE_UNKNOWN" });
      await pending;
    });
    expect(result.current.episodeCreateInFlight).toBe(false);
    expect(result.current.episodeCreateMarker).toBe("UNKNOWN");
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  test("a newer list read invalidates a late detail response", async () => {
    const api = gateway();
    let finish!: (value: EpisodeResponse) => void;
    api.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = mount();
    let pending!: ReturnType<typeof result.current.selectRealEpisode>;
    act(() => {
      pending = result.current.selectRealEpisode(episodeId, projectId, true);
    });
    api.list.mockResolvedValue({ data: [], request_id: "empty" });
    await act(async () => result.current.refreshRealEpisodes());
    await act(async () => {
      finish(receipt);
      expect(await pending).toBe(false);
    });
    expect(result.current.episodes).toEqual([]);
    expect(result.current.selectedEpisodeId).toBeNull();
    expect(result.current.value("episode")).toBe("");
  });
  test("unlisted episodes and a dirty editor guard block selection and creation", async () => {
    const api = gateway();
    api.list.mockResolvedValue({
      data: [{ ...receipt.data, is_default: false }],
      request_id: "list",
    });
    const { result } = mount();
    await act(async () => result.current.refreshRealEpisodes());
    await act(async () => {
      expect(await result.current.selectRealEpisode("unlisted")).toBe(false);
    });
    act(() => result.current.setNavigationGuard(() => false));
    await act(async () => {
      expect(await result.current.selectRealEpisode(episodeId)).toBe(false);
      expect(await result.current.createRealEpisode({ title: "New" })).toEqual({
        kind: "UNAVAILABLE",
      });
    });
    expect(api.get).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });
  test("storage write failure prevents the first POST", async () => {
    const api = gateway();
    const { result } = mount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await act(async () => {
      expect(await result.current.createRealEpisode({ title: "New" })).toEqual({
        kind: "UNAVAILABLE",
      });
    });
    expect(result.current.episodeState).toBe("storage-error");
    expect(api.create).not.toHaveBeenCalled();
  });
  test("reads the default episode before persisting its opaque selection", async () => {
    const api = gateway();
    const { result } = mount();
    await act(async () => result.current.refreshRealEpisodes());
    expect(api.get).toHaveBeenCalledExactlyOnceWith(projectId, episodeId);
    expect(result.current.selectedEpisodeId).toBe(episodeId);
    expect(result.current.value("episode")).toBe(receipt.data.title);
    expect(result.current.episodeState).toBe("ready");
    expect(readWorkspaceSelection(localStorage)).toMatchObject({
      snapshot: { selection: { projectId, episodeId } },
    });
  });
  test("blocks a second POST after UNKNOWN until explicit refresh and acknowledgement", async () => {
    const api = gateway();
    const { result } = mount();
    await act(async () => {
      expect(await result.current.createRealEpisode({ title: "New" })).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
    });
    expect(result.current.episodeCreateMarker).toBe("UNKNOWN");
    act(() => result.current.acknowledgeEpisodeCreation());
    await act(async () => {
      await result.current.createRealEpisode({ title: "New" });
    });
    expect(api.create).toHaveBeenCalledTimes(1);
    await act(async () => result.current.refreshRealEpisodes());
    expect(result.current.episodeAcknowledgementReady).toBe(true);
    act(() => result.current.acknowledgeEpisodeCreation());
    expect(result.current.episodeCreateMarker).toBeNull();
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  test("successful creation selects the authoritative GET instead of trusting the POST title", async () => {
    const api = gateway();
    api.create.mockResolvedValue({
      kind: "SUCCEEDED",
      receipt: { ...receipt, data: { ...receipt.data, title: "POST title" } },
    });
    const { result } = mount();
    await act(async () => {
      await result.current.createRealEpisode({ title: "New" });
    });
    expect(result.current.value("episode")).toBe("Read-back episode");
    expect(result.current.episodeCreateMarker).toBeNull();
    expect(result.current.episodes).toHaveLength(1);
    expect(api.get).toHaveBeenCalledExactlyOnceWith(projectId, episodeId);
  });
  test("corrupt recovery storage prevents creation and refresh without network activity", async () => {
    localStorage.setItem(WORKSPACE_SELECTION_STORAGE_KEY, "not-json");
    const api = gateway();
    const { result } = mount();
    await act(async () => {
      await result.current.refreshRealEpisodes();
      expect(await result.current.createRealEpisode({ title: "New" })).toEqual({
        kind: "UNAVAILABLE",
      });
    });
    expect(result.current.episodeState).toBe("storage-error");
    expect(api.list).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });
});
