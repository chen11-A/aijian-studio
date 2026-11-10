import { generationExecutionFixture } from "./generation-execution.test-fixture";
import type { FilmAssemblyInput, FilmAssemblyResult } from "@aijian/contracts/film-assembly";
import { historyRecordHash } from "./actions/persistent-history";
import type { FilmHistoryEntry, FilmHistoryGateway } from "@aijian/contracts/film-history";
import { qcFailureText } from "./actions/export-qc";
import type {
  FilmExportQcInput,
  FilmExportQcPublishResult,
} from "@aijian/contracts/film-export-qc";
import { File as NodeFile } from "node:buffer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import * as filmProject from "../film/project";
import { activeFilmId, readSaved } from "../film/library";
import { BEAT_DRAG_TYPE } from "../next/SceneAlerts";
import { NOTICE_COPY } from "../next/wiring/noticeCopy";
import * as directionTransactions from "./actions/shot-direction-transaction";
import * as artTransactions from "./actions/art-transaction";
import { ProWorkspace } from "./ProWorkspace";
import { saveStillReview, stillChecklist } from "./still-acceptance";

const PROJECT_ID = `prj_${"a".repeat(32)}`;

describe("professional workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.aijian;
    delete window.aijianGrok;
  });

  it("recovers a saved pipeline checkpoint without dispatching or autosaving the old running state", async () => {
    const { createProductionPipeline } = await import("../film/production-pipeline");
    const { filmPipelineFingerprint } = await import("./film-pipeline-controller");
    const { completeText } = installDesktop();
    const film = sampleFilm();
    const state = createProductionPipeline(film.id, "initial-source-version");
    state.status = "running";
    state.current = "writer";
    state.steps[0] = {
      id: "writer",
      status: "running",
      planned: true,
      done: 0,
      total: 1,
      targets: [{ id: "script", status: "running", attempt: 1 }],
    };
    film.productionPipeline = state;
    film.productionInputFingerprint = await filmPipelineFingerprint(film);
    window.aijian!.createProject = vi.fn();
    window.aijian!.prepareFilmProject = vi.fn(async (value) => structuredClone(value));
    vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
    window.localStorage.setItem("aivora.film.activeId", film.id);
    render(<ProWorkspace />);
    await waitFor(() => {
      const writes = vi.mocked(window.aijian!.writeFilmProject!).mock.calls;
      expect(
        writes.some(
          ([value]) =>
            (value as FilmProject).productionPipeline?.steps[0]?.targets[0]?.status === "uncertain",
        ),
      ).toBe(true);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    const saved = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)![0] as FilmProject;
    expect(saved.productionPipeline?.steps[0]?.targets[0]?.status).toBe("uncertain");
    expect(completeText).not.toHaveBeenCalled();
    expect(window.aijian!.createProject).not.toHaveBeenCalled();
  });

  it("marks existing shots stale when the character page changes style without deleting their media", async () => {
    installDesktop();
    const film = sampleFilm();
    film.shots[0]!.picture = "手工保留的画面。";
    film.shots[0]!.poster = "/tmp/original-frame.png";
    film.shots[0]!.userFields = ["picture"];
    vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
    window.localStorage.setItem("aivora.film.activeId", film.id);
    render(<ProWorkspace />);
    await screen.findAllByText(film.title);
    fireEvent.click(stageTab("角色与场景"));
    fireEvent.change(screen.getByLabelText("画风"), { target: { value: "黑白悬疑" } });
    await waitFor(() => {
      const saved = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as
        FilmProject | undefined;
      expect(saved?.styleRevision).toBe(1);
      expect(saved?.styleZh).toContain("黑白悬疑");
      expect(saved?.shots.every((shot) => shot.regenerationRequired?.styleRevision === 1)).toBe(
        true,
      );
      expect(saved?.shots[0]).toMatchObject({
        picture: "手工保留的画面。",
        poster: "/tmp/original-frame.png",
        userFields: ["picture"],
      });
    });
  });

  it("persists continuity reminders and clears only repaired rule notes after a shot edit", async () => {
    installDesktop();
    const film = sampleFilm();
    const person = film.characters[0]!;
    person.identity = "固定外貌：灰衣短发";
    const shot = film.shots[0]!;
    shot.characters = [person.name];
    shot.promptZh = "";
    shot.picture = "雨中站着一个人。";
    shot.continuity = [{ kind: "cut", text: "导演保留的衔接说明" }];
    film.shots = [shot];
    vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
    window.localStorage.setItem("aivora.film.activeId", film.id);
    render(<ProWorkspace />);
    const latest = () =>
      vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as FilmProject | undefined;
    await waitFor(() =>
      expect(latest()?.shots[0]?.continuity).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "missing_look" }),
          { kind: "cut", text: "导演保留的衔接说明" },
        ]),
      ),
    );
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(film.scenes.find((scene) => scene.id === shot.sceneId)!.title),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "属性" }));
    fireEvent.change(screen.getByLabelText("分镜画面"), { target: { value: person.identity } });
    await waitFor(() =>
      expect(latest()?.shots[0]?.continuity).toEqual([{ kind: "cut", text: "导演保留的衔接说明" }]),
    );
  });

  it("uses the preceding selected video last frame after that frame is adopted", async () => {
    let frameCount = 0;
    const extract = vi.fn(async (_series: string, videoPath: string) => ({
      path: `/tmp/last-frame-${++frameCount}.png`,
      sourceVideoPath: videoPath,
    }));
    let videoCount = 0;
    const video = vi.fn(async () => ({
      data: { status: "SUCCEEDED", output_path: `/tmp/made-${++videoCount}.mp4` },
    }));
    installDesktop(video);
    const film = sampleFilm();
    const source = {
      ...film.shots[0]!,
      characters: [],
      line: "",
      lines: [],
      speaker: "",
      selectedTakeId: "source-take",
      poster: "/tmp/source.png",
    };
    source.takes = [
      {
        id: "source-take",
        shotId: source.id,
        index: 1,
        status: "done" as const,
        stillUrl: source.poster,
        videoPath: "/tmp/source.mp4",
        videoUrl: "",
        prompt: "",
        createdAt: "",
        reason: "",
      },
    ];
    const linked = {
      ...source,
      id: "next-linked-shot",
      no: 2,
      takes: [],
      selectedTakeId: "",
      poster: "/tmp/preview.png",
      continuityFromShotId: source.id,
    };
    film.shots = [source, linked];
    window.aijian!.extractFilmLastFrame = extract;
    vi.mocked(window.aijian!.readFilmProject!).mockImplementation(async (id) => {
      const writes = vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.map(([value]) => value)
        .filter((value) => value.id === id);
      return structuredClone(writes.at(-1) ?? film);
    });
    window.localStorage.setItem("aivora.film.activeId", film.id);
    render(<ProWorkspace projectId={PROJECT_ID} />);
    await screen.findAllByText(film.title);
    await waitFor(() =>
      expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
    );
    const openShot = (label: RegExp) => {
      const row = screen.queryByRole("button", { name: label });
      if (row) {
        fireEvent.click(row);
        return;
      }
      const back = screen.queryByRole("button", { name: "全部镜头" });
      if (back) fireEvent.click(back);
      fireEvent.click(stageTab("分镜"));
      fireEvent.click(
        screen.getByRole("button", {
          name: new RegExp(film.scenes.find((scene) => scene.id === source.sceneId)!.title),
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: label }));
    };
    const adopt = () => {
      fireEvent.click(screen.getByRole("button", { name: "核对并采用" }));
      for (const row of screen.getAllByRole("button", { name: "符合" })) fireEvent.click(row);
      fireEvent.click(screen.getByRole("button", { name: "采用" }));
    };
    const startOne = () => {
      const open = screen.queryByRole("button", { name: "生成视频" });
      if (open) fireEvent.click(open);
      fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
      fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    };
    const sentStill = () =>
      (video.mock.calls.at(-1) as unknown as [string, { shots: { still?: string }[] }])[1].shots[0]
        ?.still;
    const preparedStages = async () => {
      const prepared = await vi
        .mocked(window.aijian!.prepareFilmGenerationExecution!)
        .mock.results.at(-1)!.value;
      if (prepared.kind !== "PREPARED") throw new Error(prepared.kind);
      return prepared.stages;
    };

    await openShot(/镜头 2/);
    adopt();
    startOne();
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    expect(video).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/镜头 2 的画面还没核对/)).length).toBeGreaterThan(0);

    adopt();
    startOne();
    await waitFor(() => expect(video).toHaveBeenCalledTimes(1));
    expect(extract).toHaveBeenCalledTimes(1);
    expect(sentStill()).toBe("/tmp/last-frame-1.png");
    expect(await preparedStages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "continuity-frame",
          targetId: linked.id,
          sourceShotId: source.id,
        }),
      ]),
    );

    await openShot(/镜头 1/);
    adopt();
    startOne();
    await waitFor(() => expect(video).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "用第 2 版" }));

    await openShot(/镜头 2/);
    startOne();
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(2));
    expect(video).toHaveBeenCalledTimes(2);
    expect((await screen.findAllByText(/镜头 2 的画面还没核对/)).length).toBeGreaterThan(0);

    adopt();
    startOne();
    await waitFor(() => expect(video).toHaveBeenCalledTimes(3));
    expect(extract).toHaveBeenCalledTimes(2);
    expect(sentStill()).toBe("/tmp/last-frame-2.png");
    expect(await preparedStages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "continuity-frame",
          targetId: linked.id,
          sourceShotId: source.id,
        }),
      ]),
    );
  });

  it("keeps the real imported novel across pages and after synchronous offline cast extraction", async () => {
    const source = readFileSync(
      resolve(__dirname, "../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt"),
      "utf8",
    );
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "导入小说…" }));
    fireEvent.change(screen.getByLabelText("导入小说"), {
      target: { files: [new NodeFile([source], "test-novel-2000.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "放进剧本" })).toBeEnabled());
    fireEvent.click(stageTab("角色与场景"));
    expect(screen.queryByRole("button", { name: "放进剧本" })).not.toBeInTheDocument();
    fireEvent.click(stageTab("剧本"));
    fireEvent.click(await screen.findByRole("button", { name: "放进剧本" }));
    expect(screen.getByLabelText("这一场")).not.toHaveValue("");
    fireEvent.click(stageTab("角色与场景"));
    expect(document.body.textContent).toContain("林晚");
    fireEvent.click(stageTab("剧本"));
    expect(screen.queryByRole("button", { name: "放进剧本" })).not.toBeInTheDocument();
    await waitFor(async () => {
      const saved = await readSaved(activeFilmId());
      expect(saved?.sourceText).toBe(source);
      expect(saved?.scenes.map((item) => item.title)).toEqual([
        "雨夜旧书店",
        "码头仓库",
        "医院走廊",
      ]);
      const allScenes = saved!.scenes.map((item) => item.text).join("\n");
      for (const paragraph of source
        .split(/\n+/)
        .map((item) => item.trim())
        .filter(Boolean))
        expect(allScenes).toContain(paragraph);
    });
  });

  it("keeps an offline director plan when cast extraction finishes synchronously", async () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
    fireEvent.change(screen.getByLabelText("这一场"), {
      target: { value: "林晚走进书店。林晚说：这书店我不卖。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    fireEvent.click(await screen.findByRole("button", { name: "放进分镜" }));
    await waitFor(async () => {
      const saved = await readSaved(activeFilmId());
      expect(saved?.shots.length).toBeGreaterThan(0);
      expect(saved?.characters.some((person) => person.name === "林晚")).toBe(true);
      expect(saved?.scenes[0]?.text).toContain("这书店我不卖。");
    });
  });

  it.each(["undo", "redo"] as const)(
    "isolates %s history when opening another episode and keeps its own edits reversible",
    async (direction) => {
      installDesktop();
      await openSample();
      fireEvent.change(screen.getByLabelText("这一场"), {
        target: { value: "甲作品的独有旧稿。" },
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 650));
      });
      if (direction === "redo") fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      const episode = sampleFilm();
      episode.id = "film_episode2000000001";
      episode.title = "乙作品标题";
      episode.seriesTitle = "乙作品标题";
      episode.episodeTitle = "第 2 集";
      episode.scenes[0]!.text = "乙作品原文。";
      vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(episode);
      fireEvent.click(screen.getByRole("button", { name: "作品" }));
      fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
      expect(await screen.findByText(/已打开第 2 集/)).toBeInTheDocument();
      fireEvent.keyDown(window, { key: direction === "undo" ? "z" : "y", ctrlKey: true });
      expect(screen.getByLabelText("这一场")).toHaveValue("乙作品原文。");
      fireEvent.change(screen.getByLabelText("这一场"), {
        target: { value: "乙作品修改后的正文。" },
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 650));
      });
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      expect(screen.getByLabelText("这一场")).toHaveValue("乙作品原文。");
      fireEvent.keyDown(window, { key: "y", ctrlKey: true });
      expect(screen.getByLabelText("这一场")).toHaveValue("乙作品修改后的正文。");
      await waitFor(() => {
        const saved = vi
          .mocked(window.aijian!.writeFilmProject!)
          .mock.calls.at(-1)?.[0] as FilmProject;
        expect(saved.id).toBe(episode.id);
        expect(saved.title).toBe("乙作品标题");
        expect(saved.scenes[0]?.text).toBe("乙作品修改后的正文。");
      });
    },
  );

  it("generates every missing portrait from one whole-cast click", async () => {
    installDesktop();
    let image = 0;
    vi.mocked(window.aijian!.generateFilmStill!).mockImplementation(async () => ({
      path: `/tmp/portrait-${++image}.png`,
      reason: "",
    }));
    await openSample();
    fireEvent.click(stageTab("角色与场景"));
    fireEvent.click(screen.getByRole("button", { name: "给所有人出定妆照" }));
    const missing = sampleFilm().characters.reduce(
      (count, person) =>
        count +
        ["正面", "侧面", "背面", "脸部"].filter(
          (view) => !person.portraits.some((item) => item.view === view && item.url),
        ).length,
      0,
    );
    await waitFor(() => expect(window.aijian!.generateFilmStill).toHaveBeenCalledTimes(missing));
    await waitFor(() => {
      const saved = vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.at(-1)![0] as FilmProject;
      expect(
        saved.characters.every((person) =>
          ["正面", "侧面", "背面", "脸部"].every((view) =>
            person.portraits.some((item) => item.view === view && item.url),
          ),
        ),
      ).toBe(true);
      const calls = vi.mocked(window.aijian!.generateFilmStill!).mock.calls;
      for (const [index, person] of saved.characters.entries()) {
        const front = person.portraits.find((portrait) => portrait.view === "正面")!.url;
        expect(calls[index * 4]?.[3]).toEqual([]);
        for (const offset of [1, 2, 3]) expect(calls[index * 4 + offset]?.[3]).toEqual([front]);
      }
    });
    // 4A-U09: everyone has all four, so the primary button moves on to the storyboard.
    expect(await screen.findByRole("button", { name: "下一步：分镜" })).toHaveClass("primary");
  });

  it("shares one busy queue between whole-cast portraits and the single-character button", async () => {
    installDesktop();
    let release!: (value: { path: string; reason: string }) => void;
    vi.mocked(window.aijian!.generateFilmStill!).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await openSample();
    fireEvent.click(stageTab("角色与场景"));
    const single = screen.getByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ });
    fireEvent.click(screen.getByRole("button", { name: "给所有人出定妆照" }));
    await waitFor(() => expect(window.aijian!.generateFilmStill).toHaveBeenCalledTimes(1));
    expect(single).toBeDisabled();
    fireEvent.click(single);
    expect(window.aijian!.generateFilmStill).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ path: "/tmp/shared-portrait.png", reason: "" });
    });
    const missing = sampleFilm().characters.reduce(
      (count, person) =>
        count +
        ["正面", "侧面", "背面", "脸部"].filter(
          (view) => !person.portraits.some((portrait) => portrait.view === view && portrait.url),
        ).length,
      0,
    );
    await waitFor(() => expect(window.aijian!.generateFilmStill).toHaveBeenCalledTimes(missing));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ })).toBeNull(),
    );
  });

  it("persists character trait controls and clears an automatic voice for unknown traits", async () => {
    installDesktop();
    await openSample();
    fireEvent.click(stageTab("角色与场景"));
    fireEvent.change(screen.getByLabelText("性别"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("年龄段"), { target: { value: "老年" } });
    await waitFor(() => {
      const saved = vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.at(-1)![0] as FilmProject;
      expect(saved.characters[0]).toMatchObject({ gender: "", ageBand: "老年", voiceId: "" });
    });
  });

  it("offers resume after reopening unsent versions without resending unknown running work", async () => {
    const { prepareVideoQueue, setVideoTaskState } = await import("../film/generation-queue");
    const video = vi.fn(async () => ({
      data: { status: "SUCCEEDED", output_path: "/tmp/resumed.mp4" },
    }));
    installDesktop(video);
    const film = sampleFilm();
    film.shots[0] = { ...film.shots[0]!, poster: "/tmp/aivora/shot-0.png" };
    const verdicts = Object.fromEntries(
      stillChecklist(film, film.shots[0]!).map((item) => [item.id, "match" as const]),
    );
    const adopted = saveStillReview(
      film,
      film.shots[0]!.id,
      verdicts,
      "2026-11-10T00:00:00.000Z",
    ).film;
    const prepared = prepareVideoQueue(adopted, [adopted.shots[0]!], 2, false).film;
    const takes = prepared.shots[0]!.takes;
    const stored = setVideoTaskState(prepared, takes[0]!.id, "running");
    vi.mocked(window.aijian!.readFilmProject!).mockImplementation(async (id) => {
      const writes = vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.map(([film]) => film)
        .filter((film) => film.id === id);
      return structuredClone(writes.at(-1) ?? stored);
    });
    window.localStorage.setItem("aivora.film.activeId", stored.id);
    render(<ProWorkspace projectId={PROJECT_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: /后台生成/ }));
    const resume = await screen.findByRole("button", { name: "继续排队" });
    expect(video).not.toHaveBeenCalled();
    fireEvent.click(resume);
    await waitFor(() => expect(video).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const saved = vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.at(-1)![0] as FilmProject;
      expect(saved.shots[0]!.takes.map((take) => take.id)).toEqual(takes.map((take) => take.id));
      expect(saved.shots[0]!.takes.map((take) => take.status)).toEqual(["failed", "done"]);
    });
  });

  it("blocks 继续排队 on an old project that has no adopted still", async () => {
    const { prepareVideoQueue, setVideoTaskState } = await import("../film/generation-queue");
    const video = vi.fn(async () => ({
      data: { status: "SUCCEEDED", output_path: "/tmp/resumed.mp4" },
    }));
    installDesktop(video);
    const film = sampleFilm();
    const prepared = prepareVideoQueue(film, [film.shots[0]!], 2, false).film;
    const takes = prepared.shots[0]!.takes;
    const stored = setVideoTaskState(prepared, takes[0]!.id, "running");
    vi.mocked(window.aijian!.readFilmProject!).mockImplementation(async (id) => {
      const writes = vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.map(([film]) => film)
        .filter((item) => item.id === id);
      return structuredClone(writes.at(-1) ?? stored);
    });
    window.localStorage.setItem("aivora.film.activeId", stored.id);
    render(<ProWorkspace projectId={PROJECT_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: /后台生成/ }));
    fireEvent.click(await screen.findByRole("button", { name: "继续排队" }));
    expect(video).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/镜头 \d+ 的画面还没核对/)).length).toBeGreaterThan(0);
  });

  it("blocks a failed retry after the adopted picture description changes", async () => {
    const createStoryFilm = vi.fn(async () => {
      throw new Error("offline");
    });
    installDesktop(createStoryFilm);
    await openSample();
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    await adoptOpenStill();
    fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    expect((await screen.findAllByText("没有生成成功，可以重试。")).length).toBeGreaterThan(0);
    const calls = createStoryFilm.mock.calls.length;
    fireEvent.change(screen.getByLabelText("画面描述"), { target: { value: "改过的画面" } });
    fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
    fireEvent.click(screen.getByRole("button", { name: /失败的全部重试/ }));
    expect(createStoryFilm).toHaveBeenCalledTimes(calls);
    expect(screen.getAllByText(/镜头 \d+ 的画面还没核对/).length).toBeGreaterThan(0);
  });

  it("shows and repairs the selected scene even when it has no shots", async () => {
    const { completeText } = installDesktop();
    const film = sampleFilm();
    const empty = film.scenes.at(-1)!;
    empty.title = "无镜头末场";
    empty.text = "门外传来最后一声警笛。";
    empty.coverage = {
      sceneId: empty.id,
      ok: false,
      lastLine: "",
      missingLines: [],
      missingTail: empty.text,
    };
    film.shots = film.shots.filter((item) => item.sceneId !== empty.id);
    film.unassignedBeats = [
      { sceneId: empty.id, text: "末场待分配动作" },
      { sceneId: film.scenes[0]!.id, text: "别场动作不要混进来" },
    ];
    vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
    window.localStorage.setItem("aivora.film.activeId", film.id);
    render(<ProWorkspace projectId={PROJECT_ID} />);
    await screen.findByRole("button", { name: /后台生成/ });
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(screen.getByRole("button", { name: /无镜头末场/ }));
    expect(document.querySelectorAll(".pb.grid .card")).toHaveLength(0);
    expect(screen.getByText(/这一场结尾还没拍到/)).toHaveAttribute("title", empty.text);
    expect(screen.getByText("有 1 个动作没对上镜头")).toBeInTheDocument();
    expect(screen.getByText("末场待分配动作")).toBeInTheDocument();
    expect(screen.queryByText("别场动作不要混进来")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "补上结尾" }));
    await waitFor(() => expect(completeText).toHaveBeenCalled());
    expect(JSON.stringify(completeText.mock.calls)).toContain(empty.text);
    await waitFor(() => expect(screen.queryByRole("button", { name: "正在补…" })).toBeNull());
  });

  it("keeps a saved paragraph ownership risk visible when no dialogue or ending is missing", async () => {
    installDesktop();
    const { detectDirectorCoverage } = await import("../film/director-continuity");
    const film = sampleFilm();
    const scene = film.scenes[0]!;
    scene.title = "待核对归属场";
    scene.text = "警笛远去。";
    scene.paragraphCoverage = {
      ok: false,
      missingParagraphs: ["P02"],
      duplicateParagraphs: [],
      invalidParagraphs: [],
      crossSceneRisk: true,
    };
    film.shots = [
      {
        ...film.shots[0]!,
        sceneId: scene.id,
        picture: scene.text,
        action: "",
        line: "",
        lines: [],
      },
    ];
    scene.coverage = detectDirectorCoverage(scene, film.shots);
    expect(scene.coverage).toMatchObject({ ok: false, missingLines: [], missingTail: null });
    vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
    window.localStorage.setItem("aivora.film.activeId", film.id);
    render(<ProWorkspace projectId={PROJECT_ID} />);
    await screen.findByRole("button", { name: /后台生成/ });
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(screen.getByRole("button", { name: /待核对归属场/ }));
    const warning = document.querySelector(".nx-scene-alerts")!;
    expect(warning).toHaveTextContent("有原文段落的场次归属需要核对");
    expect(warning).toHaveTextContent("请按原文核对顺序");
    expect(warning).not.toHaveTextContent("结尾还没拍到");
    expect(within(warning as HTMLElement).queryByRole("button", { name: "补上结尾" })).toBeNull();
    fireEvent.click(stageTab("角色与场景"));
    fireEvent.click(stageTab("分镜"));
    expect(document.querySelector(".nx-scene-alerts")).toHaveTextContent(
      "有原文段落的场次归属需要核对",
    );
  });

  it("starts a new work from a story template chosen on home", async () => {
    render(<ProWorkspace />);
    fireEvent.change(screen.getByLabelText("从模板开始"), { target: { value: "雨夜巷战打斗" } });
    fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
    await waitFor(() =>
      expect(document.querySelector(".status-note")?.textContent).toMatch(
        /已放入模板「雨夜巷战打斗」/,
      ),
    );
    expect(screen.queryByLabelText("从模板开始")).toBeNull();
    expect(screen.getByText("会在分镜后停下，等你确认")).toBeInTheDocument();
  });

  it("starts a landscape film from the empty screen", () => {
    render(<ProWorkspace />);
    expect(screen.getByRole("radio", { name: "横屏 16:9" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
    expect(screen.getByText("已新建横屏作品。")).toBeInTheDocument();
  });

  it("starts one-click from home with the sentence written there", async () => {
    const { completeText } = installDesktop();
    render(<ProWorkspace projectId={PROJECT_ID} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开始一键成片" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("一句话的想法"), {
      target: { value: "雨夜，旧书店的老板娘等来了讨债的人。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始一键成片" }));
    await waitFor(() => expect(completeText).toHaveBeenCalled());
    expect(String(completeText.mock.calls[0]?.[0]?.text ?? "")).toContain(
      "雨夜，旧书店的老板娘等来了讨债的人。",
    );
    expect(document.querySelector(".nx-home")).toBeNull();
  });

  it("offers two ways in from home, with one primary button that signs in first", async () => {
    render(<ProWorkspace />);
    const primaries = document.querySelectorAll(".nx-home .nx-primary");
    expect(primaries).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "一键成片" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "从空白开始" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用 Grok 会员登录" })).toHaveClass("nx-primary");
    expect(screen.getByText("还没有保存的作品。")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ChatGPT/);
    fireEvent.click(screen.getByRole("radio", { name: "竖屏 9:16" }));
    fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
    expect(screen.getByText("已新建作品（竖屏）。")).toBeInTheDocument();
  });

  it("feeds a renamed character into that shot's picture prompt", async () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /角色/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.change(screen.getByLabelText("人物名字"), { target: { value: "阿宁" } });
    fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "阿宁，短发，灰外套" } });
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /分镜/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    const prompt = screen.getByTestId("keyframe-prompt");
    expect(prompt.textContent).toContain("阿宁，短发，灰外套");
    expect(prompt.textContent).toContain("起始画面");
    await waitFor(() => {
      expect(JSON.stringify(window.localStorage)).toContain("阿宁");
    });
  });

  it("writes a short drama, keeps cast choices, and reports shots still missing", async () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    pickHelper("编剧");
    fireEvent.click(screen.getByRole("button", { name: "让编剧分场" }));
    expect(await screen.findByText(/先用软件自己的规则写了剧本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放进剧本" }));
    expect(await screen.findByText(/已放进剧本/)).toBeInTheDocument();
    // Replacing the script clears obsolete automatic shots. Build the new script's
    // shots before editing one away and checking the remaining ungenerated shots.
    pickHelper("导演");
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/先用软件自己的规则拆了镜头/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
    expect(await screen.findByText(/已放进分镜/)).toBeInTheDocument();

    fireEvent.click(
      screen
        .getAllByRole("button", { name: /角色/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ }));
    // 3J-U19: the status line is one sentence; the reason waits in its tooltip.
    await waitFor(() => expect(statusDetail()).toMatch(/请打开安装好的 AIVORA 再出图/));
    expect(screen.getByText(/登录 Grok 会员后才能看到声音名单/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "试听" }));
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /分镜/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "加镜头" }));
    expect(screen.getByText(/已加一个镜头/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
    await waitFor(() =>
      expect(document.querySelector(".status-note")?.textContent).toBe(
        NOTICE_COPY.DESKTOP_REQUIRED,
      ),
    );
    expect(document.querySelector(".status-note")?.textContent).not.toMatch(
      /模型|上限|首帧选用|\d/,
    );
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /剪辑/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /镜头 \d/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "剪掉" }));
    expect(screen.getByText(/已剪掉这一段/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    expect(screen.getByTestId("export-summary").textContent).toContain("没做好");
  });

  it("keeps four stages, confirms a batch, and does not invent an export", async () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    const tabs = screen.getAllByRole("button").filter((item) => item.className.includes("tab"));
    expect(tabs).toHaveLength(4);
    expect(tabs.some((item) => item.textContent?.includes("生成"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "新建一集" }));
    expect(screen.getByText(/已新建第 2 集/)).toBeInTheDocument();
    const undo = screen.getAllByRole("button", { name: "撤销" })[0]!;
    expect(undo).toBeDisabled();
    fireEvent.click(undo);
    expect(screen.getByRole("button", { name: "作品" }).textContent).toContain("第 2 集");
    // Returning to another episode is navigation, never restoration through its undo stack.
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    expect(screen.getByRole("button", { name: "作品" }).textContent).toContain("第 1 集");
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /分镜/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
    expect(screen.getByTestId("batch-estimate").textContent).toContain("记在 Grok 会员额度里");
    fireEvent.click(screen.getByRole("button", { name: "先不生成" }));
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    // 4A-U12: one video of the selected length, and how it is paid for.
    expect(screen.getByTestId("generation-estimate").textContent).toMatch(
      /^1 段 \d+ 秒的视频 · 用 Grok 会员额度，不另外收费$/,
    );
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /剪辑/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    {
      const silentChoice = screen.queryByRole("button", { name: "本片静音" });
      if (silentChoice) fireEvent.click(silentChoice);
    }
    fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
    expect(screen.getByText(/导出前检查没有完成/)).toBeInTheDocument();
    expect(screen.queryByText(/D:\\/)).toBeNull();
  });

  it("uses the offline director until the user confirms", async () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/先用软件自己的规则拆了镜头/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("COVERAGE_INCOMPLETE");
    if (document.body.textContent?.includes("还有内容需要补齐"))
      expect(document.body.textContent).not.toContain("为保留全部台词和结尾");
    fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
    expect(await screen.findByText(/已放进分镜/)).toBeInTheDocument();
  });

  it("walks the stages, confirms agents, and keeps a hand edit", async () => {
    const transactionSpy = vi.spyOn(directionTransactions, "prepareShotDirection");
    onTestFinished(() => transactionSpy.mockRestore());
    const { completeText } = installDesktop();
    await openSample();
    expect(screen.queryByRole("button", { name: "放进分镜" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加一场" }));
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "雨停在巷口。" } });
    fireEvent.click(screen.getByRole("button", { name: /雨夜·巷口/ }));
    pickHelper("编剧");
    fireEvent.click(screen.getByRole("button", { name: "让编剧分场" }));
    expect(await screen.findByText(/编剧写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放进剧本" }));
    expect(await screen.findByText(/已放进剧本/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "改成短剧" }));
    expect(await screen.findByText(/编剧写好了/)).toBeInTheDocument();
    const novel = new File(["第一章 夜雨\n巷子里只有风。"], "故事.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("导入小说"), { target: { files: [novel] } });
    expect(await screen.findByText(/已读取文本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放进剧本" }));
    const refused = new File(["x"], "故事.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("导入小说"), { target: { files: [refused] } });
    expect(await screen.findByText(/只读取 txt/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: "再短一点" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect((await screen.findAllByText(/编剧写好了/)).length).toBeGreaterThan(0);
    // 4A-U11: 「换一个」 asks the same assistant again; nothing changes until 放进.
    fireEvent.click(screen.getByRole("button", { name: "换一个" }));
    expect((await screen.findAllByText(/编剧写好了/)).length).toBeGreaterThan(0);
    // The rewritten script no longer owns the sample's obsolete shots.
    pickHelper("导演");
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByRole("button", { name: "放进分镜" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
    expect(await screen.findByText(/已放进分镜/)).toBeInTheDocument();
    pickHelper("动作指导");
    fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
    expect(await screen.findByText(/动作指导写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
    expect(await screen.findByText(/已放进这一镜/)).toBeInTheDocument();

    fireEvent.click(stageTab("分镜"));
    fireEvent.change(screen.getByLabelText("动作要点"), { target: { value: "我改过这一下" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
    expect(await screen.findByText(/有动作没对上镜头/)).toBeInTheDocument();
    const lockedActionConfirm = await screen.findByRole("button", { name: "确认修改" });
    const lockedActionFields = screen.getByRole("list", { name: "字段改动" });
    const lockedAction = transactionSpy.mock.results
      .filter((result) => result.type === "return" && result.value.role === "action")
      .at(-1)!.value;
    const expectedFields =
      lockedAction.changes.length +
      Number(JSON.stringify(lockedAction.stateBefore) !== JSON.stringify(lockedAction.stateAfter)) +
      Number(JSON.stringify(lockedAction.beatsBefore) !== JSON.stringify(lockedAction.beatsAfter));
    expect(within(lockedActionFields).getAllByRole("listitem")).toHaveLength(expectedFields);
    expect(lockedActionFields).toHaveTextContent("场内动作状态");
    await waitFor(() => {
      const saved = vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.at(-1)![0] as FilmProject;
      const target = saved.shots.find((row) => row.id === lockedAction.selection.shotId)!;
      expect(target.action).toBe("我改过这一下");
      expect(target.userFields).toContain("action");
      for (const change of lockedAction.changes)
        expect((target as unknown as Record<string, unknown>)[change.field]).toEqual(
          change.before.value,
        );
      expect(
        saved.scenes.find((row) => row.id === lockedAction.selection.sceneId)?.actionState,
      ).toEqual(lockedAction.stateBefore.value);
    });
    fireEvent.click(lockedActionConfirm);

    expect(screen.getByText(/你改过的，没有盖掉/)).toBeInTheDocument();
    await waitFor(() => {
      const saved = vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.at(-1)?.[0] as FilmProject;
      expect(
        saved.shots.some(
          (row) => row.action === "我改过这一下" && row.userFields.includes("action"),
        ),
      ).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "属性" }));
    fireEvent.change(screen.getByLabelText("景别"), { target: { value: "特写" } });
    fireEvent.change(screen.getByLabelText("运镜"), { target: { value: "推" } });
    fireEvent.change(screen.getByLabelText("分镜画面"), { target: { value: "雨停了" } });
    fireEvent.change(screen.getByLabelText("表演"), { target: { value: "我改过表演" } });
    fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
    expect(await screen.findByText(/画面出好了。/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    pickHelper("表演指导");
    fireEvent.click(screen.getByRole("button", { name: "请表演指导看看" }));
    expect(await screen.findByText(/表演指导写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
    expect(screen.getByText(/已放进这一镜|你改过的/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "属性" }));
    moreAction("前移");
    moreAction("后移");
    fireEvent.click(stageTab("角色与场景"));
    fireEvent.click(screen.getByRole("button", { name: /刀疤/ }));
    fireEvent.change(screen.getByLabelText("人物名字"), { target: { value: "老刀" } });
    fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "老刀，光头" } });
    fireEvent.change(screen.getByLabelText("画风"), { target: { value: "古风武侠" } });
    fireEvent.click(screen.getByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ }));
    await waitFor(() =>
      expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
    );
    // A previous task feed may already mark these slots done; wait for this batch's saved media.
    await waitFor(() => {
      const saved = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as
        FilmProject | undefined;
      expect(
        saved?.characters
          .find((person) => person.name === "老刀")
          ?.portraits.filter((item) => item.url),
      ).toHaveLength(4);
    });
    expect(screen.getByText(/登录 Grok 会员后才能看到声音名单/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "场景" }));
    fireEvent.click(stageTab("剪辑"));
    fireEvent.click(screen.getByRole("button", { name: "上一个" }));
    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    fireEvent.click(screen.getByRole("button", { name: "设出点" }));
    // 4A-U10: one 重新生成 on the selected part, and no second set of the same actions.
    expect(screen.getAllByRole("button", { name: "重新生成" })).toHaveLength(1);
    for (const gone of ["改描述", "只重做这一段", "生成新版本", "回到分镜重新生成", "换配音字幕"]) {
      expect(screen.queryByRole("button", { name: gone })).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "换配音" }));
    // A version is picked in the picker; the comparison only closes.
    fireEvent.click(screen.getByRole("button", { name: "取消选择" }));
    fireEvent.click(screen.getByRole("button", { name: "设入点" }));
    expect(screen.queryByRole("button", { name: "用新版替换" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保留旧版" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关掉对比" }));
    // 4A-U11: 修改这一段 is part of 属性; the right column is 属性 | AI 助手 like every page.
    expect(screen.queryByRole("button", { name: "修改这一段" })).toBeNull();
    expect(screen.getByLabelText("改这一镜的描述")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "属性" }));
    fireEvent.click(screen.getByRole("button", { name: "取消选择" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByText(/已剪掉这一段/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.click(screen.getByRole("button", { name: "账号" }));
    // 4C-U03: 设置 is real now, in the account menu.
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByText("已退出登录。")).toBeInTheDocument();
    // 4C-U06: renaming lives in 作品设置, not in the menu.
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
    fireEvent.change(screen.getByLabelText("作品名"), { target: { value: "巷战" } });
    fireEvent.click(screen.getByRole("button", { name: "保存名字" }));
    expect(screen.getByText("已改作品名。")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
    expect(await screen.findByText(/已打开第 2 集/)).toBeInTheDocument();
    expect(await screen.findByText(/作品保存在/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
    // 4C-U02: a real 作品设置: where the style is changed, and the work's history.
    const settings = within(screen.getByRole("dialog", { name: "作品设置" }));
    expect(settings.getByRole("button", { name: "去改画风" })).toBeInTheDocument();
    expect(settings.queryByText(/还不能看历史版本/)).toBeNull();
    expect(settings.getByRole("button", { name: "保存当前版本" })).toBeInTheDocument();
    expect(await settings.findByText(/还没有存过的版本/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "i" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "作品设置" })).toBeNull();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
    const center = screen.getByRole("dialog", { name: "后台生成" });
    // Episode B has no jobs; showing A's task list here would be cross-project contamination.
    expect(within(center).getByRole("heading", { name: "现在没有任务" })).toBeInTheDocument();
    expect(within(center).queryByRole("region", { name: "任务列表" })).not.toBeInTheDocument();
    expect(within(center).queryByRole("heading", { name: "巷战" })).not.toBeInTheDocument();
    await waitFor(() => {
      const saved = vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.at(-1)?.[0] as FilmProject;
      expect(saved.id).toBe("film_episode2000000001");
      expect(saved.episodeTitle).toBe("第 2 集");
      expect(saved.seriesTitle).toBe("雨夜巷战");
      expect(saved.title).toBe("雨夜巷战");
      expect(saved.jobs).toEqual([]);
    });
    fireEvent.click(within(center).getByRole("button", { name: "关上后台生成" }));
    expect(screen.queryByRole("dialog", { name: "后台生成" })).toBeNull();
    expect(completeText).toHaveBeenCalled();
  }, 20_000);

  it("generates real takes, joins them, and exports the file", async () => {
    const createStoryFilm = vi.fn(async () => ({
      data: {
        status: "SUCCEEDED",
        message: "",
        output_path: "/tmp/aivora/shot.mp4",
        preview_image: "",
      },
    }));
    const desktop = installDesktop(createStoryFilm);
    await openSample();
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    fireEvent.click(screen.getByRole("button", { name: "5 秒" }));
    fireEvent.click(screen.getByRole("button", { name: "较快的一版" }));
    fireEvent.click(screen.getByRole("button", { name: "直接出成片" }));
    fireEvent.change(screen.getByLabelText("画面描述"), { target: { value: "雨停了" } });
    const counts = screen.getAllByRole("button", { name: "2" });
    fireEvent.click(counts[counts.length - 1]!);
    await adoptOpenStill();
    fireEvent.click(screen.getByRole("button", { name: "生成 2 个版本" }));
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("这一版已经生成。", {}, { timeout: 5_000 })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^用第 \d+ 版$/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "全部镜头" }));
    await adoptListedShots();
    fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(createStoryFilm.mock.calls.length).toBeGreaterThanOrEqual(8));
    fireEvent.click(stageTab("剪辑"));
    await waitFor(() => expect(desktop.assembleFilmProject).toHaveBeenCalled());
    const assemblyProjectId = desktop.assembleFilmProject.mock.calls.at(-1)![0].projectId;
    await waitFor(async () => {
      const stored = await readSaved(assemblyProjectId);
      expect(stored?.assemblyPath).toBe("/tmp/aivora/rough.mp4");
      expect(stored?.jobs.some((job) => job.status === "running" || job.status === "queued")).toBe(
        false,
      );
    });
    expect(desktop.assembleFilm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    desktop.publishFilmExport.mockResolvedValueOnce({ kind: "CANCELLED" });
    const prepareDefault = desktop.prepareFilmExport.getMockImplementation()!;
    let releaseCheck!: () => void;
    const checkHold = new Promise<void>((done) => {
      releaseCheck = done;
    });
    desktop.prepareFilmExport.mockImplementationOnce(async (input) => {
      const checked = await prepareDefault(input);
      expect(checked.kind).toBe("READY");
      await checkHold;
      return checked;
    });
    {
      const silentChoice = screen.queryByRole("button", { name: "本片静音" });
      if (silentChoice) fireEvent.click(silentChoice);
    }
    fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
    await waitFor(() => expect(desktop.prepareFilmExport).toHaveBeenCalledOnce());
    const publishReady = await screen.findByRole("button", { name: "审核后发布" });
    try {
      expect(publishReady).toBeDisabled();
      fireEvent.click(publishReady);
      expect(desktop.publishFilmExport).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        releaseCheck();
        await desktop.prepareFilmExport.mock.results[0]!.value;
      });
    }
    await waitFor(() => expect(publishReady).toBeEnabled());
    fireEvent.click(publishReady);
    await waitFor(() => expect(desktop.publishFilmExport).toHaveBeenCalledTimes(1));
    desktop.publishFilmExport.mockResolvedValueOnce({ kind: "FAILED", code: "PUBLISH_FAILED" });
    fireEvent.click(screen.getByRole("button", { name: "审核后发布" }));
    expect(await screen.findByText(qcFailureText.PUBLISH_FAILED)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消本次导出" }));
    {
      const silentChoice = screen.queryByRole("button", { name: "本片静音" });
      if (silentChoice) fireEvent.click(silentChoice);
    }
    fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
    fireEvent.click(await screen.findByRole("button", { name: "审核后发布" }));
    expect(await screen.findByText(/成片已导出。/)).toBeInTheDocument();
    expect(desktop.exportFilmCut).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "导出成片" });
    expect(within(dialog).getByText("雨夜巷战-第1集.mp4")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "打开文件夹" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "播放" }));
    expect(desktop.revealFilmPath).toHaveBeenCalled();
    expect(desktop.openFilmPath).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  }, 20_000);

  it("pauses a batch, retries a failure, and cancels a running job", async () => {
    let release: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const createStoryFilm = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => pending);
    installDesktop(createStoryFilm);
    await openSample();
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    await adoptOpenStill();
    fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    expect((await screen.findAllByText("没有生成成功，可以重试。")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
    fireEvent.click(screen.getByRole("button", { name: /失败的全部重试/ }));
    expect((await screen.findAllByText(/正在生成|排队中/)).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("button", { name: "全部暂停" }));
    expect(screen.getAllByText(/已经发给 Grok 的那几个可能还会做完/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "停下这一次" }));
    expect(screen.getAllByText(/如果已经发给 Grok，它可能还会做完/).length).toBeGreaterThan(0);
    await act(async () => {
      release({
        data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "关上后台生成" }));
    fireEvent.click(screen.getByRole("button", { name: "全部镜头" }));
    await adoptListedShots();
    fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(statusDetail()).toMatch(/已暂停。点继续再生成剩下的/));
    const saved = () =>
      vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)![0] as FilmProject;
    const before = saved().shots.flatMap((row) => row.takes.map((take) => take.id));
    const queued = saved()
      .shots.flatMap((row) => row.takes)
      .filter((take) => take.status === "queued");
    expect(queued.length).toBeGreaterThan(0);
    const sent = createStoryFilm.mock.calls.length;
    createStoryFilm.mockResolvedValue({
      data: { status: "SUCCEEDED", output_path: "/tmp/resumed.mp4" },
    });
    if (!screen.queryByRole("button", { name: "继续排队" }))
      fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
    fireEvent.click(screen.getByRole("button", { name: "继续排队" }));
    await waitFor(() => expect(createStoryFilm).toHaveBeenCalledTimes(sent + queued.length));
    await waitFor(() =>
      expect(
        saved()
          .shots.flatMap((row) => row.takes)
          .filter((take) => take.status === "done"),
      ).toHaveLength(queued.length),
    );
    expect(saved().shots.flatMap((row) => row.takes.map((take) => take.id))).toEqual(before);
  }, 20_000);

  it("refuses a draft the catalog does not list and a page without a project", async () => {
    const provider = vi.fn();
    installDesktop(provider);
    window.aijianGrok = {
      status: vi.fn(async () => ({
        provider: "GROK_LOGIN",
        runtime: "DESKTOP",
        state: "CONNECTED",
        secureStorage: "AVAILABLE",
        accountLabel: null,
        lastError: null,
      })),
      models: vi.fn(async () => ({
        kind: "OK",
        models: [{ id: "grok-imagine-video-1.5", label: "video" }],
      })),
      completeText: vi.fn(async () => ({ kind: "FAILED" })),
    } as unknown as Window["aijianGrok"];
    await openSample();
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/没有能写字的模型/)).toBeInTheDocument();
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    fireEvent.click(screen.getByRole("button", { name: "较快的一版" }));
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    await adoptOpenStill();
    fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
    expect(
      screen.getByText("快速试做不参考定妆照，人物的脸可能和定妆照不一样。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText(/不能先出草稿/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部镜头" }));
    fireEvent.click(stageTab("剪辑"));
    fireEvent.click(screen.getByRole("button", { name: "设入点" }));
    cleanup();
    window.localStorage.clear();
    const actualModels = window.aijianGrok!.models;
    let releaseModels!: () => void;
    const modelsReady = new Promise<void>((done) => {
      releaseModels = done;
    });
    onTestFinished(() => releaseModels());
    const delayedModels = vi.fn(async () => {
      await modelsReady;
      return actualModels();
    });
    window.aijianGrok = { ...window.aijianGrok!, models: delayedModels };
    render(<ProWorkspace />);
    fireEvent.click(screen.getAllByRole("button", { name: "打开示例" })[0]!);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
        "title",
        "Grok 会员 · 已连接",
      ),
    );
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "off");
    fireEvent.click(
      screen
        .getAllByRole("button")
        .filter((item) => item.className.includes("tab") && item.textContent?.includes("分镜"))[0]!,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "单个镜头" })[0]!);
    await adoptOpenStill();
    vi.mocked(window.aijian!.generateFilmStill!).mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: "生成 1 个版本" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "开始生成" })[0]!);
    expect(await screen.findByText(/模型列表里还没有成片用的视频模型/)).toBeInTheDocument();
    expect(provider).not.toHaveBeenCalled();
    expect(window.aijian!.generateFilmStill).not.toHaveBeenCalled();
    // A connected account is not a completed model catalog. Finishing the real
    // catalog response must not automatically replay that earlier rejected action.
    releaseModels();
    await waitForGenerationCatalog();
    expect(provider).not.toHaveBeenCalled();
    expect(window.aijian!.generateFilmStill).not.toHaveBeenCalled();
    expect(screen.queryByText(/网页里不能直接出片/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "生成 1 个版本" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "开始生成" })[0]!);
    expect(await screen.findByText(/网页里不能直接出片/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
    expect(screen.getAllByText(/网页里不能直接出片/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "再试一次" })[0]!);
    expect((await screen.findAllByText(/网页里不能直接出片/)).length).toBeGreaterThan(0);
    expect(delayedModels).toHaveBeenCalledOnce();
    expect(provider).not.toHaveBeenCalled();
    expect(window.aijian!.generateFilmStill).not.toHaveBeenCalled();
    expect(window.aijian!.prepareFilmGenerationExecution).not.toHaveBeenCalled();
  });

  it("records an undo step and the project menu", async () => {
    const { completeText } = installDesktop();
    render(<ProWorkspace projectId={PROJECT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
    expect(screen.getByText("已新建横屏作品。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "一句故事" } });
    await new Promise((resolve) => setTimeout(resolve, 650));
    fireEvent.click(screen.getAllByRole("button", { name: "撤销" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "重做" })[0]!);
    expect(screen.getByLabelText("这一场")).toHaveValue("一句故事");
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getAllByRole("button", { name: "打开示例" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/导演拆好了/)).toBeInTheDocument();
    expect(completeText).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT_ID }));
    fireEvent.click(screen.getByRole("button", { name: "节奏再快些" }));
    fireEvent.click(screen.getByRole("button", { name: "加一个特写" }));
    pickHelper("导演");
    fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: "再拆一次" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText(/导演拆好了/)).toBeInTheDocument();
    fireEvent.click(stageTab("剪辑"));
    for (const clip of document.querySelectorAll<HTMLButtonElement>(".clip.v"))
      fireEvent.click(clip);
    fireEvent.click(screen.getAllByRole("button", { name: /镜头 1/ })[0]!);
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
    fireEvent.change(screen.getByLabelText("作品名"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "保存名字" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
    expect(screen.getByText(/已新建作品/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "新建横屏" }));
    expect(screen.getByText("已新建横屏作品。写下故事，或打开示例。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "删除这一集" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText(/已删除这一集/)).toBeInTheDocument();
  }, 20_000);

  it("writes a still, keeps the reported length, and plays without a sound device", async () => {
    const generationOrder: string[] = [];
    let playbacks = 0;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {
      playbacks += 1;
      if (playbacks === 1) throw new Error("no device");
    });
    const createStoryFilm = vi.fn(async () => {
      generationOrder.push("provider");
      return {
        data: {
          status: "SUCCEEDED",
          message: "",
          output_path: "/tmp/aivora/shot.mp4",
          preview_image: "https://example.test/frame.png",
          duration_seconds: "4",
        },
      };
    });
    installDesktop(createStoryFilm);
    const captureHistory = window.aijian!.captureFilmHistory!;
    window.aijian!.captureFilmHistory = vi.fn(async (input) => {
      const result = await captureHistory(input);
      if (result.kind === "CAPTURED") generationOrder.push("backup");
      return result;
    });
    let awaitingPortraits = false,
      awaitingGeneration = false;
    let completePortraits!: () => void, failPortraits!: (error: Error) => void;
    const portraitsCompleted = new Promise<void>((resolve, reject) => {
      completePortraits = resolve;
      failPortraits = reject;
    });
    let savePortraits!: () => void;
    const portraitsSaved = new Promise<void>((resolve) => {
      savePortraits = resolve;
    });
    const writeProject = window.aijian!.writeFilmProject!;
    let savedPortraitViews: string[] = [];
    window.aijian!.writeFilmProject = vi.fn(async (...args: Parameters<typeof writeProject>) => {
      const stored = await writeProject(...args);
      const person = (stored as Partial<FilmProject>).characters?.find(
        (person) => person.id === "lin",
      );
      const views = ["正面", "侧面", "背面", "脸部"];
      if (
        views.every((view) =>
          person?.portraits.some((portrait) => portrait.view === view && portrait.url),
        )
      ) {
        savedPortraitViews = views;
        savePortraits();
      }
      return stored;
    });
    let completeGeneration!: () => void, failGeneration!: (error: Error) => void;
    const generationCompleted = new Promise<void>((resolve, reject) => {
      completeGeneration = resolve;
      failGeneration = reject;
    });
    const onGenerationCompleted = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      if (code === "PORTRAIT_DONE" && awaitingPortraits) {
        awaitingPortraits = false;
        completePortraits();
      }
      if (code === "GENERATION_DONE" && awaitingGeneration) {
        awaitingGeneration = false;
        completeGeneration();
      }
      if (
        code &&
        [
          "HISTORY_BACKUP_FAILED",
          "REQUEST_STALE",
          "HISTORY_STALE",
          "GENERATION_SELECTION_STALE",
          "GENERATION_FAILED",
          "PORTRAIT_FAILED",
          "SAVE_FAILED",
        ].includes(code)
      ) {
        const error = new Error(`EXPECTED_ACTION_TERMINATED:${code}`);
        if (awaitingPortraits) {
          awaitingPortraits = false;
          failPortraits(error);
        }
        if (awaitingGeneration) {
          awaitingGeneration = false;
          failGeneration(error);
        }
      }
    };
    window.addEventListener("aivora-notice", onGenerationCompleted);
    const finishWaiting = () => {
      awaitingPortraits = false;
      awaitingGeneration = false;
      window.removeEventListener("aivora-notice", onGenerationCompleted);
      play.mockRestore();
    };
    // Vitest invokes this even if its timeout ends a still-pending action wait.
    onTestFinished(finishWaiting);
    let videos = 0;
    window.aijian = {
      ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
      ...window.aijian!,
      generateFilmStill: vi
        .fn()
        .mockResolvedValueOnce({ path: "/tmp/scene.png", reason: "" })
        .mockResolvedValueOnce({ path: "/tmp/a.png", reason: "" })
        .mockResolvedValueOnce({ path: "", reason: "模型拒绝了这一张。" })
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValueOnce({ path: "/tmp/b.png", reason: "" })
        .mockResolvedValue({ path: "/tmp/c.png", reason: "" }),
      readFilmMedia: vi.fn(async (path: string) => {
        if (path.endsWith("b.png")) return null;
        if (path.endsWith(".mp4")) {
          videos += 1;
          if (videos === 1) throw new Error("read");
        }
        return new Uint8Array([1, 2, 3, 4]);
      }),
    } as unknown as Window["aijian"];
    try {
      await openSample();
      fireEvent.click(stageTab("角色与场景"));
      fireEvent.change(screen.getByLabelText("画风"), { target: { value: "赛博夜景" } });
      fireEvent.click(stageTab("分镜"));
      openGroup("高级");
      fireEvent.change(screen.getByLabelText("这一镜的画风"), { target: { value: "冷色雨夜" } });
      fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
      expect(await screen.findByText(/画面出好了。/)).toBeInTheDocument();
      expect(screen.getAllByText("画面已出").length).toBeGreaterThan(0);
      // 4A-U09: 生成这一场 is the page's primary button; this one is plain.
      expect(screen.getByRole("button", { name: "生成视频" })).not.toHaveClass("primary");
      moreAction("重新生成画面");
      expect(
        await screen.findByText("这张画面未获准生成，请调整画面描述后重试。"),
      ).toBeInTheDocument();
      moreAction("重新生成画面");
      expect(await screen.findByText("画面没出成，可以再试一次。")).toBeInTheDocument();
      moreAction("重新生成画面");
      expect(await screen.findByText(/画面出好了。/)).toBeInTheDocument();
      fireEvent.click(stageTab("角色与场景"));
      awaitingPortraits = true;
      fireEvent.click(screen.getByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ }));
      // Old task-feed success can outlive a project snapshot. Wait for this action
      // and its actual canonical URLs before editing another input or generating video.
      await Promise.all([portraitsCompleted, portraitsSaved]);
      expect(savedPortraitViews).toEqual(["正面", "侧面", "背面", "脸部"]);
      await waitFor(() =>
        expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
      );
      fireEvent.click(stageTab("分镜"));
      fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
      fireEvent.click(screen.getByRole("button", { name: "2 秒" }));
      if (screen.queryByRole("button", { name: "核对并采用" })) {
        fireEvent.click(screen.getByRole("button", { name: "核对并采用" }));
        for (const row of screen.getAllByRole("button", { name: "符合" })) fireEvent.click(row);
        fireEvent.click(screen.getByRole("button", { name: "采用" }));
      }
      await adoptOpenStill();
      fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
      generationOrder.length = 0;
      // Backup and canonical saves legitimately precede the provider. Wait for the
      // action's real completion event, within this test's existing 20s budget.
      awaitingGeneration = true;
      fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
      await generationCompleted;
      expect(await screen.findByText("这一版已经生成。")).toBeInTheDocument();
      expect(createStoryFilm).toHaveBeenCalledTimes(1);
      expect(generationOrder).toEqual(["backup", "provider"]);
      // 4C-U08: nothing in progress: a small button, still named for screen readers.
      expect(screen.getByRole("button", { name: "后台生成：没有在做的" })).toHaveClass("idle");
      const preview = document.querySelector("video.frame");
      if (preview) {
        fireEvent.timeUpdate(preview);
        fireEvent.ended(preview);
        expect(play).toHaveBeenCalled();
      }
      fireEvent.click(screen.getByRole("button", { name: "全部镜头" }));
      expect(screen.getByRole("button", { name: "4 秒" })).toHaveClass("on");
      fireEvent.click(stageTab("剪辑"));
      // 3JR-U02: with one shot made, the shots still to make fold to narrow marks until asked.
      expect(screen.getAllByRole("button", { name: "未生成" }).length).toBeGreaterThan(0);
      expect(screen.queryByText("未生成")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /展开没生成的/ }));
      expect(screen.getAllByText("未生成").length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: "收起没生成的" }));
      fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
      expect(screen.queryByLabelText("导出文件夹")).toBeNull();
      expect(screen.getByText(/审核后选择保存位置/)).toBeInTheDocument();
      {
        const silentChoice = screen.queryByRole("button", { name: "本片静音" });
        if (silentChoice) fireEvent.click(silentChoice);
      }
      fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
      expect(await screen.findByRole("button", { name: "审核后发布" })).toBeDisabled();
      expect(await screen.findByText(qcFailureText.MISSING_MEDIA)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      fireEvent.click(screen.getByRole("button", { name: "设入点" }));
      expect(screen.getByText("左右对比")).toBeInTheDocument();
    } finally {
      finishWaiting();
    }
  }, 20_000);

  it("says when a story is not billed to a project and when no cast is found", async () => {
    installDesktop();
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
        "title",
        "Grok 会员 · 已连接",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/没有记到作品上/)).toBeInTheDocument();
    cleanup();
    window.localStorage.clear();
    const { completeText } = installDesktop();
    completeText.mockImplementation(async ({ text }: { text: string }) => {
      if (text.includes("把这一场拆成镜头")) return { kind: "OK", text: "{不是镜头}" };
      if (text.includes("抽出人物")) return { kind: "FAILED", text: "" };
      return { kind: "OK", text: "好" };
    });
    render(<ProWorkspace projectId={PROJECT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
        "title",
        "Grok 会员 · 已连接",
      ),
    );
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "风吹过屋顶。" } });
    pickHelper("编剧");
    fireEvent.click(screen.getByRole("button", { name: "让编剧分场" }));
    expect(await screen.findByText(/这次回复用不了/)).toBeInTheDocument();
    pickHelper("导演");
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/导演这次没有给出能用的镜头/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放进分镜" })).not.toBeInTheDocument();
    // 4A-U11: no suggestion, no empty card.
    expect(screen.queryByText("还没有建议")).toBeNull();
    expect(document.querySelector(".nx-suggest")).toBeNull();
    completeText.mockImplementation(async ({ text }: { text: string }) => {
      if (text.includes("抽出人物")) {
        return {
          kind: "OK",
          text: '{"characters":[{"name":"林雨","identity":"短发"}],"locations":[{"name":"雨夜巷口","prompt":"夜雨"}]}',
        };
      }
      if (text.includes("把这一场拆成镜头")) {
        return { kind: "OK", text: '{"shots":[{"picture":"她站住","action":"她站住"}]}' };
      }
      return { kind: "OK", text: "好" };
    });
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "她在门口。" } });
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/导演拆好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
    expect(await screen.findByText(/已记下人物：林雨/)).toBeInTheDocument();
  }, 20_000);

  it("shows the text failure, infers a look, and marks a stale queue interrupted", async () => {
    const { completeText, exportFilmCut } = installDesktop();
    type TextReply = {
      kind: string;
      text: string;
      code?: string;
      detail?: string;
      billingAccountKind?: string;
      model?: string;
    };
    const replies: ((value: TextReply) => void)[] = [];
    completeText.mockImplementation(
      () =>
        new Promise<TextReply>((resolve) => {
          replies.push((value) => resolve(value));
        }),
    );
    await openSample();
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    await waitFor(() => expect(replies).toHaveLength(1));
    expect(screen.getByRole("button", { name: /正在写/ })).toBeDisabled();
    expect(completeText.mock.calls[0]?.[0]).toMatchObject({ model: "grok-4.7" });
    replies[0]?.({
      kind: "ERROR",
      code: "TEXT_FAILED",
      billingAccountKind: "grok_login",
      detail: "文本接口返回 404。已改用普通对话再试过。",
      text: "",
    });
    expect(await screen.findByRole("button", { name: "换个问法再问一次" })).toBeInTheDocument();
    // 3J-U04: the retry sits under the failed reply, never in the status bar.
    expect(document.querySelector(".statusbar")?.textContent).not.toContain("再问一次");
    expect(screen.getAllByRole("button", { name: "换个问法再问一次" })).toHaveLength(1);
    expect(completeText).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "换个问法再问一次" }));
    await waitFor(() => expect(replies).toHaveLength(2));
    replies[1]?.({
      kind: "ERROR",
      code: "TEXT_FAILED",
      billingAccountKind: "grok_login",
      detail: "文本接口返回 404。已改用普通对话再试过。",
      text: "",
    });
    expect((await screen.findAllByText(/文本接口返回 404/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/没有修改分镜/)).length).toBeGreaterThan(0);

    completeText.mockImplementation(async ({ text }: { text: string }) => {
      if (text.includes("一句外貌")) {
        return { kind: "OK", text: "年轻女性，二十多岁，黑色长发。", model: "grok-4.7" };
      }
      return { kind: "OK", text: "性别未写明", model: "grok-4.7" };
    });
    fireEvent.click(stageTab("角色与场景"));
    // 3J-U06: 「补这个人的」 goes away once all four are done, so ask the unknown look first.
    const inferLook = completeText.getMockImplementation()!;
    completeText.mockResolvedValue({ kind: "OK", text: "性别未写明", model: "grok-4.7" });
    fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ }));
    expect(await screen.findByText("先写下外貌，再出定妆照。")).toBeInTheDocument();
    completeText.mockImplementation(inferLook);
    fireEvent.click(screen.getByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("外貌")).toHaveValue("年轻女性，二十多岁，黑色长发。"),
    );
    expect(screen.getByLabelText("外貌")).toHaveValue("年轻女性，二十多岁，黑色长发。");
    fireEvent.click(screen.getByRole("button", { name: "场景" }));
    const place = document.querySelector(".scene.place");
    expect(place?.getAttribute("title")).toBe("外景 · 夜");
    expect(place?.textContent).toContain("外景 · 夜");

    fireEvent.click(stageTab("分镜"));
    const size = screen.getByLabelText("景别");
    size.focus();
    fireEvent.keyDown(size, { key: "2" });
    expect(screen.getByLabelText("景别")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "5 秒" })[0]!);
    expect(screen.getAllByRole("button", { name: "5 秒" })[0]).toHaveClass("on");

    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    expect(screen.getByText("雨夜巷战-第1集.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(exportFilmCut).not.toHaveBeenCalled();

    const queued = sampleFilm();
    queued.id = "film_episode2000000001";
    queued.episodeTitle = "第 2 集";
    queued.jobs = [
      {
        id: "job-1",
        shotId: queued.shots[0]!.id,
        kind: "video",
        take: 1,
        status: "queued",
        prompt: "",
        reason: "",
      },
    ];
    window.aijian = {
      ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
      ...window.aijian!,
      readFilmProject: vi.fn(async () => queued),
    } as unknown as Window["aijian"];
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
    expect(await screen.findByText(/已标成已中断|上次关软件时还有镜头没做完/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "后台生成：没有在做的" })).toHaveClass("idle");
    fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
    expect(screen.getByRole("button", { name: /已中断/ })).toBeInTheDocument();
  }, 20_000);

  it("plays the open shot once and pauses on the next click", async () => {
    let paused = true;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {
      paused = false;
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
      paused = true;
    });
    const previous = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "paused");
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return paused;
      },
    });
    const createStoryFilm = vi.fn(async () => ({
      data: {
        status: "SUCCEEDED",
        message: "",
        output_path: "/tmp/aivora/shot.mp4",
        preview_image: "",
        duration_seconds: "2",
      },
    }));
    installDesktop(createStoryFilm);
    try {
      await openSample();
      fireEvent.click(stageTab("分镜"));
      fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
      fireEvent.click(screen.getByRole("button", { name: "1" }));
      await adoptOpenStill();
      fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
      fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
      await waitFor(() => expect(play).toHaveBeenCalled());
      fireEvent.click(stageTab("剪辑"));
      expect(screen.getAllByRole("button", { name: "暂停" }).length).toBeGreaterThan(0);
      const started = play.mock.calls.length;
      fireEvent.click(screen.getAllByRole("button", { name: "暂停" })[0]!);
      expect(pause).toHaveBeenCalled();
      expect(screen.getAllByRole("button", { name: "播放" }).length).toBeGreaterThan(0);
      const preview = document.querySelector("video.frame");
      if (preview) fireEvent.ended(preview);
      expect(play.mock.calls.length).toBe(started);
    } finally {
      play.mockRestore();
      pause.mockRestore();
      if (previous) Object.defineProperty(HTMLMediaElement.prototype, "paused", previous);
    }
  }, 20_000);
});

