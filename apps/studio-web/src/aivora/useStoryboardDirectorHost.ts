import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShotPlanGateway } from "@aijian/contracts/shot-plan";
import { readScriptJournal, readConfirmationJournal } from "./adapters/episodeScript";
import { readPendingProductionBriefCommand } from "./adapters/productionBriefWorkspace";

export type DirectorWorkState = {
  dirty: boolean;
  pending: boolean;
  busy: boolean;
  storyboardPending?: boolean;
};
const idle: DirectorWorkState = { dirty: false, pending: false, busy: false };

/** One route guard covers all retained editors; switching views never discards their work. */
export function useStoryboardDirectorHost(
  projectId: string,
  episodeId: string,
  setNavigationGuard: (guard: (() => boolean) | null) => void,
) {
  const storyboardGuard = useRef<(() => boolean) | null>(null);
  const captureStoryboardGuard = useCallback((guard: (() => boolean) | null) => {
    storyboardGuard.current = guard;
  }, []);
  const [humanWork, setHumanWork] = useState(idle);
  const [officialWork, setOfficialWork] = useState(idle);
  const work = useRef({ humanWork, officialWork });
  work.current = { humanWork, officialWork };
  const onHumanWork = useCallback((value: DirectorWorkState) => setHumanWork(value), []);
  const onOfficialWork = useCallback((value: DirectorWorkState) => setOfficialWork(value), []);
  const humanGateway = useMemo(() => {
    const bridge = (window as Window & { aijianShotPlan?: ShotPlanGateway }).aijianShotPlan;
    const methods: (keyof ShotPlanGateway)[] = [
      "prepareHumanShotPlan",
      "getShotPlanProposal",
      "getShotPlanProposalVersion",
      "getHumanShotPlanWriteStatus",
      "getShotPlanAdoptionStatus",
      "createHumanShotPlanProposal",
      "adoptHumanShotPlanProposal",
    ];
    return bridge && methods.every((method) => typeof bridge[method] === "function")
      ? bridge
      : null;
  }, []);
  const [, refreshRecoveryState] = useState(0);
  useEffect(() => {
    const refresh = () => refreshRecoveryState((value) => value + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  let upstreamPending = true;
  try {
    const brief = readPendingProductionBriefCommand(projectId);
    upstreamPending =
      readScriptJournal(window.localStorage, projectId, episodeId).kind !== "EMPTY" ||
      readConfirmationJournal(window.localStorage, projectId, episodeId).kind !== "EMPTY" ||
      brief.kind !== "READY" ||
      brief.command !== null;
  } catch {
    /* Unreadable recovery state must block every new mutation. */
  }
  useEffect(() => {
    setNavigationGuard(() => {
      const { humanWork: human, officialWork: official } = work.current;
      if (human.busy || official.busy) return false;
      if (
        human.dirty &&
        !window.confirm(
          human.pending
            ? "人工导演提案有保存结果待核对，原提交恢复记录会保留。离开此页吗？"
            : "人工导演提案有未保存修改。放弃修改并离开吗？",
        )
      )
        return false;
      if (
        official.dirty &&
        !window.confirm("AI 导演有未提交的生成选项或驳回理由。放弃修改并离开吗？")
      )
        return false;
      return storyboardGuard.current?.() ?? true;
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const { humanWork: human, officialWork: official } = work.current;
      if (!human.dirty && !human.busy && !official.dirty && !official.busy) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [setNavigationGuard]);
  return {
    humanGateway,
    captureStoryboardGuard,
    upstreamPending,
    humanWork,
    officialWork,
    onHumanWork,
    onOfficialWork,
    busy: humanWork.busy || officialWork.busy,
    pending: humanWork.pending || (officialWork.storyboardPending ?? officialWork.pending),
  };
}
