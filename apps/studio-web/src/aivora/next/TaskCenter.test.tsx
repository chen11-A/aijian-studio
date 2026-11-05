import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { primaryAction, TaskCenter, taskLabel, unitFor, type TaskItem } from "./TaskCenter";

const task = (over: Partial<TaskItem> & Pick<TaskItem, "id">): TaskItem => ({
  kind: "video",
  status: "done",
  attempt: 1,
  ...over,
});

const TASKS: TaskItem[] = [
  task({ id: "scene-1-shot-1-take-1", shotId: "scene-1-shot-1", version: "A 版" }),
  task({
    id: "scene-2-shot-21-take-1",
    shotId: "scene-2-shot-21",
    version: "A 版",
    status: "failed",
    attempt: 2,
    reason: "等了 10 分钟没有结果",
  }),
  task({
    id: "scene-2-shot-22-take-1",
    shotId: "scene-2-shot-22",
    version: "A 版",
    status: "failed",
    reason: "Grok 没有接受这段描述",
    suggestion: "刀从袖子上擦过，不拍伤口。",
  }),
  task({
    id: "scene-2-shot-23-take-1",
    shotId: "scene-2-shot-23",
    version: "A 版",
    status: "uncertain",
  }),
  task({
    id: "scene-2-shot-23-take-2",
    shotId: "scene-2-shot-23",
    version: "B 版",
    status: "uncertain",
  }),
  task({
    id: "scene-2-shot-24-take-1",
    shotId: "scene-2-shot-24",
    version: "A 版",
    status: "queued",
  }),
  task({ id: "image-asset-1", title: "林晚 · 脸部定妆照", kind: "image" }),
  task({ id: "scene-1-shot-5-voice-1", shotId: "scene-1-shot-5", version: "配音", kind: "voice" }),
];

const CHECKED = TASKS.map((row) =>
  row.id === "scene-2-shot-23-take-1"
    ? { ...row, status: "done" as const }
    : row.id === "scene-2-shot-23-take-2"
      ? { ...row, status: "requeued" as const }
      : row,
);

const primaries = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLButtonElement>(".nx-btn.nx-primary"),
];

