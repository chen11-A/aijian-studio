import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ProposalRunCapability,
  ProposalRunCreateInput,
  SourceDocumentResponse,
  SourceManifestResponse,
} from "../../api/studio";
import {
  createProposalRunOperationJournal,
  type ProposalRunOperationJournal,
  submitProposalRunOperation,
} from "../../proposal-run-operation-journal";
import "./source-extract-run-launcher.css";

interface SourceExtractRunLauncherProps {
  projectId: string;
  source: SourceDocumentResponse;
  getManifest(projectId: string): Promise<SourceManifestResponse | null>;
  capability?: ProposalRunCapability;
  journal?: ProposalRunOperationJournal;
  onOpenQueue?(): void;
}

type LauncherState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; input: ProposalRunCreateInput; pending: boolean }
  | { kind: "submitting"; input: ProposalRunCreateInput }
  | { kind: "unknown"; input: ProposalRunCreateInput }
  | { kind: "definite-error"; code: string; cleanupPending: boolean }
  | { kind: "success"; taskId: string; replayed: boolean; cleanupPending: boolean }
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
): { input: ProposalRunCreateInput } | { message: string } {
  if (
    !manifest ||
    manifest.data.project_id !== projectId ||
    !manifest.data.head.accepted_version_id ||
    !manifest.data.accepted_version ||
    manifest.data.accepted_version.id !== manifest.data.head.accepted_version_id
  ) {
    return { message: "需要先由具名人员批准来源清单，才能启动来源提取。" };
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
  const candidates = [...document.blocks].sort(
    (left, right) => Number(right.kind === "paragraph") - Number(left.kind === "paragraph"),
  );
  const block = candidates.find((candidate) => {
    const sourceBlock = source.data.blocks.find((item) => item.id === candidate.source_block_id);
    return (
      sourceBlock !== undefined &&
      sourceBlock.content_sha256 === candidate.content_sha256 &&
      sourceBlock.normalized_start_byte === candidate.start_byte &&
      sourceBlock.normalized_end_byte === candidate.end_byte &&
      candidate.end_byte > candidate.start_byte &&
      candidate.end_byte - candidate.start_byte <= 64 * 1024
    );
  });
  if (!block) {
    return { message: "没有找到可安全提取的已批准原文段落。" };
  }
  return {
    input: {
      agent_definition: { definition_id: "writer.source-analyst", version: "1.0.0" },
      skill_definition: { definition_id: "source.extract", version: "1.0.0" },
      source_manifest_version_id: manifest.data.accepted_version.id,
      source_document_id: source.data.id,
      source_block_id: block.source_block_id,
      start_byte: block.start_byte,
      end_byte: block.end_byte,
    },
  };
}

export function SourceExtractRunLauncher({
  projectId,
  source,
  getManifest,
  capability,
  journal,
  onOpenQueue,
}: SourceExtractRunLauncherProps) {
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
            : createProposalRunOperationJournal(window.localStorage)),
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
      const pending = operationJournal.load(projectId);
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
    void getManifest(projectId)
      .then((manifest) => {
        if (request !== generation.current) return;
        const prepared = prepareInput(projectId, source, manifest);
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
  }, [capability, creationViewport, getManifest, operationJournal, projectId, source]);

  if (!capability || !creationViewport) return null;

  if (journalAccess.error || !operationJournal) {
    return (
      <section className="source-extract-launcher creation-action" aria-label="来源提取">
        <p className="launcher-warning" role="alert">
          本地操作记录存储不可用，已停止创建任务。请启用本地存储后重试。
        </p>
      </section>
    );
  }

  const submit = async (input: ProposalRunCreateInput) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: "submitting", input });
    try {
      const result = await submitProposalRunOperation(
        operationJournal,
        capability,
        projectId,
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
          taskId: result.receipt.data.task.task_id,
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
    <section className="source-extract-launcher creation-action" aria-labelledby="source-run-title">
      <div>
        <span>LOCAL FAKE · SOURCE.EXTRACT</span>
        <h3 id="source-run-title">从已批准原文开始 AI 制作</h3>
        <p>先用本地 Fake Agent 生成带 SourceSpan 的提案；不调用付费模型，不自动批准。</p>
      </div>

      {state.kind === "loading" && <p role="status">正在核对来源清单与可恢复操作…</p>}
      {state.kind === "unavailable" && <p className="launcher-warning">{state.message}</p>}
      {state.kind === "journal-error" && (
        <p className="launcher-warning" role="alert">
          本地操作记录无法安全读取。任务未提交，请先检查本机存储。
        </p>
      )}
      {state.kind === "ready" && (
        <div className="launcher-action-row">
          <p>
            {state.pending
              ? "检测到上次未确认结果的操作；只允许恢复同一操作和同一输入。"
              : "当前切片读取第一段已批准原文，生成提案后进入人工审阅。"}
          </p>
          <button type="button" onClick={() => void submit(state.input)}>
            {state.pending ? "恢复同一操作" : "启动来源提取"}
          </button>
        </div>
      )}
      {state.kind === "submitting" && <p role="status">正在提交已持久化的操作…</p>}
      {state.kind === "unknown" && (
        <div className="launcher-outcome launcher-warning" role="status">
          <strong>提交结果未知</strong>
          <p>不会自动换一个操作重新计费；请恢复同一操作查询 Sidecar 的确定结果。</p>
          <button type="button" onClick={() => void submit(state.input)}>
            恢复同一操作
          </button>
        </div>
      )}
      {state.kind === "definite-error" && (
        <div className="launcher-outcome launcher-warning" role="alert">
          <strong>服务器已明确拒绝</strong>
          <p>错误代码：{state.code}。请刷新工作台并重新核对已批准来源后再创建新操作。</p>
          {state.cleanupPending && (
            <p>服务端结果已经确定，但本地待恢复记录尚未确认清理；重载后只会恢复同一操作。</p>
          )}
        </div>
      )}
      {state.kind === "success" && (
        <div className="launcher-outcome launcher-success" role="status">
          <strong>{state.replayed ? "已恢复原运行" : "来源提取已进入任务队列"}</strong>
          <p>任务 {state.taskId.slice(0, 13)}… 将停在提案审阅，不会自动创建 DRAFT。</p>
          {state.cleanupPending && (
            <p>任务已创建，但本地待恢复记录尚未确认清理；重载后可安全恢复同一操作。</p>
          )}
          {onOpenQueue && (
            <button type="button" onClick={onOpenQueue}>
              查看任务
            </button>
          )}
        </div>
      )}
    </section>
  );
}
