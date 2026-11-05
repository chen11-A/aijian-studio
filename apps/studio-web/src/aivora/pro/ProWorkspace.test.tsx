import { File as NodeFile } from "node:buffer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { activeFilmId, readSaved } from "../film/library";
import { BEAT_DRAG_TYPE } from "../next/SceneAlerts";
import { NOTICE_COPY } from "../next/wiring/noticeCopy";
import { ProWorkspace } from "./ProWorkspace";

const PROJECT_ID = `prj_${"a".repeat(32)}`;

describe("professional workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.aijian;
    delete window.aijianGrok;
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
    await waitFor(() => expect(screen.getByRole("button", { name: "放入剧本" })).toBeEnabled());
    fireEvent.click(stageTab("角色与场景"));
    expect(screen.queryByRole("button", { name: "放入剧本" })).not.toBeInTheDocument();
    fireEvent.click(stageTab("剧本"));
    fireEvent.click(await screen.findByRole("button", { name: "放入剧本" }));
    expect(screen.getByLabelText("这一场")).not.toHaveValue("");
    fireEvent.click(stageTab("角色与场景"));
    expect(document.body.textContent).toContain("林晚");
    fireEvent.click(stageTab("剧本"));
    expect(screen.queryByRole("button", { name: "放入剧本" })).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "写入分镜" }));
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
    });
    expect(screen.getByRole("button", { name: "给所有人出定妆照" })).toBeDisabled();
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
    const single = screen.getByRole("button", { name: "补这个人的" });
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
    await waitFor(() => expect(screen.queryByRole("button", { name: "补这个人的" })).toBeNull());
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
    const prepared = prepareVideoQueue(film, [film.shots[0]!], 2, false).film;
    const takes = prepared.shots[0]!.takes;
    const stored = setVideoTaskState(prepared, takes[0]!.id, "running");
    vi.mocked(window.aijian!.readFilmProject!).mockResolvedValue(stored);
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
    fireEvent.click(screen.getByRole("button", { name: "有 1 个动作没对上镜头" }));
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
    fireEvent.click(screen.getByRole("button", { name: "单镜" }));
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
    fireEvent.click(screen.getByRole("button", { name: "让编剧写" }));
    expect(await screen.findByText(/离线编剧/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入剧本" }));
    expect(screen.getByText(/已放入剧本/)).toBeInTheDocument();
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /角色/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "补这个人的" }));
    expect((await screen.findAllByText(/请打开安装好的 AIVORA 再出图/)).length).toBeGreaterThan(0);
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
    expect(screen.getByTestId("export-summary").textContent).toContain("没生成");
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
    fireEvent.click(screen.getByRole("button", { name: "单镜" }));
    expect(screen.getByTestId("generation-estimate").textContent).toContain("将生成");
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /剪辑/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    expect(screen.getByText(/网页里不能写成片/)).toBeInTheDocument();
    expect(screen.queryByText(/D:\\/)).toBeNull();
  });

  it("uses the offline director until the user confirms", async () => {
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/离线拆镜/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("COVERAGE_INCOMPLETE");
    if (document.body.textContent?.includes("还有内容需要补齐"))
      expect(document.body.textContent).not.toContain("为保留全部台词和结尾");
    fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
    expect(screen.getByText(/已写入分镜/)).toBeInTheDocument();
  });

  it("walks the stages, confirms agents, and keeps a hand edit", async () => {
    const { completeText } = installDesktop();
    await openSample();
    expect(screen.queryByRole("button", { name: "写入分镜" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加一场" }));
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "雨停在巷口。" } });
    fireEvent.click(screen.getByRole("button", { name: /雨夜·巷口/ }));
    pickHelper("编剧");
    fireEvent.click(screen.getByRole("button", { name: "让编剧写" }));
    expect(await screen.findByText(/编剧写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入剧本" }));
    expect(screen.getByText(/已放入剧本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "改成短剧" }));
    expect(await screen.findByText(/编剧写好了/)).toBeInTheDocument();
    const novel = new File(["第一章 夜雨\n巷子里只有风。"], "故事.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("导入小说"), { target: { files: [novel] } });
    expect(await screen.findByText(/已读取文本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入剧本" }));
    const refused = new File(["x"], "故事.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("导入小说"), { target: { files: [refused] } });
    expect(await screen.findByText(/只读取 txt/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: "再短一点" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect((await screen.findAllByText(/编剧写好了/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect((await screen.findAllByText(/编剧写好了/)).length).toBeGreaterThan(0);
    pickHelper("动作指导");
    fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
    expect(await screen.findByText(/动作指导写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
    expect(screen.getByText(/已写入这一镜/)).toBeInTheDocument();
    fireEvent.click(stageTab("分镜"));
    fireEvent.change(screen.getByLabelText("动作要点"), { target: { value: "我改过这一下" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
    expect(await screen.findByText(/动作指导写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
    expect(screen.getByText(/你改过的，没有盖掉/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
    expect(screen.getByText(/已写入这一镜|你改过的/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "属性" }));
    moreAction("前移");
    moreAction("后移");
    fireEvent.click(stageTab("角色与场景"));
    fireEvent.click(screen.getByRole("button", { name: /刀疤/ }));
    fireEvent.change(screen.getByLabelText("人物名字"), { target: { value: "老刀" } });
    fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "老刀，光头" } });
    fireEvent.change(screen.getByLabelText("画风"), { target: { value: "古风武侠" } });
    fireEvent.click(screen.getByRole("button", { name: "补这个人的" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
    );
    expect(screen.getByText(/登录 Grok 会员后才能看到声音名单/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "场景" }));
    fireEvent.click(stageTab("剪辑"));
    fireEvent.click(screen.getByRole("button", { name: "上一个" }));
    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    fireEvent.click(screen.getByRole("button", { name: "设出点" }));
    fireEvent.click(screen.getAllByRole("button", { name: "重新生成" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "改描述" }));
    fireEvent.click(screen.getByRole("button", { name: "改描述" }));
    fireEvent.click(screen.getByRole("button", { name: "换配音" }));
    fireEvent.click(screen.getByRole("button", { name: "用新版替换" }));
    expect(screen.getByText(/还没有可以替换的新版本|已用新版替换/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设入点" }));
    fireEvent.click(screen.getByRole("button", { name: "保留旧版" }));
    expect(screen.getByText(/保留旧版/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "修改这一段" }));
    fireEvent.click(screen.getByRole("button", { name: "换配音字幕" }));
    fireEvent.click(screen.getByRole("button", { name: "生成新版本" }));
    fireEvent.click(screen.getByRole("button", { name: "属性" }));
    fireEvent.click(screen.getByRole("button", { name: "回到分镜重新生成" }));
    fireEvent.click(screen.getByRole("button", { name: "取消选择" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByText(/已剪掉这一段/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.click(screen.getByRole("button", { name: /未登录|需要重新登录|Grok 会员/ }));
    fireEvent.click(screen.getByRole("button", { name: "账号" }));
    expect(screen.queryByRole("button", { name: "设置" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByText("已退出登录。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.change(screen.getByLabelText("作品名"), { target: { value: "巷战" } });
    fireEvent.click(screen.getByRole("button", { name: "保存名字" }));
    expect(screen.getByText("已改作品名。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
    expect(await screen.findByText(/已打开第 2 集/)).toBeInTheDocument();
    expect(screen.getByText(/作品保存在/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
    expect(screen.getByText(/画风在角色与场景/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "i" });
    fireEvent.keyDown(window, { key: "Escape" });
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
    fireEvent.click(screen.getByRole("button", { name: "单镜" }));
    fireEvent.click(screen.getByRole("button", { name: "5 秒" }));
    fireEvent.click(screen.getByRole("button", { name: "较快的一版" }));
    fireEvent.click(screen.getByRole("button", { name: "直接出成片" }));
    fireEvent.change(screen.getByLabelText("画面描述"), { target: { value: "雨停了" } });
    const counts = screen.getAllByRole("button", { name: "2" });
    fireEvent.click(counts[counts.length - 1]!);
    fireEvent.click(screen.getByRole("button", { name: "生成 2 个版本" }));
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("这一版已经生成。", {}, { timeout: 5_000 })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^用第 \d+ 版$/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "返回分镜" }));
    fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(createStoryFilm.mock.calls.length).toBeGreaterThanOrEqual(8));
    fireEvent.click(stageTab("剪辑"));
    await waitFor(() => expect(desktop.assembleFilm).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    desktop.pickFilmFolder.mockResolvedValueOnce("");
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    expect(await screen.findByText(/先选一个保存的文件夹/)).toBeInTheDocument();
    desktop.exportFilmCut.mockRejectedValueOnce(new Error("disk"));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    expect(await screen.findByText(/导出没有完成，可以再试一次/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    expect(await screen.findByText(/已导出到/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "单镜" }));
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    expect((await screen.findAllByText("没有生成成功，可以重试。")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
    fireEvent.click(screen.getByRole("button", { name: /失败的全部重试/ }));
    expect((await screen.findAllByText(/正在生成|排队中/)).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("button", { name: "全部暂停" }));
    expect(screen.getByText(/已经发出的请求不一定能停/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停下这一次" }));
    expect(screen.getByText(/已取消这一次/)).toBeInTheDocument();
    await act(async () => {
      release({
        data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "关上后台生成" }));
    fireEvent.click(screen.getByRole("button", { name: "返回分镜" }));
    fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText(/已暂停。点继续再生成剩下的/)).toBeInTheDocument();
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
    installDesktop();
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
    fireEvent.click(screen.getByRole("button", { name: "单镜" }));
    fireEvent.click(screen.getByRole("button", { name: "较快的一版" }));
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
    expect(
      screen.getByText("草稿用的是较快的模型，不能带定妆照，脸可能会变。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText(/不能先出草稿/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回分镜" }));
    fireEvent.click(stageTab("剪辑"));
    fireEvent.click(screen.getByRole("button", { name: "设入点" }));
    cleanup();
    window.localStorage.clear();
    render(<ProWorkspace />);
    fireEvent.click(screen.getAllByRole("button", { name: "打开示例" })[0]!);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Grok 会员/ })[0]).toHaveTextContent("已连接"),
    );
    fireEvent.click(
      screen
        .getAllByRole("button")
        .filter((item) => item.className.includes("tab") && item.textContent?.includes("分镜"))[0]!,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "单镜" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "生成 1 个版本" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "开始生成" })[0]!);
    expect(await screen.findByText(/网页里不能直接出片/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
    expect(screen.getAllByText(/网页里不能直接出片/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "再试一次" })[0]!);
    expect((await screen.findAllByText(/网页里不能直接出片/)).length).toBeGreaterThan(0);
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
    fireEvent.change(screen.getByLabelText("作品名"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "保存名字" }));
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
    let playbacks = 0;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {
      playbacks += 1;
      if (playbacks === 1) throw new Error("no device");
    });
    const createStoryFilm = vi.fn(async () => ({
      data: {
        status: "SUCCEEDED",
        message: "",
        output_path: "/tmp/aivora/shot.mp4",
        preview_image: "https://example.test/frame.png",
        duration_seconds: "4",
      },
    }));
    installDesktop(createStoryFilm);
    let videos = 0;
    window.aijian = {
      ...window.aijian!,
      generateFilmStill: vi
        .fn()
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
      fireEvent.click(screen.getByRole("button", { name: "高级" }));
      fireEvent.change(screen.getByLabelText("这一镜的画风"), { target: { value: "冷色雨夜" } });
      fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
      expect(await screen.findByText(/画面出好了。/)).toBeInTheDocument();
      expect(screen.getAllByText("画面已出").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "生成视频" })).toHaveClass("primary");
      moreAction("重新生成画面");
      expect(
        await screen.findByText("这张画面未获准生成，请调整画面描述后重试。"),
      ).toBeInTheDocument();
      moreAction("重新生成画面");
      expect(await screen.findByText("画面没出成，可以再试一次。")).toBeInTheDocument();
      moreAction("重新生成画面");
      expect(await screen.findByText(/画面出好了。/)).toBeInTheDocument();
      fireEvent.click(stageTab("角色与场景"));
      fireEvent.click(screen.getByRole("button", { name: "补这个人的" }));
      await waitFor(() =>
        expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
      );
      await waitFor(() =>
        expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
      );
      fireEvent.click(stageTab("分镜"));
      fireEvent.click(screen.getByRole("button", { name: "单镜" }));
      fireEvent.click(screen.getByRole("button", { name: "2 秒" }));
      fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
      fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
      expect(await screen.findByText("这一版已经生成。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /后台生成/ }).textContent).toContain("没有在做的");
      const preview = document.querySelector("video.frame");
      if (preview) {
        fireEvent.timeUpdate(preview);
        fireEvent.ended(preview);
        expect(play).toHaveBeenCalled();
      }
      fireEvent.click(screen.getByRole("button", { name: "返回分镜" }));
      expect(screen.getByRole("button", { name: "4 秒" })).toHaveClass("on");
      fireEvent.click(stageTab("剪辑"));
      expect(screen.getAllByText("未生成").length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
      fireEvent.click(screen.getByRole("button", { name: "浏览" }));
      expect(await screen.findByLabelText("导出文件夹")).toHaveValue("/tmp/aivora/export");
      fireEvent.change(screen.getByLabelText("导出文件夹"), {
        target: { value: "/tmp/aivora/typed" },
      });
      fireEvent.keyDown(screen.getByLabelText("导出文件夹"), { key: "Enter" });
      expect(screen.getByLabelText("导出文件夹")).toHaveValue("/tmp/aivora/typed");
      expect((await screen.findAllByText(/还没生成|已导出/)).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      fireEvent.click(screen.getByRole("button", { name: "设入点" }));
      expect(screen.getByText("左右对比")).toBeInTheDocument();
    } finally {
      play.mockRestore();
    }
  }, 20_000);

  it("says when a story is not billed to a project and when no cast is found", async () => {
    installDesktop();
    render(<ProWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Grok 会员|需要重新登录|未登录/ }),
      ).toHaveTextContent("已连接"),
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
      expect(
        screen.getByRole("button", { name: /Grok 会员|需要重新登录|未登录/ }),
      ).toHaveTextContent("已连接"),
    );
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "风吹过屋顶。" } });
    pickHelper("编剧");
    fireEvent.click(screen.getByRole("button", { name: "让编剧写" }));
    expect(await screen.findByText(/没有按格式返回/)).toBeInTheDocument();
    pickHelper("导演");
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/没有按格式返回/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "写入分镜" })).not.toBeInTheDocument();
    expect(screen.getByText("暂无待写入的建议")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
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
    expect((await screen.findAllByText(/没有写入镜头/)).length).toBeGreaterThan(0);

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
    fireEvent.click(screen.getByRole("button", { name: "补这个人的" }));
    expect(await screen.findByText("先写下外貌，再出定妆照。")).toBeInTheDocument();
    completeText.mockImplementation(inferLook);
    fireEvent.click(screen.getByRole("button", { name: "补这个人的" }));
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
      ...window.aijian!,
      readFilmProject: vi.fn(async () => queued),
    } as unknown as Window["aijian"];
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
    expect(await screen.findByText(/已标成已中断/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /后台生成/ })).toHaveTextContent("没有在做的");
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
      fireEvent.click(screen.getByRole("button", { name: "单镜" }));
      fireEvent.click(screen.getByRole("button", { name: "1" }));
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
  expect(document.querySelectorAll(".shotlist > div").length).toBeLessThanOrEqual(9);
  for (let index = 1; index <= 9; index += 1)
    expect(document.querySelector(".shotlist")?.textContent).toContain(`第${index}镜的巷口`);
  fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
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
  fireEvent.change(screen.getByLabelText("导出文件夹"), { target: { value: "/tmp/kept" } });
  fireEvent.keyDown(screen.getByLabelText("导出文件夹"), { key: "Enter" });
  expect(pickFilmFolder).not.toHaveBeenCalled();
  expect(screen.getByLabelText("导出文件夹")).toHaveValue("/tmp/kept");
}, 20_000);

it("runs the seven agents, confirms a portrait, and times a shot from the line", async () => {
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
    expect(await screen.findByText(/美术写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
    expect(await screen.findByText(/已写入画风、外貌、场景和道具/)).toBeInTheDocument();
    openBoardTools();
    fireEvent.click(screen.getByRole("button", { name: "写英文提示词" }));
    expect(await screen.findByText(/提示词写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审一下这一镜的文字" }));
    expect(await screen.findByText(/没有看画面，版本仍由你选/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "高级" }));
    fireEvent.click(screen.getByRole("button", { name: /镜头 4/ }));
    fireEvent.click(screen.getByRole("button", { name: "按台词定时长" }));
    expect(await screen.findByText(/按配音长度/)).toBeInTheDocument();
    expect(speak).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "高级" }));
    expect(screen.getByText("英文提示词还没写。请提示词工程师写。")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "补这个人的" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
    );
    await waitFor(() =>
      expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
    );
    fireEvent.click(screen.getByRole("button", { name: "声音开" }));
    fireEvent.click(screen.getByRole("button", { name: "试听旁白" }));
    expect(await screen.findByText(/声音关着/)).toBeInTheDocument();
    fireEvent.click(stageTab("剧本"));
    fireEvent.click(screen.getByRole("button", { name: "一键成片" }));
    await waitFor(() =>
      expect(document.querySelector(".status-note")?.textContent).toMatch(
        /分镜好了。看一遍|有的场还有内容没拍到/,
      ),
    );
    expect(stageTab("分镜").className.split(/\s+/)).toContain("on");
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
  fireEvent.click(screen.getByRole("button", { name: "补这个人的" }));
  expect(await screen.findByText("先写下外貌，再出定妆照。")).toBeInTheDocument();
  mode = "infer";
  fireEvent.click(screen.getByRole("button", { name: "补这个人的" }));
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
  fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "按台词定时长" }));
  await waitFor(() =>
    expect(document.querySelector(".statusbar")?.textContent ?? "").toMatch(/拆成两镜/),
  );
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
  pickHelper("美术");
  fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
  expect(await screen.findByText(/美术没有按格式返回/)).toBeInTheDocument();
  openBoardTools();
  fireEvent.click(screen.getByRole("button", { name: "写英文提示词" }));
  expect(await screen.findByText(/提示词没有按格式返回/)).toBeInTheDocument();
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
  expect(await screen.findByText(/美术没有按格式返回/)).toBeInTheDocument();
  openBoardTools();
  fireEvent.click(screen.getByRole("button", { name: "写英文提示词" }));
  expect(await screen.findByText(/提示词没有按格式返回/)).toBeInTheDocument();
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
  expect((await screen.findAllByText(/还不能看画面|没有按格式返回|离线/)).length).toBeGreaterThan(
    0,
  );
  fireEvent.click(screen.getByRole("button", { name: "一键成片" }));
  expect(await screen.findByText(/没有写入离线/)).toBeInTheDocument();
  mode = "play";
  const RealAudio = window.Audio;
  class SilentAudio {
    onloadedmetadata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(async () => {
      throw new Error("blocked");
    });
    constructor() {
      setTimeout(() => this.onloadedmetadata?.(), 0);
    }
  }
  window.Audio = SilentAudio as unknown as typeof Audio;
  const createUrl = URL.createObjectURL;
  URL.createObjectURL = () => "blob:phase2";
  try {
    fireEvent.click(stageTab("角色与场景"));
    const sound = screen.getByRole("button", { name: /声音开|声音关/ });
    if (sound.textContent?.includes("声音关")) fireEvent.click(sound);
    fireEvent.click(screen.getByRole("button", { name: "试听" }));
    expect(await screen.findByText(/没有播出来/)).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  expect((screen.getByLabelText("动作要点") as HTMLTextAreaElement).value).toContain("他抬手");
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
  fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
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
  fireEvent.change(screen.getByLabelText("作品名"), { target: { value: "雨夜巷战测试" } });
  fireEvent.keyDown(screen.getByLabelText("作品名"), { key: "Enter" });
  expect(screen.getByRole("button", { name: "作品" }).textContent).toContain("雨夜巷战测试");
});

it("warns about a scene end with no shot and lets an unplaced action go onto a shot", async () => {
  const film = sampleFilm();
  const scene = film.scenes.find((item) => item.id === "02")!;
  scene.coverage = {
    sceneId: "02",
    ok: false,
    lastLine: "雨太大，我听不清。",
    missingLines: [],
    missingTail: "林骁侧身让过铁棍。",
  };
  film.unassignedBeats = [
    { sceneId: "02", text: "林骁抹掉脸上的雨水" },
    { sceneId: "02", text: "刀疤挥铁棍砸向林骁" },
    { sceneId: "01", text: "别的场的动作" },
  ];
  window.aijian = {
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
  expect(await screen.findByText("这一场结尾还没拍到：「林骁侧身让过铁棍。」")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "有 2 个动作没对上镜头" }));
  // A drag from another scene must never use this scene's same numeric index.
  const firstCard = document.querySelector(".pb.grid .card")!;
  fireEvent.drop(firstCard, {
    dataTransfer: {
      getData: () =>
        JSON.stringify({ scope: `${film.id}:01`, index: 0, text: "林骁抹掉脸上的雨水" }),
    },
  });
  expect(screen.getByRole("button", { name: "有 2 个动作没对上镜头" })).toBeInTheDocument();
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
  expect(await screen.findByText(/镜头 3 只有对白，放不了这个动作/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "有 2 个动作没对上镜头" })).toBeInTheDocument();
  // An ordinary action goes onto the picked shot with the button.
  fireEvent.click(cards()[3]!);
  fireEvent.click(screen.getAllByRole("button", { name: "放到镜头 4" })[0]!);
  expect(await screen.findByText("已放到镜头 4。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "有 1 个动作没对上镜头" })).toBeInTheDocument();
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
  Object.assign(film.shots[1]!, {
    continuity: [{ kind: "prop", text: "刀上一镜在左手，这一镜到了右手。" }],
  });
  window.aijian = {
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

it("follows the work's aspect and offers 比例 only where the desktop can crop (4A-U07)", async () => {
  installDesktop();
  await openSample();
  const root = document.querySelector(".pro-root")!;
  expect(["9:16", "16:9"]).toContain(root.getAttribute("data-aspect"));
  fireEvent.click(screen.getByRole("button", { name: /导出成片/ }));
  expect(screen.queryByLabelText("比例")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  Object.assign(window.aijian!, { cancelFilmExport: vi.fn(async () => ({ ok: true })) });
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
  expect(document.querySelector(".portrait-progress")).toHaveTextContent("都齐了");
  expect(screen.getByRole("button", { name: "给所有人出定妆照" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "补这个人的" })).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
  expect(screen.queryByRole("button", { name: "已写入" })).not.toBeInTheDocument();
  openBoardTools();
  fireEvent.click(screen.getByRole("button", { name: "审一下这一镜的文字" }));
  expect(await screen.findByText(/审片意见 · 镜头/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "写入分镜" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "知道了" }));
  expect(screen.queryByRole("button", { name: "已记下" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "审一下这一镜的文字" }));
  fireEvent.click(await screen.findByRole("button", { name: "按意见重做这一镜" }));
  expect(document.querySelector(".statusbar")?.textContent ?? "").toMatch(/只重做这一段/);
  const redo = screen.queryByRole("button", { name: "只重做这一段" });
  if (redo) {
    fireEvent.click(redo);
    expect(document.querySelector(".statusbar")?.textContent ?? "").toMatch(/确认表/);
  }
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
function openBoardTools() {
  fireEvent.click(stageTab("分镜"));
  const props = screen.queryByRole("button", { name: "属性" });
  if (props) fireEvent.click(props);
  if (!screen.queryByRole("button", { name: "写英文提示词" })) {
    fireEvent.click(screen.getByRole("button", { name: "高级" }));
  }
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
  fireEvent.click(screen.getByRole("button", { name: "只重做这一段" }));
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
  const flushed = vi.fn();
  let flush: (() => void) | undefined;
  Object.assign(window.aijian ?? {}, {
    defaultFilmFolder: vi.fn(async () => "/tmp/videos/AIVORA"),
    flushed,
    onFlush: (handler: () => void) => {
      flush = handler;
    },
  });
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  expect(await screen.findByDisplayValue("/tmp/videos/AIVORA")).toBeInTheDocument();
  flush?.();
  await waitFor(() => expect(flushed).toHaveBeenCalled());
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
  expect(await screen.findByText(/Grok Build/)).toBeInTheDocument();
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
  expect(await screen.findByRole("button", { name: /会员不能用这个功能/ })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Grok 会员/ })).toHaveTextContent("已连接"),
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
    createProject,
    listFilmSeries: vi.fn(async () => []),
    writeFilmProject: vi.fn(async (film: unknown) => film),
    readFilmProject: vi.fn(async () => null),
  } as unknown as Window["aijian"];
  render(<ProWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Grok 会员/ })).toHaveTextContent("已连接"),
  );
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "雨夜巷口。" } });
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  await waitFor(() => expect(createProject).toHaveBeenCalled());
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
  expect(await screen.findByText(/Grok Build/)).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "单镜" }));
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  expect(await screen.findByText("这一版已经生成。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
  expect((await screen.findAllByText(/可以只导出已生成的/)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "只导出已生成的" }));
  await waitFor(() => expect(desktop.exportFilmCut).toHaveBeenCalled());
  const assembled = desktop.assembleFilm.mock.calls.at(-1) as unknown as
    [string, string[], string] | undefined;
  expect(assembled?.[1]?.[0]).toBe("/tmp/aivora/shot.mp4");
  expect(assembled?.[2]).toContain("bed.mp3");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  desktop.assembleFilm.mockImplementation(async () => ({
    path: "/tmp/aivora/rough.mp4",
    reason: "视频已接上。配乐没有混进去。",
  }));
  fireEvent.click(screen.getByRole("button", { name: "返回分镜" }));
  fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  fireEvent.click(stageTab("剪辑"));
  expect(await screen.findByText(/配乐没有混进去/)).toBeInTheDocument();
}, 20_000);

it("names the shots that are not ready instead of exporting an empty cut", async () => {
  const desktop = installDesktop();
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
  expect((await screen.findAllByText(/还没生成：镜头/)).length).toBeGreaterThan(0);
  expect(desktop.exportFilmCut).not.toHaveBeenCalled();
});

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
  const revealFilmPath = vi.fn(async () => undefined);
  const openFilmPath = vi.fn(async () => undefined);
  window.aijian = {
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
    readFilmProject: vi.fn(async (id: string) => (id === episode.id ? episode : null)),
    writeFilmProject: vi.fn(async (film: unknown) => film),
    deleteFilmProject: vi.fn(async () => undefined),
    renameFilmSeries: vi.fn(async () => undefined),
    readFilmMedia: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    assembleFilm,
    pickFilmFolder,
    exportFilmCut,
    revealFilmPath,
    openFilmPath,
  } as unknown as Window["aijian"];
  return {
    models,
    completeText,
    assembleFilm,
    pickFilmFolder,
    exportFilmCut,
    revealFilmPath,
    openFilmPath,
  };
}

async function openSample() {
  render(<ProWorkspace projectId={PROJECT_ID} />);
  fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Grok 会员|需要重新登录|未登录/ })).toHaveTextContent(
      "已连接",
    ),
  );
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
}

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
  await waitFor(() =>
    expect(document.querySelector(".status-note")?.textContent).toMatch(
      /分镜好了。看一遍|有的场还有内容没拍到/,
    ),
  );
  // 4A-U01: the checkpoint bar says what will be made; 「继续生成」 left the status bar.
  expect(screen.getByRole("region", { name: "一键成片进度" })).toHaveTextContent(/约需 \d+ 次生成/);
  expect(document.querySelector(".statusbar")?.textContent).not.toMatch(/继续/);
  fireEvent.click(screen.getByRole("button", { name: "继续生成" }));
  expect(await screen.findByRole("button", { name: "开始生成" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "一键成片进度" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "先不生成" }));
  fireEvent.click(stageTab("剧本"));
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  fireEvent.click(await screen.findByRole("button", { name: "换个问法再问一次" }));
  expect((await screen.findAllByText(/导演拆好了/)).length).toBeGreaterThan(0);
  pickHelper("编剧");
  expect(screen.queryByRole("button", { name: "写入分镜" })).toBeNull();
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
  expect(screen.getByText(/Grok Build/)).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "单镜" }));
  const counts = screen.getAllByRole("button", { name: "2" });
  fireEvent.click(counts[counts.length - 1]!);
  fireEvent.click(screen.getByRole("button", { name: "生成 2 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() => expect(createStoryFilm).toHaveBeenCalled());
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
    expect(screen.getByRole("button", { name: /Grok 会员/ })).toHaveTextContent("已连接"),
  );
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "雨夜巷口。" } });
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  expect(await screen.findByText(/导演拆好了/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "写入分镜" }));
  expect(await screen.findByText(/已写入分镜/)).toBeInTheDocument();
});