it("keeps a focused duration field, a full shot list, and a typed export path", async () => {
  const { completeText, pickFilmFolder } = installDesktop();
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("把这一场拆成镜头")) {
      const shots = Array.from({ length: 9 }, (_, index) => ({
        picture: `第${index + 1}镜的巷口`,
        size: index === 0 ? "插入" : "中景",
        seconds: 2,
      }));
      return { kind: "OK", text: JSON.stringify({ shots }) };
    }
    return { kind: "OK", text: "好", model: "grok-4.7" };
  });
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  expect(await screen.findByText(/导演拆好了/)).toBeInTheDocument();
  // 4A-U11: the suggestion lists every new shot against the scene's shots now.
  expect(
    document.querySelectorAll(".nx-suggest-row:not([data-kind=removed])").length,
  ).toBeLessThanOrEqual(9);
  for (let index = 1; index <= 9; index += 1)
    expect(document.querySelector(".nx-suggest-rows")?.textContent).toContain(`第${index}镜的巷口`);
  fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "自定义" }));
  const box = screen.getByLabelText("时长秒数");
  box.focus();
  if (box instanceof HTMLInputElement) box.select();
  fireEvent.keyDown(box, { key: "2" });
  fireEvent.keyDown(window, { key: "2", isComposing: true });
  fireEvent.keyDown(window, { key: "Process", keyCode: 229 });
  expect(stageTab("分镜").className.split(/\s+/)).toContain("on");
  expect(stageTab("角色与场景").className.split(/\s+/)).not.toContain("on");
  expect(screen.getByLabelText("景别")).toHaveValue("特写");
  expect(screen.getByText("镜头类型：插入")).toBeInTheDocument();
  fireEvent.click(stageTab("剪辑"));
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  expect(screen.queryByLabelText("导出文件夹")).toBeNull();
  expect(screen.getByText(/审核后选择保存位置/)).toBeInTheDocument();
  expect(pickFilmFolder).not.toHaveBeenCalled();
}, 20_000);

