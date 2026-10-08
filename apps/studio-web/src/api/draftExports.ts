import type { DraftExportGateway } from "../aivora/adapters/draftExport";
import type { AijianDesktopBridge } from "./studio";

/** Optional capabilities keep older desktop versions usable without unsafe fallbacks. */
export function desktopDraftExports(bridge: AijianDesktopBridge): DraftExportGateway | undefined {
  const {
    listDraftReviewNotes,
    createDraftReviewNote,
    resolveDraftReviewNote,
    listDraftExports,
    getDraftExport,
    createDraftExportFromPicker,
    createDraftCompositionPreview,
    cancelDraftExport,
    readDraftExportPreview,
    revealDraftExportOutput,
  } = bridge;
  if (
    typeof listDraftExports !== "function" ||
    typeof getDraftExport !== "function" ||
    typeof createDraftExportFromPicker !== "function" ||
    typeof cancelDraftExport !== "function"
  )
    return undefined;
  return {
    createPreview:
      typeof createDraftCompositionPreview === "function"
        ? (projectId, episodeId, command) =>
            createDraftCompositionPreview.call(bridge, projectId, episodeId, command)
        : undefined,
    review:
      typeof listDraftReviewNotes === "function" &&
      typeof createDraftReviewNote === "function" &&
      typeof resolveDraftReviewNote === "function"
        ? {
            listDraftReviewNotes: (...args) => listDraftReviewNotes.call(bridge, ...args),
            createDraftReviewNote: (...args) => createDraftReviewNote.call(bridge, ...args),
            resolveDraftReviewNote: (...args) => resolveDraftReviewNote.call(bridge, ...args),
          }
        : undefined,
    list: (projectId, episodeId) => listDraftExports.call(bridge, projectId, episodeId),
    get: (projectId, episodeId, operationId) =>
      getDraftExport.call(bridge, projectId, episodeId, operationId),
    createFromPicker: (projectId, episodeId, command) =>
      createDraftExportFromPicker.call(bridge, projectId, episodeId, command),
    cancel: (projectId, episodeId, operationId) =>
      cancelDraftExport.call(bridge, projectId, episodeId, operationId),
    preview:
      typeof readDraftExportPreview === "function"
        ? (projectId, episodeId, operationId) =>
            readDraftExportPreview.call(bridge, projectId, episodeId, operationId)
        : undefined,
    reveal:
      typeof revealDraftExportOutput === "function"
        ? (projectId, episodeId, operationId) =>
            revealDraftExportOutput.call(bridge, projectId, episodeId, operationId)
        : undefined,
  };
}
