import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStudioTransport } from "../api/studio";
import { StoryboardReferences } from "./StoryboardReferences";
import { emptyCreativeContent, type CreativeVersion } from "./adapters/creativeLibrary";
import type { ScriptVersion } from "./adapters/episodeScript";
import type { StoryboardContent, StoryboardShot } from "./adapters/episodeStoryboard";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const sceneId = `scn_${"c".repeat(32)}`;
const characterId = `chr_${"d".repeat(32)}`;
const locationId = `loc_${"e".repeat(32)}`;
const found = <T,>(data: T) => ({ kind: "FOUND" as const, receipt: { data, request_id: "read" } });
function scriptVersion(revision = 1): ScriptVersion {
  return {
    version_id: `ver_${revision.toString().repeat(32)}`,
    version_number: revision,
    head_revision: revision,
    project_id: project,
    episode_id: episode,
    parent_version_id: revision === 1 ? null : `ver_${"1".repeat(32)}`,
    content_hash: `sha256:${"a".repeat(64)}`,
    created_at: "2026-10-08T04:00:00Z",
    author_actor_id: "local-user",
    change_summary: "剧本修改",
    content: {
      schema_version: "1.0.0",
      project_id: project,
      episode_id: episode,
      scenes: [{ scene_id: sceneId, ordinal: 1, heading: "桥边 / 夜", blocks: [] }],
    },
  };
}
function libraryVersion(revision = 1): CreativeVersion {
  const content = emptyCreativeContent(project);
  content.characters = [
    {
      character_id: characterId,
      ordinal: 1,
      name: "沈遥",
      role: "",
      description: "",
      appearance: "",
      personality: "",
    },
  ];
  content.scenes = [
    {
      scene_id: locationId,
      ordinal: 1,
      name: "旧桥",
      description: "",
      location: "",
      time_of_day: "",
      weather: "",
      continuity: "",
    },
  ];
  return {
    ...scriptVersion(revision),
    version_id: `ver_${(revision + 5).toString().repeat(32)}`,
    episode_id: null,
    content,
  };
}
function shot(ordinal = 1): StoryboardShot {
  return {
    shot_id: `shp_${ordinal.toString().repeat(32)}`,
    ordinal,
    title: `镜头 ${ordinal}`,
    duration_frames: 48,
    description: "保留画面",
    camera: "远景",
    action: "走近",
    dialogue: "你好",
    script_scene_id: sceneId,
    character_ids: [characterId],
    location_id: locationId,
  };
}
function storyboard(): StoryboardContent {
  return {
    schema_version: "1.0.0",
    project_id: project,
    episode_id: episode,
    fps: 24,
    script_version_id: scriptVersion().version_id,
    creative_library_version_id: libraryVersion().version_id,
    shots: [shot(), shot(2)],
  };
}
function makeSources() {
  return {
    getEpisodeScript: vi.fn().mockResolvedValue(found(scriptVersion(2))),
    getEpisodeScriptVersion: vi.fn(async (_p: string, _e: string, id: string) =>
      found(scriptVersion(id === scriptVersion().version_id ? 1 : 2)),
    ),
    getProjectCreativeLibrary: vi.fn().mockResolvedValue(found(libraryVersion(2))),
    getProjectCreativeLibraryVersion: vi.fn(async (_p: string, id: string) =>
      found(libraryVersion(id === libraryVersion().version_id ? 1 : 2)),
    ),
  };
}
let sources: ReturnType<typeof makeSources>;
function Harness({
  initial = storyboard(),
  locked = false,
}: {
  initial?: StoryboardContent;
  locked?: boolean;
}) {
  const [content, setContent] = useState(initial);
  const [selected, setSelected] = useState(0);
  const currentShot = content.shots[selected]!;
  return (
    <>
      <button onClick={() => setSelected(1)}>选择第二镜头</button>
      <StoryboardReferences
        content={content}
        shot={currentShot}
        locked={locked}
        edit={setContent}
        updateShot={(patch) =>
          setContent((value) => ({
            ...value,
            shots: value.shots.map((item) =>
              item.shot_id === currentShot.shot_id ? { ...item, ...patch } : item,
            ),
          }))
        }
      />
      <output aria-label="分镜状态">{JSON.stringify(content)}</output>
    </>
  );
}
const state = (): StoryboardContent =>
  JSON.parse(screen.getByLabelText("分镜状态").textContent ?? "{}");
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
async function inspect(kind: "script" | "library") {
  const name = kind === "script" ? "检查最新剧本版本" : "检查最新设定版本";
  await waitFor(() => expect(screen.getByRole("button", { name })).toBeEnabled());
  click(name);
  return screen.findByRole("region", {
    name: kind === "script" ? "剧本版本升级影响" : "设定版本升级影响",
  });
}
beforeEach(() => {
  sources = makeSources();
  vi.mocked(createStudioTransport).mockReturnValue(
    sources as unknown as ReturnType<typeof createStudioTransport>,
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("safe storyboard upstream version inspection", () => {
  it("inspects a new script without changing its exact pin, upgrades explicitly and preserves every shot", async () => {
    const initial = storyboard();
    const latest = scriptVersion(2);
    latest.content.scenes[0]!.heading = "桥边 / 清晨";
    sources.getEpisodeScript.mockResolvedValue(found(latest));
    render(<Harness initial={initial} />);
    await screen.findByDisplayValue("1. 桥边 / 夜");
    expect(sources.getEpisodeScript).not.toHaveBeenCalled();
    click("刷新可选版本");
    await waitFor(() => expect(sources.getEpisodeScriptVersion).toHaveBeenCalledTimes(2));
    expect(state()).toEqual(initial);
    const impact = await inspect("script");
    expect(await within(impact).findByText(/引用内容变化：2 个镜头/)).toBeInTheDocument();
    expect(state()).toEqual(initial);
    expect(screen.getByRole("button", { name: "解除剧本关联" })).toBeDisabled();
    click("将剧本引用升级到 v2");
    await waitFor(() => expect(state().script_version_id).toBe(latest.version_id));
    expect(state().shots).toEqual(initial.shots);
    expect(state().creative_library_version_id).toBe(initial.creative_library_version_id);
    expect(screen.getByText(/升级仅修改当前分镜草稿的版本引用/)).toBeInTheDocument();
    expect(screen.getByText(/不代表媒体已生成或审片已批准/)).toBeInTheDocument();
  });

  it("checks all shots and blocks a script upgrade when a scene is missing until individual references are removed", async () => {
    const initial = storyboard();
    initial.shots[0]!.script_scene_id = null;
    const latest = scriptVersion(2);
    latest.content.scenes = [];
    sources.getEpisodeScript.mockResolvedValue(found(latest));
    render(<Harness initial={initial} />);
    const impact = await inspect("script");
    expect(await within(impact).findByText(/镜头 2.*场次.*scn_/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "将剧本引用升级到 v2" })).toBeDisabled();
    expect(state()).toEqual(initial);
    click("选择第二镜头");
    fireEvent.change(screen.getByLabelText("对应剧本场次"), { target: { value: "" } });
    expect(state().script_version_id).toBe(initial.script_version_id);
    expect(screen.getByRole("button", { name: "将剧本引用升级到 v2" })).toBeEnabled();
    click("将剧本引用升级到 v2");
    await waitFor(() => expect(state().script_version_id).toBe(latest.version_id));
    expect(state().shots.every((item) => item.script_scene_id === null)).toBe(true);
    expect(state().shots.map((item) => item.character_ids)).toEqual(
      initial.shots.map((item) => item.character_ids),
    );
  });

  it("reports missing characters and locations independently and retains the old library on cancel", async () => {
    const latest = libraryVersion(2);
    latest.content.characters = [];
    latest.content.scenes = [];
    sources.getProjectCreativeLibrary.mockResolvedValue(found(latest));
    render(<Harness />);
    const impact = await inspect("library");
    expect(await within(impact).findAllByText(/角色.*chr_/)).toHaveLength(2);
    expect(within(impact).getAllByText(/地点.*loc_/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "将设定引用升级到 v2" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "解除设定关联" })).toBeDisabled();
    click("保留当前设定版本");
    expect(screen.queryByRole("region", { name: "设定版本升级影响" })).toBeNull();
    expect(state()).toEqual(storyboard());
    expect(screen.getByLabelText("沈遥")).toBeChecked();
  });

  it("compares library content and world changes, upgrades just the pin and retains the exact original references", async () => {
    const latest = libraryVersion(2);
    latest.content.characters[0]!.appearance = "蓝衣";
    latest.content.scenes[0]!.weather = "雨";
    latest.content.world = { ...latest.content.world, era: "未来" };
    sources.getProjectCreativeLibrary.mockResolvedValue(found(latest));
    render(<Harness />);
    const impact = await inspect("library");
    expect(await within(impact).findByText(/引用内容变化：2 个镜头/)).toBeInTheDocument();
    expect(within(impact).getByText(/世界设定也有变化/)).toBeInTheDocument();
    click("将设定引用升级到 v2");
    await waitFor(() => expect(state().creative_library_version_id).toBe(latest.version_id));
    expect(state().shots).toEqual(storyboard().shots);
    expect(state().script_version_id).toBe(storyboard().script_version_id);
  });

  it("allows unlink only with no remaining references and explicit confirmation, without clearing any shot data", async () => {
    const initial = storyboard();
    initial.shots = initial.shots.map((item) => ({
      ...item,
      script_scene_id: null,
      character_ids: [],
      location_id: null,
    }));
    render(<Harness initial={initial} />);
    await screen.findByDisplayValue("不关联场次");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    click("解除剧本关联");
    expect(state()).toEqual(initial);
    click("解除剧本关联");
    await waitFor(() => expect(state().script_version_id).toBeNull());
    click("解除设定关联");
    await waitFor(() => expect(state().creative_library_version_id).toBeNull());
    expect(state().shots).toEqual(initial.shots);
  });

  it.each([
    "UNKNOWN",
    "EMPTY",
    "invalid-scope",
    "invalid-body",
    "older",
    "same-number-new-id",
    "throw",
    "same-id-changed-content",
  ])(
    "retains the exact script pin after a %s latest response and supports a fresh retry",
    async (failure) => {
      const latest = scriptVersion(2);
      if (failure === "invalid-scope") latest.episode_id = `ep_${"f".repeat(32)}`;
      if (failure === "invalid-body") latest.content.scenes[0]!.scene_id = "invalid";
      if (failure === "older") latest.version_number = 1;
      if (failure === "same-number-new-id") latest.version_number = 1;
      if (failure === "same-id-changed-content") {
        Object.assign(latest, scriptVersion());
        latest.content.scenes[0]!.heading = "unexpected mutation";
      }
      if (failure === "throw") sources.getEpisodeScript.mockRejectedValueOnce(new Error("offline"));
      else
        sources.getEpisodeScript.mockResolvedValueOnce(
          failure === "UNKNOWN"
            ? { kind: "REMOTE_UNKNOWN" }
            : failure === "EMPTY"
              ? { kind: "EMPTY" }
              : found(latest),
        );
      render(<Harness />);
      const impact = await inspect("script");
      expect(await within(impact).findByText(/无法核对最新版本/)).toBeInTheDocument();
      expect(state()).toEqual(storyboard());
      expect(screen.queryByRole("button", { name: "将剧本引用升级到 v2" })).toBeNull();
      click("检查最新剧本版本");
      await screen.findByRole("button", { name: "将剧本引用升级到 v2" });
      expect(state()).toEqual(storyboard());
    },
  );

  it("reports an unchanged head without offering a fictitious upgrade", async () => {
    sources.getEpisodeScript.mockResolvedValue(found(scriptVersion()));
    render(<Harness />);
    const impact = await inspect("script");
    expect(await within(impact).findByText(/当前已固定检查时的最新版本/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /将剧本引用升级/ })).toBeNull();
    expect(state()).toEqual(storyboard());
  });

  it("cancels an in-flight check, ignores its late response and allows a newer check", async () => {
    let resolve!: (result: ReturnType<typeof found<ScriptVersion>>) => void;
    sources.getEpisodeScript.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<Harness />);
    await inspect("script");
    expect(screen.getByRole("button", { name: "检查最新剧本版本" })).toBeDisabled();
    click("保留当前剧本版本");
    await inspect("script");
    await screen.findByRole("button", { name: "将剧本引用升级到 v2" });
    const invalid = scriptVersion(3);
    invalid.content.scenes = [];
    await act(async () => resolve(found(invalid)));
    expect(screen.getByRole("button", { name: "将剧本引用升级到 v2" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "将剧本引用升级到 v3" })).toBeNull();
    expect(state()).toEqual(storyboard());
  });

  it("does not let an old episode's asynchronous inspection affect a new episode", async () => {
    let resolve!: (result: ReturnType<typeof found<ScriptVersion>>) => void;
    sources.getEpisodeScript.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const edit = vi.fn();
    const initial = storyboard();
    const view = render(
      <StoryboardReferences
        content={initial}
        shot={initial.shots[0]!}
        locked={false}
        edit={edit}
        updateShot={vi.fn()}
      />,
    );
    await inspect("script");
    const next = { ...initial, episode_id: `ep_${"f".repeat(32)}` };
    view.rerender(
      <StoryboardReferences
        content={next}
        shot={next.shots[0]!}
        locked={false}
        edit={edit}
        updateShot={vi.fn()}
      />,
    );
    await act(async () => resolve(found(scriptVersion(2))));
    expect(screen.queryByRole("region", { name: "剧本版本升级影响" })).toBeNull();
    expect(edit).not.toHaveBeenCalled();
  });

  it("disables all pin changes while locked, even after a candidate is inspected", async () => {
    const initial = storyboard();
    const edit = vi.fn();
    const view = render(
      <StoryboardReferences
        content={initial}
        shot={initial.shots[0]!}
        locked={false}
        edit={edit}
        updateShot={vi.fn()}
      />,
    );
    await inspect("script");
    await screen.findByRole("button", { name: "将剧本引用升级到 v2" });
    view.rerender(
      <StoryboardReferences
        content={initial}
        shot={initial.shots[0]!}
        locked
        edit={edit}
        updateShot={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "将剧本引用升级到 v2" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "检查最新剧本版本" })).toBeDisabled();
    expect(edit).not.toHaveBeenCalled();
  });

  it("requires individual character and location decisions before a blocked library can be upgraded", async () => {
    const latest = libraryVersion(2);
    latest.content.characters = [];
    latest.content.scenes = [];
    sources.getProjectCreativeLibrary.mockResolvedValue(found(latest));
    render(<Harness />);
    await inspect("library");
    const upgrade = await screen.findByRole("button", { name: "将设定引用升级到 v2" });
    expect(upgrade).toBeDisabled();
    fireEvent.click(screen.getByLabelText("沈遥"));
    fireEvent.change(screen.getByLabelText("镜头地点"), { target: { value: "" } });
    expect(upgrade).toBeDisabled();
    expect(state().creative_library_version_id).toBe(libraryVersion().version_id);
    click("选择第二镜头");
    fireEvent.click(screen.getByLabelText("沈遥"));
    expect(upgrade).toBeDisabled();
    fireEvent.change(screen.getByLabelText("镜头地点"), { target: { value: "" } });
    expect(upgrade).toBeEnabled();
    fireEvent.click(upgrade);
    await waitFor(() => expect(state().creative_library_version_id).toBe(latest.version_id));
    expect(state().shots).toEqual(
      storyboard().shots.map((item) => ({ ...item, character_ids: [], location_id: null })),
    );
  });

  it.each(["new-reference", "changed-pin", "changed-episode"])(
    "revalidates the live draft before applying an inspected pin when it has a %s",
    async (change) => {
      const initial = storyboard();
      const live = structuredClone(initial);
      if (change === "new-reference") live.shots[1]!.script_scene_id = `scn_${"f".repeat(32)}`;
      if (change === "changed-pin") live.script_version_id = scriptVersion(3).version_id;
      if (change === "changed-episode") live.episode_id = `ep_${"f".repeat(32)}`;
      let applied: StoryboardContent | null = null;
      const edit = vi.fn((update: (value: StoryboardContent) => StoryboardContent) => {
        applied = update(live);
      });
      render(
        <StoryboardReferences
          content={initial}
          shot={initial.shots[0]!}
          locked={false}
          edit={edit}
          updateShot={vi.fn()}
        />,
      );
      await inspect("script");
      await screen.findByRole("button", { name: "将剧本引用升级到 v2" });
      click("将剧本引用升级到 v2");
      expect(applied).toBe(live);
      expect(live.shots).toEqual(change === "new-reference" ? applied!.shots : initial.shots);
    },
  );

  it("rejects a library from another project and never substitutes it for the exact old pin", async () => {
    const latest = libraryVersion(2);
    latest.project_id = `prj_${"f".repeat(32)}`;
    sources.getProjectCreativeLibrary.mockResolvedValue(found(latest));
    render(<Harness />);
    const impact = await inspect("library");
    expect(await within(impact).findByText(/无法核对最新版本/)).toBeInTheDocument();
    expect(state()).toEqual(storyboard());
    expect(screen.getByLabelText("沈遥")).toBeChecked();
    expect(screen.queryByRole("button", { name: "将设定引用升级到 v2" })).toBeNull();
  });

  it("retains an unavailable exact pin and refuses an upgrade without a verifiable source", async () => {
    sources.getEpisodeScriptVersion.mockRejectedValue(new Error("offline"));
    render(<Harness />);
    await screen.findByText(/版本读取未完成.*现有引用已保留/);
    expect(screen.getByRole("button", { name: "检查最新剧本版本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "解除剧本关联" })).toBeDisabled();
    expect(state()).toEqual(storyboard());
    expect(sources.getEpisodeScript).not.toHaveBeenCalled();
  });
});