it("shows a saved still again and uses lane mute, solo, and volume", async () => {
  const createStoryFilm = vi.fn(async () => ({
    data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" },
  }));
  const desktop = installDesktop(createStoryFilm);
  Object.assign(window.aijian ?? {}, {
    generateFilmStill: vi.fn(async () => ({ path: "/tmp/aivora/still.png", reason: "" })),
    importMusic: vi.fn(async () => ({ path: "/tmp/aivora/films/bed.mp3" })),
    filePath: () => "/tmp/song.mp3",
  });
  Object.assign(window.aijianGrok ?? {}, {
    speak: vi.fn(async () => ({
      kind: "OK",
      audioBase64: "QQ==",
      mime: "audio/mpeg",
      seconds: 1,
      timestamps: false,
    })),
  });
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
  expect(await screen.findByText(/画面出好了。/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /候选画面/ }));
  fireEvent.click(screen.getByRole("button", { name: "单镜" }));
  fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  expect(await screen.findByText("这一版已经生成。")).toBeInTheDocument();
  fireEvent.click(stageTab("剪辑"));
  fireEvent.click(screen.getByRole("button", { name: /镜头 4/ }));
  fireEvent.click(screen.getByRole("button", { name: "换配音" }));
  expect(await screen.findByText("这一句已重配，画面没有重新生成。")).toBeInTheDocument();
  expect(document.querySelector("[data-voice='1']")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("导入音乐"), {
    target: { files: [new File(["song"], "bed.mp3", { type: "audio/mpeg" })] },
  });
  expect(await screen.findByText(/已导入音乐/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "静音配音" }));
  expect(screen.getByText("这一轨已静音。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "静音配音" }));
  fireEvent.click(screen.getByRole("button", { name: "单听配音" }));
  fireEvent.click(screen.getByRole("button", { name: "静音音乐" }));
  fireEvent.click(screen.getByRole("button", { name: "静音音乐" }));
  fireEvent.click(screen.getByRole("button", { name: "单听音乐" }));
  expect(screen.getByText("只听音乐。音量没有改。")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("音乐音量"), { target: { value: "50" } });
  expect(screen.getByText("音量已记下，导出时用这个音量。")).toBeInTheDocument();
  expect(desktop.assembleFilm).toBeDefined();
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
  fireEvent.click(screen.getByRole("button", { name: "单镜" }));
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
  expect(await screen.findByText(/模型没有返回/)).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Grok 会员|未登录/ })).toHaveTextContent("已连接"),
  );
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "林雨在雨里停下。" } });
  fireEvent.click(screen.getByRole("button", { name: "一键成片" }));
  await waitFor(() =>
    expect(document.querySelector(".status-note")?.textContent).toMatch(
      /分镜好了。看一遍|有的场还有内容没拍到/,
    ),
  );
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
    expect(screen.getByRole("button", { name: /Grok 会员|未登录/ })).toHaveTextContent("已连接"),
  );
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: novel } });
  pickHelper("编剧");
  fireEvent.click(screen.getByRole("button", { name: "让编剧写" }));
  fireEvent.click(await screen.findByRole("button", { name: "放入剧本" }));
  await screen.findByText(/已记下人物/);
  expect(screen.getAllByRole("button", { name: /雨夜旧书店/ }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /码头仓库/ }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /医院走廊/ }).length).toBeGreaterThan(0);
  expect((screen.getByLabelText("这一场") as HTMLTextAreaElement).value).toContain("今晚打烊了");
  expect(document.body.textContent).not.toContain("沈砚许诺留下书店");
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  await screen.findByText(/导演拆好了/);
  fireEvent.click(await screen.findByRole("button", { name: "写入分镜" }));
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
  fireEvent.click(screen.getAllByRole("button", { name: "补这个人的" })[0]!);
  await waitFor(() =>
    expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
  );
  fireEvent.click(stageTab("分镜"));
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
  expect(await screen.findByRole("button", { name: "写入分镜" })).toBeInTheDocument();
  expect(attempts).toBe(2);
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "剧本已修改。" } });
  expect(screen.queryByRole("button", { name: "写入分镜" })).not.toBeInTheDocument();
  fireEvent.click(stageTab("角色与场景"));
  expect(screen.queryByText(/建议拆成/)).not.toBeInTheDocument();
  expect(screen.queryByText("当前镜头")).not.toBeInTheDocument();
});

