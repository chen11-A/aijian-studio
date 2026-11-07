/** Persisted orchestration only: hosts own membership requests and project artifacts. */
export const PRODUCTION_STEPS = [
  "writer",
  "art",
  "portraits",
  "director",
  "action",
  "performance",
  "prompter",
  "stills",
  "review",
  "video",
  "assembly",
] as const;
export type ProductionStepId = (typeof PRODUCTION_STEPS)[number];
/** Execution dependencies only. Schema-v1 stored steps retain PRODUCTION_STEPS order. */
export const MEDIA_EXECUTION_ORDER: readonly ProductionStepId[] = [
  "writer",
  "art",
  "director",
  "action",
  "performance",
  "prompter",
  "portraits",
  "stills",
  "review",
  "video",
  "assembly",
];

export type ProductionStatus =
  "queued" | "running" | "done" | "failed" | "blocked" | "needs-input" | "uncertain" | "accepted";
export type ProductionTarget = {
  id: string;
  status: ProductionStatus;
  attempt: number;
  code?: string;
  detail?: string;
};
export type ProductionStep = {
  id: ProductionStepId;
  status: ProductionStatus;
  targets: ProductionTarget[];
  planned: boolean;
  done: number;
  total: number;
};
export type ProductionCheckpoint = {
  shotCount: number;
  seconds: number;
  estimatedRequests: number;
  coverage: { sceneId: string; ok: boolean; missingLines: string[]; missingTail: string | null }[];
  risks: { code: string; text: string; severity: "block" | "manual" | "info" }[];
};
export type ProductionPipeline = {
  schemaVersion: 1;
  projectId: string;
  inputVersion: string;
  runId?: string;
  status: ProductionStatus | "checkpoint" | "cancelled";
  current?: ProductionStepId;
  steps: ProductionStep[];
  checkpoint?: ProductionCheckpoint;
  continued: boolean;
  code?: string;
};
export type ProductionResult = {
  status: "done" | "failed" | "blocked" | "needs-input" | "uncertain";
  code?: string;
  detail?: string;
  /** Passed to save with the terminal target state; never placed in the state itself. */
  data?: unknown;
};
export type ProductionHost = {
  current: () => { projectId: string; inputVersion: string };
  targets: (step: ProductionStepId) => Promise<string[]> | string[];
  execute: (
    step: ProductionStepId,
    targetId: string,
    context: { runId: string; signal: AbortSignal },
  ) => Promise<ProductionResult>;
  checkpoint: () => Promise<ProductionCheckpoint> | ProductionCheckpoint;
  executionOrder?: readonly ProductionStepId[];
  beforeMediaCheckpoint?: () => Promise<ProductionCheckpoint> | ProductionCheckpoint;
  /** Check isCurrent at the actual write boundary. Persist artifacts and this state together. */
  save: (
    state: ProductionPipeline,
    context: {
      isCurrent: () => boolean;
      completion?: { step: ProductionStepId; targetId: string; result: ProductionResult };
    },
  ) => Promise<void>;
};
export type ProductionRunOptions = {
  signal?: AbortSignal;
  continue?: boolean;
  /** Exact step/target keys, only from a fresh explicit user retry decision. */
  retryTargets?: string[];
  /** A recorded human review, never an automatic substitute for unavailable vision. */
  acceptInputs?: { key: string; reason: string }[];
};
const TARGET_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "blocked",
  "needs-input",
  "uncertain",
  "accepted",
];
const OPTIONAL_STEPS = ["portraits", "action", "performance"];
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

function validCheckpoint(value: unknown): value is ProductionCheckpoint {
  if (
    !object(value) ||
    !count(value.shotCount) ||
    typeof value.seconds !== "number" ||
    !Number.isFinite(value.seconds) ||
    value.seconds < 0 ||
    !count(value.estimatedRequests)
  )
    return false;
  if (!Array.isArray(value.coverage) || !Array.isArray(value.risks)) return false;
  const seen = new Set<string>();
  for (const scene of value.coverage) {
    if (
      !object(scene) ||
      !nonempty(scene.sceneId) ||
      seen.has(scene.sceneId) ||
      typeof scene.ok !== "boolean" ||
      !Array.isArray(scene.missingLines) ||
      !scene.missingLines.every((line) => typeof line === "string") ||
      !(scene.missingTail === null || typeof scene.missingTail === "string")
    )
      return false;
    if (scene.ok && (scene.missingLines.length || scene.missingTail)) return false;
    seen.add(scene.sceneId);
  }
  return value.risks.every(
    (risk) =>
      object(risk) &&
      nonempty(risk.code) &&
      typeof risk.text === "string" &&
      ["block", "manual", "info"].includes(String(risk.severity)),
  );
}