it("runs the seven agents, confirms a portrait, and times a shot from the line", async () => {
  const artSpy = vi.spyOn(artTransactions, "prepareArtTransaction");
  onTestFinished(() => artSpy.mockRestore());
  const { completeText } = installDesktop();
  const speak = vi.fn(async () => ({
    kind: "OK",
    audioBase64: "QQ==",
    mime: "audio/mpeg",
    seconds: 1.2,
    timestamps: [{ text: "雨", seconds: 0.1 }],
  }));
  window.aijianGrok = {
    ...window.aijianGrok!,
    models: vi.fn(async () => ({
      kind: "OK" as const,
      models: [
        { id: "grok-imagine-video-1.5", label: "video" },
        { id: "grok-imagine-video-1.5-lite", label: "lite" },
        { id: "grok-imagine-video", label: "edit" },
        { id: "grok-4.7", label: "text" },
        { id: "grok-imagine-image-2.0", label: "image" },
        { id: "leo", label: "leo", outputModalities: ["audio"] },
      ],
    })),
    speak,
  } as unknown as Window["aijianGrok"];
  window.aijian = {
    ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
    ...window.aijian!,
    generateFilmStill: vi.fn(async () => ({ path: "/tmp/aivora/still.png", reason: "" })),
  } as unknown as Window["aijian"];
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("写出画风")) {
      return {
        kind: "OK",
        text: JSON.stringify({
          prompt_block_zh: "雨夜冷色",
          identities: [{ name: "林骁", identity: "林骁，短发被雨打湿，黑外套。" }],
          locations: [{ name: "巷口", prompt: "湿漉漉的巷口", ambience: "雨声" }],
          props: [{ name: "铁棍", note: "落进积水" }],
        }),
      };
    }
    if (text.includes("写成这一镜的提示词")) {
      return {
        kind: "OK",
        text: JSON.stringify({ prompt_zh: "巷口，雨水。", prompt_en: "A wet alley." }),
      };
    }
    if (text.includes("只审文字")) {
      return {
        kind: "OK",
        text: JSON.stringify({ verdict: "文字能拍", issues: ["雨声没写进声音计划"] }),
      };
    }
    if (text.includes("把这一场拆成镜头")) {
      return {
        kind: "OK",
        text: '{"shots":[{"picture":"抬眼看向巷口","size":"近景","seconds":3,"line":"雨太大，我听不清。"}]}',
      };
    }
    if (text.includes("写成短剧") || text.includes("改成短剧")) {
      return {
        kind: "OK",
        text: '{"scenes":[{"title":"雨停","place":"巷口","time":"黎明","text":"雨停了。林骁说：雨太大，我听不清。"}]}',
      };
    }
    return { kind: "OK", text: "他抬手。停住。" };
  });
  const RealAudio = window.Audio;
  class StubAudio {
    duration = 1.2;
    onloadedmetadata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(async () => undefined);
    constructor() {
      setTimeout(() => this.onloadedmetadata?.(), 0);
    }
  }
  window.Audio = StubAudio as unknown as typeof Audio;
  const createUrl = URL.createObjectURL;
  URL.createObjectURL = () => "blob:phase2";
  try {
    await openSample();
    const helpers = screen.getByLabelText("正在和：") as HTMLSelectElement;
    expect([...helpers.options].map((item) => item.textContent)).toEqual([
      "编剧",
      "导演",
      "动作指导",
      "表演指导",
      "美术",
    ]);
    pickHelper("美术");
    fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
    await screen.findByRole("button", { name: "确认修改" });
    const art = artSpy.mock.results.filter((result) => result.type === "return").at(-1)!.value;
    const base = artSpy.mock.calls.at(-1)![0];
    const pure = artTransactions.applyArtTransaction(base, art);
    expect(pure.receipt).not.toBeNull();
    const risks = Number(
      art.recomputeCostumes &&
        JSON.stringify(base.costumeRisks) !== JSON.stringify(pure.film.costumeRisks),
    );
    expect(
      within(screen.getByRole("list", { name: "字段改动" })).getAllByRole("listitem"),
    ).toHaveLength(art.changes.length + art.additions.length + risks);
    const saved = () =>
      vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.map(([value]) => value as FilmProject)
        .filter((value) => value.id === base.id)
        .at(-1)!;
    await waitFor(() => {
      expect(saved()).toBeDefined();
      for (const change of art.changes) {
        const target = change.target;
        const row =
          target.collection === "project"
            ? saved()
            : saved()[target.collection].find((item) => item.id === target.id)!;
        expect(Object.hasOwn(row, change.field)).toBe(change.before.present);
        expect((row as unknown as Record<string, unknown>)[change.field]).toEqual(
          change.before.value,
        );
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    expect(await screen.findByText("全项目美术字段已修改。")).toBeInTheDocument();
    for (const change of art.changes) {
      const target = change.target;
      const row =
        target.collection === "project"
          ? saved()
          : saved()[target.collection].find((item) => item.id === target.id)!;
      expect(Object.hasOwn(row, change.field)).toBe(change.after.present);
      expect((row as unknown as Record<string, unknown>)[change.field]).toEqual(change.after.value);
    }
    for (const addition of art.additions)
      expect(saved()[addition.collection]).toContainEqual(addition.row);
    openBoardTools();
    fireEvent.click(screen.getByRole("button", { name: "写英文画面说明" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认修改" }));
    expect(await screen.findAllByText(/画面说明已修改/)).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "审一下这一镜的文字" }));
    expect(await screen.findByText(/没有看画面，版本仍由你选/)).toBeInTheDocument();
    openGroup("高级");
    fireEvent.click(screen.getByRole("button", { name: /镜头 4/ }));
    fireEvent.click(screen.getByRole("button", { name: "按台词定时长" }));
    expect(await screen.findByText(/按配音长度/)).toBeInTheDocument();
    expect(speak).toHaveBeenCalled();
    openGroup("高级");
    expect(screen.getByText("还没有英文画面说明。可以让「画面说明」助手写。")).toBeInTheDocument();
    moreAction("出 4 张候选");
    expect(document.querySelector(".statusbar")?.textContent).toMatch(/确认这 4 张/);
    fireEvent.click(screen.getByRole("button", { name: "确认这 4 张" }));
    expect(await screen.findByText(/4 张候选画面已生成/)).toBeInTheDocument();
    fireEvent.click(stageTab("角色与场景"));
    fireEvent.click(screen.getByRole("button", { name: "道具" }));
    const propBox = screen.getByLabelText("道具名字");
    fireEvent.change(propBox, { target: { value: "雨伞" } });
    fireEvent.keyDown(propBox, { key: "Enter" });
    expect(await screen.findByText("雨伞")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "场景" }));
    fireEvent.change(screen.getByLabelText("环境音"), { target: { value: "雨声" } });
    expect(screen.getByLabelText("环境音")).toHaveValue("雨声");
    // 3JR-U03: the person's form, and its 补齐…的定妆照, belong to the 角色 tab.
    expect(screen.queryByRole("button", { name: /^补齐.+的定妆照/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "角色" }));
    fireEvent.click(screen.getByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ }));
    await waitFor(() =>
      expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
    );
    await waitFor(() =>
      expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
    );
    // 4A-U10: the sound switch is on the player now; M works on every page.
    expect(screen.queryByRole("button", { name: /^声音(开|关)$/ })).toBeNull();
    fireEvent.keyDown(window, { key: "m" });
    fireEvent.click(screen.getByRole("button", { name: "试听旁白" }));
    expect(await screen.findByText(/声音关着/)).toBeInTheDocument();
    fireEvent.click(stageTab("剧本"));
    fireEvent.click(screen.getByRole("button", { name: "一键成片" }));
    await expectSavedPipelineCode("SCRIPT_COVERAGE_REVIEW");
    expect(window.aijian!.createStoryFilm).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "继续生成" })).toBeNull();
  } finally {
    window.Audio = RealAudio;
    URL.createObjectURL = createUrl;
  }
}, 20_000);

it("asks before a portrait, and splits a line that will not fit in 15 seconds", async () => {
  const { completeText } = installDesktop();
  let mode = "infer";
  const speak = vi.fn(async () =>
    mode === "play"
      ? {
          kind: "OK",
          audioBase64: "QQ==",
          mime: "audio/mpeg",
          seconds: 1,
          timestamps: [],
        }
      : { kind: "FAILED", detail: "配音没有成功。", code: "TEXT_FAILED" },
  );
  window.aijianGrok = {
    ...window.aijianGrok!,
    models: vi.fn(async () => ({
      kind: "OK" as const,
      models: [
        { id: "grok-imagine-video-1.5", label: "video" },
        { id: "grok-4.7", label: "text" },
        { id: "leo", label: "leo", outputModalities: ["audio"] },
      ],
    })),
    speak,
  } as unknown as Window["aijianGrok"];
  const spoken = "雨".repeat(80);
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("一句外貌")) {
      return {
        kind: "OK",
        text: mode === "unknown" ? "性别未写明" : "林骁，男性，约二十八岁，短发。",
      };
    }
    if (text.includes("把这一场拆成镜头") && mode === "split") {
      return {
        kind: "OK",
        text: JSON.stringify({
          shots: [{ picture: "长台词", size: "近景", seconds: 3, line: spoken }],
        }),
      };
    }
    if (
      text.includes("写出画风") ||
      text.includes("写成这一镜的提示词") ||
      text.includes("只审文字") ||
      text.includes("把这一场拆成镜头")
    ) {
      return { kind: "OK", text: "不是格式" };
    }
    return { kind: "OK", text: "好" };
  });
  await openSample();
  fireEvent.click(stageTab("角色与场景"));
  // 3J-U06: 「补这个人的」 goes away once all four are done, so ask the unknown look first.
  mode = "unknown";
  fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ }));
  expect(await screen.findByText("先写下外貌，再出定妆照。")).toBeInTheDocument();
  mode = "infer";
  fireEvent.click(screen.getByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ }));
  await waitFor(() =>
    expect(screen.getByLabelText("外貌")).toHaveValue("林骁，男性，约二十八岁，短发。"),
  );
  fireEvent.change(screen.getByLabelText("角色声音"), { target: { value: "leo" } });
  fireEvent.change(screen.getByLabelText("旁白声音"), { target: { value: "leo" } });
  fireEvent.click(stageTab("剧本"));
  mode = "split";
  fireEvent.click(screen.getByRole("button", { name: "加一场" }));
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: `林骁：“${spoken}”` } });
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  expect(await screen.findByText(/导演拆好了/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "按台词定时长" }));
  await waitFor(() =>
    expect(document.querySelector(".statusbar")?.textContent ?? "").toMatch(/拆成两镜/),
  );
  const beforeSplit = structuredClone(
    vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)![0] as FilmProject,
  );
  const splitTarget = beforeSplit.shots.find((item) => item.line === spoken)!;
  expect(splitTarget).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
  await waitFor(() => {
    const after = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)![0] as FilmProject;
    expect(after.shots).toHaveLength(beforeSplit.shots.length + 1);
    expect(
      after.shots
        .filter((item) => item.sceneId === splitTarget.sceneId)
        .map((item) => item.line)
        .join(""),
    ).toBe(spoken);
    for (const other of beforeSplit.shots.filter((item) => item.id !== splitTarget.id))
      expect(after.shots.some((item) => item.id === other.id)).toBe(true);
  });

  pickHelper("美术");
  fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
  expect(await screen.findByText(/美术这次没写完.*本次没有修改作品/)).toBeInTheDocument();
  openBoardTools();
  fireEvent.click(screen.getByRole("button", { name: "写英文画面说明" }));
  expect(await screen.findByText(/画面说明这次没写完.*本次没有修改画面说明/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "审一下这一镜的文字" }));
  expect(await screen.findByText(/还不能看画面/)).toBeInTheDocument();
  fireEvent.click(stageTab("剧本"));
  fireEvent.click(screen.getByRole("button", { name: /巷战·初交手/ }));
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: /镜头 2/ }));
  fireEvent.click(screen.getByRole("button", { name: "按台词定时长" }));
  expect(document.querySelector(".statusbar")?.textContent).toMatch(/这一镜没有台词/);
  fireEvent.click(screen.getByRole("button", { name: /镜头 1/ }));
  fireEvent.click(screen.getByRole("button", { name: "自定义" }));
  fireEvent.change(screen.getByLabelText("时长秒数"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "按台词定时长" }));
  expect(await screen.findByText(/没有覆盖/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("声音来源"), { target: { value: "dub" } });
  fireEvent.change(screen.getByLabelText("配乐情绪"), { target: { value: "紧张" } });
  fireEvent.change(screen.getByLabelText("这一镜的环境音"), { target: { value: "雨声" } });
  fireEvent.click(stageTab("剧本"));
  mode = "bad";
  pickHelper("美术");
  fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
  expect(await screen.findByText(/美术这次没写完.*本次没有修改作品/)).toBeInTheDocument();
  openBoardTools();
  fireEvent.click(screen.getByRole("button", { name: "写英文画面说明" }));
  expect(await screen.findByText(/画面说明这次没写完.*本次没有修改画面说明/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "审一下这一镜的文字" }));
  expect(await screen.findByText(/还不能看画面/)).toBeInTheDocument();
  fireEvent.click(stageTab("剧本"));
  const beforeSend = completeText.mock.calls.length;
  for (const roleName of ["动作指导", "表演指导", "美术"]) {
    pickHelper(roleName);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送" }));
    });
  }
  await waitFor(() =>
    expect(completeText.mock.calls.length).toBeGreaterThanOrEqual(beforeSend + 3),
  );
  expect((await screen.findAllByText(/美术这次没写完.*本次没有修改作品/)).length).toBeGreaterThan(
    0,
  );
  fireEvent.click(screen.getByRole("button", { name: "一键成片" }));
  await expectSavedPipelineCode("WRITER_PARSE_FAILED");
  expect(window.aijian!.createStoryFilm).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "继续生成" })).toBeNull();
  mode = "play";
  const RealAudio = window.Audio;
  let metadataFailure = false;
  class SilentAudio {
    onloadedmetadata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(async () => {
      throw new Error("blocked");
    });
    constructor() {
      setTimeout(() => (metadataFailure ? this.onerror?.() : this.onloadedmetadata?.()), 0);
    }
  }
  window.Audio = SilentAudio as unknown as typeof Audio;
  const createUrl = URL.createObjectURL;
  URL.createObjectURL = () => "blob:phase2";
  try {
    fireEvent.click(stageTab("角色与场景"));
    if (window.localStorage.getItem("aivora.sound") === "off") {
      fireEvent.keyDown(window, { key: "m" });
    }
    fireEvent.click(screen.getByRole("button", { name: "试听" }));
    expect(await screen.findByText(/没有播出来/)).toBeInTheDocument();
    const beforeMetadataFailure = speak.mock.calls.length;
    metadataFailure = true;
    fireEvent.click(screen.getByRole("button", { name: "试听" }));
    await waitFor(() => expect(speak.mock.calls.length).toBe(beforeMetadataFailure + 1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "试听" })).toHaveTextContent("试听"),
    );
    // An OK speech response whose audio cannot load is not a generation failure.
    expect(await screen.findByText(/配音文件到了，这一页没有播出来/)).toBeInTheDocument();
    expect(screen.queryByText("配音没有成功，可以重试。")).toBeNull();
  } finally {
    window.Audio = RealAudio;
    URL.createObjectURL = createUrl;
  }
}, 20_000);

it("asks action and performance, then writes those fields on the shot", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: "给这一镜设计动作" } });
  pickHelper("动作指导");
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(await screen.findByText("给这一镜设计动作")).toBeInTheDocument();
  expect((await screen.findAllByText(/动作指导写好了/)).length).toBeGreaterThan(0);
  expect(screen.getByText(/稳 · 他抬手/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  expect((screen.getByLabelText("动作要点") as HTMLTextAreaElement).value).toBe(
    sampleFilm().shots[0]!.action,
  );
  await waitFor(() => {
    const writes = vi.mocked(window.aijian!.writeFilmProject!).mock.calls;
    const saved = writes.at(-1)?.[0] as FilmProject | undefined;
    expect(saved?.shots[0]?.actionBeats).toContain("他抬手");
    expect(saved?.shots[0]?.actionBeats?.join("\n")).not.toContain("另一人翻越高墙");
  });
  expect((screen.getByLabelText("动作要点") as HTMLTextAreaElement).value).not.toContain(
    "来自动作指导",
  );
  fireEvent.change(screen.getByLabelText("站位"), { target: { value: "林骁在画左" } });
  fireEvent.change(screen.getByLabelText("朝向"), { target: { value: "看向画右" } });
  expect(screen.getByLabelText("站位")).toHaveValue("林骁在画左");
  expect(screen.getByLabelText("朝向")).toHaveValue("看向画右");
  expect(screen.getAllByText("外貌已锁").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: "写这一镜的表演" } });
  pickHelper("表演指导");
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(await screen.findByText("写这一镜的表演")).toBeInTheDocument();
  expect((await screen.findAllByText(/表演指导写好了/)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  expect((screen.getByLabelText("表演") as HTMLTextAreaElement).value).toContain("眼神一沉");
  expect((screen.getByLabelText("表演") as HTMLTextAreaElement).value).not.toContain(
    "来自表演指导",
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.some(([film]) =>
          (film as ReturnType<typeof sampleFilm>).shots.some(
            (shot) => shot.performanceSource === "agent:performance",
          ),
        ),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
  fireEvent.change(screen.getByLabelText("作品名"), { target: { value: "雨夜巷战测试" } });
  fireEvent.keyDown(screen.getByLabelText("作品名"), { key: "Enter" });
  expect(screen.getByRole("button", { name: "作品" }).textContent).toContain("雨夜巷战测试");
});

it("warns about a scene end with no shot and lets an unplaced action go onto a shot", async () => {
  const film = sampleFilm();
  const scene = film.scenes.find((item) => item.id === "02")!;
  // An ending no sample shot shows (3JR-B03: 「林骁侧身让过铁棍」 is shot by 镜头 5).
  scene.text = `${scene.text}\n巷口亮起警灯，打手们四散逃开。`;
  scene.coverage = {
    sceneId: "02",
    ok: false,
    lastLine: "雨太大，我听不清。",
    missingLines: [],
    missingTail: "巷口亮起警灯，打手们四散逃开。",
  };
  film.unassignedBeats = [
    { sceneId: "02", text: "林骁抹掉脸上的雨水" },
    { sceneId: "02", text: "刀疤挥铁棍砸向林骁" },
    { sceneId: "01", text: "别的场的动作" },
  ];
  window.aijian = {
    ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
    listFilmSeries: vi.fn(async () => [
      { id: film.seriesId, title: film.title, savedAt: "", path: "/tmp/aivora/films" },
    ]),
    readFilmProject: vi.fn(async () => film),
    writeFilmProject: vi.fn(async (value: unknown) => value),
  } as unknown as Window["aijian"];
  render(<ProWorkspace />);
  await screen.findAllByText(film.title);
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: /巷战·初交手/ }));
  expect(
    await screen.findByText("这一场结尾还没拍到：「巷口亮起警灯，打手们四散逃开。」"),
  ).toBeInTheDocument();
  expect(screen.getByText("有 2 个动作没对上镜头")).toBeInTheDocument();
  // A drag from another scene must never use this scene's same numeric index.
  const firstCard = document.querySelector(".pb.grid .card")!;
  fireEvent.drop(firstCard, {
    dataTransfer: {
      getData: () =>
        JSON.stringify({ scope: `${film.id}:01`, index: 0, text: "林骁抹掉脸上的雨水" }),
    },
  });
  expect(screen.getByText("有 2 个动作没对上镜头")).toBeInTheDocument();
  // A dialogue shot (镜头 3) does not take a fight action: GPT's rule decides.
  const cards = () => [...document.querySelectorAll<HTMLElement>(".pb.grid .card")];
  const drop = (index: number, beat: number) =>
    fireEvent.drop(cards()[index]!, {
      dataTransfer: {
        getData: (type: string) =>
          type === BEAT_DRAG_TYPE
            ? JSON.stringify({
                scope: `${film.id}:02`,
                index: beat,
                text: film.unassignedBeats![beat]!.text,
              })
            : "",
      },
    });
  drop(2, 1);
  expect(await screen.findByText(/镜头 3 的画面里没有打斗，放不了这个动作/)).toBeInTheDocument();
  expect(screen.getByText("有 2 个动作没对上镜头")).toBeInTheDocument();
  // An ordinary action goes onto the picked shot with the button.
  fireEvent.click(cards()[3]!);
  fireEvent.click(screen.getAllByRole("button", { name: "放到镜头 4" })[0]!);
  expect(await screen.findByText("已放到镜头 4。")).toBeInTheDocument();
  expect(screen.getByText("有 1 个动作没对上镜头")).toBeInTheDocument();
  // 「补上结尾」 asks GPT's fixCoverage; without a sign-in the end stays missing and says so.
  fireEvent.click(screen.getByRole("button", { name: "补上结尾" }));
  await waitFor(() =>
    expect(document.querySelector(".status-note")?.textContent).toMatch(/有的场还有内容没拍到/),
  );
  expect(screen.getByRole("button", { name: "补上结尾" })).toBeEnabled();
});

it("keeps the style of the whole work above the characters and warns which shots it no longer matches", async () => {
  const film = sampleFilm();
  const shot = film.shots[0]!;
  shot.takes = [
    {
      id: "take-made",
      shotId: shot.id,
      index: 1,
      status: "done",
      stillUrl: "",
      videoPath: "/tmp/a.mp4",
      videoUrl: "file:///tmp/a.mp4",
      prompt: film.styleZh,
      createdAt: "",
      reason: "",
    },
  ];
  shot.selectedTakeId = "take-made";
  // GPT's setFilmStyle marks every shot; only the made one counts.
  for (const item of film.shots)
    Object.assign(item, { regenerationRequired: { code: "STYLE_CHANGED", styleRevision: 2 } });
  window.aijian = {
    ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
    listFilmSeries: vi.fn(async () => [
      { id: film.seriesId, title: film.title, savedAt: "", path: "/tmp/aivora/films" },
    ]),
    readFilmProject: vi.fn(async () => film),
    writeFilmProject: vi.fn(async (value: unknown) => value),
  } as unknown as Window["aijian"];
  render(<ProWorkspace />);
  await screen.findAllByText(film.title);
  fireEvent.click(stageTab("角色与场景"));
  const card = screen.getByRole("region", { name: "整部作品的画风" });
  expect(within(card).getByLabelText("画风")).toBeInTheDocument();
  expect(within(card).getByLabelText("画风说明")).toHaveValue(film.styleZh);
  expect(
    screen.getByText("已有 1 个镜头是按原来的画风做的，要重新生成才会变。"),
  ).toBeInTheDocument();
  expect(document.querySelector(".cast-info #style-preset")).toBeNull();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: /巷战·初交手/ }));
  expect(screen.getAllByText("画风变了")).toHaveLength(1);
});

it("puts a yellow dot on a shot with a continuity reminder and explains it in 属性 (4A-U05)", async () => {
  const film = sampleFilm();
  // The host now runs real continuity rules on load; make every shot's appearance
  // complete so this fixture isolates the one deliberately supplied prop reminder.
  for (const shot of film.shots) {
    shot.promptZh = [
      shot.picture,
      ...film.characters
        .filter((person) => shot.characters.includes(person.name))
        .map((person) => person.identity),
    ].join("。");
  }
  Object.assign(film.shots[1]!, {
    continuity: [{ kind: "prop", text: "刀上一镜在左手，这一镜到了右手。" }],
  });
  window.aijian = {
    ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
    listFilmSeries: vi.fn(async () => [
      { id: film.seriesId, title: film.title, savedAt: "", path: "/tmp/aivora/films" },
    ]),
    readFilmProject: vi.fn(async () => film),
    writeFilmProject: vi.fn(async (value: unknown) => value),
  } as unknown as Window["aijian"];
  render(<ProWorkspace />);
  await screen.findAllByText(film.title);
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: /巷战·初交手/ }));
  const dots = screen.getAllByRole("img", { name: "有 1 条场记提醒" });
  expect(dots).toHaveLength(1);
  expect(dots[0]).toHaveAttribute("title", "道具前后对不上：刀上一镜在左手，这一镜到了右手。");
  fireEvent.click(document.querySelectorAll<HTMLElement>(".pb.grid .card")[1]!);
  const notes = screen.getByRole("region", { name: "场记提醒" });
  expect(notes).toHaveTextContent("道具前后对不上刀上一镜在左手，这一镜到了右手。");
  fireEvent.click(document.querySelectorAll<HTMLElement>(".pb.grid .card")[0]!);
  expect(screen.queryByRole("region", { name: "场记提醒" })).toBeNull();
});

it("ticks a stage only when it is done, hides an idle progress bar, and points to real buttons", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  // UIR-06: the sample has no portraits, so 角色与场景 is not ticked even when passed.
  const cast = stageTab("角色与场景");
  expect(cast).not.toHaveClass("done");
  expect(cast.querySelector(".tab-count")?.textContent).toMatch(/^0\/\d+$/);
  // UIR-04: nothing is being made, so there is no progress bar.
  expect(document.querySelector(".statusbar .bar")).toBeNull();
  // UIR-05: the empty 单镜 says where the button is, once.
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  expect(screen.getByText("还没有版本。在右边点「生成 1 个版本」。")).toBeInTheDocument();
  expect(screen.queryByText("还没有版本")).toBeNull();
  expect(screen.getByRole("button", { name: "生成 1 个版本" })).toBeInTheDocument();
});

