import { isDraftExportOperationId, isDraftExportScope } from "./draft-export-contract";
import { episodeMediaAssemblyDefiniteError } from "./episode-media-assembly-contract";
import {
  isCreateDraftReviewNoteRequest,
  isDraftReviewNoteId,
  isDraftReviewResponse,
  isResolveDraftReviewNoteRequest,
  matchesDraftReviewIdentity,
  type CreateDraftReviewNoteRequest,
  type DraftReviewData,
  type DraftReviewGateway,
  type DraftReviewNote,
  type DraftReviewResponse,
  type DraftReviewResult,
  type DraftReviewTarget,
  type ResolveDraftReviewNoteRequest,
} from "./draft-review-contract";

type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{
  status: number;
  payload: unknown;
  requestId: string | null;
} | null>;

function sameTarget(left: DraftReviewTarget, right: DraftReviewTarget): boolean {
  return (Object.keys(left) as (keyof DraftReviewTarget)[]).every(
    (key) => left[key] === right[key],
  );
}
function sameOriginalNote(left: DraftReviewNote, right: DraftReviewNote): boolean {
  return (
    left.note_id === right.note_id &&
    left.frame_index === right.frame_index &&
    left.text === right.text &&
    left.actor_id === right.actor_id &&
    left.created_at === right.created_at
  );
}
function createdNote(
  data: DraftReviewData,
  command: CreateDraftReviewNoteRequest,
): DraftReviewNote | undefined {
  if (!matchesDraftReviewIdentity(data.target, command)) return undefined;
  return data.notes.find(
    (note) =>
      note.note_id === command.note_id &&
      note.frame_index === command.frame_index &&
      note.text === command.text,
  );
}
function resolvedNote(
  data: DraftReviewData,
  noteId: string,
  command: ResolveDraftReviewNoteRequest,
): DraftReviewNote | undefined {
  if (!matchesDraftReviewIdentity(data.target, command)) return undefined;
  return data.notes.find(
    (note) =>
      note.note_id === noteId &&
      note.revision === 2 &&
      note.resolution?.resolution_id === command.resolution_id &&
      note.resolution.reason === command.reason,
  );
}

export function createDraftReviewClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): DraftReviewGateway {
  const pathFor = (projectId: string, episodeId: string, operationId: string) => {
    if (!isDraftExportScope(projectId, episodeId) || !isDraftExportOperationId(operationId))
      throw new Error("Draft review requires canonical scope and operation ids");
    return `/api/v1/projects/${projectId}/episodes/${episodeId}/draft-exports/${operationId}/review-notes`;
  };
  const request: ReadHttp = async (path, init) => {
    try {
      return await readHttp(path, init);
    } catch {
      return null;
    }
  };
  const list: DraftReviewGateway["listDraftReviewNotes"] = async (
    projectId,
    episodeId,
    operationId,
  ) => {
    const result = await request(pathFor(projectId, episodeId, operationId), { headers });
    if (result === null) return { kind: "REMOTE_UNKNOWN" };
    if (result.status === 200)
      return isDraftReviewResponse(
        result.payload,
        projectId,
        episodeId,
        operationId,
        result.requestId,
      )
        ? { kind: "FOUND", receipt: result.payload }
        : { kind: "REMOTE_UNKNOWN" };
    return (
      episodeMediaAssemblyDefiniteError(result.status, result.payload, result.requestId) ?? {
        kind: "REMOTE_UNKNOWN",
      }
    );
  };
  async function write(
    projectId: string,
    episodeId: string,
    operationId: string,
    command: CreateDraftReviewNoteRequest | ResolveDraftReviewNoteRequest,
    noteId?: string,
    original?: DraftReviewResponse,
  ): Promise<DraftReviewResult> {
    const base = pathFor(projectId, episodeId, operationId);
    const result = await request(noteId ? `${base}/${noteId}/resolutions` : base, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    let postReceipt: DraftReviewResponse | undefined;
    if (result !== null) {
      if (![200, 201].includes(result.status)) {
        const error = episodeMediaAssemblyDefiniteError(
          result.status,
          result.payload,
          result.requestId,
        );
        if (error !== null) return error;
      } else if (
        isDraftReviewResponse(result.payload, projectId, episodeId, operationId, result.requestId)
      ) {
        postReceipt = result.payload;
      }
    }
    // A POST receipt alone never establishes durable success. Reconcile once with a read;
    // do not automatically replay a mutation or generate a replacement idempotency ID.
    const readback = await list(projectId, episodeId, operationId);
    if (readback.kind !== "FOUND") return { kind: "REMOTE_UNKNOWN" };
    const data = readback.receipt.data;
    if (original && !sameTarget(original.data.target, data.target))
      return { kind: "REMOTE_UNKNOWN" };
    if (postReceipt && !sameTarget(postReceipt.data.target, data.target))
      return { kind: "REMOTE_UNKNOWN" };
    if (noteId === undefined) {
      const input = command as CreateDraftReviewNoteRequest;
      const note = createdNote(data, input);
      const postNote = postReceipt ? createdNote(postReceipt.data, input) : undefined;
      if (!note || (postReceipt && (!postNote || !sameOriginalNote(postNote, note))))
        return { kind: "REMOTE_UNKNOWN" };
    } else {
      const input = command as ResolveDraftReviewNoteRequest;
      const note = resolvedNote(data, noteId, input);
      const originalNote = original?.data.notes.find((item) => item.note_id === noteId);
      const postNote = postReceipt ? resolvedNote(postReceipt.data, noteId, input) : undefined;
      if (
        !note ||
        !originalNote ||
        !sameOriginalNote(originalNote, note) ||
        (postReceipt &&
          (!postNote ||
            !sameOriginalNote(postNote, note) ||
            postNote.resolution?.actor_id !== note.resolution?.actor_id ||
            postNote.resolution?.created_at !== note.resolution?.created_at))
      )
        return { kind: "REMOTE_UNKNOWN" };
    }
    return readback;
  }
  return {
    listDraftReviewNotes: list,
    createDraftReviewNote(projectId, episodeId, operationId, input) {
      pathFor(projectId, episodeId, operationId);
      if (!isCreateDraftReviewNoteRequest(input))
        throw new Error("Draft review requires an exact path-free manual note");
      return write(projectId, episodeId, operationId, { ...input });
    },
    async resolveDraftReviewNote(projectId, episodeId, operationId, noteId, input) {
      pathFor(projectId, episodeId, operationId);
      if (!isDraftReviewNoteId(noteId) || !isResolveDraftReviewNoteRequest(input))
        throw new Error("Draft review requires an exact manual note resolution");
      const command = { ...input };
      // Read the immutable original so even a dropped mutation response cannot silently
      // change the note's author, text, frame, or creation timestamp.
      const original = await list(projectId, episodeId, operationId);
      if (original.kind !== "FOUND") return original;
      if (
        !matchesDraftReviewIdentity(original.receipt.data.target, command) ||
        !original.receipt.data.notes.some((note) => note.note_id === noteId)
      )
        return { kind: "REMOTE_UNKNOWN" };
      return write(projectId, episodeId, operationId, command, noteId, original.receipt);
    },
  };
}
