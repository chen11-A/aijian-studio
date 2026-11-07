import { createHash, randomUUID } from "node:crypto";
import { open, mkdir, readFile, readdir, realpath, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import { transactFilmProject, readProject, type FilmRecord } from "./film-library";
import type {
  FilmHistoryEntry,
  FilmHistoryReason,
  FilmHistoryFailure,
  FilmHistoryList,
  FilmHistoryCapture,
  FilmHistoryRestore,
} from "@aijian/contracts/film-history";
/** Stable expected identity; neither side accepts renderer snapshot bodies or execution paths. */
export function filmHistoryRecordText(value: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, item]) => [key, normalize(item)]),
      );
    return value;
  };
  return JSON.stringify(normalize(value));
}

const idPattern = /^film_[a-z0-9]{16,40}$/;
const historyPattern = /^hst_[a-f0-9]{32}$/;
const reasons = new Set<FilmHistoryReason>([
  "manual",
  "before-batch-generation",
  "before-pipeline",
  "before-restore",
  "before-dialogue-split",
]);
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export const filmHistoryRecordHash = (value: unknown) =>
  createHash("sha256").update(filmHistoryRecordText(value)).digest("hex");
const failure = (code: FilmHistoryFailure["code"], unchanged = true): FilmHistoryFailure => ({
  kind: "FAILED",
  code,
  unchanged,
});
type Stored = {
  schemaVersion: 1;
  projectId: string;
  seriesId: string;
  entry: FilmHistoryEntry;
  snapshot: FilmRecord;
  checksum: string;
};
type Host = { filmsRoot: string; now?: () => Date; beforeSnapshotWrite?: () => Promise<void> };
/** Append-only local snapshots of main's canonical record, on the normal project queue. */
export function createFilmHistory(host: Host) {
  function validRecord(record: FilmRecord) {
    if (
      !idPattern.test(record.id) ||
      !idPattern.test(record.seriesId) ||
      !Array.isArray(record.shots)
    )
      return false;
    const ids = new Set<string>();
    for (const value of record.shots) {
      const shot = object(value);
      if (
        !shot ||
        typeof shot.id !== "string" ||
        !shot.id ||
        ids.has(shot.id) ||
        !Array.isArray(shot.takes)
      )
        return false;
      ids.add(shot.id);
      const takeIds = new Set<string>();
      for (const value of shot.takes) {
        const take = object(value);
        if (!take || typeof take.id !== "string" || !take.id || takeIds.has(take.id)) return false;
        takeIds.add(take.id);
      }
    }
    return true;
  }
  async function directory(record: FilmRecord, create: boolean) {
    const root = await realpath(host.filmsRoot);
    const series = await realpath(join(root, record.seriesId));
    if (relative(root, series) !== record.seriesId) throw new Error("HISTORY_DAMAGED");
    const episode = await realpath(join(series, "episodes", record.id));
    if (
      relative(series, episode) !== join("episodes", record.id) ||
      relative(episode, await realpath(join(episode, "project.json"))) !== "project.json"
    )
      throw new Error("HISTORY_DAMAGED");
    const folder = join(episode, "history");
    if (create) await mkdir(folder, { recursive: true });
    try {
      if (relative(episode, await realpath(folder)) !== "history")
        throw new Error("HISTORY_DAMAGED");
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return folder;
      throw error;
    }
    return folder;
  }
  function summary(record: FilmRecord) {
    const shots = Array.isArray(record.shots) ? record.shots.map(object) : [];
    return {
      scenes: Array.isArray(record.scenes) ? record.scenes.length : 0,
      shots: shots.length,
      done: shots.filter(
        (shot) =>
          Array.isArray(shot?.takes) &&
          shot.takes.some(
            (take: unknown) => object(take)?.status === "done" && object(take)?.videoPath,
          ),
      ).length,
    };
  }
  async function append(record: FilmRecord, reason: FilmHistoryReason) {
    const folder = await directory(record, true);
    const entry: FilmHistoryEntry = {
      id: `hst_${randomUUID().replaceAll("-", "")}`,
      createdAt: (host.now?.() ?? new Date()).toISOString(),
      reason,
      summary: summary(record),
    };
    const body = {
      schemaVersion: 1 as const,
      projectId: record.id,
      seriesId: record.seriesId,
      entry,
      snapshot: record,
    };
    const stored: Stored = { ...body, checksum: filmHistoryRecordHash(body) };
    await host.beforeSnapshotWrite?.();
    const handle = await open(join(folder, entry.id + ".json"), "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(stored));
      await handle.sync();
    } finally {
      await handle.close();
    }
    return entry;
  }
  async function snapshot(record: FilmRecord, id: string): Promise<Stored> {
    if (!historyPattern.test(id)) throw new Error("HISTORY_DAMAGED");
    const folder = await directory(record, false),
      path = join(folder, id + ".json");
    if (relative(folder, await realpath(path)) !== id + ".json" || !(await lstat(path)).isFile())
      throw new Error("HISTORY_DAMAGED");
    const bytes = await readFile(path);
    if (bytes.length > 8_100_000) throw new Error("HISTORY_DAMAGED");
    const parsed = object(JSON.parse(bytes.toString("utf8")));
    if (!parsed) throw new Error("HISTORY_DAMAGED");
    const { checksum, ...body } = parsed;
    const entry = object(body.entry),
      saved = object(body.snapshot);
    if (
      body.schemaVersion !== 1 ||
      body.projectId !== record.id ||
      body.seriesId !== record.seriesId ||
      entry?.id !== id ||
      typeof entry.createdAt !== "string" ||
      !Number.isFinite(Date.parse(entry.createdAt)) ||
      !reasons.has(entry.reason as FilmHistoryReason) ||
      saved?.id !== record.id ||
      saved.seriesId !== record.seriesId ||
      !validRecord(saved as FilmRecord) ||
      checksum !== filmHistoryRecordHash(body)
    )
      throw new Error("HISTORY_DAMAGED");
    if (
      filmHistoryRecordHash(entry.summary) !== filmHistoryRecordHash(summary(saved as FilmRecord))
    )
      throw new Error("HISTORY_DAMAGED");
    return parsed as unknown as Stored;
  }
  function validInput(value: unknown, keys: string[]) {
    const input = object(value);
    return input &&
      Object.keys(input).sort().join() === keys.sort().join() &&
      typeof input.projectId === "string" &&
      idPattern.test(input.projectId)
      ? input
      : null;
  }
  function retainTakes(saved: FilmRecord, current: FilmRecord) {
    const next = structuredClone(saved);
    const currentShots = Array.isArray(current.shots) ? current.shots.map(object) : [];
    if (Array.isArray(next.shots))
      next.shots = next.shots.map((value) => {
        const shot = object(value);
        if (!shot) return value;
        const live = currentShots.find((item) => item?.id === shot.id);
        const oldTakes = Array.isArray(shot.takes)
          ? shot.takes.map(object).filter((item): item is Record<string, unknown> => Boolean(item))
          : [];
        const liveTakes = Array.isArray(live?.takes)
          ? live.takes.map(object).filter((item): item is Record<string, unknown> => Boolean(item))
          : [];
        const takes = new Map(oldTakes.map((take) => [take.id, take]));
        for (const take of liveTakes) {
          if (!takes.has(take.id) || (take.status === "done" && take.videoPath))
            takes.set(take.id, take);
        }
        return { ...shot, takes: [...takes.values()] };
      });
    const stopPending = (value: unknown) => {
      const row = object(value);
      return row && (row.status === "queued" || row.status === "running")
        ? {
            ...row,
            interruptedFrom: row.status,
            status: "failed",
            reason: "历史恢复没有继续执行这项任务，请先核对。",
          }
        : value;
    };
    if (Array.isArray(next.jobs)) next.jobs = next.jobs.map(stopPending);
    if (Array.isArray(next.shots))
      next.shots = next.shots.map((value) => {
        const shot = object(value);
        return shot && Array.isArray(shot.takes)
          ? { ...shot, takes: shot.takes.map(stopPending) }
          : value;
      });
    const pipeline = object(next.productionPipeline);
    const pendingPipeline = (row: Record<string, unknown>) =>
      row.status === "running" || row.status === "queued";
    if (
      pipeline &&
      Array.isArray(pipeline.steps) &&
      (pendingPipeline(pipeline) ||
        pipeline.steps.some((value) => {
          const step = object(value);
          return (
            step &&
            (pendingPipeline(step) ||
              (Array.isArray(step.targets) &&
                step.targets.some((value) => {
                  const target = object(value);
                  return target && pendingPipeline(target);
                })))
          );
        }))
    ) {
      next.productionPipeline = {
        ...pipeline,
        status: "uncertain",
        code: "RUN_INTERRUPTED",
        continued: false,
        steps: pipeline.steps.map((value) => {
          const step = object(value);
          if (!step) return value;
          const pending = (row: Record<string, unknown>) =>
            row.status === "running" || row.status === "queued";
          return {
            ...step,
            ...(pending(step) ? { status: "uncertain", code: "RUN_INTERRUPTED" } : {}),
            ...(Array.isArray(step.targets)
              ? {
                  targets: step.targets.map((value) => {
                    const target = object(value);
                    return target && pending(target)
                      ? { ...target, status: "uncertain", code: "RUN_INTERRUPTED" }
                      : value;
                  }),
                }
              : {}),
          };
        }),
      };
    }
    return next;
  }
  return {
    /** Trusted main-only callback. Never exposed as an IPC taking a record or a function.
     * The existing project queue owns canonical read, backup and conditional write together. */
    async withDialogueSplitBackup<T>(
      input: { projectId: string; expectedHash: string },
      guard: (record: FilmRecord) => void | Promise<void>,
      action: (
        record: FilmRecord,
        backup: FilmHistoryEntry,
        write: (next: FilmRecord) => Promise<FilmRecord>,
      ) => Promise<T>,
    ): Promise<T> {
      return transactFilmProject(host.filmsRoot, input.projectId, async (record, write) => {
        if (
          !record ||
          record.id !== input.projectId ||
          !validRecord(record) ||
          filmHistoryRecordHash(record) !== input.expectedHash
        )
          throw Error("PROJECT_CHANGED");
        await guard(record);
        let backup: FilmHistoryEntry;
        try {
          backup = await append(record, "before-dialogue-split");
        } catch {
          throw Error("BACKUP_FAILED");
        }
        return action(record, backup, async (next) => {
          const latest = await readProject(host.filmsRoot, input.projectId);
          if (
            !latest ||
            latest.id !== input.projectId ||
            filmHistoryRecordHash(latest) !== input.expectedHash
          )
            throw Error("PROJECT_CHANGED");
          return write(next);
        });
      });
    },
    /** Read-only main-owned full snapshot proof. Never restores or returns snapshot contents. */
    async verifyDialogueSplitBackup(input: {
      projectId: string;
      historyId: string;
      beforeHash: string;
    }): Promise<FilmHistoryEntry | null> {
      if (
        !idPattern.test(input.projectId) ||
        !historyPattern.test(input.historyId) ||
        !/^[a-f0-9]{64}$/.test(input.beforeHash)
      )
        return null;
      try {
        return await transactFilmProject(host.filmsRoot, input.projectId, async (record) => {
          if (!record || record.id !== input.projectId || !validRecord(record)) return null;
          const stored = await snapshot(record, input.historyId);
          if (
            stored.entry.reason !== "before-dialogue-split" ||
            filmHistoryRecordHash(stored.snapshot) !== input.beforeHash
          )
            return null;
          return stored.entry;
        });
      } catch {
        return null;
      }
    },
    async list(projectId: unknown): Promise<FilmHistoryList> {
      if (typeof projectId !== "string" || !idPattern.test(projectId))
        return failure("INVALID_INPUT");
      try {
        return await transactFilmProject(host.filmsRoot, projectId, async (record) => {
          if (!record || !validRecord(record)) return failure("PROJECT_CHANGED");
          const folder = await directory(record, false);
          let names: string[];
          try {
            names = await readdir(folder);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              return { kind: "LIST", entries: [], unreadable: 0 };
            throw error;
          }
          const entries: FilmHistoryEntry[] = [];
          let unreadable = 0;
          for (const name of names) {
            if (!/^hst_[a-f0-9]{32}\.json$/.test(name)) continue;
            try {
              entries.push((await snapshot(record, name.slice(0, -5))).entry);
            } catch {
              unreadable += 1;
            }
          }
          entries.sort(
            (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
          );
          return { kind: "LIST", entries, unreadable };
        });
      } catch {
        return failure("READ_FAILED");
      }
    },
    async capture(value: unknown): Promise<FilmHistoryCapture> {
      const input = validInput(value, ["projectId", "expectedHash", "reason"]);
      if (
        !input ||
        typeof input.expectedHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.expectedHash) ||
        !["manual", "before-batch-generation", "before-pipeline"].includes(String(input.reason))
      )
        return failure("INVALID_INPUT");
      try {
        return await transactFilmProject(
          host.filmsRoot,
          String(input.projectId),
          async (record) => {
            if (
              !record ||
              !validRecord(record) ||
              filmHistoryRecordHash(record) !== input.expectedHash
            )
              return failure("PROJECT_CHANGED");
            try {
              return {
                kind: "CAPTURED",
                entry: await append(record, input.reason as FilmHistoryReason),
              };
            } catch {
              return failure("BACKUP_FAILED");
            }
          },
        );
      } catch {
        return failure("BACKUP_FAILED");
      }
    },
    async restore(value: unknown): Promise<FilmHistoryRestore> {
      const input = validInput(value, ["projectId", "expectedHash", "historyId"]);
      if (
        !input ||
        typeof input.expectedHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.expectedHash) ||
        typeof input.historyId !== "string" ||
        !historyPattern.test(input.historyId)
      )
        return failure("INVALID_INPUT");
      try {
        return await transactFilmProject(
          host.filmsRoot,
          String(input.projectId),
          async (record, write) => {
            if (
              !record ||
              !validRecord(record) ||
              filmHistoryRecordHash(record) !== input.expectedHash
            )
              return failure("PROJECT_CHANGED");
            let target: Stored;
            try {
              target = await snapshot(record, String(input.historyId));
            } catch {
              return failure("HISTORY_DAMAGED");
            }
            let backup: FilmHistoryEntry;
            try {
              backup = await append(record, "before-restore");
            } catch {
              return failure("BACKUP_FAILED");
            }
            const next = retainTakes(target.snapshot, record);
            try {
              return { kind: "RESTORED", project: await write(next), backup };
            } catch {
              const actual = await readProject(host.filmsRoot, record.id).catch(() => null);
              if (
                actual?.id === record.id &&
                filmHistoryRecordHash(actual) === filmHistoryRecordHash(record)
              )
                return failure("WRITE_FAILED");
              return { kind: "PARTIAL", project: actual?.id === record.id ? actual : null, backup };
            }
          },
        );
      } catch {
        return failure("READ_FAILED", false);
      }
    },
  };
}
