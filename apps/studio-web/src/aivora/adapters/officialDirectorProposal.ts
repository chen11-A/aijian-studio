import type {
  OfficialDirectorBridge,
  OfficialDirectorGeneration,
  OfficialDirectorOperation,
} from "@aijian/contracts/official-director";
import type { ShotPlanPreparation } from "@aijian/contracts/shot-plan";
import { sameStoryboardJson } from "./episodeStoryboard";
import {
  clearDirectorCommand,
  matchesDirectorCommand,
  persistDirectorCommand,
  readDirectorJournal,
  type DirectorCommand,
  type DirectorStorage,
} from "./officialDirectorJournal";

export type DirectorOutcome =
  | { kind: "CONFIRMED"; operation: OfficialDirectorOperation }
  | { kind: "NOT_SENT"; code: string }
  | { kind: "REJECTED"; code: string }
  | { kind: "UNKNOWN" }
  | { kind: "BLOCKED"; message: string };
export function sameDirectorInputs(
  preparation: ShotPlanPreparation | null,
  operation: OfficialDirectorOperation,
) {
  return (
    !!preparation &&
    sameStoryboardJson(preparation.authority, operation.request.authority) &&
    sameStoryboardJson(preparation.storyboard_base, operation.request.storyboard_base)
  );
}
export function directorOperationInScope(
  operation: OfficialDirectorOperation,
  project: string,
  episode: string,
  operationId?: string,
) {
  return (
    operation.project_id === project &&
    operation.episode_id === episode &&
    (operationId === undefined || operation.request.operation_id === operationId)
  );
}
/** Only reads the original operation. Absence and an unfinished decision never authorize replay. */
export async function recoverDirectorCommand(
  bridge: OfficialDirectorBridge,
  storage: DirectorStorage,
  project: string,
  episode: string,
): Promise<DirectorOutcome> {
  const journal = readDirectorJournal(storage, project, episode);
  if (journal.kind !== "PENDING")
    return { kind: "BLOCKED", message: "原操作恢复记录不可读取，未发送新请求。" };
  try {
    const result = await bridge.get(project, episode, journal.command.operationId);
    if (
      result.kind !== "OK" ||
      !directorOperationInScope(result.operation, project, episode, journal.command.operationId) ||
      !matchesDirectorCommand(result.operation, journal.command) ||
      !clearDirectorCommand(storage, project, episode, journal.command)
    )
      return { kind: "UNKNOWN" };
    return { kind: "CONFIRMED", operation: result.operation };
  } catch {
    return { kind: "UNKNOWN" };
  }
}
/** Journal before IPC; main owns approval, reservation and provider execution. */
export async function commitDirectorCommand({
  bridge,
  storage,
  project,
  episode,
  command,
  guard,
  transmit,
}: {
  bridge: OfficialDirectorBridge;
  storage: DirectorStorage;
  project: string;
  episode: string;
  command: DirectorCommand;
  guard: () => boolean;
  transmit: () => Promise<OfficialDirectorGeneration>;
}): Promise<DirectorOutcome> {
  if (!guard()) return { kind: "BLOCKED", message: "输入或未保存状态已变化，本次未提交。" };
  if (!persistDirectorCommand(storage, project, episode, command))
    return { kind: "BLOCKED", message: "无法保存原操作恢复记录，本次未提交。" };
  // Recheck after persistence, including a competing window's journal.
  if (!guard()) {
    clearDirectorCommand(storage, project, episode, command);
    return { kind: "BLOCKED", message: "输入或未保存状态已变化，本次未提交。" };
  }
  try {
    const result = await transmit();
    // Native maps ambiguous 5xx/storage outcomes to UNKNOWN. ERROR is a verified
    // pre-mutation 4xx rejection and never claims an adoption/rejection receipt.
    if (
      result.kind === "ERROR" &&
      command.kind !== "GENERATE" &&
      clearDirectorCommand(storage, project, episode, command)
    )
      return { kind: "REJECTED", code: result.code };
    if (
      result.kind === "NOT_SENT" &&
      result.operationId === command.operationId &&
      clearDirectorCommand(storage, project, episode, command)
    )
      return { kind: "NOT_SENT", code: result.code };
    if (
      result.kind !== "OK" ||
      !directorOperationInScope(result.operation, project, episode, command.operationId) ||
      !matchesDirectorCommand(result.operation, command)
    )
      return { kind: "UNKNOWN" };
    return recoverDirectorCommand(bridge, storage, project, episode);
  } catch {
    return { kind: "UNKNOWN" };
  }
}
