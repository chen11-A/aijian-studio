import {
  OFFICIAL_TEXT_CHANNELS,
  episodeId,
  operationId,
  projectId,
  validAdopt,
  validGenerate,
} from "./official-text-contract";
import type {
  OfficialTextCompletion,
  OfficialTextGenerate,
  OfficialTextGeneration,
} from "@aijian/contracts/official-text";
import type {
  ChatGPTTextCommand,
  ChatGPTTextOptions,
  ChatGPTTextResult,
} from "./chatgpt-auth-generation";
import { textRequestHash } from "./chatgpt-auth-generation";
import type { OfficialTextPersistenceClient } from "./official-text-client";

type Runtime = {
  generateText(input: ChatGPTTextCommand, options: ChatGPTTextOptions): Promise<ChatGPTTextResult>;
};
/** Main-only orchestration: renderer can request generation, but cannot supply its alleged result. */
export function registerOfficialTextHandlers<Event>(
  handle: (
    channel: string,
    listener: (event: Event, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: Event) => OfficialTextPersistenceClient,
  authorized: (event: Event) => boolean,
  runtimeFor: () => Runtime,
): void {
  const busy = new Set<string>();
  function client(event: Event): OfficialTextPersistenceClient {
    if (!authorized(event)) throw new Error("Official text IPC sender is not authorized");
    return clientFor(event);
  }
  function scope(args: unknown[]): asserts args is [string, string, ...unknown[]] {
    if (!projectId(args[0]) || !episodeId(args[1])) throw new Error("Invalid official text scope");
  }
  handle(OFFICIAL_TEXT_CHANNELS.list, async (event, ...args) => {
    const api = client(event);
    scope(args);
    if (args.length !== 2) throw new Error("Invalid official text list arguments");
    return api.listOfficialText(args[0], args[1]);
  });
  handle(OFFICIAL_TEXT_CHANNELS.get, async (event, ...args) => {
    const api = client(event);
    scope(args);
    if (args.length !== 3 || !operationId(args[2]))
      throw new Error("Invalid official text read arguments");
    return api.getOfficialText(args[0], args[1], args[2]);
  });
  handle(OFFICIAL_TEXT_CHANNELS.adopt, async (event, ...args) => {
    const api = client(event);
    scope(args);
    if (args.length !== 4 || !operationId(args[2]) || !validAdopt(args[3]))
      throw new Error("Invalid official text adoption arguments");
    const written = await api.adoptOfficialText(args[0], args[1], args[2], args[3]);
    if (written.kind !== "OK") return written;
    const read = await api.getOfficialText(args[0], args[1], args[2]);
    return read.kind === "OK" &&
      read.operation.adoption &&
      read.operation.proposal?.version_id === args[3].proposal_version_id &&
      read.operation.proposal.content_hash === args[3].proposal_content_hash &&
      read.operation.adoption.script_version_id === written.operation.adoption?.script_version_id &&
      read.operation.adoption.script_content_hash === written.operation.adoption.script_content_hash
      ? read
      : { kind: "UNKNOWN" };
  });
  handle(OFFICIAL_TEXT_CHANNELS.generate, async (event, ...args) => {
    const api = client(event);
    if (args.length !== 1 || !validGenerate(args[0]))
      throw new Error("Invalid official text generation arguments");
    const command = args[0];
    const key = `${command.projectId}/${command.episodeId}`;
    if (busy.has(key))
      return { kind: "NOT_SENT", operationId: command.operationId, code: "GENERATION_BUSY" };
    busy.add(key);
    try {
      return await generate(api, command, runtimeFor());
    } finally {
      busy.delete(key);
    }
  });
}

async function generate(
  api: OfficialTextPersistenceClient,
  command: OfficialTextGenerate,
  runtime: Runtime,
): Promise<OfficialTextGeneration> {
  const { projectId: project, episodeId: episode, operationId: operation } = command;
  const unknown = (code: string): OfficialTextGeneration => ({
    kind: "REMOTE_UNKNOWN",
    operationId: operation,
    code,
  });
  const prior = await api.getOfficialText(project, episode, operation);
  if (prior.kind === "OK") {
    const original = prior.operation.request;
    return original.model === command.model &&
      original.input_text === command.text &&
      original.instructions === (command.instructions ?? null) &&
      sameBase(original.base, command.base)
      ? prior
      : { kind: "NOT_SENT", operationId: operation, code: "OPERATION_REUSED" };
  }
  if (prior.kind !== "ERROR" || prior.code !== "OFFICIAL_TEXT_NOT_FOUND")
    return { kind: "NOT_SENT", operationId: operation, code: "OPERATION_READ_FAILED" };
  let reserved = false;
  let reservationFailure = "RESERVATION_FAILED";
  const input: ChatGPTTextCommand = {
    operationId: operation,
    model: command.model,
    text: command.text,
    ...(command.instructions !== undefined ? { instructions: command.instructions } : {}),
    approvalContext: `项目：${project}\n分集：${episode}\n剧本基准：${command.base ? `${command.base.version_id} / ${command.base.content_hash} / r${command.base.head_revision}` : "无已保存剧本"}\n只发送下方输入和指令；生成结果存为待采纳建议。`,
  };
  let result: ChatGPTTextResult;
  try {
    result = await runtime.generateText(input, {
      beforeSend: async (metadata) => {
        if (
          metadata.operationId !== operation ||
          metadata.model !== command.model ||
          metadata.requestHash !== textRequestHash(input)
        )
          throw new Error("Invalid runtime reservation identity");
        const response = await api.reserveOfficialText(project, episode, {
          operation_id: operation,
          profile_id: metadata.profileId,
          model: command.model,
          input_text: command.text,
          instructions: command.instructions ?? null,
          request_hash: metadata.requestHash,
          base: command.base,
        });
        if (
          response.kind !== "OK" ||
          response.replayed ||
          response.operation.status !== "REMOTE_UNKNOWN" ||
          response.operation.request.operation_id !== operation ||
          response.operation.request.profile_id !== metadata.profileId ||
          response.operation.request.model !== command.model ||
          response.operation.request.input_text !== command.text ||
          response.operation.request.instructions !== (command.instructions ?? null) ||
          response.operation.request.request_hash !== metadata.requestHash ||
          !sameBase(response.operation.request.base, command.base)
        ) {
          reservationFailure =
            response.kind === "ERROR" ? response.code : "RESERVATION_UNCONFIRMED";
          throw new Error("Official text reservation was not newly confirmed");
        }
        reserved = true;
      },
    });
  } catch {
    return reserved
      ? unknown("GENERATION_UNSETTLED")
      : { kind: "NOT_SENT", operationId: operation, code: reservationFailure };
  }
  if (result.kind === "NOT_SENT") {
    if (reserved) {
      try {
        const settled = await api.markOfficialTextNotSent(project, episode, operation, result.code);
        const checked = await api.getOfficialText(project, episode, operation);
        if (
          settled.kind !== "OK" ||
          settled.operation.status !== "NOT_SENT" ||
          settled.operation.error_code !== result.code ||
          checked.kind !== "OK" ||
          checked.operation.status !== "NOT_SENT" ||
          checked.operation.error_code !== result.code
        )
          return unknown("NOT_SENT_PERSISTENCE_UNCONFIRMED");
      } catch {
        return unknown("NOT_SENT_PERSISTENCE_UNCONFIRMED");
      }
    }
    return {
      kind: "NOT_SENT",
      operationId: operation,
      code: reservationFailure !== "RESERVATION_FAILED" ? reservationFailure : result.code,
    };
  }
  if (result.kind !== "COMPLETED") return unknown(result.code);
  if (
    !reserved ||
    result.operationId !== operation ||
    result.model !== command.model ||
    result.requestHash !== textRequestHash(input)
  )
    return unknown("COMPLETION_IDENTITY_MISMATCH");
  const completion: OfficialTextCompletion = {
    operation_id: result.operationId,
    profile_id: result.profileId,
    model: result.model,
    request_hash: result.requestHash,
    text: result.text,
    completed_at: result.completedAt,
  };
  try {
    await api.completeOfficialText(project, episode, completion);
    const read = await api.getOfficialText(project, episode, operation);
    const saved = read.kind === "OK" ? read.operation.proposal?.result : null;
    return read.kind === "OK" &&
      saved?.text === result.text &&
      saved.completed_at === result.completedAt &&
      saved.profile_id === result.profileId &&
      saved.request_hash === result.requestHash
      ? read
      : unknown("RESULT_PERSISTENCE_UNCONFIRMED");
  } catch {
    return unknown("RESULT_PERSISTENCE_UNCONFIRMED");
  }
}

function sameBase(
  left: OfficialTextGenerate["base"],
  right: OfficialTextGenerate["base"],
): boolean {
  return left === null
    ? right === null
    : right !== null &&
        left.version_id === right.version_id &&
        left.content_hash === right.content_hash &&
        left.head_revision === right.head_revision;
}
