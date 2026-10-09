import { useEffect, useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import type { FakeTimelineDevelopmentScope } from "../fake-timeline-run-development";
import { Button } from "./Common";
import { useDemo } from "./model";
import {
  createDevelopmentFakeTimelineAdapter,
  DEVELOPMENT_FAKE_TIMELINE_LABEL,
} from "./adapters/developmentFakeTimeline";
import type { DevelopmentFakeTimelineRecoveryState } from "./adapters/developmentFakeTimeline";

function journalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function DevelopmentMediaPanel() {
  const d = useDemo();
  const projectId = d.backendProjectId;
  const transport = useMemo(createStudioTransport, []);
  const storage = useMemo(journalStorage, []);
  const adapter = useMemo(
    () =>
      transport.fakeTimelineRuns && storage
        ? createDevelopmentFakeTimelineAdapter(
            {
              getSourceManifest: transport.getSourceManifest,
              listProjectTasks: transport.listProjectTasks,
              getProjectTimeline: transport.getProjectTimeline,
              fakeTimelineRuns: transport.fakeTimelineRuns,
            },
            storage,
          )
        : null,
    [transport, storage],
  );
  const requestEpoch = useRef(0);
  const observedProject = useRef(projectId);
  if (observedProject.current !== projectId) {
    observedProject.current = projectId;
    requestEpoch.current += 1;
  }
  const activeProject = useRef(projectId);
  activeProject.current = projectId;
  const [scope, setScope] = useState<FakeTimelineDevelopmentScope | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [recovery, setRecovery] = useState<DevelopmentFakeTimelineRecoveryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    requestEpoch.current += 1;
    activeProject.current = projectId;
    setBusy(false);
    setNotice("");
    setSourceId("");
    setTaskId("");
    if (!adapter || !projectId) {
      setScope(null);
      setRecovery(null);
      return;
    }
    const next = adapter.activate(projectId);
    setScope(next);
    setRecovery(adapter.readRecovery(next));
    return () => {
      activeProject.current = null;
      requestEpoch.current += 1;
      adapter.activate("");
    };
  }, [adapter, projectId]);

  const manifest = d.sourceManifest?.data.project_id === projectId ? d.sourceManifest : null;
  const documents = manifest?.data.accepted_version?.content.documents ?? [];
  const tasks =
    d.taskQueue.state.kind === "ready"
      ? d.taskQueue.state.response.data.tasks.filter(
          (item) =>
            item.task.kind === "local.timeline.assemble.fake.media.v1" &&
            item.attempt.execution_mode === "local",
        )
      : [];
  const pendingId =
    recovery?.kind === "pending" || recovery?.kind === "cleanup-pending"
      ? recovery.operation.operation_id
      : null;
  const recoveredTaskId =
    recovery?.kind === "recovered" || recovery?.kind === "cleanup-pending"
      ? recovery.association.task_id
      : null;
  const journalCorrupt =
    recovery?.kind === "journal-corrupt" || recovery?.kind === "recovery-corrupt";
  const canSubmit = recovery?.kind === "none" || recovery?.kind === "recovered";
  const selectedTaskId = taskId || recoveredTaskId || "";

  async function sourceForRequest(requestedProject: string, epoch: number) {
    if (!sourceId || requestEpoch.current !== epoch || activeProject.current !== requestedProject)
      return null;
    try {
      const source = await transport.getSource(requestedProject, sourceId);
      return requestEpoch.current === epoch &&
        activeProject.current === requestedProject &&
        source.data.project_id === requestedProject &&
        source.data.id === sourceId
        ? source
        : null;
    } catch {
      return null;
    }
  }

  async function prepare() {
    if (!adapter || !scope || !projectId || !sourceId || busy) return;
    const epoch = ++requestEpoch.current;
    setBusy(true);
    const source = await sourceForRequest(projectId, epoch);
    if (requestEpoch.current !== epoch || activeProject.current !== projectId) return;
    if (!source) {
      setBusy(false);
      setNotice("无法读取所选真实来源；没有提交任务。");
      return;
    }
    const result = await adapter.prepare(scope, { id: projectId }, source);
    if (requestEpoch.current !== epoch || activeProject.current !== projectId || !result.deliver)
      return;
    setBusy(false);
    setNotice(
      result.kind === "preflight"
        ? result.preflight.kind === "ready"
          ? "来源与已批准清单匹配；可明确提交本地 Fake 任务。"
          : `来源预检未通过：${result.preflight.reason}。`
        : "无法读取权威来源清单；没有提交任务。",
    );
  }

  async function submit() {
    if (!adapter || !scope || !projectId || !sourceId || busy || !canSubmit) return;
    const epoch = ++requestEpoch.current;
    setBusy(true);
    const source = await sourceForRequest(projectId, epoch);
    if (requestEpoch.current !== epoch || activeProject.current !== projectId) return;
    if (!source) {
      setBusy(false);
      setNotice("无法读取所选真实来源；没有提交任务。");
      return;
    }
    const result = await adapter.submit(scope, { id: projectId }, source);
    if (requestEpoch.current !== epoch || activeProject.current !== projectId || !result.deliver)
      return;
    setBusy(false);
    if (result.kind === "submission") {
      const submission = result.submission;
      setRecovery(adapter.readRecovery(scope));
      if (submission.kind === "SUCCEEDED") {
        setTaskId(submission.receipt.data.task_id);
        setNotice(
          `任务已受理，ID：${submission.receipt.data.task_id}。请查询任务与产物；尚未证明素材完成。`,
        );
        void d.taskQueue.reload();
      } else if (submission.kind === "REMOTE_UNKNOWN") {
        setNotice(
          `提交结果未知，操作 ID：${submission.operation_id}。只可查询原操作，不要重复 POST。`,
        );
      } else {
        setNotice(`任务未受理：${submission.code}；请核对来源和错误记录。`);
      }
    } else if (result.kind === "pending-operation") {
      setRecovery(adapter.readRecovery(scope));
      setNotice("已有结果未知的提交操作，已阻止重复 POST。请保留操作 ID 供核对。");
    } else if (result.kind === "preflight-unavailable") {
      setNotice(
        result.preflight.kind === "unavailable"
          ? `来源预检未通过：${result.preflight.reason}。`
          : "来源预检状态不一致；未提交任务。",
      );
    } else if (result.kind === "journal-corrupt") {
      setRecovery(adapter.readRecovery(scope));
      setNotice("本地任务操作记录损坏，已阻止提交。");
    } else {
      setNotice("任务提交不可用，未发起本地 Fake 任务。");
    }
  }

  async function recoverPending() {
    if (
      !adapter ||
      !scope ||
      !projectId ||
      busy ||
      (recovery?.kind !== "pending" && recovery?.kind !== "cleanup-pending")
    )
      return;
    const epoch = ++requestEpoch.current;
    setBusy(true);
    const result = await adapter.recoverPending(scope);
    if (requestEpoch.current !== epoch || activeProject.current !== projectId || !result.deliver)
      return;
    setBusy(false);
    setRecovery(adapter.readRecovery(scope));
    if (result.kind === "recovered") {
      setTaskId(result.association.task_id);
      setNotice(
        `已找回原提交关联任务 ${result.association.task_id}；仍需查询任务与时间线，不能视为素材完成。`,
      );
    } else if (result.kind === "cleanup-pending") {
      setTaskId(result.association.task_id);
      setNotice("原提交身份已核对，但本地锁清理未确认；保留锁，可再次明确查询原操作。");
    } else if (result.kind === "not-found") {
      setNotice("按原操作未找到权威回执；保留未知状态和本地锁，未再次提交。");
    } else if (result.kind === "remote-unknown" || result.kind === "query-unavailable") {
      setNotice("原操作查询结果未知或不可用；保留本地锁，未再次提交。");
    } else if (result.kind === "capability-unavailable") {
      setNotice("当前桌面版本缺少按原操作查询的接口；保留本地锁。");
    } else if (result.kind === "server-error") {
      setNotice(`原操作查询被拒绝：${result.status} / ${result.code}；保留本地锁。`);
    } else if (result.kind === "identity-mismatch" || result.kind === "pending-changed") {
      setNotice("原操作查询身份不一致或期间已变化；已丢弃响应，保留本地锁。");
    } else if (
      result.kind === "storage-unavailable" ||
      result.kind === "recovery-corrupt" ||
      result.kind === "journal-corrupt"
    ) {
      setNotice("原操作恢复记录无法安全保存或读取；保留本地锁。");
    } else {
      setNotice("没有可恢复的原提交；未发起新任务。");
    }
  }

  async function refreshTask() {
    if (!adapter || !scope || !projectId || !selectedTaskId || busy) return;
    const epoch = ++requestEpoch.current;
    setBusy(true);
    const result = await adapter.refreshTask(scope, selectedTaskId);
    if (requestEpoch.current !== epoch || activeProject.current !== projectId || !result.deliver)
      return;
    if (result.kind === "task" && result.output.kind === "media") {
      await d.timelineWorkspaceController.reload();
      if (requestEpoch.current !== epoch || activeProject.current !== projectId) return;
      const current = d.timelineWorkspaceController.getState();
      setNotice(
        current.kind === "ready" &&
          current.projectId === projectId &&
          current.response.data.version_id === result.output.timeline.data.version_id
          ? "任务、素材与当前真实时间线版本一致；已重新读取组装页。"
          : "任务产物已读回，但制作时间线未同步；请在组装页重新读取。",
      );
    } else if (result.kind === "task") {
      setNotice(
        result.output.kind === "not-current"
          ? "任务成功记录与当前时间线版本不一致；未将旧产物当作当前素材。"
          : `任务状态：${result.task.task.status}；素材尚未满足完成条件。`,
      );
    } else {
      setNotice("无法读取此任务或时间线；没有确认素材完成。");
    }
    setBusy(false);
    void d.taskQueue.reload();
  }

  return (
    <section className="v2-media-card" aria-label="本地 Fake 开发任务">
      <h2>本地 Fake 任务与真实回执</h2>
      <p>{DEVELOPMENT_FAKE_TIMELINE_LABEL} · 不调用真实供应商，不代表人物动作、声音或口型完成。</p>
      {!projectId && <p role="status">请先选择本地项目。</p>}
      {projectId && !adapter && (
        <p role="alert">当前桌面版本没有 Fake 任务能力或无法保存操作身份。</p>
      )}
      {projectId && documents.length === 0 && (
        <div role="status">
          <p>没有可选择的已批准来源；请先完成来源审核并重新读取。</p>
          <Button onClick={() => void d.refreshRealSourceStage()}>重新读取来源审核</Button>
        </div>
      )}
      {recovery?.kind === "pending" && (
        <p role="alert">
          先前提交结果未知，操作 ID：<code>{pendingId}</code>。仅可查询原操作，禁止再次提交。
        </p>
      )}
      {recovery?.kind === "cleanup-pending" && (
        <p role="alert">已找到原任务 {recoveredTaskId}，但本地锁清理待确认；仍禁止再次提交。</p>
      )}
      {recovery?.kind === "recovered" && (!taskId || taskId === recoveredTaskId) && (
        <p role="status">已恢复原提交关联任务 {recoveredTaskId}；这不是素材成功回执。</p>
      )}
      {journalCorrupt && <p role="alert">本地操作或恢复记录损坏，已阻止提交；请保留原始记录。</p>}
      <label>
        已批准来源
        <select
          aria-label="选择本地 Fake 制作来源"
          value={sourceId}
          disabled={!adapter || !projectId || busy}
          onChange={(event) => setSourceId(event.target.value)}
        >
          <option value="">选择真实来源</option>
          {documents.map((document) => (
            <option key={document.source_document_id} value={document.source_document_id}>
              {document.filename} · {document.source_document_id}
            </option>
          ))}
        </select>
      </label>
      <div className="v2-export-actions">
        <Button disabled={!adapter || !scope || !sourceId || busy} onClick={() => void prepare()}>
          核对来源
        </Button>
        <Button
          disabled={!adapter || !scope || !sourceId || busy || !canSubmit}
          onClick={() => void submit()}
        >
          提交本地 Fake 任务
        </Button>
        <Button
          disabled={
            !adapter ||
            !scope ||
            busy ||
            (recovery?.kind !== "pending" && recovery?.kind !== "cleanup-pending")
          }
          onClick={() => void recoverPending()}
        >
          查询原提交
        </Button>
      </div>
      <label>
        真实任务
        <select
          aria-label="选择要查询的 Fake 任务"
          value={selectedTaskId}
          disabled={!adapter || !projectId || busy}
          onChange={(event) => setTaskId(event.target.value)}
        >
          <option value="">选择任务</option>
          {recoveredTaskId && !tasks.some((item) => item.task.task_id === recoveredTaskId) && (
            <option value={recoveredTaskId}>{recoveredTaskId} · 已恢复关联，待查询</option>
          )}
          {tasks.map((item) => (
            <option key={item.task.task_id} value={item.task.task_id}>
              {item.task.task_id} · {item.task.status}
            </option>
          ))}
        </select>
      </label>
      <div className="v2-export-actions">
        <Button disabled={!projectId || busy} onClick={() => void d.taskQueue.reload()}>
          刷新任务列表
        </Button>
        <Button
          disabled={!adapter || !scope || !selectedTaskId || busy}
          onClick={() => void refreshTask()}
        >
          查询任务与时间线
        </Button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
