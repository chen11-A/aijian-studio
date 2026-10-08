import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useTaskQueue } from "./use-task-queue";

const projectId = "prj_test";
const task = (status: string, id = "task_1") => ({
  task: { task_id: id, status },
  node: {},
  attempt: { status: "LEASED" },
  cost: {},
  presentation: {},
});
const response = (tasks: Array<ReturnType<typeof task>>, responseProjectId = projectId) => ({
  data: {
    project_id: responseProjectId,
    summary: {
      total: tasks.length,
      active: tasks.filter((x) => x.task.status === "LEASED").length,
      attention: 0,
      completed: 0,
    },
    tasks,
  },
  request_id: "req_test",
});

describe("useTaskQueue", () => {
  test("retries a failed read and filters the loaded queue", async () => {
    const loadTasks = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response([task("LEASED")]));
    const { result } = renderHook(() => useTaskQueue({ projectId, loadTasks }));
    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    await act(async () => {
      await result.current.reload();
    });
    expect(loadTasks).toHaveBeenNthCalledWith(1, projectId);
    expect(loadTasks).toHaveBeenNthCalledWith(2, projectId);
    act(() => result.current.setFilter("active"));
    expect(result.current.visibleTasks).toHaveLength(1);
    act(() => result.current.setFilter("attention"));
    expect(result.current.visibleTasks).toHaveLength(0);
  });

  test("ignores an expired task response after a newer reload completes", async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    const old = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveOld = resolve;
    });
    const fresh = response([task("LEASED", "task_fresh")]);
    const loadTasks = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(fresh);
    const { result } = renderHook(() => useTaskQueue({ projectId, loadTasks }));
    await act(async () => {
      await result.current.reload();
    });
    await act(async () => {
      resolveOld(response([task("LEASED", "task_old")]));
    });
    await waitFor(() => expect(result.current.state).toEqual({ kind: "ready", response: fresh }));
  });

  test("does not read a queue without a project, including an explicit reload", async () => {
    const loadTasks = vi.fn();
    const { result } = renderHook(() => useTaskQueue({ projectId: "", loadTasks }));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.state).toEqual({ kind: "idle" });
    expect(loadTasks).not.toHaveBeenCalled();
  });

  test("synchronously isolates project B from A and drops A's late response", async () => {
    const projectA = "prj_a";
    const projectB = "prj_b";
    let resolveA!: (value: ReturnType<typeof response>) => void;
    let resolveB!: (value: ReturnType<typeof response>) => void;
    const pendingA = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveA = resolve;
    });
    const pendingB = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveB = resolve;
    });
    const loadTasks = vi.fn();
    loadTasks.mockImplementation((id: string) => (id === projectA ? pendingA : pendingB));
    const { result, rerender } = renderHook(
      ({ id }) => useTaskQueue({ projectId: id, loadTasks }),
      { initialProps: { id: projectA } },
    );
    await waitFor(() => expect(loadTasks).toHaveBeenCalledWith(projectA));
    rerender({ id: projectB });
    expect(result.current.state).toEqual({ kind: "loading" });
    await waitFor(() => expect(loadTasks).toHaveBeenCalledWith(projectB));
    await act(async () => {
      resolveA(response([task("LEASED", "task_a")], projectA));
    });
    expect(result.current.state).toEqual({ kind: "loading" });
    const freshB = response([task("LEASED", "task_b")], projectB);
    await act(async () => {
      resolveB(freshB);
    });
    await waitFor(() => expect(result.current.state).toEqual({ kind: "ready", response: freshB }));
  });

  test("rejects a response whose project identity does not match the requested project", async () => {
    const loadTasks = vi.fn().mockResolvedValue(response([task("LEASED")], "prj_other"));
    const { result } = renderHook(() => useTaskQueue({ projectId, loadTasks }));
    await waitFor(() => expect(result.current.state).toEqual({ kind: "error" }));
  });
});
