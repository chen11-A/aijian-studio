import { generationSelectedMedia } from "./film-generation-selected-media";
import { forecastGenerationReferences } from "./film-generation-forecast";
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type {
  FilmGenerationExecutionFailure,
  FilmGenerationVideoExecution,
  FilmGenerationStillExecution,
  FilmGenerationStillResult,
} from "@aijian/contracts/film-generation-execution";
import type { StoryFilmLocalScope } from "@aijian/contracts/film-dialogue-split";
import type { GenerationDispatchAccount } from "./generation-dispatch-account";
import {
  readProject,
  readMedia,
  filmStillRequestBody,
  normalizeFilmStillPrompt,
  IMAGE_MODEL,
  type FilmRecord,
} from "./film-library";
import { filmHistoryRecordHash, filmHistoryRecordText } from "./film-history";
import {
  loadCanonicalGenerationProducer,
  type CanonicalGenerationProducer,
} from "./film-generation-compiler";
import {
  compileCanonicalGenerationPlan,
  generationObject,
  generationRows,
  type CanonicalGenerationPlan,
} from "./film-generation-plan";
import { dispatchProtectedGenerationStill } from "./film-generation-still-dispatch";
import {
  buildGenerationRegistration,
  type GenerationReferenceIdentity,
  type GenerationRegistrationInput,
} from "./film-generation-registration";
import type { FixedInputLedger } from "./film-generation-fixed-input";
import {
  generationBodyIdentity,
  restoreGenerationIntent,
  verifyGenerationStageImage,
} from "./film-generation-lineage";
import { generationImageSources, type GenerationImageSources } from "./film-generation-sources";
import {
  generationPreparationClient,
  type GenerationPreparationClient,
} from "./generation-preparation-client";
import {
  createFilmGenerationExecutionService,
  GenerationExecutionServiceError,
} from "./film-generation-execution-service";
import {
  GenerationExecutionRegistryError,
  type GenerationExecutionOwner,
} from "./film-generation-execution-registry";
import { dispatchGenerationOnProjectQueue } from "./film-generation-queued-dispatch";
import {
  createStoryFilmClient,
  parseStoryFilmCreate,
  type StoryFilmCreateInput,
} from "./story-film-client";

type Session = { origin: string; token: string };
type AccountLease = { account: GenerationDispatchAccount; current: () => boolean };
const fail = (code: FilmGenerationExecutionFailure): never => {
  throw new GenerationExecutionServiceError(code);
};
const known = new Set<FilmGenerationExecutionFailure>([
  "INVALID_INPUT",
  "BUSY",
  "PROJECT_CHANGED",
  "SOURCE_UNVERIFIABLE",
  "ACCOUNT_UNAVAILABLE",
  "UNSUPPORTED_SCOPE",
  "EXECUTION_UNAVAILABLE",
  "VIDEO_UNCONFIGURED",
  "VIDEO_INPUT_FAILURE_LIMIT",
  "CREATION_UNCONFIGURED",
  "CREATION_INPUT_UNVERIFIABLE",
  "CREATION_INPUT_FAILURE_LIMIT",
  "CREATION_ATTEMPT_ALREADY_RESERVED",
  "WRITE_UNCONFIRMED",
]);
function fixed(
  error: unknown,
  fallback: FilmGenerationExecutionFailure,
): GenerationExecutionServiceError {
  if (error instanceof GenerationExecutionServiceError) return error;
  if (error instanceof GenerationExecutionRegistryError)
    return new GenerationExecutionServiceError(error.code);
  // Only native helper boundaries reach here; no provider reason is interpreted.
  return new GenerationExecutionServiceError(
    error instanceof Error && known.has(error.message as FilmGenerationExecutionFailure)
      ? (error.message as FilmGenerationExecutionFailure)
      : fallback,
  );
}
type State = {
  projectId: string;
  seriesId: string;
  backendProjectId: string;
  producer: CanonicalGenerationProducer;
  plan: CanonicalGenerationPlan;
  sources: GenerationImageSources;
  identities: Map<string, string>;
  api: GenerationPreparationClient;
  apiExecutionId: string;
  account: GenerationDispatchAccount;
  session: Session;
  current: () => boolean;
  plannedKey: string | null;
  attemptedSlots: Set<string>;
  attemptedStages: Set<string>;
  stageOrigins: Map<string, GenerationRegistrationInput["stages"][number]["origin"]>;
  queuedBindings: Map<string, readonly string[]>;
};

