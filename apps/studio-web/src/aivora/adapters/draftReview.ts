import type { components } from "@aijian/contracts";
import type { DraftExportFailure, DraftExportJob } from "./draftExport";

export type DraftReviewData = components["schemas"]["DraftReviewData"];
export type DraftReviewTarget = components["schemas"]["DraftReviewTarget"];
export type DraftReviewNote = components["schemas"]["DraftReviewNote"];
export type CreateDraftReviewNoteRequest = components["schemas"]["CreateDraftReviewNoteRequest"];
export type ResolveDraftReviewNoteRequest = components["schemas"]["ResolveDraftReviewNoteRequest"];
export type DraftReviewResult =
  { kind: "FOUND"; receipt: components["schemas"]["DraftReviewResponse"] } | DraftExportFailure;
export interface DraftReviewGateway {
  listDraftReviewNotes(
    project: string,
    episode: string,
    operation: string,
  ): Promise<DraftReviewResult>;
  createDraftReviewNote(
    project: string,
    episode: string,
    operation: string,
    command: CreateDraftReviewNoteRequest,
  ): Promise<DraftReviewResult>;
  resolveDraftReviewNote(
    project: string,
    episode: string,
    operation: string,
    noteId: string,
    command: ResolveDraftReviewNoteRequest,
  ): Promise<DraftReviewResult>;
}
export type PendingReview =
  | { kind: "create"; command: CreateDraftReviewNoteRequest }
  | { kind: "resolve"; noteId: string; command: ResolveDraftReviewNoteRequest };
export function reviewIdentity(target: DraftReviewTarget) {
  return {
    assembly_version_id: target.assembly_version_id,
    assembly_content_hash: target.assembly_content_hash,
    output_sha256: target.output_sha256,
    output_bytes: target.output_bytes,
  };
}
export function reviewMatches(data: DraftReviewData, job: DraftExportJob): boolean {
  const target = data?.target;
  return (
    !!target &&
    data.manual_review_only === true &&
    target.project_id === job.project_id &&
    target.episode_id === job.episode_id &&
    target.operation_id === job.operation_id &&
    target.assembly_version_id === job.assembly_version_id &&
    target.assembly_content_hash === job.assembly_content_hash &&
    target.total_frames === job.total_frames &&
    (job.status !== "SUCCEEDED" ||
      (target.output_sha256 === job.output_sha256 && target.output_bytes === job.output_bytes))
  );
}
export function pendingMatches(data: DraftReviewData, pending: PendingReview): boolean {
  const command = pending.command;
  if (
    Object.entries(reviewIdentity(data.target)).some(
      ([key, value]) => command[key as keyof typeof command] !== value,
    )
  )
    return false;
  if (pending.kind === "create")
    return data.notes.some(
      (note) =>
        note.note_id === pending.command.note_id &&
        note.frame_index === pending.command.frame_index &&
        note.text === pending.command.text,
    );
  return data.notes.some(
    (note) =>
      note.note_id === pending.noteId &&
      note.revision === 2 &&
      note.resolution?.resolution_id === pending.command.resolution_id &&
      note.resolution.reason === pending.command.reason,
  );
}
export function approximateFrame(seconds: number, target: DraftReviewTarget): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(
    target.total_frames - 1,
    Math.max(0, Math.floor((seconds * target.frame_rate_num) / target.frame_rate_den)),
  );
}
export function reviewFailure(result?: DraftReviewResult): string {
  return result?.kind === "DEFINITE_SERVER_ERROR"
    ? `手工记录请求被拒绝：${result.code}。请重新读取核对。`
    : "保存结果尚未可靠读回；请核对原记录，不要重复新增。";
}