it("closes 「更多」 on Esc, a press outside, and another shot; closes the top menus too", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  const more = () => screen.getByRole("button", { name: "更多操作" });
  const menu = () => screen.queryByRole("menu", { name: "这一镜的更多操作" });
  fireEvent.click(more());
  expect(menu()).toBeInTheDocument();
  expect(menu()?.querySelector('[role="separator"] + .danger')).toHaveTextContent("删除这一镜");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(menu()).toBeNull();
  fireEvent.click(more());
  fireEvent.pointerDown(document.querySelector(".pb.grid")!);
  expect(menu()).toBeNull();
  fireEvent.click(more());
  fireEvent.click(document.querySelectorAll<HTMLElement>(".pb.grid .card")[1]!);
  expect(menu()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  expect(screen.getByRole("menu", { name: "作品菜单" })).toBeInTheDocument();
  fireEvent.pointerDown(document.querySelector(".pb.grid")!);
  expect(screen.queryByRole("menu", { name: "作品菜单" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "账号" }));
  expect(screen.getByRole("menu", { name: "账号菜单" })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("menu", { name: "账号菜单" })).toBeNull();
});

it("follows the work's aspect and offers 比例 only where the desktop can crop (4A-U07)", async () => {
  installDesktop();
  const qcBridge = window.aijian!.prepareFilmExport;
  delete window.aijian!.prepareFilmExport;
  await openSample();
  const root = document.querySelector(".pro-root")!;
  expect(["9:16", "16:9"]).toContain(root.getAttribute("data-aspect"));
  fireEvent.click(screen.getByRole("button", { name: /导出成片/ }));
  expect(screen.queryByLabelText("比例")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  Object.assign(window.aijian!, { prepareFilmExport: qcBridge });
  fireEvent.click(screen.getByRole("button", { name: /导出成片/ }));
  const aspect = screen.getByLabelText("比例") as HTMLSelectElement;
  expect([...aspect.options].map((option) => option.textContent)).toEqual(
    root.getAttribute("data-aspect") === "16:9"
      ? ["横屏 16:9（作品的画幅）", "竖屏 9:16（从画面中间裁）", "两种都要"]
      : ["竖屏 9:16（作品的画幅）", "横屏 16:9（从画面中间裁）", "两种都要"],
  );
  fireEvent.change(aspect, { target: { value: "both" } });
  expect(aspect).toHaveValue("both");
});

it("opens 后台生成 as a drawer that closes on a press outside it (4A-U04)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
  expect(screen.getByRole("dialog", { name: "后台生成" })).toBeInTheDocument();
  fireEvent.pointerDown(
    within(screen.getByRole("dialog", { name: "后台生成" })).getByText("后台生成"),
  );
  expect(screen.getByRole("dialog", { name: "后台生成" })).toBeInTheDocument();
  fireEvent.pointerDown(document.querySelector(".topbar")!);
  expect(screen.queryByRole("dialog", { name: "后台生成" })).toBeNull();
});

it("makes every missing portrait from one button and shows each slot's state", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("角色与场景"));
  const all = screen.getByRole("button", { name: "给所有人出定妆照" });
  expect(all).toHaveClass("primary");
  expect(screen.queryByRole("button", { name: "生成定妆照" })).toBeNull();
  expect(screen.queryByRole("button", { name: "补全缺少的定妆照" })).toBeNull();
  expect(document.querySelectorAll(".slot-empty")).toHaveLength(4);
  // 4A-U06: the front is the big one; the other three are made from it.
  expect(document.querySelector(".slot.front")).toHaveTextContent("正面");
  expect(screen.getByText(/侧面、背面、脸部按正面这张改出来/)).toBeInTheDocument();
  expect(document.querySelector(".refs4 .rain")).toBeNull();
  fireEvent.click(all);
  await waitFor(() => expect(screen.getAllByText("已完成")).toHaveLength(4));
  await waitFor(() =>
    expect(document.querySelector(".portrait-progress")).toHaveTextContent("都齐了"),
  );
  // 3J-U19: a coded message is one sentence; the counts stay in the tooltip.
  expect(document.querySelector(".status-note")?.textContent ?? "").not.toMatch(/\d+\/\d+/);
  // 4A-U09: everyone is done, so the one primary button moves on to the storyboard.
  expect(screen.queryByRole("button", { name: "给所有人出定妆照" })).toBeNull();
  expect(screen.getByRole("button", { name: "下一步：分镜" })).toHaveClass("primary");
  expect(screen.queryByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ })).toBeNull();
  expect(screen.getAllByText("定妆照齐了").length).toBeGreaterThan(0);
});

it("lets the character page set gender and age, and lists only voices of that gender", async () => {
  installDesktop();
  window.aijianGrok = {
    ...window.aijianGrok!,
    models: vi.fn(async () => ({
      kind: "OK" as const,
      models: [
        { id: "grok-imagine-video-1.5", label: "video" },
        { id: "grok-4.7", label: "text" },
        { id: "leo", label: "leo", outputModalities: ["audio"] },
        { id: "orion", label: "orion", outputModalities: ["audio"] },
        { id: "ara", label: "ara", outputModalities: ["audio"] },
      ],
    })),
  } as unknown as Window["aijianGrok"];
  await openSample();
  fireEvent.click(stageTab("角色与场景"));
  const voiceIds = () =>
    [...(screen.getByLabelText("角色声音") as HTMLSelectElement).options]
      .map((option) => option.value)
      .filter(Boolean);
  await waitFor(() => expect(voiceIds().length).toBeGreaterThan(0));
  fireEvent.change(screen.getByLabelText("性别"), { target: { value: "女" } });
  fireEvent.change(screen.getByLabelText("年龄段"), { target: { value: "中年" } });
  await waitFor(() => expect(screen.getByLabelText("性别")).toHaveValue("女"));
  await waitFor(() => expect(screen.getByLabelText("年龄段")).toHaveValue("中年"));
  await waitFor(() => expect(voiceIds()).toEqual(["ara"]));
  expect(screen.getByText(/已选：温暖友好/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("性别"), { target: { value: "男" } });
  await waitFor(() => expect(voiceIds()).toEqual(["leo", "orion"]));
  expect(screen.getByRole("group", { name: "适合中年男性" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "其他男声" })).toBeInTheDocument();
});

it("keeps a separate review card and confirms the shots before video", async () => {
  const { completeText } = installDesktop();
  window.aijianGrok = {
    ...window.aijianGrok!,
    models: vi.fn(async () => ({
      kind: "OK" as const,
      models: [
        { id: "grok-imagine-video-1.5", label: "video" },
        { id: "grok-4.7", label: "text" },
        { id: "leo", label: "leo", outputModalities: ["audio"] },
        { id: "luna", label: "luna", outputModalities: ["audio"] },
      ],
    })),
  } as unknown as Window["aijianGrok"];
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (String(text).includes("只审文字") || String(text).includes("你是审片")) {
      return { kind: "OK", text: JSON.stringify({ verdict: "可以拍", issues: ["雨声太满"] }) };
    }
    if (String(text).includes("你是 AIVORA 的动作指导")) {
      return { kind: "OK", text: '{"beats":[{"text":"他抬手","feasibility":"难"}]}' };
    }
    return { kind: "OK", text: "好", model: "grok-4.7" };
  });
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  pickHelper("动作指导");
  fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
  expect(await screen.findByText(/动作设计 · 镜头/)).toBeInTheDocument();
  expect(screen.getAllByText(/高危/).length).toBeGreaterThan(0);
  expect(screen.getByText(/稳可以拍/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
  expect(screen.queryByRole("button", { name: "已放进去" })).not.toBeInTheDocument();
  openBoardTools();
  fireEvent.click(screen.getByRole("button", { name: "审一下这一镜的文字" }));
  expect(await screen.findByText(/审片意见 · 镜头/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "放进分镜" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "知道了" }));
  expect(screen.queryByRole("button", { name: "已记下" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "审一下这一镜的文字" }));
  fireEvent.click(await screen.findByRole("button", { name: "按意见重做这一镜" }));
  expect(document.querySelector(".statusbar")?.textContent ?? "").toMatch(/重新生成/);
  // 4A-U10: one shot's 重新生成 opens its 单镜 panel.
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
  expect(screen.getByRole("button", { name: "全部镜头" })).toBeInTheDocument();
  fireEvent.click(stageTab("角色与场景"));
  fireEvent.change(screen.getByLabelText("角色声音"), { target: { value: "leo" } });
  expect(screen.getByText(/已选：威严有力/)).toBeInTheDocument();
  window.aijianGrok = {
    ...window.aijianGrok!,
    speak: vi.fn(async () => ({
      kind: "OK",
      audioBase64: "QQ==",
      mime: "audio/mpeg",
      seconds: 1,
      timestamps: false,
    })),
  } as unknown as Window["aijianGrok"];
  const RealAudio = window.Audio;
  class PausingAudio {
    onloadedmetadata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onended: (() => void) | null = null;
    pause = vi.fn();
    play = vi.fn(async () => undefined);
    constructor() {
      setTimeout(() => this.onloadedmetadata?.(), 0);
    }
  }
  window.Audio = PausingAudio as unknown as typeof Audio;
  const createUrl = URL.createObjectURL;
  URL.createObjectURL = () => "blob:phase3";
  try {
    fireEvent.click(screen.getByRole("button", { name: "试听" }));
    await screen.findByText(/正在试听|先在剧本里|没有播出来|试听/).catch(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "试听" }));
  } finally {
    window.Audio = RealAudio;
    URL.createObjectURL = createUrl;
  }
  window.aijian = {
    ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
    ...window.aijian!,
    listFilmSeries: vi.fn(async () => [
      { id: "film_sampleseries00001", title: "已存作品", savedAt: "", path: "/films" },
    ]),
    readFilmProject: vi.fn(async () => sampleFilm()),
  } as unknown as Window["aijian"];
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "已存作品" }));
  expect(await screen.findByText(/已打开/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(screen.getByRole("button", { name: "删除这一集" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText(/已删除这一集/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(screen.getByRole("button", { name: "删除这部作品" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText(/已删除这部作品|已删除这一集|还没有作品/)).toBeInTheDocument();
});

it("does not turn the writer's question into scenes", async () => {
  const { completeText } = installDesktop();
  completeText.mockResolvedValue({
    kind: "OK",
    text: "请把现有剧本分成。还没完。",
    model: "grok-4.7",
  });
  await openSample();
  pickHelper("编剧");
  fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: "请把现有剧本分成" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(await screen.findByText("请把现有剧本分成")).toBeInTheDocument();
  expect((await screen.findAllByText(/没有改剧本/)).length).toBeGreaterThan(0);
  expect(screen.queryByText(/还没完/)).not.toBeInTheDocument();
});

/** Picks who the assistant chat talks to, by the name shown in 「正在和：」. */
function pickHelper(name: string) {
  const select = screen.getByLabelText("正在和：") as HTMLSelectElement;
  const option = [...select.options].find((item) => item.textContent === name);
  if (!option) throw new Error(`没有「${name}」这位助手`);
  fireEvent.change(select, { target: { value: option.value } });
}

/** Picks an item from 「更多」 under the shot's properties on 分镜. */
function moreAction(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("button", { name }));
}

/** Opens 分镜 → 属性 → 高级, where 提示词 and 审片 run. */
/** 4C-U05: opens a group of a shot's properties (画面, 声音, 高级) if it is folded. */
function openGroup(name: string) {
  const summary = [...document.querySelectorAll<HTMLElement>(".pgroup > summary")].find(
    (item) => item.textContent === name,
  );
  if (!summary) throw new Error(`no property group ${name}`);
  if (!(summary.parentElement as HTMLDetailsElement).open) fireEvent.click(summary);
}

function openBoardTools() {
  fireEvent.click(stageTab("分镜"));
  const props = screen.queryByRole("button", { name: "属性" });
  if (props) fireEvent.click(props);
  if (!screen.queryByRole("button", { name: "写英文画面说明" })) {
    openGroup("高级");
  }
}

// UIR-03: a coded message shows one sentence; its detail is in the status bar's tooltip.
function statusDetail() {
  return document.querySelector(".status-note")?.getAttribute("title") ?? "";
}

function stageTab(name: string) {
  const found = screen
    .getAllByRole("button", { name: new RegExp(name) })
    .find((item) => item.className.includes("tab"));
  if (!found) throw new Error(`missing tab ${name}`);
  return found;
}

it("shows Grok sign-in on a clean profile and signs out through the bridge", async () => {
  window.localStorage.clear();
  const signIn = vi.fn(async () => ({ kind: "OK" as const }));
  const signOut = vi.fn(async () => ({ kind: "OK" as const }));
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "NOT_CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: null,
      lastError: null,
    })),
    models: vi.fn(async () => ({ kind: "OK", models: [] })),
    signIn,
    signOut,
  } as unknown as Window["aijianGrok"];
  render(<ProWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "用 Grok 会员登录" }));
  fireEvent.click(screen.getByRole("button", { name: "去浏览器授权" }));
  await waitFor(() => expect(signIn).toHaveBeenCalled());
  expect(await screen.findByText(/浏览器那页可以关掉/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "账号" }));
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await waitFor(() => expect(signOut).toHaveBeenCalled());
  expect(await screen.findByText("已退出登录。")).toBeInTheDocument();
});

it("asks for the selected shot again after the confirm table", async () => {
  const createStoryFilm = vi.fn(async () => ({
    data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/redo.mp4" },
  }));
  installDesktop(createStoryFilm);
  await openSample();
  fireEvent.click(stageTab("剪辑"));
  fireEvent.click(screen.getAllByRole("button", { name: "未生成" })[0]!);
  // 4A-U10: one shot's 重新生成 opens its 单镜 panel, the one place videos are made.
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
  expect(screen.getByRole("button", { name: "全部镜头" })).toBeInTheDocument();
  await adoptOpenStill();
  fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
  expect(screen.getByTestId("confirm-table")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() => expect(createStoryFilm).toHaveBeenCalled());
  const call = createStoryFilm.mock.calls[0] as unknown as
    [string, { shots?: { narration?: string; prompt?: string }[] }] | undefined;
  const body = call?.[1];
  expect(body?.shots?.[0]?.narration ?? "").not.toContain("新镜头");
  expect(body?.shots?.[0]?.prompt?.length ?? 0).toBeGreaterThan(0);
});

it("fills the default export folder and flushes when the app quits", async () => {
  installDesktop();
  const flushed = vi.fn(async () => undefined);
  let flush: ((request: { requestId: string }) => void) | undefined;
  Object.assign(window.aijian ?? {}, {
    defaultFilmFolder: vi.fn(async () => "/tmp/videos/AIVORA"),
    flushed,
    onFlush: (handler: (request: { requestId: string }) => void) => {
      flush = handler;
      return () => {
        flush = undefined;
      };
    },
  });
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  expect(screen.queryByLabelText("导出文件夹")).toBeNull();
  expect(screen.getByText(/审核后选择保存位置/)).toBeInTheDocument();
  flush?.({ requestId: "quit-default-folder" });
  await waitFor(() =>
    expect(flushed).toHaveBeenCalledWith({ requestId: "quit-default-folder", status: "saved" }),
  );
});

it("reloads a saved video and can cancel a login that is still waiting", async () => {
  const film = sampleFilm();
  film.shots[0]!.takes = [
    {
      id: "take-1",
      shotId: film.shots[0]!.id,
      index: 1,
      status: "done",
      stillUrl: "",
      videoPath: "/tmp/aivora/films/shot.mp4",
      videoUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    },
  ];
  film.shots[0]!.sceneId = film.scenes[0]!.id;
  film.shots[0]!.poster = "not-a-url";
  film.shots[0]!.selectedTakeId = "take-1";
  film.shots[1]!.takes = [
    {
      id: "take-win",
      shotId: film.shots[1]!.id,
      index: 1,
      status: "done",
      stillUrl: "",
      videoPath: "C:\\films\\a.mp4",
      videoUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    },
  ];
  const readFilmMedia = vi.fn(async () => new Uint8Array([1, 2, 3, 4]));
  window.aijian = {
    ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
    listFilmSeries: vi.fn(async () => [
      { id: film.seriesId, title: film.title, savedAt: "", path: "/tmp/aivora/films" },
    ]),
    readFilmProject: vi.fn(async () => film),
    writeFilmProject: vi.fn(async (value: unknown) => value),
    readFilmMedia,
  } as unknown as Window["aijian"];
  render(<ProWorkspace />);
  await screen.findAllByText(film.title);
  fireEvent.click(stageTab("剪辑"));
  await waitFor(() =>
    expect(document.querySelector("video.frame")?.getAttribute("src") ?? "").toContain(
      "aivora-media:",
    ),
  );
  expect(readFilmMedia).not.toHaveBeenCalled();
  cleanup();
  let release: (value: { kind: string }) => void = () => undefined;
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "NOT_CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: null,
      lastError: null,
    })),
    models: vi.fn(async () => ({ kind: "OK", models: [] })),
    signIn: vi.fn(
      () =>
        new Promise<{ kind: string }>((resolve) => {
          release = resolve;
        }),
    ),
    cancel: vi.fn(async () => ({ kind: "CANCELLED" })),
  } as unknown as Window["aijianGrok"];
  render(<ProWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "用 Grok 会员登录" }));
  expect(await screen.findByText(/会打开浏览器让你登录 Grok/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "去浏览器授权" }));
  fireEvent.click(screen.getByRole("button", { name: "账号" }));
  fireEvent.click(screen.getByRole("button", { name: "取消登录" }));
  expect(screen.getByText("登录已取消。")).toBeInTheDocument();
  release({ kind: "CANCELLED" });
});

it("shows a denied membership, a real range, and a description edit", async () => {
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "ENTITLEMENT_DENIED",
      secureStorage: "AVAILABLE",
      accountLabel: null,
      lastError: null,
    })),
    models: vi.fn(async () => ({ kind: "OK", models: [] })),
    signOut: vi.fn(async () => {
      throw new Error("no");
    }),
  } as unknown as Window["aijianGrok"];
  render(<ProWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "这个会员用不了生成",
    ),
  );
  fireEvent.click(stageTab("剪辑"));
  fireEvent.click(screen.getByRole("button", { name: "设出点" }));
  fireEvent.change(screen.getByLabelText("改这一镜的描述"), { target: { value: "雨停在巷口" } });
  expect(screen.getByLabelText("改这一镜的描述")).toHaveValue("雨停在巷口");
  fireEvent.click(screen.getByRole("button", { name: "账号" }));
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  expect(await screen.findByText(/退出没有完成/)).toBeInTheDocument();
});

it("says the call was not billed when a project cannot be created", async () => {
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "owner",
      lastError: null,
    })),
    models: vi.fn(async () => ({ kind: "OK", models: [{ id: "grok-4.7", label: "text" }] })),
    completeText: vi.fn(),
  } as unknown as Window["aijianGrok"];
  window.aijian = {
    ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
    createProject: vi.fn(async () => {
      throw new Error("down");
    }),
    listFilmSeries: vi.fn(async () => []),
    writeFilmProject: vi.fn(async (film: unknown) => film),
    readFilmProject: vi.fn(async () => null),
  } as unknown as Window["aijian"];
  render(<ProWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  pickHelper("编剧");
  fireEvent.click(screen.getByRole("button", { name: "导入小说" }));
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  expect(await screen.findByText(/没有记到作品上/)).toBeInTheDocument();
});

it("creates a backend project before a clean-profile director call", async () => {
  const projectId = `prj_${"b".repeat(32)}`;
  const createProject = vi.fn(async () => ({
    data: { id: projectId },
    request_id: "00000000-0000-4000-8000-000000000001",
  }));
  const completeText = vi.fn(async () => ({
    kind: "OK",
    text: '{"shots":[{"picture":"抬眼看向巷口","size":"近景","seconds":2}]}',
  }));
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "owner",
      lastError: null,
    })),
    models: vi.fn(async () => ({ kind: "OK", models: [{ id: "grok-4.7", label: "text" }] })),
    completeText,
  } as unknown as Window["aijianGrok"];
  window.aijian = {
    ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
    createProject,
    listFilmSeries: vi.fn(async () => []),
    writeFilmProject: vi.fn(async (film: unknown) => film),
    readFilmProject: vi.fn(async () => null),
  } as unknown as Window["aijian"];
  render(<ProWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "雨夜巷口。" } });
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  await waitFor(() => expect(createProject).toHaveBeenCalled());
  expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ aspect_ratio: "16:9" }));
  await waitFor(() => expect(completeText).toHaveBeenCalled());
  const sent = completeText.mock.calls[0] as unknown as [{ projectId?: string }] | undefined;
  expect(sent?.[0]?.projectId).toBe(projectId);
});

it("signs in with ChatGPT, imports music, and exports the finished shot", async () => {
  const signIn = vi.fn(async () => ({ kind: "ERROR" as const, code: "CANCELLED" }));
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "NOT_CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: null,
      lastError: null,
    })),
    models: vi.fn(async () => ({ kind: "OK", models: [] })),
    signIn,
    signOut: vi.fn(async () => ({ kind: "OK" })),
  } as unknown as Window["aijianGrok"];
  render(<ProWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "用 Grok 会员登录" }));
  expect(await screen.findByText(/会打开浏览器让你登录 Grok/)).toBeInTheDocument();
  expect(signIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "去浏览器授权" }));
  expect(await screen.findByText(/登录没有完成/)).toBeInTheDocument();
  cleanup();
  delete window.aijianChatGPT;

  const createStoryFilm = vi.fn(async () => ({
    data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" },
  }));
  const desktop = installDesktop(createStoryFilm);
  let fileReads = 0;
  const importMusic = vi.fn(async () => ({ path: "/tmp/aivora/films/bed.mp3" }));
  Object.assign(window.aijian ?? {}, {
    importMusic,
    filePath: () => {
      fileReads += 1;
      return fileReads > 1 ? "/tmp/song.mp3" : "";
    },
  });
  await openSample();
  fireEvent.click(stageTab("剪辑"));
  fireEvent.change(screen.getByLabelText("导入音乐"), {
    target: { files: [new File(["song"], "bed.mp3", { type: "audio/mpeg" })] },
  });
  expect(await screen.findByText(/请在桌面版里选择/)).toBeInTheDocument();
  const music = new File(["song"], "bed.mp3", { type: "audio/mpeg" });
  fireEvent.change(screen.getByLabelText("导入音乐"), { target: { files: [music] } });
  expect(await screen.findByText(/已导入音乐/)).toBeInTheDocument();
  expect(importMusic).toHaveBeenCalledWith(expect.any(String), "/tmp/song.mp3");
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  await adoptOpenStill();
  fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  expect(await screen.findByText("这一版已经生成。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  {
    const silentChoice = screen.queryByRole("button", { name: "本片静音" });
    if (silentChoice) fireEvent.click(silentChoice);
  }
  fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
  expect(await screen.findByText(qcFailureText.MISSING_MEDIA)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "审核后发布" })).toBeDisabled();
  expect(desktop.exportFilmCut).not.toHaveBeenCalled();
  expect(desktop.prepareFilmExport).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedSelection: expect.arrayContaining([
        expect.objectContaining({ takeId: expect.any(String) }),
      ]),
    }),
    expect.any(String),
  );
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  const completeAssembly = desktop.assembleFilmProject.getMockImplementation()!;
  desktop.assembleFilmProject.mockImplementation(
    async (input) =>
      ({
        ...(await completeAssembly(input)),
        kind: "PARTIAL",
        incomplete: "audio",
      }) as FilmAssemblyResult,
  );
  fireEvent.click(screen.getByRole("button", { name: "全部镜头" }));
  await adoptListedShots();
  fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  // Observe the whole original generation queue and its saved result before editing.
  // Otherwise intermediate takes restart assembly and later generation notices replace its result.
  await waitFor(() => {
    const latest = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as
      FilmProject | undefined;
    expect(createStoryFilm).toHaveBeenCalledTimes(sampleFilm().shots.length + 1);
    expect(latest?.shots).toHaveLength(sampleFilm().shots.length);
    expect(latest?.shots.every((shot) => shot.takes.at(-1)?.status === "done")).toBe(true);
  });
  fireEvent.click(stageTab("剪辑"));
  expect(await screen.findByText(NOTICE_COPY.ASSEMBLY_PARTIAL!)).toBeInTheDocument();
  expect(desktop.assembleFilm).not.toHaveBeenCalled();
}, 20_000);

it("names the shots that are not ready instead of exporting an empty cut", async () => {
  const desktop = installDesktop();
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  {
    const silentChoice = screen.queryByRole("button", { name: "本片静音" });
    if (silentChoice) fireEvent.click(silentChoice);
  }
  fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
  expect(await screen.findByText(qcFailureText.MISSING_MEDIA)).toBeInTheDocument();
  expect(desktop.exportFilmCut).not.toHaveBeenCalled();
});

async function expectSavedPipelineCode(code: string) {
  await waitFor(() => {
    const writes = vi.mocked(window.aijian!.writeFilmProject!).mock.calls;
    const latest = writes
      .map(([value]) => value as FilmProject)
      .filter((film) => film.productionPipeline)
      .at(-1);
    expect(latest?.productionPipeline?.steps[0]?.targets[0]?.code).toBe(code);
    expect(["failed", "blocked"]).toContain(latest?.productionPipeline?.status);
  });
}

function installDesktop(createStoryFilm: ReturnType<typeof vi.fn> = vi.fn()) {
  const episode = sampleFilm();
  episode.id = "film_episode2000000001";
  episode.episodeTitle = "第 2 集";
  episode.directory = "/tmp/aivora/films";
  const models = vi.fn(async () => ({
    kind: "OK" as const,
    models: [
      { id: "grok-imagine-video-1.5", label: "video" },
      { id: "grok-imagine-video-1.5-lite", label: "lite" },
      { id: "grok-imagine-video", label: "edit" },
      { id: "grok-4.7", label: "text" },
      { id: "grok-imagine-image-2.0", label: "image" },
    ],
  }));
  const completeText = vi.fn(
    async ({
      text,
    }: {
      text: string;
    }): Promise<{
      kind: string;
      text: string;
      model?: string;
      code?: string;
      detail?: string;
      billingAccountKind?: string;
    }> => {
      if (text.includes("把这一场拆成镜头")) {
        return {
          kind: "OK",
          text: '{"shots":[{"picture":"抬眼看向巷口","size":"近景","seconds":3,"angle":"平视"}]}',
        };
      }
      if (text.includes("写成短剧") || text.includes("改成短剧")) {
        return {
          kind: "OK",
          text: '{"scenes":[{"title":"雨停","place":"巷口","time":"黎明","text":"雨停了。"}]}',
        };
      }
      if (text.includes("写这一镜的表演") || text.includes("你是表演指导")) {
        return { kind: "OK", text: '[{"emotion":"冷静","face":["眼神一沉"],"eyes":"看向前方"}]' };
      }
      if (text.includes("你是 AIVORA 的动作指导")) {
        return {
          kind: "OK",
          text: JSON.stringify({
            beats: [
              {
                shot_id: text.match(/当前镜头 id：([^；]+)/)?.[1],
                text: "他抬手",
                feasibility: "稳",
              },
            ],
          }),
        };
      }
      return { kind: "OK", text: "他抬手。停住。" };
    },
  );
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "owner",
      lastError: null,
    })),
    models,
    completeText,
  } as unknown as Window["aijianGrok"];
  const assembleFilm = vi.fn(async () => ({ path: "/tmp/aivora/rough.mp4", reason: "" }));
  const pickFilmFolder = vi.fn(async () => "/tmp/aivora/export");
  const exportFilmCut = vi.fn(async () => ({ path: "/tmp/aivora/export/cut.mp4" }));
  const prepareFilmExport = vi.fn(async (input: FilmExportQcInput) =>
    input.expectedSelection.some((item) => !item.takeId)
      ? { kind: "FAILED" as const, code: "MISSING_MEDIA" as const }
      : {
          kind: "READY" as const,
          qcReceipt: "host-qc-receipt",
          outputs: input.settings.aspects.map((aspectRatio) => ({
            aspectRatio,
            report: {
              schemaVersion: 1,
              media: { duration: 12, width: 1280, height: 720 },
              audio: { present: true, integratedLufs: -16, truePeakDbtp: -2 },
              assumptions: {},
              issues: [],
            },
          })),
          shots: [],
          fileName: "雨夜巷战-第1集.mp4",
          unverified: ["台词完整性未检查。"],
        },
  );
  const publishFilmExport = vi.fn(async (): Promise<FilmExportQcPublishResult> => ({
    kind: "PUBLISHED" as const,
    outputs: [{ aspectRatio: "16:9" as const, path: "/tmp/aivora/export/cut.mp4" }],
  }));
  const discardFilmExport = vi.fn(async () => undefined);
  const savedProjects = new Map<string, FilmProject>();
  const assembleFilmProject = vi.fn(
    async (input: FilmAssemblyInput): Promise<FilmAssemblyResult> => {
      const canonical = savedProjects.get(input.projectId)!;
      expect(input.expectedHash).toBe(await historyRecordHash(canonical));
      expect(input.expectedSelection).toEqual(
        canonical.shots.flatMap((shot) => {
          const take = shot.takes.find(
            (t) => t.id === shot.selectedTakeId && t.status === "done" && t.videoPath,
          );
          return take ? [{ shotId: shot.id, takeId: take.id }] : [];
        }),
      );
      return {
        kind: "ASSEMBLED",
        projectId: input.projectId,
        projectHash: input.expectedHash,
        path: "/tmp/aivora/rough.mp4",
        durationSeconds: input.expectedSelection.length * 2,
        shots: input.expectedSelection.map((row, i) => ({
          ...row,
          startSeconds: i * 2,
          durationSeconds: 2,
        })),
        limitations: [],
      };
    },
  );
  const historyRecords = new Map<string, { entry: FilmHistoryEntry; film: FilmProject }>();
  let historySequence = 0;
  const historyEntry = (
    film: FilmProject,
    reason: FilmHistoryEntry["reason"],
  ): FilmHistoryEntry => ({
    id: `hst_${(++historySequence).toString(16).padStart(32, "0")}`,
    createdAt: new Date().toISOString(),
    reason,
    summary: {
      scenes: film.scenes.length,
      shots: film.shots.length,
      done: film.shots.filter((shot) =>
        shot.takes.some((take) => take.status === "done" && take.videoPath),
      ).length,
    },
  });

  const revealFilmPath = vi.fn(async () => undefined);
  const openFilmPath = vi.fn(async () => undefined);
  window.aijian = {
    ...generationExecutionFixture(async (id) => window.aijian!.readFilmProject!(id)),
    listFilmHistory: vi.fn<FilmHistoryGateway["listFilmHistory"]>(async (projectId) => ({
      kind: "LIST",
      entries: [...historyRecords.values()]
        .filter((value) => value.film.id === projectId)
        .map((value) => value.entry),
      unreadable: 0,
    })),
    captureFilmHistory: vi.fn<FilmHistoryGateway["captureFilmHistory"]>(async (input) => {
      const saved = savedProjects.get(input.projectId);
      if (!saved || (await historyRecordHash(saved)) !== input.expectedHash)
        return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
      const entry = historyEntry(saved, input.reason);
      historyRecords.set(entry.id, { entry, film: structuredClone(saved) });
      return { kind: "CAPTURED", entry };
    }),
    restoreFilmHistory: vi.fn<FilmHistoryGateway["restoreFilmHistory"]>(async (input) => {
      const saved = savedProjects.get(input.projectId),
        target = historyRecords.get(input.historyId);
      if (
        !saved ||
        !target ||
        target.film.id !== input.projectId ||
        (await historyRecordHash(saved)) !== input.expectedHash
      )
        return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
      const backup = historyEntry(saved, "before-restore");
      historyRecords.set(backup.id, { entry: backup, film: structuredClone(saved) });
      savedProjects.set(saved.id, structuredClone(target.film));
      return { kind: "RESTORED", project: structuredClone(target.film), backup };
    }),
    prepareFilmProject: vi.fn(async (film: FilmProject) => structuredClone(film)),
    createStoryFilm,
    generateFilmStill: vi.fn(async () => ({
      path: "/tmp/aivora/referenced-still.png",
      reason: "",
    })),
    cancelStoryFilm: vi.fn(async () => ({})),
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => [
      {
        id: episode.id,
        seriesId: episode.seriesId,
        title: episode.episodeTitle,
        no: 2,
        shots: 1,
        done: 0,
        savedAt: "",
      },
    ]),
    readFilmProject: vi.fn(
      async (id: string) => savedProjects.get(id) ?? (id === episode.id ? episode : null),
    ),
    writeFilmProject: vi.fn(async (film: FilmProject) => {
      savedProjects.set(film.id, structuredClone(film));
      return film;
    }),
    deleteFilmProject: vi.fn(async () => undefined),
    renameFilmSeries: vi.fn(async () => undefined),
    readFilmMedia: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    assembleFilm,
    assembleFilmProject,
    cancelFilmAssemblyOperation: vi.fn(),
    pickFilmFolder,
    exportFilmCut,
    prepareFilmExport,
    publishFilmExport,
    discardFilmExport,
    revealFilmPath,
    openFilmPath,
  } as unknown as Window["aijian"];
  return {
    models,
    completeText,
    assembleFilm,
    assembleFilmProject,
    pickFilmFolder,
    exportFilmCut,
    prepareFilmExport,
    publishFilmExport,
    discardFilmExport,
    revealFilmPath,
    openFilmPath,
  };
}