/** A current-input guard over the one shared forecast compiler, not a budget hash
 * or permission. Opaque keys only bind the same already-issued native plan. */
function insideWriterStills(root: string, file: string): boolean {
  const value = relative(root, file);
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}
function forecastKey(
  producer: CanonicalGenerationProducer,
  plan: CanonicalGenerationPlan,
  intent: Record<string, unknown>,
): string {
  const forecast = forecastGenerationReferences(producer, plan, intent);
  return filmHistoryRecordText({ targets: forecast.targets, stages: forecast.stages });
}
/** Fixed-reference ordinary regenerate sink. Planned references, cache, local
 * continuity and pending pipeline remain closed until their real adapters are composed.
 * An all-selected pipeline may return a separately verified readonly local receipt.
 * A transient execution or stored path is never dispatch permission. */
export function createNativeFilmGenerationExecutions(host: {
  filmsRoot: () => string;
  storyFilmsRoot: () => string;
  session: () => Session;
  mediaDispatchLease: () => Promise<AccountLease | null>;
  storySourceOwner: (projectId: string, path: string, sha256: string) => Promise<boolean>;
  fetcher: typeof fetch;
  /** Explicit main-private fixed-input receipts. Absence grants nothing. */
  fixedInputs?: Pick<FixedInputLedger, "matches">;
  producer?: () => Promise<CanonicalGenerationProducer>;
  selectedMediaHost?: (
    current: () => boolean,
  ) => Promise<Parameters<typeof generationSelectedMedia>[3]>;
}) {
  const service = createFilmGenerationExecutionService<State>({
    async prepare(input, owner) {
      if (input.mode === "pipeline") {
        if (!host.selectedMediaHost) return fail("UNSUPPORTED_SCOPE");
        try {
          if (!owner.current()) return fail("EXECUTION_UNAVAILABLE");
          const record = await readProject(host.filmsRoot(), input.projectId);
          if (
            !record ||
            record.id !== input.projectId ||
            filmHistoryRecordHash(record) !== input.expectedProjectHash
          )
            return fail("PROJECT_CHANGED");
          // The actual controller's video scope is every canonical shot, in order.
          // Never accept a renderer subset as proof that a whole pipeline needs no media.
          const shotIds = generationRows(record.shots).map((shot) => String(shot.id));
          if (
            shotIds.length !== input.targets.length ||
            shotIds.some((id, index) => input.targets[index]?.shotId !== id)
          )
            return fail("UNSUPPORTED_SCOPE");
          const producer = await (host.producer ?? loadCanonicalGenerationProducer)();
          const mediaHost = await host.selectedMediaHost(owner.current);
          if (!owner.current()) return fail("EXECUTION_UNAVAILABLE");
          const selected = await generationSelectedMedia(producer, record, shotIds, mediaHost);
          if (selected.pendingShotIds.size) return fail("UNSUPPORTED_SCOPE");
          const fresh = await readProject(host.filmsRoot(), input.projectId);
          if (!fresh || filmHistoryRecordHash(fresh) !== input.expectedProjectHash)
            return fail("PROJECT_CHANGED");
          await selected.verify(fresh);
          const final = await readProject(host.filmsRoot(), input.projectId);
          if (!owner.current()) return fail("EXECUTION_UNAVAILABLE");
          if (!final || filmHistoryRecordHash(final) !== input.expectedProjectHash)
            return fail("PROJECT_CHANGED");
          return {
            kind: "NOT_NEEDED" as const,
            projectId: record.id,
            projectHash: input.expectedProjectHash,
            reason: "LOCAL_SELECTED_MEDIA" as const,
            selected: selected.selected.map(({ shotId, takeId }) => ({ shotId, takeId })),
          };
        } catch (error) {
          if (!owner.current()) return fail("EXECUTION_UNAVAILABLE");
          throw fixed(error, "SOURCE_UNVERIFIABLE");
        }
      }
      let state: State | undefined;
      try {
        const accountLease = await host.mediaDispatchLease();
        if (!accountLease) return fail("ACCOUNT_UNAVAILABLE");
        const session = { ...host.session() };
        const current = () => {
          try {
            const live = host.session();
            return (
              owner.current() &&
              accountLease.current() &&
              live.origin === session.origin &&
              live.token === session.token
            );
          } catch {
            return false;
          }
        };
        if (!current()) return fail("EXECUTION_UNAVAILABLE");
        const record = await readProject(host.filmsRoot(), input.projectId);
        if (
          !record ||
          record.id !== input.projectId ||
          filmHistoryRecordHash(record) !== input.expectedProjectHash
        )
          return fail("PROJECT_CHANGED");
        if (
          typeof record.backendProjectId !== "string" ||
          !/^prj_[a-f0-9]{32}$/.test(record.backendProjectId)
        )
          return fail("UNSUPPORTED_SCOPE");
        const producer = await (host.producer ?? loadCanonicalGenerationProducer)();
        const sources = await generationImageSources({
          filmsRoot: host.filmsRoot(),
          storyFilmsRoot: host.storyFilmsRoot(),
          seriesId: record.seriesId,
          projectId: record.id,
          backendProjectId: record.backendProjectId,
          storySourceOwner: host.storySourceOwner,
        });
        let intent: Record<string, unknown> = record;
        let plan = compileCanonicalGenerationPlan(producer, record, intent, input, new Set());
        // Never infer cache misses from metadata or file existence. This narrow branch
        // consumes the original queue's explicit regenerate instruction only.
        if (
          plan.stages.some(
            (stage) =>
              stage.public.kind !== "shot-frame" && stage.public.kind !== "location-reference",
          ) ||
          plan.targets.some(
            (target) =>
              !producer.generationHadTakes(target.originalShot) ||
              !target.originalShot.selectedTakeId,
          )
        )
          return fail("UNSUPPORTED_SCOPE");
        let planned = plan.stages.some((stage) => stage.public.kind === "location-reference");
        let registration = await buildGenerationRegistration(
          producer,
          plan,
          intent,
          sources,
          planned ? { plannedReferences: true } : {},
        );
        const api = generationPreparationClient({ session: () => session, fetcher: host.fetcher });
        const hashes = [...new Set(sources.identities().map((source) => source.sha256))];
        const facts = hashes.length
          ? await api.lineages(record.backendProjectId, hashes, accountLease.account, current)
          : [];
        const knownOutputs = new Set(
          facts.flatMap((fact) => {
            const output = generationObject(fact)?.output_sha256;
            return typeof output === "string" ? [output] : [];
          }),
        );
        const writerRoot = await realpath(join(host.filmsRoot(), record.seriesId, "stills")).catch(
          () => null,
        );
        // series/stills only rejects a consumed file that has neither a READABLE
        // automatic output fact nor an explicit fixed-input receipt. The directory
        // itself proves nothing and grants nothing.
        if (
          writerRoot &&
          sources.identities().some((source) => {
            if (!source.path || !insideWriterStills(writerRoot, source.path)) return false;
            if (knownOutputs.has(source.sha256)) return false;
            return !host.fixedInputs?.matches({
              accountSha256: accountLease.account.accountSha256,
              projectId: record.id,
              backendProjectId: record.backendProjectId,
              seriesId: record.seriesId,
              role: "still",
              canonicalPath: source.path,
              sha256: source.sha256,
              mime: source.mime,
              knownAutomaticOutput: knownOutputs.has(source.sha256),
            });
          })
        )
          return fail("UNSUPPORTED_SCOPE");
        if (facts.length) {
          // Proven same-account/project READABLE shot-frames restore the original
          // creator view. Portrait, location and unknown automatic output stay closed.
          if (
            facts.some(
              (fact) => generationObject(generationObject(fact)?.stage)?.kind !== "shot-frame",
            )
          )
            return fail("UNSUPPORTED_SCOPE");
          intent = await restoreGenerationIntent(
            producer,
            record,
            input.targets.map((target) => target.shotId),
            sources,
            facts,
          );
          plan = compileCanonicalGenerationPlan(producer, record, intent, input, new Set());
          if (
            plan.stages.some(
              (stage) =>
                stage.public.kind !== "shot-frame" && stage.public.kind !== "location-reference",
            )
          )
            return fail("UNSUPPORTED_SCOPE");
          registration = await buildGenerationRegistration(producer, plan, intent, sources, {
            plannedReferences: true,
          });
          const fixedOutput = (reference: GenerationReferenceIdentity): boolean =>
            "sha256" in reference
              ? knownOutputs.has(reference.sha256)
              : reference.plannedImage.references.some(fixedOutput);
          // A restored creator must not keep its old automatic output as a new
          // fixed input. Output SHA, path and execution id are not a new bucket.
          if (
            registration.targets.some((target) =>
              target.sources.some((source) => knownOutputs.has(source.sha256)),
            ) ||
            registration.stages.some((stage) => stage.origin.references.some(fixedOutput))
          )
            return fail("UNSUPPORTED_SCOPE");
          planned = true;
        }
        const identities = new Map<string, string>();
        for (const target of plan.targets)
          identities.set(target.key, await generationBodyIdentity(target.originalBody, sources));
        await sources.verify();
        const fresh = await readProject(host.filmsRoot(), input.projectId);
        if (!fresh || filmHistoryRecordHash(fresh) !== input.expectedProjectHash)
          return fail("PROJECT_CHANGED");
        if (!current()) return fail("EXECUTION_UNAVAILABLE");
        const apiExecutionId = await api.register(
          record.backendProjectId,
          registration,
          accountLease.account,
          current,
        );
        state = {
          projectId: record.id,
          seriesId: record.seriesId,
          backendProjectId: record.backendProjectId,
          producer,
          plan,
          sources,
          identities,
          api,
          apiExecutionId,
          account: accountLease.account,
          session,
          current,
          plannedKey: planned ? forecastKey(producer, plan, intent) : null,
          attemptedSlots: new Set(),
          attemptedStages: new Set(),
          stageOrigins: new Map(registration.stages.map((stage) => [stage.key, stage.origin])),
          queuedBindings: new Map(),
        };
        await sources.verify();
        const final = await readProject(host.filmsRoot(), input.projectId);
        if (!final || filmHistoryRecordHash(final) !== input.expectedProjectHash)
          return fail("PROJECT_CHANGED");
        if (!current()) return fail("EXECUTION_UNAVAILABLE");
        return {
          public: {
            projectId: record.id,
            projectHash: input.expectedProjectHash,
            stages: plan.stages.map((stage) => stage.public),
            targets: plan.targets.map((target) => ({
              shotId: target.shotId,
              videoSlotIds: target.videoSlots.map((slot) => slot.id),
              preparation: "CLIENT_IMAGES" as const,
              slotPreparations: target.videoSlots.map((slot) => ({
                videoSlotId: slot.id,
                preparation: "CLIENT_IMAGES" as const,
              })),
            })),
          },
          stageSlots: new Map(
            plan.stages.map((stage) => [
              stage.public.stageId,
              plan.targets
                .filter((target) => stage.dependencies.includes(target.key))
                .flatMap((target) => target.videoSlots.map((slot) => slot.id)),
            ]),
          ),
          privateState: state,
          accountCurrent: current,
        };
      } catch (error) {
        if (state)
          await state.api
            .retire(state.backendProjectId, state.apiExecutionId, null, null, state.account)
            .catch(() => undefined);
        throw fixed(error, "EXECUTION_UNAVAILABLE");
      }
    },
    async retire(state, slot) {
      const target = slot
        ? state.plan.targets.find((target) => target.shotId === slot.shotId)
        : undefined;
      if (slot && !target) return fail("EXECUTION_UNAVAILABLE");
      await state.api.retire(
        state.backendProjectId,
        state.apiExecutionId,
        target?.key ?? null,
        slot?.index ?? null,
        state.account,
      );
    },
  });
  async function proveCurrentIntent(state: State, record: FilmRecord, current: () => boolean) {
    if (!current()) return fail("EXECUTION_UNAVAILABLE");
    if (
      record.id !== state.projectId ||
      record.seriesId !== state.seriesId ||
      record.backendProjectId !== state.backendProjectId
    )
      return fail("PROJECT_CHANGED");
    for (const target of state.plan.targets) {
      const shot = generationRows(record.shots).find((shot) => shot.id === target.shotId);
      if (!shot || shot.selectedTakeId !== target.originalShot.selectedTakeId)
        return fail("PROJECT_CHANGED");
      const actual = parseStoryFilmCreate(
        state.producer.generationVideoBody(
          record,
          shot,
          target.originalShot,
          undefined,
          record.draft === true,
        ),
      );
      await state.sources.requestSources(actual);
    }
    const hashes = [...new Set(state.sources.identities().map((source) => source.sha256))];
    const facts = hashes.length
      ? await state.api.lineages(state.backendProjectId, hashes, state.account, current)
      : [];
    const intent = await restoreGenerationIntent(
      state.producer,
      record,
      state.plan.targets.map((target) => target.shotId),
      state.sources,
      facts,
    );
    for (const target of state.plan.targets) {
      const shot = generationRows(intent.shots).find((shot) => shot.id === target.shotId);
      const original = parseStoryFilmCreate(
        state.producer.generationVideoBody(
          intent,
          shot,
          target.originalShot,
          undefined,
          record.draft === true,
        ),
      );
      if (
        (await generationBodyIdentity(original, state.sources)) !== state.identities.get(target.key)
      )
        return fail("PROJECT_CHANGED");
    }
    if (state.plannedKey !== forecastKey(state.producer, state.plan, intent))
      return fail("PROJECT_CHANGED");
    await state.sources.verify();
    if (!current()) return fail("EXECUTION_UNAVAILABLE");
    return { intent, facts };
  }
  async function still(
    owner: GenerationExecutionOwner,
    input: {
      seriesId: string;
      prompt: string;
      aspectRatio: "9:16" | "16:9";
      references: readonly string[];
      execution: FilmGenerationStillExecution;
    },
  ): Promise<FilmGenerationStillResult> {
    try {
      const lease = service.stage(owner, input.execution, "image"),
        state = lease.privateState;
      const stage = state.plan.stages.find(
          (item) => item.public.stageId === input.execution.stageId,
        ),
        origin = state.stageOrigins.get(input.execution.stageId);
      if (
        !stage ||
        !origin ||
        (stage.public.kind !== "shot-frame" && stage.public.kind !== "location-reference") ||
        input.seriesId !== state.seriesId
      )
        return fail("UNSUPPORTED_SCOPE");
      const verify = async (record: FilmRecord | null) => {
        lease.assertCurrent();
        if (
          !record ||
          record.id !== state.projectId ||
          record.seriesId !== state.seriesId ||
          record.backendProjectId !== state.backendProjectId
        )
          return fail("PROJECT_CHANGED");
        const proof = state.plannedKey
          ? await proveCurrentIntent(state, record, lease.current)
          : null;
        const actual = await verifyGenerationStageImage(
          state.producer,
          record,
          stage,
          origin,
          state.sources,
          proof?.facts ?? [],
        );
        if (normalizeFilmStillPrompt(actual.prompt) !== actual.prompt)
          return fail("UNSUPPORTED_SCOPE");
        if (
          normalizeFilmStillPrompt(input.prompt) !== actual.prompt ||
          input.aspectRatio !== actual.aspectRatio ||
          filmHistoryRecordText(input.references) !== filmHistoryRecordText(actual.references)
        )
          return fail("PROJECT_CHANGED");
        for (const target of state.plan.targets.filter((target) =>
          stage.dependencies.includes(target.key),
        )) {
          const shot = generationRows(record.shots).find((shot) => shot.id === target.shotId);
          if (!shot || shot.selectedTakeId !== target.originalShot.selectedTakeId)
            return fail("PROJECT_CHANGED");
          const body = parseStoryFilmCreate(
            state.producer.generationVideoBody(
              record,
              shot,
              target.originalShot,
              undefined,
              record.draft === true,
            ),
          );
          if (
            !proof &&
            (await generationBodyIdentity(body, state.sources)) !== state.identities.get(target.key)
          )
            return fail("PROJECT_CHANGED");
        }
        lease.assertCurrent();
        return actual;
      };
      const actual = await verify(await readProject(host.filmsRoot(), state.projectId));
      const references = await state.sources.materialize(actual.references);
      const expectedWire = JSON.stringify(
        filmStillRequestBody({ ...actual, references, model: IMAGE_MODEL }),
      );
      let bodyHash: string | undefined;
      let reservationAcknowledged = false;
      return await dispatchProtectedGenerationStill({
        ...actual,
        references,
        token: state.account.bearer,
        fetcher: host.fetcher,
        current: lease.current,
        destination: join(host.filmsRoot(), state.seriesId, "stills", `${randomUUID()}.png`),
        beforePost: async (wire, dispatch) => {
          try {
            await verify(await readProject(host.filmsRoot(), state.projectId));
            if (wire.init.body !== expectedWire) return fail("PROJECT_CHANGED");
            if (state.attemptedStages.has(input.execution.stageId))
              return fail("CREATION_ATTEMPT_ALREADY_RESERVED");
            lease.assertCurrent();
            state.attemptedStages.add(input.execution.stageId);
            bodyHash = createHash("sha256").update(expectedWire).digest("hex");
            try {
              await state.api.beforeImage(
                state.backendProjectId,
                state.apiExecutionId,
                input.execution.stageId,
                bodyHash,
                state.account,
                lease.current,
              );
              reservationAcknowledged = true;
            } catch (error) {
              const outcome = fixed(error, "WRITE_UNCONFIRMED");
              // A denied gate acquired nothing; a lost ACK may have acquired a
              // hold. Neither is an acknowledged owned pending reservation that
              // this local callback can release. Preserve uncertainty.
              reservationAcknowledged = false;
              throw outcome;
            }
            return await dispatchGenerationOnProjectQueue({
              filmsRoot: host.filmsRoot(),
              projectId: state.projectId,
              current: lease.current,
              verifyCanonical: async (record) => {
                await verify(record);
                await state.sources.verify();
              },
              dispatch,
            });
          } catch (error) {
            throw fixed(error, "SOURCE_UNVERIFIABLE");
          }
        },
        notSent: async () => {
          if (bodyHash && reservationAcknowledged)
            await state.api.imageUnsent(
              state.backendProjectId,
              state.apiExecutionId,
              input.execution.stageId,
              bodyHash,
              state.account,
              () => true,
            );
        },
        observed: async (path, facts) => {
          if (!bodyHash) return fail("WRITE_UNCONFIRMED");
          let outputHash: string | null = null,
            changedOutput = false;
          if (
            path &&
            facts.outputSha256 &&
            !facts.outputUnconfirmed &&
            !facts.transportUnconfirmed
          ) {
            try {
              await readMedia([host.filmsRoot()], path, { expectedSha256: facts.outputSha256 });
              const source = await state.sources.capture(path);
              if (source.sha256 !== facts.outputSha256) return fail("WRITE_UNCONFIRMED");
              outputHash = facts.outputSha256;
            } catch {
              changedOutput = true;
            }
          }
          await state.api.observedImage(
            state.backendProjectId,
            state.apiExecutionId,
            input.execution.stageId,
            bodyHash,
            outputHash,
            state.account,
            () => true,
          );
          if (changedOutput) return fail("WRITE_UNCONFIRMED");
        },
      });
    } catch (error) {
      return {
        path: "",
        reason: "生成记录尚未确认，请先核对任务和素材。",
        code: fixed(error, "WRITE_UNCONFIRMED").code,
      };
    }
  }
  async function video(
    owner: GenerationExecutionOwner,
    projectId: string,
    input: StoryFilmCreateInput,
    scope: StoryFilmLocalScope | undefined,
    execution: FilmGenerationVideoExecution,
  ) {
    let sent = false;
    try {
      const lease = service.video(owner, execution),
        state = lease.privateState;
      if (
        projectId !== state.backendProjectId ||
        (scope &&
          (scope.projectId !== state.projectId ||
            scope.shotId !== execution.shotId ||
            scope.takeId !== execution.takeId))
      )
        return fail("INVALID_INPUT");
      if (state.attemptedSlots.has(execution.videoSlotId))
        return fail("CREATION_ATTEMPT_ALREADY_RESERVED");
      const target = state.plan.targets.find((target) => target.shotId === execution.shotId);
      if (!target) return fail("EXECUTION_UNAVAILABLE");
      const validate = async (record: FilmRecord | null) => {
        lease.assertCurrent();
        if (
          !record ||
          record.id !== state.projectId ||
          record.seriesId !== state.seriesId ||
          record.backendProjectId !== state.backendProjectId
        )
          return fail("PROJECT_CHANGED");
        const shots = generationRows(record.shots),
          shot = shots.find((shot) => shot.id === target.shotId);
        if (!shot || shot.selectedTakeId !== target.originalShot.selectedTakeId)
          return fail("PROJECT_CHANGED");
        const original = generationRows(target.originalShot.takes),
          liveTakes = generationRows(shot.takes),
          count = target.videoSlots.length,
          expectedIndices = state.producer.generationQueuedTakeIndices(target.originalShot, count),
          appended = liveTakes.slice(original.length),
          ids = appended.map((take) => String(take.id));
        if (
          liveTakes.length !== original.length + count ||
          original.some((take, index) => liveTakes[index]?.id !== take.id) ||
          appended.some(
            (take, index) =>
              take.shotId !== shot.id ||
              take.index !== expectedIndices[index] ||
              original.some((old) => old.id === take.id),
          ) ||
          new Set(ids).size !== count ||
          ids[lease.slotIndex] !== execution.takeId
        )
          return fail("PROJECT_CHANGED");
        const pinned = state.queuedBindings.get(target.shotId);
        if (
          pinned &&
          (pinned.length !== ids.length || pinned.some((id, index) => id !== ids[index]))
        )
          return fail("PROJECT_CHANGED");
        const all = shots.flatMap((shot) => generationRows(shot.takes));
        const takes = all.filter((take) => take.id === execution.takeId),
          take = takes[0];
        if (
          ids.some((id) => all.filter((item) => item.id === id).length !== 1) ||
          takes.length !== 1 ||
          !take ||
          take.shotId !== shot.id ||
          (take.status !== "queued" && take.status !== "running")
        )
          return fail("PROJECT_CHANGED");
        const body = parseStoryFilmCreate(
          state.producer.generationVideoBody(
            record,
            shot,
            target.originalShot,
            undefined,
            record.draft === true,
          ),
        );
        body.regenerate =
          lease.slotIndex > 0 || state.producer.generationHadTakes(target.originalShot);
        let intentBody = body;
        if (state.plannedKey) {
          const { intent } = await proveCurrentIntent(state, record, lease.current);
          intentBody = parseStoryFilmCreate(
            state.producer.generationVideoBody(
              intent,
              generationRows(intent.shots).find((shot) => shot.id === target.shotId),
              target.originalShot,
              undefined,
              record.draft === true,
            ),
          );
        } else if (state.plan.stages.length) {
          await state.sources.requestSources(body);
          const facts = await state.api.lineages(
            state.backendProjectId,
            [...new Set(state.sources.identities().map((source) => source.sha256))],
            state.account,
            lease.current,
          );
          const intent = await restoreGenerationIntent(
            state.producer,
            record,
            [target.shotId],
            state.sources,
            facts,
          );
          const intentShot = generationRows(intent.shots).find((shot) => shot.id === target.shotId);
          intentBody = parseStoryFilmCreate(
            state.producer.generationVideoBody(
              intent,
              intentShot,
              target.originalShot,
              undefined,
              record.draft === true,
            ),
          );
        }
        if (
          (await generationBodyIdentity(intentBody, state.sources)) !==
            state.identities.get(target.key) ||
          filmHistoryRecordText(body) !== filmHistoryRecordText(input)
        )
          return fail("PROJECT_CHANGED");
        await state.sources.verify();
        lease.assertCurrent();
        state.queuedBindings.set(target.shotId, ids);
        return body;
      };
      const body = await validate(await readProject(host.filmsRoot(), state.projectId));
      if (state.attemptedSlots.has(execution.videoSlotId))
        return fail("CREATION_ATTEMPT_ALREADY_RESERVED");
      lease.bindVerifiedTake();
      state.attemptedSlots.add(execution.videoSlotId);
      let armedWire: string | undefined;
      const submitting: typeof fetch = (url, init) =>
        dispatchGenerationOnProjectQueue({
          filmsRoot: host.filmsRoot(),
          projectId: state.projectId,
          current: lease.current,
          verifyCanonical: async (record) => {
            await validate(record);
            if (typeof init?.body !== "string" || init.body !== armedWire)
              return fail("EXECUTION_UNAVAILABLE");
          },
          dispatch: () => {
            lease.assertCurrent();
            sent = true;
            return host.fetcher(url, init);
          },
        });
      const result = await createStoryFilmClient(submitting, state.session, undefined, [
        host.filmsRoot(),
        host.storyFilmsRoot(),
      ]).create(projectId, body, state.account.bearer, state.account, {
        arm: async (wire) => {
          await validate(await readProject(host.filmsRoot(), state.projectId));
          const roles = await state.sources.requestSourceRoles(body);
          await state.sources.verify();
          lease.assertCurrent();
          const armId = await state.api.armVideo(
            state.backendProjectId,
            state.apiExecutionId,
            target.key,
            lease.slotIndex,
            execution.takeId,
            wire,
            roles,
            state.account,
            lease.current,
          );
          armedWire = wire;
          lease.assertCurrent();
          return { armId, current: lease.current };
        },
      });
      lease.assertCurrent();
      return result;
    } catch (error) {
      throw fixed(error, sent ? "WRITE_UNCONFIRMED" : "SOURCE_UNVERIFIABLE");
    }
  }
  return { ...service, video, still };
}
