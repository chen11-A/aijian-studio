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
import { useModelCenter } from "./account/CurrentModelLink";
import { getModelCenterSnapshot } from "./account/model-center";
import { useApiKeyFallback } from "./account/navigation";
import { dispatchGrokLoginText } from "./grok-auth/dispatch";
import { grokBridge, grokLoginFailureMessage } from "./grok-auth/transport";
import {
  acceptSourceExtractionProposal,
  queueRemoteSourceExtract,
  readOriginalRemoteSourceExtract,
  readRemoteSourceExtractJournal,
  readSub2APISourceExtractJournal,
  readSourceExtractionAcceptance,
} from "./adapters/remoteSourceExtract";
import type {
  RemoteSourceExtractJournalState,
  RemoteSourceExtractOperation,
  SourceExtractionAcceptanceState,
} from "./adapters/remoteSourceExtract";
import { Select } from "./Select";

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
  return (
    operation.projectId === projectId &&
    manifest.data.project_id === projectId &&
    !!accepted &&
    accepted.id === operation.manifestVersionId &&
    accepted.content_hash === operation.manifestContentHash
  );
}

export function SourceExtractionPanel({
  projectId,
  sourceManifest,
  sourceDocumentId,
  sourceApproved,
}: SourceExtractionPanelProps) {
  const transport = useMemo(createStudioTransport, []);
  const grokText = useModelCenter().choices.TEXT;
  const grokModel = grokText?.provider === "GROK_LOGIN" ? grokText.modelId : "";
  const epoch = useRef(0);
  const activeProject = useRef(projectId);
  activeProject.current = projectId;
  const [journal, setJournal] = useState<RemoteSourceExtractJournalState>({ kind: "EMPTY" });
  const [sub2Journal, setSub2Journal] = useState<RemoteSourceExtractJournalState>({
    kind: "EMPTY",
  });
  const [connections, setConnections] = useState<
    { kind: "loading" | "error" } | { kind: "ready"; response: ProviderConnectionListResponse }
  >({ kind: "loading" });
  const [connectionId, setConnectionId] = useState("");
  const [modelId, setModelId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [grokPreview, setGrokPreview] = useState<string | null>(null);
  const [originalRead, setOriginalRead] = useState<
    "FOUND_RUN" | "NOT_FOUND" | "REMOTE_UNKNOWN" | null
  >(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<
    ArtifactProposalResponse | SourceExtractionProposalV2Response | null
  >(null);
  const [latest, setLatest] = useState<
    { kind: "unread" | "absent" | "error" } | { kind: "found"; response: SourceExtractionResponse }
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
    setProposalId(null);
    setProposal(null);
    setLatest({ kind: "unread" });
    setAcceptance({ kind: "EMPTY" });
    setDraft(null);
    const storage = journalStorage();
    const cpaState =
      projectId && storage
        ? readRemoteSourceExtractJournal(storage, projectId)
        : projectId
          ? { kind: "BLOCKED" as const }
          : { kind: "EMPTY" as const };
    const sub2State =
      projectId && storage
        ? readSub2APISourceExtractJournal(storage, projectId)
        : projectId
          ? { kind: "BLOCKED" as const }
          : { kind: "EMPTY" as const };
    setJournal(cpaState);
    setSub2Journal(sub2State);
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
    return () => {
      epoch.current += 1;
    };
  }, [projectId, transport]);

  const manifest = sourceManifest?.data.project_id === projectId ? sourceManifest : null;
  const accepted = manifest?.data.accepted_version;
  const acceptedCurrent =
    !!sourceApproved &&
    !!accepted &&
    accepted.id === manifest?.data.head.accepted_version_id &&
    accepted.id === manifest?.data.head.latest_version_id &&
    accepted.id === manifest?.data.latest_version.id &&
    accepted.content_hash === manifest?.data.latest_version.content_hash;
  const document =
    acceptedCurrent && accepted
      ? accepted.content.documents.find((item) => item.source_document_id === sourceDocumentId)
      : null;
  const block = document?.blocks.find((item) => item.source_block_id === blockId);
  const eligible =
    connections.kind === "ready"
      ? connections.response.data.filter(
          (item) =>
            (item.provider_kind === "CPA_LOOPBACK" || item.provider_kind === "XAI") &&
            item.enabled &&
            item.credential_status === "CONFIGURED" &&
            item.models.some((model) => model.capabilities.includes("TEXT")),
        )
      : [];
  const selectedConnection = eligible.find((item) => item.id === connectionId);
  const models =
    selectedConnection?.models.filter((item) => item.capabilities.includes("TEXT")) ?? [];
  const selectedModel = models.find((item) => item.model_id === modelId);
  const operation = journal.kind === "VALID" ? journal.operation : null;
  const acceptedDraftVersionId =
    acceptance.kind === "VALID" ? acceptance.acceptance.draftVersionId : null;
  const sourceStillCurrent =
    !!operation &&
    !!manifest &&
    !!projectId &&
    acceptedCurrent &&
    !!document &&
    sourceDocumentId === operation.sourceDocumentId &&
    document.blocks.some(
      (item) =>
        item.source_block_id === operation.sourceBlockId &&
        item.content_sha256 === operation.sourceBlockHash &&
        item.start_byte === operation.startByte &&
        item.end_byte === operation.endByte,
    ) &&
    sameOriginalSource(operation, projectId, manifest);
  const canQueue =
    !!projectId &&
    !!document &&
    !!block &&
    !!selectedConnection &&
    !!selectedModel &&
    journal.kind === "EMPTY" &&
    sub2Journal.kind === "EMPTY" &&
    !busy &&
    !!transport.remoteSourceExtract;

  async function queue() {
    const storage = journalStorage();
    if (
      !canQueue ||
      !storage ||
      !projectId ||
      !accepted ||
      !document ||
      !block ||
      !selectedConnection ||
      !selectedModel
    )
      return;
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
    const result = await queueRemoteSourceExtract(
      transport.remoteSourceExtract,
      storage,
      identity,
      selectedConnection.provider_kind === "XAI" ? "grok_login" : "gpt_login",
    );
    if (epoch.current !== request || activeProject.current !== requested) return;
    setBusy(false);
    setJournal(readRemoteSourceExtractJournal(storage, requested));
    setNotice(
      result.kind === "QUEUED"
        ? selectedConnection.provider_kind === "XAI"
          ? "已按 grok_login 入队。当前派发端点只接受 CPA 回环，不会调用 xAI，也不会借用 ChatGPT 回环。"
          : "服务端已创建待授权任务；尚未授权派发，也未调用供应商。"
        : result.kind === "REJECTED"
          ? "服务端拒绝了这次提交。原操作仍保留，不能重复提交。"
          : result.kind === "TRACKED"
            ? "已有原操作，没有重复提交。请读取原操作。"
            : result.kind === "UNAVAILABLE"
              ? result.message
              : "排队结果未知；原操作已锁定，只可查询，不能重新提交。",
    );
  }

  async function generateWithGrokLogin() {
    if (busy || !projectId || !document || !block) {
      setNotice("请先选择项目和来源块。用 Grok 账号生成不会进入服务端队列。");
      return;
    }
    const choice = getModelCenterSnapshot().choices.TEXT;
    if (choice?.provider !== "GROK_LOGIN") {
      setNotice("请先在模型中心选择 Grok 账号里的文本模型。本次没有调用。");
      return;
    }
    const bridge = grokBridge();
    if (!bridge) {
      setNotice(grokLoginFailureMessage("DESKTOP_REQUIRED"));
      return;
    }
    if (!transport.getSourceText) {
      setNotice("读不到来源正文，未调用 Grok。");
      return;
    }
    const requested = projectId;
    const request = ++epoch.current;
    const start = block.start_byte;
    const end = block.end_byte;
    const sourceId = document.source_document_id;
    setBusy(true);
    try {
      const loaded = await transport.getSourceText(requested, sourceId);
      if (epoch.current !== request || activeProject.current !== requested) return;
      const bytes = new TextEncoder().encode(loaded.data.normalized_text);
      const excerpt = new TextDecoder().decode(bytes.slice(start, end)).trim();
      if (!excerpt) {
        setNotice("这段来源没有可发送的正文，未调用 Grok。");
        return;
      }
      const result = await dispatchGrokLoginText(bridge, {
        model: choice.modelId,
        text: `你在阅读来源正文。只根据正文整理，不要编造正文里没有的事。用户确认之前，不要改作品。\n\n正文：\n${excerpt.slice(0, 7500)}`,
        projectId,
      });
      if (epoch.current !== request || activeProject.current !== requested) return;
      setNotice(result.message);
      setGrokPreview(result.kind === "OK" ? result.text : null);
    } catch {
      if (epoch.current === request && activeProject.current === requested) {
        setNotice("来源正文没有读成，未调用 Grok。");
      }
    } finally {
      if (epoch.current === request) setBusy(false);
    }
  }

  async function readOriginal() {
    const storage = journalStorage();
    if (!storage || !operation || busy || !transport.remoteSourceExtract) return;
    const requested = operation.projectId;
    const request = ++epoch.current;
    setBusy(true);
    const result = await readOriginalRemoteSourceExtract(
      transport.remoteSourceExtract,
      storage,
      operation,
    );
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
    setProposalId(
      operation.status === "QUEUED" && result.kind === "FOUND_RUN" ? result.proposalId : null,
    );
    setNotice(
      result.kind === "FOUND_RUN"
        ? operation.status === "UNKNOWN"
          ? "发现上次任务，但排队绑定尚未核实；结果仍未知，不能重新提交。"
          : result.proposalId
            ? "已按原操作读到上次任务；请单独读取提案核对内容。"
            : "已按原操作读到上次任务；尚无可核对的提案。"
        : result.kind === "NOT_FOUND"
          ? "未找到上次任务；原操作状态不变，不能重新提交。"
          : "上次任务查询未知；保留原操作状态，不能重新提交。",
    );
  }

  async function readProposal() {
    if (!projectId || !proposalId || !operation || busy) return;
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
          setNotice(
            versioned.kind === "FOUND_V2"
              ? "原操作读到另一版本的提案，版本与执行来源不匹配；已阻止接纳。"
              : "原 CPA 提案未找到或读取未知；保留原操作，不重试提交。",
          );
          setProposal(null);
        }
        return;
      }
      const response =
        versioned?.receipt ?? (await transport.getArtifactProposal(requested, proposalId));
      if (epoch.current !== request || activeProject.current !== requested) return;
      const value = response.data.proposal;
      const sourceMatches = value.source_spans.some(
        (span) =>
          span.source_document_id === operation.sourceDocumentId &&
          span.source_block_id === operation.sourceBlockId &&
          span.start_byte >= operation.startByte &&
          span.end_byte <= operation.endByte,
      );
      if (
        response.data.project_id !== requested ||
        response.data.proposal_id !== proposalId ||
        value.target_artifact_type !== "SourceExtraction" ||
        value.producer_agent_run_id !== operation.runId ||
        !sourceMatches
      ) {
        setNotice("提案身份或来源证据不匹配，已丢弃回包。");
        setProposal(null);
      } else {
        setProposal(response);
        const storage = journalStorage();
        setAcceptance(
          storage
            ? readSourceExtractionAcceptance(storage, requested, proposalId)
            : { kind: "BLOCKED" },
        );
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
    if (
      !operation ||
      !proposal ||
      !proposalId ||
      response.data.project_id !== requested ||
      response.data.version.id !== expectedVersionId ||
      response.data.provenance.proposal_id !== proposalId ||
      response.data.provenance.producer_attempt_id !== proposal.data.producer_attempt_id ||
      response.data.version.content_hash !== proposal.data.proposal.payload_hash ||
      response.data.head.artifact_id !== response.data.version.artifact_id ||
      !response.data.dependencies.some(
        (item) =>
          item.upstream_version_id === operation.manifestVersionId &&
          item.relationship === "derived_from" &&
          item.impact === "blocking",
      )
    )
      return false;
    return response.data.source_spans.some(
      (span) =>
        span.source_document_id === operation.sourceDocumentId &&
        span.source_block_id === operation.sourceBlockId &&
        span.start_byte >= operation.startByte &&
        span.end_byte <= operation.endByte,
    );
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
      setNotice("还没有来源提取草稿。人工接纳会从空白开始。");
    } else if (
      result.kind === "FOUND" &&
      result.receipt.data.project_id === requested &&
      result.receipt.data.head.latest_version_id === result.receipt.data.version.id &&
      result.receipt.data.head.artifact_id === result.receipt.data.version.artifact_id &&
      Number.isSafeInteger(result.receipt.data.head.revision) &&
      result.receipt.data.head.revision > 0
    ) {
      setLatest({ kind: "found", response: result.receipt });
      setNotice("已读到现有来源提取。人工接纳会带上当前版本。");
    } else {
      setLatest({ kind: "error" });
      setNotice("来源提取没有读全，已阻止人工接纳。");
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
      setNotice("已读回和原提案、来源一致的草稿。");
    } else {
      setDraft(null);
      setNotice("草稿精确读回失败或身份不符；接纳回执与草稿展示保持分离。");
    }
  }

  async function acceptAsDraft() {
    const storage = journalStorage();
    if (
      !storage ||
      !projectId ||
      !operation ||
      !proposal ||
      !proposalId ||
      operation.status !== "QUEUED" ||
      acceptance.kind !== "EMPTY" ||
      (latest.kind !== "absent" && latest.kind !== "found") ||
      !sourceStillCurrent ||
      busy
    )
      return;
    const requested = projectId;
    const request = ++epoch.current;
    setBusy(true);
    const parentVersionId =
      latest.kind === "found" ? latest.response.data.head.latest_version_id : null;
    const expectedRevision = latest.kind === "found" ? latest.response.data.head.revision : null;
    const result = await acceptSourceExtractionProposal(
      transport,
      storage,
      operation,
      proposalId,
      parentVersionId,
      expectedRevision,
    );
    if (epoch.current !== request || activeProject.current !== requested) return;
    setBusy(false);
    setAcceptance(readSourceExtractionAcceptance(storage, requested, proposalId));
    if (result.kind === "ACCEPTED") {
      setNotice("人工接纳回执已保存；仍需精确读取草稿版本。");
      if (result.acceptance.draftVersionId) void readExactDraft(result.acceptance.draftVersionId);
    } else {
      setNotice(
        result.kind === "UNAVAILABLE"
          ? result.message
          : result.kind === "UNKNOWN" && result.serverError
            ? "人工接纳没有确认。请刷新最新草稿核对，不能重复提交。"
            : "人工接纳结果未知或已有接纳记录；保留锁，不能重复提交。请只读核对。",
      );
    }
  }

  const summary = proposal?.data.proposal.payload.summary;
  return (
    <section className="v2-media-card" aria-label="真实远程来源抽取">
      <h2>真实远程来源抽取 · 首批文本</h2>
      <p>用已登录的 Grok 账号写这一段。登录信息只留在这台电脑上，不会出现在页面里。</p>
      {!projectId ? (
        <p role="status">请先选择真实项目。</p>
      ) : !acceptedCurrent || !document ? (
        <p role="status">还没有可写的来源。可以先在来源页放入文字，再用已登录的 Grok 写这一段。</p>
      ) : (
        <p>已接受来源，可选 {document.blocks.length} 个块。</p>
      )}
      {connections.kind === "error" && <p role="alert">连接目录读取失败；不能入队。</p>}
      {connections.kind === "ready" && eligible.length === 0 && (
        <p role="status">
          {grokModel
            ? `将使用已选择的 Grok 文本模型 ${grokModel}。`
            : "没有可用的文本连接；请先在 AI 服务页选择 Grok 文本模型。"}
        </p>
      )}
      {(journal.kind === "BLOCKED" || sub2Journal.kind === "BLOCKED") && (
        <p role="alert">本地原操作记录无法安全读取，已阻止再次提交。</p>
      )}
      {sub2Journal.kind === "VALID" && (
        <p role="status">此项目已有已停用通道的历史来源操作，已阻止并列入队。</p>
      )}
      {operation && (
        <div>
          <p>已记下一次来源操作，保留在这台电脑上。</p>
          <p role="status">
            {operation.status === "UNKNOWN"
              ? "排队结果未知：保留本地锁，只允许读取上次任务，不允许重新提交。"
              : operation.status === "REJECTED"
                ? "服务端明确拒绝了入队；保留原操作，不能自动或手动重复提交。"
                : "仅有入队回执：尚未授权派发或证明供应商调用。"}
          </p>
          {operation.rejection && <p>这次提交被拒绝，原操作仍保留。</p>}
          {!sourceStillCurrent && <p role="status">原来源已不是当前已接受版本；保留原操作记录。</p>}
          {originalRead === "FOUND_RUN" && operation.status === "UNKNOWN" && (
            <p>发现上次任务，绑定待核；原操作仍未确认。</p>
          )}
          {operation.runId && <p>上次任务已经记下。</p>}
        </div>
      )}
      <div className="v2-export-actions">
        <label>
          来源块
          <Select
            value={blockId}
            disabled={!document || !!operation || busy}
            onChange={(event) => setBlockId(event.target.value)}
          >
            {!document?.blocks.length && <option value="">还没有来源块</option>}
            {document?.blocks.map((item) => (
              <option key={item.source_block_id} value={item.source_block_id}>
                第 {item.ordinal + 1} 块 · {item.kind} · {item.end_byte - item.start_byte} 字节
              </option>
            ))}
          </Select>
        </label>
        <label>
          文本连接
          <Select
            value={connectionId || (grokModel ? "grok-login" : "")}
            disabled={!!operation || busy || (!document && !grokModel)}
            onChange={(event) => {
              const value = event.target.value === "grok-login" ? "" : event.target.value;
              setConnectionId(value);
              setModelId("");
            }}
          >
            {!eligible.length && !grokModel && <option value="">还没有文本连接</option>}
            {grokModel && <option value="grok-login">Grok 账号</option>}
            {eligible.map((item) => (
              <option key={item.id} value={item.id}>
                {item.display_name} · 修订 {item.revision}
              </option>
            ))}
          </Select>
        </label>
        <label>
          文本模型
          <Select
            value={modelId || (!selectedConnection ? grokModel : "")}
            disabled={!!operation || busy || (!selectedConnection && !grokModel)}
            onChange={(event) => setModelId(event.target.value)}
          >
            {!models.length && !grokModel && <option value="">还没有文本模型</option>}
            {grokModel && !models.some((item) => item.model_id === grokModel) && (
              <option value={grokModel}>{grokModel}</option>
            )}
            {models.map((item) => (
              <option key={item.model_id} value={item.model_id}>
                {item.model_id}
              </option>
            ))}
          </Select>
        </label>
        <Button disabled={!canQueue} onClick={() => void queue()}>
          仅入队原来源抽取
        </Button>
        <Button
          disabled={busy || (!block && !grokModel)}
          onClick={() => void generateWithGrokLogin()}
        >
          用 Grok 账号生成这段文本
        </Button>
        <Button
          disabled={!operation || busy || !transport.remoteSourceExtract}
          onClick={() => void readOriginal()}
        >
          查看上次结果
        </Button>
        <Button
          disabled={!proposalId || !operation || busy || operation.status !== "QUEUED"}
          onClick={() => void readProposal()}
        >
          读取来源抽取提案
        </Button>
      </div>
      {grokPreview && (
        <p>
          Grok 登录生成结果（未写入提案）：<span>{grokPreview}</span>
        </p>
      )}
      {proposal && (
        <div>
          <p>提案已读回，待人工核对。</p>
          {proposal.data.proposal.schema_version === "2.0.0" && (
            <p>历史提案 · 费用 UNKNOWN，预估与实际金额均未提供。</p>
          )}
          {typeof summary === "string" && summary.length <= 10_000 && (
            <p>来源摘录摘要：{summary}</p>
          )}
          <p>提案还不是已接纳的草稿。需要单独确认，再读回草稿。</p>
          <div className="v2-export-actions">
            <Button
              disabled={busy || !transport.getSourceExtraction}
              onClick={() => void readLatest()}
            >
              读取来源提取的最新状态
            </Button>
            <Button
              disabled={
                busy ||
                !sourceStillCurrent ||
                acceptance.kind !== "EMPTY" ||
                (latest.kind !== "absent" && latest.kind !== "found") ||
                !transport.proposalDecisions
              }
              onClick={() => void acceptAsDraft()}
            >
              人工接纳为草稿
            </Button>
            {acceptedDraftVersionId && (
              <Button
                disabled={busy || !transport.getSourceExtractionVersion}
                onClick={() => void readExactDraft(acceptedDraftVersionId)}
              >
                精确读取已接纳草稿
              </Button>
            )}
            {acceptance.kind === "VALID" &&
              acceptance.acceptance.status === "UNKNOWN" &&
              latest.kind === "found" &&
              latest.response.data.provenance.proposal_id === proposalId && (
                <Button
                  disabled={busy || !transport.getSourceExtractionVersion}
                  onClick={() => void readExactDraft(latest.response.data.version.id)}
                >
                  按最新版本核对未知接纳
                </Button>
              )}
          </div>
          {acceptance.kind === "BLOCKED" && (
            <p role="alert">本地接纳记录不可读取，已阻止再次接纳。</p>
          )}
          {acceptance.kind === "VALID" && acceptance.acceptance.status === "UNKNOWN" && (
            <p role="alert">人工接纳结果未知，原提案已锁定；可以核对最新草稿，不能再次提交。</p>
          )}
        </div>
      )}
      {draft && (
        <div>
          <p>已读回来源提取草稿。</p>
          <p>草稿摘要：{draft.data.version.content.summary}</p>
          <p>
            Head 状态：
            {draft.data.head.accepted_version_id === draft.data.version.id
              ? "此版本已接受"
              : "此版本仅为草稿，未接受"}
          </p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {notice.includes("改用密钥") && (
        <Button onClick={() => useApiKeyFallback()}>改用密钥（高级备用）</Button>
      )}
    </section>
  );
}
