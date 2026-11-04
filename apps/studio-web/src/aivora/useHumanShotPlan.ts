import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ShotPlanAdoption,
  ShotPlanContent,
  ShotPlanGateway,
  ShotPlanPreparation,
  ShotPlanProposal,
} from "@aijian/contracts/shot-plan";
import {
  adoptHumanShotPlan,
  buildHumanShotPlanTemplate,
  cloneHumanShotPlanContent,
  createHumanShotPlan,
  humanShotPlanRequest,
  readHumanShotPlanJournal,
  readHumanShotPlanPreparation,
  readHumanShotPlanProposal,
  recoverHumanShotPlan,
  type HumanShotPlanJournal,
} from "./adapters/humanShotPlan";
import { sameStoryboardJson } from "./adapters/episodeStoryboard";

type GuardState = { scriptDirty: boolean; storyboardDirty: boolean; pendingOperations: boolean };
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const messageFor = (code: string) =>
  ({
    SHOT_PLAN_CONFIRMATION_REQUIRED: "请先保存并明确确认当前剧本。",
    SHOT_PLAN_PRODUCTION_BRIEF_REQUIRED: "当前剧本需绑定已有制作意图版本，请先保存该引用。",
    SHOT_PLAN_ADAPTED_SOURCE_REQUIRED: "改编剧本缺少已采纳的来源证据，请先完成来源审核。",
    SHOT_PLAN_SCRIPT_STALE: "剧本已变更，请确认新版后重新读取输入。",
    SHOT_PLAN_BRIEF_STALE: "制作意图已变更，请更新剧本引用并确认新版。",
    SHOT_PLAN_STORYBOARD_STALE: "分镜保存版本已变化，请重新读取输入并建立当前版本的提案。",
    SHOT_PLAN_PROPOSAL_STALE: "已有新版导演提案，请重新读取。",
    SHOT_PLAN_BLOCKING_ISSUES: "提案仍有阻断问题，请修订后保存新提案。",
    SHOT_PLAN_SOURCE_STALE: "来源批准已变化，请核对改编依据。",
  })[code] ?? "提案字段或版本尚不能安全使用，请核对输入后重新读取。";

