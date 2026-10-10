import type {
  OfficialDirectorBridge,
  OfficialDirectorGenerate,
  OfficialDirectorOperation,
} from "@aijian/contracts/official-director";
import type { ShotPlanPreparation } from "@aijian/contracts/shot-plan";
import { directorGenerationCommand, type DirectorCommand } from "./officialDirectorJournal";
import { sameDirectorInputs, type DirectorOutcome } from "./officialDirectorProposal";

export function prepareDirectorAction({
  kind,
  bridge,
  projectId,
  episodeId,
  preparation,
  model,
  intent,
  count,
  pacing,
  reason,
  operation,
}: {
  kind: "GENERATE" | "ADOPT" | "REJECT";
  bridge: OfficialDirectorBridge;
  projectId: string;
  episodeId: string;
  preparation: ShotPlanPreparation | null;
  model: string;
  intent: string;
  count: number | null;
  pacing: OfficialDirectorGenerate["options"]["pacing"];
  reason: string;
  operation?: OfficialDirectorOperation;
}): {
  command: DirectorCommand;
  transmit: () => ReturnType<OfficialDirectorBridge["generate"]>;
} | null {
  if (kind === "GENERATE") {
    if (
      !preparation ||
      !model ||
      !intent.trim() ||
      [...intent].length > 4000 ||
      (count !== null && (!Number.isSafeInteger(count) || count < 1 || count > 1000))
    )
      return null;
    const input: OfficialDirectorGenerate = {
      projectId,
      episodeId,
      operationId: crypto.randomUUID(),
      model,
      authority: preparation.authority,
      storyboardBase: preparation.storyboard_base,
      intent,
      options: { target_shot_count: count, pacing },
    };
    return { command: directorGenerationCommand(input), transmit: () => bridge.generate(input) };
  }
  if (
    !operation?.proposal ||
    operation.status !== "COMPLETED" ||
    operation.adoption ||
    operation.rejection ||
    (kind === "ADOPT" &&
      (!sameDirectorInputs(preparation, operation) ||
        [...operation.proposal.content.issues, ...operation.proposal.capability_losses].some(
          (issue) => issue.severity === "BLOCKING",
        )))
  )
    return null;
  if (kind === "REJECT" && (!reason.trim() || [...reason].length > 2000 || reason.includes("\0")))
    return null;
  const payload = {
    proposal_version_id: operation.proposal.version_id,
    proposal_content_hash: operation.proposal.content_hash,
    confirm: true as const,
  };
  const command: DirectorCommand = {
    kind,
    operationId: operation.request.operation_id,
    versionId: payload.proposal_version_id,
    contentHash: payload.proposal_content_hash,
    reason: kind === "REJECT" ? reason : null,
  };
  return {
    command,
    transmit: () =>
      kind === "ADOPT"
        ? bridge.adopt(projectId, episodeId, command.operationId, payload)
        : bridge.reject(projectId, episodeId, command.operationId, { ...payload, reason }),
  };
}
export function directorOutcomeMessage(result: DirectorOutcome): string {
  if (result.kind === "BLOCKED") return result.message;
  if (result.kind === "NOT_SENT") return `此次请求未发送（${result.code}）。`;
  if (result.kind === "REJECTED")
    return `此决定未通过验证（${result.code}）。原提案保留，请重新核对输入和记录。`;
  if (result.kind === "UNKNOWN") return "结果仍待核对。不会自动重发或改用新的操作标识。";
  const operation = result.operation;
  if (operation.adoption) return "已采纳为新的可编辑分镜版本，旧版本和原剧本引用保留。";
  if (operation.rejection) return "已记录人工驳回理由，原提案保留。";
  if (operation.status === "INVALID") return "供应商输出未通过校验，未创建可采纳提案。";
  if (operation.status === "REMOTE_UNKNOWN")
    return "发送结果未知（REMOTE_UNKNOWN）。只能只读核对，不会自动重试。";
  if (operation.status === "NOT_SENT") return "已确认此次请求未发送。";
  return "AI 镜头计划已保存为待审阅提案，请明确驳回或采纳。";
}
