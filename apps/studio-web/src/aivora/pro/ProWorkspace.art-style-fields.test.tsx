import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import * as editorModule from "./actions/editor-host";
import { ProWorkspace } from "./ProWorkspace";

const createHost = editorModule.createEditorHost;
const nextStyle = "暖色胶片，柔和侧光。";
const reply = { kind: "OK", text: JSON.stringify({ prompt_block_zh: nextStyle }) };

async function open(options: { pending?: boolean; complex?: boolean; failSave?: boolean } = {}) {
  const film = sampleFilm();
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.directory = "/synthetic/art-style";
  film.locations = [];
  film.props = [];
  const other = {
    ...structuredClone(film),
    id: "film_artstyleother00001",
    episodeNo: 2,
    episodeTitle: "第 2 集",
  };
  let host!: Parameters<typeof createHost>[0];
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return createHost(value);
  });
  const disk = new Map([
    [film.id, structuredClone(film)],
    [other.id, structuredClone(other)],
  ]);
  const writes = vi.fn(async (value: FilmProject) => {
    if (options.failSave && value.styleZh === nextStyle) throw new Error("synthetic disk failure");
    disk.set(value.id, structuredClone(value));
    return structuredClone(value);
  });
  const video = vi.fn();
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => [
      {
        id: other.id,
        seriesId: other.seriesId,
        title: other.episodeTitle,
        no: 2,
        shots: other.shots.length,
        done: 0,
        savedAt: "",
      },
    ]),
    readFilmProject: vi.fn(async (id: string) => structuredClone(disk.get(id) ?? film)),
    writeFilmProject: writes,
    prepareFilmProject: vi.fn(async (value: FilmProject) => structuredClone(value)),
    createStoryFilm: video,
  } as unknown as Window["aijian"];
  let finish!: (value: typeof reply) => void;
  const result = options.complex
    ? {
        kind: "OK",
        text: JSON.stringify({
          prompt_block_zh: nextStyle,
          props: [{ name: "旧书", note: "主角手中的书" }],
        }),
      }
    : reply;
  const completeText = options.pending
    ? vi.fn(
        () =>
          new Promise<typeof reply>((resolve) => {
            finish = resolve;
          }),
      )
    : vi.fn().mockResolvedValue(result);
  window.aijianGrok = {
    status: vi.fn().mockResolvedValue({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "synthetic",
      lastError: null,
    }),
    models: vi.fn().mockResolvedValue({ kind: "OK", models: [{ id: "grok-4.7", label: "text" }] }),
    completeText,
  } as unknown as Window["aijianGrok"];
  window.localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场", { exact: true });
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /角色与场景/,
    }),
  );
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-stage", "cast"),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  return {
    film,
    other,
    disk,
    writes,
    video,
    completeText,
    host: () => host,
    finish: () => finish(reply),
  };
}
function plan() {
  fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
}
async function card() {
  return screen.findByRole("region", { name: "助手的建议" });
}
const confirm = () => fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

