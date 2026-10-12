import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  visualContent,
  visualJson,
  visualReadData,
  visualIndexData,
  visualReadinessData,
  visualAuthorityData,
  visualReviewStateData,
  visualOperationData,
  visualInspectionData,
  visualSaveOperationData,
  visualTicketData,
  visualEnvironmentEvidenceMatches,
  type VisualContent,
  type VisualRead,
  type VisualIndex,
  type VisualAuthority,
  type VisualReadiness,
  type VisualReviewState,
  type VisualAction,
} from "@aijian/contracts/visual-bible";
import type { VisualHistoryEntry } from "@aijian/contracts/visual-bible";
import {
  readCreativeLibrary,
  validCreativeVersion,
  type CreativeVersion,
  type CreativeGateway,
} from "./adapters/creativeLibrary";
import { parseAssetListReceipt, type MediaAsset } from "./adapters/assetLibrary";
import {
  readVisualJournal,
  writeVisualJournal,
  clearVisualJournal,
  visualGateway,
  visualNewId,
  visualBrowserHash,
  visualTicketMatches,
  type VisualPending,
} from "./visualWorkspace";

type GuardSetter = (guard: (() => boolean) | null) => void;
const DEFAULT_AREA = {
  canvas_width: 1080,
  canvas_height: 1920,
  x: 54,
  y: 96,
  width: 972,
  height: 1728,
};
export function useVisualWorkspace(projectId: string, setNavigationGuard: GuardSetter) {
  const gateway = useMemo(visualGateway, []);
  const [index, setIndex] = useState<VisualIndex | null>(null),
    [selected, setSelected] = useState<VisualRead | null>(null);
  const [library, setLibrary] = useState<CreativeVersion | null>(null),
    [latestLibrary, setLatestLibrary] = useState<CreativeVersion | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]),
    [content, setContent] = useState<VisualContent | null>(null);
  const [authority, setAuthority] = useState<VisualAuthority | null>(null),
    [readiness, setReadiness] = useState<VisualReadiness | null>(null),
    [review, setReview] = useState<VisualReviewState | null>(null);
  const [journal, setJournal] = useState(() => readVisualJournal(projectId));
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [notice, setNotice] = useState("正在核对视觉版本…"),
    [rationale, setRationale] = useState("");
  const [summary, setSummary] = useState("保存人工视觉候选");
  const [area, setArea] = useState<Record<keyof typeof DEFAULT_AREA, string>>(
    () =>
      Object.fromEntries(Object.entries(DEFAULT_AREA).map(([k, v]) => [k, String(v)])) as Record<
        keyof typeof DEFAULT_AREA,
        string
      >,
  );
  const epoch = useRef(0),
    ownPending = useRef<VisualPending | null>(journal.kind === "PENDING" ? journal.value : null),
    inFlight = useRef(false),
    state = useRef({ busy: false, dirty: false, journal });
  const parsed = content
    ? {
        ...content,
        safe_area: Object.fromEntries(
          Object.entries(area).map(([k, v]) => [k, /^\d+$/.test(v) ? Number(v) : NaN]),
        ),
      }
    : null;
  const valid = visualContent(parsed, projectId);
  const candidate = valid ? parsed : null;
  const dirty =
    !!content &&
    (!selected ||
      visualJson(parsed) !== visualJson(selected.version.content) ||
      summary !== "保存人工视觉候选");
  const locked = busy || !ready || journal.kind !== "EMPTY" || !gateway;
  state.current = { busy, dirty: dirty || !!rationale, journal };
  const restore = useCallback((value: VisualContent) => {
    setContent(structuredClone(value));
    setArea(
      Object.fromEntries(Object.entries(value.safe_area).map(([k, v]) => [k, String(v)])) as Record<
        keyof typeof DEFAULT_AREA,
        string
      >,
    );
    setSummary("保存人工视觉候选");
  }, []);
  const current = (operation: number) => epoch.current === operation;
  function invalidateEvidence() {
    setAuthority(null);
    setReadiness(null);
    setReview(null);
  }
  async function openVersion(id: string, operation: number, expected?: VisualHistoryEntry) {
    if (!gateway) return false;
    const read = await gateway.getVisualBibleVersion(projectId, id);
    if (
      !current(operation) ||
      read.kind !== "FOUND" ||
      !visualReadData(read.data, projectId) ||
      read.data.version.id !== id ||
      (expected !== undefined &&
        (expected.id !== id ||
          expected.artifact_id !== read.data.version.artifact_id ||
          expected.version_number !== read.data.version.version_number ||
          expected.content_hash !== read.data.version.content_hash ||
          expected.parent_version_id !== read.data.version.parent_version_id ||
          expected.creative_library_version_id !==
            read.data.version.content.creative_library_version_id ||
          expected.creative_library_content_hash !==
            read.data.version.content.creative_library_content_hash ||
          expected.author_actor_id !== read.data.version.author_actor_id ||
          expected.change_summary !== read.data.version.change_summary ||
          expected.change_reason !== read.data.version.content.change_reason ||
          expected.created_at !== read.data.version.created_at)) ||
      (await visualBrowserHash(read.data.version.content)) !== read.data.version.content_hash ||
      !current(operation)
    )
      return false;
    const creative = window.aijian;
    if (typeof creative?.getProjectCreativeLibraryVersion !== "function") return false;
    const basis = await creative.getProjectCreativeLibraryVersion(
      projectId,
      read.data.version.content.creative_library_version_id,
    );
    if (
      !current(operation) ||
      basis.kind !== "FOUND" ||
      !validCreativeVersion(basis.receipt.data, projectId) ||
      basis.receipt.data.version_id !== read.data.version.content.creative_library_version_id ||
      (await visualBrowserHash(basis.receipt.data.content)) !== basis.receipt.data.content_hash ||
      basis.receipt.data.content_hash !== read.data.version.content.creative_library_content_hash
    )
      return false;
    const [a, r, s] = await Promise.all([
      gateway.getVisualBibleAuthority(projectId, id),
      gateway.getVisualBibleReadiness(projectId, id),
      gateway.getVisualReviewState(projectId, id),
    ]);
    if (!current(operation)) return false;
    setSelected(read.data);
    setLibrary(basis.receipt.data);
    restore(read.data.version.content);
    setAuthority(
      a.kind === "FOUND" &&
        visualAuthorityData(a.data, projectId, id) &&
        a.data.content_hash === read.data.version.content_hash
        ? a.data
        : null,
    );
    setReadiness(
      r.kind === "FOUND" &&
        visualReadinessData(r.data, projectId, id) &&
        r.data.content_hash === read.data.version.content_hash &&
        visualEnvironmentEvidenceMatches(
          read.data.version.content,
          basis.receipt.data.content,
          r.data.report,
        )
        ? r.data
        : null,
    );
    setReview(
      s.kind === "FOUND" &&
        visualReviewStateData(s.data, projectId, id) &&
        s.data.content_hash === read.data.version.content_hash &&
        s.data.reports.every((report) =>
          visualEnvironmentEvidenceMatches(
            read.data.version.content,
            basis.receipt.data.content,
            report.report,
          ),
        )
        ? s.data
        : null,
    );
    return true;
  }
  async function reload(discard = false) {
    if (inFlight.current || !gateway) return;
    if (!discard && dirty && !window.confirm("放弃未保存的视觉修改并重新读取吗？")) return;
    inFlight.current = true;
    const operation = ++epoch.current;
    setBusy(true);
    try {
      const bridge = window.aijian;
      if (
        typeof bridge?.getProjectCreativeLibrary !== "function" ||
        typeof bridge.listProjectMediaAssets !== "function"
      )
        throw new Error("Native sources unavailable");
      const [idx, basis, originals] = await Promise.all([
        gateway.getVisualBible(projectId),
        readCreativeLibrary(bridge as CreativeGateway, projectId),
        bridge.listProjectMediaAssets(projectId),
      ]);
      if (!current(operation)) return;
      if (idx.kind !== "EMPTY" && !(idx.kind === "FOUND" && visualIndexData(idx.data, projectId)))
        throw new Error("G5 readback unknown");
      setIndex(idx.kind === "FOUND" ? idx.data : null);
      setLatestLibrary(basis.kind === "FOUND" ? basis.version : null);
      setAssets(
        originals.kind === "LISTED"
          ? (parseAssetListReceipt(originals.receipt, projectId) ?? [])
          : [],
      );
      let recovered = readVisualJournal(projectId);
      if (ownPending.current?.project_id === projectId) {
        if (recovered.kind === "EMPTY") writeVisualJournal(projectId, ownPending.current);
        recovered = { kind: "PENDING", value: ownPending.current };
      } else ownPending.current = recovered.kind === "PENDING" ? recovered.value : null;
      setJournal(recovered);
      setTerminal(false);
      const id =
        recovered.kind === "PENDING" && recovered.value.kind === "review"
          ? recovered.value.ticket.version_id
          : idx.kind === "FOUND"
            ? idx.data.latest_version.id
            : null;
      if (id && !(await openVersion(id, operation)))
        throw new Error("Pinned visual source unknown");
      if (recovered.kind === "PENDING" && recovered.value.kind === "save") {
        const pendingContent = recovered.value.payload.content;
        const pinnedBasis = await bridge.getProjectCreativeLibraryVersion?.(
          projectId,
          pendingContent.creative_library_version_id,
        );
        if (!current(operation)) return;
        if (
          pinnedBasis?.kind !== "FOUND" ||
          !validCreativeVersion(pinnedBasis.receipt.data, projectId) ||
          pinnedBasis.receipt.data.version_id !== pendingContent.creative_library_version_id ||
          pinnedBasis.receipt.data.content_hash !== pendingContent.creative_library_content_hash
        )
          throw new Error("Pending save library pin unknown");
        setLibrary(pinnedBasis.receipt.data);
        restore(pendingContent);
      }
      if (!current(operation)) return;
      setReady(true);
      setNotice(
        recovered.kind === "EMPTY"
          ? "已核对作品视觉版本；保存、检查与人工审签分别操作。"
          : "原操作仍待核对，暂停修改和新写入。",
      );
    } catch {
      if (current(operation)) {
        setReady(false);
        setNotice("视觉来源或回执未通过核对，现有输入保留。");
      }
    } finally {
      if (current(operation)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    void reload(true);
    return () => {
      epoch.current++;
      inFlight.current = false;
    };
  }, [projectId, gateway]);
  useEffect(() => {
    setNavigationGuard(() => {
      if (state.current.busy || inFlight.current) {
        setNotice("操作正在核对，请等待后再切换。");
        return false;
      }
      if (ownPending.current?.project_id === projectId) {
        let durable = readVisualJournal(projectId);
        if (durable.kind === "EMPTY") {
          writeVisualJournal(projectId, ownPending.current);
          durable = readVisualJournal(projectId);
        }
        if (
          durable.kind !== "PENDING" ||
          visualJson(durable.value) !== visualJson(ownPending.current)
        ) {
          setNotice("原操作记录已丢失或被替换，无法可靠保留，暂不能离开。");
          return false;
        }
      }
      return (
        (!state.current.dirty && state.current.journal.kind === "EMPTY") ||
        window.confirm(
          state.current.journal.kind === "EMPTY"
            ? "放弃未保存的视觉输入并离开吗？"
            : "原操作结果仍待核对，记录会保留。离开此页吗？",
        )
      );
    });
    const unload = (e: BeforeUnloadEvent) => {
      if (state.current.dirty || state.current.busy || state.current.journal.kind !== "EMPTY") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", unload);
    };
  }, [setNavigationGuard, projectId]);
  function persist(value: VisualPending | null, original?: VisualPending) {
    const success = value
      ? !ownPending.current &&
        readVisualJournal(projectId).kind === "EMPTY" &&
        writeVisualJournal(projectId, value)
      : !!original && clearVisualJournal(projectId, original);
    if (!success) {
      if (original) {
        ownPending.current = original;
        if (readVisualJournal(projectId).kind === "EMPTY") writeVisualJournal(projectId, original);
      }
      setJournal(
        ownPending.current ? { kind: "PENDING", value: ownPending.current } : { kind: "BLOCKED" },
      );
      setNotice("无法可靠保留或清除原操作记录，暂停写入。请保留当前状态。");
      return false;
    }
    ownPending.current = value;
    setTerminal(false);
    setJournal(value ? { kind: "PENDING", value } : { kind: "EMPTY" });
    return true;
  }
  function updateIndex(read: VisualRead) {
    setIndex((previous) => {
      const head = read.head,
        version = read.version;
      const value = {
        project_id: projectId,
        head,
        latest_version:
          head.latest_version_id === version.id ? version : (previous?.latest_version ?? version),
        review_version:
          head.review_version_id === version.id
            ? version
            : head.review_version_id === previous?.review_version?.id
              ? (previous?.review_version ?? null)
              : null,
        accepted_version:
          head.accepted_version_id === version.id
            ? version
            : head.accepted_version_id === previous?.accepted_version?.id
              ? (previous?.accepted_version ?? null)
              : null,
      };
      return visualIndexData(value, projectId) ? value : previous;
    });
  }
  async function save() {
    if (locked || !gateway || !candidate || !summary.trim()) return;
    const key = visualNewId("vbsave");
    if (!key) return;
    const payload = {
      content: candidate,
      parent_version_id: (selected?.head ?? index?.head)?.latest_version_id ?? null,
      expected_revision: (selected?.head ?? index?.head)?.revision ?? null,
      change_summary: summary,
    };
    const original: VisualPending = { kind: "save", project_id: projectId, key, payload };
    if (!persist(original)) return;
    inFlight.current = true;
    const operation = ++epoch.current;
    setBusy(true);
    try {
      const result = await gateway.saveVisualBible(projectId, key, payload);
      if (!current(operation)) return;
      if (
        result.kind === "FOUND" &&
        visualReadData(result.data, projectId) &&
        visualJson(result.data.version.content) === visualJson(candidate) &&
        (await visualBrowserHash(result.data.version.content)) ===
          result.data.version.content_hash &&
        current(operation)
      ) {
        if (!persist(null, original)) return;
        restore(result.data.version.content);
        setSelected(result.data);
        invalidateEvidence();
        updateIndex(result.data);
        setNotice("已保存不可变视觉候选；尚未获得G5批准。");
      } else if (result.kind === "DEFINITE_SERVER_ERROR") {
        if (!persist(null, original)) return;
        setNotice(`保存被明确拒绝（${result.code}），输入保留。`);
      } else setNotice("保存结果待核对，保留原标识和完整内容，不重发。");
    } catch {
      if (current(operation)) setNotice("保存结果未知，保留原操作，不重发。");
    } finally {
      if (current(operation)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  async function act(input: VisualAction) {
    if (locked || dirty || !selected || !gateway) return;
    inFlight.current = true;
    const operation = ++epoch.current;
    setBusy(true);
    try {
      const identity = {
        project_id: projectId,
        version_id: selected.version.id,
        content_hash: selected.version.content_hash,
        expected_revision: selected.head.revision,
      };
      const prepared = await gateway.prepareVisualReview(identity, input);
      if (!current(operation)) return;
      if (
        prepared.kind !== "FOUND" ||
        !visualTicketData(prepared.data) ||
        prepared.data.project_id !== projectId ||
        prepared.data.version_id !== identity.version_id ||
        prepared.data.content_hash !== identity.content_hash ||
        prepared.data.expected_revision !== identity.expected_revision ||
        visualJson(prepared.data.input) !== visualJson(input)
      ) {
        setNotice("未获得可靠确认标识，请核对来源、技术检查、权利或评审状态。");
        return;
      }
      const original: VisualPending = {
        kind: "review",
        project_id: projectId,
        ticket: prepared.data,
      };
      if (!persist(original)) return;
      const result = await gateway.confirmVisualReview(prepared.data);
      if (!current(operation)) return;
      if (
        result.kind === "FOUND" &&
        visualOperationData(result.data, projectId, identity.version_id) &&
        (await visualTicketMatches(prepared.data, result.data)) &&
        current(operation)
      ) {
        if (!persist(null, original)) return;
        setRationale("");
        setSelected({ ...selected, head: result.data.head });
        invalidateEvidence();
        updateIndex({ ...selected, head: result.data.head });
        setNotice("本次人工动作已核对完成，请重新读取最新评审状态。");
      } else if (result.kind === "CANCELLED" || result.kind === "DEFINITE_SERVER_ERROR") {
        if (!persist(null, original)) return;
        setNotice(
          result.kind === "CANCELLED"
            ? "本次人工确认已取消，未执行审签写入。"
            : `本次动作被明确拒绝（${result.code}）。`,
        );
      } else setNotice("确认结果未知，保留原挑战；只能核对，不重发。");
    } catch {
      if (current(operation)) setNotice("本次动作结果待核对，保留原操作。");
    } finally {
      if (current(operation)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  async function inspect(assetId: string, versionId: string, sha256: string) {
    if (locked || dirty || !gateway) return;
    const operation_id = visualNewId("vinop");
    if (!operation_id) return;
    const original: VisualPending = {
      kind: "inspection",
      project_id: projectId,
      asset_id: assetId,
      asset_version_id: versionId,
      sha256,
      operation_id,
    };
    if (!persist(original)) return;
    inFlight.current = true;
    const operation = ++epoch.current;
    setBusy(true);
    try {
      const result = await gateway.inspectVisualReference(
        projectId,
        assetId,
        versionId,
        sha256,
        operation_id,
      );
      if (!current(operation)) return;
      if (
        result.kind === "FOUND" &&
        visualInspectionData(result.data, projectId) &&
        result.data.asset_id === assetId &&
        result.data.asset_version_id === versionId &&
        result.data.evidence.asset_sha256 === sha256 &&
        result.data.evidence.operation_id === operation_id &&
        result.data.evidence_hash ===
          (await visualBrowserHash(
            Object.fromEntries(
              Object.entries(result.data).filter(([key]) => key !== "evidence_hash"),
            ),
          )) &&
        current(operation)
      ) {
        if (!persist(null, original)) return;
        invalidateEvidence();
        setNotice("已保存此原始图片的技术检查证据；不表示身份或权利批准。请重新读取。 ");
      } else if (result.kind === "CANCELLED" || result.kind === "DEFINITE_SERVER_ERROR") {
        if (!persist(null, original)) return;
        setNotice("检查被取消或明确拒绝，未获得技术通过证据。");
      } else setNotice("技术检查写入待核对，保留原标识，不重发。");
    } catch {
      if (current(operation)) setNotice("技术检查结果待核对，不重发。");
    } finally {
      if (current(operation)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  const [terminal, setTerminal] = useState(false);
  async function recover() {
    if (busy || inFlight.current || journal.kind !== "PENDING" || !gateway) return;
    const original = journal.value;
    inFlight.current = true;
    const operation = ++epoch.current;
    setBusy(true);
    setTerminal(false);
    try {
      let completed = false;
      if (original.kind === "save") {
        const r = await gateway.getVisualSaveOperation(projectId, original.key, original.payload);
        completed =
          r.kind === "FOUND" &&
          visualSaveOperationData(r.data, projectId) &&
          r.data.request_hash ===
            (await visualBrowserHash({
              project_id: projectId,
              actor_id: "local-user",
              payload: original.payload,
            })) &&
          visualJson(r.data.result.version.content) === visualJson(original.payload.content) &&
          r.data.result.version.content_hash ===
            (await visualBrowserHash(r.data.result.version.content));
      } else if (original.kind === "inspection") {
        const r = await gateway.getVisualInspectionOperation(projectId, original.operation_id);
        completed =
          r.kind === "FOUND" &&
          visualInspectionData(r.data, projectId) &&
          r.data.asset_id === original.asset_id &&
          r.data.asset_version_id === original.asset_version_id &&
          r.data.evidence.asset_sha256 === original.sha256 &&
          r.data.evidence.operation_id === original.operation_id &&
          r.data.evidence_hash ===
            (await visualBrowserHash(
              Object.fromEntries(Object.entries(r.data).filter(([key]) => key !== "evidence_hash")),
            ));
      } else {
        const r = await gateway.readVisualReviewOperation(
          projectId,
          original.ticket.version_id,
          original.ticket.challenge_id,
        );
        if (
          r.kind === "FOUND" &&
          visualOperationData(r.data, projectId, original.ticket.version_id) &&
          (await visualTicketMatches(original.ticket, r.data))
        ) {
          completed = r.data.state === "COMPLETED";
          if (!completed && r.data.terminal_no_write && current(operation)) setTerminal(true);
        }
      }
      if (!current(operation)) return;
      if (completed && persist(null, original)) {
        invalidateEvidence();
        setRationale("");
        setNotice("已核对原操作的精确回执；请重新读取对象，未重发任何写入。");
      } else
        setNotice(
          "仍未核对到完成回执，保留原记录。只有服务端确认已过期且未写入的挑战可以手工结束。",
        );
    } catch {
      if (current(operation)) setNotice("原回执核对未知，保留记录，不重发。");
    } finally {
      if (current(operation)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  function newCandidate() {
    if (
      locked ||
      !latestLibrary ||
      (dirty && !window.confirm("放弃当前视觉输入，改用当前已保存设定库建立候选吗？"))
    )
      return;
    const c = latestLibrary.content;
    setLibrary(latestLibrary);
    setSelected(null);
    setAuthority(null);
    setReadiness(null);
    setReview(null);
    setRationale("");
    const base: VisualContent = {
      schema_version: "1.0.0",
      project_id: projectId,
      creative_library_version_id: latestLibrary.version_id,
      creative_library_content_hash: latestLibrary.content_hash,
      character_reference_ids:
        c.schema_version === "1.2.0" || c.schema_version === "1.3.0"
          ? c.references.map((r) => r.reference_id)
          : [],
      scenes: c.scenes.map((s) => ({ scene_id: s.scene_id, assets: [] })),
      props: [],
      safe_area: DEFAULT_AREA,
      effective_scope: "PROJECT",
      change_reason: "建立作品共享视觉候选",
    };
    restore(
      index?.latest_version.content.schema_version === "1.1.0"
        ? {
            ...base,
            schema_version: "1.1.0",
            environment_scope: {
              world_included: true,
              scene_variant_ids: [],
              environment_reference_ids: [],
            },
          }
        : base,
    );
  }
  async function selectVersion(id: string, expected?: VisualHistoryEntry) {
    if (
      inFlight.current ||
      locked ||
      (dirty && !window.confirm("放弃当前视觉输入并打开精确历史版本吗？"))
    )
      return;
    inFlight.current = true;
    const operation = ++epoch.current;
    setBusy(true);
    try {
      if (!(await openVersion(id, operation, expected)) && current(operation))
        setNotice("此精确版本或来源无法核对，输入保留。");
    } finally {
      if (current(operation)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  return {
    gateway,
    index,
    selected,
    library,
    latestLibrary,
    assets,
    content,
    candidate,
    area,
    setArea,
    summary,
    setSummary,
    rationale,
    setRationale,
    authority:
      selected &&
      authority?.version_id === selected.version.id &&
      authority.content_hash === selected.version.content_hash
        ? authority
        : null,
    readiness:
      selected &&
      readiness?.version_id === selected.version.id &&
      readiness.content_hash === selected.version.content_hash &&
      readiness.head.revision === selected.head.revision
        ? readiness
        : null,
    review:
      selected &&
      review?.version_id === selected.version.id &&
      review.content_hash === selected.version.content_hash &&
      review.head.revision === selected.head.revision
        ? review
        : null,
    journal,
    busy,
    ready,
    notice,
    dirty,
    locked,
    setContent,
    reload,
    save,
    act,
    inspect,
    recover,
    newCandidate,
    selectVersion,
    terminal,
    abandon: () => {
      if (
        terminal &&
        journal.kind === "PENDING" &&
        journal.value.kind === "review" &&
        window.confirm("服务端已确认原挑战过期且未写入。结束这次原操作记录吗？")
      )
        persist(null, journal.value);
    },
  };
}
