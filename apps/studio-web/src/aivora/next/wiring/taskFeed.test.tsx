import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskItem, TaskListener } from "@aijian/contracts/task-progress";
import { beginTaskBatch, runTask } from "../../film/task-progress";
import { novelProject } from "../adapters/novelProject";
import { feedProgress, namedTasks, useTaskFeed } from "./taskFeed";

function Probe() {
  const feed = useTaskFeed();
  return (
    <p>
      {feed.tasks.map((task) => `${task.id}:${task.status}`).join(" ")}|
      {feed.batches.map((batch) => `${batch.label} ${batch.done}/${batch.total}`).join(" ")}
    </p>
  );
}

const row = (over: Partial<TaskItem> & Pick<TaskItem, "id">): TaskItem => ({
  kind: "video",
  status: "queued",
  attempt: 1,
  ...over,
});

afterEach(() => {
  delete window.aijian;
});

describe("useTaskFeed", () => {
  it("listens to the desktop app when it is there, and stops when the page goes", () => {
    let send: TaskListener = () => {};
    const stop = vi.fn();
    window.aijian = {
      onTask: (listener: TaskListener) => {
        send = listener;
        return stop;
      },
    } as unknown as Window["aijian"];
    const { unmount } = render(<Probe />);
    act(() => send([row({ id: "job-1", status: "running" })], []));
    expect(screen.getByText(/job-1:running/)).toBeInTheDocument();
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("reads the page's own list in a plain browser", async () => {
    render(<Probe />);
    let release = () => {};
    await act(async () => {
      beginTaskBatch({ projectId: "film-a", batchId: "b1", label: "定妆照", total: 1 });
      void runTask(
        { id: "portrait-1", projectId: "film-a", kind: "image", batchId: "b1" },
        () => new Promise<void>((resolve) => (release = resolve)),
      );
    });
    expect(screen.getByText(/portrait-1:running/)).toBeInTheDocument();
    await act(async () => release());
    expect(screen.getByText(/portrait-1:done\|定妆照 1\/1/)).toBeInTheDocument();
  });
});

describe("namedTasks and feedProgress", () => {
  it("names a shot's job by scene and shot number and leaves the others alone", () => {
    const film = novelProject();
    const named = namedTasks(
      [
        row({ id: "job-1", shotId: "scene-2-shot-6", title: "生成视频" }),
        row({ id: "portrait-1", kind: "image", title: "林晚 · 正面" }),
        row({ id: "job-2", shotId: "gone" }),
      ],
      film,
    );
    expect(named.map((task) => task.title)).toEqual([
      "第 2 场第 6 个镜头",
      "林晚 · 正面",
      undefined,
    ]);
    expect(namedTasks([row({ id: "job-1", shotId: "scene-1-shot-1" })], null)[0]?.title).toBe(
      undefined,
    );
  });

  it("counts the jobs still going and the share that ended", () => {
    expect(feedProgress({ tasks: [], batches: [] })).toEqual({ active: 0, percent: 0 });
    expect(
      feedProgress({
        tasks: [
          row({ id: "a", status: "done" }),
          row({ id: "b", status: "failed" }),
          row({ id: "c", status: "running" }),
          row({ id: "d" }),
        ],
        batches: [],
      }),
    ).toEqual({ active: 2, percent: 50 });
  });
});
