import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskCenter } from "../TaskCenter";
import { SAMPLE_PROJECT, sampleProjectJson } from "./sampleProject";
import { taskCenterData, type TaskCenterOptions } from "./taskCenter";

function data(value: unknown = sampleProjectJson(), options: TaskCenterOptions = {}) {
  const adapted = taskCenterData(value, options);
  if (!adapted.ok) throw new Error("taskCenterData always gives props");
  return adapted.props;
}

const byId = (props: ReturnType<typeof data>, id: string) =>
  props.tasks.find((task) => task.id === id);

describe("taskCenterData", () => {
  it("lists every video take in shot order and leaves cancelled ones out", () => {
    const props = data();
    expect(props.title).toBe("雨夜旧书店 · 第 1 集");
    expect(props.tasks.map((task) => `${task.id}:${task.status}`)).toEqual([
      "s1-1-t1:done",
      "s1-1-t2:done",
      "s1-2-t1:done",
      "s1-3-t1:failed",
      "s2-1-t1:done",
      "s2-1-t2:done",
      "s2-1-t3:failed",
      "s2-2-t1:running",
      "s3-1-t1:queued",
      "scene-2-shot-3-video-1:blocked",
    ]);
    expect(byId(props, "s1-1-t2")).toEqual({
      id: "s1-1-t2",
      shotId: "scene-1-shot-1",
      title: "第 1 场第 1 个镜头",
      version: "第 2 版",
      kind: "video",
      status: "done",
      attempt: 2,
    });
    expect(byId(props, "s2-1-t3")?.reason).toContain("Grok 没有接受这段描述");
    expect(byId(props, "s3-1-t1")?.reason).toBe("已暂停。点继续再生成剩下的。");
    expect(byId(props, "scene-2-shot-3-video-1")).toMatchObject({
      title: "第 2 场第 3 个镜头",
      version: "版本 1",
      status: "blocked",
      reason: "请打开安装好的 AIVORA，并打开一部作品，再生成。网页里不能直接出片。",
    });
    expect(props.recovery).toBeNull();
    expect(props.paused).toBe(false);
  });

  it("keeps the app's 已中断 mark as a failure until the host can look the take up", () => {
    expect(byId(data(), "s1-3-t1")).toMatchObject({
      status: "failed",
      reason: "已中断，可以重试。",
    });
    const props = data(sampleProjectJson(), { canLookUp: true });
    expect(byId(props, "s1-3-t1")?.status).toBe("uncertain");
    expect(byId(props, "s1-3-t1")?.reason).toBeUndefined();
    expect(props.recovery).toEqual({ phase: "needs-check" });
  });

  it("treats a take saved as running as unknown when the file comes from disk", () => {
    expect(byId(data(sampleProjectJson(), { fromDisk: true }), "s2-2-t1")).toMatchObject({
      status: "failed",
      reason: "软件关掉时还在生成，不知道有没有做完。",
    });
    const props = data(sampleProjectJson(), { fromDisk: true, canLookUp: true, paused: true });
    expect(byId(props, "s2-2-t1")?.status).toBe("uncertain");
    expect(props.paused).toBe(true);
  });

  it("counts the wait from when the take was made", () => {
    const now = Date.parse("2026-11-04T08:00:48.000Z");
    expect(byId(data(sampleProjectJson(), { now }), "s2-2-t1")?.waitedSeconds).toBe(48);
    expect(byId(data(), "s2-2-t1")?.waitedSeconds).toBeUndefined();
    const undated = JSON.parse(JSON.stringify(SAMPLE_PROJECT)) as typeof SAMPLE_PROJECT;
    undated.shots[4]!.takes[0]!.createdAt = "";
    expect(byId(data(undated, { now }), "s2-2-t1")?.waitedSeconds).toBeUndefined();
  });

  it("lists picture jobs, which have no takes, and numbers takes that lost their index", () => {
    const value = {
      title: "",
      seriesTitle: "",
      episodeTitle: "",
      shots: [{ id: "a", sceneId: "", no: 1, takes: [{ id: "a-t", status: "failed" }] }],
      jobs: [
        { id: "p1", shotId: "", kind: "portrait", take: null, status: "done", reason: "好了" },
        { id: "p2", shotId: "a", kind: "keyframe", take: 2, status: "running", reason: "" },
        { id: "p3", shotId: "a", kind: "keyframe", take: 1, status: "failed", reason: "已中断" },
        { id: "p4", shotId: "a", kind: "portrait", take: 1, status: "cancelled", reason: "" },
        { id: "v1", shotId: "a", kind: "video", take: 1, status: "done", reason: "" },
      ],
    };
    const props = data(value, { fromDisk: true });
    expect(props.title).toBe("这一集");
    expect(props.tasks).toEqual([
      {
        id: "a-t",
        shotId: "a",
        title: "镜头 1",
        version: "第 1 版",
        kind: "video",
        status: "failed",
        attempt: 1,
      },
      { id: "p1", title: "p1", kind: "image", status: "done", attempt: 1 },
      {
        id: "p2",
        shotId: "a",
        title: "镜头 1",
        version: "版本 2",
        kind: "image",
        status: "failed",
        attempt: 2,
        reason: "软件关掉时还在生成，不知道有没有做完。",
      },
      {
        id: "p3",
        shotId: "a",
        title: "镜头 1",
        version: "版本 1",
        kind: "image",
        status: "failed",
        attempt: 1,
        reason: "已中断",
      },
    ]);
    const live = data(value, { canLookUp: true });
    expect(live.tasks.map((task) => task.status)).toEqual([
      "failed",
      "done",
      "running",
      "uncertain",
    ]);
    expect(live.recovery).toEqual({ phase: "needs-check" });
  });

  it("shows the reason instead of a list when project.json cannot be read", () => {
    expect(taskCenterData(null)).toEqual({
      ok: true,
      props: { title: "这一集", tasks: [], error: "作品记录不是一份完整的作品，读不出来。" },
      missing: [],
    });
  });

  it("gives TaskCenter what it needs to draw the list", () => {
    render(<TaskCenter {...data()} />);
    const attention = screen.getByRole("region", { name: "要你处理" });
    expect(within(attention).getAllByRole("listitem")).toHaveLength(3);
    expect(within(attention).getByText("没发出去")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "正在生成" })).toHaveTextContent(
      "第 2 场第 2 个镜头",
    );
    expect(screen.getByText("雨夜旧书店 · 第 1 集")).toBeInTheDocument();
  });
});
