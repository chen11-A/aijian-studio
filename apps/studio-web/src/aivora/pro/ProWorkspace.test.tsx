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
    expect(screen.getAllByText(/请打开安装好的 AIVORA 再出图/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "选用" })[0]!);
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
    fireEvent.click(screen.getByRole("button", { name: "分割" }));
    expect(screen.getByText("分割还没接上。")).toBeInTheDocument();
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
    expect(await screen.findByText(/编剧写好了/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再改改" }));
    expect(await screen.findByText(/编剧写好了/)).toBeInTheDocument();
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
    expect(screen.getAllByText(/请打开安装好的 AIVORA 再出图/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "选用" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "场景" }));
    fireEvent.click(stageTab("剪辑"));
    fireEvent.click(screen.getByRole("button", { name: "分割" }));
    fireEvent.click(screen.getByRole("button", { name: "上一个" }));
    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    fireEvent.click(screen.getByRole("button", { name: "设出点" }));
    fireEvent.click(screen.getAllByRole("button", { name: "重新生成" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "改描述" }));
    fireEvent.click(screen.getByRole("button", { name: "改细节" }));
    fireEvent.click(screen.getByRole("button", { name: "延长" }));
    fireEvent.click(screen.getByRole("button", { name: "换配音" }));
    fireEvent.click(screen.getByRole("button", { name: "用新版替换" }));
    expect(screen.getByText(/已用新版替换/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设入点" }));
    fireEvent.click(screen.getByRole("button", { name: "保留旧版" }));
    expect(screen.getByText(/保留旧版/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "修改这一段" }));
    fireEvent.click(screen.getByRole("button", { name: "改画面细节" }));
    fireEvent.click(screen.getByRole("button", { name: "往后延长" }));
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
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByText(/设置页还没接上/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "账号" }));
    fireEvent.click(screen.getByRole("button", { name: "用量" }));
    expect(screen.getByText(/用量页还没接上/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "账号" }));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(screen.getByText("已退出登录。")).toBeInTheDocument();
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
    expect(screen.getByText(/设置页还没接上/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "先出草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "直接出成片" }));
    fireEvent.change(screen.getByLabelText("画面描述"), { target: { value: "雨停了" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 2 个版本" }));
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
    fireEvent.click(screen.getByRole("button", { name: "先出草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
    expect(await screen.findByText(/不能先出草稿/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回分镜" }));
    fireEvent.click(stageTab("剪辑"));
    fireEvent.click(screen.getByRole("button", { name: "设入点" }));
    fireEvent.click(screen.getByRole("button", { name: "改细节" }));
    expect(screen.getByText(/不能改画面细节/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "延长" }));
    expect(screen.getByText(/看不到可以延长/)).toBeInTheDocument();
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
    fireEvent.click(screen.getAllByRole("button", { name: "生成 2 个版本" })[0]!);
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
      expect(await screen.findByText("定妆照已生成。")).toBeInTheDocument();
      fireEvent.click(stageTab("分镜"));
      fireEvent.click(screen.getByRole("button", { name: "单镜" }));
      fireEvent.click(screen.getByRole("button", { name: "2 秒" }));
      fireEvent.click(screen.getByRole("button", { name: "生成 2 个版本" }));
      expect(await screen.findByText("这一版已经生成。")).toBeInTheDocument();
      expect(document.querySelector(".still")).toBeTruthy();
      expect(screen.getByRole("button", { name: /后台生成/ }).textContent).toContain("没有排队");
      const preview = document.querySelector("video.frame");
      expect(preview).toBeTruthy();
      fireEvent.timeUpdate(preview!);
      fireEvent.ended(preview!);
      expect(play).toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "返回分镜" }));
      expect(screen.getByText("4 秒")).toBeInTheDocument();
      fireEvent.click(stageTab("剪辑"));
      expect(screen.getAllByText("未生成").length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
      fireEvent.click(screen.getByRole("button", { name: "保存到" }));
      expect(await screen.findByRole("button", { name: "保存到" })).toHaveTextContent(
        "/tmp/aivora/export",
      );
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      fireEvent.click(screen.getByRole("button", { name: "设入点" }));
      expect(screen.getByText("左右对比")).toBeInTheDocument();
      expect(document.querySelector(".cmp video")).toBeTruthy();
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
    expect(await screen.findByText(/还没有认出人物和场景/)).toBeInTheDocument();
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
    expect(screen.getByText(/已用离线拆镜/)).toBeInTheDocument();

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

function stageTab(name: string) {
  const found = screen
    .getAllByRole("button", { name: new RegExp(name) })
    .find((item) => item.className.includes("tab"));
  if (!found) throw new Error(`missing tab ${name}`);
  return found;
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
      if (text.includes("写这一镜的表演")) return { kind: "OK", text: "眼神一沉，停半拍。" };
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