describe("TaskCenter", () => {
  it("asks to look up the unfinished jobs first, with one blue button", () => {
    const onCheck = vi.fn();
    const { container } = render(
      <TaskCenter
        title="第 1 集"
        tasks={TASKS}
        recovery={{ phase: "needs-check" }}
        onCheck={onCheck}
      />,
    );
    const banner = screen.getByRole("alert", { name: "意外关闭后接着做" });
    expect(banner).toHaveTextContent("做好的 1 段视频都在，没有丢");
    expect(banner).toHaveTextContent("关闭时有 2 段正在生成");
    expect(banner).toHaveTextContent("排队的 1 段还没发出去");
    expect(primaries(container).map((button) => button.textContent)).toEqual(["查一下，再接着做"]);
    fireEvent.click(screen.getByRole("button", { name: "查一下，再接着做" }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(screen.getByText("排队已暂停，等你确认")).toBeInTheDocument();
  });

  it("keeps the one button disabled while looking", () => {
    const { container } = render(
      <TaskCenter
        title="第 1 集"
        tasks={TASKS}
        recovery={{ phase: "checking" }}
        onCheck={vi.fn()}
      />,
    );
    const buttons = primaries(container);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("正在查…");
    expect(buttons[0]).toBeDisabled();
    expect(screen.getByText("正在查关闭时没做完的 2 段…")).toBeInTheDocument();
  });

  it("turns into 接着做 N 段 after the lookup", () => {
    const onResume = vi.fn();
    const { container } = render(
      <TaskCenter
        title="第 1 集"
        tasks={CHECKED}
        recovery={{ phase: "checked", found: 1, lost: 1 }}
        onResume={onResume}
      />,
    );
    expect(screen.getByRole("status", { name: "意外关闭后接着做" })).toHaveTextContent(
      "查完了：找回 1 段，1 段没发出去。没发出去的会重新排进队里，用 1 段视频额度。另外 2 段失败的在下面，等你处理。",
    );
    expect(primaries(container).map((button) => button.textContent)).toEqual(["接着做 2 段"]);
    fireEvent.click(screen.getByRole("button", { name: "接着做 2 段" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("says nothing more when the lookup found everything", () => {
    render(
      <TaskCenter
        title="第 1 集"
        tasks={CHECKED.filter((row) => row.status !== "failed" && row.status !== "requeued")}
        recovery={{ phase: "checked" }}
      />,
    );
    expect(screen.getByText("查完了：找回 0 段，0 段没发出去。")).toBeInTheDocument();
  });

  it("puts 接着做 in the summary when the queue is paused without a crash", () => {
    const { container } = render(
      <TaskCenter title="第 1 集" tasks={CHECKED} paused onResume={vi.fn()} />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(primaries(container).map((button) => button.textContent)).toEqual(["接着做 2 段"]);
  });

  it("has no blue button while jobs are running, only 全部暂停", () => {
    const onPause = vi.fn();
    const running = TASKS.map((row) =>
      row.status === "uncertain" ? { ...row, status: "running" as const, waitedSeconds: 30 } : row,
    );
    const { container } = render(<TaskCenter title="第 1 集" tasks={running} onPause={onPause} />);
    expect(primaries(container)).toHaveLength(0);
    expect(screen.getByText("正在生成 2 个")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部暂停" }));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/已经等了 30 秒/).length).toBeGreaterThan(0);
  });

  it("names shots in words and keeps the job id as small text", () => {
    render(<TaskCenter title="第 1 集" tasks={TASKS} />);
    const row = screen.getByRole("button", { name: /第 2 场第 22 个镜头 · A 版/ });
    expect(within(row).getByText("scene-2-shot-22-take-1")).toHaveClass("nx-code");
  });

  it("filters by status and by kind", () => {
    render(<TaskCenter title="第 1 集" tasks={TASKS} />);
    const list = screen.getByRole("region", { name: "任务列表" });
    expect(within(list).getByText("点左边的「做好了」看全部。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^要你处理/ }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /^做好了/ }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /^图片/ }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("林晚 · 脸部定妆照")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^正在生成/ }));
    expect(within(list).getByText("这个筛选下没有任务。")).toBeInTheDocument();
  });

  it("runs the one action on each row", () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    render(<TaskCenter title="第 1 集" tasks={TASKS} onRetry={onRetry} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "再试一次" }));
    expect(onRetry).toHaveBeenCalledWith("scene-2-shot-21-take-1", "same");
    fireEvent.click(screen.getByRole("button", { name: "改描述再试" }));
    expect(onRetry).toHaveBeenCalledWith("scene-2-shot-22-take-1", "suggestion");
    const queued = screen.getByRole("button", { name: /第 2 场第 24 个镜头/ }).closest("li");
    fireEvent.click(within(queued!).getByRole("button", { name: "移出队列" }));
    expect(onRemove).toHaveBeenCalledWith("scene-2-shot-24-take-1");
  });

  it("shows the selected job with what went wrong and how to retry", () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    render(<TaskCenter title="第 1 集" tasks={TASKS} onRetry={onRetry} onRemove={onRemove} />);
    const detail = screen.getByRole("complementary", { name: "任务详情" });
    expect(detail).toHaveTextContent("第 2 场第 21 个镜头 · A 版");
    expect(detail).toHaveTextContent("再试会用 1 段视频额度");
    fireEvent.click(screen.getByRole("button", { name: /第 2 场第 22 个镜头 · A 版/ }));
    expect(within(detail).getByText("可以这样改")).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "用这句描述再试" }));
    expect(onRetry).toHaveBeenLastCalledWith("scene-2-shot-22-take-1", "suggestion");
    fireEvent.click(within(detail).getByRole("button", { name: "按原样再试" }));
    expect(onRetry).toHaveBeenLastCalledWith("scene-2-shot-22-take-1", "same");
    fireEvent.click(screen.getByRole("button", { name: /第 2 场第 24 个镜头/ }));
    fireEvent.click(within(detail).getByRole("button", { name: "移出队列" }));
    expect(onRemove).toHaveBeenCalledWith("scene-2-shot-24-take-1");
    fireEvent.click(screen.getByRole("button", { name: /^做好了/ }));
    fireEvent.click(screen.getByRole("button", { name: /林晚 · 脸部定妆照/ }));
    expect(detail).toHaveTextContent("已经存进作品");
  });

  it("offers to retry every failed job at once", () => {
    const onRetryFailed = vi.fn();
    render(<TaskCenter title="第 1 集" tasks={TASKS} onRetryFailed={onRetryFailed} />);
    fireEvent.click(screen.getByRole("button", { name: "失败的全部重试（2）" }));
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
    expect(screen.getByText("图片 1/1 · 配音 1/1")).toBeInTheDocument();
  });

  it("shows a reload button as the only blue one when the record cannot be read", () => {
    const onReload = vi.fn();
    const { container } = render(
      <TaskCenter title="第 1 集" tasks={[]} error="记录打不开。" onReload={onReload} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("任务记录读不出来");
    expect(primaries(container)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("explains where jobs come from when there are none", () => {
    const onOpenStoryboard = vi.fn();
    const { container, rerender } = render(
      <TaskCenter title="第 1 集" tasks={[]} onOpenStoryboard={onOpenStoryboard} />,
    );
    expect(screen.getByText("现在没有任务")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "去分镜" }));
    expect(onOpenStoryboard).toHaveBeenCalledTimes(1);
    rerender(<TaskCenter title="第 1 集" tasks={[]} />);
    expect(primaries(container)).toHaveLength(0);
  });

  it("shows placeholders while the record loads", () => {
    render(<TaskCenter title="第 1 集" tasks={TASKS} loading />);
    expect(screen.getByText("正在读取任务记录…")).toBeInTheDocument();
    expect(screen.getByText("点左边的一条，看它的详情。")).toBeInTheDocument();
  });

  it("shows a quiet summary when everything is done", () => {
    const done = TASKS.map((row) => ({ ...row, status: "done" as const }));
    render(<TaskCenter title="第 1 集" tasks={done} />);
    expect(screen.getByText("全部做好了")).toBeInTheDocument();
    render(
      <TaskCenter title="只有图片" tasks={[task({ id: "x", kind: "image", status: "queued" })]} />,
    );
    expect(screen.getByText("等着开始")).toBeInTheDocument();
    expect(screen.getAllByText("一共 1 张").length).toBe(1);
  });
});

describe("task helpers", () => {
  it("picks a unit for a set of jobs", () => {
    expect(unitFor([task({ id: "a" })])).toBe("段");
    expect(unitFor([task({ id: "a", kind: "image" })])).toBe("张");
    expect(unitFor([task({ id: "a", kind: "voice" })])).toBe("句");
    expect(unitFor([task({ id: "a" }), task({ id: "b", kind: "voice" })])).toBe("个");
    expect(unitFor([])).toBe("个");
  });

  it("names a job by shot, title or id", () => {
    expect(taskLabel(task({ id: "x", shotId: "scene-3-shot-6", version: "B 版" }))).toBe(
      "第 3 场第 6 个镜头 · B 版",
    );
    expect(taskLabel(task({ id: "x", title: "诗集 · 道具图" }))).toBe("诗集 · 道具图");
    expect(taskLabel(task({ id: "job-9" }))).toBe("job-9");
  });

  it("has no blue button while loading", () => {
    expect(primaryAction({ tasks: TASKS, loading: true, recovery: { phase: "needs-check" } })).toBe(
      null,
    );
    expect(primaryAction({ tasks: TASKS })).toBeNull();
  });
});

describe("jobs that were never sent", () => {
  const blocked = task({
    id: "scene-1-shot-2-video-1",
    shotId: "scene-1-shot-2",
    title: "第 1 场第 2 个镜头",
    version: "版本 1",
    status: "blocked",
    reason: "请打开安装好的 AIVORA，并打开一部作品，再生成。",
  });

  it("puts them under 要你处理 with their reason and a way to try again", () => {
    const onRetry = vi.fn();
    render(<TaskCenter title="雨夜旧书店 · 第 1 集" tasks={[blocked]} onRetry={onRetry} />);
    const attention = screen.getByRole("region", { name: "要你处理" });
    const row = within(attention).getByRole("listitem");
    expect(within(row).getByText("没发出去")).toBeInTheDocument();
    expect(
      within(row).getByText("请打开安装好的 AIVORA，并打开一部作品，再生成。"),
    ).toBeInTheDocument();
    expect(within(row).queryByText(/第 1 次/)).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "再试一次" }));
    expect(onRetry).toHaveBeenLastCalledWith("scene-1-shot-2-video-1", "same");
    const detail = screen.getByRole("complementary", { name: "任务详情" });
    expect(within(detail).getByText(/视频 · 没有发出去/)).toBeInTheDocument();
    expect(within(detail).getByText("这一次没有发给 Grok，没有用额度。")).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "按原样再试" }));
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/要你处理 1 段/)).toBeInTheDocument();
  });

  it("says nothing was sent when no reason is given, and offers no retry without a handler", () => {
    render(<TaskCenter title="作品" tasks={[{ ...blocked, reason: undefined }]} />);
    const row = within(screen.getByRole("region", { name: "要你处理" })).getByRole("listitem");
    expect(within(row).getByText("没有发给 Grok")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "再试一次" })).toBeNull();
  });
});