it("releases writer busy state after a rejected request and permits retry", async () => {
  const { completeText } = installDesktop();
  completeText.mockRejectedValue(new Error("network failure"));
  await openSample();
  pickHelper("编剧");
  fireEvent.click(screen.getByRole("button", { name: "让编剧写" }));
  expect(await screen.findByText(/编剧请求失败/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "让导演拆镜头" })).not.toBeDisabled();
  expect(screen.queryByRole("button", { name: "放入剧本" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Grok 会员|未登录/ })).toHaveTextContent("已连接"),
  );
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "门口下雨。" } });
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  fireEvent.click(await screen.findByRole("button", { name: "写入分镜" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "写入分镜" }));
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  expect((screen.getByLabelText("动作要点") as HTMLTextAreaElement).value).toContain("他抬手");
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
  fireEvent.click(screen.getByRole("button", { name: "写英文提示词" }));
  expect(await screen.findByText(/提示词写好了/)).toBeInTheDocument();
  expect(screen.getByText("rainy alley")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  const helpers = screen.getByLabelText("正在和：") as HTMLSelectElement;
  expect([...helpers.options].map((item) => item.value)).not.toContain("prompter");
  expect(screen.queryByText(/提示词写好了/)).not.toBeInTheDocument();
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

it("keeps a storyboard card to its size, length, picture sentence and first line", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  const card = document.querySelectorAll(".pb.grid .card")[3] as HTMLElement;
  const shot = sampleFilm().shots[3]!;
  expect(within(card).getByText(shot.picture)).toHaveAttribute("title", shot.picture);
  expect(within(card).getByText(shot.line)).toHaveAttribute("title", shot.line);
  expect(card.textContent).toContain(shot.size);
  expect(card.textContent).toContain(`${shot.seconds}s`);
  expect(card.textContent).not.toContain(shot.performance);
  expect(card.querySelector(".src")).toHaveAttribute("title", "原来就有");
  fireEvent.click(card);
  fireEvent.change(screen.getByLabelText("分镜画面"), { target: { value: "林骁抬眼看雨" } });
  expect(document.querySelectorAll(".pb.grid .card")[3]?.querySelector(".src")).toHaveAttribute(
    "title",
    "你改过",
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
  expect(screen.queryByLabelText("这一镜的画风")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "高级" }));
  expect(screen.getByLabelText("这一镜的画风")).toHaveAttribute(
    "placeholder",
    "不写就用整部作品的画风：写实电影感",
  );
});

