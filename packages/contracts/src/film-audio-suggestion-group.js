import { audioMixEnvelope } from "./film-audio-mix-plan.js";
const object = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const text = (v, max = 200) =>
  typeof v === "string" && v.length > 0 && v.length <= max && !v.includes("\0");
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
/** Bounded creative metadata only. Never ownership, file authorization or permission to delete. */
export function normalizeAudioSuggestionGroup(value) {
  const v = object(value);
  if (
    !v ||
    Object.keys(v).sort().join() !==
      "groupId,key,memberCount,memberSetSha256,planFingerprint,schemaVersion" ||
    v.schemaVersion !== 1 ||
    !text(v.groupId, 80) ||
    !text(v.key, 160) ||
    !hash(v.planFingerprint) ||
    !hash(v.memberSetSha256) ||
    !Number.isInteger(v.memberCount) ||
    v.memberCount < 1 ||
    v.memberCount > 128
  )
    return null;
  return {
    schemaVersion: 1,
    groupId: v.groupId,
    planFingerprint: v.planFingerprint,
    key: v.key,
    memberCount: v.memberCount,
    memberSetSha256: v.memberSetSha256,
  };
}
/** Stable digest input, without local path or mutable waveform/cache data. */
export function audioSuggestionMemberInput(value) {
  const v = object(value),
    asset = object(v?.libraryAsset);
  if (
    !v ||
    !asset ||
    !text(v.id) ||
    !text(v.shotId) ||
    !text(v.takeId) ||
    !["ambience", "sfx", "score"].includes(v.lane) ||
    !text(v.label) ||
    !text(asset.assetId) ||
    !hash(asset.sha256) ||
    ![v.startSeconds, v.durationSeconds, v.offsetSeconds, v.gainDb].every(Number.isFinite) ||
    v.startSeconds < 0 ||
    v.durationSeconds <= 0 ||
    v.offsetSeconds < 0 ||
    v.gainDb < -40 ||
    v.gainDb > 12 ||
    typeof v.loop !== "boolean" ||
    typeof v.enabled !== "boolean"
  )
    throw Error("INVALID_AUDIO_SUGGESTION_MEMBER");
  return JSON.stringify({
    id: v.id,
    shotId: v.shotId,
    takeId: v.takeId,
    lane: v.lane,
    label: v.label,
    startSeconds: v.startSeconds,
    durationSeconds: v.durationSeconds,
    offsetSeconds: v.offsetSeconds,
    gainDb: v.gainDb,
    loop: v.loop,
    enabled: v.enabled,
    asset: { assetId: asset.assetId, sha256: asset.sha256 },
    envelope: v.envelope === undefined ? null : audioMixEnvelope(v.envelope),
  });
}
export function audioSuggestionMemberSetInput(members) {
  if (
    !Array.isArray(members) ||
    members.length < 1 ||
    members.length > 128 ||
    members.some(
      (v) =>
        !object(v) ||
        Object.keys(v).sort().join() !== "clipId,creativeSha256,key" ||
        !text(v.key, 160) ||
        !text(v.clipId) ||
        !hash(v.creativeSha256),
    ) ||
    new Set(members.map((v) => v.key)).size !== members.length ||
    new Set(members.map((v) => v.clipId)).size !== members.length
  )
    throw Error("INVALID_AUDIO_SUGGESTION_MEMBERS");
  return JSON.stringify(
    [...members]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((v) => ({ key: v.key, clipId: v.clipId, creativeSha256: v.creativeSha256 })),
  );
}

/** Candidate inputs only: callers MUST hash each creativeInput and the member set and
 * compare memberSetSha256 before claiming completeness or removing references. */
export function audioSuggestionGroupInputs(clips, groupId) {
  if (!Array.isArray(clips) || clips.length > 10000 || !text(groupId, 80)) return null;
  const idCounts = new Map();
  for (const clip of clips) {
    const id = object(clip)?.id;
    if (typeof id === "string") idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  const rows = clips.filter((v) => object(v)?.suggestionGroup?.groupId === groupId);
  if (!rows.length || rows.length > 128) return null;
  const group = normalizeAudioSuggestionGroup(rows[0].suggestionGroup);
  if (!group || group.memberCount !== rows.length) return null;
  const keys = new Set(),
    ids = new Set(),
    members = [];
  for (const clip of rows) {
    const item = normalizeAudioSuggestionGroup(clip.suggestionGroup);
    if (
      !item ||
      item.memberCount !== group.memberCount ||
      item.memberSetSha256 !== group.memberSetSha256 ||
      item.planFingerprint !== group.planFingerprint ||
      keys.has(item.key) ||
      ids.has(clip.id) ||
      idCounts.get(clip.id) !== 1
    )
      return null;
    keys.add(item.key);
    ids.add(clip.id);
    try {
      members.push({
        key: item.key,
        clipId: clip.id,
        creativeInput: audioSuggestionMemberInput(clip),
      });
    } catch {
      return null;
    }
  }
  return { group, members };
}
