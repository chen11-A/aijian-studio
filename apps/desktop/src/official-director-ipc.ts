import type {
  OfficialDirectorGenerate,
  OfficialDirectorGeneration,
  OfficialDirectorPrepare,
} from "@aijian/contracts/official-director";
import type { ChatGPTStatus } from "@aijian/contracts/chatgpt-auth";
import type {
  ChatGPTTextCommand,
  ChatGPTTextOptions,
  ChatGPTTextResult,
} from "./chatgpt-auth-generation";
import { textRequestHash } from "./chatgpt-auth-generation";
import type { OfficialDirectorPersistenceClient } from "./official-director-client";
import {
  OFFICIAL_DIRECTOR_CHANNELS,
  canonical,
  episodeId,
  operationId,
  projectId,
  sameIntent,
  text,
  validAdopt,
  validGenerate,
  validReject,
} from "./official-director-contract";

type Runtime = {
  status(): Promise<ChatGPTStatus>;
  generateText(input: ChatGPTTextCommand, options: ChatGPTTextOptions): Promise<ChatGPTTextResult>;
};
/** Dedicated trusted orchestration. Renderer may choose intent/pins, never prompt or result bytes. */
export function registerOfficialDirectorHandlers<Event>(
  handle: (
    channel: string,
    listener: (event: Event, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: Event) => OfficialDirectorPersistenceClient,
  authorized: (event: Event) => boolean,
  runtimeFor: () => Runtime,
): void {
  const busy = new Set<string>();
  const client = (event: Event): OfficialDirectorPersistenceClient => {
    if (!authorized(event)) throw new Error("Official director IPC sender is not authorized");
    return clientFor(event);
  };
  function scope(args: unknown[]): asserts args is [string, string, ...unknown[]] {
    if (!projectId(args[0]) || !episodeId(args[1]))
      throw new Error("Invalid official director scope");
  }
  handle(OFFICIAL_DIRECTOR_CHANNELS.list, async (event, ...args) => {
    const api = client(event);
    scope(args);
    if (args.length !== 2) throw new Error("Invalid official director list arguments");
    return api.listOfficialDirector(args[0], args[1]);
  });
  handle(OFFICIAL_DIRECTOR_CHANNELS.get, async (event, ...args) => {
    const api = client(event);
    scope(args);
    if (args.length !== 3 || !operationId(args[2]))
      throw new Error("Invalid official director read arguments");
    return api.getOfficialDirector(args[0], args[1], args[2]);
  });
  for (const decision of ["adopt", "reject"] as const) {
    handle(OFFICIAL_DIRECTOR_CHANNELS[decision], async (event, ...args) => {
      const api = client(event);
      scope(args);
      if (args.length !== 4 || !operationId(args[2]))
        throw new Error("Invalid official director decision arguments");
      const operation = args[2];
      const input = structuredClone(args[3]);
      let write;
      if (decision === "adopt") {
        if (!validAdopt(input)) throw new Error("Invalid official director adoption arguments");
        write = () => api.adoptOfficialDirector(args[0], args[1], operation, input);
      } else {
        if (!validReject(input)) throw new Error("Invalid official director rejection arguments");
        write = () => api.rejectOfficialDirector(args[0], args[1], operation, input);
      }
      try {
        const written = await write();
        if (written.kind === "ERROR") return written;
        const read = await api.getOfficialDirector(args[0], args[1], args[2]);
        if (
          read.kind !== "OK" ||
          read.operation.proposal?.version_id !== input.proposal_version_id ||
          read.operation.proposal.content_hash !== input.proposal_content_hash
        )
          return { kind: "UNKNOWN" };
        const receipt = decision === "adopt" ? read.operation.adoption : read.operation.rejection;
        if (
          !receipt ||
          (decision === "reject" &&
            (!validReject(input) || read.operation.rejection?.reason !== input.reason))
        )
          return { kind: "UNKNOWN" };
        return written.kind === "OK" &&
          canonical(receipt) !==
            canonical(
              decision === "adopt" ? written.operation.adoption : written.operation.rejection,
            )
          ? { kind: "UNKNOWN" }
          : read;
      } catch {
        return { kind: "UNKNOWN" };
      }
    });
  }
  handle(OFFICIAL_DIRECTOR_CHANNELS.generate, async (event, ...args) => {
    const api = client(event);
    if (args.length !== 1 || !validGenerate(args[0]))
      throw new Error("Invalid official director generation arguments");
    const command = structuredClone(args[0]);
    const key = `${command.projectId}/${command.episodeId}`;
    if (busy.has(key))
      return { kind: "NOT_SENT", operationId: command.operationId, code: "GENERATION_BUSY" };
    busy.add(key);
    try {
      return await generate(api, command, runtimeFor(), () => authorized(event));
    } finally {
      busy.delete(key);
    }
  });
}

async function generate(
  api: OfficialDirectorPersistenceClient,
  command: OfficialDirectorGenerate,
  runtime: Runtime,
  authorized: () => boolean,
): Promise<OfficialDirectorGeneration> {
  const { projectId: project, episodeId: episode, operationId: operation } = command;
  const notSent = (code: string): OfficialDirectorGeneration => ({
    kind: "NOT_SENT",
    operationId: operation,
    code,
  });
  const unknown = (code: string): OfficialDirectorGeneration => ({
    kind: "REMOTE_UNKNOWN",
    operationId: operation,
    code,
  });
  let prior;
  try {
    prior = await api.getOfficialDirector(project, episode, operation);
  } catch {
    return notSent("OPERATION_READ_FAILED");
  }
  if (prior.kind === "OK")
    return sameIntent(prior.operation.request, command) ? prior : notSent("OPERATION_REUSED");
  if (prior.kind !== "ERROR" || prior.code !== "OFFICIAL_DIRECTOR_NOT_FOUND")
    return notSent("OPERATION_READ_FAILED");
  if (!command.expectedProfileId) return notSent("ACCOUNT_SELECTION_REQUIRED");
  let preparation;
  try {
    const status = await runtime.status();
    if (!operationId(status.activeProfileId) || status.state !== "CONNECTED")
      return notSent("PLAN_USAGE_NOT_AUTHORIZED");
    if (status.activeProfileId !== command.expectedProfileId) return notSent("ACCOUNT_MISMATCH");
    const input: OfficialDirectorPrepare = {
      operation_id: operation,
      profile_id: status.activeProfileId,
      model: command.model,
      authority: command.authority,
      storyboard_base: command.storyboardBase,
      intent: command.intent,
      options: command.options,
    };
    preparation = await api.prepareOfficialDirector(project, episode, input);
  } catch {
    return notSent("PREPARATION_FAILED");
  }
  if (preparation.kind !== "OK")
    return notSent(preparation.kind === "ERROR" ? preparation.code : "PREPARATION_UNCONFIRMED");
  const request = structuredClone(preparation.request);
  if (!sameIntent(request, command)) return notSent("PREPARATION_IDENTITY_MISMATCH");
  const input: ChatGPTTextCommand = {
    operationId: operation,
    expectedProfileId: command.expectedProfileId,
    model: request.model,
    text: request.input_text,
    instructions: request.instructions,
    approvalContext: `AI 导演建议\n项目：${project}\n分集：${episode}\n已确认剧本：${request.authority.script.version_id} / ${request.authority.script.content_hash}\n制作简报：${request.authority.production_brief.version_id} / ${request.authority.production_brief.content_hash}\n仅产生待人工审阅的结构化建议，不执行媒体生成、剪辑或导出。`,
  };
  let reservationAttempted = false;
  let reserved = false;
  let reservationFailure = "RESERVATION_FAILED";
  let result: ChatGPTTextResult;
  try {
    result = await runtime.generateText(input, {
      allowEmptyOutput: true,
      allowOversizedOutput: true,
      beforeSend: async (metadata) => {
        if (
          reservationAttempted ||
          !authorized() ||
          metadata.operationId !== operation ||
          metadata.model !== request.model ||
          metadata.profileId !== request.profile_id ||
          metadata.requestHash !== request.request_hash ||
          metadata.requestHash !== textRequestHash(input)
        )
          throw new Error("Invalid director reservation identity or lifecycle");
        const status = await runtime.status();
        if (
          !authorized() ||
          status.activeProfileId !== request.profile_id ||
          status.state !== "CONNECTED"
        )
          throw new Error("Director session changed before reservation");
        reservationAttempted = true;
        const response = await api.reserveOfficialDirector(project, episode, {
          operation_id: request.operation_id,
          profile_id: request.profile_id,
          model: request.model,
          authority: request.authority,
          storyboard_base: request.storyboard_base,
          intent: request.intent,
          options: request.options,
          request_hash: request.request_hash,
        });
        if (
          response.kind !== "OK" ||
          response.replayed ||
          response.operation.status !== "REMOTE_UNKNOWN" ||
          response.operation.attempt_status !== "REMOTE_UNKNOWN" ||
          canonical(response.operation.request) !== canonical(request)
        ) {
          reservationFailure =
            response.kind === "ERROR" ? response.code : "RESERVATION_UNCONFIRMED";
          throw new Error("Director reservation was not newly confirmed");
        }
        reserved = true;
        if (!authorized()) throw new Error("Director sender closed before send");
      },
    });
  } catch {
    result = {
      kind: reserved ? "REMOTE_UNKNOWN" : "NOT_SENT",
      operationId: operation,
      code: "GENERATION_UNSETTLED",
    };
  }
  // Every uncertain/replayed reservation is reconciled by a read. It never licenses a new remote send.
  if (reservationAttempted && !reserved) {
    try {
      const read = await api.getOfficialDirector(project, episode, operation);
      if (read.kind === "OK" && sameIntent(read.operation.request, command)) return read;
    } catch {
      /* Preserve the operation for explicit read-only recovery. */
    }
    return unknown(reservationFailure);
  }
  if (result.operationId !== operation) return unknown("COMPLETION_IDENTITY_MISMATCH");
  if (result.kind === "NOT_SENT") {
    if (!reserved) return notSent(result.code);
    try {
      await api.markOfficialDirectorNotSent(project, episode, operation, result.code);
      const read = await api.getOfficialDirector(project, episode, operation);
      return read.kind === "OK" &&
        read.operation.status === "NOT_SENT" &&
        read.operation.error_code === result.code &&
        canonical(read.operation.request) === canonical(request)
        ? read
        : unknown("NOT_SENT_PERSISTENCE_UNCONFIRMED");
    } catch {
      return unknown("NOT_SENT_PERSISTENCE_UNCONFIRMED");
    }
  }
  if (result.kind !== "COMPLETED") return unknown(result.code);
  if (
    !reserved ||
    result.profileId !== request.profile_id ||
    result.model !== request.model ||
    result.requestHash !== request.request_hash ||
    !text(result.responseId, 240)
  )
    return unknown("COMPLETION_IDENTITY_MISMATCH");
  try {
    // Keep raw provider bytes, including invalid JSON. Only the backend may validate/admit a director artifact.
    await api.completeOfficialDirector(project, episode, {
      operation_id: operation,
      profile_id: result.profileId,
      model: result.model,
      request_hash: result.requestHash,
      response_id: result.responseId,
      text: result.text,
      completed_at: result.completedAt,
    });
    const read = await api.getOfficialDirector(project, episode, operation);
    const saved = read.kind === "OK" ? read.operation.completion : null;
    return read.kind === "OK" &&
      canonical(read.operation.request) === canonical(request) &&
      (read.operation.status === "COMPLETED" || read.operation.status === "INVALID") &&
      saved?.text === result.text &&
      saved.completed_at === result.completedAt &&
      saved.response_id === result.responseId &&
      saved.profile_id === result.profileId &&
      saved.request_hash === result.requestHash
      ? read
      : unknown("RESULT_PERSISTENCE_UNCONFIRMED");
  } catch {
    return unknown("RESULT_PERSISTENCE_UNCONFIRMED");
  }
}
