import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TaskQueueResponse } from "../api/studio";
import { matchesFilter, type QueueFilter, type QueueState } from "./task-queue-model";

interface TaskQueueTransport {
  projectId: string;
  loadTasks(projectId: string): Promise<TaskQueueResponse>;
}

export function useTaskQueue({ projectId, loadTasks }: TaskQueueTransport) {
  const [storedState, setStoredState] = useState<{ projectId: string; state: QueueState }>({
    projectId,
    state: { kind: "idle" },
  });
  const [filter, setFilter] = useState<QueueFilter>("all");
  const requestSequence = useRef(0);
  const activeProjectId = useRef(projectId);

  // A project change is visible before effects run. Invalidate the previous
  // project's request in render so a committed B view cannot expose A's queue.
  if (activeProjectId.current !== projectId) {
    activeProjectId.current = projectId;
    requestSequence.current += 1;
  }

  const reload = useCallback(async () => {
    if (!projectId) {
      requestSequence.current += 1;
      setStoredState({ projectId, state: { kind: "idle" } });
      return;
    }
    const requestId = ++requestSequence.current;
    setStoredState({ projectId, state: { kind: "loading" } });
    try {
      const response = await loadTasks(projectId);
      if (requestSequence.current !== requestId || activeProjectId.current !== projectId) return;
      if (response.data.project_id !== projectId) {
        setStoredState({ projectId, state: { kind: "error" } });
        return;
      }
      setStoredState({ projectId, state: { kind: "ready", response } });
    } catch {
      if (requestSequence.current === requestId && activeProjectId.current === projectId) {
        setStoredState({ projectId, state: { kind: "error" } });
      }
    }
  }, [loadTasks, projectId]);

  useEffect(() => {
    void reload();
    return () => {
      requestSequence.current += 1;
    };
  }, [reload]);

  const state =
    storedState.projectId === projectId
      ? storedState.state
      : projectId
        ? ({ kind: "loading" } as const)
        : ({ kind: "idle" } as const);

  const visibleTasks = useMemo(
    () =>
      state.kind === "ready"
        ? state.response.data.tasks.filter((item) => matchesFilter(item, filter))
        : [],
    [filter, state],
  );

  return { state, filter, setFilter, reload, visibleTasks };
}
