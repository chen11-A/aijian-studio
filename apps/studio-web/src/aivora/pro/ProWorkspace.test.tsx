import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";

const PROJECT_ID = `prj_${"a".repeat(32)}`;

describe("professional workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.aijian;
    delete window.aijianGrok;
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
    fireEvent.click(screen.getByRole("button", { name: "编剧" }));
    fireEvent.click(screen.getByRole("button", { name: "让编剧写" }));
    expect(await screen.findByText(/离线编剧/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入剧本" }));
    expect(screen.getByText(/已放入剧本/)).toBeInTheDocument();
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /角色/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "生成定妆照" }));
    fireEvent.click(screen.getByRole("button", { name: "确认出图" }));
    expect(screen.getAllByText(/请打开安装好的 AIVORA 再出图/).length).toBeGreaterThan(0);
    expect(screen.getByText(/还没有读到声音名单/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "试听" }));
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /分镜/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getByRole("button", { name: "加镜头" }));
    expect(screen.getByText(/已加一个镜头/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
    expect(screen.getByText(/请打开安装好的 AIVORA 再出图/)).toBeInTheDocument();
    fireEvent.click(
      screen
        .getAllByRole("button", { name: /剪辑/ })
        .find((item) => item.className.includes("tab"))!,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /镜头 5/ })[0]!);
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
    fireEvent.click(screen.getAllByRole("button", { name: "撤销" })[0]!);
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
    fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
    expect(screen.getByText(/已放入分镜/)).toBeInTheDocument();
  });

  it("walks the stages, confirms agents, and keeps a hand edit", async () => {
    const { completeText } = installDesktop();
    await openSample();
    fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
    expect(screen.getByText("还没有可放入的镜头。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加一场" }));
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "雨停在巷口。" } });
    fireEvent.click(screen.getByRole("button", { name: /雨夜·巷口/ }));
    fireEvent.click(screen.getByRole("button", { name: "编剧" }));
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
    fireEvent.click(screen.getByRole("button", { name: "再改改" }));
    expect((await screen.findAllByText(/编剧写好了/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "动作指导" }));
    fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
    expect(await screen.findByText(/动作指导写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
    expect(screen.getByText(/已写入这一镜/)).toBeInTheDocument();
    fireEvent.click(stageTab("分镜"));
    fireEvent.change(screen.getByLabelText("动作要点"), { target: { value: "我改过这一下" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
    expect(await screen.findByText(/动作指导写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
    expect(screen.getByText(/你改过的，没有盖掉/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "属性" }));
    fireEvent.change(screen.getByLabelText("景别"), { target: { value: "特写" } });
    fireEvent.change(screen.getByLabelText("运镜"), { target: { value: "推" } });
    fireEvent.change(screen.getByLabelText("分镜画面"), { target: { value: "雨停了" } });
    fireEvent.change(screen.getByLabelText("表演"), { target: { value: "我改过表演" } });
    fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
    expect(screen.getByText(/请打开安装好的 AIVORA 再出图/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    fireEvent.click(screen.getByRole("button", { name: "表演指导" }));
    fireEvent.click(screen.getByRole("button", { name: "请表演指导看看" }));
    expect(await screen.findByText(/表演指导写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
    expect(screen.getByText(/已写入这一镜|你改过的/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "属性" }));
    fireEvent.click(screen.getByRole("button", { name: "前移" }));
    fireEvent.click(screen.getByRole("button", { name: "后移" }));
    fireEvent.click(stageTab("角色与场景"));
    fireEvent.click(screen.getByRole("button", { name: /刀疤/ }));
    fireEvent.change(screen.getByLabelText("人物名字"), { target: { value: "老刀" } });
    fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "老刀，光头" } });
    fireEvent.change(screen.getByLabelText("画风"), { target: { value: "古风武侠" } });
    fireEvent.click(screen.getByRole("button", { name: "生成定妆照" }));
    fireEvent.click(screen.getByRole("button", { name: "确认出图" }));
    expect(screen.getAllByText(/请打开安装好的 AIVORA 再出图/).length).toBeGreaterThan(0);
    expect(screen.getByText(/还没有读到声音名单/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /需要重新登录|Grok 会员/ }));
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
    fireEvent.click(screen.getByRole("button", { name: "暂停排队" }));
    expect(screen.getByText(/已经发出的请求不一定能停/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续排队" }));
    expect(screen.getByText("继续排队。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试失败的" }));
    expect(screen.getByText("没有失败的生成。")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /用这一版/ }));
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
    expect(await screen.findByText("没有选择文件夹。")).toBeInTheDocument();
    desktop.exportFilmCut.mockRejectedValueOnce(new Error("disk"));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    expect(await screen.findByText("没有导出成功，可以重试。")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "重试失败的" }));
    expect(await screen.findByText("生成中")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /点此取消/ }));
    expect(screen.getByText(/已取消这一次/)).toBeInTheDocument();
    release({
      data: { status: "SUCCEEDED", message: "", output_path: "/tmp/aivora/shot.mp4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "暂停排队" }));
    fireEvent.click(screen.getByRole("button", { name: "返回分镜" }));
    fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText(/已暂停。点继续再生成剩下的/)).toBeInTheDocument();
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
    fireEvent.click(screen.getAllByRole("button", { name: /网页里不能直接出片/ })[0]!);
    expect(screen.getAllByText(/已取消这一次/).length).toBeGreaterThan(0);
  });

  it("records an undo step and the project menu", async () => {
    const { completeText } = installDesktop();
    render(<ProWorkspace projectId={PROJECT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
    expect(screen.getByText("从一句故事开始。")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "导演" }));
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
      fireEvent.click(stageTab("分镜"));
      fireEvent.change(screen.getByLabelText("这一镜的画风"), { target: { value: "冷色雨夜" } });
      fireEvent.change(screen.getByLabelText("画风"), { target: { value: "赛博夜景" } });
      fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
      expect(await screen.findByText("画面已生成。")).toBeInTheDocument();
      expect(screen.getAllByText("画面已出").length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
      expect(await screen.findByText("模型拒绝了这一张。")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
      expect(await screen.findByText("出图没有成功，可以重试。")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "生成画面" }));
      expect(await screen.findByText("画面已保存，这一页还打不开。")).toBeInTheDocument();
      fireEvent.click(stageTab("角色与场景"));
      fireEvent.click(screen.getByRole("button", { name: "生成定妆照" }));
      expect(await screen.findByText(/将按这句话出图/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "确认出图" }));
      expect(await screen.findByText("定妆照已生成。")).toBeInTheDocument();
      fireEvent.click(stageTab("分镜"));
      fireEvent.click(screen.getByRole("button", { name: "单镜" }));
      fireEvent.click(screen.getByRole("button", { name: "2 秒" }));
      fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
      fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
      expect(await screen.findByText("这一版已经生成。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /后台生成/ }).textContent).toContain("没有排队");
      const preview = document.querySelector("video.frame");
      if (preview) {
        fireEvent.timeUpdate(preview);
        fireEvent.ended(preview);
        expect(play).toHaveBeenCalled();
      }
      fireEvent.click(screen.getByRole("button", { name: "返回分镜" }));
      expect(screen.getByText("4 秒")).toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: /Grok 会员|需要重新登录/ })).toHaveTextContent(
        "已连接",
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
      expect(screen.getByRole("button", { name: /Grok 会员|需要重新登录/ })).toHaveTextContent(
        "已连接",
      ),
    );
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "风吹过屋顶。" } });
    fireEvent.click(screen.getByRole("button", { name: "编剧" }));
    fireEvent.click(screen.getByRole("button", { name: "让编剧写" }));
    expect(await screen.findByText(/没有按格式返回/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导演" }));
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    expect(await screen.findByText(/没有按格式返回/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
    expect(await screen.findByText(/还没有可放入的镜头/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
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
    expect(screen.getByRole("button", { name: /正在问模型/ })).toBeDisabled();
    expect(completeText.mock.calls[0]?.[0]).toMatchObject({ model: "grok-4.7" });
    replies[0]?.({
      kind: "ERROR",
      code: "TEXT_FAILED",
      billingAccountKind: "grok_login",
      detail: "文本接口返回 404。已改用普通对话再试过。",
      text: "",
    });
    expect(await screen.findByText(/再用普通对话问一次/)).toBeInTheDocument();
    await waitFor(() => expect(replies).toHaveLength(2));
    replies[1]?.({
      kind: "ERROR",
      code: "TEXT_FAILED",
      billingAccountKind: "grok_login",
      detail: "文本接口返回 404。已改用普通对话再试过。",
      text: "",
    });
    expect(await screen.findByText(/文本接口返回 404/)).toBeInTheDocument();
    expect(screen.getByText(/没有写入镜头/)).toBeInTheDocument();

    completeText.mockImplementation(async ({ text }: { text: string }) => {
      if (text.includes("一句外貌")) {
        return { kind: "OK", text: "年轻女性，二十多岁，黑色长发。", model: "grok-4.7" };
      }
      return { kind: "OK", text: "性别未写明", model: "grok-4.7" };
    });
    fireEvent.click(stageTab("角色与场景"));
    fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "生成定妆照" }));
    expect(
      await screen.findByText(/将按这句话出图：年轻女性，二十多岁，黑色长发/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("外貌")).toHaveValue("年轻女性，二十多岁，黑色长发。");
    completeText.mockResolvedValue({ kind: "OK", text: "性别未写明", model: "grok-4.7" });
    fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "生成定妆照" }));
    expect(await screen.findByText("先写下外貌，再出定妆照。")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /后台生成/ })).toHaveTextContent("没有排队");
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
  expect(document.querySelectorAll(".shotlist > div")).toHaveLength(9);
  expect(screen.getByText("第9镜的巷口")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
  fireEvent.click(stageTab("分镜"));
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
    fireEvent.click(screen.getByRole("button", { name: "新手" }));
    expect(screen.getByText("新手只看这一位助手。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换角色" }));
    fireEvent.change(screen.getByLabelText("从模板开始"), { target: { value: "雨夜巷战打斗" } });
    expect(await screen.findByText(/已放入模板「雨夜巷战打斗」/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "美术" }));
    fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
    expect(await screen.findByText(/美术写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
    expect(await screen.findByText(/已写入画风、外貌、场景和道具/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "写这一镜的提示词" }));
    expect(await screen.findByText(/提示词写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审片" }));
    fireEvent.click(screen.getByRole("button", { name: "请审片看看" }));
    expect(await screen.findByText(/没有看画面，版本仍由你选/)).toBeInTheDocument();
    fireEvent.click(stageTab("分镜"));
    fireEvent.click(screen.getByRole("button", { name: /镜头 4/ }));
    fireEvent.click(screen.getByRole("button", { name: "按台词定时长" }));
    expect(await screen.findByText(/按配音长度/)).toBeInTheDocument();
    expect(speak).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "高级" }));
    expect(screen.getByText("英文提示词还没写。请提示词工程师写。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "出 4 张候选" }));
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
    fireEvent.click(screen.getByRole("button", { name: "生成定妆照" }));
    expect(await screen.findByText(/将按这句话出图/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认出图" }));
    expect(await screen.findByText("定妆照已生成。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "声音开" }));
    fireEvent.click(screen.getByRole("button", { name: "试听旁白" }));
    expect(await screen.findByText(/声音关着/)).toBeInTheDocument();
    fireEvent.click(stageTab("剧本"));
    fireEvent.click(screen.getByRole("button", { name: "一键成片" }));
    expect(await screen.findByText(/停在分镜。点继续才出视频/)).toBeInTheDocument();
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
  fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "生成定妆照" }));
  expect(await screen.findByText(/将按这句话出图：林骁，男性/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "确认出图" }));
  expect(await screen.findByText("先写下外貌，再出定妆照。")).toBeInTheDocument();
  mode = "unknown";
  fireEvent.change(screen.getByLabelText("外貌"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "生成定妆照" }));
  expect(await screen.findByText("先写下外貌，再出定妆照。")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("角色声音"), { target: { value: "leo" } });
  fireEvent.change(screen.getByLabelText("旁白声音"), { target: { value: "leo" } });
  fireEvent.click(stageTab("剧本"));
  mode = "split";
  fireEvent.click(screen.getByRole("button", { name: "加一场" }));
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: spoken } });
  fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
  expect(await screen.findByText(/导演拆好了/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "按台词定时长" }));
  expect(await screen.findByText(/拆成两镜/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
  fireEvent.click(screen.getByRole("button", { name: "美术" }));
  fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
  expect(await screen.findByText(/美术没有按格式返回/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "提示词" }));
  fireEvent.click(screen.getByRole("button", { name: "写这一镜的提示词" }));
  expect(await screen.findByText(/提示词没有按格式返回/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "审片" }));
  fireEvent.click(screen.getByRole("button", { name: "请审片看看" }));
  expect(await screen.findByText(/还不能看画面/)).toBeInTheDocument();
  fireEvent.click(stageTab("剧本"));
  fireEvent.click(screen.getByRole("button", { name: /巷战·初交手/ }));
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: /镜头 2/ }));
  fireEvent.click(screen.getByRole("button", { name: "按台词定时长" }));
  expect(document.querySelector(".statusbar")?.textContent).toMatch(/这一镜没有台词/);
  fireEvent.click(screen.getByRole("button", { name: /镜头 1/ }));
  fireEvent.change(screen.getByLabelText("时长秒数"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "按台词定时长" }));
  expect(await screen.findByText(/没有覆盖/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("声音来源"), { target: { value: "dub" } });
  fireEvent.change(screen.getByLabelText("配乐情绪"), { target: { value: "紧张" } });
  fireEvent.change(screen.getByLabelText("这一镜的环境音"), { target: { value: "雨声" } });
  fireEvent.click(stageTab("剧本"));
  mode = "bad";
  fireEvent.click(screen.getByRole("button", { name: "美术" }));
  fireEvent.click(screen.getByRole("button", { name: "请美术定画风" }));
  expect(await screen.findByText(/美术没有按格式返回/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "提示词" }));
  fireEvent.click(screen.getByRole("button", { name: "写这一镜的提示词" }));
  expect(await screen.findByText(/提示词没有按格式返回/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "审片" }));
  fireEvent.click(screen.getByRole("button", { name: "请审片看看" }));
  expect(await screen.findByText(/还不能看画面/)).toBeInTheDocument();
  const beforeSend = completeText.mock.calls.length;
  for (const roleName of ["动作指导", "表演指导", "美术", "提示词", "审片"]) {
    fireEvent.click(screen.getByRole("button", { name: roleName }));
    fireEvent.click(screen.getByRole("button", { name: "再改改" }));
  }
  await waitFor(() =>
    expect(completeText.mock.calls.length).toBeGreaterThanOrEqual(beforeSend + 7),
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
  fireEvent.click(screen.getByRole("button", { name: "动作指导" }));
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(await screen.findByText("给这一镜设计动作")).toBeInTheDocument();
  expect((await screen.findAllByText(/动作指导写好了/)).length).toBeGreaterThan(0);
  expect(screen.getByText(/稳 · 他抬手/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  expect((screen.getByLabelText("动作要点") as HTMLTextAreaElement).value).toContain(
    "来自动作指导",
  );
  expect((screen.getByLabelText("动作要点") as HTMLTextAreaElement).value).toContain("稳");
  fireEvent.change(screen.getByLabelText("站位"), { target: { value: "林骁在画左" } });
  fireEvent.change(screen.getByLabelText("朝向"), { target: { value: "看向画右" } });
  expect(screen.getByLabelText("站位")).toHaveValue("林骁在画左");
  expect(screen.getByLabelText("朝向")).toHaveValue("看向画右");
  expect(screen.getAllByText("外貌已锁").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: "写这一镜的表演" } });
  fireEvent.click(screen.getByRole("button", { name: "表演指导" }));
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(await screen.findByText("写这一镜的表演")).toBeInTheDocument();
  expect((await screen.findAllByText(/表演指导写好了/)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  expect((screen.getByLabelText("表演") as HTMLTextAreaElement).value).toContain("来自表演指导");
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.change(screen.getByLabelText("作品名"), { target: { value: "雨夜巷战测试" } });
  fireEvent.keyDown(screen.getByLabelText("作品名"), { key: "Enter" });
  expect(screen.getByRole("button", { name: "作品" }).textContent).toContain("雨夜巷战测试");
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
    if (String(text).includes("你是影视动作指导")) {
      return { kind: "OK", text: '{"beats":[{"text":"他抬手","feasibility":"难"}]}' };
    }
    return { kind: "OK", text: "好", model: "grok-4.7" };
  });
  await openSample();
  fireEvent.click(stageTab("分镜"));
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.click(screen.getByRole("button", { name: "动作指导" }));
  fireEvent.click(screen.getByRole("button", { name: "请动作指导看看" }));
  expect(await screen.findByText(/动作设计 · 镜头/)).toBeInTheDocument();
  expect(screen.getAllByText(/高危/).length).toBeGreaterThan(0);
  expect(screen.getByText(/稳可以拍/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "放入分镜" }));
  expect(screen.getByRole("button", { name: "已放入" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "审片" }));
  fireEvent.click(screen.getByRole("button", { name: "请审片看看" }));
  expect(await screen.findByText(/审片意见 · 镜头/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "放入分镜" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "知道了" }));
  expect(screen.getByRole("button", { name: "已记下" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "按意见重做这一镜" }));
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
  fireEvent.click(screen.getByRole("button", { name: "编剧" }));
  fireEvent.change(screen.getByLabelText("跟助手说"), { target: { value: "请把现有剧本分成" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(await screen.findByText("请把现有剧本分成")).toBeInTheDocument();
  expect((await screen.findAllByText(/没有改剧本/)).length).toBeGreaterThan(0);
  expect(screen.queryByText(/还没完/)).not.toBeInTheDocument();
});

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
  await waitFor(() => expect(signIn).toHaveBeenCalled());
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
  film.shots[0]!.selectedTakeId = "take-1";
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
  await waitFor(() => expect(readFilmMedia).toHaveBeenCalled());
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
  fireEvent.click(screen.getByRole("button", { name: "编剧" }));
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
      if (text.includes("你是影视动作指导")) {
        return { kind: "OK", text: '{"beats":[{"text":"他抬手","feasibility":"稳"}]}' };
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
    expect(screen.getByRole("button", { name: /Grok 会员|需要重新登录/ })).toHaveTextContent(
      "已连接",
    ),
  );
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
}