describe("task names", () => {
  it("uses the title the caller worked out before the shot id", () => {
    expect(taskLabel(task({ id: "x", shotId: "02-shot-1", title: "第 2 场第 1 个镜头" }))).toBe(
      "第 2 场第 1 个镜头",
    );
    expect(taskLabel(task({ id: "x", shotId: "scene-2-shot-3", version: "第 2 版" }))).toBe(
      "第 2 场第 3 个镜头 · 第 2 版",
    );
    expect(taskLabel(task({ id: "job-7" }))).toBe("job-7");
  });
});

describe("lip-sync and export tasks", () => {
  it("names them and lists their filters only when there are some", () => {
    const { rerender } = render(<TaskCenter title="作品" tasks={TASKS} />);
    const filters = screen.getByRole("navigation", { name: "筛选任务" });
    expect(within(filters).queryByRole("button", { name: /口型/ })).toBeNull();
    expect(within(filters).queryByRole("button", { name: /导出/ })).toBeNull();
    rerender(
      <TaskCenter
        title="作品"
        tasks={[
          ...TASKS,
          task({ id: "lip-1", title: "第 2 场第 3 个镜头", kind: "lipsync", status: "running" }),
          task({ id: "export-1", title: "雨夜旧书店-第1集.mp4", kind: "export", status: "done" }),
        ]}
      />,
    );
    fireEvent.click(within(filters).getByRole("button", { name: /口型/ }));
    const list = screen.getByRole("region", { name: "任务列表" });
    expect(within(list).getByText("第 2 场第 3 个镜头")).toBeInTheDocument();
    expect(within(list).getByText("口")).toBeInTheDocument();
    expect(screen.getByText(/口型 0\/1/)).toBeInTheDocument();
    expect(screen.getByText(/导出 1\/1/)).toBeInTheDocument();
  });
});