async function openSample() {
  render(<ProWorkspace projectId={PROJECT_ID} />);
  fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  await waitForGenerationCatalog();
}
async function adoptOpenStill(options?: { stayOnBoard?: boolean }) {
  const onBench = Boolean(screen.queryByRole("button", { name: /生成 \d+ 个版本/ }));
  if (
    onBench &&
    !screen.queryByRole("button", { name: "核对并采用" }) &&
    !screen.queryByRole("button", { name: "生成画面" })
  ) {
    const back = screen.queryByRole("button", { name: "全部镜头" });
    if (back) fireEvent.click(back);
  }
  if (!screen.queryByRole("button", { name: "核对并采用" })) {
    const make = screen.queryByRole("button", { name: "生成画面" });
    if (make) {
      fireEvent.click(make);
      await screen.findByRole("button", { name: "核对并采用" });
    }
  }
  const open = screen.queryByRole("button", { name: "核对并采用" });
  if (!open) return;
  fireEvent.click(open);
  for (const row of screen.getAllByRole("button", { name: "符合" })) fireEvent.click(row);
  const adopt = screen.getByRole("button", { name: "采用" }) as HTMLButtonElement;
  if (!adopt.disabled) fireEvent.click(adopt);
  else {
    const close = screen.queryByRole("button", { name: "关闭" });
    if (close) fireEvent.click(close);
  }
  if (onBench && !options?.stayOnBoard) {
    const video = screen.queryByRole("button", { name: "生成视频" });
    if (video) fireEvent.click(video);
  }
}

function filmWithAdoptedStills(film: FilmProject): FilmProject {
  let next = film;
  for (const shot of film.shots) {
    next = {
      ...next,
      shots: next.shots.map((item) =>
        item.id === shot.id
          ? { ...item, poster: `/tmp/aivora/adopted-${item.id}.png`, stills: [] }
          : item,
      ),
    };
    const current = next.shots.find((item) => item.id === shot.id)!;
    const verdicts = Object.fromEntries(
      stillChecklist(next, current).map((item) => [item.id, "match" as const]),
    );
    const saved = saveStillReview(next, shot.id, verdicts, "2026-11-10T00:00:00.000Z");
    if (!saved.adopted) throw new Error(saved.error);
    next = saved.film;
  }
  return next;
}

async function openAdoptedSample() {
  const realSample = filmProject.sampleFilm;
  const spy = vi
    .spyOn(filmProject, "sampleFilm")
    .mockImplementation(() => filmWithAdoptedStills(realSample()));
  try {
    await openSample();
  } finally {
    spy.mockRestore();
  }
}

async function adoptListedShots() {
  const cards = screen
    .getAllByRole("button")
    .filter(
      (button) => button.classList.contains("card") && /镜头 \d+/.test(button.textContent ?? ""),
    );
  for (const card of cards) {
    fireEvent.click(card);
    await adoptOpenStill({ stayOnBoard: true });
  }
}

async function waitForGenerationCatalog() {
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
}

it("does not call the provider for 生成这一场 while the still is unadopted", async () => {
  const createStoryFilm = vi.fn();
  installDesktop(createStoryFilm);
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  expect(createStoryFilm).not.toHaveBeenCalled();
  expect(screen.getAllByText(/镜头 \d+ 的画面还没核对/).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: "生成画面" }).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "核对并采用" })).toBeNull();
});

it("does not call the provider for 生成这一场 when a picture exists but is not adopted", async () => {
  const createStoryFilm = vi.fn();
  installDesktop(createStoryFilm);
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
  await screen.findByRole("button", { name: "核对并采用" });
  fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  expect(createStoryFilm).not.toHaveBeenCalled();
  expect(screen.getAllByText(/镜头 \d+ 的画面还没核对/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /去核对镜头/ })).toBeInTheDocument();
});

it("shows the manual still offer for an explicit confirm and leaves the saved draft on cancel or refusal", async () => {
  const offerId = "fio_01234567-89ab-cdef-0123-456789abcdef";
  installDesktop();
  vi.mocked(window.aijian!.generateFilmStill!).mockResolvedValue({
    path: "/tmp/aivora/manual-still.png",
    reason: "",
    fixedInputOfferId: offerId,
  });
  const confirmFixedInput = vi.fn<NonNullable<NonNullable<Window["aijian"]>["confirmFixedInput"]>>(
    async (...args) => {
      expect(args).toHaveLength(2);
      return { ok: true, path: "/tmp/aivora/manual-still.png" };
    },
  );
  const importFixedInput = vi.fn(async (projectId: string) => {
    expect(typeof projectId).toBe("string");
    return { ok: false as const, code: "CANCELLED" as const };
  });
  window.aijian!.confirmFixedInput = confirmFixedInput;
  window.aijian!.importFixedInput = importFixedInput;
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
  const confirmButton = await screen.findByRole("button", { name: "确认这张手工画面为固定输入" });
  expect(confirmFixedInput).not.toHaveBeenCalled();
  const writeFilmProject = vi.mocked(window.aijian!.writeFilmProject!);
  // The still apply uses the existing 400ms save. Count only after that write lands.
  await waitFor(() => {
    const saved = writeFilmProject.mock.calls.at(-1)?.[0] as FilmProject | undefined;
    expect(
      saved?.shots.some((item) =>
        item.stills.some((still) => still.url.includes("manual-still.png")),
      ),
    ).toBe(true);
  });
  const writesAfterStill = writeFilmProject.mock.calls.length;
  const draftAfterStill = JSON.stringify(writeFilmProject.mock.calls.at(-1)?.[0]);
  fireEvent.click(confirmButton);
  await waitFor(() => expect(confirmFixedInput).toHaveBeenCalledTimes(1));
  expect(confirmFixedInput.mock.calls[0]?.[1]).toBe(offerId);
  expect(writeFilmProject.mock.calls.length).toBe(writesAfterStill);
  confirmFixedInput.mockResolvedValueOnce({ ok: false, code: "UNSUPPORTED_SCOPE" });
  fireEvent.click(screen.getByRole("button", { name: "确认这张手工画面为固定输入" }));
  expect(await screen.findByText("这张手工画面还不能当作固定输入。")).toBeInTheDocument();
  expect(writeFilmProject.mock.calls.length).toBe(writesAfterStill);
  fireEvent.click(screen.getByRole("button", { name: "导入为固定输入" }));
  expect(await screen.findByText("已取消导入固定输入。")).toBeInTheDocument();
  expect(importFixedInput.mock.calls[0]).toHaveLength(1);
  expect(writeFilmProject.mock.calls.length).toBe(writesAfterStill);
  expect(JSON.stringify(writeFilmProject.mock.calls.at(-1)?.[0])).toBe(draftAfterStill);
});

it("does not let a late import replace a newer draft through the save queue", async () => {
  installDesktop();
  let resolveImport!: (
    value: { ok: true; path: string } | { ok: false; code: "CANCELLED" },
  ) => void;
  window.aijian!.importFixedInput = () =>
    new Promise((resolve) => {
      resolveImport = resolve;
    });
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "导入为固定输入" }));
  const picture = screen.getByLabelText("分镜画面");
  fireEvent.change(picture, { target: { value: "新稿不能被旧导入覆盖" } });
  resolveImport({ ok: false, code: "CANCELLED" });
  expect(await screen.findByText("已取消导入固定输入。")).toBeInTheDocument();
  expect(screen.getByLabelText("分镜画面")).toHaveValue("新稿不能被旧导入覆盖");
  fireEvent.click(screen.getByRole("button", { name: "导入为固定输入" }));
  fireEvent.change(screen.getByLabelText("分镜画面"), {
    target: { value: "更新后的稿仍要保留" },
  });
  resolveImport({ ok: true, path: "/tmp/aivora/imported-fixed.png" });
  expect(await screen.findByText(/已导入这张画面为固定输入/)).toBeInTheDocument();
  expect(screen.getByLabelText("分镜画面")).toHaveValue("更新后的稿仍要保留");
  await waitFor(() => {
    const saved = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as {
      shots: { picture: string; poster?: string }[];
    };
    expect(saved.shots[0]?.picture).toBe("更新后的稿仍要保留");
    expect(saved.shots[0]?.poster).toContain("imported-fixed.png");
  });
});

it("continues one-click storyboarding and retries the director into shots", async () => {
  const { completeText } = installDesktop();
  let plainDirector = 0;
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("写成短剧")) {
      return {
        kind: "OK",
        text: '{"scenes":[{"title":"雨停","place":"巷口","time":"夜","text":"林骁说：雨太大。"}]}',
      };
    }
    if (text.includes("只返回 JSON")) {
      return {
        kind: "OK",
        text: '{"shots":[{"picture":"她抬眼","size":"近景","seconds":2}]}',
      };
    }
    if (text.includes("把这一场拆成镜头")) {
      plainDirector += 1;
      return plainDirector === 1
        ? {
            kind: "OK",
            text: '{"shots":[{"picture":"她停下","size":"近景","seconds":3,"line":"雨太大"}]}',
          }
        : { kind: "OK", text: "不是格式" };
    }
    return { kind: "OK", text: "好" };
  });
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "一键成片" }));
  await expectSavedPipelineCode("SCRIPT_COVERAGE_REVIEW");
  expect(window.aijian!.createStoryFilm).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "继续生成" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  await screen.findByRole("button", { name: "放进分镜" });
  fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
  fireEvent.click(stageTab("剧本"));
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  fireEvent.click(await screen.findByRole("button", { name: "换个问法再问一次" }));
  expect((await screen.findAllByText(/导演拆好了/)).length).toBeGreaterThan(0);
  pickHelper("编剧");
  expect(screen.queryByRole("button", { name: "放进分镜" })).toBeNull();
});

it("lets the user close the sign-in note before the browser opens", () => {
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "NOT_CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: null,
      lastError: null,
    })),
    models: vi.fn(async () => ({ kind: "OK", models: [] })),
    signIn: vi.fn(),
  } as unknown as Window["aijianGrok"];
  render(<ProWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "用 Grok 会员登录" }));
  expect(screen.getByText(/会打开浏览器让你登录 Grok/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "先不登录" }));
  expect(screen.queryByText(/去浏览器授权/)).not.toBeInTheDocument();
  expect(window.aijianGrok?.signIn).not.toHaveBeenCalled();
});

it("stops the rest of a batch when a newer batch starts", async () => {
  let releaseFirst: (value: unknown) => void = () => undefined;
  let releaseSecond: (value: unknown) => void = () => undefined;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const second = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  const succeeded = {
    data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" },
  };
  const createStoryFilm = vi
    .fn()
    .mockImplementationOnce(() => first)
    .mockImplementation(() => second);
  installDesktop(createStoryFilm);
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  const counts = screen.getAllByRole("button", { name: "2" });
  fireEvent.click(counts[counts.length - 1]!);
  await adoptOpenStill();
  if (screen.queryByRole("button", { name: "核对并采用" })) {
    fireEvent.click(screen.getByRole("button", { name: "核对并采用" }));
    for (const row of screen.getAllByRole("button", { name: "符合" })) fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "采用" }));
  }
  fireEvent.click(screen.getByRole("button", { name: "生成 2 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() => expect(createStoryFilm).toHaveBeenCalled());
  if (screen.queryByRole("button", { name: "核对并采用" })) {
    fireEvent.click(screen.getByRole("button", { name: "核对并采用" }));
    for (const row of screen.getAllByRole("button", { name: "符合" })) fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "采用" }));
  }
  fireEvent.click(screen.getByRole("button", { name: "生成 2 个版本" }));
  fireEvent.click(screen.getAllByRole("button", { name: "开始生成" }).at(-1)!);
  releaseFirst(succeeded);
  await waitFor(() => expect(createStoryFilm).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/已取消。还没开始的镜头不再生成。/)).not.toBeInTheDocument();
  releaseSecond(succeeded);
});

it("does not write an offline cast when the model fails", async () => {
  const { completeText } = installDesktop();
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("抽出人物")) return { kind: "OK", text: "不是格式" };
    return {
      kind: "OK",
      text: '{"shots":[{"picture":"巷口有雨","size":"全景","seconds":2}]}',
    };
  });
  render(<ProWorkspace projectId={PROJECT_ID} />);
  fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "雨夜巷口。" } });
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  expect(await screen.findByText(/导演拆好了/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
  expect(await screen.findByText(/已放进分镜/)).toBeInTheDocument();
});

function materializeSpokenFixture() {
  const write = vi.mocked(window.aijian!.writeFilmProject!);
  const original = write.getMockImplementation()!;
  const sources = new Map<string, string>();
  write.mockImplementation(async (raw) => {
    const film = structuredClone(raw) as FilmProject;
    film.audioClips = film.audioClips.map((clip) => {
      if (!clip.path?.startsWith("data:")) return clip;
      if (!sources.has(clip.path))
        sources.set(clip.path, `/tmp/aivora/films/voice-${sources.size}.mp3`);
      return { ...clip, path: sources.get(clip.path)! };
    });
    return original(film);
  });
}

it("shows a saved still again and uses lane mute, solo, and volume", async () => {
  const createStoryFilm = vi.fn(async () => ({
    data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" },
  }));
  const desktop = installDesktop(createStoryFilm);
  materializeSpokenFixture();
  Object.assign(window.aijian ?? {}, {
    generateFilmStill: vi.fn(async () => ({ path: "/tmp/aivora/still.png", reason: "" })),
    importMusic: vi.fn(async () => ({ path: "/tmp/aivora/films/bed.mp3" })),
    filePath: () => "/tmp/song.mp3",
  });
  const speak = vi.fn(async () => ({
    kind: "OK",
    audioBase64: "QQ==",
    mime: "audio/mpeg",
    seconds: 1,
    timestamps: false,
  }));
  Object.assign(window.aijianGrok ?? {}, { speak });
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
  expect(await screen.findByText(/画面出好了。/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /候选画面/ }));
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  if (screen.queryByRole("button", { name: "核对并采用" })) {
    fireEvent.click(screen.getByRole("button", { name: "核对并采用" }));
    for (const row of screen.getAllByRole("button", { name: "符合" })) fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "采用" }));
  }
  await adoptOpenStill();
  fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  expect(await screen.findByText("这一版已经生成。")).toBeInTheDocument();
  fireEvent.click(stageTab("剪辑"));
  fireEvent.click(screen.getByRole("button", { name: /镜头 4/ }));
  fireEvent.click(screen.getByRole("button", { name: "换配音" }));
  expect(await screen.findByText("这一句已重配，画面没有重新生成。")).toBeInTheDocument();
  expect(document.querySelector("[data-voice='1'][data-voice-binding='pending']")).toBeTruthy();
  expect(screen.getByText(/生成画面后可免费绑定/)).toBeInTheDocument();
  await waitFor(async () => {
    const last = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)![0] as FilmProject;
    const stored = (await readSaved(last.id))!;
    const voice = stored.audioClips.find((clip) => clip.label === "配音")!;
    const shot = stored.shots.find((row) => row.id === voice.shotId)!;
    expect(voice.takeId).toBe("");
    expect(shot.takes.filter((take) => take.status === "done")).toHaveLength(0);
    expect(voice.path).toBeTruthy();
  });
  expect(createStoryFilm).toHaveBeenCalledOnce();
  expect(speak).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("导入音乐"), {
    target: { files: [new File(["song"], "bed.mp3", { type: "audio/mpeg" })] },
  });
  expect(await screen.findByText(/已导入音乐/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "静音对白" }));
  expect(screen.getByText("这一轨已静音。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "静音对白" }));
  fireEvent.click(screen.getByRole("button", { name: "单听对白" }));
  fireEvent.click(screen.getByRole("button", { name: "静音配乐" }));
  fireEvent.click(screen.getByRole("button", { name: "静音配乐" }));
  fireEvent.click(screen.getByRole("button", { name: "单听配乐" }));
  expect(screen.getByText("只听配乐。音量没有改。")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("配乐音量"), { target: { value: "50" } });
  expect(screen.getByText("音量已记下，导出时用这个音量。")).toBeInTheDocument();
  await waitFor(async () => {
    const last = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)![0] as FilmProject;
    const stored = (await readSaved(last.id))!;
    expect(stored.audioMix?.lanes.score).toEqual({ gainDb: -6, muted: false });
    expect(stored.audioClips.find((clip) => clip.lane === "score")?.loop).toBe(true);
    expect(stored.audioClips.find((clip) => clip.lane === "score")?.gainDb).toBe(-22);
  });
  expect(createStoryFilm).toHaveBeenCalledOnce();
  expect(speak).toHaveBeenCalledOnce();
  expect(desktop.assembleFilm).not.toHaveBeenCalled();
});

it("keeps pre-recorded voice and explicitly reuses it after normal generation adds its own voice file", async () => {
  const video = vi.fn(async () => ({
    data: {
      status: "SUCCEEDED",
      message: "",
      output_path: "/tmp/aivora/shot.mp4",
      voice_path: "/tmp/aivora/provider-voice.wav",
    },
  }));
  installDesktop(video);
  materializeSpokenFixture();
  const speak = vi.fn(async () => ({
    kind: "OK",
    audioBase64: "QQ==",
    mime: "audio/mpeg",
    seconds: 1,
    timestamps: false,
  }));
  Object.assign(window.aijianGrok!, { speak });
  await openSample();
  fireEvent.click(stageTab("剪辑"));
  fireEvent.click(screen.getByRole("button", { name: /镜头 4/ }));
  fireEvent.click(screen.getByRole("button", { name: "换配音" }));
  await screen.findByText("这一句已重配，画面没有重新生成。");
  expect(speak).toHaveBeenCalledOnce();
  expect(video).not.toHaveBeenCalled();
  expect(document.querySelector("[data-voice-binding='pending']")).toBeTruthy();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: /镜头 4/ }));
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  await adoptOpenStill();
  fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await screen.findByText("这一版已经生成。");
  fireEvent.click(stageTab("剪辑"));
  const button = await screen.findByRole("button", {
    name: "将这段配音用于当前版本（现用配音保留）",
  });
  expect(video).toHaveBeenCalledOnce();
  expect(speak).toHaveBeenCalledOnce();
  fireEvent.click(button);
  await waitFor(async () => {
    const raw = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)![0] as FilmProject;
    const stored = (await readSaved(raw.id))!;
    const pending = stored.audioClips.find((clip) => clip.lane === "dialogue" && !clip.takeId)!;
    const selected = stored.shots.find((shot) => shot.id === pending.shotId)!.selectedTakeId;
    const voices = stored.audioClips.filter(
      (clip) => clip.shotId === pending.shotId && clip.takeId === selected && clip.label !== "原声",
    );
    expect(pending.path).toBe("/tmp/aivora/films/voice-0.mp3");
    expect(voices).toHaveLength(2);
    expect(voices.find((clip) => clip.path === "/tmp/aivora/provider-voice.wav")?.enabled).toBe(
      false,
    );
    expect(voices.filter((clip) => clip.enabled !== false)).toHaveLength(1);
    expect(voices.find((clip) => clip.enabled !== false)?.path).toBe(pending.path);
  });
  expect(
    screen.getByRole("button", { name: "改用这段已保留配音（不重新配音）" }),
  ).toBeInTheDocument();
  expect(video).toHaveBeenCalledOnce();
  expect(speak).toHaveBeenCalledOnce();
});

it("puts the spoken file on the dialogue lane and leaves a finished job alone", async () => {
  const createStoryFilm = vi.fn(async () => ({
    data: {
      status: "SUCCEEDED",
      message: "",
      output_path: "/tmp/aivora/shot.mp4",
      voice_path: "/tmp/aivora/line.wav",
    },
  }));
  installDesktop(createStoryFilm);
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: /镜头 4/ }));
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  await adoptOpenStill();
  fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  expect(await screen.findByText("这一版已经生成。")).toBeInTheDocument();
  fireEvent.click(stageTab("剪辑"));
  expect(document.querySelector("[data-voice='1']")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
  const finished = screen.queryByRole("button", { name: /好了/ });
  if (finished) fireEvent.click(finished);
  expect(screen.queryByText("已取消这一次。已经发出的请求不一定能停。")).not.toBeInTheDocument();
});

it("says the model returned nothing when the director bridge throws", async () => {
  const { completeText } = installDesktop();
  completeText.mockImplementation(() => {
    throw new Error("boom");
  });
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  expect(await screen.findByText(/导演这次没有完成回复/)).toBeInTheDocument();
  const status = vi.fn(async () => {
    throw new Error("offline");
  });
  window.aijianGrok = { ...(window.aijianGrok ?? {}), status } as Window["aijianGrok"];
  window.dispatchEvent(new Event("aivora-grok-changed"));
  await waitFor(() => expect(status).toHaveBeenCalled());
});

it("shows a failure when the director bridge throws, including a retry", async () => {
  const { completeText } = installDesktop();
  completeText
    .mockImplementationOnce(async () => ({ kind: "OK", text: "不是格式" }))
    .mockImplementationOnce(() => {
      throw new Error("boom");
    });
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  fireEvent.click(await screen.findByRole("button", { name: "换个问法再问一次" }));
  expect(await screen.findByText(/这次没有写完/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "让导演拆镜头" })).toBeEnabled();
});

it("keeps a 5000-character status inside the window", () => {
  render(<ProWorkspace />);
  const note = document.querySelector(".status-note") as HTMLElement;
  const root = document.querySelector(".pro-root") as HTMLElement;
  note.textContent = "字".repeat(5000);
  expect(note.textContent?.length).toBe(5000);
  const noteStyle = getComputedStyle(note);
  expect(noteStyle.overflow || note.style.overflow).toBe("hidden");
  expect(noteStyle.textOverflow || note.style.textOverflow).toBe("ellipsis");
  expect(["0px", "0"]).toContain(noteStyle.minWidth || note.style.minWidth);
  expect(getComputedStyle(root).overflow || root.style.overflow).toBe("hidden");
  expect(root.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth + 1);
});

it("turns a long realistic reply into shots, cast, and performance", async () => {
  const picture = "雨夜巷口她停下脚步。".repeat(80);
  const shots = Array.from({ length: 4 }, (_, index) => ({
    picture: `${picture}第${index + 1}镜`,
    size: "中景",
    seconds: 3,
    line: "雨太大，我听不清。",
    speaker: "林雨",
    characters: ["林雨"],
    emotion: "哭",
    performance: "眼眶发红",
  }));
  const reply = JSON.stringify({ shots });
  expect(reply.length).toBeGreaterThan(3000);
  const { completeText } = installDesktop();
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("把这一场拆成镜头")) return { kind: "OK", text: reply };
    if (text.includes("抽出人物")) {
      return {
        kind: "OK",
        text: '{"characters":[{"name":"林雨","identity":"短发"}],"locations":[{"name":"巷口","prompt":"夜雨"}]}',
      };
    }
    if (text.includes("写成短剧")) {
      return {
        kind: "OK",
        text: '{"scenes":[{"title":"雨","place":"巷口","time":"夜","text":"林雨说：雨太大。"}]}',
      };
    }
    if (text.includes("表情变化") || text.includes("表演指导")) {
      return {
        kind: "OK",
        text: '[{"emotion":"哭","face":["皱眉","抬眼"],"eyes":"看向画右","hands":"抓紧伞","breath":"说前停一下"}]',
      };
    }
    return { kind: "OK", text: "好" };
  });
  window.localStorage.clear();
  render(<ProWorkspace projectId={PROJECT_ID} />);
  fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "林雨在雨里停下。" } });
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  fireEvent.click(await screen.findByRole("button", { name: "放进分镜" }));
  await waitFor(() =>
    expect(
      vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.some(([value]) =>
          (value as FilmProject).shots.some((shot) => shot.picture.includes("第1镜")),
        ),
    ).toBe(true),
  );
  fireEvent.click(stageTab("分镜"));
  expect(screen.getAllByText(/林雨/).length).toBeGreaterThan(0);
  expect(document.body.textContent).toContain("第1镜");
  expect(document.body.textContent).toContain("抓紧伞");
});

it("keeps the three-scene novel, its shots, portraits, and video references", async () => {
  const novel = [
    "雨夜旧书店。林晚说：「今晚打烊了。」沈砚说：「我留下。」",
    "码头仓库。周烈挥起钢条。林晚说：「刀放下。」周烈的前臂被划开。",
    "医院走廊。林晚哭着说：「你还活着。」",
  ].join("\n");
  const writer = {
    scenes: [
      { title: "雨夜旧书店", place: "雨夜旧书店", key_event: "沈砚许诺留下书店", beats: ["打烊"] },
      { title: "码头仓库", place: "码头仓库", key_event: "仓库里打了起来", beats: ["钢条"] },
      { title: "医院走廊", place: "医院走廊", key_event: "林晚在走廊哭", beats: ["哭"] },
    ],
  };
  const director = {
    scenes: [
      {
        place: "雨夜旧书店",
        shots: [
          {
            picture: "林晚站在柜台后",
            line: "今晚打烊了",
            speaker: "林晚",
            seconds: 3,
            characters: ["林晚"],
          },
          {
            picture: "沈砚停在门口",
            line: "我留下",
            speaker: "沈砚",
            seconds: 4,
            characters: ["沈砚"],
          },
          { picture: "灯下的书架", seconds: 2, characters: ["林晚"] },
        ],
      },
      {
        place: "码头仓库",
        shots: [
          {
            picture: "周烈举起钢条",
            line: "刀放下",
            speaker: "林晚",
            seconds: 2,
            characters: ["周烈", "林晚"],
          },
          { picture: "刀光擦过前臂", seconds: 2, characters: ["周烈"] },
          { picture: "钢条落地", seconds: 2, characters: ["周烈"] },
        ],
      },
      {
        place: "医院走廊",
        shots: [
          {
            picture: "林晚靠着墙",
            line: "你还活着",
            speaker: "林晚",
            seconds: 4,
            characters: ["林晚"],
          },
          { picture: "走廊尽头的灯", seconds: 3, characters: ["林晚"] },
        ],
      },
    ],
  };
  const createStoryFilm = vi.fn(
    async (_projectId: string, body: { shots?: { still?: string; references?: string[] }[] }) => ({
      data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" },
      body,
    }),
  );
  const { completeText } = installDesktop(createStoryFilm);
  Object.assign(window.aijian ?? {}, {
    generateFilmStill: vi.fn(async () => ({ path: "/tmp/aivora/films/still.png", reason: "" })),
  });
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("写成短剧")) return { kind: "OK", text: JSON.stringify(writer) };
    if (text.includes("抽出人物")) {
      return {
        kind: "OK",
        text: '{"characters":[{"name":"林晚","identity":"年轻女子"},{"name":"沈砚","identity":"中年男人"},{"name":"周烈","identity":"年轻男人"}],"locations":[]}',
      };
    }
    if (text.includes("把这一场拆成镜头")) return { kind: "OK", text: JSON.stringify(director) };
    if (text.includes("表演指导") || text.includes("每一镜")) {
      return {
        kind: "OK",
        text: JSON.stringify(
          JSON.parse(text.match(/镜头：(\[[^\n]+\])/)?.[1] ?? "[]").map((shot: { id: string }) => ({
            id: shot.id,
            emotion: "哭",
            face: ["皱眉"],
            eyes: "看向画右",
            hands: "抓紧衣角",
            breath: "说前停一下",
          })),
        ),
      };
    }
    return { kind: "OK", text: "好" };
  });
  render(<ProWorkspace projectId={PROJECT_ID} />);
  fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: novel } });
  pickHelper("编剧");
  fireEvent.click(screen.getByRole("button", { name: "让编剧分场" }));
  fireEvent.click(await screen.findByRole("button", { name: "放进剧本" }));
  await screen.findByText(/已记下人物/);
  expect(screen.getAllByRole("button", { name: /雨夜旧书店/ }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /码头仓库/ }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /医院走廊/ }).length).toBeGreaterThan(0);
  expect((screen.getByLabelText("这一场") as HTMLTextAreaElement).value).toContain("今晚打烊了");
  expect(document.body.textContent).not.toContain("沈砚许诺留下书店");
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  await screen.findByText(/导演拆好了/);
  const scopedRequest = completeText.mock.calls
    .filter(([request]) => request.text.includes("把这一场拆成镜头"))
    .at(-1)![0].text;
  expect(scopedRequest).toContain("今晚打烊了");
  expect(scopedRequest).not.toContain("刀放下");
  expect(scopedRequest).not.toContain("你还活着");
  fireEvent.click(await screen.findByRole("button", { name: "放进分镜" }));

  fireEvent.click(stageTab("分镜"));
  expect(
    screen
      .getAllByRole("button", { name: /雨夜旧书店/ })
      .find((button) => button.className.includes("scene"))?.textContent,
  ).toContain("镜");
  expect(
    screen
      .getAllByRole("button", { name: /码头仓库/ })
      .find((button) => button.className.includes("scene"))?.textContent,
  ).toContain("镜");
  expect(
    screen
      .getAllByRole("button", { name: /医院走廊/ })
      .find((button) => button.className.includes("scene"))?.textContent,
  ).toContain("镜");
  expect(document.body.textContent).toContain("抓紧衣角");
  fireEvent.click(stageTab("角色"));
  fireEvent.click(screen.getAllByRole("button", { name: /^补齐.+的定妆照（还缺 \d 张）$/ })[0]!);
  await waitFor(() =>
    expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
  );
  fireEvent.click(stageTab("分镜"));
  await adoptListedShots();
  fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() => expect(createStoryFilm).toHaveBeenCalled());
  const sent = createStoryFilm.mock.calls[0]?.[1];
  expect(sent?.shots?.[0]?.still).toContain("still.png");
  expect(sent?.shots?.[0]?.references ?? []).not.toContain(sent?.shots?.[0]?.still);
});

