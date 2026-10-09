import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MediaPages } from "./MediaPages";
import { EditorDialog } from "./Common";
import { DemoProvider, useDemo, createAivoraSampleFixture } from "./model";

afterEach(() => {
  cleanup();
  delete window.aijian;
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
function open(page: string) {
  window.history.replaceState({}, "", `#${page}`);
  return render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <MediaPages />
      <EditorDialog />
    </DemoProvider>,
  );
}
describe("V2 media workflows", () => {
  it("preserves keyboard shot reordering and derives the timeline length from edited durations", () => {
    open("storyboard");
    const selector = screen.getByRole("combobox", { name: "当前分镜" });
    const first = screen.getByRole("button", { name: /^镜头 1 / });
    fireEvent.keyDown(first, { altKey: true, key: "ArrowRight" });
    expect(within(selector).getAllByRole("option")[0]).toHaveValue("2");
    const timeline = screen.getByRole("slider", { name: "预演位置" });
    const before = Number(timeline.getAttribute("max"));
    fireEvent.click(screen.getByRole("button", { name: "镜头详情" }));
    const duration = screen.getByLabelText("镜头时长（秒）") as HTMLInputElement;
    const original = Number(duration.value);
    fireEvent.change(duration, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(Number(timeline.getAttribute("max"))).toBe(before - original + 12);
    expect(screen.getByText(/当前镜头 288 帧/)).toBeInTheDocument();
  });
  it("uses one frame-based review timeline and seeks an annotation within the actual duration", () => {
    open("review");
    const timeline = screen.getByRole("slider", { name: "审片时间轴" });
    expect(timeline).toHaveAttribute("step", String(1 / 24));
    const marker = screen.getAllByRole("button", { name: /^定位批注/ })[0]!;
    fireEvent.click(marker);
    expect(Number((timeline as HTMLInputElement).value)).toBeLessThanOrEqual(
      Number(timeline.getAttribute("max")),
    );
    expect(screen.getByRole("button", { name: "暂无真实视频，不能播放" })).toBeDisabled();
  });
  it("retains eight draggable storyboard shots over thirteen independent reference thumbnails", () => {
    const measure = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 992 } as DOMRect);
    const { container } = open("storyboard");
    const timeline = screen.getByRole("slider", { name: "预演位置" });
    expect(timeline).toHaveValue("84.75");
    const shots = screen.getAllByRole("button", { name: /^镜头 \d / });
    expect(shots).toHaveLength(8);
    expect(shots.every((shot) => shot.getAttribute("draggable") === "true")).toBe(true);
    const thumbnails = Array.from(container.querySelectorAll(".v2-storyboard-filmstrip-frame img"));
    expect(thumbnails).toHaveLength(13);
    expect(
      thumbnails.slice(0, 4).map((image) => image.getAttribute("src")?.split("/").at(-1)),
    ).toEqual(["city.png", "story-art.png", "story-art.png", "city.png"]);
    fireEvent.dragStart(shots[0]!);
    fireEvent.dragOver(shots[2]!);
    fireEvent.drop(shots[2]!);
    const options = within(screen.getByRole("combobox", { name: "当前分镜" })).getAllByRole(
      "option",
    );
    expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual([
      "2",
      "3",
      "1",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^镜头 1 / }));
    expect(timeline).toHaveValue("60");
    expect(timeline).toHaveAttribute("max", "240");
    expect(container.querySelectorAll(".v2-storyboard-filmstrip-frame")).toHaveLength(13);
    measure.mockRestore();
  });
  it("selects range annotations only inside their half-open frame interval", () => {
    const { container } = open("review");
    const timeline = screen.getByRole("slider", { name: "审片时间轴" });
    const range = container.querySelector(".v2-review-note.is-range")!;
    fireEvent.change(timeline, { target: { value: "32" } });
    expect(range).toHaveClass("selected");
    fireEvent.change(timeline, { target: { value: String(37 - 1 / 24) } });
    expect(range).toHaveClass("selected");
    fireEvent.change(timeline, { target: { value: "37" } });
    expect(range).not.toHaveClass("selected");
  });
  it("moves the custom review scroll thumb with the real annotation list", () => {
    const { container } = open("review");
    const notes = screen.getByLabelText("批注列表内容");
    const thumb = container.querySelector<HTMLElement>(".v2-review-scroll-thumb")!;
    expect(parseFloat(thumb.style.height)).toBeCloseTo((384 / 504) * 100);
    fireEvent.scroll(notes, { target: { scrollTop: 120 } });
    expect(parseFloat(thumb.style.top)).toBeCloseTo((120 / 504) * 100);
    expect(notes.scrollTop).toBe(120);
    expect(container.querySelectorAll(".v2-review-note")).toHaveLength(4);
  });
  it("keeps eight logical review segments while resizing the separate decorative filmstrip", () => {
    let trackWidth = 992;
    const measure = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ width: trackWidth }) as DOMRect);
    const { container } = open("review");
    const timeline = screen.getByRole("slider", { name: "审片时间轴" });
    expect(timeline).toHaveValue("84.75");
    const shots = screen.getAllByRole("button", { name: /^镜头 \d / });
    expect(shots).toHaveLength(8);
    expect(container.querySelectorAll(".v2-review-filmstrip-frame")).toHaveLength(13);
    expect(container.querySelector(".v2-review-filmstrip")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(shots[3]!);
    expect(timeline).toHaveValue("90");
    expect(shots[3]).toHaveAttribute("aria-pressed", "true");
    trackWidth = 1312;
    fireEvent(window, new Event("resize"));
    expect(container.querySelectorAll(".v2-review-filmstrip-frame")).toHaveLength(17);
    expect(screen.getAllByRole("button", { name: /^镜头 \d / })).toHaveLength(8);
    expect(timeline).toHaveValue("90");
    const references = Array.from(container.querySelectorAll(".v2-review-note img"));
    expect(references.map((image) => image.getAttribute("src")?.split("/").at(-1))).toEqual([
      "story-art.png",
      "city.png",
      "avatar.png",
      "city.png",
    ]);
    measure.mockRestore();
  });
  it("adds a frame-quantized annotation without submitting a media modification", () => {
    open("review");
    fireEvent.click(screen.getByRole("button", { name: "添加批注" }));
    fireEvent.change(screen.getByLabelText("开始时间（秒）"), { target: { value: "1.1" } });
    fireEvent.change(screen.getByLabelText("批注内容"), {
      target: { value: "保持镜头，检查停顿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    fireEvent.click(screen.getByRole("button", { name: "定位批注 保持镜头，检查停顿" }));
    expect(screen.getByRole("slider", { name: "审片时间轴" })).toHaveValue(String(26 / 24));
    expect(screen.getByText(/尚未执行修改/)).toBeInTheDocument();
  });
  it("opens editable export settings while keeping formal export unavailable", () => {
    open("export");
    fireEvent.click(screen.getByRole("button", { name: "查看正式导出样例设置" }));
    fireEvent.change(screen.getByLabelText("格式"), { target: { value: "MOV" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByText(/MOV ·/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准并导出正式版" })).toBeDisabled();
  });
  it("supports the original per-note inclusion control and a disabled execution gate", () => {
    open("changes");
    expect(within(screen.getByLabelText("修改方案内容")).getAllByRole("checkbox")).toHaveLength(4);
    const include = screen.getAllByRole("checkbox")[0]!;
    const checked = (include as HTMLInputElement).checked;
    fireEvent.click(include);
    expect((include as HTMLInputElement).checked).toBe(!checked);
    expect(screen.getByRole("button", { name: "确认并执行" })).toBeDisabled();
  });
  it.each([
    ["changes", "修改方案详情", "确认并执行", "当前纳入 4 项"],
    ["export", "导出检查详情", "批准并导出正式版", "具名用户批准：尚未批准"],
  ])(
    "opens the %s header detail drawer without enabling execution",
    (page, title, action, status) => {
      open(page!);
      fireEvent.click(screen.getByRole("button", { name: "详细信息" }));
      const drawer = screen.getByRole("dialog", { name: title });
      expect(drawer).toHaveClass("detail-drawer");
      expect(drawer).toHaveTextContent(status!);
      fireEvent.click(within(drawer).getByRole("button", { name: /^关闭$/ }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: action })).toBeDisabled();
    },
  );
});

const remoteProjectId = `prj_${"1".repeat(32)}`;
const remoteOperationId = `ivo_${"2".repeat(32)}`;
const remotePage = (items: unknown[] = [], next_cursor: string | null = null) => ({
  data: { items, next_cursor },
  request_id: "e6225937-1243-427b-bc98-56eda28e9dd3",
});
const remoteSummary = (operation_id = remoteOperationId) => ({
  operation_id,
  project_id: remoteProjectId,
  changed_artifact_id: `art_${"3".repeat(32)}`,
  old_accepted_version_id: `ver_${"4".repeat(32)}`,
  new_accepted_version_id: `ver_${"5".repeat(32)}`,
  gate_decision_id: `dec_${"6".repeat(32)}`,
  assessment_hash: `sha256:${"7".repeat(64)}`,
  created_at: "2026-09-14T00:00:00Z",
  reason_path_count: 1,
});
const remoteDetail = (operation_id = remoteOperationId) => {
  const summary = remoteSummary(operation_id);
  return {
    operation_id: summary.operation_id,
    project_id: summary.project_id,
    changed_artifact_id: summary.changed_artifact_id,
    old_accepted_version_id: summary.old_accepted_version_id,
    new_accepted_version_id: summary.new_accepted_version_id,
    gate_decision_id: summary.gate_decision_id,
    assessment_hash: summary.assessment_hash,
    created_at: summary.created_at,
    paths: [],
  };
};
const remoteFullPage = () => {
  const items = Array.from({ length: 20 }, (_, index) =>
    remoteSummary(`ivo_${(40 - index).toString(16).padStart(32, "0")}`),
  );
  return remotePage(items, items.at(-1)!.operation_id);
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function RemoteChangesHarness() {
  const d = useDemo();
  return (
    <>
      <MediaPages />
      <button onClick={() => void d.connectRealWorkspace()}>重新连接项目</button>
      <button onClick={() => void d.selectRealProject(2)}>打开第二项目</button>
    </>
  );
}
function openRemoteChanges(overrides: Record<string, unknown> = {}, page = "changes") {
  window.history.replaceState({}, "", `#${page}`);
  window.aijian = {
    health: vi.fn(),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: remoteProjectId,
          name: "真实项目",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
    getSourceManifest: vi.fn().mockResolvedValue(null),
    getProjectTimeline: vi.fn().mockResolvedValue(null),
    trimTimelineClip: vi.fn(),
    reorderTimelineClip: vi.fn(),
    replaceTimelineClip: vi.fn(),
    listInvalidationOperations: vi.fn().mockResolvedValue(remotePage()),
    getInvalidationOperation: vi.fn().mockResolvedValue({
      data: remoteDetail(),
      request_id: "e6225937-1243-427b-bc98-56eda28e9dd3",
    }),
    ...overrides,
  } as unknown as Window["aijian"];
  return render(
    <DemoProvider fixture={{}}>
      <RemoteChangesHarness />
    </DemoProvider>,
  );
}
const remoteTimeline = (revision = 1, sourceIn = 0, projectId = remoteProjectId) => ({
  request_id: "timeline",
  data: {
    project_id: projectId,
    version_id: `ver_${"a".repeat(32)}`,
    content_hash: `sha256:${"b".repeat(64)}`,
    created_at: "2026-09-14T00:00:00Z",
    total_duration_frames: 84,
    timeline: {
      schema_version: 1,
      timeline_id: "episode-main",
      revision,
      sequence_timebase: { frame_rate: { num: 24, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
      width: 1080,
      height: 1920,
      assets: [
        {
          schema_version: 1,
          asset_id: "asset-a",
          source_asset_sha256: `sha256:${"a".repeat(64)}`,
          source_frame_count: 120,
          proxy: null,
        },
        {
          schema_version: 1,
          asset_id: "asset-b",
          source_asset_sha256: `sha256:${"b".repeat(64)}`,
          source_frame_count: 60,
          proxy: null,
        },
      ],
      clips: [
        {
          schema_version: 1,
          clip_id: "clip-a",
          asset_id: "asset-a",
          source_in_frame: sourceIn,
          duration_frames: 48,
        },
        {
          schema_version: 1,
          clip_id: "clip-b",
          asset_id: "asset-b",
          source_in_frame: 0,
          duration_frames: 36,
        },
      ],
    },
  },
});

describe("legacy project invalidation history with a synthetic desktop transport", () => {
  it("does not request history when no backend project is connected", async () => {
    const listInvalidationOperations = vi.fn();
    const getProjectTimeline = vi.fn();
    window.aijian = {
      listProjects: vi.fn().mockResolvedValue({ request_id: "projects", data: [] }),
      listInvalidationOperations,
      getProjectTimeline,
    } as unknown as Window["aijian"];
    open("changes");
    await new Promise((done) => setTimeout(done, 0));
    expect(listInvalidationOperations).not.toHaveBeenCalled();
    expect(getProjectTimeline).not.toHaveBeenCalled();
    expect(screen.getByText(/尚未连接本地项目/)).toBeInTheDocument();
  });
  it("shows empty, retries an error, and appends only with the server cursor", async () => {
    const firstPage = remoteFullPage();
    const first = firstPage.data.items.at(-1)! as { operation_id: string };
    const second = remoteSummary(`ivo_${"8".repeat(32)}`);
    const listInvalidationOperations = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(remotePage([second]));
    openRemoteChanges({ listInvalidationOperations });
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(
      (await screen.findAllByRole("button", { name: /内容版本发生变更/ })).at(0),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await waitFor(() =>
      expect(listInvalidationOperations).toHaveBeenLastCalledWith(remoteProjectId, {
        limit: 20,
        cursor: first.operation_id,
      }),
    );
    expect(screen.getAllByRole("button", { name: /内容版本发生变更/ })).toHaveLength(21);
  });
  it("reads detail errors, retries, and restores the selected report focus on return", async () => {
    const getInvalidationOperation = vi
      .fn()
      .mockRejectedValueOnce(new Error("detail offline"))
      .mockResolvedValueOnce({
        data: remoteDetail(),
        request_id: "e6225937-1243-427b-bc98-56eda28e9dd3",
      });
    openRemoteChanges({
      listInvalidationOperations: vi.fn().mockResolvedValue(remotePage([remoteSummary()])),
      getInvalidationOperation,
    });
    const row = await screen.findByRole("button", { name: /内容版本发生变更/ });
    fireEvent.click(row);
    expect(await screen.findByRole("alert")).toHaveTextContent("detail offline");
    fireEvent.click(screen.getByRole("button", { name: "重新读取报告" }));
    expect(await screen.findByText("本次没有下游影响路径")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回影响报告" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /内容版本发生变更/ })).toHaveFocus(),
    );
  });

  it("drops a late A history result after selecting B", async () => {
    const projectB = `prj_${"9".repeat(32)}`;
    const lateA = deferred<ReturnType<typeof remotePage>>();
    const listInvalidationOperations = vi
      .fn()
      .mockReturnValueOnce(lateA.promise)
      .mockResolvedValueOnce(remotePage([]));
    openRemoteChanges({
      listProjects: vi.fn().mockResolvedValue({
        request_id: "projects",
        data: [
          {
            id: remoteProjectId,
            name: "项目 A",
            status: "active",
            revision: 1,
            updated_at: "2026-09-14T00:00:00Z",
          },
          {
            id: projectB,
            name: "项目 B",
            status: "active",
            revision: 1,
            updated_at: "2026-09-14T00:00:00Z",
          },
        ],
      }),
      listInvalidationOperations,
    });
    await waitFor(() =>
      expect(listInvalidationOperations).toHaveBeenCalledWith(remoteProjectId, { limit: 20 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "打开第二项目" }));
    await waitFor(() =>
      expect(listInvalidationOperations).toHaveBeenCalledWith(projectB, { limit: 20 }),
    );
    lateA.resolve(remotePage([remoteSummary()]));
    expect(await screen.findByText("暂无影响报告")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /内容版本发生变更/ })).not.toBeInTheDocument();
  });
  it("navigates away from history without any write bridge call", async () => {
    const importTextSource = vi.fn();
    const submitSourceManifest = vi.fn();
    const createProject = vi.fn();
    openRemoteChanges({ importTextSource, submitSourceManifest, createProject });
    await screen.findByText("暂无影响报告");
    fireEvent.click(screen.getByRole("button", { name: "返回审片" }));
    expect(importTextSource).not.toHaveBeenCalled();
    expect(submitSourceManifest).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });
});

describe("legacy project timeline with a synthetic desktop transport", () => {
  it("keeps assembly accessible without a project and does not substitute sample shots", async () => {
    open("assembly");
    expect(await screen.findByText(/尚未连接本地项目/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^视频镜头/ })).not.toBeInTheDocument();
  });

  it("uses the current response identity for trim, reorder, and only enables a replacement that fits", async () => {
    const trimTimelineClip = vi.fn().mockResolvedValue(remoteTimeline(2));
    const reorderTimelineClip = vi.fn().mockResolvedValue(remoteTimeline(3));
    const replaceTimelineClip = vi.fn().mockResolvedValue(remoteTimeline(4));
    openRemoteChanges(
      {
        getProjectTimeline: vi.fn().mockResolvedValue(remoteTimeline()),
        trimTimelineClip,
        reorderTimelineClip,
        replaceTimelineClip,
      },
      "assembly",
    );
    expect(await screen.findByText("修订版 1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("源入点（帧）"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("持续（帧）"), { target: { value: "47" } });
    fireEvent.click(screen.getByRole("button", { name: "应用裁剪" }));
    await waitFor(() =>
      expect(trimTimelineClip).toHaveBeenCalledWith(remoteProjectId, {
        clip_id: "clip-a",
        new_source_in_frame: 1,
        new_duration_frames: 47,
        expected_revision: 1,
      }),
    );
    const clips = await screen.findAllByRole("button", { name: /^视频镜头/ });
    fireEvent.keyDown(clips[0]!, { altKey: true, key: "ArrowRight" });
    await waitFor(() =>
      expect(reorderTimelineClip).toHaveBeenCalledWith(remoteProjectId, {
        clip_id: "clip-a",
        new_index: 1,
        expected_revision: 2,
      }),
    );
    fireEvent.change(screen.getByLabelText("替换素材"), { target: { value: "asset-b" } });
    fireEvent.change(screen.getByLabelText("源入点（帧）"), { target: { value: "12" } });
    expect(screen.getByRole("button", { name: "替换当前素材" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("源入点（帧）"), { target: { value: "13" } });
    expect(screen.getByRole("button", { name: "替换当前素材" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("源入点（帧）"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "替换当前素材" }));
    await waitFor(() =>
      expect(replaceTimelineClip).toHaveBeenCalledWith(remoteProjectId, {
        clip_id: "clip-a",
        replacement_asset_id: "asset-b",
        replacement_source_in_frame: 12,
        expected_revision: 3,
      }),
    );
  });

  it("locks one write, reloads after an unknown result, and never replays it", async () => {
    const pending = deferred<ReturnType<typeof remoteTimeline>>();
    const getProjectTimeline = vi
      .fn()
      .mockResolvedValueOnce(remoteTimeline())
      .mockResolvedValueOnce(remoteTimeline(2));
    const trimTimelineClip = vi.fn().mockReturnValue(pending.promise);
    openRemoteChanges({ getProjectTimeline, trimTimelineClip }, "assembly");
    await screen.findByText("修订版 1");
    fireEvent.click(screen.getByRole("button", { name: "应用裁剪" }));
    expect(screen.getByRole("button", { name: "应用裁剪" })).toBeDisabled();
    expect(trimTimelineClip).toHaveBeenCalledTimes(1);
    pending.reject(new Error("network unknown"));
    expect(await screen.findByText("修订版 2")).toBeInTheDocument();
    expect(trimTimelineClip).toHaveBeenCalledTimes(1);
  });

  it("drops A's late timeline after selecting B", async () => {
    const projectB = `prj_${"9".repeat(32)}`;
    const lateA = deferred<ReturnType<typeof remoteTimeline>>();
    const getProjectTimeline = vi
      .fn()
      .mockReturnValueOnce(lateA.promise)
      .mockResolvedValueOnce(remoteTimeline(2, 0, projectB));
    openRemoteChanges(
      {
        listProjects: vi.fn().mockResolvedValue({
          request_id: "projects",
          data: [
            {
              id: remoteProjectId,
              name: "项目 A",
              status: "active",
              revision: 1,
              updated_at: "2026-09-14T00:00:00Z",
            },
            {
              id: projectB,
              name: "项目 B",
              status: "active",
              revision: 1,
              updated_at: "2026-09-14T00:00:00Z",
            },
          ],
        }),
        getProjectTimeline,
      },
      "assembly",
    );
    await waitFor(() => expect(getProjectTimeline).toHaveBeenCalledWith(remoteProjectId));
    fireEvent.click(screen.getByRole("button", { name: "打开第二项目" }));
    expect(await screen.findByText("修订版 2")).toBeInTheDocument();
    lateA.resolve(remoteTimeline(1));
    await Promise.resolve();
    expect(screen.getByText("修订版 2")).toBeInTheDocument();
  });

  it("navigates away from assembly without sending a timeline write", async () => {
    const trimTimelineClip = vi.fn();
    const reorderTimelineClip = vi.fn();
    const replaceTimelineClip = vi.fn();
    openRemoteChanges(
      {
        getProjectTimeline: vi.fn().mockResolvedValue(remoteTimeline()),
        trimTimelineClip,
        reorderTimelineClip,
        replaceTimelineClip,
      },
      "assembly",
    );
    await screen.findByText("修订版 1");
    fireEvent.click(screen.getByRole("button", { name: "声音与字幕" }));
    expect(trimTimelineClip).not.toHaveBeenCalled();
    expect(reorderTimelineClip).not.toHaveBeenCalled();
    expect(replaceTimelineClip).not.toHaveBeenCalled();
  });
});
