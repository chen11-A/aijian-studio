import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { V2ImageViewer } from "./V2ImageViewer";
import { EditorDialog } from "./Common";
import { CharacterPage } from "./CharacterPage";
import { AssetsPage, ScenePage } from "./SceneAndAssets";
import { VisualPages } from "./VisualPages";
import { MediaPages, mediaTimecode } from "./MediaPages";
import { StoryPages } from "./StoryPages";
import { TimelineWorkbench } from "./TimelineWorkbench";
import { createAivoraSampleFixture, DemoProvider, moveShot, shotAtTime, useDemo } from "./model";
import { DemoApp } from "./DemoApp";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  HTMLElement.prototype.setPointerCapture ??= () => undefined;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
});
afterEach(() => document.body.replaceChildren());

function loadImage(width: number, height: number) {
  const image = screen.getByTestId("v2-viewer-source");
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
  fireEvent.load(image);
}

function PageHarness({ page }: { page: "character" | "scenes" | "assets" | "characters" }) {
  const d = useDemo();
  const body =
    page === "character" ? (
      <CharacterPage />
    ) : page === "scenes" ? (
      <ScenePage />
    ) : page === "assets" ? (
      <AssetsPage />
    ) : (
      <VisualPages />
    );
  return (
    <>
      <button onClick={() => d.setScenario("empty")}>设为空资料</button>
      <button onClick={() => d.setScenario("error")}>设为读取失败</button>
      <button onClick={() => d.setScenario("normal")}>恢复资料</button>
      {body}
      <EditorDialog />
      <output aria-label="c19-page-state">
        {JSON.stringify({
          page: d.page,
          scenario: d.scenario,
          references: d.references,
          relation: d.value("relation"),
          localAssets: d.localAssets.map((item) => item.name),
          rightTab: d.rightTab,
          aiOpen: d.aiOpen,
        })}
      </output>
    </>
  );
}

function openPage(page: "character" | "scenes" | "assets" | "characters") {
  window.history.replaceState({}, "", `#${page}`);
  render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <PageHarness page={page} />
    </DemoProvider>,
  );
}

function pageState() {
  return JSON.parse(screen.getByLabelText("c19-page-state").textContent ?? "{}") as {
    page: string;
    scenario: string;
    references: string[];
    relation: string;
    localAssets: string[];
    rightTab: string;
    aiOpen: boolean;
  };
}

function StoryHarness() {
  const d = useDemo();
  return (
    <>
      <StoryPages />
      <EditorDialog />
      <output aria-label="c19-story-state">
        {JSON.stringify({
          page: d.page,
          confirmed: d.value("storyConfirmed"),
          scriptSaved: d.value("scriptSaved"),
          event: d.value("event-0"),
          sourceVersion: d.value("sourceVersion"),
          sourceApproved: d.value("sourceApproved"),
          source: d.value("source"),
        })}
      </output>
    </>
  );
}

function MediaHarness() {
  const d = useDemo();
  return (
    <>
      <MediaPages />
      <EditorDialog />
      <output aria-label="c19-media-state">
        {JSON.stringify({
          candidate: d.value(`candidate-${d.selectedShot}`),
          issue: d.value(`shotIssue-${d.selectedShot}`),
          included: d.annotations.filter((item) => item.included).length,
          tasks: d.tasks.map((item) => item.name),
        })}
      </output>
    </>
  );
}

function openStory(page: "story" | "script" | "source") {
  const fixture = createAivoraSampleFixture();
  fixture.values.sourceApproved = "true";
  fixture.values.storySourceVersion = "1";
  window.history.replaceState({}, "", `#${page}`);
  render(
    <DemoProvider fixture={fixture}>
      <StoryHarness />
    </DemoProvider>,
  );
}

function openMedia(page: "generation" | "changes" | "export" | "review" | "storyboard") {
  window.history.replaceState({}, "", `#${page}`);
  render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <MediaHarness />
    </DemoProvider>,
  );
}

const c19ProjectId = `prj_${"c".repeat(32)}`;
function c19Timeline(frameRate = 24, timecodeMode = "NON_DROP_FRAME") {
  return {
    request_id: "timeline",
    data: {
      project_id: c19ProjectId,
      version_id: `ver_${"d".repeat(32)}`,
      content_hash: `sha256:${"e".repeat(64)}`,
      created_at: "2026-09-14T00:00:00Z",
      total_duration_frames: 5760,
      timeline: {
        schema_version: 1,
        timeline_id: "c19-main",
        revision: 1,
        sequence_timebase: { frame_rate: { num: frameRate, den: 1 }, timecode_mode: timecodeMode },
        width: 1920,
        height: 1080,
        assets: [
          {
            schema_version: 1,
            asset_id: "c19-asset-a",
            source_asset_sha256: `sha256:${"a".repeat(64)}`,
            source_frame_count: 120,
            proxy: null,
          },
        ],
        clips: [
          {
            schema_version: 1,
            clip_id: "c19-clip-a",
            asset_id: "c19-asset-a",
            source_in_frame: 0,
            duration_frames: 48,
          },
          {
            schema_version: 1,
            clip_id: "c19-clip-b",
            asset_id: "c19-asset-a",
            source_in_frame: 48,
            duration_frames: 36,
          },
        ],
      },
    },
  };
}

function openRemoteAssembly(
  frameRate = 24,
  timecodeMode = "NON_DROP_FRAME",
  getProjectTimeline = vi.fn().mockResolvedValue(c19Timeline(frameRate, timecodeMode)),
) {
  window.history.replaceState({}, "", "#assembly");
  window.aijian = {
    health: vi.fn().mockResolvedValue({
      request_id: "health",
      data: { status: "ok", service: "aijian-api", version: "test" },
    }),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: c19ProjectId,
          name: "C19 时间线",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
    getSourceManifest: vi.fn().mockResolvedValue(null),
    getProjectTimeline,
    trimTimelineClip: vi.fn(),
    reorderTimelineClip: vi.fn(),
    replaceTimelineClip: vi.fn(),
  } as unknown as Window["aijian"];
  render(
    <DemoProvider>
      <MediaPages />
      <EditorDialog />
    </DemoProvider>,
  );
}

function PointerTimelineHarness() {
  const [frame, setFrame] = useState(10);
  return (
    <TimelineWorkbench
      seek={(seconds) => setFrame(Math.round(seconds * 24))}
      timeline={{
        totalFrames: 240,
        frame,
        frameRate: { num: 24, den: 1 },
        timecodeMode: "NON_DROP_FRAME",
        clipEndFrames: [48, 96, 240],
      }}
    >
      <div />
    </TimelineWorkbench>
  );
}