export function useHumanShotPlan({
  projectId,
  episodeId,
  gateway,
  storage,
  guards,
  onAdopted,
}: {
  projectId: string;
  episodeId: string;
  gateway: ShotPlanGateway | null;
  storage: StoragePort | null;
  guards: GuardState;
  onAdopted: (adoption: ShotPlanAdoption) => void | Promise<void>;
}) {
  const [preparation, setPreparation] = useState<ShotPlanPreparation | null>(null);
  const [proposal, setProposal] = useState<ShotPlanProposal | null>(null);
  const [draft, setDraft] = useState<ShotPlanContent | null>(null);
  const [journal, setJournal] = useState<HumanShotPlanJournal>({ kind: "EMPTY" });
  const [readState, setReadState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const flight = useRef(false);
  const live = useRef({ guards, onAdopted, projectId, episodeId });
  live.current = { guards, onAdopted, projectId, episodeId };
  const dirty = draft !== null && !sameStoryboardJson(draft, proposal?.content ?? null);
  const externalBlocked = guards.scriptDirty || guards.storyboardDirty || guards.pendingOperations;
  const locked = busy || journal.kind !== "EMPTY" || externalBlocked || !gateway || !storage;

  const reload = useCallback(async () => {
    if (flight.current) return;
    if (!gateway || !storage) {
      setReadState("error");
      setNotice(
        !gateway
          ? "当前桌面版本未连接导演提案接口。"
          : "本地恢复存储不可用，无法安全保存或采纳提案。",
      );
      return;
    }
    flight.current = true;
    setBusy(true);
    const ticket = ++epoch.current;
    const pending = readHumanShotPlanJournal(storage, projectId, episodeId);
    setJournal(pending);
    const [inputs, saved] = await Promise.all([
      readHumanShotPlanPreparation(gateway, projectId, episodeId),
      readHumanShotPlanProposal(gateway, projectId, episodeId),
    ]);
    if (ticket !== epoch.current) return;
    setPreparation(inputs.kind === "PREPARED" ? inputs.preparation : null);
    if (saved.kind === "FOUND") {
      setProposal(saved.proposal);
      setDraft(cloneHumanShotPlanContent(saved.proposal.content));
    } else if (saved.kind === "EMPTY") {
      setProposal(null);
      setDraft(null);
    }
    setReadState(
      inputs.kind === "PREPARED" && (saved.kind === "FOUND" || saved.kind === "EMPTY")
        ? saved.kind === "FOUND"
          ? "ready"
          : "empty"
        : "error",
    );
    setNotice(
      inputs.kind === "REJECTED"
        ? messageFor(inputs.code)
        : inputs.kind === "UNKNOWN" || saved.kind === "UNKNOWN"
          ? "输入读取结果尚不明确，请重新读取。"
          : saved.kind === "REJECTED"
            ? messageFor(saved.code)
            : "",
    );
    flight.current = false;
    setBusy(false);
  }, [gateway, storage, projectId, episodeId]);

  useEffect(() => {
    setPreparation(null);
    setProposal(null);
    setDraft(null);
    setReadState("loading");
    flight.current = false;
    if (gateway && storage) void reload();
    else {
      setReadState("error");
      setNotice(
        !gateway
          ? "当前桌面版本未连接导演提案接口。"
          : "本地恢复存储不可用，无法安全保存或采纳提案。",
      );
    }
    return () => {
      epoch.current += 1;
      flight.current = false;
    };
  }, [gateway, storage, projectId, episodeId, reload]);

  function edit(change: (content: ShotPlanContent) => ShotPlanContent) {
    if (locked) return;
    setDraft((current) => (current ? change(current) : current));
  }
  function template(count: number) {
    if (locked || !preparation) return;
    const result = buildHumanShotPlanTemplate(preparation, count);
    if (result.kind === "BLOCKED") {
      setNotice(result.message);
      return;
    }
    setDraft(result.content);
    setNotice("已建立人工待编排模板。请逐镜审阅、修改后保存提案。");
  }
  async function mutate(kind: "CREATE" | "ADOPT" | "RECOVER") {
    if (flight.current || !gateway || !storage || (kind !== "RECOVER" && locked)) return;
    if (kind !== "RECOVER" && !draft) return;
    const ticket = epoch.current;
    const scope = `${projectId}:${episodeId}`;
    const guard = () => {
      const current = live.current;
      return (
        ticket === epoch.current &&
        scope === `${current.projectId}:${current.episodeId}` &&
        !current.guards.scriptDirty &&
        !current.guards.storyboardDirty &&
        !current.guards.pendingOperations
      );
    };
    flight.current = true;
    setBusy(true);
    setNotice("");
    try {
      const operationId = kind === "RECOVER" ? null : crypto.randomUUID();
      const result =
        kind === "RECOVER"
          ? await recoverHumanShotPlan(gateway, storage, projectId, episodeId)
          : kind === "CREATE" && draft && operationId
            ? await createHumanShotPlan(
                gateway,
                storage,
                projectId,
                episodeId,
                operationId,
                humanShotPlanRequest(draft, proposal, "保存人工导演提案"),
                guard,
              )
            : proposal && draft && operationId
              ? await adoptHumanShotPlan(
                  gateway,
                  storage,
                  projectId,
                  episodeId,
                  proposal,
                  operationId,
                  draft,
                  guard,
                )
              : { kind: "BLOCKED" as const, message: "请先保存并审阅提案。" };
      if (ticket !== epoch.current) return;
      setJournal(readHumanShotPlanJournal(storage, projectId, episodeId));
      if (result.kind === "SAVED" || result.kind === "ADOPTED") {
        setProposal(result.proposal);
        setDraft(cloneHumanShotPlanContent(result.proposal.content));
        setReadState("ready");
        setNotice(
          result.kind === "ADOPTED"
            ? "已采纳到新的分镜版本，旧版本完整保留。"
            : "人工提案已保存，请审阅后明确采纳。",
        );
        if (result.kind === "ADOPTED" && result.proposal.adoption) {
          await live.current.onAdopted(result.proposal.adoption);
          const inputs = await readHumanShotPlanPreparation(gateway, projectId, episodeId);
          if (ticket === epoch.current)
            setPreparation(inputs.kind === "PREPARED" ? inputs.preparation : null);
        }
      } else
        setNotice(
          result.kind === "BLOCKED"
            ? result.message
            : result.kind === "REJECTED"
              ? messageFor(result.code)
              : "提交结果尚不明确。请核对原提交；不会自动重复保存或采纳。",
        );
    } catch {
      if (ticket === epoch.current) {
        setJournal(readHumanShotPlanJournal(storage, projectId, episodeId));
        setNotice("结果尚需核对，请检查原提交状态或重新读取分镜。");
      }
    } finally {
      if (ticket === epoch.current) {
        flight.current = false;
        setBusy(false);
      }
    }
  }
  return {
    preparation,
    proposal,
    draft,
    journal,
    readState,
    busy,
    notice,
    dirty,
    locked,
    externalBlocked,
    reload,
    edit,
    template,
    save: () => mutate("CREATE"),
    adopt: () => mutate("ADOPT"),
    recover: () => mutate("RECOVER"),
  };
}
