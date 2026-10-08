import { useEffect, useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import type {
  ArtifactProposalResponse,
  SourceExtractionProposalV2Response,
  ProviderConnectionListResponse,
  SourceExtractionResponse,
  SourceExtractionReadResult,
  SourceManifestResponse,
} from "../api/studio";
import { Button } from "./Common";
import {
  acceptSourceExtractionProposal,
  approveSub2APIOneCall,
  queueSub2APISourceExtract,
  queueRemoteSourceExtract,
  readOriginalSub2APISourceExtract,
  readOriginalRemoteSourceExtract,
  readRemoteSourceExtractJournal,
  readSub2APICallApprovalJournal,
  readSub2APIOneCallApproval,
  readSub2APISourceExtractJournal,
  readSourceExtractionAcceptance,
} from "./adapters/remoteSourceExtract";
import type {
  RemoteSourceExtractJournalState,
  RemoteSourceExtractOperation,
  Sub2APICallApprovalJournalState,
  Sub2APICallApprovalReadOutcome,
  Sub2APISourceExtractReadOutcome,
  SourceExtractionAcceptanceState,
} from "./adapters/remoteSourceExtract";

export type SourceExtractionPanelProps = {
  projectId: string | null;
  sourceManifest: SourceManifestResponse | null;
  sourceDocumentId: string | null;
  sourceApproved: boolean;
};

function journalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sameOriginalSource(
  operation: RemoteSourceExtractOperation,
  projectId: string,
  manifest: SourceManifestResponse,
): boolean {
  const accepted = manifest.data.accepted_version;
  return operation.projectId === projectId &&
    manifest.data.project_id === projectId &&
    !!accepted && accepted.id === operation.manifestVersionId &&
    accepted.content_hash === operation.manifestContentHash;
}

function v2SpanMatches(value: unknown, operation: RemoteSourceExtractOperation): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const span = value as Record<string, unknown>;
  return span.source_document_id === operation.sourceDocumentId &&
    span.source_block_id === operation.sourceBlockId &&
    typeof span.start_byte === "number" && span.start_byte >= operation.startByte &&
    typeof span.end_byte === "number" && span.end_byte <= operation.endByte;
}

