import { randomUUID } from "node:crypto";
import {
  dialogueSplitContext,
  planDialogueSplit,
} from "@aijian/contracts/film-dialogue-split-plan";
import type {
  FilmDialogueSplitInput,
  FilmDialogueSplitApplyInput,
  FilmDialogueSplitReady,
  FilmDialogueSplitFailure,
  FilmDialogueSplitPrepareResult,
  FilmDialogueSplitApplyResult,
} from "@aijian/contracts/film-dialogue-split";
import type { FilmHistoryEntry } from "@aijian/contracts/film-history";
import { createFilmHistory, filmHistoryRecordHash } from "./film-history";
import { readProject, type FilmRecord } from "./film-library";
const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(object).filter((row): row is Record<string, unknown> => !!row) : [];
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function parse(
  value: unknown,
  apply = false,
): FilmDialogueSplitApplyInput | FilmDialogueSplitInput {
  const v = object(value);
  if (
    !v ||
    Object.keys(v).sort().join() !==
      [
        "projectId",
        "expectedHash",
        "shotId",
        "versions",
        ...(apply ? ["reviewFingerprint"] : []),
        ...(v.limitEvidenceId !== undefined ? ["limitEvidenceId"] : []),
      ]
        .sort()
        .join() ||
    typeof v.projectId !== "string" ||
    !/^film_[a-z0-9]{16,40}$/.test(v.projectId) ||
    !hash(v.expectedHash) ||
    typeof v.shotId !== "string" ||
    !v.shotId ||
    v.shotId.length > 160 ||
    v.shotId.includes("\0") ||
    !Number.isInteger(v.versions) ||
    Number(v.versions) < 1 ||
    Number(v.versions) > 4 ||
    (apply && !hash(v.reviewFingerprint)) ||
    (v.limitEvidenceId !== undefined &&
      (typeof v.limitEvidenceId !== "string" || !/^dle_[a-f0-9]{32}$/.test(v.limitEvidenceId)))
  )
    throw Error("INVALID_INPUT");
  return { ...v } as unknown as FilmDialogueSplitApplyInput;
}
const error = (
  code: string,
  unchanged = true,
  backup?: FilmHistoryEntry,
): FilmDialogueSplitFailure => ({
  kind: "FAILED",
  code: ([
    "INVALID_INPUT",
    "PROJECT_CHANGED",
    "BUSY",
    "UNSUPPORTED_PLAN",
    "BACKUP_FAILED",
    "WRITE_FAILED",
    "WRITE_UNCONFIRMED",
  ].includes(code)
    ? code
    : "WRITE_FAILED") as FilmDialogueSplitFailure["code"],
  unchanged,
  ...(backup ? { backup } : {}),
});
function busy(record: FilmRecord) {
  return (
    rows(record.jobs).some((job) =>
      ["running", "queued", "uncertain"].includes(String(job.status)),
    ) ||
    ["running", "queued", "uncertain"].includes(
      String(object(record.productionPipeline)?.status),
    ) ||
    rows(record.shots).some((shot) =>
      rows(shot.takes).some((take) =>
        ["running", "queued", "uncertain"].includes(String(take.status)),
      ),
    )
  );
}
function review(
  record: FilmRecord,
  input: FilmDialogueSplitInput,
  evidence?: { requiredSeconds: number; maxSeconds: 10 | 15; rawAudioSaved: boolean } | null,
): FilmDialogueSplitReady {
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > 8_000_000)
    throw Error("UNSUPPORTED_PLAN");
  if (record.id !== input.projectId || filmHistoryRecordHash(record) !== input.expectedHash)
    throw Error("PROJECT_CHANGED");
  const allShots = rows(record.shots),
    allScenes = rows(record.scenes);
  if (
    !Array.isArray(record.shots) ||
    !Array.isArray(record.scenes) ||
    allShots.length !== record.shots.length ||
    allScenes.length !== record.scenes.length ||
    allScenes.some((scene) => typeof scene.id !== "string" || !scene.id) ||
    new Set(allScenes.map((scene) => scene.id)).size !== allScenes.length ||
    allShots.some(
      (shot) =>
        typeof shot.id !== "string" ||
        !shot.id ||
        typeof shot.sceneId !== "string" ||
        allScenes.filter((scene) => scene.id === shot.sceneId).length !== 1 ||
        !Number.isInteger(shot.no) ||
        Number(shot.no) < 1,
    )
  )
    throw Error("UNSUPPORTED_PLAN");
  if (busy(record)) throw Error("BUSY");
  const context = dialogueSplitContext(record, input.shotId, input.versions);
  if (!context) throw Error("UNSUPPORTED_PLAN");
  if (input.limitEvidenceId && !evidence) throw Error("PROJECT_CHANGED");
  const plan = planDialogueSplit(
    { ...context.request, ...(evidence ? { maxVideoSeconds: evidence.maxSeconds } : {}) },
    !!evidence,
  );
  if (plan.kind !== "READY") throw Error("UNSUPPORTED_PLAN");
  const shots = rows(record.shots),
    target = shots.find((shot) => shot.id === input.shotId)!;
  const targetTakes = rows(target.takes);
  if (
    !Array.isArray(target.takes) ||
    targetTakes.length !== target.takes.length ||
    new Set(targetTakes.map((take) => take.id)).size !== targetTakes.length ||
    targetTakes.some(
      (take) => typeof take.id !== "string" || !take.id || take.shotId !== target.id,
    ) ||
    (target.selectedTakeId !== undefined &&
      (typeof target.selectedTakeId !== "string" ||
        (target.selectedTakeId &&
          targetTakes.filter((take) => take.id === target.selectedTakeId).length !== 1)))
  )
    throw Error("UNSUPPORTED_PLAN");
  if (
    new Set(shots.map((shot) => shot.id)).size !== shots.length ||
    !rows(record.scenes).some((scene) => scene.id === target.sceneId) ||
    target.continuityFromShotId ||
    target.continuityFrame ||
    shots.some(
      (shot) =>
        shot.continuityFromShotId === target.id ||
        object(shot.continuityFrame)?.sourceShotId === target.id,
    )
  )
    throw Error("UNSUPPORTED_PLAN");
  return {
    kind: "READY",
    projectId: record.id,
    shotId: input.shotId,
    projectHash: input.expectedHash,
    model: context.scope.model,
    ...(evidence ? { actualLimit: { ...evidence, targetVideoSubmitted: false as const } } : {}),
    reviewFingerprint: filmHistoryRecordHash({
      version: "native-dialogue-split-v1",
      context: context.semantic,
      ...(evidence ? { evidence, evidenceId: input.limitEvidenceId } : {}),
      plan,
    }),
    plan,
    notes: [
      "确认只调整分镜结构，不生成配音、图片或视频。",
      ...(evidence
        ? [
            `本次目标在视频派发前超过语音时长上限；${evidence.rawAudioSaved ? "原配音已保留" : "原配音保存状态未核实"}，不切原音频，各子镜仍需重新估算与确认生成。`,
          ]
        : []),
      "原镜与全部旧版本在本机历史可恢复；工程包仅包含当前稿，不包含本机历史。",
      "旧音轨引用和文件保留，不自动转给新镜；全片音轨时间未自动重排。",
      "新镜暂沿用原画面说明，动作与音效时点需逐镜重新核对。",
      "视频数仅统计视频，不含后续配音、图片或重试；生成仍须重新确认预算。",
    ],
  };
}
function split(
  record: FilmRecord,
  input: FilmDialogueSplitInput,
  ready: FilmDialogueSplitReady,
  backup: FilmHistoryEntry,
) {
  // Validated whole arrays, never silently filter away unrelated rows.
  const shots = record.shots as Record<string, unknown>[],
    target = shots.find((shot) => shot.id === input.shotId)!;
  const keys = [
    "sceneId",
    "size",
    "angle",
    "move",
    "picture",
    "action",
    "performance",
    "styleNote",
    "characters",
    "delivery",
    "tag",
    "blocking",
    "facing",
    "posterPosition",
  ];
  const creative = Object.fromEntries(
    keys
      .filter((key) => target[key] !== undefined)
      .map((key) => [key, structuredClone(target[key])]),
  );
  const sound = object(target.sound) ?? {};
  const children = ready.plan.parts.map((part, index) => ({
    ...creative,
    id: randomUUID(),
    no: Number(target.no) + index,
    line: part.text,
    lines: [{ speaker: part.speaker, text: part.text }],
    speaker: part.speaker,
    seconds: part.estimatedSeconds,
    source: "user:dialogue-split",
    userFields: [
      ...new Set([
        ...(Array.isArray(target.userFields)
          ? target.userFields.filter(
              (field): field is string =>
                typeof field === "string" && Object.hasOwn(creative, field),
            )
          : []),
        "line",
        "seconds",
      ]),
    ],
    takes: [],
    stills: [],
    poster: "",
    selectedTakeId: "",
    sound: {
      source: sound.source ?? "native",
      ambience: sound.ambience ?? "",
      musicMood: sound.musicMood ?? "",
      sfx: [],
    },
    splitSource: {
      schemaVersion: 1,
      historyId: backup.id,
      sourceShotId: target.id,
      sourceLineIndex: part.sourceLineIndex,
      startOffset: part.startOffset,
      endOffset: part.endOffset,
      reviewFingerprint: ready.reviewFingerprint,
    },
  }));
  const at = shots.indexOf(target),
    delta = children.length - 1;
  const next = {
    ...record,
    assemblyPath: "",
    assemblyUrl: "",
    exportPath: "",
    productionPipeline: undefined,
    productionInputFingerprint: undefined,
    pipeline: undefined,
    shots: shots.flatMap((shot, index) =>
      shot === target
        ? children
        : [
            index > at && shot.sceneId === target.sceneId
              ? { ...shot, no: Number(shot.no) + delta }
              : shot,
          ],
    ),
    scenes: (record.scenes as Record<string, unknown>[]).map((scene) => {
      if (scene.id !== target.sceneId) return scene;
      const copy = { ...scene };
      delete copy.coverage;
      delete copy.shotBudget;
      return copy;
    }),
  };
  return { next, childIds: children.map((child) => child.id) };
}
export function createFilmDialogueSplits(host: {
  filmsRoot: string;
  history?: ReturnType<typeof createFilmHistory>;
  beforeCommit?: () => Promise<void>;
  consumeLimitEvidence?: (id: string) => void;
  limitEvidence?: (
    owner: number,
    id: string,
    record: FilmRecord,
    shotId: string,
  ) => { requiredSeconds: number; maxSeconds: 10 | 15; rawAudioSaved: boolean } | null;
}) {
  const history = host.history ?? createFilmHistory({ filmsRoot: host.filmsRoot }),
    active = new Set<string>();
  const current = async (input: FilmDialogueSplitInput) => {
    const value = await readProject(host.filmsRoot, input.projectId);
    if (!value || value.id !== input.projectId) throw Error("PROJECT_CHANGED");
    return value;
  };
  const reviewed = (record: FilmRecord, input: FilmDialogueSplitInput, owner: number) =>
    review(
      record,
      input,
      input.limitEvidenceId
        ? host.limitEvidence?.(owner, input.limitEvidenceId, record, input.shotId)
        : null,
    );
  return {
    async prepare(value: unknown, owner = -1): Promise<FilmDialogueSplitPrepareResult> {
      let id = "",
        acquired = false;
      try {
        const input = parse(value);
        id = input.projectId;
        if (active.has(id)) throw Error("BUSY");
        active.add(id);
        acquired = true;
        return reviewed(await current(input), input, owner);
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "");
      } finally {
        if (acquired) active.delete(id);
      }
    },
    async apply(value: unknown, owner = -1): Promise<FilmDialogueSplitApplyResult> {
      let id = "",
        acquired = false,
        writeStarted = false,
        writeAck = false,
        backup: FilmHistoryEntry | undefined;
      let children: string[] = [];
      try {
        const input = parse(value, true) as FilmDialogueSplitApplyInput;
        id = input.projectId;
        if (active.has(id)) throw Error("BUSY");
        active.add(id);
        acquired = true;
        await host.beforeCommit?.();
        return await history.withDialogueSplitBackup(
          input,
          (record) => {
            const plan = reviewed(record, input, owner);
            if (plan.reviewFingerprint !== input.reviewFingerprint) throw Error("PROJECT_CHANGED");
          },
          async (record, snapshot, write) => {
            backup = snapshot;
            const ready = reviewed(record, input, owner);
            if (ready.reviewFingerprint !== input.reviewFingerprint) throw Error("PROJECT_CHANGED");
            const { next, childIds } = split(record, input, ready, snapshot);
            children = childIds;
            writeStarted = true;
            const stored = await write(next);
            writeAck = true;
            const actual = await current(input);
            if (filmHistoryRecordHash(actual) !== filmHistoryRecordHash(stored))
              throw Error("WRITE_UNCONFIRMED");
            if (input.limitEvidenceId) host.consumeLimitEvidence?.(input.limitEvidenceId);
            return { kind: "APPLIED" as const, project: actual, backup: snapshot, childIds };
          },
        );
      } catch (cause) {
        if (writeStarted) {
          const actual = await readProject(host.filmsRoot, id).catch(() => null);
          if (
            writeAck ||
            !actual ||
            actual.id !== id ||
            rows(actual.shots).some((shot) => children.includes(String(shot.id)))
          ) {
            const evidenceId = object(value)?.limitEvidenceId;
            if (typeof evidenceId === "string") host.consumeLimitEvidence?.(evidenceId);
            return error("WRITE_UNCONFIRMED", false, backup);
          }
        }
        return error(cause instanceof Error ? cause.message : "", true, backup);
      } finally {
        if (acquired) active.delete(id);
      }
    },
  };
}
