import { useEffect, useMemo, useRef, useState } from "react";
import type {
  OfficialDirectorGenerate,
  OfficialDirectorOperation,
} from "@aijian/contracts/official-director";
import { sameStoryboardJson } from "./adapters/episodeStoryboard";
import { prepareDirectorAction, directorOutcomeMessage } from "./adapters/officialDirectorAction";
import { useOfficialDirectorRecords } from "./useOfficialDirectorRecords";
import { useOfficialConnection } from "./chatgpt-auth/ChatGPTConnectionContext";
import { verifySelectedModel } from "./chatgpt-auth/verifySelectedModel";
import { readHumanShotPlanPreparation } from "./adapters/humanShotPlan";
import { readDirectorJournal } from "./adapters/officialDirectorJournal";
import { commitDirectorCommand, recoverDirectorCommand } from "./adapters/officialDirectorProposal";

import type { OfficialDirectorPanelProps } from "./officialDirectorTypes";
export type { OfficialDirectorPanelProps } from "./officialDirectorTypes";
export const defaultDirectorIntent = "依据已确认剧本和制作意图，规划完整覆盖的分镜镜头。";

export function useOfficialDirectorProposals(props: OfficialDirectorPanelProps) {
  const account = useOfficialConnection();
  const { projectId, episodeId, bridge, preparationGateway } = props;
  const storage = useMemo(() => {
    if (props.storage !== undefined) return props.storage;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, [props.storage]);
  const [journal, setJournal] = useState(() => readDirectorJournal(storage, projectId, episodeId));
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState(defaultDirectorIntent);
  const [count, setCount] = useState<number | null>(null);
  const [pacing, setPacing] = useState<OfficialDirectorGenerate["options"]["pacing"]>("BALANCED");
  const [reason, setReason] = useState("");
  const [submittedOptions, setSubmittedOptions] = useState("");
  const epoch = useRef(0);
  const flight = useRef(false);
  const records = useOfficialDirectorRecords({
    props,
    storage,
    epoch,
    flight,
    setBusy,
    setJournal,
  });
  const { preparation, setPreparation, operations, setOperations, readState, setNotice, model } =
    records;
  useEffect(() => {
    setIntent(defaultDirectorIntent);
    setCount(null);
    setPacing("BALANCED");
    setReason("");
    setSubmittedOptions("");
  }, [projectId, episodeId, bridge, preparationGateway, storage]);
  const live = useRef(props);
  live.current = props;
  const externalBlocked = props.scriptDirty || props.storyboardDirty || props.pendingOperations;
  const baseStale =
    !!preparation &&
    props.currentStoryboardBase !== undefined &&
    !sameStoryboardJson(preparation.storyboard_base, props.currentStoryboardBase);
  const unknown = operations.some((item) => item.status === "REMOTE_UNKNOWN");
  const pending = journal.kind !== "EMPTY" || unknown;
  const storyboardPending =
    journal.kind === "BLOCKED" || (journal.kind === "PENDING" && journal.command.kind === "ADOPT");
  const optionsKey = JSON.stringify({ intent, count, pacing });
  const dirty =
    !!reason ||
    (submittedOptions
      ? optionsKey !== submittedOptions
      : intent !== defaultDirectorIntent || count !== null || pacing !== "BALANCED");
  const locked =
    busy || pending || externalBlocked || baseStale || readState !== "ready" || !bridge || !storage;
  useEffect(() => {
    props.onWorkStateChange?.({ dirty, pending, busy, storyboardPending });
  }, [props.onWorkStateChange, dirty, pending, busy, storyboardPending]);
  const enter = () => {
    if (flight.current) return false;
    flight.current = true;
    setBusy(true);
    return true;
  };
  const leave = (ticket: number) => {
    if (ticket !== epoch.current) return;
    flight.current = false;
    setBusy(false);
  };
  async function perform(
    kind: "GENERATE" | "ADOPT" | "REJECT" | "RECOVER",
    operation?: OfficialDirectorOperation,
  ) {
    if (!bridge || !storage || (kind !== "RECOVER" && locked) || !enter()) return;
    const ticket = epoch.current;
    const guard = () =>
      ticket === epoch.current &&
      !live.current.scriptDirty &&
      !live.current.storyboardDirty &&
      !live.current.pendingOperations &&
      (live.current.currentStoryboardBase === undefined ||
        sameStoryboardJson(
          preparation?.storyboard_base ?? null,
          live.current.currentStoryboardBase,
        ));
    try {
      const expectedProfileId =
        kind === "GENERATE" && account
          ? await verifySelectedModel(account, projectId, model)
          : null;
      if (kind === "GENERATE" && !expectedProfileId) {
        setNotice("当前账号或模型目录已变化，未发送。请重新读取模型并核对选择。");
        return;
      }
      if (kind === "RECOVER") {
        const result = await recoverDirectorCommand(bridge, storage, projectId, episodeId);
        await apply(result, ticket);
        return;
      }
      const action = prepareDirectorAction({
        kind,
        bridge,
        projectId,
        episodeId,
        preparation,
        model,
        expectedProfileId,
        intent,
        count,
        pacing,
        reason,
        operation,
      });
      if (!action) return;
      const result = await commitDirectorCommand({
        bridge,
        storage,
        project: projectId,
        episode: episodeId,
        command: action.command,
        guard,
        transmit: action.transmit,
      });
      if (ticket !== epoch.current) return;
      if (kind === "GENERATE" && result.kind === "CONFIRMED") setSubmittedOptions(optionsKey);
      await apply(result, ticket);
    } catch {
      if (ticket === epoch.current)
        setNotice("本次操作未能完整核对。请只读查看记录；不会自动重发。");
    } finally {
      if (ticket === epoch.current) setJournal(readDirectorJournal(storage, projectId, episodeId));
      leave(ticket);
    }
  }
  async function apply(result: Awaited<ReturnType<typeof recoverDirectorCommand>>, ticket: number) {
    if (ticket !== epoch.current) return;
    setJournal(readDirectorJournal(storage, projectId, episodeId));
    if (result.kind === "CONFIRMED") {
      if (result.operation.rejection) setReason("");
      setOperations((current) => [
        result.operation,
        ...current.filter(
          (item) => item.request.operation_id !== result.operation.request.operation_id,
        ),
      ]);
      if (
        result.operation.adoption &&
        !live.current.storyboardDirty &&
        !live.current.pendingOperations
      ) {
        await live.current.onAdopted();
        if (ticket !== epoch.current) return;
        const inputs = preparationGateway
          ? await readHumanShotPlanPreparation(preparationGateway, projectId, episodeId)
          : null;
        if (ticket === epoch.current)
          setPreparation(inputs?.kind === "PREPARED" ? inputs.preparation : null);
      }
    }
    if (ticket === epoch.current) setNotice(directorOutcomeMessage(result));
  }
  return {
    ...records,
    journal,
    busy,
    intent,
    setIntent,
    count,
    setCount,
    pacing,
    setPacing,
    reason,
    setReason,
    locked,
    externalBlocked,
    baseStale,
    unknown,
    generate: () => perform("GENERATE"),
    adopt: (operation: OfficialDirectorOperation) => perform("ADOPT", operation),
    reject: (operation: OfficialDirectorOperation) => perform("REJECT", operation),
    recover: () => perform("RECOVER"),
  };
}
