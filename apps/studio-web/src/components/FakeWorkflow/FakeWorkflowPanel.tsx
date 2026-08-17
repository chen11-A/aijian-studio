import { useEffect, useMemo, useRef, useState } from "react";

import type {
  FakeTimelineRunCapability,
  FakeTimelineRunCreateInput,
  FakeTimelineRunResponse,
  ProjectData,
  SourceDocumentResponse,
  SourceManifestResponse,
} from "../../api/studio";
import {
  createFakeTimelineRunOperationJournal,
  type FakeTimelineRunOperationJournal,
  submitFakeTimelineRunOperation,
} from "../../fake-timeline-run-operation-journal";
import "./fake-workflow.css";

interface FakeWorkflowPanelProps {
  project: ProjectData;
  source: SourceDocumentResponse;
  getSourceManifest(projectId: string): Promise<SourceManifestResponse | null>;
  capability?: FakeTimelineRunCapability;
  journal?: FakeTimelineRunOperationJournal;
  onOpenQueue(): void;
}

type LauncherState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; input: FakeTimelineRunCreateInput; pending: boolean }
  | { kind: "submitting"; input: FakeTimelineRunCreateInput }
  | { kind: "unknown"; input: FakeTimelineRunCreateInput }
  | { kind: "definite-error"; code: string; cleanupPending: boolean }
  | {
      kind: "success";
      receipt: FakeTimelineRunResponse;
      replayed: boolean;
      cleanupPending: boolean;
    }
  | { kind: "journal-error" };

