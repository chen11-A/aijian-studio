import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type {
  CleanCopyRecoveryInput,
  CleanCopyRecoveryResult,
} from "@aijian/contracts/clean-copy-recovery";
import { readProject, compareAndSwapProject, type FilmRecord } from "./film-library";
import { exportFileHash } from "./film-export-io";
import { originalCleanRecoveryProof, finalCleanRecoveryProof } from "./clean-copy-recovery-proof";
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export const cleanRecoverySelectionHash = (video: string, clean: string) =>
  createHash("sha256")
    .update(JSON.stringify([video, clean]))
    .digest("hex");
type Host = {
  filmsRoot: string;
  storyFilmsRoot: string;
  databasePath: string;
  remake: (
    projectId: string,
    path: string,
    expected: { sha256: string; assemblyVersionId: string },
  ) => Promise<{ data: Record<string, unknown> }>;
  read?: (id: string) => Promise<FilmRecord | null>;
  save?: (expected: FilmRecord, next: FilmRecord) => Promise<FilmRecord | null>;
};
/** Explicit local recovery; no provider, generation, arbitrary renderer paths or proof migration. */
export function createCleanCopyRecovery(host: Host) {
  const active = new Set<string>();
  const read = host.read ?? ((id: string) => readProject(host.filmsRoot, id));
  return async (value: unknown): Promise<CleanCopyRecoveryResult> => {
    const input = object(value);
    if (
      !input ||
      Object.keys(input).sort().join() !== "projectId,selectionHash,shotId,takeId" ||
      typeof input.projectId !== "string" ||
      !/^film_[a-z0-9]{16,40}$/.test(input.projectId) ||
      typeof input.shotId !== "string" ||
      !input.shotId ||
      typeof input.takeId !== "string" ||
      !input.takeId ||
      typeof input.selectionHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.selectionHash)
    )
      return { kind: "FAILED", code: "INVALID_INPUT" };
    const request = input as unknown as CleanCopyRecoveryInput;
    if (active.has(request.projectId)) return { kind: "FAILED", code: "BUSY" };
    active.add(request.projectId);
    let stage: "source" | "rebuild" | "evidence" | "save" = "source";
    try {
      const record = await read(request.projectId);
      if (!record || record.id !== request.projectId || !Array.isArray(record.shots))
        return { kind: "FAILED", code: "PROJECT_CHANGED" };
      const shots = record.shots.map(object);
      if (
        shots.some((shot) => !shot || typeof shot.id !== "string") ||
        new Set(shots.map((shot) => shot!.id)).size !== shots.length
      )
        return { kind: "FAILED", code: "PROJECT_CHANGED" };
      const shot = shots.find((shot) => shot?.id === request.shotId);
      const takes = Array.isArray(shot?.takes) ? shot.takes.map(object) : [];
      if (
        takes.some((take) => !take || typeof take.id !== "string") ||
        new Set(takes.map((take) => take!.id)).size !== takes.length
      )
        return { kind: "FAILED", code: "PROJECT_CHANGED" };
      const take = shot?.selectedTakeId
        ? takes.find((take) => take?.id === shot.selectedTakeId)
        : takes.find((take) => take?.status === "done" && take.videoPath);
      if (
        !take ||
        take.id !== request.takeId ||
        take.shotId !== shot?.id ||
        take.status !== "done" ||
        typeof take.videoPath !== "string" ||
        typeof take.cleanVideoPath !== "string" ||
        !take.cleanVideoPath.trim() ||
        cleanRecoverySelectionHash(take.videoPath, take.cleanVideoPath) !== request.selectionHash
      )
        return { kind: "FAILED", code: "PROJECT_CHANGED" };
      const backendProject = record.backendProjectId;
      if (typeof backendProject !== "string" || !/^prj_[a-f0-9]{32}$/.test(backendProject))
        return { kind: "FAILED", code: "SOURCE_UNVERIFIED" };
      const root = await realpath(host.storyFilmsRoot),
        source = await realpath(take.videoPath);
      if (
        dirname(source) !== root ||
        extname(source).toLowerCase() !== ".mp4" ||
        !(await stat(source)).isFile()
      )
        return { kind: "FAILED", code: "SOURCE_UNVERIFIED" };
      const sha256 = await exportFileHash(source);
      const proof = originalCleanRecoveryProof(host.databasePath, backendProject, source, sha256);
      if (!proof) return { kind: "FAILED", code: "SOURCE_UNVERIFIED" };
      try {
        const old = await realpath(take.cleanVideoPath);
        if (
          finalCleanRecoveryProof(host.databasePath, backendProject, old, await exportFileHash(old))
        )
          return { kind: "UNCHANGED", reason: "ALREADY_VERIFIED" };
      } catch {
        /* An unavailable old copy is retained in the record until replacement succeeds. */
      }
      stage = "rebuild";
      const response = await host.remake(backendProject, source, {
        sha256,
        assemblyVersionId: proof.assemblyVersionId,
      });
      if (
        response.data.status !== "SUCCEEDED" ||
        typeof response.data.clean_output_path !== "string"
      )
        return {
          kind: "FAILED",
          code: response.data.status === "NOT_FOUND" ? "SOURCE_UNVERIFIED" : "REBUILD_FAILED",
        };
      stage = "evidence";
      const clean = await realpath(response.data.clean_output_path);
      const reusedOriginal = clean === source;
      if (reusedOriginal && proof.hasBurnedSubtitles)
        return { kind: "FAILED", code: "EVIDENCE_FAILED" };
      if (
        dirname(clean) !== root ||
        extname(clean).toLowerCase() !== ".mp4" ||
        (!reusedOriginal &&
          !finalCleanRecoveryProof(
            host.databasePath,
            backendProject,
            clean,
            await exportFileHash(clean),
          ))
      )
        return { kind: "FAILED", code: "EVIDENCE_FAILED" };
      if ((await exportFileHash(source)) !== sha256)
        return { kind: "FAILED", code: "PROJECT_CHANGED" };
      const next = structuredClone(record);
      const updated = object(
        (next.shots as unknown[]).find((value) => object(value)?.id === request.shotId),
      )!;
      const selected = (updated.takes as unknown[])
        .map(object)
        .find((take) => take?.id === request.takeId)!;
      selected.cleanVideoPath = clean;
      delete selected.cleanCopyReason;
      stage = "save";
      const saved = await (
        host.save ?? ((expected, next) => compareAndSwapProject(host.filmsRoot, expected, next))
      )(record, next);
      return saved
        ? { kind: reusedOriginal ? "REUSED_ORIGINAL" : "RECOVERED", project: saved }
        : { kind: "FAILED", code: "PROJECT_CHANGED" };
    } catch {
      return {
        kind: "FAILED",
        code:
          stage === "source"
            ? "SOURCE_UNVERIFIED"
            : stage === "rebuild"
              ? "REBUILD_FAILED"
              : stage === "evidence"
                ? "EVIDENCE_FAILED"
                : "SAVE_FAILED",
      };
    } finally {
      active.delete(request.projectId);
    }
  };
}