/** Storage validation is deliberately strict: missing steps are never interpreted as completed. */
export function isProductionPipeline(value: unknown): value is ProductionPipeline {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !nonempty(value.projectId) ||
    !nonempty(value.inputVersion) ||
    typeof value.continued !== "boolean" ||
    ![...TARGET_STATUSES, "checkpoint", "cancelled"].includes(String(value.status))
  )
    return false;
  if (value.runId !== undefined && !nonempty(value.runId)) return false;
  if (value.code !== undefined && typeof value.code !== "string") return false;
  if (value.current !== undefined && !PRODUCTION_STEPS.includes(value.current as ProductionStepId))
    return false;
  if (value.checkpoint !== undefined && !validCheckpoint(value.checkpoint)) return false;
  if (value.status === "checkpoint" && (!value.checkpoint || value.continued)) return false;
  if (
    value.continued &&
    (!validCheckpoint(value.checkpoint) ||
      value.checkpoint.shotCount < 1 ||
      value.checkpoint.seconds <= 0 ||
      !value.checkpoint.coverage.length ||
      value.checkpoint.coverage.some((scene) => !scene.ok) ||
      value.checkpoint.risks.some((risk) => risk.severity === "block"))
  )
    return false;
  if (!Array.isArray(value.steps) || value.steps.length !== PRODUCTION_STEPS.length) return false;
  for (const [index, step] of value.steps.entries()) {
    if (
      !object(step) ||
      step.id !== PRODUCTION_STEPS[index] ||
      !TARGET_STATUSES.includes(String(step.status)) ||
      typeof step.planned !== "boolean" ||
      !Array.isArray(step.targets) ||
      !count(step.done) ||
      step.total !== step.targets.length
    )
      return false;
    if (!step.planned && (step.targets.length || step.status !== "queued")) return false;
    const ids = new Set<string>();
    for (const target of step.targets) {
      if (
        !object(target) ||
        !nonempty(target.id) ||
        ids.has(target.id) ||
        !TARGET_STATUSES.includes(String(target.status)) ||
        !count(target.attempt)
      )
        return false;
      if (target.status === "running" && target.attempt < 1) return false;
      if (target.code !== undefined && typeof target.code !== "string") return false;
      if (target.detail !== undefined && typeof target.detail !== "string") return false;
      if (target.status === "accepted" && !nonempty(target.detail)) return false;
      ids.add(target.id);
    }
    const done = step.targets.filter((target) => finished(target.status)).length;
    if (step.done !== done) return false;
    if (
      finished(step.status as ProductionStatus) &&
      (!step.planned ||
        done !== step.total ||
        (!step.targets.length && !OPTIONAL_STEPS.includes(String(step.id))))
    )
      return false;
    if (step.status === "accepted" && !step.targets.some((target) => target.status === "accepted"))
      return false;
    if (step.status === "done" && step.targets.some((target) => target.status === "accepted"))
      return false;
  }
  if (
    ["done", "accepted"].includes(String(value.status)) &&
    (!value.continued || !value.steps.every((step) => finished(step.status)))
  )
    return false;
  if (value.status === "done" && value.steps.some((step) => step.status === "accepted"))
    return false;
  return true;
}

export function validateProductionPipeline(
  value: unknown,
): { ok: true; state: ProductionPipeline } | { ok: false; code: "STATE_INVALID" } {
  return isProductionPipeline(value)
    ? { ok: true, state: value }
    : { ok: false, code: "STATE_INVALID" };
}

const owners = new Map<string, symbol>();
export const productionTargetKey = (step: ProductionStepId, target: string) => `${step}/${target}`;

export function createProductionPipeline(
  projectId: string,
  inputVersion: string,
): ProductionPipeline {
  return {
    schemaVersion: 1,
    projectId,
    inputVersion,
    status: "queued",
    continued: false,
    steps: PRODUCTION_STEPS.map((id) => ({
      id,
      status: "queued",
      targets: [],
      planned: false,
      done: 0,
      total: 0,
    })),
  };
}

/** A restarted process cannot infer whether a dispatched request reached the provider. */
export function recoverProductionPipeline(saved: ProductionPipeline): ProductionPipeline {
  const identity = { projectId: saved?.projectId ?? "", inputVersion: saved?.inputVersion ?? "" };
  if (!isProductionPipeline(saved))
    return {
      ...createProductionPipeline(identity.projectId, identity.inputVersion),
      status: "blocked",
      code: "STATE_INVALID",
    };
  const state = structuredClone(saved);
  for (const step of state.steps) {
    for (const target of step.targets) {
      if (target.status === "running")
        Object.assign(target, { status: "uncertain", code: "RUN_INTERRUPTED" });
    }
    if (step.targets.some((target) => target.status === "uncertain")) step.status = "uncertain";
    else if (step.status === "running") step.status = "queued";
    refresh(step);
  }
  if (state.steps.some((step) => step.status === "uncertain")) state.status = "uncertain";
  else if (state.status === "running") state.status = "queued";
  return state;
}