describe("what the host can and cannot do with each job", () => {
  const rows: TaskItem[] = [
    task({ id: "video-1", title: "第 1 场第 1 个镜头", status: "failed", reason: "没有生成成功" }),
    task({ id: "portrait-1", title: "林晚 · 正面", kind: "image", status: "failed" }),
    task({ id: "video-2", title: "第 1 场第 2 个镜头", status: "running" }),
    task({ id: "video-3", title: "第 1 场第 3 个镜头", status: "queued" }),
  ];

  it("offers retry and stop only on the jobs the host can act on", () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    render(
      <TaskCenter
        title="晚照书店"
        tasks={rows}
        onRetry={onRetry}
        canRetry={(row) => row.kind === "video"}
        onRemove={onRemove}
        canRemove={(row) => row.id !== "video-3"}
      />,
    );
    const list = screen.getByRole("region", { name: "任务列表" });
    const rowOf = (name: string) => within(list).getByText(name).closest("li") as HTMLElement;
    fireEvent.click(within(rowOf("第 1 场第 1 个镜头")).getByRole("button", { name: "再试一次" }));
    expect(onRetry).toHaveBeenCalledWith("video-1", "same");
    expect(within(rowOf("林晚 · 正面")).queryByRole("button", { name: "再试一次" })).toBeNull();
    fireEvent.click(
      within(rowOf("第 1 场第 2 个镜头")).getByRole("button", { name: "停下这一次" }),
    );
    expect(onRemove).toHaveBeenCalledWith("video-2");
    expect(within(rowOf("第 1 场第 3 个镜头")).queryByRole("button")).toHaveAttribute(
      "aria-pressed",
    );
  });

  it("makes 失败的全部重试 the one blue button when nothing else needs deciding", () => {
    const onRetryFailed = vi.fn();
    render(<TaskCenter title="晚照书店" tasks={rows} onRetryFailed={onRetryFailed} />);
    const blue = document.querySelectorAll(".nx-primary");
    expect(blue).toHaveLength(1);
    expect(blue[0]).toHaveTextContent("失败的全部重试（2）");
    fireEvent.click(blue[0]!);
    expect(onRetryFailed).toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /失败的全部重试/ })).toHaveLength(1);
  });

  it("says 继续排队 when resuming only lifts the pause", () => {
    expect(
      primaryAction({ tasks: rows, paused: true, resumeLabel: "继续排队", onResume: () => {} })
        ?.label,
    ).toBe("继续排队");
  });
});

