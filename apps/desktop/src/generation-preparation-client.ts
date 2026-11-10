import { createHash, randomUUID } from "node:crypto";
import type { GenerationRegistrationInput } from "./film-generation-registration";
import type { GenerationRequestSource } from "./film-generation-sources";
import {
  attestGenerationAccount,
  type GenerationDispatchAccount,
} from "./generation-dispatch-account";
import { canonicalLoopbackOrigin } from "./sidecar-origin";
import { generationObject } from "./film-generation-plan";
import { parseGenerationSlotPreparations } from "./generation-cache-preparation";

type Session = { token: string; origin: string };
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const prefix = (projectId: string) => {
  if (!/^prj_[a-f0-9]{32}$/.test(projectId)) throw Error("EXECUTION_UNAVAILABLE");
  return `/api/v1/projects/${projectId}/prepared-generation-executions`;
};

/** Sidecar-local, account/raw-body-attested facts. No renderer URL or header is accepted. */
export function generationPreparationClient(host: {
  session: () => Session;
  fetcher: typeof fetch;
}) {
  async function post(
    projectId: string,
    suffix: string,
    input: unknown,
    account: GenerationDispatchAccount,
    current: () => boolean,
  ): Promise<unknown> {
    const session = host.session();
    if (!/^[A-Za-z0-9_-]{43,256}$/.test(session.token)) throw Error("EXECUTION_UNAVAILABLE");
    const origin = canonicalLoopbackOrigin(session.origin),
      key = `story-film:v1:${randomUUID()}`,
      body = JSON.stringify(input);
    const signed = attestGenerationAccount({
      sessionKey: session.token,
      projectId,
      idempotencyKey: key,
      body,
      account,
    });
    if (!current()) throw Error("EXECUTION_UNAVAILABLE");
    let response: Response;
    try {
      response = await host.fetcher(`${origin}${prefix(projectId)}${suffix}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          "X-Aivora-Media-Bearer": account.bearer,
          "X-Aivora-Generation-Account": signed,
        },
        body,
      });
    } catch {
      throw Error("WRITE_UNCONFIRMED");
    }
    let payload: unknown;
    try {
      const text = await response.text();
      if (text.length > 12 * 1024 * 1024) throw Error("bounded");
      payload = JSON.parse(text);
    } catch {
      throw Error("WRITE_UNCONFIRMED");
    }
    if (!response.ok) {
      const value = generationObject(payload),
        code = value?.detail;
      if (response.status === 403) throw Error("ACCOUNT_UNAVAILABLE");
      if (response.status >= 500) throw Error("WRITE_UNCONFIRMED");
      if (code === "VIDEO_UNCONFIGURED" || code === "VIDEO_INPUT_FAILURE_LIMIT") throw Error(code);
      if (code === "UNCONFIGURED") throw Error("CREATION_UNCONFIGURED");
      if (code === "INPUT_FAILURE_LIMIT") throw Error("CREATION_INPUT_FAILURE_LIMIT");
      if (code === "ATTEMPT_ALREADY_RESERVED") throw Error("CREATION_ATTEMPT_ALREADY_RESERVED");
      if (code === "EXECUTION_UNAVAILABLE") throw Error("EXECUTION_UNAVAILABLE");
      throw Error("CREATION_INPUT_UNVERIFIABLE");
    }
    return payload;
  }
  async function fact(
    project: string,
    execution: string,
    operation: string,
    body: unknown,
    account: GenerationDispatchAccount,
    current: () => boolean,
  ) {
    if (!id(execution)) throw Error("EXECUTION_UNAVAILABLE");
    const value = generationObject(
      await post(project, `/${execution}/${operation}`, body, account, current),
    );
    if (!value || !exact(value, ["kind"]) || value.kind !== "RECORDED")
      throw Error("WRITE_UNCONFIRMED");
  }
  return {
    async register(
      project: string,
      input: GenerationRegistrationInput,
      account: GenerationDispatchAccount,
      current: () => boolean,
    ) {
      const value = generationObject(await post(project, "", input, account, current));
      if (!value || !exact(value, ["execution_id"]) || !id(value.execution_id))
        throw Error("WRITE_UNCONFIRMED");
      return value.execution_id;
    },
    async prepareSlots(
      project: string,
      execution: string,
      input: GenerationRegistrationInput,
      account: GenerationDispatchAccount,
      current: () => boolean,
    ) {
      if (!id(execution)) throw Error("EXECUTION_UNAVAILABLE");
      return parseGenerationSlotPreparations(
        await post(
          project,
          `/${execution}/cache-preparations`,
          { registration: input },
          account,
          current,
        ),
      );
    },
    async lineages(
      project: string,
      hashes: string[],
      account: GenerationDispatchAccount,
      current: () => boolean,
    ) {
      const value = generationObject(
        await post(project, "/lineages", { output_sha256s: hashes }, account, current),
      );
      if (
        !value ||
        !exact(value, ["items"]) ||
        !Array.isArray(value.items) ||
        value.items.length > 2048
      )
        throw Error("EXECUTION_UNAVAILABLE");
      return value.items as unknown[];
    },
    async armVideo(
      project: string,
      execution: string,
      target: string,
      slot: number,
      take: string,
      wireBody: string,
      sources: readonly GenerationRequestSource[],
      account: GenerationDispatchAccount,
      current: () => boolean,
    ) {
      if (!id(execution) || wireBody.length > 1024 * 1024) throw Error("EXECUTION_UNAVAILABLE");
      const value = generationObject(
        await post(
          project,
          `/${execution}/video-arm`,
          {
            target_key: target,
            slot_index: slot,
            take_key: take,
            wire_body: wireBody,
            body_sha256: createHash("sha256").update(wireBody).digest("hex"),
            sources: sources.map(({ canonicalPath, ...row }) => ({
              ...row,
              canonical_path: canonicalPath,
            })),
          },
          account,
          current,
        ),
      );
      if (!value || !exact(value, ["arm_id"]) || !id(value.arm_id))
        throw Error("WRITE_UNCONFIRMED");
      return value.arm_id;
    },
    beforeImage: (
      project: string,
      execution: string,
      stage: string,
      bodyHash: string,
      account: GenerationDispatchAccount,
      current: () => boolean,
    ) =>
      fact(
        project,
        execution,
        "image-dispatch",
        { stage_key: stage, body_sha256: bodyHash },
        account,
        current,
      ),
    observedImage: (
      project: string,
      execution: string,
      stage: string,
      bodyHash: string,
      outputHash: string | null,
      account: GenerationDispatchAccount,
      current: () => boolean,
    ) =>
      fact(
        project,
        execution,
        "image-observation",
        { stage_key: stage, body_sha256: bodyHash, output_sha256: outputHash },
        account,
        current,
      ),
    imageUnsent: (
      project: string,
      execution: string,
      stage: string,
      bodyHash: string,
      account: GenerationDispatchAccount,
      current: () => boolean,
    ) =>
      fact(
        project,
        execution,
        "image-unsent",
        { stage_key: stage, body_sha256: bodyHash },
        account,
        current,
      ),
    retire: (
      project: string,
      execution: string,
      target: string | null,
      slot: number | null,
      account: GenerationDispatchAccount,
    ) =>
      fact(
        project,
        execution,
        "retire",
        { target_key: target, slot_index: slot },
        account,
        () => true,
      ),
  };
}
export type GenerationPreparationClient = ReturnType<typeof generationPreparationClient>;
