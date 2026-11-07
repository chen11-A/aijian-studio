import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  FilmRiskTrialDecision,
  FilmRiskTrialFailure,
  FilmRiskTrialInput,
  FilmRiskTrialReady,
  FilmRiskTrialRecordInput,
  FilmRiskTrialCheckInput,
} from "@aijian/contracts/film-risk-trial";
import {
  readProject,
  transactFilmProject,
  readMedia,
  mediaUrlPath,
  trustedMediaPath,
  type FilmRecord,
} from "./film-library";
import { filmHistoryRecordHash } from "./film-history";
import { exportFileHash } from "./film-export-io";
import { resolveAudioMix } from "./film-audio-mix-sources";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
import {
  trialObject as object,
  riskTrialShots,
  riskTrialCreative,
  riskTrialTarget,
} from "@aijian/contracts/film-risk-trial-context";
const digest = filmHistoryRecordHash;
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown) =>
  typeof v === "string" && v.length > 0 && v.length <= 160 && !v.includes("\0");
const projectId = (v: unknown) => typeof v === "string" && /^film_[a-z0-9]{16,40}$/.test(v);
const exact = (v: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every((key) => Object.hasOwn(v, key)) &&
  Object.keys(v).every((key) => [...required, ...optional].includes(key));
const failure = (value: unknown, unchanged = true): FilmRiskTrialFailure => {
  const code = value instanceof Error ? value.message : "WRITE_FAILED";
  return {
    kind: "FAILED",
    code: ([
      "INVALID_INPUT",
      "PROJECT_CHANGED",
      "SOURCE_UNVERIFIED",
      "TOOLS_UNAVAILABLE",
      "BUSY",
      "UNSUPPORTED_SCOPE",
      "WRITE_FAILED",
      "WRITE_UNCONFIRMED",
      "REVIEW_STALE",
    ].includes(code)
      ? code
      : "WRITE_FAILED") as FilmRiskTrialFailure["code"],
    unchanged,
  };
};
function fail(code: FilmRiskTrialFailure["code"]): never {
  throw Error(code);
}
function scope(value: unknown, kind: "prepare" | "record" | "check") {
  const v = object(value);
  const fields =
    kind === "prepare"
      ? ["shotId", "takeId"]
      : kind === "record"
        ? ["reviewId", "decision", "note"]
        : ["decisionId"];
  if (
    !v ||
    !exact(v, ["projectId", "expectedHash", ...fields], kind === "check" ? ["targetShotId"] : []) ||
    !projectId(v.projectId) ||
    !hash(v.expectedHash) ||
    (kind === "prepare" && (!id(v.shotId) || !id(v.takeId))) ||
    (kind === "record" &&
      (typeof v.reviewId !== "string" ||
        !/^rtr_[a-f0-9]{32}$/.test(v.reviewId) ||
        typeof v.decision !== "string" ||
        !["accepted", "needs-changes"].includes(v.decision) ||
        typeof v.note !== "string" ||
        v.note.length > 500)) ||
    (kind === "check" &&
      (typeof v.decisionId !== "string" ||
        !/^rtd_[a-f0-9]{32}$/.test(v.decisionId) ||
        (v.targetShotId !== undefined && !id(v.targetShotId))))
  )
    fail("INVALID_INPUT");
  return { ...v };
}
type Binding = {
  global: string;
  trial: string;
  targets: { shotId: string; fingerprint: string }[];
};
type StoredDecision = FilmRiskTrialDecision & { binding: Binding };
type Review = {
  owner: number;
  epoch: number;
  input: FilmRiskTrialInput;
  fingerprint: string;
  binding: Binding;
  visual: { path: string; sha256: string };
  duration: number;
  label: string;
  versionLabel: string;
  decisionId: string;
};
export function createFilmRiskTrials(host: {
  filmsRoot: string;
  storyFilmsRoot: string;
  tools: () => Promise<QcTools>;
  run: QcRunner;
  videoOwner: (projectId: string, path: string, sha: string) => Promise<boolean>;
  beforeCommit?: () => Promise<void>;
  read?: typeof readProject;
}) {
  const reviews = new Map<string, Review>(),
    epochs = new Map<number, number>(),
    active = new Set<string>(),
    ownerControllers = new Map<number, Set<AbortController>>();
  const epoch = (owner: number) => epochs.get(owner) ?? 0;
  async function current(project: string, expected?: string) {
    const record = await (host.read ?? readProject)(host.filmsRoot, project);
    if (
      !record ||
      record.id !== project ||
      (expected && filmHistoryRecordHash(record) !== expected)
    )
      fail("PROJECT_CHANGED");
    return record;
  }
  async function compileUnsafe(
    record: FilmRecord,
    shotId: string,
    takeId: string,
    signal: AbortSignal,
  ) {
    if (signal.aborted) fail("REVIEW_STALE");
    const shots = riskTrialShots(record),
      shot = shots.find((item) => item.id === shotId);
    const takes = Array.isArray(shot?.takes) ? shot.takes.map(object) : [];
    const matches = takes.filter((take) => take?.id === takeId),
      take = matches[0];
    if (
      !shot ||
      shot.selectedTakeId !== takeId ||
      matches.length !== 1 ||
      !take ||
      take.shotId !== shotId ||
      take.status !== "done" ||
      typeof take.videoPath !== "string"
    )
      fail("REVIEW_STALE");
    const tools = await host.tools().catch(() => fail("TOOLS_UNAVAILABLE"));
    const mix = await resolveAudioMix(
      { ...record, audioClips: [] },
      [
        {
          shotId,
          takeId,
          videoPath: take.videoPath,
          ...(typeof take.cleanVideoPath === "string" && take.cleanVideoPath
            ? { visualPath: take.cleanVideoPath }
            : {}),
        },
      ],
      { ...host, tools, signal },
    ).catch(() => fail("SOURCE_UNVERIFIED"));
    const selected = mix.selectedSources[0],
      duration = mix.plan.shots[0]?.durationSeconds;
    if (!selected || typeof duration !== "number" || duration <= 0 || duration > 36000)
      fail("SOURCE_UNVERIFIED");
    const media = await stat(selected.visual.path);
    if (!media.isFile() || media.size <= 0 || media.size > 80 * 1024 * 1024)
      fail("SOURCE_UNVERIFIED");
    const root = await realpath(host.filmsRoot),
      series = await realpath(join(root, record.seriesId));
    if (relative(root, series) !== record.seriesId) fail("SOURCE_UNVERIFIED");
    const episode = await realpath(join(series, "episodes", record.id));
    if (relative(series, episode) !== join("episodes", record.id)) fail("SOURCE_UNVERIFIED");
    const referenceFiles = new Map<string, string>();
    const refs = async (context: unknown) => {
      const found: { role: string; sha256: string }[] = [];
      const source = async (item: string, role: string) => {
        if (!item) return;
        let path: string;
        try {
          path = trustedMediaPath([episode, join(series, "media")], mediaUrlPath(item));
        } catch {
          fail("SOURCE_UNVERIFIED");
        }
        const image = await stat(path!);
        if (!image.isFile() || image.size <= 0 || image.size > 12 * 1024 * 1024)
          fail("SOURCE_UNVERIFIED");
        const previous = referenceFiles.get(path!);
        const sha256 = previous ?? (await exportFileHash(path!, signal));
        referenceFiles.set(path!, sha256);
        found.push({ role, sha256 });
      };
      const walk = async (value: unknown, role: string): Promise<void> => {
        // dialogueEvidenceContext deliberately encodes still identities as [id,url] tuples.
        if (typeof value === "string" && /^references\/stills\/\d+\/1$/.test(role)) {
          await source(value, role);
          return;
        }
        if (Array.isArray(value)) {
          for (const [i, row] of value.entries()) await walk(row, `${role}/${i}`);
          return;
        }
        const row = object(value);
        if (!row) return;
        for (const [key, item] of Object.entries(row)) {
          if (
            ["poster", "url", "referenceImage", "layoutUrl", "path"].includes(key) &&
            typeof item === "string"
          )
            await source(item, `${role}/${key}`);
          else await walk(item, `${role}/${key}`);
        }
      };
      await walk(context, "references");
      return found;
    };
    const targets: Binding["targets"] = [];
    for (const target of shots) {
      const context = riskTrialTarget(record, target);
      targets.push({
        shotId: String(target.id),
        fingerprint: digest({ context, refs: await refs(context.referenceIdentity) }),
      });
    }
    const binding: Binding = {
      global: digest(riskTrialCreative(record)),
      trial: digest({
        shotId,
        takeId,
        native: selected.native.sha256,
        visual: selected.visual.sha256,
        duration,
        version: { index: take.index, prompt: take.prompt, createdAt: take.createdAt },
        target: targets.find((row) => row.shotId === shotId)?.fingerprint,
      }),
      targets,
    };
    // Rehash the exact consumed video identities, not a new resolution of mutable aliases.
    for (const source of [selected.native, selected.visual])
      if ((await exportFileHash(source.path, signal)) !== source.sha256) fail("REVIEW_STALE");
    for (const [path, sha256] of referenceFiles)
      if ((await exportFileHash(path, signal)) !== sha256) fail("REVIEW_STALE");
    const scene = (Array.isArray(record.scenes) ? record.scenes.map(object) : []).find(
      (row) => row?.id === shot.sceneId,
    );
    const label =
      Number.isInteger(scene?.no) && Number.isInteger(shot.no)
        ? `第 ${scene!.no} 场 · 镜头 ${shot.no}`
        : "所选镜头";
    const versionLabel = Number.isInteger(take.index) ? `第 ${take.index} 版` : "所选版本";
    return {
      binding,
      fingerprint: digest({ projectId: record.id, shotId, takeId, binding }),
      visual: selected.visual,
      duration,
      label,
      versionLabel,
    };
  }
  async function compile(record: FilmRecord, shotId: string, takeId: string, signal: AbortSignal) {
    try {
      return await compileUnsafe(record, shotId, takeId, signal);
    } catch (error) {
      if (signal.aborted) fail("REVIEW_STALE");
      if (
        error instanceof Error &&
        ["SOURCE_UNVERIFIED", "TOOLS_UNAVAILABLE", "UNSUPPORTED_SCOPE", "REVIEW_STALE"].includes(
          error.message,
        )
      )
        throw error;
      // This phase is strictly read-only; failed stat/hash/probe is not a failed save.
      fail("SOURCE_UNVERIFIED");
    }
  }
  function stored(record: FilmRecord) {
    if (record.riskTrialDecisions === undefined) return [];
    if (!Array.isArray(record.riskTrialDecisions) || record.riskTrialDecisions.length > 64)
      fail("UNSUPPORTED_SCOPE");
    const identifiers = new Set<string>();
    for (const item of record.riskTrialDecisions) {
      const row = object(item),
        binding = object(row?.binding);
      if (
        !row ||
        !exact(row, [
          "schemaVersion",
          "id",
          "projectId",
          "shotId",
          "takeId",
          "inputFingerprint",
          "decision",
          "note",
          "recordedAt",
          "binding",
        ]) ||
        row.schemaVersion !== 1 ||
        typeof row.id !== "string" ||
        !/^rtd_[a-f0-9]{32}$/.test(row.id) ||
        identifiers.has(row.id) ||
        !projectId(row.projectId) ||
        !id(row.shotId) ||
        !id(row.takeId) ||
        !hash(row.inputFingerprint) ||
        typeof row.decision !== "string" ||
        !["accepted", "needs-changes"].includes(row.decision) ||
        typeof row.note !== "string" ||
        row.note.length > 500 ||
        typeof row.recordedAt !== "string" ||
        !Number.isFinite(Date.parse(row.recordedAt)) ||
        !binding ||
        !exact(binding, ["global", "trial", "targets"]) ||
        !hash(binding.global) ||
        !hash(binding.trial) ||
        !Array.isArray(binding.targets) ||
        binding.targets.length > 256
      )
        fail("UNSUPPORTED_SCOPE");
      const targets = new Set<string>();
      for (const item of binding.targets) {
        const target = object(item);
        if (
          !target ||
          !exact(target, ["shotId", "fingerprint"]) ||
          !id(target.shotId) ||
          !hash(target.fingerprint) ||
          targets.has(String(target.shotId))
        )
          fail("UNSUPPORTED_SCOPE");
        targets.add(String(target.shotId));
      }
      if (
        digest({ projectId: row.projectId, shotId: row.shotId, takeId: row.takeId, binding }) !==
        row.inputFingerprint
      )
        fail("UNSUPPORTED_SCOPE");
      identifiers.add(row.id);
    }
    return record.riskTrialDecisions as StoredDecision[];
  }
  const publicDecision = (row: StoredDecision): FilmRiskTrialDecision => ({
    schemaVersion: 1,
    id: row.id,
    projectId: row.projectId,
    shotId: row.shotId,
    takeId: row.takeId,
    inputFingerprint: row.inputFingerprint,
    decision: row.decision,
    note: row.note,
    recordedAt: row.recordedAt,
  });
  async function enter<T>(
    project: string,
    owner: number,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (active.has(project)) fail("BUSY");
    active.add(project);
    const controller = new AbortController();
    let controllers = ownerControllers.get(owner);
    if (!controllers) {
      controllers = new Set();
      ownerControllers.set(owner, controllers);
    }
    controllers.add(controller);
    try {
      return await work(controller.signal);
    } finally {
      active.delete(project);
      controllers.delete(controller);
      if (!controllers.size && ownerControllers.get(owner) === controllers)
        ownerControllers.delete(owner);
    }
  }
  return {
    disposeOwner(owner: number) {
      epochs.set(owner, epoch(owner) + 1);
      for (const controller of ownerControllers.get(owner) ?? []) controller.abort();
      ownerControllers.delete(owner);
      for (const [key, value] of reviews) if (value.owner === owner) reviews.delete(key);
    },
    async prepare(
      owner: number,
      value: unknown,
    ): Promise<FilmRiskTrialReady | FilmRiskTrialFailure> {
      try {
        const input = scope(value, "prepare") as unknown as FilmRiskTrialInput,
          captured = epoch(owner);
        return await enter(input.projectId, owner, async (signal) => {
          const record = await current(input.projectId, input.expectedHash);
          const decisions = stored(record);
          const plan = await compile(record, input.shotId, input.takeId, signal);
          await current(input.projectId, input.expectedHash);
          if (epoch(owner) !== captured) fail("REVIEW_STALE");
          const reviewId = `rtr_${randomUUID().replaceAll("-", "")}`;
          const decisionId = `rtd_${randomUUID().replaceAll("-", "")}`;
          for (const [key, prior] of reviews) if (prior.owner === owner) reviews.delete(key);
          reviews.set(reviewId, { ...plan, owner, epoch: captured, input, decisionId });
          const latest = [...decisions]
            .reverse()
            .find(
              (row) =>
                row.projectId === input.projectId &&
                row.shotId === input.shotId &&
                row.takeId === input.takeId,
            );
          const prior = latest?.inputFingerprint === plan.fingerprint ? latest : undefined;
          return {
            kind: "READY",
            projectId: input.projectId,
            projectHash: input.expectedHash,
            reviewId,
            shotId: input.shotId,
            takeId: input.takeId,
            label: plan.label,
            versionLabel: plan.versionLabel,
            durationSeconds: plan.duration,
            batchShotCount: riskTrialShots(record).length,
            inputFingerprint: plan.fingerprint,
            existingDecision: prior ? publicDecision(prior) : null,
            limitations: [
              "这是所选版本的画面素材，不是最终四轨混音与字幕成片。",
              "本次将实际素材与当前创作输入绑定，不证明素材最初由当前输入或模型生成。",
              "接受或需修改是你的人工决定，不证明已经观看、试听或技术验收通过。",
              "继续批次仍需原费用、数量与输入确认。",
            ],
          };
        });
      } catch (error) {
        return failure(error);
      }
    },
    async readMedia(owner: number, project: string, reviewId: string) {
      try {
        if (!projectId(project) || typeof reviewId !== "string") fail("INVALID_INPUT");
        const review = reviews.get(reviewId);
        if (
          !review ||
          review.owner !== owner ||
          review.epoch !== epoch(owner) ||
          review.input.projectId !== project
        )
          fail("REVIEW_STALE");
        return await enter(project, owner, async (signal) => {
          const record = await current(project),
            plan = await compile(record, review.input.shotId, review.input.takeId, signal);
          if (
            plan.fingerprint !== review.fingerprint ||
            review.epoch !== epoch(owner) ||
            reviews.get(reviewId) !== review
          )
            fail("REVIEW_STALE");
          const bytes = await readMedia([host.filmsRoot, host.storyFilmsRoot], review.visual.path, {
            maxBytes: 80 * 1024 * 1024,
            expectedSha256: review.visual.sha256,
          });
          if (review.epoch !== epoch(owner) || reviews.get(reviewId) !== review)
            fail("REVIEW_STALE");
          return { kind: "MEDIA" as const, bytes };
        });
      } catch (error) {
        return failure(error);
      }
    },
    async record(owner: number, value: unknown) {
      let attempted = false;
      try {
        const input = scope(value, "record") as unknown as FilmRiskTrialRecordInput;
        const review = reviews.get(input.reviewId);
        if (
          !review ||
          review.owner !== owner ||
          review.epoch !== epoch(owner) ||
          review.input.projectId !== input.projectId
        )
          fail("REVIEW_STALE");
        return await enter(input.projectId, owner, async (signal) => {
          const saved = await transactFilmProject(
            host.filmsRoot,
            input.projectId,
            async (record, write) => {
              if (!record || filmHistoryRecordHash(record) !== input.expectedHash)
                fail("PROJECT_CHANGED");
              if (
                (Array.isArray(record.jobs) &&
                  record.jobs.some((row) =>
                    ["queued", "running"].includes(String(object(row)?.status)),
                  )) ||
                object(record.productionPipeline)?.status === "running"
              )
                fail("BUSY");
              const plan = await compile(record, review.input.shotId, review.input.takeId, signal);
              if (plan.fingerprint !== review.fingerprint || review.epoch !== epoch(owner))
                fail("REVIEW_STALE");
              const existing = stored(record),
                prior = existing.find((row) => row.id === review.decisionId);
              if (prior) {
                if (
                  prior.decision !== input.decision ||
                  prior.note !== input.note ||
                  prior.inputFingerprint !== plan.fingerprint
                )
                  fail("REVIEW_STALE");
                return { project: record, decision: prior };
              }
              if (existing.length >= 64) fail("UNSUPPORTED_SCOPE");
              const decision: StoredDecision = {
                schemaVersion: 1,
                id: review.decisionId,
                projectId: input.projectId,
                shotId: review.input.shotId,
                takeId: review.input.takeId,
                inputFingerprint: plan.fingerprint,
                decision: input.decision,
                note: input.note,
                recordedAt: new Date().toISOString(),
                binding: plan.binding,
              };
              await host.beforeCommit?.();
              if (review.epoch !== epoch(owner)) fail("REVIEW_STALE");
              // The hook may only affect test scheduling; source identity is checked at the final boundary.
              const final = await compile(record, review.input.shotId, review.input.takeId, signal);
              if (
                final.fingerprint !== plan.fingerprint ||
                review.epoch !== epoch(owner) ||
                reviews.get(input.reviewId) !== review
              )
                fail("REVIEW_STALE");
              attempted = true;
              const project = await write({
                ...record,
                riskTrialDecisions: [...existing, decision],
              });
              const readback = await current(input.projectId);
              if (filmHistoryRecordHash(readback) !== filmHistoryRecordHash(project))
                fail("WRITE_UNCONFIRMED");
              return { project: readback, decision };
            },
          );
          return {
            kind: "RECORDED" as const,
            project: saved.project,
            decision: publicDecision(saved.decision),
          };
        });
      } catch (error) {
        return attempted ? failure(Error("WRITE_UNCONFIRMED"), false) : failure(error);
      }
    },
    async check(owner: number, value: unknown) {
      const captured = epoch(owner);
      try {
        const input = scope(value, "check") as unknown as FilmRiskTrialCheckInput;
        return await enter(input.projectId, owner, async (signal) => {
          const record = await current(input.projectId, input.expectedHash);
          const decisions = stored(record),
            matches = decisions.filter((row) => row.id === input.decisionId);
          const decision = matches[0];
          if (
            matches.length !== 1 ||
            !decision ||
            decision.projectId !== record.id ||
            decision.decision !== "accepted" ||
            !object(decision.binding)
          )
            fail("REVIEW_STALE");
          const latest = [...decisions]
            .reverse()
            .find(
              (row) =>
                row.projectId === decision.projectId &&
                row.shotId === decision.shotId &&
                row.takeId === decision.takeId,
            );
          if (latest?.id !== decision.id) fail("REVIEW_STALE");
          const plan = await compile(record, decision.shotId, decision.takeId, signal);
          if (
            decision.binding.global !== plan.binding.global ||
            decision.binding.trial !== plan.binding.trial
          )
            fail("REVIEW_STALE");
          if (input.targetShotId) {
            const state = object(record.productionPipeline);
            const steps = Array.isArray(state?.steps) ? state.steps.map(object) : [];
            const video = steps.filter((step) => step?.id === "video");
            const targets = Array.isArray(video[0]?.targets) ? video[0]!.targets.map(object) : [];
            if (
              state?.projectId !== record.id ||
              state.status !== "running" ||
              state.current !== "video" ||
              state.continued !== true ||
              video.length !== 1 ||
              video[0]?.planned !== true ||
              targets.filter(
                (target) => target?.id === input.targetShotId && target?.status === "running",
              ).length !== 1 ||
              JSON.stringify(targets.map((target) => target?.id)) !==
                JSON.stringify(riskTrialShots(record).map((shot) => shot.id))
            )
              fail("REVIEW_STALE");
            const before = decision.binding.targets.filter(
                (row) => row.shotId === input.targetShotId,
              ),
              now = plan.binding.targets.filter((row) => row.shotId === input.targetShotId);
            if (
              before.length !== 1 ||
              now.length !== 1 ||
              before[0]!.fingerprint !== now[0]!.fingerprint
            )
              fail("REVIEW_STALE");
          } else if (plan.fingerprint !== decision.inputFingerprint) fail("REVIEW_STALE");
          await current(input.projectId, input.expectedHash);
          if (epoch(owner) !== captured) fail("REVIEW_STALE");
          return {
            kind: "ACCEPTED" as const,
            projectId: input.projectId,
            decisionId: decision.id,
            inputFingerprint: decision.inputFingerprint,
          };
        });
      } catch (error) {
        return failure(error);
      }
    },
  };
}