describe("real art style field proposal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.aijian;
    delete window.aijianGrok;
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows exact request-baseline values and real impact, then changes only after confirmation", async () => {
    const env = await open();
    const originalCharacters = structuredClone(env.host().current()!.characters);
    plan();
    const proposal = await card();
    expect(env.completeText).toHaveBeenCalledOnce();
    expect(proposal).toHaveTextContent("建议变更 1 个字段");
    expect(proposal).toHaveTextContent(env.film.styleZh);
    expect(proposal).toHaveTextContent(nextStyle);
    expect(screen.getByText(/改画风会把已有镜头标为需要重做/)).toBeInTheDocument();
    expect(env.host().current()!.styleZh).toBe(env.film.styleZh);
    expect(env.writes.mock.calls.some(([value]) => value.styleZh === nextStyle)).toBe(false);
    expect(within(proposal).queryByRole("button", { name: "撤销" })).toBeNull();
    confirm();
    await waitFor(() => expect(env.disk.get(env.film.id)!.styleZh).toBe(nextStyle));
    expect(
      env
        .host()
        .current()!
        .shots.every((shot) => shot.regenerationRequired?.code === "STYLE_CHANGED"),
    ).toBe(true);
    expect(env.host().current()!.characters).toEqual(originalCharacters);
    expect(env.video).not.toHaveBeenCalled();
  });

  it("falls back for an entire multi-field transaction and does not pretend only style will apply", async () => {
    const env = await open({ complex: true });
    plan();
    await screen.findByText("美术 · 画风和外貌");
    expect(screen.queryByRole("list", { name: "字段改动" })).toBeNull();
    expect(screen.queryByText("建议变更 1 个字段")).toBeNull();
    expect(screen.getByRole("button", { name: "放进分镜" })).toBeInTheDocument();
    expect(env.host().current()!.styleZh).toBe(env.film.styleZh);
  });

  it("rejects a conflict against the captured baseline without reporting application", async () => {
    const env = await open();
    plan();
    await card();
    // Model a concurrent live edit before this click is handled; no new request baseline.
    env.host().current()!.styleZh = "用户后来改的画风。";
    confirm();
    expect(env.host().current()!.styleZh).toBe("用户后来改的画风。");
    expect(await screen.findByText(/内容后来改过，这次美术建议没有覆盖/)).toBeInTheDocument();
    expect(env.writes.mock.calls.some(([value]) => value.styleZh === nextStyle)).toBe(false);
    expect(document.querySelector(".status-note")?.textContent).not.toContain("画风说明已修改");
  });

  it("retains media arriving after the request through confirmation and the existing top-bar undo", async () => {
    const env = await open();
    plan();
    await card();
    const latest = structuredClone(env.host().current()!);
    latest.characters[0]!.portraits = [
      { view: "正面", url: "/synthetic/later-portrait.png", prompt: "保留外貌" },
    ];
    latest.shots[0]!.poster = "/synthetic/later-poster.png";
    latest.shots[0]!.takes = [
      {
        id: "retained-take",
        shotId: latest.shots[0]!.id,
        index: 1,
        status: "done",
        videoPath: "/synthetic/later-video.mp4",
        videoUrl: "",
        stillUrl: latest.shots[0]!.poster,
        prompt: "保留版本",
        createdAt: "",
        reason: "",
      },
    ];
    latest.shots[0]!.selectedTakeId = "retained-take";
    act(() => env.host().applyLive(latest));
    expect(await card()).toHaveTextContent(env.film.styleZh);
    confirm();
    await waitFor(() => expect(env.disk.get(env.film.id)!.styleZh).toBe(nextStyle));
    expect(env.host().current()!.shots[0]!.takes).toEqual(latest.shots[0]!.takes);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(env.host().current()!.styleZh).toBe(env.film.styleZh));
    expect(env.host().current()!.characters[0]!.portraits).toEqual(latest.characters[0]!.portraits);
    expect(env.host().current()!.shots[0]!.poster).toBe(latest.shots[0]!.poster);
    expect(env.host().current()!.shots[0]!.takes).toEqual(latest.shots[0]!.takes);
    expect(env.host().current()!.shots[0]!.selectedTakeId).toBe("retained-take");
    expect(env.video).not.toHaveBeenCalled();
  });

  it.each(["page", "project"] as const)(
    "ignores late replies after changing %s",
    async (change) => {
      const env = await open({ pending: true });
      plan();
      await waitFor(() => expect(env.completeText).toHaveBeenCalledOnce());
      if (change === "page")
        fireEvent.click(
          within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
            name: /剧本/,
          }),
        );
      else {
        fireEvent.click(screen.getByRole("button", { name: "作品" }));
        fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
        await waitFor(() => expect(env.host().current()!.id).toBe(env.other.id));
      }
      await act(async () => env.finish());
      expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
      expect(env.host().current()!.styleZh).toBe(env.film.styleZh);
      expect(env.writes.mock.calls.some(([value]) => value.styleZh === nextStyle)).toBe(false);
    },
  );

  it("keeps applied edits live when their real persistence rejects, without claiming they were saved", async () => {
    const env = await open({ failSave: true });
    plan();
    await card();
    confirm();
    await screen.findByText(/美术建议已应用，但还没有保存|美术的建议.*还没保存/);
    expect(env.host().current()!.styleZh).toBe(nextStyle);
    expect(env.disk.get(env.film.id)!.styleZh).toBe(env.film.styleZh);
    expect(env.video).not.toHaveBeenCalled();
  });

  it("discards the new field card without applying it", async () => {
    const env = await open();
    plan();
    const proposal = await card();
    fireEvent.click(within(proposal).getByRole("button", { name: "不要" }));
    expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
    expect(env.host().current()!.styleZh).toBe(env.film.styleZh);
    expect(env.writes.mock.calls.some(([value]) => value.styleZh === nextStyle)).toBe(false);
  });
});
