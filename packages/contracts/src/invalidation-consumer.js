/** Closed read-only projection of the exact consumer named by a saved impact path. */
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** @param {unknown} v @param {string[]} keys */
const exact = (v, keys) =>
  record(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
/** @param {unknown} v @param {string} prefix */
const id = (v, prefix) => typeof v === "string" && new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(v);
/** @param {unknown} v */
const hash = (v) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
/** @param {unknown} v @param {number} max */
const text = (v, max) =>
  typeof v === "string" && v.length > 0 && [...v].length <= max && !/\p{Surrogate}/u.test(v);
/** @param {unknown} v */
const decimal = (v) =>
  typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
/** @param {unknown} v */
const positive = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
/** @param {unknown} v */
export function invalidationConsumerIdentity(v) {
  return (
    exact(v, [
      "project_id",
      "operation_id",
      "path_id",
      "assessment_hash",
      "artifact_id",
      "version_id",
    ]) &&
    record(v) &&
    id(v.project_id, "prj") &&
    id(v.operation_id, "ivo") &&
    id(v.path_id, "ivp") &&
    hash(v.assessment_hash) &&
    id(v.artifact_id, "art") &&
    id(v.version_id, "ver")
  );
}
/** @param {unknown} v @param {unknown} expected */
export function invalidationConsumerData(v, expected) {
  if (
    !invalidationConsumerIdentity(expected) ||
    !record(expected) ||
    !exact(v, [
      "project_id",
      "operation_id",
      "path_id",
      "assessment_hash",
      "artifact_id",
      "version_id",
      "content_hash",
      "version_number",
      "artifact_type",
      "episode",
      "shot_scope",
      "shots",
    ]) ||
    !record(v) ||
    ["project_id", "operation_id", "path_id", "assessment_hash", "artifact_id", "version_id"].some(
      (k) => v[k] !== expected[k],
    ) ||
    !hash(v.content_hash) ||
    !positive(v.version_number) ||
    !text(v.artifact_type, 120) ||
    !Array.isArray(v.shots) ||
    v.shots.length > 1000
  )
    return false;
  const episode = v.episode;
  if (
    episode !== null &&
    (!exact(episode, ["id", "position", "title", "revision", "label_origin"]) ||
      !record(episode) ||
      !(typeof episode.id === "string" && /^ep_(?:prj_)?[0-9a-f]{32}$/.test(episode.id)) ||
      !decimal(episode.position) ||
      !text(episode.title, 80) ||
      !decimal(episode.revision) ||
      episode.label_origin !== "CURRENT_EPISODE")
  )
    return false;
  const scope = v.shot_scope;
  if (v.artifact_type === "episode_storyboard") {
    if (scope !== "WHOLE_STORYBOARD_VERSION" || episode === null) return false;
  } else if (v.artifact_type === "episode_media_assembly") {
    if (scope !== "ASSEMBLY_REFERENCED_SHOTS" || episode === null) return false;
  } else if (scope !== "NO_SHOT_PROJECTION" || v.shots.length !== 0) return false;
  const keys = new Set();
  return v.shots.every((s, i) => {
    if (
      !exact(s, [
        "storyboard_version_id",
        "storyboard_content_hash",
        "shot_id",
        "ordinal",
        "title",
      ]) ||
      !record(s) ||
      !id(s.storyboard_version_id, "ver") ||
      !hash(s.storyboard_content_hash) ||
      !id(s.shot_id, "shp") ||
      !positive(s.ordinal) ||
      Number(s.ordinal) > 1000 ||
      !text(s.title, 240)
    )
      return false;
    const key = `${s.storyboard_version_id}/${s.shot_id}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return (
      scope !== "WHOLE_STORYBOARD_VERSION" ||
      (s.storyboard_version_id === v.version_id &&
        s.storyboard_content_hash === v.content_hash &&
        s.ordinal === i + 1)
    );
  });
}
/** @param {unknown} value @param {unknown} expected @param {string} [requestId] */
export function invalidationConsumerResponse(value, expected, requestId) {
  try {
    if (new globalThis.TextEncoder().encode(JSON.stringify(value)).length > 1024 * 1024)
      return false;
  } catch {
    return false;
  }
  return (
    exact(value, ["data", "request_id"]) &&
    record(value) &&
    typeof value.request_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.request_id,
    ) &&
    (requestId === undefined || value.request_id === requestId) &&
    invalidationConsumerData(value.data, expected)
  );
}