export function SourceExtractionPanel({
  projectId,
  sourceManifest,
  sourceDocumentId,
  sourceApproved,
}: SourceExtractionPanelProps) {
  const transport = useMemo(createStudioTransport, []);
  const epoch = useRef(0);
  const activeProject = useRef(projectId);
  const activeApprovalContext = useRef("");
  activeProject.current = projectId;
  const [journal, setJournal] = useState<RemoteSourceExtractJournalState>({ kind: "EMPTY" });
  const [sub2Journal, setSub2Journal] = useState<RemoteSourceExtractJournalState>({ kind: "EMPTY" });
  const [mode, setMode] = useState<"CPA_LOOPBACK" | "SUB2API">("CPA_LOOPBACK");
  const [sub2Read, setSub2Read] = useState<Sub2APISourceExtractReadOutcome | null>(null);
  const [sub2Approval, setSub2Approval] = useState<Sub2APICallApprovalJournalState>({ kind: "EMPTY" });
  const [sub2ApprovalRead, setSub2ApprovalRead] = useState<Sub2APICallApprovalReadOutcome | null>(null);
  const [unknownCostConsent, setUnknownCostConsent] = useState(false);
  const [connections, setConnections] = useState<
    { kind: "loading" | "error" } | { kind: "ready"; response: ProviderConnectionListResponse }
  >({ kind: "loading" });
  const [connectionId, setConnectionId] = useState("");
  const [modelId, setModelId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [originalRead, setOriginalRead] = useState<"FOUND_RUN" | "NOT_FOUND" | "REMOTE_UNKNOWN" | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ArtifactProposalResponse | SourceExtractionProposalV2Response | null>(null);
  const [latest, setLatest] = useState<
    { kind: "unread" | "absent" | "error" } |
    { kind: "found"; response: SourceExtractionResponse }
  >({ kind: "unread" });
  const [acceptance, setAcceptance] = useState<SourceExtractionAcceptanceState>({ kind: "EMPTY" });
  const [draft, setDraft] = useState<SourceExtractionResponse | null>(null);

  useEffect(() => {
    const request = ++epoch.current;
    setBusy(false);
    setNotice("");
    setConnectionId("");
    setModelId("");
    setBlockId("");
    setOriginalRead(null);
    setSub2Read(null);
    setSub2Approval({ kind: "EMPTY" });
    setSub2ApprovalRead(null);
    setUnknownCostConsent(false);
    setProposalId(null);
    setProposal(null);
    setLatest({ kind: "unread" });
    setAcceptance({ kind: "EMPTY" });
    setDraft(null);
    const storage = journalStorage();
    const cpaState = projectId && storage
      ? readRemoteSourceExtractJournal(storage, projectId)
      : projectId ? { kind: "BLOCKED" as const } : { kind: "EMPTY" as const };
    const sub2State = projectId && storage
      ? readSub2APISourceExtractJournal(storage, projectId)
      : projectId ? { kind: "BLOCKED" as const } : { kind: "EMPTY" as const };
    setJournal(cpaState);
    setSub2Journal(sub2State);
    setMode(sub2State.kind === "VALID" && cpaState.kind === "EMPTY"
      ? "SUB2API" : "CPA_LOOPBACK");
    setConnections({ kind: "loading" });
    if (projectId) {
      void transport.listProviderConnections().then(
        (response) => {
          if (epoch.current === request && activeProject.current === projectId)
            setConnections({ kind: "ready", response });
        },
        () => {
          if (epoch.current === request && activeProject.current === projectId)
            setConnections({ kind: "error" });
        },
      );
    }
    return () => { epoch.current += 1; };
  }, [projectId, transport]);

  const manifest = sourceManifest?.data.project_id === projectId ? sourceManifest : null;
  const accepted = manifest?.data.accepted_version;
  const acceptedCurrent = !!sourceApproved && !!accepted &&
    accepted.id === manifest?.data.head.accepted_version_id &&
    accepted.id === manifest?.data.head.latest_version_id &&
    accepted.id === manifest?.data.latest_version.id &&
    accepted.content_hash === manifest?.data.latest_version.content_hash;
  const document = acceptedCurrent && accepted
    ? accepted.content.documents.find((item) => item.source_document_id === sourceDocumentId)
    : null;
  const block = document?.blocks.find((item) => item.source_block_id === blockId);
  const eligible = connections.kind === "ready"
    ? connections.response.data.filter((item) =>
        item.provider_kind === mode && item.enabled &&
        item.credential_status === "CONFIGURED" &&
        item.models.some((model) => model.capabilities.includes("TEXT")))
    : [];
  const selectedConnection = eligible.find((item) => item.id === connectionId);
  const models = selectedConnection?.models.filter((item) => item.capabilities.includes("TEXT")) ?? [];
  const selectedModel = models.find((item) => item.model_id === modelId);
  const activeJournal = mode === "SUB2API" ? sub2Journal : journal;
  const operation = activeJournal.kind === "VALID" ? activeJournal.operation : null;
  const approvalContext = JSON.stringify([
    projectId, sourceDocumentId, sourceApproved, mode,
    accepted?.id, accepted?.content_hash,
    manifest?.data.head.accepted_version_id, manifest?.data.head.latest_version_id,
    manifest?.data.latest_version.id, manifest?.data.latest_version.content_hash,
    operation?.operationId, sub2Read?.kind === "FOUND" ? sub2Read.runId : null,
  ]);
  activeApprovalContext.current = approvalContext;
  const acceptedDraftVersionId = acceptance.kind === "VALID"
    ? acceptance.acceptance.draftVersionId : null;
  const sourceStillCurrent = !!operation && !!manifest && !!projectId &&
    acceptedCurrent && !!document &&
    sourceDocumentId === operation.sourceDocumentId &&
    document.blocks.some((item) => item.source_block_id === operation.sourceBlockId &&
      item.content_sha256 === operation.sourceBlockHash &&
      item.start_byte === operation.startByte && item.end_byte === operation.endByte) &&
    sameOriginalSource(operation, projectId, manifest);
  const canQueue = !!projectId && !!document && !!block && !!selectedConnection &&
    !!selectedModel && activeJournal.kind === "EMPTY" &&
    journal.kind === "EMPTY" && sub2Journal.kind === "EMPTY" && !busy &&
    !!(mode === "SUB2API" ? transport.sub2apiSourceExtract : transport.remoteSourceExtract);

  async function queue() {
    const storage = journalStorage();
    if (!canQueue || !storage || !projectId || !accepted || !document || !block ||
      !selectedConnection || !selectedModel) return;
    const requested = projectId;
    const request = ++epoch.current;
    setBusy(true);
    const identity = {
      projectId,
      manifestVersionId: accepted.id,
      manifestContentHash: accepted.content_hash,
      sourceDocumentId: document.source_document_id,
      sourceBlockId: block.source_block_id,
      sourceBlockHash: block.content_sha256,
      startByte: block.start_byte,
      endByte: block.end_byte,
      connectionId: selectedConnection.id,
      connectionRevision: selectedConnection.revision,
      modelId: selectedModel.model_id,
    };
    const result = mode === "SUB2API"
      ? await queueSub2APISourceExtract(transport.sub2apiSourceExtract, storage, identity)
      : await queueRemoteSourceExtract(transport.remoteSourceExtract, storage, identity);
    if (epoch.current !== request || activeProject.current !== requested) return;
    setBusy(false);
    if (mode === "SUB2API")
      setSub2Journal(readSub2APISourceExtractJournal(storage, requested));
    else
      setJournal(readRemoteSourceExtractJournal(storage, requested));
    setNotice(result.kind === "QUEUED"
      ? mode === "SUB2API"
        ? "Sub2API 任务已排队；尚无单次调用许可。费用未知，未证明供应商调用。"
        : "服务端已创建待授权任务；尚未授权派发，也未调用供应商。"
      : result.kind === "REJECTED"
        ? `服务端明确拒绝入队：${result.operation.rejection?.status} / ${result.operation.rejection?.code}。保留原操作记录；不能重复 POST。`
      : result.kind === "TRACKED"
        ? "已有原操作，未重复 POST；请读取原操作。"
        : result.kind === "UNAVAILABLE"
          ? result.message
          : "排队结果未知；原操作已锁定，只可查询，不能重新 POST。");
  }

  async function readOriginal() {
    const storage = journalStorage();
    if (!storage || !operation || busy ||
        !(mode === "SUB2API" ? transport.sub2apiSourceExtract : transport.remoteSourceExtract))
      return;
    const requested = operation.projectId;
    const request = ++epoch.current;
    setBusy(true);
    if (mode === "SUB2API") {
      const result = await readOriginalSub2APISourceExtract(
        transport.sub2apiSourceExtract, storage, operation);
      if (epoch.current !== request || activeProject.current !== requested) return;
      setBusy(false);
      setSub2Read(result);
      setSub2ApprovalRead(null);
      setUnknownCostConsent(false);
      setProposal(null);
      setLatest({ kind: "unread" });
      setAcceptance({ kind: "EMPTY" });
      setDraft(null);
      setProposalId(result.kind === "FOUND" &&
        result.response.data.content_status === "PROPOSAL_READY"
          ? result.response.data.proposal_id : null);
      setSub2Approval(result.kind === "FOUND"
        ? readSub2APICallApprovalJournal(storage, requested, result.runId)
        : { kind: "EMPTY" });
      setNotice(result.kind === "FOUND"
        ? result.response.data.content_status === "REMOTE_UNKNOWN"
          ? "原任务状态 REMOTE_UNKNOWN；费用仍未知，不能自动重试或再次派发。"
          : result.response.data.content_status === "PROPOSAL_READY"
            ? "已读取原任务和提案引用；请独立核对 V2 提案与人工接纳。"
            : "已读取原任务冻结范围与未知费用；单次调用须单独明确许可。"
        : result.kind === "DEFINITE_SERVER_ERROR"
          ? `原任务查询返回 ${result.status} / ${result.code}，请求 ID ${result.requestId}；未改原操作。`
          : result.kind === "NOT_FOUND"
            ? `原任务未找到（请求 ID ${result.requestId}）；排队记录仍锁定，不重新 POST。`
            : "原任务查询未知或不可用；排队记录仍锁定。");
      return;
    }
    const result = await readOriginalRemoteSourceExtract(
      transport.remoteSourceExtract, storage, operation);
    if (epoch.current !== request || activeProject.current !== requested) return;
    setBusy(false);
    if (result.kind === "UNAVAILABLE") {
      setNotice("原操作记录已变化或查询能力不可用；未改变本地锁。");
      return;
    }
    setOriginalRead(result.kind);
    setProposal(null);
    setLatest({ kind: "unread" });
    setAcceptance({ kind: "EMPTY" });
    setDraft(null);
    setProposalId(operation.status === "QUEUED" && result.kind === "FOUND_RUN"
      ? result.proposalId : null);
    setNotice(result.kind === "FOUND_RUN"
      ? operation.status === "UNKNOWN"
        ? "发现原 run，但排队绑定尚未核实；结果仍未知，不能重新 POST。"
        : result.proposalId
          ? "已按原操作读到 run 与提案 ID；请单独读取提案核对内容。"
          : "已按原操作读到 run；尚无可核对的提案。"
      : result.kind === "NOT_FOUND"
        ? "未找到原 run；原操作状态不变，不能重新 POST。"
        : "原 run 查询未知；保留原操作状态，不能重新 POST。");
  }

  async function readProposal() {
    if (!projectId || !proposalId || !operation || busy) return;
    if (mode === "SUB2API") {
      if (sub2Read?.kind !== "FOUND" ||
          sub2Read.response.data.content_status !== "PROPOSAL_READY" ||
          sub2Read.response.data.proposal_id !== proposalId ||
          !transport.readVersionedSourceExtractionProposal) return;
      const requested = projectId;
      const request = ++epoch.current;
      setBusy(true);
      setLatest({ kind: "unread" });
      setDraft(null);
      try {
        const result = await transport.readVersionedSourceExtractionProposal(requested, proposalId);
        if (epoch.current !== request || activeProject.current !== requested) return;
        if (result.kind !== "FOUND_V2") {
          setProposal(null);
          setNotice(result.kind === "FOUND_V1"
            ? "Sub2API 原任务读到 V1 提案，版本不符，已阻止接纳。"
            : "V2 提案未找到或读取未知；原操作与许可状态不变。");
          return;
        }
        const value = result.receipt.data.proposal;
        if (result.receipt.data.project_id !== requested ||
            result.receipt.data.proposal_id !== proposalId ||
            result.receipt.data.producer_attempt_id !== sub2Read.response.data.scope.attempt_id ||
            value.producer_agent_run_id !== sub2Read.runId ||
            value.approval_id !== sub2Read.response.data.approval_id ||
            !value.source_spans.some((span) => v2SpanMatches(span, operation))) {
          setProposal(null);
          setNotice("V2 提案与原任务、许可或来源证据不匹配，已丢弃回包。");
          return;
        }
        setProposal(result.receipt);
        const storage = journalStorage();
        setAcceptance(storage
          ? readSourceExtractionAcceptance(storage, requested, proposalId)
          : { kind: "BLOCKED" });
        setNotice("已读回 V2 来源提案；费用仍未知，提案不是已接纳草稿。");
      } catch {
        if (epoch.current === request && activeProject.current === requested) {
          setProposal(null);
          setNotice("V2 提案读取失败；原任务与许可状态不变。");
        }
      } finally {
        if (epoch.current === request && activeProject.current === requested) setBusy(false);
      }
      return;
    }
    if (operation.status !== "QUEUED" || !operation.runId) return;
    const requested = projectId;
    const request = ++epoch.current;
    setBusy(true);
    setLatest({ kind: "unread" });
    setDraft(null);
    try {
      const versioned = transport.readVersionedSourceExtractionProposal
        ? await transport.readVersionedSourceExtractionProposal(requested, proposalId)
        : null;
      if (versioned && versioned.kind !== "FOUND_V1") {
        if (epoch.current === request && activeProject.current === requested) {
          setNotice(versioned.kind === "FOUND_V2"
            ? "原 CPA 操作读到 Sub2API V2 提案，版本与执行来源不匹配；已阻止接纳。"
            : "原 CPA 提案未找到或读取未知；保留原操作，不重试提交。");
          setProposal(null);
        }
        return;
      }
      const response = versioned?.receipt ??
        await transport.getArtifactProposal(requested, proposalId);
      if (epoch.current !== request || activeProject.current !== requested) return;
      const value = response.data.proposal;
      const sourceMatches = value.source_spans.some((span) =>
        span.source_document_id === operation.sourceDocumentId &&
        span.source_block_id === operation.sourceBlockId &&
        span.start_byte >= operation.startByte && span.end_byte <= operation.endByte);
      if (response.data.project_id !== requested || response.data.proposal_id !== proposalId ||
        value.target_artifact_type !== "SourceExtraction" ||
        value.producer_agent_run_id !== operation.runId || !sourceMatches) {
        setNotice("提案身份或来源证据不匹配，已丢弃回包。");
        setProposal(null);
      } else {
        setProposal(response);
        const storage = journalStorage();
        setAcceptance(storage
          ? readSourceExtractionAcceptance(storage, requested, proposalId)
          : { kind: "BLOCKED" });
        setNotice("已读回来源抽取提案；这不是已接受草稿或正式生成成果。");
      }
    } catch {
      if (epoch.current === request && activeProject.current === requested) {
        setNotice("提案读取失败；原操作与排队回执保持不变。");
        setProposal(null);
      }
    } finally {
      if (epoch.current === request && activeProject.current === requested) setBusy(false);
    }
  }

  function matchingDraft(
    response: SourceExtractionResponse,
    requested: string,
    expectedVersionId: string,
  ): boolean {
    if (!operation || !proposal || !proposalId ||
      response.data.project_id !== requested ||
      response.data.version.id !== expectedVersionId ||
      response.data.provenance.proposal_id !== proposalId ||
      response.data.provenance.producer_attempt_id !== proposal.data.producer_attempt_id ||
      response.data.version.content_hash !== proposal.data.proposal.payload_hash ||
      response.data.head.artifact_id !== response.data.version.artifact_id ||
      !response.data.dependencies.some((item) =>
        item.upstream_version_id === operation.manifestVersionId &&
        item.relationship === "derived_from" && item.impact === "blocking")) return false;
    return response.data.source_spans.some((span) =>
      span.source_document_id === operation.sourceDocumentId &&
      span.source_block_id === operation.sourceBlockId &&
      span.start_byte >= operation.startByte && span.end_byte <= operation.endByte);
  }

  async function readLatest() {
    if (!projectId || !transport.getSourceExtraction || busy || !proposal) return;
    const requested = projectId;
    const request = ++epoch.current;
    setBusy(true);
    let result: SourceExtractionReadResult;
    try {
      result = await transport.getSourceExtraction(requested);
    } catch {
      result = { kind: "REMOTE_UNKNOWN" };
    }
    if (epoch.current !== request || activeProject.current !== requested) return;
    setBusy(false);
    if (result.kind === "NOT_FOUND") {
      setLatest({ kind: "absent" });
      setNotice("权威读回确认尚无 SourceExtraction 草稿；人工接纳将使用空 head 前置条件。");
    } else if (result.kind === "FOUND" &&
      result.receipt.data.project_id === requested &&
      result.receipt.data.head.latest_version_id === result.receipt.data.version.id &&
      result.receipt.data.head.artifact_id === result.receipt.data.version.artifact_id &&
      Number.isSafeInteger(result.receipt.data.head.revision) &&
      result.receipt.data.head.revision > 0) {
      setLatest({ kind: "found", response: result.receipt });
      setNotice("已读取现有 SourceExtraction head；人工接纳将带准确版本与修订前置条件。");
    } else {
      setLatest({ kind: "error" });
      setNotice("SourceExtraction head 读取未知或不一致；已阻止人工接纳。");
    }
  }

  async function readExactDraft(versionId: string) {
    if (!projectId || !transport.getSourceExtractionVersion || !proposal) return;
    const requested = projectId;
    const request = ++epoch.current;
    setBusy(true);
    let result: SourceExtractionReadResult;
    try {
      result = await transport.getSourceExtractionVersion(requested, versionId);
    } catch {
      result = { kind: "REMOTE_UNKNOWN" };
    }
    if (epoch.current !== request || activeProject.current !== requested) return;
    setBusy(false);
    if (result.kind === "FOUND" && matchingDraft(result.receipt, requested, versionId)) {
      setDraft(result.receipt);
      setNotice("已精确读回与原提案、来源证据一致的 SourceExtraction 草稿版本。");
    } else {
      setDraft(null);
      setNotice("草稿精确读回失败或身份不符；接纳回执与草稿展示保持分离。");
    }
  }

  async function approveOneCall() {
    const storage = journalStorage();
    if (!storage || mode !== "SUB2API" || !operation || operation.status === "REJECTED" || !projectId ||
        !sourceStillCurrent || sub2Read?.kind !== "FOUND" ||
        sub2Approval.kind !== "EMPTY" || sub2ApprovalRead?.kind === "FOUND" ||
        !unknownCostConsent || busy) return;
    const requested = projectId;
    const runId = sub2Read.runId;
    const context = approvalContext;
    const request = ++epoch.current;
    setBusy(true);
    const result = await approveSub2APIOneCall(transport.sub2apiSourceExtract,
      storage, operation, sub2Read, unknownCostConsent);
    if (epoch.current !== request || activeProject.current !== requested) return;
    if (activeApprovalContext.current !== context) {
      setBusy(false);
      return;
    }
    setUnknownCostConsent(false);
    setSub2Approval(readSub2APICallApprovalJournal(storage, requested, runId));
    if (result.kind === "CONSUMED") {
      setNotice("单次许可已消耗并锁定；正在只读查询原任务。费用仍未知。");
      const read = await readOriginalSub2APISourceExtract(
        transport.sub2apiSourceExtract, storage, operation);
      if (epoch.current !== request || activeProject.current !== requested) return;
      if (activeApprovalContext.current !== context) {
        setBusy(false);
        return;
      }
      setBusy(false);
      setSub2ApprovalRead(null);
      setProposal(null);
      setLatest({ kind: "unread" });
      setAcceptance({ kind: "EMPTY" });
      setDraft(null);
      if (read.kind === "FOUND" && read.runId === runId) {
        setSub2Read(read);
        setProposalId(read.response.data.content_status === "PROPOSAL_READY"
          ? read.response.data.proposal_id : null);
        setNotice(read.response.data.content_status === "PROPOSAL_READY"
          ? "单次许可已消耗；已只读取得原任务提案引用。请独立核对 V2 提案与人工接纳；费用仍未知。"
          : `单次许可已消耗；原任务状态 ${read.response.data.content_status}。费用仍未知，不得再次授权或重试。`);
      } else {
        setSub2Read(null);
        setProposalId(null);
        const detail = read.kind === "DEFINITE_SERVER_ERROR"
          ? `原任务查询返回 ${read.status} / ${read.code}，请求 ID ${read.requestId}`
          : read.kind === "NOT_FOUND"
            ? `原任务查询未找到，请求 ID ${read.requestId}`
            : read.kind === "FOUND" ? "原任务 run 身份不符" : "原任务查询结果未知或不可用";
        setNotice(`单次许可已消耗并锁定；${detail}。请手动查询原任务，不得再次授权或重试。费用仍未知。`);
      }
      return;
    }
    setBusy(false);
    setNotice(result.kind === "APPROVED"
      ? "已保存一次调用许可的 POST 回执；请查询许可和原任务状态。费用仍未知。"
      : result.kind === "UNAVAILABLE" ? result.message
      : result.kind === "UNKNOWN" && result.serverError
        ? `许可提交返回 ${result.serverError.status} / ${result.serverError.code}，请求 ID ${result.serverError.requestId}；原许可意图已锁定，不重复 POST。`
        : "一次调用许可结果未知或已有原许可；只查询，不再 POST。");
  }

  async function readOneCallApproval() {
    const storage = journalStorage();
    if (!storage || mode !== "SUB2API" || !operation || !projectId ||
        sub2Read?.kind !== "FOUND" || busy) return;
    const requested = projectId;
    const runId = sub2Read.runId;
    const request = ++epoch.current;
    setBusy(true);
    const result = await readSub2APIOneCallApproval(
      transport.sub2apiSourceExtract, storage, operation, sub2Read);
    if (epoch.current !== request || activeProject.current !== requested) return;
    setBusy(false);
    setSub2Approval(readSub2APICallApprovalJournal(storage, requested, runId));
    setSub2ApprovalRead(result);
    if (result.kind === "FOUND") setUnknownCostConsent(false);
    setNotice(result.kind === "FOUND"
      ? result.response.data.status === "CONSUMED"
        ? "原任务许可已消耗；请只读查询原任务与提案结果，不得再次授权或重试。费用仍未知。"
        : `已按原任务读回许可，状态 ${result.response.data.status}；费用仍未知。`
      : result.kind === "DEFINITE_SERVER_ERROR"
        ? `许可查询返回 ${result.status} / ${result.code}，请求 ID ${result.requestId}；本地锁不变。`
        : result.kind === "NOT_FOUND"
          ? `原任务未找到许可（请求 ID ${result.requestId}）；此前许可意图如为 UNKNOWN 仍保持锁定，不重新 POST。`
          : "许可读回未知或不可用；本地许可意图保持锁定。");
  }

  async function acceptAsDraft() {
    const storage = journalStorage();
    if (!storage || !projectId || !operation || !proposal || !proposalId ||
      (mode === "CPA_LOOPBACK" ? operation.status !== "QUEUED" :
        operation.status === "REJECTED" ||
        proposal.data.proposal.schema_version !== "2.0.0" ||
        sub2Read?.kind !== "FOUND" ||
        sub2Read.response.data.content_status !== "PROPOSAL_READY" ||
        sub2Read.response.data.proposal_id !== proposalId) ||
      acceptance.kind !== "EMPTY" ||
      (latest.kind !== "absent" && latest.kind !== "found") ||
      !sourceStillCurrent || busy) return;
    const requested = projectId;
    const request = ++epoch.current;
    setBusy(true);
    const parentVersionId = latest.kind === "found" ? latest.response.data.head.latest_version_id : null;
    const expectedRevision = latest.kind === "found" ? latest.response.data.head.revision : null;
    const result = await acceptSourceExtractionProposal(
      transport, storage, operation, proposalId, parentVersionId, expectedRevision,
      mode === "SUB2API" ? sub2Read ?? undefined : undefined);
    if (epoch.current !== request || activeProject.current !== requested) return;
    setBusy(false);
    setAcceptance(readSourceExtractionAcceptance(storage, requested, proposalId));
    if (result.kind === "ACCEPTED") {
      setNotice("人工接纳回执已保存；仍需精确读取草稿版本。" );
      if (result.acceptance.draftVersionId)
        void readExactDraft(result.acceptance.draftVersionId);
    } else {
      setNotice(result.kind === "UNAVAILABLE" ? result.message :
        result.kind === "UNKNOWN" && result.serverError
          ? `人工接纳收到 ${result.serverError.status} / ${result.serverError.code}；保留锁，请刷新最新草稿核对，不能重复 POST。`
          : "人工接纳结果未知或已有接纳记录；保留锁，不能重复提交。请只读核对。");
    }
  }

  const summary = proposal?.data.proposal.payload.summary;
  const canApproveOneCall = mode === "SUB2API" && !!operation &&
    operation.status !== "REJECTED" &&
    sub2Read?.kind === "FOUND" && sub2Read.queueBinding === "VERIFIED" &&
    sub2Read.response.data.content_status === "PENDING" &&
    sub2Read.response.data.approval_id === null &&
    sub2Approval.kind === "EMPTY" && sub2ApprovalRead?.kind !== "FOUND" &&
    sourceStillCurrent &&
    unknownCostConsent && !busy && !!transport.sub2apiSourceExtract;
  function selectMode(next: "CPA_LOOPBACK" | "SUB2API") {
    if (busy || connections.kind === "loading" || next === mode) return;
    setMode(next);
    setConnectionId("");
    setModelId("");
    setBlockId("");
    setOriginalRead(null);
    setSub2Read(null);
    setSub2Approval({ kind: "EMPTY" });
    setSub2ApprovalRead(null);
    setUnknownCostConsent(false);
    setProposalId(null);
    setProposal(null);
    setLatest({ kind: "unread" });
    setAcceptance({ kind: "EMPTY" });
    setDraft(null);
    setNotice("");
  }
  return (
    <section className="v2-media-card" aria-label="真实远程来源抽取">
      <h2>真实远程来源抽取 · 首批文本</h2>
      <p>入队仅创建任务；Sub2API 的外部文本调用另需核对冻结范围与未知费用，并明确授予一次调用许可。</p>
      <div className="v2-export-actions" role="group" aria-label="来源抽取执行方式">
        <Button disabled={busy || connections.kind === "loading"}
          onClick={() => selectMode("CPA_LOOPBACK")}>CPA 本地文本</Button>
        <Button disabled={busy || connections.kind === "loading"}
          onClick={() => selectMode("SUB2API")}>Sub2API 文本</Button>
      </div>
      <p>当前执行方式：{mode === "SUB2API" ? "Sub2API" : "CPA 本地"}</p>
      {!projectId ? <p role="status">请先选择真实项目。</p> :
        !acceptedCurrent || !document
          ? <p role="status">当前来源没有可用的已接受清单与选中文档，已阻止入队。</p>
          : <p>已接受来源版本：<code>{accepted?.id}</code> · 可选 {document.blocks.length} 个块</p>}
      {connections.kind === "error" && <p role="alert">连接目录读取失败；不能入队。</p>}
      {mode === "SUB2API" && !transport.sub2apiSourceExtract &&
        <p role="status">当前桌面桥接尚未提供 Sub2API 队列和许可接口，操作暂不可用。</p>}
      {connections.kind === "ready" && eligible.length === 0 &&
        <p role="status">没有可用的 {mode === "SUB2API" ? "Sub2API" : "CPA 本地"} TEXT 连接；请先在 AI 服务页配置并核对。</p>}
      {(journal.kind === "BLOCKED" || sub2Journal.kind === "BLOCKED") &&
        <p role="alert">本地原操作记录无法安全读取，已阻止再次提交。</p>}
      {mode === "SUB2API" && journal.kind === "VALID" &&
        <p role="status">此项目已有 CPA 来源操作，已阻止并列入队。</p>}
      {mode === "CPA_LOOPBACK" && sub2Journal.kind === "VALID" &&
        <p role="status">此项目已有 Sub2API 来源操作，已阻止并列入队。</p>}
      {operation && (
        <div>
          <p>原操作 ID：<code>{operation.operationId}</code></p>
          <p>原来源：<code>{operation.manifestVersionId}</code> / <code>{operation.sourceBlockId}</code></p>
          <p role="status">{operation.status === "UNKNOWN"
            ? "排队结果未知：保留本地锁，只允许读取原 run，不允许重新 POST。"
            : operation.status === "REJECTED"
              ? "服务端明确拒绝了入队；保留原操作，不能自动或手动重复 POST。"
            : "仅有入队回执：尚未授权派发或证明供应商调用。"}</p>
          {operation.rejection &&
            <p>拒绝记录：{operation.rejection.status} / {operation.rejection.code} ·
              请求 ID <code>{operation.rejection.requestId}</code></p>}
          {!sourceStillCurrent && <p role="status">原来源已不是当前已接受版本；保留原操作记录。</p>}
          {originalRead === "FOUND_RUN" && operation.status === "UNKNOWN" &&
            <p>发现原 run，绑定待核；原操作仍为 UNKNOWN。</p>}
          {(operation.runId || (sub2Read?.kind === "FOUND" ? sub2Read.runId : null)) &&
            <p>原 run ID：<code>{operation.runId || (sub2Read?.kind === "FOUND" ? sub2Read.runId : "")}</code></p>}
        </div>
      )}
      <div className="v2-export-actions">
        <label>来源块
          <select value={blockId} disabled={!document || !!operation || busy}
            onChange={(event) => setBlockId(event.target.value)}>
            <option value="">请选择</option>
            {document?.blocks.map((item) =>
              <option key={item.source_block_id} value={item.source_block_id}>
                第 {item.ordinal + 1} 块 · {item.kind} · {item.end_byte - item.start_byte} 字节
              </option>)}
          </select>
        </label>
        <label>{mode === "SUB2API" ? "Sub2API" : "CPA 本地"}文本连接
          <select value={connectionId} disabled={!!operation || busy || !document}
            onChange={(event) => { setConnectionId(event.target.value); setModelId(""); }}>
            <option value="">请选择</option>
            {eligible.map((item) =>
              <option key={item.id} value={item.id}>{item.display_name} · 修订 {item.revision}</option>)}
          </select>
        </label>
        <label>TEXT 模型
          <select value={modelId} disabled={!!operation || busy || !selectedConnection}
            onChange={(event) => setModelId(event.target.value)}>
            <option value="">请选择</option>
            {models.map((item) =>
              <option key={item.model_id} value={item.model_id}>{item.model_id}</option>)}
          </select>
        </label>
        <Button disabled={!canQueue} onClick={() => void queue()}>仅入队原来源抽取</Button>
        <Button disabled={!operation || busy ||
          !(mode === "SUB2API" ? transport.sub2apiSourceExtract : transport.remoteSourceExtract)}
          onClick={() => void readOriginal()}>查询原 run</Button>
        <Button disabled={!proposalId || !operation || busy ||
          (mode === "CPA_LOOPBACK" ? operation.status !== "QUEUED" :
            sub2Read?.kind !== "FOUND" || !transport.readVersionedSourceExtractionProposal)}
          onClick={() => void readProposal()}>读取来源抽取提案</Button>
      </div>
      {mode === "SUB2API" && sub2Read?.kind === "FOUND" && (
        <div>
          <h3>原任务范围与单次调用许可</h3>
          <p>项目 <code>{sub2Read.response.data.scope.project_id}</code> ·
            任务 <code>{sub2Read.response.data.scope.task_id}</code> ·
            尝试 <code>{sub2Read.response.data.scope.attempt_id}</code></p>
          <p>来源版本 <code>{sub2Read.response.data.scope.source.source_manifest_version_id}</code> ·
            文档 <code>{sub2Read.response.data.scope.source.source_document_id}</code> ·
            块 <code>{sub2Read.response.data.scope.source.source_block_id}</code> ·
            字节 {sub2Read.response.data.scope.source.start_byte}–{sub2Read.response.data.scope.source.end_byte}</p>
          <p>连接 <code>{sub2Read.response.data.scope.selection.connection_id}</code> ·
            修订 {sub2Read.response.data.scope.selection.connection_revision} ·
            模型 <code>{sub2Read.response.data.scope.selection.model_id}</code></p>
          <p>内容状态：{sub2Read.response.data.content_status} ·
            尝试状态：{sub2Read.response.data.attempt_status} ·
            自动重试：不允许</p>
          <p role="alert">费用状态 UNKNOWN；币种、预估及实际金额均未提供。
            上游实际费用 UNKNOWN；预算执行 {sub2Read.response.data.cost.budget_enforcement}。
            本许可最多允许一次外部文本调用，可能产生未知费用。</p>
          {sub2Read.response.data.content_status === "PENDING" &&
            sub2Read.response.data.approval_id === null &&
            <label><input type="checkbox" checked={unknownCostConsent}
              disabled={busy || !sourceStillCurrent || sub2Approval.kind !== "EMPTY"}
              onChange={(event) => setUnknownCostConsent(event.target.checked)} />
              我已核对上述来源、连接与模型，并明确接受本次最多一次调用的未知费用
            </label>}
          <div className="v2-export-actions">
            <Button disabled={!canApproveOneCall}
              onClick={() => void approveOneCall()}>明确授权一次 Sub2API 调用</Button>
            <Button disabled={busy || !transport.sub2apiSourceExtract}
              onClick={() => void readOneCallApproval()}>查询原任务许可</Button>
          </div>
          {sub2Approval.kind === "BLOCKED" &&
            <p role="alert">本地许可记录不可读，已阻止提交。</p>}
          {sub2Approval.kind === "VALID" && sub2Approval.approval.status === "UNKNOWN" &&
            <p role="alert">许可 POST 结果未知；原许可意图已锁定，只能查询，不再 POST。</p>}
          {sub2Approval.kind === "VALID" && sub2Approval.approval.status === "CONSUMED" &&
            <p role="status">本地已锁定已消耗许可；只读查询原任务与提案，不再次授权。</p>}
          {sub2ApprovalRead?.kind === "FOUND" &&
            <p>权威许可：<code>{sub2ApprovalRead.response.data.approval_id}</code> ·
              状态 {sub2ApprovalRead.response.data.status} ·
              最多 {sub2ApprovalRead.response.data.allowed_calls} 次调用 ·
              费用仍未知。{sub2ApprovalRead.response.data.status === "CONSUMED"
                ? "单次许可已用；实际结果请以原任务和提案读回为准。"
                : "许可状态以原任务读回为准。"}</p>}
        </div>
      )}
      {proposal && (
        <div>
          <p>提案 ID：<code>{proposal.data.proposal_id}</code> · 待人工核对</p>
          {proposal.data.proposal.schema_version === "2.0.0" &&
            <p>执行来源 Sub2API · 许可 <code>{proposal.data.proposal.approval_id}</code> ·
              费用 UNKNOWN，预估与实际金额均未提供。</p>}
          {typeof summary === "string" && summary.length <= 10_000 &&
            <p>来源摘录摘要：{summary}</p>}
          <p>提案不等于已接纳的 SourceExtraction 草稿；须完成独立人工接纳及草稿读回。</p>
          <div className="v2-export-actions">
            <Button disabled={busy || !transport.getSourceExtraction}
              onClick={() => void readLatest()}>读取 SourceExtraction 最新状态</Button>
            <Button disabled={busy || !sourceStillCurrent || acceptance.kind !== "EMPTY" ||
              (latest.kind !== "absent" && latest.kind !== "found") ||
              !transport.proposalDecisions ||
              (mode === "SUB2API" && (operation?.status === "REJECTED" ||
                proposal.data.proposal.schema_version !== "2.0.0" ||
                sub2Read?.kind !== "FOUND" ||
                sub2Read.response.data.content_status !== "PROPOSAL_READY"))}
              onClick={() => void acceptAsDraft()}>人工接纳为草稿</Button>
            {acceptedDraftVersionId &&
              <Button disabled={busy || !transport.getSourceExtractionVersion}
                onClick={() => void readExactDraft(acceptedDraftVersionId)}>
                精确读取已接纳草稿
              </Button>}
            {acceptance.kind === "VALID" && acceptance.acceptance.status === "UNKNOWN" &&
              latest.kind === "found" &&
              latest.response.data.provenance.proposal_id === proposalId &&
              <Button disabled={busy || !transport.getSourceExtractionVersion}
                onClick={() => void readExactDraft(latest.response.data.version.id)}>
                按最新版本核对未知接纳
              </Button>}
          </div>
          {acceptance.kind === "BLOCKED" &&
            <p role="alert">本地接纳记录不可读取，已阻止再次接纳。</p>}
          {acceptance.kind === "VALID" && acceptance.acceptance.status === "UNKNOWN" &&
            <p role="alert">人工接纳结果未知，原提案已锁定；查询最新草稿可核对，不能再发接纳 POST。</p>}
        </div>
      )}
      {draft && (
        <div>
          <p>已读回 SourceExtraction 草稿版本：<code>{draft.data.version.id}</code></p>
          <p>草稿摘要：{draft.data.version.content.summary}</p>
          <p>Head 状态：{draft.data.head.accepted_version_id === draft.data.version.id
            ? "此版本已接受" : "此版本仅为草稿，未接受"}</p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