function useCreationViewport(): boolean {
  const readViewport = () => (typeof window === "undefined" ? false : window.innerWidth > 480);
  const [allowed, setAllowed] = useState(readViewport);
  useEffect(() => {
    const update = () => setAllowed(readViewport());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return allowed;
}

function prepareInput(
  projectId: string,
  source: SourceDocumentResponse,
  manifest: SourceManifestResponse | null,
): { input: FakeTimelineRunCreateInput } | { message: string } {
  if (
    !manifest ||
    manifest.data.project_id !== projectId ||
    !manifest.data.head.accepted_version_id ||
    !manifest.data.accepted_version ||
    manifest.data.accepted_version.id !== manifest.data.head.accepted_version_id
  ) {
    return { message: "需要先由具名人员批准来源清单，才能生成 Fake 时间线。" };
  }
  if (source.data.project_id !== projectId) {
    return { message: "当前原文不属于这个项目，已停止创建任务。" };
  }
  const document = manifest.data.accepted_version.content.documents.find(
    (candidate) => candidate.source_document_id === source.data.id,
  );
  if (!document) {
    return { message: "已批准来源清单不包含当前原文。" };
  }
  return {
    input: {
      source_manifest_version_id: manifest.data.accepted_version.id,
      source_document_id: source.data.id,
    },
  };
}

export function FakeWorkflowPanel({
  project,
  source,
  getSourceManifest,
  capability,
  journal,
  onOpenQueue,
}: FakeWorkflowPanelProps) {
  const creationViewport = useCreationViewport();
  const hasCreationCapability = capability !== undefined;
  const journalAccess = useMemo(() => {
    if (!hasCreationCapability || !creationViewport) {
      return { journal: null, error: false };
    }
    try {
      return {
        journal:
          journal ??
          (typeof window === "undefined"
            ? null
            : createFakeTimelineRunOperationJournal(window.localStorage)),
        error: false,
      };
    } catch {
      return { journal: null, error: true };
    }
  }, [creationViewport, hasCreationCapability, journal]);
  const operationJournal = journalAccess.journal;
  const [state, setState] = useState<LauncherState>({ kind: "loading" });
  const generation = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!capability || !creationViewport || !operationJournal) return;
    const request = ++generation.current;
    setState({ kind: "loading" });
    try {
      const pending = operationJournal.load(project.id);
      if (pending) {
        setState({ kind: "ready", input: pending.input, pending: true });
        return () => {
          generation.current += 1;
        };
      }
    } catch {
      setState({ kind: "journal-error" });
      return;
    }
    void getSourceManifest(project.id)
      .then((manifest) => {
        if (request !== generation.current) return;
        const prepared = prepareInput(project.id, source, manifest);
        if ("message" in prepared) {
          setState({ kind: "unavailable", message: prepared.message });
          return;
        }
        setState({ kind: "ready", input: prepared.input, pending: false });
      })
      .catch(() => {
        if (request === generation.current) {
          setState({
            kind: "unavailable",
            message: "无法读取已批准来源，请检查本地服务后重试。",
          });
        }
      });
    return () => {
      generation.current += 1;
    };
  }, [capability, creationViewport, getSourceManifest, operationJournal, project.id, source]);

  if (!capability || !creationViewport) return null;

  if (journalAccess.error || !operationJournal) {
    return (
      <section className="fake-workflow-panel" aria-label="Fake 时间线">
        <p className="fake-workflow-warning" role="alert">
          本地操作记录存储不可用，已停止创建任务。请启用本地存储后重试。
        </p>
      </section>
    );
  }

  const submit = async (input: FakeTimelineRunCreateInput) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: "submitting", input });
    try {
      const result = await submitFakeTimelineRunOperation(
        operationJournal,
        capability,
        project.id,
        input,
      );
      if (result.kind === "REMOTE_UNKNOWN") {
        setState({ kind: "unknown", input });
      } else if (result.kind === "DEFINITE_SERVER_ERROR") {
        setState({
          kind: "definite-error",
          code: result.code,
          cleanupPending: result.journal_cleanup_pending,
        });
      } else {
        setState({
          kind: "success",
          receipt: result.receipt,
          replayed: result.replayed,
          cleanupPending: result.journal_cleanup_pending,
        });
      }
    } catch {
      setState({ kind: "journal-error" });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <section className="fake-workflow-panel" aria-labelledby="fake-workflow-title">
      <div className="fake-workflow-copy">
        <span>LOCAL FAKE · NO PROVIDER · NO GATE</span>
        <h3 id="fake-workflow-title">把已批准来源送入本地 Fake 时间线</h3>
        <p>
          使用 <strong>{source.data.filename}</strong> 冻结当前已批准来源，在后台生成三段各 125 帧的
          Fake 媒体。不调用付费 Provider，也不会自动进入 Timeline Gate。
        </p>
      </div>

      {state.kind === "loading" && <p role="status">正在核对来源清单与可恢复操作…</p>}
      {state.kind === "unavailable" && <p className="fake-workflow-warning">{state.message}</p>}
      {state.kind === "journal-error" && (
        <p className="fake-workflow-warning" role="alert">
          本地操作记录无法安全读取。任务未提交，请先检查本机存储。
        </p>
      )}
      {state.kind === "ready" && (
        <div className="fake-workflow-action">
          <p>
            {state.pending
              ? "检测到上次未确认结果的操作；只允许恢复同一操作和同一输入。"
              : "将冻结当前已批准来源清单和这篇原文；后台生成必须完成之后才能进入剪辑。"}
          </p>
          <button type="button" className="accent-button" onClick={() => void submit(state.input)}>
            {state.pending ? "恢复同一操作" : "生成 Fake 分镜时间线"}
          </button>
        </div>
      )}
      {state.kind === "submitting" && <p role="status">正在提交已持久化的操作…</p>}
      {state.kind === "unknown" && (
        <div className="fake-workflow-outcome fake-workflow-warning" role="status">
          <strong>提交结果未知</strong>
          <p>不会自动换一个操作重新提交；请恢复同一操作查询 Sidecar 的确定结果。</p>
          <button type="button" className="accent-button" onClick={() => void submit(state.input)}>
            恢复同一操作
          </button>
        </div>
      )}
      {state.kind === "definite-error" && (
        <div className="fake-workflow-outcome fake-workflow-warning" role="alert">
          <strong>服务器已明确拒绝</strong>
          <p>错误代码：{state.code}。请刷新工作台并重新核对已批准来源后再创建新操作。</p>
          {state.cleanupPending && (
            <p>服务端结果已经确定，但本地待恢复记录尚未确认清理；重载后只会恢复同一操作。</p>
          )}
        </div>
      )}
      {state.kind === "success" && (
        <div className="fake-workflow-outcome" role="status">
          <strong>{state.replayed ? "已恢复原运行" : "Fake 时间线已进入任务队列"}</strong>
          <p>
            任务 {state.receipt.data.task_id.slice(0, 13)}… · {state.receipt.data.task_status}
            。后台生成必须完成之后才能进入剪辑；入队成功并不表示时间线已经就绪。
          </p>
          <ul className="fake-workflow-losses">
            {state.receipt.data.capability_losses.map((loss) => (
              <li key={loss}>{loss}</li>
            ))}
          </ul>
          {state.cleanupPending && (
            <p>服务端结果已经确定，但本地待恢复记录尚未确认清理；重载后只会恢复同一操作。</p>
          )}
          <button type="button" className="secondary-button" onClick={onOpenQueue}>
            查看任务记录
          </button>
        </div>
      )}
    </section>
  );
}
