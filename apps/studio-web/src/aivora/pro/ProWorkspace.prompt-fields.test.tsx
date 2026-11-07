import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { NOTICE_TEXT } from "../film/notices";
import * as editorModule from "./actions/editor-host";
import * as cardModule from "../next/SuggestionCard";
import { ProWorkspace } from "./ProWorkspace";

const createHost = editorModule.createEditorHost;
const renderCard = cardModule.SuggestionCard;
const nextZh = "店员望向窗外，雨水划过玻璃。";
const nextEn = "The clerk watches rain through the window.";
const reply = {
  kind: "OK",
  text: JSON.stringify({ keyframe: { prompt_zh: nextZh, prompt_en: nextEn } }),
};

function fixture() {
  const film = sampleFilm();
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.scenes = [film.scenes[0]!];
  film.characters = [];
  film.audioClips = [];
  film.shots = film.shots.slice(0, 2).map((shot, index) => ({
    ...shot,
    sceneId: film.scenes[0]!.id,
    no: index + 1,
    characters: [],
    line: "",
    lines: [],
    promptZh: "店员站在窗边。",
    promptEn: "The clerk stands by a window.",
    poster: "/tmp/original-frame.png",
    takes: [],
  }));
  return film;
}
async function open(pending = false) {
  const film = fixture();
  const other = {
    ...structuredClone(film),
    id: "film_promptother00001",
    episodeTitle: "第 2 集",
    episodeNo: 2,
  };
  let host!: Parameters<typeof createHost>[0];
  let editor!: ReturnType<typeof createHost>;
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    editor = createHost(value);
    return editor;
  });
  const writes = vi.fn(async (value: FilmProject) => structuredClone(value));
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => [
      {
        id: other.id,
        seriesId: other.seriesId,
        title: "第 2 集",
        no: 2,
        shots: 2,
        done: 0,
        savedAt: "",
      },
    ]),
    readFilmProject: vi.fn(async (id: string) => structuredClone(id === other.id ? other : film)),
    writeFilmProject: writes,
    prepareFilmProject: vi.fn(async (value: FilmProject) => structuredClone(value)),
    createStoryFilm: vi.fn(),
  } as unknown as Window["aijian"];
  let finish!: (value: typeof reply) => void;
  const completeText = pending
    ? vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
    : vi.fn().mockResolvedValue(reply);
  window.aijianGrok = {
    status: vi.fn().mockResolvedValue({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "owner",
      lastError: null,
    }),
    models: vi.fn().mockResolvedValue({ kind: "OK", models: [{ id: "grok-4.7", label: "text" }] }),
    completeText,
  } as unknown as Window["aijianGrok"];
  window.localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /分镜/,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  const summary = [...document.querySelectorAll<HTMLElement>(".pgroup > summary")].find(
    (item) => item.textContent === "高级",
  )!;
  if (!(summary.parentElement as HTMLDetailsElement).open) fireEvent.click(summary);
  return {
    film,
    other,
    writes,
    completeText,
    host: () => host,
    editor: () => editor,
    finish: async () => {
      await act(async () => {
        finish(reply);
      });
    },
  };
}
const request = () => fireEvent.click(screen.getByRole("button", { name: "写英文画面说明" }));
const fields = () => screen.getByRole("list", { name: "字段改动" });
const currentShot = (env: Awaited<ReturnType<typeof open>>) => env.host().current()!.shots[0]!;