describe("C19 production viewer interactions", () => {
  it("keeps a gallery navigable when an image fails, then retries its actual source without closing the viewer", () => {
    const close = vi.fn();
    render(
      <V2ImageViewer
        title="角色参考"
        src="/front.png"
        images={[
          { src: "/front.png", title: "正面", filename: "front.png" },
          { src: "/side.png", title: "侧面", filename: "side.png" },
        ]}
        onClose={close}
      />,
    );
    loadImage(512, 752);
    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    fireEvent.error(screen.getByTestId("v2-viewer-source"));
    expect(screen.getByRole("alert")).toHaveTextContent("图片加载失败");
    expect(screen.getByRole("button", { name: "保存样例" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    loadImage(512, 752);
    expect(screen.getByRole("heading", { name: "大屏预览 · 侧面" })).toBeInTheDocument();
    expect(screen.getByText(/side\.png · 样例插画/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭查看器" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("supports keyboard zoom, pan, reset, and gallery switching as local viewing controls", () => {
    render(
      <V2ImageViewer
        title="场景参考"
        src="/wide.png"
        images={[
          { src: "/wide.png", title: "全景" },
          { src: "/detail.png", title: "细节" },
        ]}
        onClose={vi.fn()}
      />,
    );
    loadImage(2000, 800);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "=" });
    expect(screen.getByRole("button", { name: "100%" })).not.toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(screen.getByTestId("v2-viewer-artwork").style.transform).toContain("+ 40px");
    fireEvent.keyDown(dialog, { key: "0" });
    expect(screen.getByRole("button", { name: "适应窗口" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    loadImage(1000, 1000);
    expect(screen.getByRole("heading", { name: "大屏预览 · 细节" })).toBeInTheDocument();
  });

  it("exports a requested legacy crop as artwork pixels and reports no save error", () => {
    const drawImage = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toDataUrl = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/png;base64,crop");
    const download = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(
      <V2ImageViewer
        title="旧版场景"
        src="/legacy.png"
        filename="legacy.png"
        crop={{ x: 40, y: 20, width: 200, height: 100, sourceWidth: 1000 }}
        onClose={vi.fn()}
      />,
    );
    loadImage(2000, 1000);
    fireEvent.click(screen.getByRole("button", { name: "保存样例" }));
    expect(drawImage).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
    expect(screen.getByText("当前仅一张；工具栏不遮图")).toBeInTheDocument();
    getContext.mockRestore();
    toDataUrl.mockRestore();
    download.mockRestore();
  });

  it("keeps failed crop saving visible and lets escape close the viewer without altering the source", () => {
    const close = vi.fn();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(
      <V2ImageViewer
        title="失败裁剪"
        src="/crop.png"
        filename="crop.png"
        crop={{ x: 0, y: 0, width: 10, height: 10, sourceWidth: 100 }}
        onClose={close}
      />,
    );
    loadImage(100, 100);
    fireEvent.click(screen.getByRole("button", { name: "保存样例" }));
    expect(screen.getByText("保存失败，请重试")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    getContext.mockRestore();
  });

  it("keeps character reference failure distinct from recovery and opens a local reference preview only after retry", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "设为读取失败" }));
    expect(screen.getByRole("button", { name: "加载失败 · 重试" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "大屏查看苏晚侧面参考" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "重试" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "大屏查看苏晚侧面参考" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("苏晚 · 侧面参考");
    expect(pageState().scenario).toBe("normal");
  });

  it("edits a scene detail locally, blocks the empty reference state, and returns to the available sample on demand", () => {
    openPage("scenes");
    fireEvent.click(screen.getByRole("button", { name: "空间设定" }));
    fireEvent.change(screen.getByLabelText("光线与氛围"), { target: { value: "潮湿反光" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设定" }));
    expect(screen.getByText("潮湿反光")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设为空资料" }));
    expect(screen.getByRole("button", { name: "确认场景并进入分镜" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "查看样例参考" }));
    expect(screen.getByRole("button", { name: "确认场景并进入分镜" })).toBeEnabled();
  });

  it("opens the selected scene reference and records its loaded aspect through visible image events", () => {
    openPage("scenes");
    const sceneImage = screen.getByAltText("雨夜街道 主参考样例参考");
    Object.defineProperties(sceneImage, {
      naturalWidth: { configurable: true, value: 1920 },
      naturalHeight: { configurable: true, value: 1080 },
    });
    fireEvent.load(sceneImage);
    expect(
      document
        .querySelector<HTMLElement>(".v21-scene-stage")!
        .style.getPropertyValue("--scene-aspect"),
    ).toBe("1.7777777777777777");
    fireEvent.click(screen.getByRole("button", { name: "放大场景" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("雨夜街道 · 主参考");
  });

  it("keeps a scene correction request local to its visible AI side panel action", () => {
    openPage("scenes");
    fireEvent.click(screen.getByRole("button", { name: "哪里不对？" }));
    expect(pageState()).toMatchObject({ page: "scenes", rightTab: "ai", aiOpen: true });
  });

  it("filters unavailable video assets without inventing one and maintains the explicit local project reference", () => {
    openPage("assets");
    fireEvent.click(screen.getByRole("button", { name: "视频" }));
    expect(screen.getByRole("heading", { name: "没有匹配的素材" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看全部样例" }));
    fireEvent.click(screen.getByRole("button", { name: "故事参考详情与引用" }));
    fireEvent.click(screen.getByRole("button", { name: "添加项目引用" }));
    expect(pageState().references).toEqual(["故事参考"]);
  });

  it("does not retain an asset when the browser FileReader reports an error", async () => {
    const OriginalFileReader = window.FileReader;
    class ErrorReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      result: string | ArrayBuffer | null = null;
      readAsDataURL() {
        queueMicrotask(() =>
          this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>),
        );
      }
    }
    Object.defineProperty(window, "FileReader", { configurable: true, value: ErrorReader });
    try {
      openPage("assets");
      const broken = new File(["broken"], "broken-reference.png", { type: "image/png" });
      fireEvent.change(screen.getByLabelText("导入素材文件"), { target: { files: [broken] } });
      await waitFor(() => expect(pageState().localAssets).toEqual([]));
      expect(
        screen.queryByRole("button", { name: "broken-reference.png详情与引用" }),
      ).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "FileReader", {
        configurable: true,
        value: OriginalFileReader,
      });
    }
  });

  it("opens the native import control only from its visible button and previews the selected default asset", () => {
    openPage("assets");
    const input = screen.getByLabelText("导入素材文件");
    const inputClick = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "导入素材" }));
    expect(inputClick).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "查看选中素材" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("故事参考");
    inputClick.mockRestore();
  });

  it("returns from the assets footer to the local project page only through its visible secondary action", () => {
    openPage("assets");
    fireEvent.click(screen.getByRole("button", { name: "返回项目" }));
    expect(pageState().page).toBe("project");
  });

  it("uses the visible character relation editor and keeps the selected-page action local", () => {
    openPage("characters");
    fireEvent.click(screen.getByText("角色详情"));
    fireEvent.click(screen.getByRole("button", { name: "修改人物关系" }));
    fireEvent.change(screen.getByLabelText("人物关系"), { target: { value: "搭档" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(pageState().relation).toBe("搭档");
    fireEvent.click(screen.getByRole("button", { name: "模型与本集造型" }));
    expect(pageState().page).toBe("character");
  });

  it("selects another existing character through the visible detail drawer before opening that character page", () => {
    openPage("characters");
    fireEvent.click(screen.getByText("角色详情"));
    fireEvent.click(screen.getByRole("button", { name: "选择角色" }));
    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "2 · 程野" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "查看角色" }));
    expect(screen.getByRole("heading", { name: /当前角色 · 程野/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "模型与本集造型" }));
    expect(screen.getByRole("heading", { name: "角色模型与本集造型" })).toBeInTheDocument();
  });

  it("saves the complete character identity and outfit forms, then reopens the detail drawer with that data isolated to the character", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    let drawer = within(screen.getByRole("dialog"));
    fireEvent.click(drawer.getByRole("button", { name: "身份" }));
    fireEvent.click(drawer.getByRole("button", { name: "编辑身份" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "苏晚（修订）" } });
    fireEvent.change(screen.getByLabelText("身份与作用"), { target: { value: "调查员" } });
    fireEvent.change(screen.getByLabelText("年龄"), { target: { value: "27" } });
    fireEvent.change(screen.getByLabelText("性格"), { target: { value: "敏锐且克制" } });
    fireEvent.change(screen.getByLabelText("外观要点"), { target: { value: "短发与银色耳饰" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByRole("heading", { name: "苏晚（修订）" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    drawer = within(screen.getByRole("dialog"));
    fireEvent.click(drawer.getByRole("button", { name: "造型" }));
    fireEvent.click(drawer.getByRole("button", { name: "编辑当前造型" }));
    fireEvent.change(screen.getByLabelText("造型名称"), { target: { value: "修订雨夜调查" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByRole("button", { name: "选择造型 修订雨夜调查" })).toBeInTheDocument();
  });

  it("saves a coherent scene setting group and previews the selected reference view before opening asset details", () => {
    openPage("scenes");
    fireEvent.click(screen.getByRole("button", { name: /正向/ }));
    expect(screen.getByRole("button", { name: /正向/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("combobox", { name: "环境状态" }), {
      target: { value: "雾天" },
    });
    fireEvent.click(screen.getByRole("button", { name: "空间设定" }));
    fireEvent.change(screen.getByLabelText("空间与叙事"), {
      target: { value: "雾中的街道保留路灯方向。" },
    });
    fireEvent.change(screen.getByLabelText("光线与氛围"), { target: { value: "低对比冷光" } });
    fireEvent.change(screen.getByLabelText("参考视角"), { target: { value: "高位视角" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设定" }));
    expect(screen.getByLabelText("当前场景设定")).toHaveTextContent("雾天");
    expect(screen.getByLabelText("当前场景设定")).toHaveTextContent("低对比冷光");
    expect(screen.getByLabelText("当前场景设定")).toHaveTextContent("高机位");
  });

  it("adds a named scene only after the explicit drawer form is completed and makes it the current editable location", () => {
    openPage("scenes");
    fireEvent.click(screen.getByText("详细信息"));
    fireEvent.click(screen.getByRole("button", { name: "新增场景" }));
    fireEvent.change(screen.getByLabelText("地点名称"), { target: { value: "屋顶花园" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByRole("combobox", { name: "当前地点" })).toHaveTextContent("屋顶花园");
    expect(screen.getByLabelText("当前场景设定")).toHaveTextContent("白天");
  });

  it("opens an asset detail, adds its explicit project reference, and removes it after reopening the same asset", () => {
    openPage("assets");
    fireEvent.click(screen.getByRole("button", { name: "世界主视觉详情与引用" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("世界主视觉");
    fireEvent.click(screen.getByRole("button", { name: "添加项目引用" }));
    expect(pageState().references).toEqual(["世界主视觉"]);
    fireEvent.click(screen.getByRole("button", { name: "世界主视觉详情与引用" }));
    fireEvent.click(screen.getByRole("button", { name: "移除项目引用" }));
    expect(pageState().references).toEqual([]);
  });

  it("stores a character performance state and voice field locally, then navigates to voice settings only on the explicit control", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    const drawer = within(screen.getByRole("dialog"));
    fireEvent.click(drawer.getByRole("button", { name: "状态" }));
    fireEvent.click(drawer.getByRole("button", { name: "紧张" }));
    fireEvent.change(drawer.getByRole("textbox", { name: "表演备注" }), {
      target: { value: "在雨声中压低呼吸。" },
    });
    fireEvent.click(drawer.getByRole("button", { name: "声音" }));
    fireEvent.change(drawer.getByRole("textbox", { name: "角色声线" }), {
      target: { value: "低沉且谨慎" },
    });
    expect(drawer.getByRole("button", { name: "试听" })).toBeDisabled();
    fireEvent.click(drawer.getByRole("button", { name: "声音设置" }));
    expect(pageState().page).toBe("voice");
  });

  it("imports a local-session asset, filters it by its typed name, and opens its real preview without claiming publication", async () => {
    openPage("assets");
    const asset = new File(["pixels"], "rain-reference.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("导入素材文件"), { target: { files: [asset] } });
    expect(
      await screen.findByRole("button", { name: "rain-reference.png详情与引用" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "详细信息" }));
    fireEvent.change(screen.getByLabelText("搜索素材"), { target: { value: "rain-reference" } });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(screen.getByText("本地导入 · 当前会话")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "大屏查看rain-reference.png" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("rain-reference.png");
  });

  it("uses a ready real timeline for zoom, frame-range, keyboard seek, and clip selection without writing to it", async () => {
    openRemoteAssembly();
    expect(await screen.findByText("修订版 1")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "时间轴缩放" }), {
      target: { value: "6" },
    });
    expect(screen.getByLabelText("时间轴比例")).toHaveTextContent("6.00 px/帧");
    const code = screen.getByRole("textbox", { name: "当前时间码" });
    fireEvent.change(code, { target: { value: "00:00:01:00" } });
    fireEvent.keyDown(code, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "设入点 I" }));
    fireEvent.keyDown(screen.getByLabelText("时间轴横向滚动区域"), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "设出点 O" }));
    expect(screen.getByLabelText("已选时间范围")).toHaveTextContent("1 帧");
    fireEvent.click(screen.getByRole("button", { name: "吸附" }));
    expect(screen.getByRole("button", { name: "吸附" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(screen.getByLabelText("时间轴横向滚动区域"), { key: "End" });
    fireEvent.click(screen.getByRole("button", { name: "清除范围" }));
    expect(screen.getByLabelText("已选时间范围")).toHaveTextContent("点击标尺定位");
    const clips = await screen.findAllByRole("button", { name: /^视频镜头/ });
    fireEvent.click(clips[1]!);
    expect(clips[1]).toHaveAttribute("aria-pressed", "true");
    const bridge = window.aijian!;
    await waitFor(() => expect(bridge.trimTimelineClip).not.toHaveBeenCalled());
    expect(bridge.reorderTimelineClip).not.toHaveBeenCalled();
    expect(bridge.replaceTimelineClip).not.toHaveBeenCalled();
  });

  it("keeps production timing helpers bounded at their real shot and frame edges", () => {
    const fixture = createAivoraSampleFixture();
    expect(shotAtTime(fixture.shots, -1)?.id).toBe(1);
    expect(shotAtTime(fixture.shots, 9999)?.id).toBe(8);
    expect(moveShot(fixture.shots, 999, 1)).toBe(fixture.shots);
    expect(
      moveShot(fixture.shots, 1, 3)
        .slice(0, 3)
        .map((shot) => shot.id),
    ).toEqual([2, 3, 1]);
    expect(mediaTimecode(0)).toBe("00:00:00:00");
    expect(mediaTimecode(65.9)).toBe("00:01:05:22");
  });

  it("confirms a fully checked story only against its current accepted local source snapshot", () => {
    openStory("story");
    for (const checkbox of screen.getAllByRole("checkbox"))
      if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "确认故事理解" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "确认并进入角色" })).toBeEnabled();
    fireEvent.click(dialog.getByRole("button", { name: "确认并进入角色" }));
    expect(JSON.parse(screen.getByLabelText("c19-story-state").textContent ?? "{}")).toMatchObject({
      page: "characters",
      confirmed: "true",
    });
  });

  it("edits an explicit script scene and confirms the local script state without submitting a production request", () => {
    openStory("script");
    fireEvent.click(screen.getByRole("button", { name: "新增场次" }));
    expect(screen.getByRole("heading", { name: "场次 09 · 故事场景" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("场次动作"), {
      target: { value: "雨水停下，城市灯光仍在闪烁。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认样例剧本" }));
    expect(JSON.parse(screen.getByLabelText("c19-story-state").textContent ?? "{}")).toMatchObject({
      scriptSaved: "true",
    });
  });

  it("edits the story premise and a structural beat through their visible forms, then inspects the source evidence locally", () => {
    openStory("story");
    fireEvent.click(screen.getByText(/在记忆可以交易的未来城市/));
    fireEvent.change(screen.getByLabelText("故事一句话"), {
      target: { value: "苏晚在雨夜追查被篡改的记忆。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByText("苏晚在雨夜追查被篡改的记忆。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发现异常记忆" }));
    fireEvent.change(screen.getByLabelText("事件内容"), {
      target: { value: "发现被篡改的异常记忆" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByText("发现被篡改的异常记忆")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看原文" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("原文依据 · 第一章");
  });

  it("selects a generation candidate and records only the local adjustment intent", () => {
    openMedia("generation");
    fireEvent.click(screen.getByRole("button", { name: /参考样例 2/ }));
    fireEvent.change(screen.getByLabelText("设为当前候选"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    fireEvent.click(screen.getAllByRole("button", { name: "标记待调整" })[0]!);
    fireEvent.change(screen.getByLabelText("问题描述"), {
      target: { value: "保持人物停顿的节奏。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(JSON.parse(screen.getByLabelText("c19-media-state").textContent ?? "{}")).toMatchObject({
      candidate: "2",
    });
    expect(screen.getByText("保持人物停顿的节奏。")).toBeInTheDocument();
  });

  it("filters and edits a local change proposal while keeping formal execution unavailable", () => {
    openMedia("changes");
    fireEvent.change(screen.getByRole("combobox", { name: "批注分组" }), {
      target: { value: "字幕" },
    });
    expect(screen.getByText("对白字幕向上移动，避开下方画面细节。")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("纳入方案 2"));
    fireEvent.click(screen.getByRole("button", { name: "编辑方案" }));
    fireEvent.change(screen.getByLabelText("修改要求"), {
      target: { value: "字幕向上移动并保留安全边距。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByText("字幕向上移动并保留安全边距。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并执行" })).toBeDisabled();
  });

  it("changes output settings and records a draft export intent without exposing a formal export", () => {
    openMedia("export");
    fireEvent.click(screen.getByRole("button", { name: "查看输出设置" }));
    fireEvent.change(screen.getByLabelText("帧率"), { target: { value: "30 fps" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByText(/30 fps/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "演示草稿导出" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("仅修改演示数据");
    fireEvent.click(screen.getByRole("button", { name: "确认演示方案" }));
    expect(JSON.parse(screen.getByLabelText("c19-media-state").textContent ?? "{}")).toMatchObject({
      tasks: ["导出草稿流程演示"],
    });
    expect(screen.getByRole("button", { name: "批准并导出正式版" })).toBeDisabled();
  });

  it("keeps professional inspector edits on their selected shot while other shots retain their own parameters", () => {
    window.history.replaceState({}, "", "#storyboard");
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    fireEvent.click(screen.getByRole("button", { name: "镜头 2 走进雨幕" }));
    const inspector = within(screen.getByRole("complementary", { name: "专业属性" }));
    fireEvent.click(inspector.getByRole("button", { name: "画面" }));
    fireEvent.change(inspector.getByRole("combobox", { name: "画面比例" }), {
      target: { value: "2.39:1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "镜头 3 似曾相识" }));
    expect(inspector.getByRole("combobox", { name: "画面比例" })).toHaveValue("16:9");
    fireEvent.click(screen.getByRole("button", { name: "镜头 2 走进雨幕" }));
    expect(inspector.getByRole("combobox", { name: "画面比例" })).toHaveValue("2.39:1");
  });

  it("edits generation parameters in the professional inspector and retains them when returning to the selected production shot", () => {
    window.history.replaceState({}, "", "#generation");
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    const inspector = within(screen.getByRole("complementary", { name: "专业属性" }));
    fireEvent.click(inspector.getByRole("button", { name: "参数" }));
    fireEvent.change(inspector.getByRole("spinbutton", { name: "随机种子" }), {
      target: { value: "73" },
    });
    fireEvent.change(inspector.getByRole("textbox", { name: "PromptPlan" }), {
      target: { value: "雨夜里人物停在霓虹反光前。" },
    });
    expect(inspector.getByRole("spinbutton", { name: "随机种子" })).toHaveValue(73);
    expect(inspector.getByRole("textbox", { name: "PromptPlan" })).toHaveValue(
      "雨夜里人物停在霓虹反光前。",
    );
  });

  it("edits professional shot performance, camera, reference fields, scroll state, and AI reference through visible inspector controls", () => {
    window.history.replaceState({}, "", "#storyboard");
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    const inspector = within(screen.getByRole("complementary", { name: "专业属性" }));
    fireEvent.click(inspector.getByRole("button", { name: "表演" }));
    fireEvent.change(inspector.getByRole("combobox", { name: "视线方向" }), {
      target: { value: "镜头方向" },
    });
    fireEvent.change(inspector.getByRole("textbox", { name: "对白" }), {
      target: { value: "我记得这场雨。" },
    });
    expect(inspector.getByRole("textbox", { name: "对白" })).toHaveValue("我记得这场雨。");
    fireEvent.click(inspector.getByRole("button", { name: "运镜" }));
    fireEvent.change(inspector.getByRole("combobox", { name: "运动速度" }), {
      target: { value: "快速" },
    });
    expect(inspector.getByRole("combobox", { name: "运动速度" })).toHaveValue("快速");
    fireEvent.click(inspector.getByRole("button", { name: "参考" }));
    fireEvent.change(inspector.getByRole("combobox", { name: "场景参考版本" }), {
      target: { value: "v3" },
    });
    expect(inspector.getByRole("combobox", { name: "场景参考版本" })).toHaveValue("v3");
    const properties = inspector.getByLabelText("对象属性内容");
    Object.defineProperty(properties, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    fireEvent.scroll(properties, { target: { scrollTop: 80 } });
    expect(properties.scrollTop).toBe(80);
    fireEvent.click(inspector.getByRole("button", { name: "引用到 AI" }));
  });

  it("binds a character outfit to an explicit sample-shot range before the local confirmation review", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    const drawer = within(screen.getByRole("dialog"));
    fireEvent.click(drawer.getByRole("button", { name: "造型" }));
    fireEvent.click(drawer.getByRole("button", { name: "选择样例镜头范围" }));
    fireEvent.change(screen.getByLabelText("起始样例镜头"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("结束样例镜头"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    const reopened = within(screen.getByRole("dialog"));
    fireEvent.click(reopened.getByRole("button", { name: "造型" }));
    expect(reopened.getByText("样例镜头 2–4（单独选择）")).toBeInTheDocument();
    fireEvent.click(reopened.getByRole("button", { name: "确认当前造型" }));
    const review = within(screen.getByRole("dialog", { name: /确认\s*苏晚\s*的本集造型/ }));
    expect(
      review.getByText(
        (_, element) =>
          element?.tagName === "SPAN" &&
          element.textContent?.includes("样例镜头 2–4（单独选择）") === true,
      ),
    ).toBeInTheDocument();
    fireEvent.click(review.getByRole("button", { name: "确认此造型" }));
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    const confirmed = within(screen.getByRole("dialog"));
    fireEvent.click(confirmed.getByRole("button", { name: "造型" }));
    expect(confirmed.getByText("已确认")).toBeInTheDocument();
  });

  it("keeps a review annotation frame-quantized, selected at its marker, and editable as a local proposal", () => {
    openMedia("review");
    fireEvent.click(screen.getByRole("button", { name: "选择范围批注" }));
    fireEvent.change(screen.getByLabelText("开始时间（秒）"), { target: { value: "2.04" } });
    fireEvent.change(screen.getByLabelText("结束时间（秒）"), { target: { value: "2.4" } });
    fireEvent.change(screen.getByLabelText("批注内容"), {
      target: { value: "雨声进入前保留空拍。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    fireEvent.click(screen.getByRole("button", { name: "定位批注 雨声进入前保留空拍。" }));
    expect(screen.getByRole("slider", { name: "审片时间轴" })).toHaveValue(String(49 / 24));
    expect(screen.getByText("雨声进入前保留空拍。")).toBeInTheDocument();
    expect(screen.getByText(/尚未执行修改/)).toBeInTheDocument();
  });

  it("reviews every available scene in the explicit confirmation drawer before moving to the storyboard", () => {
    openPage("scenes");
    fireEvent.click(screen.getByRole("button", { name: "确认场景并进入分镜" }));
    const review = within(screen.getByRole("dialog", { name: "核对本集全部场景" }));
    expect(review.getByText(/雨夜街道 · 夜 · 雨 · 静态参考/)).toBeInTheDocument();
    fireEvent.click(review.getByRole("button", { name: "确认全部场景并进入分镜" }));
    expect(pageState().page).toBe("storyboard");
  });

  it("changes review sorting locally and keeps the unavailable video controls disabled", () => {
    openMedia("review");
    fireEvent.click(screen.getByRole("button", { name: "按时间" }));
    fireEvent.change(screen.getByLabelText("批注排序"), { target: { value: "最新添加" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByRole("button", { name: "最新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂无真实视频，不能播放" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂无真实音轨" })).toBeDisabled();
  });

  it("adds a storyboard shot through its explicit form and derives the editable preview length from that shot", () => {
    window.history.replaceState({}, "", "#storyboard");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <MediaPages />
        <EditorDialog />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "添加镜头" }));
    fireEvent.change(screen.getByLabelText("镜头名称"), { target: { value: "雨后空镜" } });
    fireEvent.change(screen.getByLabelText("时长（秒）"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByRole("combobox", { name: "当前分镜" })).toHaveValue("9");
    expect(screen.getByText(/当前镜头 144 帧/)).toBeInTheDocument();
  });

  it("rejects an invalid review range without adding a proposal, preserving the correction path in the form", () => {
    openMedia("review");
    fireEvent.click(screen.getByRole("button", { name: "选择范围批注" }));
    fireEvent.change(screen.getByLabelText("开始时间（秒）"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("结束时间（秒）"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("批注内容"), {
      target: { value: "不能保存的反向范围。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByRole("dialog", { name: "添加区间批注" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "定位批注 不能保存的反向范围。" }),
    ).not.toBeInTheDocument();
  });

  it("keeps character confirmation blocked in its review dialog while reference data is empty", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "设为空资料" }));
    expect(screen.getByText(/请补齐同一角色的正面、侧面和背面参考/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认角色造型" }));
    const blockedReview = within(screen.getByRole("dialog", { name: /确认\s*苏晚/ }));
    expect(blockedReview.getByRole("button", { name: "确认本集全部造型并继续" })).toBeDisabled();
    fireEvent.click(blockedReview.getByRole("button", { name: "关闭" }));
  });

  it("opens the missing-reference guidance at the affected character tab without fabricating a view", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "设为空资料" }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看参考要求" })[1]!);
    const drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    expect(drawer.getByRole("button", { name: "外观" })).toHaveAttribute("aria-pressed", "true");
    expect(drawer.getByText(/缺少独立侧面和背面/)).toBeInTheDocument();
  });

  it("flags an invalid real-timeline timecode, restores the current value on escape, and sends no edit", async () => {
    openRemoteAssembly();
    expect(await screen.findByText("修订版 1")).toBeInTheDocument();
    const code = screen.getByRole("textbox", { name: "当前时间码" });
    const original = (code as HTMLInputElement).value;
    fireEvent.change(code, { target: { value: "00:00:00:24" } });
    fireEvent.keyDown(code, { key: "Enter" });
    expect(code).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(code, { key: "Escape" });
    expect(code).toHaveValue(original);
    const bridge = window.aijian!;
    expect(bridge.trimTimelineClip).not.toHaveBeenCalled();
    expect(bridge.reorderTimelineClip).not.toHaveBeenCalled();
    expect(bridge.replaceTimelineClip).not.toHaveBeenCalled();
  });

  it("keeps storyboard timecode correction local without changing the selected preview", () => {
    openMedia("storyboard");
    const code = screen.getByRole("textbox", { name: "当前时间码" });
    const original = (code as HTMLInputElement).value;
    fireEvent.change(code, { target: { value: "not-a-timecode" } });
    fireEvent.keyDown(code, { key: "Enter" });
    expect(code).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(code, { key: "Escape" });
    expect(code).toHaveValue(original);
    expect(screen.getByRole("button", { name: "镜头 3 似曾相识" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("uses the real 30fps assembly timebase for frame rollover instead of a 24fps sample assumption", async () => {
    openRemoteAssembly(30);
    expect(await screen.findByText(/30\/1 fps/)).toBeInTheDocument();
    const code = screen.getByRole("textbox", { name: "当前时间码" });
    fireEvent.change(code, { target: { value: "00:00:01:29" } });
    fireEvent.keyDown(code, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "下一帧" }));
    expect(code).toHaveValue("00:00:02:00");
    fireEvent.change(code, { target: { value: "00:00:02:30" } });
    fireEvent.keyDown(code, { key: "Enter" });
    expect(code).toHaveAttribute("aria-invalid", "true");
  });

  it("filters review notes against the selected shot through the visible local sort-and-filter form", () => {
    openMedia("review");
    fireEvent.click(screen.getByRole("button", { name: "镜头 1 城市入夜" }));
    fireEvent.click(screen.getByRole("button", { name: "按时间" }));
    fireEvent.change(screen.getByLabelText("批注筛选"), { target: { value: "当前镜头" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    const notes = within(screen.getByLabelText("批注列表内容"));
    expect(notes.getByText("回头后留一点停顿，让观众感受到她的迟疑。")).toBeInTheDocument();
    expect(notes.queryByText("对白字幕向上移动，避开下方画面细节。")).not.toBeInTheDocument();
  });

  it("rejects a dropped 30fps minute label and accepts the first legal drop-frame label", async () => {
    openRemoteAssembly(30, "DROP_FRAME");
    expect(await screen.findByText(/DROP_FRAME/)).toBeInTheDocument();
    const code = screen.getByRole("textbox", { name: "当前时间码" });
    fireEvent.change(code, { target: { value: "00:01:00:00" } });
    fireEvent.keyDown(code, { key: "Enter" });
    expect(code).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(code, { target: { value: "00:01:00:02" } });
    fireEvent.keyDown(code, { key: "Enter" });
    expect(code).toHaveAttribute("aria-invalid", "false");
  });

  it("stages pasted source text until an explicit successful workspace import", async () => {
    const projectId = `prj_${"a".repeat(32)}`;
    let resolveImport!: (value: unknown) => void;
    const importTextSource = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );
    const imported = {
      request_id: "import",
      data: {
        id: `src_${"b".repeat(32)}`,
        project_id: projectId,
        filename: "pasted-source.txt",
        media_type: "text/plain",
        sha256: `sha256:${"c".repeat(64)}`,
        bytes: 36,
        blocks: [
          { id: `srcb_${"d".repeat(32)}`, ordinal: 1, text: "新的来源正文，等待重新审核。" },
        ],
        created_at: "2026-09-15T00:00:00Z",
        updated_at: "2026-09-15T00:00:00Z",
      },
    };
    window.history.replaceState({}, "", "#source");
    window.aijian = {
      health: vi.fn().mockResolvedValue({
        request_id: "health",
        data: { status: "ok", service: "aijian-api", version: "test" },
      }),
      listProjects: vi.fn().mockResolvedValue({
        request_id: "projects",
        data: [
          {
            id: projectId,
            name: "来源项目",
            status: "active",
            revision: 1,
            updated_at: "2026-09-15T00:00:00Z",
          },
        ],
      }),
      listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
      getSourceManifest: vi.fn().mockResolvedValue({
        request_id: "manifest",
        data: {
          project_id: projectId,
          head: {
            artifact_id: `art_${"e".repeat(32)}`,
            latest_version_id: null,
            review_version_id: null,
            review_submission_id: null,
            accepted_version_id: null,
            revision: 1,
            review_evidence_revision: 0,
            updated_at: "2026-09-15T00:00:00Z",
          },
          latest_version: null,
          review_version: null,
          accepted_version: null,
        },
      }),
      importTextSource,
    } as never;
    render(
      <DemoProvider>
        <StoryHarness />
      </DemoProvider>,
    );
    await screen.findByText(/来源状态：未导入/);
    fireEvent.click(screen.getByRole("button", { name: "粘贴故事" }));
    const before = JSON.parse(screen.getByLabelText("c19-story-state").textContent ?? "{}");
    fireEvent.change(screen.getByLabelText("外部原文正文"), {
      target: { value: "新的来源正文，等待重新审核。" },
    });
    expect(JSON.parse(screen.getByLabelText("c19-story-state").textContent ?? "{}")).toMatchObject(
      before,
    );
    fireEvent.click(screen.getByRole("button", { name: "作为外部原文导入" }));
    await waitFor(() => expect(importTextSource).toHaveBeenCalledOnce());
    const [[calledProjectId, importInput]] = importTextSource.mock.calls as unknown as [
      [string, { filename: string; media_type: string; content_base64: string }],
    ];
    expect(calledProjectId).toBe(projectId);
    expect(importInput).toMatchObject({
      filename: "pasted-source.txt",
      media_type: "text/plain",
      content_base64: expect.any(String),
    });
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(importInput.content_base64), (c) => c.charCodeAt(0)),
      ),
    ).toBe("新的来源正文，等待重新审核。");
    expect(JSON.parse(screen.getByLabelText("c19-story-state").textContent ?? "{}")).toMatchObject({
      source: before.source,
      sourceApproved: before.sourceApproved,
    });
    resolveImport(imported);
    expect(await screen.findByText("新的来源正文，等待重新审核。")).toBeInTheDocument();
    expect(JSON.parse(screen.getByLabelText("c19-story-state").textContent ?? "{}")).toMatchObject({
      source: "新的来源正文，等待重新审核。",
      sourceApproved: "false",
    });
  });

  it("seeks with the frame ruler and playhead, then scrolls and zooms the visible timeline controls", () => {
    window.history.replaceState({}, "", "#storyboard");
    const { container } = render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <MediaPages />
        <EditorDialog />
      </DemoProvider>,
    );
    const scroll = container.querySelector<HTMLElement>(".v21-timeline-scroll")!;
    const ruler = container.querySelector<HTMLElement>(".v21-frame-ruler")!;
    Object.defineProperty(scroll, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0 }),
    });
    const code = screen.getByRole("textbox", { name: "当前时间码" });
    const initial = (code as HTMLInputElement).value;
    fireEvent.pointerDown(ruler, { pointerId: 1, clientX: 20 });
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: 32 });
    fireEvent.pointerUp(ruler, { pointerId: 1 });
    fireEvent.pointerDown(ruler, { pointerId: 2, clientX: 40 });
    fireEvent.pointerCancel(ruler, { pointerId: 2 });
    expect(code).not.toHaveValue(initial);
    const playhead = screen.getByRole("button", { name: "拖动播放头" });
    fireEvent.pointerDown(playhead, { pointerId: 3, clientX: 48 });
    fireEvent.pointerMove(playhead, { pointerId: 3, clientX: 54 });
    fireEvent.pointerUp(playhead, { pointerId: 3 });
    fireEvent.keyDown(playhead, { key: "ArrowRight" });
    fireEvent.wheel(scroll, { ctrlKey: true, deltaY: -120, clientX: 80 });
    expect(screen.getByLabelText("时间轴比例")).not.toHaveTextContent("全片");
    scroll.scrollLeft = 0;
    fireEvent.wheel(scroll, { deltaY: 45 });
    expect(scroll.scrollLeft).toBe(45);
    fireEvent.scroll(scroll, { target: { scrollLeft: 45 } });
  });

  it("opens the character portrait preview, selects another existing outfit, and enters its visible drawer", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "大屏查看苏晚肖像" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("苏晚 · 肖像原图");
    fireEvent.click(screen.getByRole("button", { name: "关闭查看器" }));
    const secondOutfit = screen.getByRole("button", { name: "选择造型 日常职业装" });
    fireEvent.click(secondOutfit);
    expect(secondOutfit).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "4 套 · 样例" }));
    const drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    expect(drawer.getByRole("button", { name: "造型" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(drawer.getByRole("button", { name: "关闭角色详情" }));
    expect(screen.queryByRole("dialog", { name: /角色详情/ })).not.toBeInTheDocument();
  });

  it("switches the character reference view and opens the chosen preview only through the drawer controls", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    const drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    fireEvent.click(drawer.getByRole("button", { name: "角色模型" }));
    fireEvent.click(drawer.getByRole("button", { name: "正面" }));
    fireEvent.click(drawer.getByRole("button", { name: "大屏查看正面" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("苏晚 · 正面");
  });

  it("creates an outfit from the empty wardrobe path and exposes it after reference recovery", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "设为空资料" }));
    fireEvent.click(screen.getByRole("button", { name: "新增造型" }));
    fireEvent.change(screen.getByLabelText("造型名称"), { target: { value: "雾晨备用装" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复资料" }));
    fireEvent.click(screen.getByRole("button", { name: "查看全部 5 套并编辑适用镜头" }));
    expect(screen.getByRole("dialog", { name: /苏晚.*角色详情/ })).toHaveTextContent("雾晨备用装");
  });

  it("closes an unconfirmed character review through its visible close control without changing the review state", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "确认角色造型" }));
    const review = screen.getByRole("dialog", { name: /确认\s*苏晚/ });
    fireEvent.click(within(review).getByRole("button", { name: "关闭角色造型审核" }));
    expect(screen.queryByRole("dialog", { name: /确认\s*苏晚/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认角色造型" })).toBeEnabled();
  });

  it("opens character details from the ready status, follows the relationship evidence, and returns through visible drawer controls", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "三视图样例" }));
    const drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    expect(drawer.getByRole("button", { name: "角色模型" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(drawer.getByRole("button", { name: "关联" }));
    expect(drawer.getByText(/相关镜头：Shot 1/)).toBeInTheDocument();
    fireEvent.click(drawer.getByRole("button", { name: "查看原文依据" }));
    expect(screen.getByRole("dialog", { name: "苏晚 · 故事依据" })).toBeInTheDocument();
  });

  it("clears an explicitly selected outfit range through the visible detail action and requires reconfirmation", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    let drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    fireEvent.click(drawer.getByRole("button", { name: "造型" }));
    fireEvent.click(drawer.getByRole("button", { name: "选择样例镜头范围" }));
    fireEvent.change(screen.getByLabelText("起始样例镜头"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("结束样例镜头"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    fireEvent.click(drawer.getByRole("button", { name: "造型" }));
    fireEvent.click(drawer.getByRole("button", { name: "清除样例镜头选择" }));
    expect(drawer.getAllByText("待确认")).toHaveLength(4);
    expect(drawer.queryByRole("button", { name: "清除样例镜头选择" })).not.toBeInTheDocument();
  });

  it("confirms one selected outfit in its review and then visibly withdraws that confirmation", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    let drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    fireEvent.click(drawer.getByRole("button", { name: "造型" }));
    fireEvent.click(drawer.getByRole("button", { name: "确认当前造型" }));
    const review = within(screen.getByRole("dialog", { name: /确认\s*苏晚/ }));
    fireEvent.click(review.getByRole("button", { name: "确认此造型" }));
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    fireEvent.click(drawer.getByRole("button", { name: "造型" }));
    fireEvent.click(drawer.getByRole("button", { name: "撤回造型确认" }));
    expect(drawer.getByRole("button", { name: "确认当前造型" })).toBeInTheDocument();
  });

  it("changes the current character through the detail selector and exits the resulting drawer with its visible footer", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    const drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    fireEvent.change(drawer.getByRole("combobox", { name: "当前角色" }), {
      target: { value: "2" },
    });
    expect(screen.getByRole("dialog", { name: /程野.*角色详情/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回三视图" }));
    expect(screen.queryByRole("dialog", { name: /角色详情/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "程野" })).toBeInTheDocument();
  });

  it("edits the visible appearance detail and keeps the local correction request on the character page", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    const drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    fireEvent.click(drawer.getByRole("button", { name: "外观" }));
    fireEvent.click(drawer.getByRole("button", { name: "编辑外观要点" }));
    fireEvent.change(screen.getByLabelText("外观要点"), { target: { value: "湿发和银色耳饰" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    fireEvent.click(screen.getByRole("button", { name: "哪里不对？" }));
    expect(pageState().page).toBe("character");
  });

  it("selects a different outfit inside the detail plan list and cancels its review with the native dialog event", () => {
    openPage("character");
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    const drawer = within(screen.getByRole("dialog", { name: /苏晚.*角色详情/ }));
    fireEvent.click(drawer.getByRole("button", { name: "造型" }));
    const alternate = drawer.getByText("日常职业装").closest("button")!;
    fireEvent.click(alternate);
    expect(alternate).toHaveClass("selected");
    fireEvent.click(drawer.getByRole("button", { name: "确认当前造型" }));
    const review = screen.getByRole("dialog", { name: /确认\s*苏晚/ });
    fireEvent(review, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog", { name: /确认\s*苏晚/ })).not.toBeInTheDocument();
  });

  it("scrolls the visible generation candidates horizontally with the wheel and retains that local position", () => {
    openMedia("generation");
    const candidates = screen.getByLabelText("候选版本内容");
    Object.defineProperty(candidates, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    fireEvent.wheel(candidates, { deltaY: 72 });
    expect(candidates.scrollLeft).toBe(72);
    fireEvent.scroll(candidates, { target: { scrollLeft: 72 } });
    expect(candidates.scrollLeft).toBe(72);
  });

  it("records scrolling the filtered review-note list through its visible list control", () => {
    openMedia("review");
    const notes = screen.getByLabelText("批注列表内容");
    Object.defineProperty(notes, "scrollTop", { configurable: true, writable: true, value: 0 });
    fireEvent.scroll(notes, { target: { scrollTop: 96 } });
    expect(notes.scrollTop).toBe(96);
    expect(screen.getByText("回头后留一点停顿，让观众感受到她的迟疑。")).toBeInTheDocument();
  });

  it("keeps the visible change-proposal list scroll position local while its editing controls remain available", () => {
    openMedia("changes");
    const changes = screen.getByLabelText("修改方案内容");
    Object.defineProperty(changes, "scrollTop", { configurable: true, writable: true, value: 0 });
    fireEvent.scroll(changes, { target: { scrollTop: 128 } });
    expect(changes.scrollTop).toBe(128);
    fireEvent.click(within(changes).getAllByRole("button", { name: "查看影响" })[0]!);
    expect(screen.getByRole("dialog")).toHaveTextContent("影响范围");
  });

  it("reorders a real assembly clip through the draggable video track and preserves the revision guard", async () => {
    openRemoteAssembly();
    expect(await screen.findByText("修订版 1")).toBeInTheDocument();
    const first = screen.getByRole("button", { name: "视频镜头 1 c19-clip-a" });
    const second = screen.getByRole("button", { name: "视频镜头 2 c19-clip-b" });
    fireEvent.dragStart(first);
    fireEvent.dragOver(second);
    fireEvent.drop(second);
    await waitFor(() =>
      expect(window.aijian!.reorderTimelineClip).toHaveBeenCalledWith(c19ProjectId, {
        clip_id: "c19-clip-a",
        new_index: 1,
        expected_revision: 1,
      }),
    );
  });

  it("shows a real timeline read failure and recovers only after the explicit reload action", async () => {
    const getProjectTimeline = vi
      .fn()
      .mockRejectedValueOnce(new Error("engine offline"))
      .mockResolvedValue(c19Timeline());
    openRemoteAssembly(24, "NON_DROP_FRAME", getProjectTimeline);
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("无法读取真实时间线");
    fireEvent.click(within(error).getByRole("button", { name: "重新读取" }));
    expect(await screen.findByText("修订版 1")).toBeInTheDocument();
    expect(getProjectTimeline).toHaveBeenCalledTimes(2);
  });

  it("submits a valid visible trim against the selected real clip with its current revision", async () => {
    openRemoteAssembly();
    expect(await screen.findByText("修订版 1")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "源入点（帧）" }), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "持续（帧）" }), {
      target: { value: "36" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用裁剪" }));
    await waitFor(() =>
      expect(window.aijian!.trimTimelineClip).toHaveBeenCalledWith(c19ProjectId, {
        clip_id: "c19-clip-a",
        new_source_in_frame: 12,
        new_duration_frames: 36,
        expected_revision: 1,
      }),
    );
  });

  it("moves a real assembly clip left through its documented Alt-arrow keyboard affordance", async () => {
    openRemoteAssembly();
    expect(await screen.findByText("修订版 1")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "视频镜头 2 c19-clip-b" }), {
      altKey: true,
      key: "ArrowLeft",
    });
    await waitFor(() =>
      expect(window.aijian!.reorderTimelineClip).toHaveBeenCalledWith(c19ProjectId, {
        clip_id: "c19-clip-b",
        new_index: 0,
        expected_revision: 1,
      }),
    );
  });

  it("drives the timeline ruler, playhead, edge controls, wheel, and accessible slider through real UI events", () => {
    const { container } = render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <PointerTimelineHarness />
      </DemoProvider>,
    );
    const scroll = screen.getByLabelText("时间轴横向滚动区域");
    const ruler = container.querySelector<HTMLElement>(".v21-frame-ruler")!;
    Object.defineProperty(scroll, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0 }),
    });
    Object.defineProperty(scroll, "scrollLeft", { configurable: true, writable: true, value: 0 });
    const code = screen.getByRole("textbox", { name: "当前时间码" });

    fireEvent.pointerDown(ruler, { pointerId: 1, clientX: 48 });
    expect(code).not.toHaveValue("00:00:00:10");
    const rulerStart = (code as HTMLInputElement).value;
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: 288 });
    expect(code).not.toHaveValue(rulerStart);
    const rulerMoved = (code as HTMLInputElement).value;
    fireEvent.pointerUp(ruler, { pointerId: 1 });
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: 360 });
    expect(code).toHaveValue(rulerMoved);
    fireEvent.pointerDown(ruler, { pointerId: 2, clientX: 480 });
    const rulerCancelled = (code as HTMLInputElement).value;
    fireEvent.pointerCancel(ruler, { pointerId: 2 });
    fireEvent.pointerMove(ruler, { pointerId: 2, clientX: 576 });
    expect(code).toHaveValue(rulerCancelled);

    const playhead = screen.getByRole("button", { name: "拖动播放头" });
    fireEvent.pointerDown(playhead, { pointerId: 3, clientX: 576 });
    fireEvent.pointerMove(playhead, { pointerId: 3, clientX: 600 });
    const playheadMoved = (code as HTMLInputElement).value;
    expect(playheadMoved).not.toBe(rulerCancelled);
    fireEvent.pointerUp(playhead, { pointerId: 3 });
    fireEvent.pointerMove(playhead, { pointerId: 3, clientX: 720 });
    expect(code).toHaveValue(playheadMoved);
    fireEvent.pointerDown(playhead, { pointerId: 4, clientX: 624 });
    const playheadCancelled = (code as HTMLInputElement).value;
    fireEvent.pointerCancel(playhead, { pointerId: 4 });
    fireEvent.pointerMove(playhead, { pointerId: 4, clientX: 768 });
    expect(code).toHaveValue(playheadCancelled);
    fireEvent.keyDown(playhead, { key: "ArrowLeft" });
    expect(code).not.toHaveValue(playheadMoved);

    fireEvent.change(code, { target: { value: "00:00:04:03" } });
    fireEvent.keyDown(code, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "上一镜头" }));
    expect(code).toHaveValue("00:00:04:00");
    fireEvent.click(screen.getByRole("button", { name: "上一镜头" }));
    expect(code).toHaveValue("00:00:02:00");
    fireEvent.click(screen.getByRole("button", { name: "下一镜头" }));
    expect(code).toHaveValue("00:00:04:00");
    fireEvent.click(screen.getByRole("button", { name: "下一镜头" }));
    expect(code).toHaveValue("00:00:10:00");
    fireEvent.click(screen.getByRole("button", { name: "下一帧" }));
    expect(code).toHaveValue("00:00:10:00");

    fireEvent.wheel(scroll, { deltaY: 55 });
    expect(scroll.scrollLeft).toBeCloseTo(55);
    fireEvent.wheel(scroll, { ctrlKey: true, deltaY: -120, clientX: 180 });
    expect(screen.getByLabelText("时间轴比例")).not.toHaveTextContent("全片");
    fireEvent.change(screen.getByRole("slider", { name: "预演位置" }), {
      target: { value: "1.5" },
    });
    expect(code).toHaveValue("00:00:01:12");
    fireEvent.keyDown(scroll, { key: "Home" });
    expect(code).toHaveValue("00:00:00:00");
    fireEvent.keyDown(scroll, { key: "ArrowRight", shiftKey: true });
    expect(code).toHaveValue("00:00:01:00");
    fireEvent.keyDown(scroll, { key: "i" });
    fireEvent.keyDown(scroll, { key: "ArrowRight" });
    fireEvent.keyDown(scroll, { key: "o" });
    expect(screen.getByLabelText("已选时间范围")).toHaveTextContent("1 帧");
    fireEvent.keyDown(scroll, { key: "Escape" });
    expect(screen.getByLabelText("已选时间范围")).toHaveTextContent("点击标尺定位");
  });
});