it("counts only actionable failures in bulk retry and hides an unsupported bulk action", () => {
  const tasks = [
    task({ id: "video", status: "failed" }),
    task({ id: "portrait", kind: "image", status: "failed" }),
  ];
  const retry = vi.fn();
  const view = render(
    <TaskCenter
      title="作品"
      tasks={tasks}
      onRetryFailed={retry}
      canRetry={(item) => item.id === "video"}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "失败的全部重试（1）" }));
  expect(retry).toHaveBeenCalledTimes(1);
  view.rerender(
    <TaskCenter title="作品" tasks={tasks} onRetryFailed={retry} canRetry={() => false} />,
  );
  expect(screen.queryByRole("button", { name: /失败的全部重试/ })).not.toBeInTheDocument();
});

describe("4A-U04: right click and stages", () => {
  const failed = task({ id: "s2-6-a", shotId: "s2-6", status: "failed", reason: "超时" });
  const running = task({ id: "s2-7-a", shotId: "s2-7", status: "running" });
  const queued = task({ id: "s2-8-a", shotId: "s2-8", status: "queued" });

  it("offers 重试 / 看详情 on a failed task and 停止 on a running one, each doing that", () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    render(
      <TaskCenter
        title="作品"
        tasks={[failed, running, queued]}
        onRetry={onRetry}
        onRemove={onRemove}
        canRemove={(item) => item.status === "running" || item.status === "queued"}
      />,
    );
    const rowOf = (id: string) =>
      [...document.querySelectorAll<HTMLElement>(".nx-job")].find((row) =>
        row.textContent?.includes(id),
      )!;
    fireEvent.contextMenu(rowOf("s2-6-a"), { clientX: 20, clientY: 10 });
    let menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["重试", "看详情"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledWith("s2-6-a", "same");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(rowOf("s2-7-a"));
    menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "停止" }));
    expect(onRemove).toHaveBeenCalledWith("s2-7-a");

    fireEvent.contextMenu(rowOf("s2-8-a"));
    expect(screen.getByRole("menuitem", { name: "移出队列" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(rowOf("s2-6-a"));
    fireEvent.click(screen.getByRole("menuitem", { name: "看详情" }));
    const detail = screen.getByRole("complementary", { name: "任务详情" });
    const stages = within(detail).getByRole("list", { name: "进度" });
    const items = within(stages).getAllByRole("listitem");
    expect(items.map((item) => item.dataset.state)).toEqual(["done", "done", "stopped", "later"]);
    expect(items[2]).toHaveTextContent("生成没做成");
  });

  it("marks a finished task done at every stage, and a blocked one as never sent", () => {
    // With one task, the detail shows it without a click.
    const { rerender } = render(<TaskCenter title="作品" tasks={[task({ id: "d1" })]} />);
    const stateOf = () =>
      within(screen.getByRole("list", { name: "进度" }))
        .getAllByRole("listitem")
        .map((item) => item.dataset.state);
    expect(stateOf()).toEqual(["done", "done", "done", "done"]);
    rerender(<TaskCenter title="作品" tasks={[task({ id: "d1", status: "blocked" })]} />);
    expect(stateOf()).toEqual(["stopped", "later", "later", "later"]);
    expect(screen.getByRole("list", { name: "进度" })).toHaveTextContent("没有发出去");
  });
});