it("automatically retries one director timeout and hides expired suggestions after a scene edit", async () => {
  const { completeText } = installDesktop();
  let attempts = 0;
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("把这一场拆成镜头")) {
      attempts += 1;
      if (attempts === 1)
        return { kind: "ERROR", code: "TEXT_TIMEOUT", detail: "很久没有新的字，已停止", text: "" };
      return {
        kind: "OK",
        text: JSON.stringify({ shots: [{ picture: "雨水落下", size: "中景", seconds: 3 }] }),
      };
    }
    return { kind: "OK", text: "[]" };
  });
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  expect(await screen.findByRole("button", { name: "放进分镜" })).toBeInTheDocument();
  expect(attempts).toBe(2);
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "剧本已修改。" } });
  expect(screen.queryByRole("button", { name: "放进分镜" })).not.toBeInTheDocument();
  fireEvent.click(stageTab("角色与场景"));
  expect(screen.queryByText(/建议拆成/)).not.toBeInTheDocument();
  expect(screen.queryByText("当前镜头")).not.toBeInTheDocument();
});

it("releases writer busy state after a rejected request and permits retry", async () => {
  const { completeText } = installDesktop();
  completeText.mockRejectedValue(new Error("network failure"));
  await openSample();
  pickHelper("编剧");
  fireEvent.click(screen.getByRole("button", { name: "让编剧分场" }));
  expect(await screen.findByText(/编剧这次未完成/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "让导演拆镜头" })).not.toBeDisabled();
  expect(screen.queryByRole("button", { name: "放进剧本" })).not.toBeInTheDocument();
});

it("discards a cast extraction that returns after switching to another project", async () => {
  const { completeText } = installDesktop();
  let resolveCast: (reply: { kind: string; text: string }) => void = () => undefined;
  const castReply = new Promise<{ kind: string; text: string }>((resolve) => {
    resolveCast = resolve;
  });
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("抽出人物")) return castReply;
    return { kind: "OK", text: JSON.stringify({ shots: [{ picture: "门口下雨。", seconds: 3 }] }) };
  });
  render(<ProWorkspace projectId={PROJECT_ID} />);
  fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "门口下雨。" } });
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  fireEvent.click(await screen.findByRole("button", { name: "放进分镜" }));
  await waitFor(() =>
    expect(completeText.mock.calls.some(([request]) => request.text.includes("抽出人物"))).toBe(
      true,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
  await act(async () =>
    resolveCast({
      kind: "OK",
      text: JSON.stringify({
        characters: [{ name: "迟到的甲作品人物", identity: "成年男性" }],
        locations: [{ name: "甲作品地点", prompt: "门口" }],
      }),
    }),
  );
  fireEvent.click(stageTab("角色与场景"));
  expect(document.body.textContent).not.toContain("迟到的甲作品人物");
  expect(document.body.textContent).not.toContain("甲作品地点");
  await waitFor(() => expect(window.aijian?.writeFilmProject).toHaveBeenCalled());
  const writes = vi.mocked(window.aijian!.writeFilmProject!).mock.calls;
  const latest = writes.at(-1)?.[0] as ReturnType<typeof sampleFilm>;
  expect(latest.characters).toEqual([]);
});

it("reports failed performance enrichment without claiming that stage completed", async () => {
  const { completeText } = installDesktop();
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("表演指导") || text.includes("按给出的 id 为每一镜"))
      throw new Error("performance unavailable");
    return {
      kind: "OK",
      text: JSON.stringify({
        shots: [{ picture: "林骁看向门口", characters: ["林骁"], seconds: 3 }],
      }),
    };
  });
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  expect(await screen.findByText(/表演补充未完成/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "让导演拆镜头" })).not.toBeDisabled();
});

it("manual action assigns only the current shot and persists the other shot as unassigned", async () => {
  const { completeText } = installDesktop();
  completeText.mockImplementation(async ({ text }: { text: string }) => ({
    kind: "OK",
    text: JSON.stringify({
      shots: [
        {
          shot_id: text.match(/当前镜头 id：([^；]+)/)?.[1],
          nodes: [{ text: "他抬手", feasibility: "稳" }],
        },
        { shot_id: "another-shot", nodes: [{ text: "另一人翻越高墙", feasibility: "稳" }] },
      ],
    }),
  }));
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  pickHelper("动作指导");
  fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
  fireEvent.click(await screen.findByRole("button", { name: "放进分镜" }));
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  expect((screen.getByLabelText("动作要点") as HTMLTextAreaElement).value).toBe(
    sampleFilm().shots[0]!.action,
  );
  await waitFor(() => {
    const writes = vi.mocked(window.aijian!.writeFilmProject!).mock.calls;
    const saved = writes.at(-1)?.[0] as FilmProject | undefined;
    expect(saved?.shots[0]?.actionBeats).toContain("他抬手");
    expect(saved?.shots[0]?.actionBeats?.join("\n")).not.toContain("另一人翻越高墙");
  });
  expect((screen.getByLabelText("动作要点") as HTMLTextAreaElement).value).not.toContain(
    "另一人翻越高墙",
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.some(([film]) =>
          (film as ReturnType<typeof sampleFilm>).unassignedBeats?.some(
            (beat) => beat.text === "另一人翻越高墙",
          ),
        ),
    ).toBe(true),
  );
});

it("keeps 提示词 and 审片 out of the chat and answers them under 高级", async () => {
  const { completeText } = installDesktop();
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("写成这一镜的提示词")) {
      return {
        kind: "OK",
        text: JSON.stringify({
          keyframe: { prompt_zh: "雨夜巷口，林骁抬眼", prompt_en: "rainy alley" },
        }),
      };
    }
    return { kind: "OK", text: "好" };
  });
  await openSample();
  openBoardTools();
  fireEvent.click(screen.getByRole("button", { name: "写英文画面说明" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认修改" }));
  expect(await screen.findAllByText(/画面说明已修改/)).not.toHaveLength(0);
  expect(screen.getByRole("list", { name: "字段改动" })).toHaveTextContent("rainy alley");
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  const helpers = screen.getByLabelText("正在和：") as HTMLSelectElement;
  expect([...helpers.options].map((item) => item.value)).not.toContain("prompter");
  expect(document.querySelector(".pb.chat")).not.toHaveTextContent("画面说明已修改");
  expect(screen.queryByText("雨夜巷口，林骁抬眼")).not.toBeInTheDocument();
});

it("starts each page with its own helper", async () => {
  installDesktop();
  await openSample();
  const helper = () => (screen.getByLabelText("正在和：") as HTMLSelectElement).value;
  expect(helper()).toBe("writer");
  expect(screen.getByLabelText("跟助手说")).toHaveAttribute(
    "placeholder",
    expect.stringContaining("跟编剧说说你的想法"),
  );
  fireEvent.click(stageTab("角色与场景"));
  expect(helper()).toBe("art");
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  expect(helper()).toBe("director");
  pickHelper("表演指导");
  expect(helper()).toBe("performance");
  fireEvent.click(stageTab("剧本"));
  expect(helper()).toBe("writer");
});

it("edits the picked place on the 场景 tab, not the person picked before", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("角色与场景"));
  expect(screen.getByLabelText("人物名字")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "场景" }));
  // 3JR-U03: a place has its own form and reference picture.
  expect(screen.queryByLabelText("人物名字")).not.toBeInTheDocument();
  const place = screen.getByLabelText("场景名字") as HTMLInputElement;
  expect(place.value).not.toBe("");
  expect(screen.getByText("还没有参考图", { selector: ".slot-empty" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("场景里怎么摆"), { target: { value: "门在画左" } });
  fireEvent.click(screen.getByRole("button", { name: "道具" }));
  expect(screen.queryByLabelText("人物名字")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "场景" }));
  expect(screen.getByLabelText("场景里怎么摆")).toHaveValue("门在画左");
  fireEvent.click(screen.getByRole("button", { name: "角色" }));
  expect(screen.getByLabelText("人物名字")).toBeInTheDocument();
});

it("keeps a storyboard card to its size, length, picture sentence and first line", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  const card = document.querySelectorAll(".pb.grid .card")[3] as HTMLElement;
  const shot = sampleFilm().shots[3]!;
  const picture = card.querySelector<HTMLElement>(".cb > p.pic")!;
  expect(picture).toHaveTextContent(shot.picture);
  expect(picture).toHaveAttribute("title", shot.picture);
  const line = card.querySelector<HTMLElement>(".cb > p.line")!;
  expect(line).toHaveTextContent(shot.line);
  expect(line).toHaveAttribute("title", shot.line);
  // 3JR-U05: all the words wait over the card, outside the card's accessible name.
  const full = card.querySelector<HTMLElement>(".full")!;
  expect(full).toHaveAttribute("aria-hidden", "true");
  expect(full.textContent).toContain(shot.picture);
  expect(full.textContent).toContain(shot.line);
  expect(card.textContent).toContain(shot.size);
  expect(card.textContent).toContain(`${shot.seconds}s`);
  expect(card.textContent).not.toContain(shot.performance);
  // 4C-U05: no dot on the card; who wrote it is in the card's tooltip.
  expect(card.querySelector(".src")).toBeNull();
  expect(card).toHaveAttribute("title", expect.stringContaining("原来就有"));
  fireEvent.click(card);
  fireEvent.change(screen.getByLabelText("分镜画面"), { target: { value: "林骁抬眼看雨" } });
  expect(document.querySelectorAll(".pb.grid .card")[3]).toHaveAttribute(
    "title",
    expect.stringContaining("你改过"),
  );
  expect(screen.getByLabelText("表演")).toHaveValue(shot.performance);
});

it("shows one row of shot lengths with 自定义, a three-line picture box and style under 高级", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  const lengths = screen.getByLabelText("时长");
  expect(
    within(lengths)
      .getAllByRole("button")
      .map((item) => item.textContent),
  ).toEqual(["2", "3", "4", "5", "6", "10", "自定义"]);
  fireEvent.click(within(lengths).getByRole("button", { name: "3 秒" }));
  expect(screen.queryByLabelText("时长秒数")).not.toBeInTheDocument();
  expect(within(lengths).getByRole("button", { name: "3 秒" })).toHaveClass("on");
  fireEvent.click(within(lengths).getByRole("button", { name: "自定义" }));
  fireEvent.change(screen.getByLabelText("时长秒数"), { target: { value: "7" } });
  expect(screen.getByLabelText("时长秒数")).toHaveValue(7);
  fireEvent.click(screen.getByRole("button", { name: /镜头 2/ }));
  fireEvent.click(screen.getByRole("button", { name: /镜头 1/ }));
  expect(screen.getByLabelText("时长秒数")).toHaveValue(7);
  expect(screen.getByLabelText("分镜画面")).toHaveAttribute("rows", "3");
  expect(screen.queryByLabelText("画风")).not.toBeInTheDocument();
  // 4C-U05: 高级 starts folded; opening it shows the shot's own style.
  expect(screen.getByLabelText("这一镜的画风").closest("details")).not.toHaveAttribute("open");
  openGroup("高级");
  expect(screen.getByLabelText("这一镜的画风").closest("details")).toHaveAttribute("open");
  expect(screen.getByLabelText("这一镜的画风")).toHaveAttribute(
    "placeholder",
    "不写就用整部作品的画风：写实电影感",
  );
});

it("keeps one button under a shot that follows its state, the rest under 更多", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  const footer = () => document.querySelector(".pfoot2") as HTMLElement;
  expect(within(footer()).getAllByRole("button").length).toBeLessThanOrEqual(3);
  // 4A-U09: 生成这一场 is the page's primary button; the one under the shot is plain.
  expect(footer().querySelectorAll(".btn.primary")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "生成这一场" })).toHaveClass("primary");
  expect(within(footer()).getByRole("button", { name: "生成画面" })).toBeInTheDocument();
  fireEvent.click(within(footer()).getByRole("button", { name: "更多操作" }));
  expect(
    within(screen.getByRole("menu", { name: "这一镜的更多操作" }))
      .getAllByRole("button")
      .map((item) => item.textContent),
  ).toEqual(["前移", "后移", "出 4 张候选", "删除这一镜"]);
  fireEvent.click(within(footer()).getByRole("button", { name: "更多操作" }));
  fireEvent.click(within(footer()).getByRole("button", { name: "生成画面" }));
  expect(within(footer()).getByRole("button", { name: "正在生成画面" })).toBeDisabled();
  expect(document.querySelector(".card.sel .badge")?.textContent).toBe("正在生成画面");
  expect(await screen.findByText(/画面出好了。/)).toBeInTheDocument();
  expect(within(footer()).getByRole("button", { name: "生成视频" })).not.toHaveClass("primary");
  fireEvent.click(within(footer()).getByRole("button", { name: "更多操作" }));
  expect(screen.getByRole("button", { name: "重新生成画面" })).toBeInTheDocument();
});

it("keeps one filled primary button per page; 导出成片 leads only when it can (4A-U09)", async () => {
  installDesktop(
    vi.fn(async () => ({
      data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" },
    })),
  );
  await openSample();
  const primaries = () =>
    [...document.querySelectorAll<HTMLElement>(".pro-root .btn.primary")]
      .filter((item) => !item.closest(".dialog"))
      .map((item) => item.textContent?.trim());
  const exportButton = () => screen.getByRole("button", { name: "导出成片" });
  // Nothing to export yet: grayed, with the reason beside it; a click still explains.
  expect(exportButton()).toHaveClass("off");
  expect(exportButton()).toHaveAccessibleDescription("还没有视频可导出");
  fireEvent.click(stageTab("剧本"));
  expect(primaries()).toHaveLength(1);
  fireEvent.click(stageTab("角色与场景"));
  expect(primaries()).toEqual(["给所有人出定妆照"]);
  fireEvent.click(stageTab("分镜"));
  expect(primaries()).toEqual(["生成这一场"]);
  fireEvent.click(stageTab("剪辑"));
  expect(primaries().length).toBeLessThanOrEqual(1);
  expect(primaries()).not.toContain("导出成片");
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  expect(primaries()).toEqual(["生成 1 个版本"]);
  await adoptOpenStill();
  fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  expect(await screen.findByText("这一版已经生成。")).toBeInTheDocument();
  // One video: export is plain on the shot page and the one primary on 剪辑.
  expect(exportButton()).not.toHaveClass("off");
  expect(exportButton()).not.toHaveClass("primary");
  expect(screen.queryByText("还没有视频可导出")).toBeNull();
  fireEvent.click(stageTab("剪辑"));
  expect(primaries()).toEqual(["导出成片"]);
});

it("gives each action one place: undo, sign-in and the preview's sound (4A-U10)", async () => {
  installDesktop();
  window.localStorage.setItem("aivora.sound", "on");
  await openSample();
  for (const tab of ["剧本", "剪辑"]) {
    fireEvent.click(stageTab(tab));
    expect(screen.getAllByRole("button", { name: "撤销" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "重做" })).toHaveLength(1);
  }
  // Signing in lives on the avatar: a dot for the state, the words at the top of its menu.
  const avatar = screen.getByRole("button", { name: "账号" });
  expect(avatar.querySelector(".avatar-dot")).toHaveAttribute("data-state", "ok");
  expect(screen.queryByRole("button", { name: /Grok 会员 · 已连接|未登录/ })).toBeNull();
  fireEvent.click(avatar);
  expect(
    within(screen.getByRole("menu", { name: "账号菜单" })).getByText("Grok 会员 · 已连接"),
  ).toBeInTheDocument();
  fireEvent.click(avatar);
  // The sound switch is on the player, and M does the same.
  expect(screen.queryByRole("button", { name: /^声音(开|关)$/ })).toBeNull();
  const mute = () => screen.getByRole("button", { name: "预览静音 (M)" });
  expect(mute()).toHaveAttribute("aria-pressed", "false");
  fireEvent.keyDown(window, { key: "m" });
  expect(mute()).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  expect(mute()).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(mute());
  expect(mute()).toHaveAttribute("aria-pressed", "false");
});

it("keeps the assistant in one place and shows a suggestion as a change (4A-U11)", async () => {
  const { completeText } = installDesktop();
  completeText.mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("把这一场拆成镜头")) {
      const shots = Array.from({ length: 4 }, (_, index) => ({
        picture: `第${index + 1}镜的巷口`,
        size: "中景",
        seconds: 2,
      }));
      return { kind: "OK", text: JSON.stringify({ shots }) };
    }
    return { kind: "OK", text: "好", model: "grok-4.7" };
  });
  await openSample();
  const tabs = () => [...document.querySelectorAll(".ptabs")].map((item) => item.textContent);
  for (const tab of ["剧本", "角色与场景", "分镜", "剪辑"]) {
    fireEvent.click(stageTab(tab));
    expect(
      tabs().filter((text) => text?.includes("AI 助手")),
      tab,
    ).toHaveLength(1);
  }
  // Ctrl+J switches 属性 and AI 助手 where both are there.
  fireEvent.click(stageTab("剪辑"));
  expect(screen.queryByLabelText("跟助手说")).toBeNull();
  fireEvent.keyDown(window, { key: "j", ctrlKey: true });
  expect(screen.getByLabelText("跟助手说")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "j", ctrlKey: true });
  expect(screen.getByLabelText("改这一镜的描述")).toBeInTheDocument();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  fireEvent.keyDown(window, { key: "j", ctrlKey: true });
  expect(screen.getByLabelText("跟助手说")).toBeInTheDocument();
  // 剧本: the opening note is gray text, and 导入小说 is not a quick suggestion.
  fireEvent.click(stageTab("剧本"));
  pickHelper("编剧");
  expect(document.querySelector(".chat-hint")).toHaveTextContent("跟这位助手说说你的想法");
  expect(document.querySelector(".pane.ai .msg-u")).toBeNull();
  expect(
    within(document.querySelector(".quick") as HTMLElement).queryByText("导入小说"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  expect(
    within(screen.getByRole("menu", { name: "作品菜单" })).getByRole("button", {
      name: "导入小说",
    }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  // The director's suggestion says what it changes; 不要 changes nothing.
  pickHelper("导演");
  const before = document.querySelectorAll(".scene").length;
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  expect(await screen.findByText(/^现在 6 个 → 建议 \d+ 个$/)).toBeInTheDocument();
  expect(document.querySelectorAll(".nx-suggest-row[data-kind]").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "不要" }));
  expect(document.querySelector(".nx-suggest")).toBeNull();
  expect(document.querySelectorAll(".scene")).toHaveLength(before);
  // 放进分镜, then 撤销 from the status bar.
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  fireEvent.click(await screen.findByRole("button", { name: "放进分镜" }));
  fireEvent.click(await screen.findByRole("button", { name: "撤销刚才放进去的" }));
  fireEvent.click(stageTab("分镜"));
  // 单镜 was left open above; the storyboard is one step back.
  fireEvent.click(screen.getByRole("button", { name: "全部镜头" }));
  expect(document.querySelectorAll(".pb.grid .card")).toHaveLength(6);
});

it("says plainly on 单镜 what one click makes, with the long text folded (4A-U12)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  const estimate = () => screen.getByTestId("generation-estimate").textContent;
  fireEvent.click(screen.getAllByRole("button", { name: "2 秒" })[0]!);
  expect(estimate()).toBe("1 段 2 秒的视频 · 用 Grok 会员额度，不另外收费");
  fireEvent.click(screen.getByRole("button", { name: "2" }));
  expect(estimate()).toBe("2 段 2 秒的视频 · 用 Grok 会员额度，不另外收费");
  expect(screen.getAllByText("不另外收费", { exact: false })).toHaveLength(1);
  // The whole text the AI gets stays folded; the note about it is gray, not orange-red.
  const full = screen.getByText("看 AI 会收到的完整说明").closest("details");
  expect(full).not.toHaveAttribute("open");
  expect(screen.getByText("包括这一镜的画面和人物外貌")).not.toHaveClass("role-a");
  expect(document.querySelectorAll(".shotrow").length).toBeGreaterThan(0);
});

it("opens the scene's sound in place of the preview on 剪辑 (4B-U01)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("剪辑"));
  fireEvent.click(screen.getByRole("button", { name: "声音" }));
  // Only the mood and the plain layers; no decibels on screen.
  const moods = screen.getByRole("radiogroup");
  expect(within(moods).getAllByRole("radio").length).toBe(8);
  expect(document.querySelector(".sound-pane")?.textContent ?? "").not.toMatch(/dB|分贝/);
  expect(screen.queryByRole("button", { name: "播放" })).toBeNull();
  fireEvent.click(within(moods).getByRole("radio", { name: "紧张" }));
  await waitFor(() => {
    const saved = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as FilmProject;
    const scene = saved.shots[0]!.sceneId;
    expect(
      saved.shots
        .filter((item) => item.sceneId === scene)
        .every((item) => item.sound.musicMood === "紧张"),
    ).toBe(true);
  });
  expect(within(moods).getByRole("radio", { name: "紧张" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "预览" }));
  expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
});

it("picks a subtitle style on 剪辑 and keeps it on the work (4B-U03)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("剪辑"));
  fireEvent.click(screen.getByRole("button", { name: "字幕" }));
  // Landscape and portrait at once; the portrait one marks where the platform buttons sit.
  expect(screen.getByText("平台的按钮和标题会挡住这里")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /醒目黄字/ }));
  fireEvent.click(screen.getByRole("button", { name: "用这个样式" }));
  expect(await screen.findByText("已记下字幕样式。")).toBeInTheDocument();
  await waitFor(() => {
    const saved = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as
      (FilmProject & { subtitleStyle?: string }) | undefined;
    expect(saved?.subtitleStyle).toBe("yellow");
  });
  fireEvent.click(screen.getByRole("button", { name: "预览" }));
  expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
});

it("edits the cover inside the export dialog, with 「AI 生成」 on by default (4B-U04)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  const dialog = () => screen.getByRole("dialog", { name: "导出成片" });
  expect(within(dialog()).getByText(/标「AI 生成」/)).toBeInTheDocument();
  fireEvent.click(within(dialog()).getByRole("button", { name: "改封面" }));
  const mark = within(dialog()).getByRole("switch", { name: "「AI 生成」标识" });
  expect(mark).toHaveAttribute("aria-checked", "true");
  fireEvent.click(mark);
  expect(within(dialog()).getByRole("status")).toHaveTextContent("部分平台要求标注 AI 生成");
  fireEvent.change(within(dialog()).getByLabelText("片名"), { target: { value: "雨夜巷战·终" } });
  fireEvent.click(within(dialog()).getByRole("button", { name: "用这个封面" }));
  expect(await screen.findByText("已记下封面。")).toBeInTheDocument();
  expect(within(dialog()).getByText(/「雨夜巷战·终」.*不标「AI 生成」/)).toBeInTheDocument();
  await waitFor(() => {
    const saved = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as
      (FilmProject & { cover?: { title: string; aiMark: boolean } }) | undefined;
    expect(saved?.cover).toMatchObject({ title: "雨夜巷战·终", aiMark: false });
  });
});