it("keeps one primary button under a shot that follows its state, the rest under 更多", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("分镜"));
  const footer = () => document.querySelector(".pfoot2") as HTMLElement;
  expect(within(footer()).getAllByRole("button").length).toBeLessThanOrEqual(3);
  expect(footer().querySelectorAll(".btn.primary")).toHaveLength(1);
  expect(within(footer()).getByRole("button", { name: "生成画面" })).toHaveClass("primary");
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
  expect(within(footer()).getByRole("button", { name: "生成视频" })).toHaveClass("primary");
  fireEvent.click(within(footer()).getByRole("button", { name: "更多操作" }));
  expect(screen.getByRole("button", { name: "重新生成画面" })).toBeInTheDocument();
});

it("gives both sound tracks a name, mute, solo and volume, and says when a track is empty", async () => {
  installDesktop();
  await openSample();
  fireEvent.click(stageTab("剪辑"));
  for (const lane of ["配音", "音乐"]) {
    expect(screen.getByRole("button", { name: `静音${lane}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `单听${lane}` })).toBeInTheDocument();
    expect(screen.getByLabelText(`${lane}音量`)).toHaveAttribute(
      "title",
      expect.stringMatching(new RegExp(`^${lane}音量 \\d+$`)),
    );
  }
  expect(screen.getAllByText("这一轨还没有内容")).toHaveLength(2);
  const ruler = [...document.querySelectorAll(".ruler span")].map((item) => item.textContent);
  expect(ruler.slice(0, 3)).toEqual(["00:00.0", "00:05.0", "00:10.0"]);
  expect(screen.getByRole("img", { name: "说明" })).toHaveAttribute(
    "title",
    expect.stringContaining("配乐会在对白出现时让路"),
  );
  expect(screen.getByLabelText("导入音乐")).toBeInTheDocument();
});

it("sums the export in one line, lists missing shots by scene, and offers the file only after", async () => {
  const { exportFilmCut } = installDesktop();
  await openSample();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  const dialog = screen.getByRole("dialog", { name: "导出成片" });
  expect(within(dialog).getByTestId("export-summary").textContent).toBe(
    "共 6 场 · 6 个镜头 · 约 14 秒 · 6 个还没生成",
  );
  expect(within(dialog).getByText("第 2 场 巷战·初交手")).toBeInTheDocument();
  expect(within(dialog).getByText("第 1、2、3、4、5、6 个镜头")).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "打开文件夹" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "播放" })).toBeNull();
  expect(dialog.querySelectorAll(".btn.primary")).toHaveLength(1);
  const long = "/home/box/Videos/AIVORA/晚照书店/第一季/导出的成片/这一集的文件夹放在这里";
  fireEvent.change(within(dialog).getByLabelText("导出文件夹"), { target: { value: long } });
  expect(dialog.querySelector(".pathfield")).toHaveAttribute("title", long);
  expect(dialog.querySelector(".pathshow")?.textContent).toContain("…");
  expect(dialog.querySelector(".pathrow")?.textContent).toContain("浏览");
  expect(exportFilmCut).not.toHaveBeenCalled();
});

it("opens the task center from 后台生成 with nothing to do yet, and goes to the storyboard", () => {
  render(<ProWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
  expect(screen.getByRole("button", { name: /后台生成/ })).toHaveTextContent("没有在做的");
  fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
  expect(screen.getByText("现在没有任务")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "去分镜" }));
  expect(screen.queryByRole("dialog", { name: "后台生成" })).toBeNull();
  expect(stageTab("分镜").className.split(/\s+/)).toContain("on");
});

it("names each shot's job in the task center and counts the ones still going", async () => {
  let release: (value: unknown) => void = () => undefined;
  const createStoryFilm = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  installDesktop(createStoryFilm);
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /后台生成/ })).toHaveTextContent(/正在做 \d+ 个/),
  );
  fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
  const center = screen.getByRole("dialog", { name: "后台生成" });
  expect(within(center).getAllByText(/第 2 场第 1 个镜头/).length).toBeGreaterThan(0);
  expect(within(center).queryByText("生成视频")).toBeNull();
  release({ data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" } });
});