beforeEach(() => {
  window.localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => vi.restoreAllMocks());

describe("4A-U11 single-shot stored field suggestions", () => {
  it("waits for confirmation, preserves late media and keeps top undo/redo on the existing receipt", async () => {
    const env = await open();
    request();
    const confirm = await screen.findByRole("button", { name: "确认修改" });
    expect(fields()).toHaveTextContent("中文画面说明");
    expect(fields()).toHaveTextContent("英文画面说明");
    expect(fields()).toHaveTextContent("店员站在窗边。");
    expect(fields()).toHaveTextContent(nextEn);
    expect(currentShot(env).promptEn).toBe(env.film.shots[0]!.promptEn);
    expect(
      env.writes.mock.calls.some(([value]) => value.shots.some((shot) => shot.promptEn === nextEn)),
    ).toBe(false);
    const live = structuredClone(env.host().current()!);
    live.shots[0]!.poster = "/private/later-media.png";
    live.shots[0]!.takes.push({
      id: "late-take",
      shotId: live.shots[0]!.id,
      index: 1,
      status: "done",
      videoPath: "/private/later-video.mp4",
      videoUrl: "",
      stillUrl: live.shots[0]!.poster,
      prompt: "",
      createdAt: "",
      reason: "",
    });
    await act(async () => {
      env.host().applyLive(live);
    });
    expect(fields()).not.toHaveTextContent("/private/");
    fireEvent.click(confirm);
    await screen.findByText("已应用这次字段修改。");
    await waitFor(() => expect(env.writes.mock.calls.at(-1)?.[0].shots[0]!.promptEn).toBe(nextEn));
    expect(currentShot(env)).toMatchObject({
      promptEn: nextEn,
      poster: "/private/later-media.png",
    });
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(currentShot(env).promptEn).toBe(env.film.shots[0]!.promptEn);
    expect(currentShot(env).takes[0]!.videoPath).toBe("/private/later-video.mp4");
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(currentShot(env).promptEn).toBe(nextEn);
    expect(currentShot(env).poster).toBe("/private/later-media.png");
    expect(window.aijian!.createStoryFilm).not.toHaveBeenCalled();
  });

  it("keeps the request baseline fixed and rejects the whole proposal after a prompt input conflict", async () => {
    const env = await open();
    request();
    await screen.findByRole("button", { name: "确认修改" });
    const baseline = fields().textContent;
    const live = structuredClone(env.host().current()!);
    live.shots[0]!.promptZh = "后来独立修改的中文说明";
    await act(async () => {
      env.host().applyLive(live);
    });
    expect(fields().textContent).toBe(baseline);
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    await waitFor(() =>
      expect(document.querySelector(".status-note")).toHaveTextContent(
        NOTICE_TEXT.EDITOR_EDIT_CONFLICT,
      ),
    );
    expect(currentShot(env).promptZh).toBe("后来独立修改的中文说明");
    expect(currentShot(env).promptEn).toBe(env.film.shots[0]!.promptEn);
  });

  it("rejects without editing and invalidates even a retained old confirmation callback", async () => {
    let oldConfirm: (() => void) | undefined;
    vi.spyOn(cardModule, "SuggestionCard").mockImplementation((props) => {
      if (props.fieldRows) oldConfirm = props.onApply;
      return renderCard(props);
    });
    const env = await open();
    const apply = vi.spyOn(env.editor(), "apply");
    request();
    await screen.findByRole("button", { name: "确认修改" });
    const retained = oldConfirm;
    fireEvent.click(
      within(screen.getByRole("region", { name: "助手的建议" })).getByRole("button", {
        name: "不要",
      }),
    );
    expect(screen.queryByRole("list", { name: "字段改动" })).toBeNull();
    await act(async () => {
      retained?.();
    });
    expect(apply).not.toHaveBeenCalled();
    expect(currentShot(env).promptEn).toBe(env.film.shots[0]!.promptEn);
    expect(screen.queryByText("已应用这次字段修改。")).toBeNull();
    expect(document.querySelector(".status-note")).not.toHaveTextContent("画面说明已修改");
  });

  it.each([false, true])(
    "cannot cancel an applied proposal while persistence is pending (failure: %s)",
    async (fail) => {
      let reject: (() => void) | undefined;
      vi.spyOn(cardModule, "SuggestionCard").mockImplementation((props) => {
        if (props.fieldRows) reject = props.onReject;
        return renderCard(props);
      });
      const env = await open();
      request();
      const confirm = await screen.findByRole("button", { name: "确认修改" });
      const oldReject = reject;
      let release!: () => void;
      env.writes.mockImplementationOnce(async (value) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (fail) throw new Error("synthetic disk failure");
        return structuredClone(value);
      });
      fireEvent.click(confirm);
      await waitFor(() => expect(release).toBeTypeOf("function"));
      expect(currentShot(env).promptEn).toBe(nextEn);
      await act(async () => {
        oldReject?.();
      });
      expect(screen.getByRole("list", { name: "字段改动" })).toBeInTheDocument();
      expect(document.querySelector(".status-note")).not.toHaveTextContent(
        NOTICE_TEXT.OPERATION_CANCELLED,
      );
      await act(async () => {
        release();
      });
      await screen.findByText("已应用这次字段修改。");
      await waitFor(() =>
        expect(document.querySelector(".status-note")).toHaveTextContent(
          fail ? NOTICE_TEXT.PROMPTER_APPLIED_UNSAVED : NOTICE_TEXT.PROMPTER_FIELDS_APPLIED,
        ),
      );
      await act(async () => {
        oldReject?.();
      });
      expect(screen.getByText("已应用这次字段修改。")).toBeInTheDocument();
      expect(currentShot(env).promptEn).toBe(nextEn);
    },
  );

  it.each(["busy", "save-failure"] as const)(
    "keeps the unsupported display fallback honest about %s",
    async (kind) => {
      const env = await open(),
        before = structuredClone(currentShot(env)),
        url = "https://example.org/story-sign";
      env.completeText.mockResolvedValue({
        kind: "OK",
        text: JSON.stringify({ keyframe: { prompt_zh: nextZh, prompt_en: url } }),
      });
      if (kind === "busy")
        vi.spyOn(env.editor(), "apply").mockResolvedValue({
          status: "rejected",
          conflicts: ["BUSY"],
        });
      else
        env.writes.mockImplementation(async (value) => {
          if (value.shots.some((s) => s.promptEn === url))
            throw Error("PRIVATE_SAVE_PATH /private/file");
          return structuredClone(value);
        });
      request();
      if (kind === "busy") {
        await screen.findByText(/正在保存，请稍等.*本次没有修改画面说明/);
        expect(currentShot(env)).toEqual(before);
      } else {
        await waitFor(() =>
          expect(document.querySelector(".status-note")).toHaveTextContent(
            "画面说明已经放进去，还没保存上。",
          ),
        );
        expect(currentShot(env).promptEn).toBe(url);
        expect(currentShot(env).poster).toBe(before.poster);
        expect(currentShot(env).takes).toEqual(before.takes);
        expect(document.body.textContent).not.toContain("PRIVATE_SAVE_PATH");
      }
      expect(env.completeText).toHaveBeenCalledOnce();
      expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
    },
  );

  it.each(["input", "work"])("drops a late model reply after the %s changes", async (kind) => {
    const env = await open(true);
    request();
    await waitFor(() => expect(env.completeText).toHaveBeenCalledTimes(1));
    if (kind === "input")
      fireEvent.change(screen.getByLabelText("分镜画面"), { target: { value: "用户改后的画面" } });
    else {
      fireEvent.click(screen.getByRole("button", { name: "作品" }));
      fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
      await screen.findByText(/已打开第 2 集/);
    }
    await env.finish();
    expect(screen.queryByRole("button", { name: "确认修改" })).toBeNull();
    expect(
      env
        .host()
        .current()!
        .shots.every((shot) => shot.promptEn !== nextEn),
    ).toBe(true);
    expect(
      env.writes.mock.calls.some(([value]) => value.shots.some((shot) => shot.promptEn === nextEn)),
    ).toBe(false);
  });

  it("shows the same pending field snapshot in the existing single-shot assistant view", async () => {
    const env = await open();
    request();
    await screen.findByRole("button", { name: "确认修改" });
    const baseline = fields().textContent;
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    expect(fields().textContent).toBe(baseline);
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    await screen.findByText("已应用这次字段修改。");
    expect(currentShot(env).promptEn).toBe(nextEn);
  });
});