it("sets aspect, quality and subtitles in the export dialog, with one 导出 button (4B-U06)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  const dialog = within(screen.getByRole("dialog", { name: "导出成片" }));
  // Without a desktop that can crop, the work's own aspect is shown, not offered.
  expect(dialog.getByText(/（作品的画幅）/)).toBeInTheDocument();
  expect(dialog.getByLabelText("清晰度")).toHaveValue("1080p");
  const subs = dialog.getByRole("radiogroup", { name: "字幕" });
  expect(within(subs).getByRole("radio", { name: "烧进画面" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  fireEvent.click(within(subs).getByRole("radio", { name: "单独文件" }));
  expect(within(subs).getByRole("radio", { name: "单独文件" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  fireEvent.change(dialog.getByLabelText("清晰度"), { target: { value: "720p" } });
  expect(dialog.getByLabelText("清晰度")).toHaveValue("720p");
  expect(document.querySelectorAll(".dialog .btn.primary")).toHaveLength(1);
  expect(dialog.getByRole("button", { name: "检查成片" })).toHaveClass("primary");
  expect(dialog.queryByRole("button", { name: "开始导出" })).toBeNull();
});

it("shows historical lip-sync markers without claiming verification, playback or retry (4B-U07)", async () => {
  installDesktop();
  window.aijian!.cancelFilmAssemblyOperation = vi.fn(async () => ({ kind: "NOT_FOUND" as const }));
  const film = sampleFilm();
  // The sample's first scene has no shots: put three of them there, where the work opens.
  const [talk, miss, pending] = film.shots;
  talk!.sceneId = film.scenes[0]!.id;
  miss!.sceneId = film.scenes[0]!.id;
  pending!.sceneId = film.scenes[0]!.id;
  const made = (shotId: string, lipSync: "done" | "failed" | "pending") =>
    ({
      id: `${shotId}-take`,
      shotId,
      index: 1,
      status: "done",
      stillUrl: "",
      videoPath: `/tmp/${shotId}.mp4`,
      videoUrl: `aivora-media://local/?path=${encodeURIComponent(`/tmp/${shotId}.mp4`)}`,
      prompt: "",
      createdAt: "",
      reason: "",
      lipSync: { lipSync },
    }) as FilmProject["shots"][number]["takes"][number];
  talk!.takes = [made(talk!.id, "done")];
  talk!.selectedTakeId = `${talk!.id}-take`;
  miss!.takes = [made(miss!.id, "failed")];
  miss!.selectedTakeId = `${miss!.id}-take`;
  pending!.takes = [made(pending!.id, "pending")];
  pending!.selectedTakeId = `${pending!.id}-take`;
  const media = structuredClone(
    film.shots.map(({ id, takes, selectedTakeId }) => ({ id, takes, selectedTakeId })),
  );
  vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
  window.localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace projectId={PROJECT_ID} />);
  await screen.findByRole("button", { name: /后台生成/ });
  fireEvent.click(stageTab("分镜"));
  const marks = () => [...document.querySelectorAll(".card .lips")].map((item) => item.textContent);
  expect(marks()).toEqual(["口型待核验", "口型待核验", "口型待核验"]);
  const titles = [...document.querySelectorAll(".card .lips")].map((item) =>
    item.getAttribute("title"),
  );
  expect(titles).toEqual([
    "历史口型标记为已完成，实际对齐尚未核验。",
    "历史口型标记为失败，实际对齐与声音尚未核验。",
    "历史口型标记为待处理，当前未核验实际口型状态。",
  ]);
  expect(document.querySelectorAll(".card .lips.failed")).toHaveLength(1);
  expect(titles.join(" ")).not.toMatch(/嘴型和台词对上了|正在对口型|可重试|单独配音/);
  fireEvent.click(stageTab("剪辑"));
  expect([...document.querySelectorAll(".clip .lips")].map((item) => item.textContent)).toEqual([
    "口型待核验",
    "口型待核验",
    "口型待核验",
  ]);
  expect(
    [...document.querySelectorAll(".clip .lips")].map((item) => item.getAttribute("title")),
  ).toEqual(titles);
  expect(window.aijian!.createStoryFilm).not.toHaveBeenCalled();
  expect(window.aijian!.generateFilmStill).not.toHaveBeenCalled();
  expect(window.aijianGrok!.completeText).not.toHaveBeenCalled();
  await waitFor(() => expect(window.aijian!.writeFilmProject).toHaveBeenCalled());
  const writes = vi.mocked(window.aijian!.writeFilmProject!).mock.calls;
  for (const [value] of writes)
    expect(
      (value as FilmProject).shots.map(({ id, takes, selectedTakeId }) => ({
        id,
        takes,
        selectedTakeId,
      })),
    ).toEqual(media);
  expect(
    film.shots.map(({ id, takes, selectedTakeId }) => ({ id, takes, selectedTakeId })),
  ).toEqual(media);
});

it("shows in-to-out shot selection, audio-preservation limits and 「版本 2/3」 (4C-U01)", async () => {
  installDesktop();
  const film = sampleFilm();
  const [talk] = film.shots;
  talk!.sceneId = film.scenes[0]!.id;
  talk!.line = "你来晚了。这家店，下个月就没了。";
  const made = (index: number) =>
    ({
      id: `${talk!.id}-take-${index}`,
      shotId: talk!.id,
      index,
      status: "done",
      stillUrl: "",
      videoPath: `/tmp/${talk!.id}-${index}.mp4`,
      videoUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    }) as FilmProject["shots"][number]["takes"][number];
  talk!.takes = [made(1), made(2), made(3)];
  talk!.selectedTakeId = `${talk!.id}-take-2`;
  vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
  window.localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace projectId={PROJECT_ID} />);
  await screen.findByRole("button", { name: /后台生成/ });
  fireEvent.click(stageTab("分镜"));
  expect(document.querySelector(".card .ver")).toHaveTextContent("版本 2/3");
  fireEvent.click(stageTab("剪辑"));
  expect(document.querySelector(".clip.v .ver")).toHaveTextContent("版本 2/3");
  expect(document.querySelector(".clip.v .lb")).toHaveTextContent(`1-${talk!.no}`);
  expect(document.querySelector(".clip.v")).toHaveAttribute(
    "title",
    `第 1 场第 ${talk!.no} 个镜头`,
  );
  fireEvent.click(document.querySelector(".clip.v") as HTMLElement);
  expect(document.querySelector(".selbar .lab")).toHaveTextContent(/已选 镜头 \d+ · 00:00\.0–/);
  expect(screen.getByText("仅重做画面，保留原音轨")).toHaveAttribute(
    "title",
    expect.stringContaining("不自动扩展整句，也不重配对白或验证口型"),
  );
  expect(screen.queryByText("这句台词会整句重来")).not.toBeInTheDocument();
  expect(document.querySelector("[title*=这一整句都会重来]")).toBeNull();
});

it("keeps the person's defaults in 设置: folder, 「AI 生成」, beginner mode (4C-U03)", async () => {
  installDesktop();
  try {
    await openSample();
    fireEvent.click(screen.getByRole("button", { name: "账号" }));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const settings = within(screen.getByRole("dialog", { name: "设置" }));
    expect(settings.getByText(/只能用 Grok 会员登录/)).toBeInTheDocument();
    expect(settings.getByText(/软件看不到 Grok 会员还剩多少额度/)).toBeInTheDocument();
    expect(settings.queryByText(/\d+ ?次/)).toBeNull();
    fireEvent.change(settings.getByLabelText("默认导出文件夹"), {
      target: { value: "/tmp/my-films" },
    });
    fireEvent.click(settings.getByRole("checkbox", { name: /新封面标「AI 生成」/ }));
    fireEvent.click(settings.getByRole("checkbox", { name: /新手模式/ }));
    fireEvent.click(settings.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
    // Beginner mode: one version per shot, 「一次出几个」 not offered.
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    expect(screen.queryByText("一次出几个")).toBeNull();
    expect(screen.getByRole("button", { name: "生成 1 个版本" })).toBeInTheDocument();
    // The export dialog starts from the chosen folder, and a new cover without the mark.
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    const dialog = within(screen.getByRole("dialog", { name: "导出成片" }));
    expect(dialog.queryByLabelText("导出文件夹")).toBeNull();
    expect(dialog.getByText(/审核后选择保存位置/)).toBeInTheDocument();
    expect(dialog.getByText(/不标「AI 生成」/)).toBeInTheDocument();
  } finally {
    window.localStorage.removeItem("aivora.prefs");
  }
});

it("names only shortcuts that work, on the tabs and in 设置 (4C-U04)", async () => {
  installDesktop();
  await openSample();
  expect(stageTab("剧本")).toHaveAttribute("title", "剧本（按 1）");
  expect(stageTab("剪辑")).toHaveAttribute("title", "剪辑（按 4）");
  fireEvent.click(stageTab("剪辑"));
  expect(screen.getByRole("button", { name: "播放" })).toHaveAttribute("title", "播放（空格）");
  expect(document.querySelector('[title*="(V)"], [title*="(Del)"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "账号" }));
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  const keys = within(screen.getByRole("region", { name: "快捷键" }));
  for (const key of ["1 – 4", "Ctrl+Z", "Ctrl+J", "空格", "I / O", "M", "Esc"]) {
    expect(keys.getByText(key)).toBeInTheDocument();
  }
});

it("groups a shot's properties and switches between all shots and one (4C-U05)", async () => {
  installDesktop();
  window.localStorage.removeItem("aivora.board.groups");
  try {
    await openSample();
    fireEvent.click(stageTab("分镜"));
    const group = (name: string) =>
      [...document.querySelectorAll<HTMLDetailsElement>(".pgroup")].find(
        (item) => item.querySelector("summary")?.textContent === name,
      )!;
    expect(group("画面").open).toBe(true);
    expect(group("声音").open).toBe(false);
    expect(group("高级").open).toBe(false);
    // 站位 and 朝向 fold with 高级 now.
    expect(group("高级")).toContainElement(screen.getByLabelText("站位"));
    expect(group("高级")).toContainElement(screen.getByLabelText("朝向"));
    expect(group("声音")).toContainElement(screen.getByLabelText("这一镜的环境音"));
    openGroup("声音");
    expect(group("声音").open).toBe(true);
    // The browser says 「toggle」 a moment later; that is when the choice is kept.
    await waitFor(() =>
      expect(window.localStorage.getItem("aivora.board.groups")).toContain('"sound":true'),
    );
    // It remembers: the next time the page is drawn, 声音 is still open.
    fireEvent.click(stageTab("剧本"));
    fireEvent.click(stageTab("分镜"));
    expect(group("声音").open).toBe(true);
    // No dot on the card; 全部镜头 | 单个镜头 replaces 单镜 and 返回分镜.
    expect(document.querySelector(".card .src")).toBeNull();
    expect(screen.getByRole("button", { name: "全部镜头" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    expect(screen.getByRole("button", { name: "单个镜头" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "全部镜头" }));
    expect(document.querySelectorAll(".pb.grid .card").length).toBeGreaterThan(0);
  } finally {
    window.localStorage.removeItem("aivora.board.groups");
  }
});

it("groups the 作品 menu and keeps deleting last, in red, behind a confirm (4C-U06)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  const menu = screen.getByRole("menu", { name: "作品菜单" });
  expect([...menu.querySelectorAll(".menu-group")].map((item) => item.textContent)).toEqual([
    "作品",
    "这一部",
  ]);
  expect(within(menu).queryByLabelText("作品名")).toBeNull();
  const buttons = within(menu).getAllByRole("button");
  const last = buttons.slice(-2).map((item) => item.textContent);
  expect(last).toEqual(["删除这一集", "删除这部作品"]);
  for (const item of buttons.slice(-2)) expect(item).toHaveClass("danger");
  expect(menu.querySelector(".menu-sep")).not.toBeNull();
  fireEvent.click(within(menu).getByRole("button", { name: "删除这部作品" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(/删除/);
});

it("keeps the work's settings together and fixes the small 剪辑 things (4C-U07)", async () => {
  installDesktop();
  await openSample();
  // The narration sits with the whole work's style, not in one person's form.
  fireEvent.click(stageTab("角色与场景"));
  const work = screen.getByRole("region", { name: "整部作品的画风" });
  expect(within(work).getByLabelText("旁白声音")).toBeInTheDocument();
  expect(within(work).getByRole("button", { name: "试听旁白" })).toBeInTheDocument();
  // 剪辑: a gray note when there is nothing to play, and the lane volume shows its number.
  fireEvent.click(stageTab("剪辑"));
  expect(document.querySelector(".screen-empty")).toHaveTextContent("还没有可以播放的视频。");
  expect(document.querySelector(".subt")).toBeNull();
  const number = screen.getByLabelText("对白音量").nextElementSibling;
  expect(number).toHaveClass("vol-num");
  expect(number?.textContent).toMatch(/^\d+$/);
  // 分镜 with a scene that has no shots: this scene and the whole work, not an empty column.
  fireEvent.click(stageTab("分镜"));
  const empty = [...document.querySelectorAll<HTMLElement>(".scene")].find(
    (item) => !/\d+ 镜/.test(item.textContent ?? "") || /0 镜/.test(item.textContent ?? ""),
  );
  expect(empty).toBeDefined();
  fireEvent.click(empty!);
  expect(screen.getByLabelText("这一场在哪")).toBeInTheDocument();
  expect(screen.getByLabelText("这一场的环境音")).toBeInTheDocument();
});

it("splits the status bar in three and tells the assistant what it is looking at (4C-U08)", async () => {
  installDesktop();
  await openSample();
  const bar = document.querySelector(".statusbar")!;
  expect([...bar.children].map((item) => item.className)).toEqual([
    "sb-left",
    "sb-mid",
    "sb-right",
  ]);
  expect(bar.querySelector(".sb-mid .task")).toHaveClass("idle");
  // 剧本: the assistant names the scene; @ puts a person or a shot into the message.
  fireEvent.click(stageTab("剧本"));
  expect(screen.getByText(/^正在看：第 \d+ 场「.+」$/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "提到人物、场景或镜头" }));
  const people = within(screen.getByRole("menu", { name: "提到谁" })).getAllByRole("menuitem");
  expect(people[0]?.textContent).toMatch(/^@/);
  fireEvent.click(people[0]!);
  expect(screen.getByLabelText("跟助手说")).toHaveValue(`${people[0]!.textContent} `);
  expect(screen.queryByRole("menu", { name: "提到谁" })).toBeNull();
  // 分镜 → AI 助手: the scope is the selected shot.
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  expect(screen.getByText(/^正在看：第 \d+ 场第 \d+ 个镜头$/)).toBeInTheDocument();
});

it("lays safe-area guides over the 剪辑 preview when asked (5-3-11)", async () => {
  installDesktop();
  const film = sampleFilm();
  film.aspectRatio = "9:16";
  vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
  window.localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace projectId={PROJECT_ID} />);
  await screen.findByRole("button", { name: /后台生成/ });
  fireEvent.click(stageTab("剪辑"));
  const toggle = screen.getByRole("button", { name: "安全框" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(document.querySelector(".safe-guide")).toBeNull();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  // A portrait work marks where the platforms put their buttons and captions.
  expect(document.querySelector(".screen .safe-guide")).toHaveTextContent(
    "平台的按钮和标题会挡住这里",
  );
  expect(document.querySelector(".safe-side")).not.toBeNull();
  // Only on 预览: 声音 and 字幕 have their own panels.
  fireEvent.click(screen.getByRole("button", { name: "字幕" }));
  expect(screen.queryByRole("button", { name: "安全框" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "预览" }));
  fireEvent.click(screen.getByRole("button", { name: "安全框" }));
  expect(document.querySelector(".safe-guide")).toBeNull();
});

it("marks the title-safe box on a landscape preview (5-3-11)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("剪辑"));
  fireEvent.click(screen.getByRole("button", { name: "安全框" }));
  expect(document.querySelector(".safe-guide")).toHaveTextContent("字幕和标题放在这个框里");
  expect(document.querySelectorAll(".safe-box")).toHaveLength(2);
});

it("says who or which place the cast page's assistant is looking at (5-3-15)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("角色与场景"));
  const scope = () => document.querySelector(".chat-scope")?.textContent;
  const film = sampleFilm();
  expect(scope()).toBe(`正在看：${film.characters[0]!.name}`);
  fireEvent.click(screen.getByText(film.characters[1]!.name));
  expect(scope()).toBe(`正在看：${film.characters[1]!.name}`);
  fireEvent.click(screen.getByRole("button", { name: "提到人物、场景或镜头" }));
  const offered = within(screen.getByRole("menu", { name: "提到谁" }))
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
  expect(offered).toEqual(expect.arrayContaining([`@${film.characters[0]!.name}`]));
  if (film.locations[0]) expect(offered).toContain(`@${film.locations[0].name}`);
});

it("puts a search box over a cast of more than ten people (5-3-14)", async () => {
  installDesktop();
  const film = sampleFilm();
  const [model] = film.characters;
  const names = [
    "林晚",
    "沈砚",
    "林国栋",
    "周叔",
    "阿杰",
    "小雨",
    "老陈",
    "王医生",
    "护士长",
    "刀疤",
    "司机",
    "店员",
  ];
  film.characters = names.map((name, index) => ({ ...model!, id: `person-${index}`, name }));
  vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
  window.localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace projectId={PROJECT_ID} />);
  await screen.findByRole("button", { name: /后台生成/ });
  fireEvent.click(stageTab("角色与场景"));
  const listed = () =>
    [...document.querySelectorAll(".scene .t")].map((item) => item.firstChild?.textContent);
  expect(listed()).toHaveLength(12);
  const search = screen.getByRole("searchbox", { name: "找人物" });
  expect(search).toHaveAttribute("placeholder", "找人物（共 12 个）");
  fireEvent.change(search, { target: { value: "林" } });
  expect(listed()).toEqual(["林晚", "林国栋"]);
  // Picking one from the narrowed list opens that person.
  fireEvent.click(screen.getByText("林国栋"));
  expect(document.querySelector(".scene.on .t")?.firstChild?.textContent).toBe("林国栋");
  fireEvent.change(search, { target: { value: "张三" } });
  expect(listed()).toHaveLength(0);
  expect(screen.getByText("没有名字里带「张三」的人物。")).toBeInTheDocument();
});

it("keeps a short cast list without a search box (5-3-14)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("角色与场景"));
  expect(screen.queryByRole("searchbox", { name: "找人物" })).toBeNull();
});

it("shows the first frame on 单个镜头 before there is a video (5-3-13)", async () => {
  installDesktop();
  const film = sampleFilm();
  // The sample's first scene has no shots; give it one with a first frame and no video.
  const [first] = film.shots;
  first!.sceneId = film.scenes[0]!.id;
  first!.poster = `/tmp/${first!.id}-still.png`;
  vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
  window.localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace projectId={PROJECT_ID} />);
  await screen.findByRole("button", { name: /后台生成/ });
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  const frame = document.querySelector<HTMLElement>(".bigprev .frame")!;
  expect(frame).not.toHaveClass("rain");
  expect(frame.style.backgroundImage).toContain("-still.png");
  expect(frame).toHaveTextContent("还没有视频，这是开头画面");
  expect(screen.getByText(/还没有版本。在右边点/)).toBeInTheDocument();
});

it("renames the work by double-clicking its name in the top bar (5-3-04)", async () => {
  installDesktop();
  await openSample();
  const name = () => screen.getByRole("button", { name: "作品" });
  expect(name()).toHaveAttribute("title", expect.stringContaining("双击作品名可以改名"));
  fireEvent.doubleClick(name());
  const field = screen.getByLabelText("改作品名") as HTMLInputElement;
  expect(field).toHaveFocus();
  expect(screen.queryByRole("menu", { name: "作品菜单" })).toBeNull();
  // Esc lets it go.
  fireEvent.change(field, { target: { value: "不要这个名字" } });
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.queryByLabelText("改作品名")).toBeNull();
  expect(name()).not.toHaveTextContent("不要这个名字");
  // Enter keeps it, once.
  fireEvent.doubleClick(name());
  const again = screen.getByLabelText("改作品名");
  fireEvent.change(again, { target: { value: "雨夜书店" } });
  fireEvent.keyDown(again, { key: "Enter" });
  expect(screen.queryByLabelText("改作品名")).toBeNull();
  expect(name()).toHaveTextContent("雨夜书店");
  expect(screen.getByText("已改作品名。")).toBeInTheDocument();
  await waitFor(() => expect(window.aijian!.renameFilmSeries).toHaveBeenCalledTimes(1));
});

it("says on a folded property group how many of its fields are filled in (5-3-07)", async () => {
  installDesktop();
  window.localStorage.removeItem("aivora.board.groups");
  await openSample();
  fireEvent.click(stageTab("分镜"));
  const summary = (name: string) =>
    [...document.querySelectorAll<HTMLElement>(".pgroup > summary")].find(
      (item) => item.textContent === name,
    )!;
  // The title text stays the group's name; the number is an attribute CSS draws.
  expect(summary("画面").getAttribute("data-count")).toBeNull();
  const ambience = screen.getByLabelText("这一镜的环境音") as HTMLTextAreaElement;
  const before = Number(summary("声音").getAttribute("data-count")?.replace("· ", "") ?? 0);
  fireEvent.change(ambience, { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("配乐情绪"), { target: { value: "" } });
  const empty = Number(summary("声音").getAttribute("data-count")?.replace("· ", "") ?? 0);
  expect(empty).toBeLessThanOrEqual(before);
  fireEvent.change(ambience, { target: { value: "雨声" } });
  fireEvent.change(screen.getByLabelText("配乐情绪"), { target: { value: "安静" } });
  expect(summary("声音")).toHaveAttribute("data-count", `· ${empty + 2}`);
  expect(summary("声音")).toHaveAttribute("title", `里面有 ${empty + 2} 项填了内容`);
  // Open, the fields show for themselves and the number goes.
  openGroup("声音");
  await waitFor(() => expect(summary("声音").getAttribute("data-count")).toBeNull());
});

it("keeps only the logo, 作品 and the avatar on the start page (5-3-01)", async () => {
  installDesktop();
  render(<ProWorkspace projectId={PROJECT_ID} />);
  expect(screen.getByRole("button", { name: "打开示例" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "作品" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "账号" })).toBeInTheDocument();
  for (const gone of ["撤销", "重做", "导出成片"]) {
    expect(screen.queryByRole("button", { name: gone })).toBeNull();
  }
  expect(screen.queryByRole("navigation", { name: "创作阶段" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
  expect(await screen.findByRole("navigation", { name: "创作阶段" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "撤销" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导出成片" })).toBeInTheDocument();
});

it("picks several cards with Shift or Ctrl and does one thing to all of them (5-3-06)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  const cards = () => [...document.querySelectorAll<HTMLElement>(".grid .card")];
  const chosen = () =>
    cards().flatMap((card, index) => (card.classList.contains("sel") ? [index] : []));
  const count = cards().length;
  fireEvent.click(cards()[1]!);
  fireEvent.click(cards()[3]!, { shiftKey: true });
  expect(chosen()).toEqual([1, 2, 3]);
  expect(screen.getByText(/选了 3 个镜头/)).toBeInTheDocument();
  expect(screen.getByText("镜头 2、3、4")).toBeInTheDocument();
  // Ctrl takes one away, and adds one.
  fireEvent.click(cards()[2]!, { ctrlKey: true });
  fireEvent.click(cards()[5]!, { metaKey: true });
  expect(chosen()).toEqual([1, 3, 5]);
  fireEvent.click(screen.getByRole("button", { name: "都改成 10 秒" }));
  expect(screen.getByText("已把 3 个镜头都改成 10 秒。")).toBeInTheDocument();
  for (const index of [1, 3, 5]) {
    expect(cards()[index]!.querySelector(".dur")).toHaveTextContent("10s");
  }
  // One confirm table for the picked shots.
  fireEvent.click(screen.getByRole("button", { name: /^(重新)?生成这 3 个$/ }));
  expect(await screen.findByTestId("batch-estimate")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "先不生成" }));
  // Esc lets go of all but the shot on show.
  fireEvent.keyDown(window, { key: "Escape" });
  expect(chosen()).toEqual([1]);
  expect(screen.queryByText(/选了 \d+ 个镜头/)).toBeNull();
  fireEvent.click(cards()[0]!, { ctrlKey: true });
  expect(chosen()).toEqual([0, 1]);
  // Same-scene deletion is one operation and Ctrl+Z restores the selected cards.
  fireEvent.click(screen.getByRole("button", { name: "删除这 2 个" }));
  expect(cards()).toHaveLength(count - 2);
  expect(screen.getByText("已删除 2 个镜头，可按 Ctrl+Z 撤销。")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  expect(cards()).toHaveLength(count);
  expect(document.querySelector(".status-note")?.textContent).toMatch(/已撤销：删掉 2 个镜头/);
  // A plain click is one card again.
  fireEvent.click(cards()[0]!, { ctrlKey: true });
  fireEvent.click(cards()[3]!, { ctrlKey: true });
  fireEvent.click(cards()[2]!);
  expect(chosen()).toEqual([2]);
});

it("drags a card to another place in its scene and marks where it lands (5-3-05)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  const cards = () => [...document.querySelectorAll<HTMLElement>(".grid .card")];
  // Shots are numbered by place, so the size on each card tells them apart.
  const sizes = () => cards().map((card) => card.querySelector(".ct span")?.textContent);
  const before = sizes();
  expect(new Set(before.slice(0, 3)).size).toBe(3);
  const carried: Record<string, string> = {};
  const transfer = {
    types: ["application/x-aivora-shot"],
    effectAllowed: "",
    dropEffect: "",
    setData: (type: string, value: string) => {
      carried[type] = value;
    },
    getData: (type: string) => carried[type] ?? "",
  };
  expect(cards()[0]).toHaveAttribute("draggable", "true");
  fireEvent.dragStart(cards()[0]!, { dataTransfer: transfer });
  expect(cards()[0]).toHaveClass("moving");
  fireEvent.dragOver(cards()[2]!, { dataTransfer: transfer });
  expect(cards()[2]).toHaveClass("move-after");
  fireEvent.drop(cards()[2]!, { dataTransfer: transfer });
  expect(sizes().slice(0, 3)).toEqual([before[1], before[2], before[0]]);
  expect(cards()[2]).toHaveClass("sel");
  expect(document.querySelector(".moving, .move-after, .move-before")).toBeNull();
  expect(screen.getByText("已把镜头 1 挪到镜头 3 后面。")).toBeInTheDocument();
  // Dragged back to the front, marked before the card it lands on: as it was.
  fireEvent.dragStart(cards()[2]!, { dataTransfer: transfer });
  fireEvent.dragOver(cards()[0]!, { dataTransfer: transfer });
  expect(cards()[0]).toHaveClass("move-before");
  fireEvent.drop(cards()[0]!, { dataTransfer: transfer });
  expect(sizes()).toEqual(before);
  // A card from another scene stays where it was.
  carried["application/x-aivora-shot"] = JSON.stringify({ scope: "other:01", id: "x" });
  fireEvent.drop(cards()[1]!, { dataTransfer: transfer });
  expect(sizes()).toEqual(before);
});

it("right-clicks a card, a scene or a clip for the same things as 「更多」 (5-3-02)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  const cards = () => [...document.querySelectorAll<HTMLElement>(".grid .card")];
  // Shots are numbered by place, so the size on each card tells them apart.
  const sizes = () => cards().map((card) => card.querySelector(".ct span")?.textContent);
  const before = sizes();
  expect(before[1]).not.toBe(before[2]);
  fireEvent.contextMenu(cards()[1]!, { clientX: 300, clientY: 200 });
  expect(cards()[1]).toHaveClass("sel");
  const menu = screen.getByRole("menu", { name: /^镜头 \d+ 的操作$/ });
  expect(
    within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["前移", "后移", "出 4 张候选", "删除这一镜"]);
  // The same list as 「更多」. A press anywhere else closes the right-click menu.
  fireEvent.pointerDown(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.queryByRole("menu", { name: /的操作$/ })).toBeNull();
  expect(
    within(screen.getByRole("menu", { name: "这一镜的更多操作" }))
      .getAllByRole("button")
      .map((item) => item.textContent),
  ).toEqual(["前移", "后移", "出 4 张候选", "删除这一镜"]);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.contextMenu(cards()[1]!);
  fireEvent.click(screen.getByRole("menuitem", { name: "后移" }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(sizes().slice(0, 3)).toEqual([before[0], before[2], before[1]]);
  // A scene: its own two buttons.
  const scene = document.querySelectorAll<HTMLElement>(".scenes .scene")[1]!;
  fireEvent.contextMenu(scene);
  expect(scene).toHaveClass("on");
  const sceneMenu = screen.getByRole("menu", { name: /的操作$/ });
  expect(
    within(sceneMenu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["加镜头", "生成这一场"]);
  const shotsInScene = cards().length;
  fireEvent.click(within(sceneMenu).getByRole("menuitem", { name: "加镜头" }));
  expect(cards()).toHaveLength(shotsInScene + 1);
  // A clip on 剪辑: what the bar over the picked clip offers.
  fireEvent.click(stageTab("剪辑"));
  const clips = () => document.querySelectorAll<HTMLElement>(".clip.v");
  const count = clips().length;
  fireEvent.contextMenu(clips()[2]!);
  expect(document.querySelector(".selbar")).not.toBeNull();
  const clipMenu = screen.getByRole("menu", { name: /^镜头 \d+ 的操作$/ });
  expect(
    within(clipMenu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["重新生成", "换配音", "剪掉"]);
  fireEvent.click(within(clipMenu).getByRole("menuitem", { name: "剪掉" }));
  expect(clips()).toHaveLength(count - 1);
  expect(screen.getByText(/已剪掉这一段/)).toBeInTheDocument();
});

it("opens fullscreen only for the active edit preview, leaving fields and sound alone (5-3-12)", async () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");
  const request = vi.fn(async () => undefined);
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: request,
  });
  try {
    installDesktop();
    await openSample();
    fireEvent.click(stageTab("剪辑"));
    const player = document.querySelector(".preview-player");
    expect(player).toContainElement(screen.getByRole("button", { name: "播放" }));
    fireEvent.keyDown(window, { key: "f" });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    const field = screen.getByLabelText("改这一镜的描述");
    field.focus();
    fireEvent.keyDown(field, { key: "f" });
    expect(request).toHaveBeenCalledTimes(1);
    field.blur();
    fireEvent.click(screen.getByRole("button", { name: "声音" }));
    expect(document.querySelector(".preview-player")).toBeNull();
    fireEvent.keyDown(window, { key: "f" });
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    fireEvent.doubleClick(document.querySelector(".screen")!);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    fireEvent.click(stageTab("分镜"));
    fireEvent.keyDown(window, { key: "f" });
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, "requestFullscreen", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
  }
});

it("plays with J / K / L and moves by cut with ↑ / ↓ on 剪辑 (5-3-09)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("剪辑"));
  const clock = () => document.querySelector(".ctrl .tc b")?.textContent;
  const shotLabel = () => document.querySelector(".pane .field label")?.textContent ?? "";
  expect(shotLabel()).toMatch(/^镜头 1 ·/);
  // ↓ goes to the next shot's start, ↑ back.
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(shotLabel()).toMatch(/^镜头 2 ·/);
  expect(clock()).not.toBe("00:00.0");
  fireEvent.keyDown(window, { key: "ArrowUp" });
  expect(shotLabel()).toMatch(/^镜头 1 ·/);
  expect(clock()).toBe("00:00.0");
  fireEvent.keyDown(window, { key: "ArrowUp" });
  expect(shotLabel()).toMatch(/^镜头 1 ·/);
  // L plays, again goes faster, up to 4×; K stops and the speed goes back to 1×.
  fireEvent.keyDown(window, { key: "l" });
  expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
  expect(document.querySelector(".ctrl .speed")).toBeNull();
  fireEvent.keyDown(window, { key: "l" });
  expect(document.querySelector(".ctrl .speed")).toHaveTextContent("快放 2×");
  fireEvent.keyDown(window, { key: "L" });
  fireEvent.keyDown(window, { key: "l" });
  expect(document.querySelector(".ctrl .speed")).toHaveTextContent("快放 4×");
  fireEvent.keyDown(window, { key: "k" });
  expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
  expect(document.querySelector(".ctrl .speed")).toBeNull();
  fireEvent.keyDown(window, { key: "l" });
  expect(document.querySelector(".ctrl .speed")).toBeNull();
  // J stops the forward play and plays backwards; again goes faster.
  fireEvent.keyDown(window, { key: "ArrowDown" });
  fireEvent.keyDown(window, { key: "j" });
  expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
  expect(document.querySelector(".ctrl .speed")).toHaveTextContent("倒放 1×");
  fireEvent.keyDown(window, { key: "j" });
  expect(document.querySelector(".ctrl .speed")).toHaveTextContent("倒放 2×");
  fireEvent.keyDown(window, { key: "k" });
  expect(document.querySelector(".ctrl .speed")).toBeNull();
  // Ctrl+J stays the assistant's key; typing keeps the letters.
  fireEvent.keyDown(window, { key: "j", ctrlKey: true });
  expect(document.querySelector(".ctrl .speed")).toBeNull();
  expect(screen.getByLabelText("跟助手说")).toBeInTheDocument();
  const field = screen.getByLabelText("跟助手说");
  field.focus();
  fireEvent.keyDown(field, { key: "l" });
  expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
  field.blur();
  fireEvent.click(screen.getByRole("button", { name: "账号" }));
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  const keys = within(screen.getByRole("region", { name: "快捷键" }));
  for (const key of ["J / K / L", "← / →", "↑ / ↓", "Delete", "Ctrl+滚轮"]) {
    expect(keys.getByText(key)).toBeInTheDocument();
  }
});

it("takes out the picked clip with Delete or Backspace once and undoes it (5-3-10)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("剪辑"));
  const count = () => document.querySelectorAll(".clip.v").length;
  const start = count();
  // Nothing picked: the key does nothing.
  fireEvent.keyDown(window, { key: "Delete" });
  expect(count()).toBe(start);
  expect(document.querySelector(".cut-ask")).toBeNull();
  fireEvent.click(document.querySelector(".clip.v") as HTMLElement);
  // Typing in a field keeps the key for the field.
  const field = screen.getByLabelText("改这一镜的描述");
  field.focus();
  fireEvent.keyDown(field, { key: "Backspace" });
  expect(document.querySelector(".cut-ask")).toBeNull();
  field.blur();
  // Delete cuts once; undo restores it before testing Backspace.
  fireEvent.keyDown(window, { key: "Delete" });
  expect(count()).toBe(start - 1);
  expect(screen.getByText(/已剪掉这一段/)).toBeInTheDocument();
  expect(document.querySelector(".cut-ask")).toBeNull();
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  expect(count()).toBe(start);
  expect(document.querySelector(".status-note")?.textContent).toMatch(/已撤销：剪掉镜头 1/);
  fireEvent.click(document.querySelector(".clip.v") as HTMLElement);
  fireEvent.keyDown(window, { key: "Backspace" });
  expect(count()).toBe(start - 1);
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  expect(count()).toBe(start);
  expect(screen.getByRole("button", { name: "删除" })).toHaveAttribute(
    "aria-keyshortcuts",
    "Delete",
  );
});

it("zooms the 剪辑 timeline in and out, and back to the whole cut (5-3-08)", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("剪辑"));
  const width = () => (document.querySelector(".clip.v") as HTMLElement).style.width;
  const start = parseFloat(width());
  fireEvent.click(screen.getByRole("button", { name: "放大时间线" }));
  expect(parseFloat(width())).toBeGreaterThan(start * 1.8);
  fireEvent.click(screen.getByRole("button", { name: "缩小时间线" }));
  fireEvent.click(screen.getByRole("button", { name: "缩小时间线" }));
  expect(parseFloat(width())).toBeLessThan(start);
  expect(screen.getByRole("button", { name: "看全片" })).toBeInTheDocument();
});

it("gives the four sound tracks a name, mute, solo and volume, and says when a track is empty", async () => {
  installDesktop();
  await openSample();
  // 4B-U02: what the director wrote for a shot's 环境音 shows on its track until there is a file.
  fireEvent.click(stageTab("分镜"));
  fireEvent.change(screen.getByLabelText("这一镜的环境音"), { target: { value: "雨打在铁皮上" } });
  fireEvent.click(stageTab("剪辑"));
  const heads = [...document.querySelectorAll(".theads .th")].map((item) =>
    item.textContent?.replace(/静音|单听|\d+/g, "").trim(),
  );
  expect(heads).toEqual(["字幕", "视频", "对白", "环境音", "音效", "配乐"]);
  const planned = document.querySelector(".clip.plan.amb") as HTMLElement;
  expect(planned).toHaveTextContent("雨打在铁皮上");
  expect(planned).toHaveAttribute("title", expect.stringContaining("还没有声音文件"));
  for (const lane of ["对白", "环境音", "音效", "配乐"]) {
    expect(screen.getByRole("button", { name: `静音${lane}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `单听${lane}` })).toBeInTheDocument();
    expect(screen.getByLabelText(`${lane}音量`)).toHaveAttribute(
      "title",
      expect.stringContaining("整轨音量，保留各片段原有音量"),
    );
  }
  expect(screen.getAllByText("这一轨还没有内容")).toHaveLength(3);
  const ruler = [...document.querySelectorAll(".ruler span")].map((item) => item.textContent);
  expect(ruler.slice(0, 3)).toEqual(["00:00.0", "00:05.0", "00:10.0"]);
  expect(screen.getByRole("img", { name: "说明" })).toHaveAttribute(
    "title",
    expect.stringContaining("按有声对白片段保守避让配乐"),
  );
  expect(screen.getByRole("img", { name: "说明" })).toHaveAttribute(
    "title",
    expect.stringContaining("导出自动调整音量默认关闭"),
  );
  expect(screen.getByLabelText("导入音乐")).toBeInTheDocument();
});

it("sums the export in one line, lists missing shots by scene, and offers the file only after", async () => {
  const { exportFilmCut } = installDesktop();
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  const dialog = screen.getByRole("dialog", { name: "导出成片" });
  expect(within(dialog).getByTestId("export-summary").textContent).toBe(
    "共 6 场 · 6 个镜头 · 约 14 秒 · 还有 6 个镜头没做好",
  );
  expect(within(dialog).getByText("第 2 场 巷战·初交手")).toBeInTheDocument();
  expect(within(dialog).getByText("第 1、2、3、4、5、6 个镜头")).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "打开文件夹" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "播放" })).toBeNull();
  expect(dialog.querySelectorAll(".btn.primary")).toHaveLength(1);
  expect(within(dialog).queryByLabelText("导出文件夹")).toBeNull();
  expect(within(dialog).getByText(/审核后选择保存位置/)).toBeInTheDocument();
  expect(exportFilmCut).not.toHaveBeenCalled();
});

it("opens the task center from 后台生成 with nothing to do yet, and goes to the storyboard", () => {
  render(<ProWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
  expect(screen.getByRole("button", { name: "后台生成：没有在做的" })).toHaveClass("idle");
  fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
  expect(screen.getByText("现在没有任务")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "去分镜" }));
  expect(screen.queryByRole("dialog", { name: "后台生成" })).toBeNull();
  expect(stageTab("分镜").className.split(/\s+/)).toContain("on");
});

it("names each shot's job in the task center and counts the ones still going", async () => {
  let releaseVideo: (value: unknown) => void = () => undefined;
  const videoPending = new Promise((resolve) => {
    releaseVideo = resolve;
  });
  const createStoryFilm = vi.fn(() => videoPending);
  installDesktop(createStoryFilm);
  onTestFinished(() => {
    releaseVideo({
      data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" },
    });
  });
  await openAdoptedSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() => expect(createStoryFilm).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /后台生成/ })).toHaveTextContent(/正在做 \d+ 个/),
  );
  fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
  const center = screen.getByRole("dialog", { name: "后台生成" });
  expect(within(center).getAllByText(/第 2 场第 1 个镜头/).length).toBeGreaterThan(0);
  expect(within(center).queryByText("生成视频")).toBeNull();
});

it("discards a late art draft after leaving its assistant scope", async () => {
  const { completeText } = installDesktop();
  const saved = sampleFilm();
  saved.backendProjectId = PROJECT_ID;
  vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(saved);
  window.localStorage.setItem("aivora.film.activeId", saved.id);
  render(<ProWorkspace projectId={PROJECT_ID} />);
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
  fireEvent.click(stageTab("角色与场景"));
  let resolve!: (reply: { kind: "OK"; text: string }) => void;
  completeText.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  pickHelper("美术");
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.click(stageTab("剧本"));
  await act(async () => {
    resolve({ kind: "OK", text: JSON.stringify({ prompt_block_zh: "迟到的美术画风不应写入" }) });
  });
  expect(screen.queryByText(/迟到的美术画风不应写入/)).not.toBeInTheDocument();
  fireEvent.click(stageTab("角色与场景"));
  expect(screen.queryByText(/迟到的美术画风不应写入/)).not.toBeInTheDocument();
  const writes = vi.mocked(window.aijian!.writeFilmProject!).mock.calls;
  expect(
    writes.some(([value]) => (value as FilmProject).styleZh === "迟到的美术画风不应写入"),
  ).toBe(false);
});

it("keeps a hand-edited shot when a late prompter request returns", async () => {
  const { completeText } = installDesktop();
  const saved = sampleFilm();
  saved.backendProjectId = PROJECT_ID;
  vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(saved);
  window.localStorage.setItem("aivora.film.activeId", saved.id);
  render(<ProWorkspace projectId={PROJECT_ID} />);
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
  fireEvent.click(screen.getByRole("button", { name: /巷战·初交手/ }));
  openBoardTools();
  let resolve!: (reply: { kind: "OK"; text: string }) => void;
  completeText.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "写英文画面说明" }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.change(screen.getByLabelText("分镜画面"), {
    target: { value: "用户手改镜头必须保留" },
  });
  await act(async () => {
    resolve({
      kind: "OK",
      text: '{"keyframe":{"prompt_zh":"迟到的提示词不应写入","prompt_en":"late prompt"}}',
    });
  });
  expect(screen.getByLabelText("分镜画面")).toHaveValue("用户手改镜头必须保留");
  expect(screen.queryByText(/迟到的提示词不应写入/)).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.some(([value]) =>
          (value as FilmProject).shots.some((shot) => shot.picture === "用户手改镜头必须保留"),
        ),
    ).toBe(true),
  );
  expect(
    vi
      .mocked(window.aijian!.writeFilmProject!)
      .mock.calls.some(([value]) =>
        (value as FilmProject).shots.some((shot) =>
          shot.promptZh?.includes("迟到的提示词不应写入"),
        ),
      ),
  ).toBe(false);
});

it("discards a late writer proposal after changing assistant scope", async () => {
  const { completeText } = installDesktop();
  const saved = sampleFilm();
  saved.backendProjectId = PROJECT_ID;
  vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(saved);
  window.localStorage.setItem("aivora.film.activeId", saved.id);
  render(<ProWorkspace projectId={PROJECT_ID} />);
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
  let resolve!: (reply: { kind: "OK"; text: string }) => void;
  completeText.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  pickHelper("编剧");
  fireEvent.click(screen.getByRole("button", { name: "让编剧分场" }));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.click(stageTab("角色与场景"));
  await act(async () => {
    resolve({
      kind: "OK",
      text: JSON.stringify({ scenes: [{ title: "迟到编剧场次", text: saved.scenes[0]!.text }] }),
    });
  });
  fireEvent.click(stageTab("剧本"));
  expect(screen.queryByRole("button", { name: "放进剧本" })).not.toBeInTheDocument();
  expect(screen.queryByText("迟到编剧场次")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "让导演拆镜头" })).not.toBeDisabled();
});

it.each([false, true])(
  "keeps the confirmed action plan and scene end state scoped when save fails=%s",
  async (saveFails) => {
    window.localStorage.clear();
    const { completeText } = installDesktop();
    const film = sampleFilm();
    film.backendProjectId = PROJECT_ID;
    const target = film.shots[0]!;
    target.userFields = [];
    target.picture = "两人交手，铁棍撞向墙面。";
    target.action = "铁棍挥向墙面。";
    target.lines = [];
    target.line = "";
    target.speaker = "";
    const person = film.characters[0]!.name;
    completeText.mockResolvedValue({
      kind: "OK",
      text: JSON.stringify({
        shots: [
          {
            shot_id: target.id,
            nodes: [
              {
                node_id: "n1",
                at_seconds: 0,
                duration_seconds: 1,
                actor: person,
                move: "挥铁棍",
                target: "墙面",
                contact: true,
                force: 2,
              },
            ],
          },
        ],
        props_after: [{ name: person, left: null, right: "铁棍" }],
      }),
    });
    vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
    window.localStorage.setItem("aivora.film.activeId", film.id);
    render(<ProWorkspace projectId={PROJECT_ID} />);
    await screen.findAllByText(film.title);
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(film.scenes.find((scene) => scene.id === target.sceneId)!.title),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    pickHelper("动作指导");
    fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
    await screen.findByText(/动作设计 · 镜头/);
    const saved = () =>
      vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as FilmProject | undefined;
    expect(saved()?.shots.find((shot) => shot.id === target.id)?.actionPlan).toBeUndefined();
    if (saveFails)
      vi.mocked(window.aijian!.writeFilmProject!).mockRejectedValue(new Error("disk failed"));
    fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
    await waitFor(() => {
      const last = saved();
      expect(last?.shots.find((shot) => shot.id === target.id)?.actionPlan?.nodes[0]?.move).toBe(
        "挥铁棍",
      );
      expect(
        last?.scenes.find((scene) => scene.id === target.sceneId)?.actionState?.propsAfter[0]
          ?.right,
      ).toBe("铁棍");
      expect(
        last?.shots.filter((shot) => shot.id !== target.id).every((shot) => !shot.actionPlan),
      ).toBe(true);
    });
    if (saveFails) {
      await screen.findByText(NOTICE_COPY.SAVE_FAILED!);
      expect(screen.getByTitle(/修改已经应用，但还没保存上/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "属性" }));
      expect(screen.getByLabelText("动作要点")).toHaveValue(target.action);
      expect(window.aijian!.createStoryFilm).not.toHaveBeenCalled();
    }
  },
);

it.each([false, true])(
  "confirms only the selected typed performance draft and respects stored locks (locked=%s)",
  async (locked) => {
    window.localStorage.clear();
    const { completeText } = installDesktop();
    const film = sampleFilm();
    film.backendProjectId = PROJECT_ID;
    const target = film.shots[0]!;
    target.performance = "原有表演";
    target.action = "用户动作不变";
    target.delivery = "用户语气不变";
    target.userFields = ["action", "delivery", ...(locked ? ["performance"] : [])];
    film.unassignedBeats = [{ sceneId: target.sceneId, text: "待核对动作" }];
    const person = film.characters[0]!.name;
    completeText.mockResolvedValue({
      kind: "OK",
      text: JSON.stringify([
        {
          shot_id: target.id,
          who: person,
          face: ["眉头收紧"],
          face_at: [0.7],
          gaze: "看向门口",
          hold_s: 1.5,
          voice: { tone: "低声" },
        },
      ]),
    });
    vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
    window.localStorage.setItem("aivora.film.activeId", film.id);
    render(<ProWorkspace projectId={PROJECT_ID} />);
    await screen.findAllByText(film.title);
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(film.scenes.find((scene) => scene.id === target.sceneId)!.title),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    pickHelper("表演指导");
    fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: "请生成表演草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    const confirm = await screen.findByRole("button", { name: "确认修改" });
    const fields = screen.getByRole("list", { name: "字段改动" });
    expect(fields).toHaveTextContent("原有表演");
    expect(fields).toHaveTextContent("表演计划");
    expect(fields).not.toHaveTextContent("配音语气");
    const saved = () =>
      vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as FilmProject | undefined;
    expect(saved()?.shots.find((shot) => shot.id === target.id)?.performancePlan).toBeUndefined();
    expect(
      saved()?.scenes.find((scene) => scene.id === target.sceneId)?.performanceState,
    ).toBeUndefined();
    fireEvent.click(confirm);
    if (locked) {
      await screen.findAllByText("这一镜是你改过的，没有盖掉。");
      expect(saved()?.shots.find((shot) => shot.id === target.id)?.performancePlan).toBeUndefined();
      fireEvent.click(screen.getByRole("button", { name: "属性" }));
      expect(screen.getByLabelText("表演")).toHaveValue("原有表演");
    } else {
      await waitFor(() => {
        const snapshot = saved();
        const stored = snapshot?.shots.find((shot) => shot.id === target.id);
        expect(stored?.performancePlan?.people[0]).toMatchObject({
          name: person,
          face: ["眉头收紧"],
          faceAt: [0.7],
          holdSeconds: 1.5,
        });
        expect(
          snapshot?.scenes.find((scene) => scene.id === target.sceneId)?.performanceState,
        ).toEqual({ unassigned: [] });
        expect(stored?.delivery).toBe("用户语气不变");
        expect(stored?.action).toBe("用户动作不变");
        expect(snapshot?.unassignedBeats).toEqual(film.unassignedBeats);
        expect(
          snapshot?.shots
            .filter((shot) => shot.id !== target.id)
            .every((shot) => !shot.performancePlan),
        ).toBe(true);
        expect(
          snapshot?.scenes
            .filter((scene) => scene.id !== target.sceneId)
            .every((scene) => !scene.performanceState),
        ).toBe(true);
      });
    }
  },
);

it("B11 rejects a prompter reply after selecting another shot", async () => {
  const { completeText } = installDesktop();
  await openSample();
  openBoardTools();
  let resolveReply!: (reply: { kind: "OK"; text: string }) => void;
  completeText.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolveReply = done;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "写英文画面说明" }));
  await waitFor(() => expect(resolveReply).toBeDefined());
  const cards = document.querySelectorAll(".pb.grid button.card");
  expect(cards.length).toBeGreaterThan(1);
  fireEvent.click(cards[1]!);
  await act(async () =>
    resolveReply({
      kind: "OK",
      text: JSON.stringify({
        keyframe: { prompt_zh: "不能写到其他镜头", prompt_en: "stale selected shot" },
      }),
    }),
  );
  expect(
    vi
      .mocked(window.aijian!.writeFilmProject!)
      .mock.calls.some(([film]) =>
        (film as FilmProject).shots.some((shot) => shot.promptEn === "stale selected shot"),
      ),
  ).toBe(false);
});

it("B11 does not claim a prompter suggestion is saved after disk failure", async () => {
  const { completeText } = installDesktop();
  await openSample();
  openBoardTools();
  await act(async () => {
    await new Promise((done) => setTimeout(done, 550));
  });
  vi.mocked(window.aijian!.writeFilmProject!).mockRejectedValue(new Error("disk unavailable"));
  completeText.mockResolvedValueOnce({
    kind: "OK",
    text: JSON.stringify({ keyframe: { prompt_zh: "雨夜", prompt_en: "unsaved prompt" } }),
  });
  fireEvent.click(screen.getByRole("button", { name: "写英文画面说明" }));
  const confirm = await screen.findByRole("button", { name: "确认修改" });
  expect(screen.queryByText(/画面说明已经放进去，还没保存上/)).not.toBeInTheDocument();
  fireEvent.click(confirm);
  expect(await screen.findAllByText(/画面说明已经放进去，还没保存上/)).not.toHaveLength(0);
  expect(screen.queryByText(/画面说明已修改/)).not.toBeInTheDocument();
});

it("B11 keeps prompter undo on its page and restores only the applied prompt fields", async () => {
  const { completeText } = installDesktop();
  await openSample();
  openBoardTools();
  completeText.mockResolvedValueOnce({
    kind: "OK",
    text: JSON.stringify({ keyframe: { prompt_zh: "新提示", prompt_en: "page scoped prompt" } }),
  });
  fireEvent.click(screen.getByRole("button", { name: "写英文画面说明" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认修改" }));
  expect(await screen.findAllByText(/画面说明已修改/)).not.toHaveLength(0);
  fireEvent.click(stageTab("角色与场景"));
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  openBoardTools();
  expect(screen.getByRole("list", { name: "字段改动" })).toHaveTextContent("page scoped prompt");
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => {
    const latest = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as
      FilmProject | undefined;
    expect(latest?.shots.some((shot) => shot.promptEn === "page scoped prompt")).toBe(false);
  });
  await waitFor(() =>
    expect(screen.getByText("还没有英文画面说明。可以让「画面说明」助手写。")).toBeInTheDocument(),
  );
});

it("B11 applies and undoes a fixed art proposal without losing a subsequently generated frame", async () => {
  const cards = await import("../next/SuggestionCard");
  const originalCard = cards.SuggestionCard;
  let pending: Parameters<typeof originalCard>[0] | undefined;
  const spy = vi.spyOn(cards, "SuggestionCard").mockImplementation((props) => {
    if (props.fieldRows?.some((row) => row.label === "全项目 · 画风说明")) pending = props;
    return originalCard(props);
  });
  onTestFinished(() => spy.mockRestore());
  const { completeText } = installDesktop();
  const reply = {
    kind: "OK",
    text: JSON.stringify({
      prompt_block_zh: "B11美术新画风",
      identities: [],
      locations: [{ name: "B11新场景", prompt: "窗边书架", ambience: "雨声" }],
      props: [],
    }),
  } as const;
  completeText.mockResolvedValueOnce(reply);
  Object.assign(window.aijian!, {
    generateFilmStill: vi.fn(async () => ({ path: "/tmp/b11-later-frame.png", reason: "" })),
  });
  await openSample();
  pickHelper("美术");
  fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
  await screen.findByRole("button", { name: "确认修改" });
  const old = pending!;
  fireEvent.click(stageTab("分镜"));
  act(() => old.onApply());
  expect(
    vi
      .mocked(window.aijian!.writeFilmProject!)
      .mock.calls.some(([value]) => (value as FilmProject).styleZh === "B11美术新画风"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
  expect(await screen.findByText(/画面出好了/)).toBeInTheDocument();
  fireEvent.click(stageTab("剧本"));
  pickHelper("美术");
  act(() => old.onApply());
  expect(
    vi
      .mocked(window.aijian!.writeFilmProject!)
      .mock.calls.some(([value]) => (value as FilmProject).styleZh === "B11美术新画风"),
  ).toBe(false);
  completeText.mockResolvedValueOnce(reply);
  fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
  await screen.findByRole("button", { name: "确认修改" });
  fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
  await screen.findByText("全项目美术字段已修改。");
  const writes = () =>
    vi.mocked(window.aijian!.writeFilmProject!).mock.calls.map(([film]) => film as FilmProject);
  const applied = writes()
    .filter((film) => film.styleZh === "B11美术新画风")
    .at(-1);
  expect(
    applied?.shots.some(
      (shot) => shot.poster === "aivora-media://local/?path=%2Ftmp%2Fb11-later-frame.png",
    ),
  ).toBe(true);
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(writes().at(-1)?.styleZh).not.toBe("B11美术新画风"));
  expect(
    writes()
      .at(-1)
      ?.shots.some(
        (shot) => shot.poster === "aivora-media://local/?path=%2Ftmp%2Fb11-later-frame.png",
      ),
  ).toBe(true);
});

it("keeps a same-project scene edit and source when an imported book finishes late", async () => {
  window.localStorage.clear();
  installDesktop();
  await openSample();
  let finish!: (bytes: ArrayBuffer) => void;
  const file = new NodeFile([""], "late-book.txt");
  Object.defineProperty(file, "arrayBuffer", {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  });
  fireEvent.change(screen.getByLabelText("导入小说"), { target: { files: [file] } });
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.change(screen.getByLabelText("这一场"), {
    target: { value: "读取期间用户手改正文。" },
  });
  await act(async () => {
    finish(new TextEncoder().encode("第一场 迟到小说\n迟到原文不应该写入。").buffer);
  });
  expect(screen.getByLabelText("这一场")).toHaveValue("读取期间用户手改正文。");
  expect(screen.queryByRole("button", { name: "放进剧本" })).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      vi
        .mocked(window.aijian!.writeFilmProject!)
        .mock.calls.some(([value]) =>
          (value as FilmProject).scenes.some((scene) => scene.text === "读取期间用户手改正文。"),
        ),
    ).toBe(true),
  );
  expect(
    vi
      .mocked(window.aijian!.writeFilmProject!)
      .mock.calls.some(([value]) => (value as FilmProject).sourceText?.includes("迟到原文")),
  ).toBe(false);
});

it.each(["success", "failure"] as const)(
  "keeps the newest import proposal and ignores an older import %s",
  async (outcome) => {
    window.localStorage.clear();
    installDesktop();
    await openSample();
    let reject!: (error: Error) => void;
    let finish!: (bytes: ArrayBuffer) => void;
    const old = new NodeFile([""], "old-book.txt");
    Object.defineProperty(old, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve, fail) => {
          reject = fail;
          finish = resolve;
        }),
    });
    fireEvent.change(screen.getByLabelText("导入小说"), { target: { files: [old] } });
    await waitFor(() => expect(reject).toBeDefined());
    const source = "第一场 新小说\n这份原文必须完整保存。";
    fireEvent.change(screen.getByLabelText("导入小说"), {
      target: { files: [new NodeFile([source], "new-book.txt")] },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "放进剧本" })).toBeEnabled());
    await act(async () => {
      if (outcome === "failure") reject(new Error("older read failed"));
      else finish(new TextEncoder().encode("第一场 旧小说\n旧原文不能覆盖新导入。").buffer);
    });
    expect(screen.queryByText("没有读到文件，请重试。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放进剧本" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "放进剧本" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(window.aijian!.writeFilmProject!)
          .mock.calls.some(
            ([value]) =>
              (value as FilmProject).sourceText === source &&
              (value as FilmProject).scenes.some((scene) =>
                scene.text.includes("这份原文必须完整保存。"),
              ),
          ),
      ).toBe(true),
    );
  },
);

it("B11 confirms and undoes single-shot action while preserving a frame generated after the draft", async () => {
  installDesktop();
  Object.assign(window.aijian!, {
    generateFilmStill: vi.fn(async () => ({ path: "/tmp/b11-action-frame.png", reason: "" })),
  });
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  pickHelper("动作指导");
  fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
  await screen.findByText(/动作设计 · 镜头/);
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
  expect(await screen.findByText(/画面出好了/)).toBeInTheDocument();
  const latest = () =>
    vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as FilmProject | undefined;
  await waitFor(() =>
    expect(latest()?.shots.some((shot) => shot.poster.includes("b11-action-frame"))).toBe(true),
  );
  const previous = structuredClone(latest()!);
  const target = previous.shots.find((shot) => shot.poster.includes("b11-action-frame"))!;
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.click(screen.getByRole("button", { name: "放进分镜" }));
  await waitFor(() =>
    expect(latest()?.shots.find((shot) => shot.id === target.id)?.source).toBe("agent:action"),
  );
  expect(latest()?.shots.find((shot) => shot.id === target.id)?.poster).toBe(target.poster);
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() =>
    expect(latest()?.shots.find((shot) => shot.id === target.id)?.action).toBe(target.action),
  );
  expect(latest()?.shots.find((shot) => shot.id === target.id)?.poster).toBe(target.poster);
});

it("B11 confirms performance while retaining a user-locked delivery", async () => {
  const { completeText } = installDesktop();
  const film = sampleFilm();
  film.backendProjectId = PROJECT_ID;
  const target = film.shots[0]!;
  target.delivery = "用户指定轻声";
  target.userFields = ["delivery"];
  vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(film);
  window.localStorage.setItem("aivora.film.activeId", film.id);
  completeText.mockResolvedValue({
    kind: "OK",
    text: JSON.stringify([
      {
        shot_id: target.id,
        who: target.characters[0],
        emotion: "冷静",
        face: ["眼神一沉"],
        eyes: "看向前方",
        voice: { tone: "严厉", pace: "快", pauses: "短停顿", emotion: "紧张" },
      },
    ]),
  });
  render(<ProWorkspace projectId={PROJECT_ID} />);
  await screen.findAllByText(film.title);
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(film.scenes.find((scene) => scene.id === target.sceneId)!.title),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  pickHelper("表演指导");
  fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: "写这一镜的表演" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  const confirm = await screen.findByRole("button", { name: "确认修改" });
  const fields = screen.getByRole("list", { name: "字段改动" });
  expect(fields).toHaveTextContent("表演计划");
  expect(fields).not.toHaveTextContent("配音语气");
  expect(
    vi
      .mocked(window.aijian!.writeFilmProject!)
      .mock.calls.every(
        ([value]) =>
          (value as FilmProject).shots.find((shot) => shot.id === target.id)?.performance ===
          target.performance,
      ),
  ).toBe(true);
  fireEvent.click(confirm);
  await waitFor(() => {
    const last = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as
      FilmProject | undefined;
    const saved = last?.shots.find((shot) => shot.id === target.id);
    expect(saved?.performance).toContain("眼神一沉");
    expect(saved?.delivery).toBe("用户指定轻声");
    expect(saved?.userFields).toContain("delivery");
  });
});

it.each(["undo", "page"] as const)(
  "B11 does not announce a delayed art save after %s",
  async (action) => {
    const { completeText } = installDesktop();
    await openSample();
    completeText.mockResolvedValueOnce({
      kind: "OK",
      text: JSON.stringify({
        prompt_block_zh: "延迟保存画风",
        identities: [],
        locations: [],
        props: [],
      }),
    });
    let finish!: () => void;
    vi.mocked(window.aijian!.writeFilmProject!).mockImplementation(async (value) => {
      if ((value as FilmProject).styleZh === "延迟保存画风") {
        return new Promise((resolve) => {
          finish = () => resolve(value);
        });
      }
      return value;
    });
    pickHelper("美术");
    fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
    await screen.findByRole("button", { name: "确认修改" });
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    await waitFor(() => expect(finish).toBeDefined());
    if (action === "undo") fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    else fireEvent.click(stageTab("分镜"));
    await act(async () => finish());
    expect(screen.queryByText("全项目美术字段已修改。")).not.toBeInTheDocument();
  },
);

it.each(["undo", "edit", "page"] as const)(
  "B11 ignores a delayed prompter save completion after %s",
  async (action) => {
    const { completeText } = installDesktop();
    await openSample();
    openBoardTools();
    completeText.mockResolvedValueOnce({
      kind: "OK",
      text: JSON.stringify({
        keyframe: { prompt_zh: "延迟提示", prompt_en: "delayed saved prompt" },
      }),
    });
    let finish!: () => void;
    let delayed = false;
    vi.mocked(window.aijian!.writeFilmProject!).mockImplementation(async (value) => {
      if (
        !delayed &&
        (value as FilmProject).shots.some((row) => row.promptEn === "delayed saved prompt")
      ) {
        delayed = true;
        return new Promise((resolve) => {
          finish = () => resolve(value);
        });
      }
      return value;
    });
    fireEvent.click(screen.getByRole("button", { name: "写英文画面说明" }));
    const confirm = await screen.findByRole("button", { name: "确认修改" });
    expect(finish).toBeUndefined();
    fireEvent.click(confirm);
    await waitFor(() => expect(finish).toBeDefined());
    if (action === "undo") fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    else if (action === "edit")
      fireEvent.change(screen.getByLabelText("景别"), { target: { value: "特写" } });
    else fireEvent.click(stageTab("角色与场景"));
    await act(async () => finish());
    expect(screen.queryByText(/画面说明已修改/)).not.toBeInTheDocument();
    if (action === "undo")
      await waitFor(() => {
        const saved = vi
          .mocked(window.aijian!.writeFilmProject!)
          .mock.calls.at(-1)?.[0] as FilmProject;
        expect(saved.shots.some((row) => row.promptEn === "delayed saved prompt")).toBe(false);
      });
    if (action === "edit") expect(screen.getByLabelText("景别")).toHaveValue("特写");
  },
);

it.each(["writer", "art"] as const)(
  "B11 wires actual global %s request to the selected scene without narrowing project scope",
  async (role) => {
    const { completeText } = installDesktop();
    await openSample();
    const fixture = sampleFilm();
    const selected = fixture.scenes[1]!;
    const button = screen
      .getAllByRole("button", { name: new RegExp(selected.title) })
      .find((item) => item.className.includes("scene"));
    expect(button).toBeDefined();
    fireEvent.click(button!);
    completeText.mockClear();
    if (role === "writer") {
      pickHelper("编剧");
      fireEvent.click(screen.getByRole("button", { name: "让编剧分场" }));
    } else {
      pickHelper("美术");
      fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
    }
    await waitFor(() => expect(completeText).toHaveBeenCalled());
    const request = completeText.mock.calls[0]![0].text;
    expect(request).toContain('"taskScope":"project"');
    expect(request).toContain(`"id":"${selected.id}"`);
    expect(request).toContain("任务和输出、写入范围仍为全项目");
    if (role === "writer") {
      for (const scene of fixture.scenes) {
        for (const paragraph of scene.text.split("\n").filter(Boolean))
          expect(request.split(paragraph)).toHaveLength(2);
      }
      const appended = request.split("编辑器选中内容（仅补充参考）：")[1]!.split("\n")[1]!;
      expect(JSON.parse(appended).scene).not.toHaveProperty("text");
    } else {
      for (const person of fixture.characters) expect(request).toContain(person.name);
      expect(request).toContain(JSON.stringify(selected.text));
    }
  },
);

it("3JR-B08 first still click saves a scene reference before generating the shot", async () => {
  installDesktop();
  const bridge = window.aijian!;
  const generate = vi.mocked(bridge.generateFilmStill!);
  generate.mockImplementation(async () => {
    if (generate.mock.calls.length === 1) {
      return { path: "/tmp/scene-reference.png", reason: "" };
    }

    return { path: "/tmp/shot-reference.png", reason: "" };
  });
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
  await screen.findByText(/画面出好了。/);
  expect(generate).toHaveBeenCalledTimes(2);
  const reference = "aivora-media://local/?path=%2Ftmp%2Fscene-reference.png";
  expect(generate.mock.calls[1]![3]).toContain(reference);
  expect(
    vi
      .mocked(bridge.writeFilmProject!)
      .mock.calls.some(([film]) =>
        (film as FilmProject).locations.some((place) => place.referenceImage === reference),
      ),
  ).toBe(true);
  moreAction("重新生成画面");
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
});

it("3JR-B08 failed scene reference stops the first-click shot request", async () => {
  installDesktop();
  const generate = vi.mocked(window.aijian!.generateFilmStill!);
  generate.mockResolvedValue({ path: "", reason: "失败" });
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "生成画面" })).toBeEnabled());
  for (const call of generate.mock.calls) expect(call[1]).toContain("空镜，没有人物");
  expect(screen.queryByRole("button", { name: "重新生成画面" })).not.toBeInTheDocument();
});

it("3JR-B08 terminates this batch's queued videos when scene preparation fails", async () => {
  const video = vi.fn();
  installDesktop(video);
  vi.mocked(window.aijian!.generateFilmStill!).mockResolvedValue({
    path: "/tmp/aivora/still.png",
    reason: "",
  });
  await openAdoptedSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(stageTab("角色与场景"));
  fireEvent.click(screen.getByRole("button", { name: "场景" }));
  fireEvent.change(screen.getByLabelText("里面怎么摆"), { target: { value: "柜台换到左侧" } });
  vi.mocked(window.aijian!.generateFilmStill!).mockResolvedValue({ path: "", reason: "失败" });
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() => {
    const saved = vi.mocked(window.aijian!.writeFilmProject!).mock.calls.at(-1)?.[0] as
      FilmProject | undefined;
    const jobs = saved?.jobs.filter((job) => job.kind === "video") ?? [];
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.status === "failed" && job.interruptedFrom === "queued")).toBe(
      true,
    );
    const takes = saved!.shots.flatMap((shot) => shot.takes);
    expect(takes.length).toBeGreaterThan(0);
    expect(
      takes.every((take) => take.status === "failed" && take.interruptedFrom === "queued"),
    ).toBe(true);
  });
  expect(video).not.toHaveBeenCalled();
});