function refresh(step: ProductionStep) {
  step.total = step.targets.length;
  step.done = step.targets.filter(
    (target) => target.status === "done" || target.status === "accepted",
  ).length;
  if (
    step.done === step.total &&
    step.planned &&
    (step.total > 0 || OPTIONAL_STEPS.includes(step.id))
  )
    step.status = step.targets.some((target) => target.status === "accepted") ? "accepted" : "done";
  else if (finished(step.status)) step.status = "running";
}
const finished = (status: ProductionStatus) => status === "done" || status === "accepted";

async function cancellableRequest(
  request: Promise<ProductionResult>,
  signal: AbortSignal,
): Promise<ProductionResult> {
  let abort: () => void = () => undefined;
  const cancelled = new Promise<ProductionResult>((resolve) => {
    abort = () =>
      resolve({
        status: "uncertain",
        code: "REQUEST_CANCELLED",
        detail: "请求可能已经发送，请先核对结果。",
      });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([request, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Runs to the review checkpoint; only explicit continue can dispatch video/assembly. */
export async function runProductionPipeline(
  saved: ProductionPipeline,
  host: ProductionHost,
  options: ProductionRunOptions = {},
): Promise<ProductionPipeline> {
  if (!isProductionPipeline(saved) || saved.code === "STATE_INVALID") {
    const live = host.current();
    return {
      ...createProductionPipeline(live.projectId, live.inputVersion),
      status: "blocked",
      code: "STATE_INVALID",
    };
  }
  const state = recoverProductionPipeline(saved);
  const continueAuthorized =
    options.continue === true && saved.status === "checkpoint" && Boolean(saved.checkpoint);
  const beforeMedia = saved.current === "portraits" || saved.current === "stills";
  const videoContinueAuthorized = continueAuthorized && !beforeMedia;
  const order = host.executionOrder ?? PRODUCTION_STEPS;
  if (
    order.length !== PRODUCTION_STEPS.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !PRODUCTION_STEPS.includes(id))
  )
    return { ...state, status: "blocked", code: "STATE_INVALID" };
  let mediaConfirmed = false;
  if (owners.has(state.projectId))
    return { ...state, status: "blocked", code: "PIPELINE_ALREADY_RUNNING" };
  const owner = Symbol(state.projectId);
  owners.set(state.projectId, owner);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const current = () => {
    const live = host.current();
    return (
      owners.get(state.projectId) === owner &&
      live.projectId === state.projectId &&
      live.inputVersion === state.inputVersion
    );
  };
  const persist = async (completion?: Parameters<ProductionHost["save"]>[1]["completion"]) => {
    if (!current()) return false;
    await host.save(structuredClone(state), { isCurrent: current, completion });
    return current();
  };
  try {
    if (!current()) return { ...state, status: "blocked", code: "PIPELINE_INPUT_CHANGED" };
    state.runId = crypto.randomUUID();
    delete state.code;
    for (const stepId of order) {
      const step = state.steps.find((item) => item.id === stepId)!;
      if (!current()) return state;
      if (controller.signal.aborted) {
        state.status = "cancelled";
        await persist();
        return state;
      }
      const nextMediaTarget = step.targets.find((target) => !finished(target.status));
      if (
        !mediaConfirmed &&
        host.beforeMediaCheckpoint &&
        !finished(step.status) &&
        (!nextMediaTarget ||
          nextMediaTarget.status === "queued" ||
          options.retryTargets?.includes(productionTargetKey(step.id, nextMediaTarget.id))) &&
        (step.id === "portraits" || step.id === "stills")
      ) {
        const checkpoint = await host.beforeMediaCheckpoint();
        if (!current()) return state;
        if (!validCheckpoint(checkpoint)) {
          state.status = "blocked";
          state.code = "CHECKPOINT_INVALID";
          await persist();
          return state;
        }
        const blocked =
          checkpoint.shotCount < 1 ||
          checkpoint.seconds <= 0 ||
          !checkpoint.coverage.length ||
          checkpoint.coverage.some((scene) => !scene.ok) ||
          checkpoint.risks.some((risk) => risk.severity === "block");
        const accepted =
          continueAuthorized &&
          beforeMedia &&
          saved.current === step.id &&
          JSON.stringify(saved.checkpoint) === JSON.stringify(checkpoint);
        state.checkpoint = checkpoint;
        state.current = step.id;
        state.status = blocked ? "blocked" : "checkpoint";
        if (!(await persist()) || blocked || !accepted) return state;
        mediaConfirmed = true;
        state.status = "queued";
        if (!(await persist())) return state;
      }
      if (step.id === "video" && !state.continued) {
        state.checkpoint = await host.checkpoint();
        if (!current()) return state;
        const checkpoint = state.checkpoint;
        if (!validCheckpoint(checkpoint)) {
          delete state.checkpoint;
          state.status = "blocked";
          state.code = "CHECKPOINT_INVALID";
          await persist();
          return state;
        }
        const blocked =
          !Number.isInteger(checkpoint.shotCount) ||
          checkpoint.shotCount < 1 ||
          !Number.isFinite(checkpoint.seconds) ||
          checkpoint.seconds <= 0 ||
          !Number.isInteger(checkpoint.estimatedRequests) ||
          checkpoint.estimatedRequests < 0 ||
          checkpoint.coverage.length === 0 ||
          checkpoint.coverage.some((scene) => !scene.ok) ||
          checkpoint.risks.some((risk) => risk.severity === "block");
        state.status = blocked ? "blocked" : "checkpoint";
        if (!(await persist()) || blocked || !videoContinueAuthorized) return state;
        state.continued = true;
        state.status = "queued";
        state.current = "video";
        if (!(await persist())) return state;
      }
      const targetIds = await host.targets(step.id);
      if (!current()) return state;
      if (
        step.planned &&
        JSON.stringify(targetIds) !== JSON.stringify(step.targets.map((target) => target.id))
      ) {
        state.status = "blocked";
        state.code = "PIPELINE_TARGETS_CHANGED";
        await persist();
        return state;
      }
      if (step.planned && !step.targets.length && !OPTIONAL_STEPS.includes(step.id)) {
        state.status = "blocked";
        await persist();
        return state;
      }
      if (finished(step.status)) continue;
      state.current = step.id;
      if (!step.planned) {
        const ids = targetIds;
        if (!current()) return state;
        if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
          state.status = "blocked";
          state.code = "PIPELINE_TARGETS_INVALID";
          await persist();
          return state;
        }
        step.targets = ids.map((id) => ({ id, status: "queued", attempt: 0 }));
        step.planned = true;
        // Empty optional work is explicit; required artifact stages cannot silently disappear.
        if (!ids.length && !OPTIONAL_STEPS.includes(step.id)) {
          step.status = "blocked";
          state.status = "blocked";
          if (!(await persist())) return state;
          return state;
        }
        refresh(step);
        if (!(await persist())) return state;
      }
      for (const target of step.targets) {
        if (!current()) return state;
        if (finished(target.status)) continue;
        const key = productionTargetKey(step.id, target.id);
        const acceptance = options.acceptInputs?.find(
          (input) => input.key === key && input.reason.trim(),
        );
        if (target.status === "needs-input" && acceptance) {
          Object.assign(target, {
            status: "accepted",
            code: "HUMAN_REVIEW_ACCEPTED",
            detail: acceptance.reason,
          });
          refresh(step);
          if (!(await persist())) return state;
          continue;
        }
        if (target.status !== "queued" && !options.retryTargets?.includes(key)) {
          step.status = target.status;
          state.status = target.status;
          await persist();
          return state;
        }
        if (controller.signal.aborted) {
          state.status = "cancelled";
          await persist();
          return state;
        }
        Object.assign(target, {
          status: "running",
          attempt: target.attempt + 1,
          code: undefined,
          detail: undefined,
        });
        step.status = "running";
        state.status = "running";
        if (!(await persist())) return state;
        if (controller.signal.aborted) {
          target.status = "queued"; // Persisted intent, but no provider dispatch occurred.
          step.status = "queued";
          state.status = "cancelled";
          await persist();
          return state;
        }
        let result: ProductionResult;
        try {
          result = await cancellableRequest(
            host.execute(step.id, target.id, { runId: state.runId, signal: controller.signal }),
            controller.signal,
          );
        } catch {
          result = { status: "uncertain", code: "REQUEST_OUTCOME_UNKNOWN" };
        }
        if (!current()) return state;
        Object.assign(target, { status: result.status, code: result.code, detail: result.detail });
        step.status = result.status;
        state.status = result.status === "done" ? "running" : result.status;
        refresh(step);
        if (!(await persist({ step: step.id, targetId: target.id, result }))) return state;
        if (!finished(target.status)) return state;
      }
      refresh(step);
      if (!(await persist())) return state;
    }
    state.status = state.steps.some((step) => step.status === "accepted") ? "accepted" : "done";
    await persist();
    return state;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    if (owners.get(state.projectId) === owner) owners.delete(state.projectId);
  }
}
