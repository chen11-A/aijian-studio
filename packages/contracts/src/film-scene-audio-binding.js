const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
const id = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 160 && !value.includes("\0");
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const invalid = () => {
  throw Error("INVALID_SCENE_AUDIO_BINDING");
};
/** Creative consistency only. Never media ownership, a receipt, or write authorization. */
export function sceneAudioBinding(value) {
  const row = object(value);
  if (
    !row ||
    Object.keys(row).sort().join() !== "sceneId,schemaVersion,selectionSha256" ||
    row.schemaVersion !== 1 ||
    !id(row.sceneId) ||
    !sha(row.selectionSha256)
  )
    invalid();
  return { schemaVersion: 1, sceneId: row.sceneId, selectionSha256: row.selectionSha256 };
}
/** Endpoints hash these exact UTF-8 bytes. Project IDs, paths and mutable save metadata are absent.
 * Sources must come from actual main-owned validation, never from this projection as authority. */
export function sceneAudioSelectionInput(sceneId, rows) {
  if (!id(sceneId) || !Array.isArray(rows) || rows.length < 1 || rows.length > 128) invalid();
  const ids = new Set();
  let at = 0,
    first = -1,
    last = -1;
  const projected = rows.map((value, index) => {
    const row = object(value);
    if (
      !row ||
      Object.keys(row).sort().join() !==
        "durationSeconds,nativeSha256,sceneId,shotId,startSeconds,takeId,visualSha256" ||
      ![row.shotId, row.takeId, row.sceneId].every(id) ||
      ids.has(row.shotId) ||
      !sha(row.nativeSha256) ||
      !sha(row.visualSha256) ||
      !Number.isFinite(row.startSeconds) ||
      Math.abs(row.startSeconds - at) > 1e-6 ||
      !Number.isFinite(row.durationSeconds) ||
      row.durationSeconds <= 0 ||
      row.durationSeconds > 36000
    )
      invalid();
    ids.add(row.shotId);
    at += row.durationSeconds;
    if (at > 36000) invalid();
    if (row.sceneId === sceneId) {
      if (first < 0) first = index;
      last = index;
    }
    return {
      shotId: row.shotId,
      takeId: row.takeId,
      sceneId: row.sceneId,
      startSeconds: row.startSeconds,
      durationSeconds: row.durationSeconds,
      nativeSha256: row.nativeSha256,
      visualSha256: row.visualSha256,
    };
  });
  if (first < 0 || projected.slice(first, last + 1).some((row) => row.sceneId !== sceneId))
    invalid();
  return JSON.stringify({ schemaVersion: 1, sceneId, selection: projected });
}
