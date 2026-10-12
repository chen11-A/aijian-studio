/** Explicit human review scope. These guards never assert original availability. */
import { hasValidCreativeLibraryEnvironment } from "./creative-library-environment.js";
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** @param {unknown} v @param {string[]} keys */
const exact = (v, keys) =>
  record(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
/** @param {unknown} v @param {string} prefix */
const id = (v, prefix) => typeof v === "string" && new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(v);
/** @param {unknown} v @param {string} prefix */
const ids = (v, prefix) =>
  Array.isArray(v) &&
  v.length <= 2000 &&
  new Set(v).size === v.length &&
  v.every((x) => id(x, prefix));
/** @param {unknown} v */
export function visualEnvironmentScope(v) {
  return (
    exact(v, ["world_included", "scene_variant_ids", "environment_reference_ids"]) &&
    v.world_included === true &&
    ids(v.scene_variant_ids, "scv") &&
    ids(v.environment_reference_ids, "erf")
  );
}
/** @param {unknown} v @returns {string} */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (record(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
/** @param {unknown} v */
export function visualEnvironmentProjection(v) {
  if (
    !exact(v, ["declaration", "world", "states", "references"]) ||
    !visualEnvironmentScope(v.declaration) ||
    !record(v.declaration) ||
    !exact(v.world, ["premise", "rules", "era", "visual_style", "palette", "materials"]) ||
    !Array.isArray(v.states) ||
    !Array.isArray(v.references)
  )
    return false;
  if (
    !Object.entries(v.world).every(
      ([k, x]) =>
        typeof x === "string" &&
        [...x].length <= (k === "era" ? 240 : 20000) &&
        !/\p{Surrogate}/u.test(x),
    )
  )
    return false;
  if (
    !v.states.every(
      (x) =>
        record(x) &&
        Number.isSafeInteger(x.ordinal) &&
        Number(x.ordinal) >= 1 &&
        Number(x.ordinal) <= 2000,
    ) ||
    !v.references.every(
      (x) =>
        record(x) &&
        Number.isSafeInteger(x.ordinal) &&
        Number(x.ordinal) >= 1 &&
        Number(x.ordinal) <= 2000,
    )
  )
    return false;
  if (
    canonical(v.states.map((x) => x.variant_id)) !== canonical(v.declaration.scene_variant_ids) ||
    canonical(v.references.map((x) => x.reference_id)) !==
      canonical(v.declaration.environment_reference_ids)
  )
    return false;
  // The reviewed subset retains its original ordinals. Normalize validation copies only.
  const scenes = [
    ...new Set([
      ...v.states.map((x) => x.scene_id),
      ...v.references.map((x) => x.scene_id).filter((x) => x !== null),
    ]),
  ].map((scene_id) => ({ scene_id }));
  return hasValidCreativeLibraryEnvironment({
    schema_version: "1.3.0",
    scenes,
    scene_variants: v.states.map((x, i) => ({ ...x, ordinal: i + 1 })),
    environment_references: v.references.map((x, i) => ({ ...x, ordinal: i + 1 })),
  });
}
/** Correlate report with the actual immutable content and library, not renderer claims.
 * @param {unknown} content @param {unknown} library @param {unknown} report */
export function visualEnvironmentEvidenceMatches(content, library, report) {
  if (!record(content) || !record(report)) return false;
  if (
    report.policy_code !== "g5.visual-bible" ||
    report.creative_library_version_id !== content.creative_library_version_id ||
    report.creative_library_content_hash !== content.creative_library_content_hash ||
    report.effective_scope !== content.effective_scope ||
    !Array.isArray(content.props) ||
    report.props_declared_empty !== (content.props.length === 0)
  )
    return false;
  if (content.schema_version === "1.0.0")
    return report.policy_version === "1" && !Object.hasOwn(report, "environment_projection");
  if (
    content.schema_version !== "1.1.0" ||
    report.policy_version !== "2" ||
    !record(library) ||
    library.schema_version !== "1.3.0" ||
    !visualEnvironmentScope(content.environment_scope) ||
    !record(content.environment_scope) ||
    !Array.isArray(content.scenes) ||
    !Array.isArray(library.scene_variants) ||
    !Array.isArray(library.environment_references) ||
    !visualEnvironmentProjection(report.environment_projection)
  )
    return false;
  const scope = content.environment_scope;
  const states = scope.scene_variant_ids.map((id) =>
    library.scene_variants.find((x) => record(x) && x.variant_id === id),
  );
  const references = scope.environment_reference_ids.map((id) =>
    library.environment_references.find((x) => record(x) && x.reference_id === id),
  );
  if (
    states.some(
      (x) => !record(x) || !content.scenes.some((s) => record(s) && s.scene_id === x.scene_id),
    ) ||
    references.some(
      (x) =>
        !record(x) ||
        (x.scene_id !== null &&
          !content.scenes.some((s) => record(s) && s.scene_id === x.scene_id)) ||
        (x.variant_id !== null && !scope.scene_variant_ids.includes(x.variant_id)),
    )
  )
    return false;
  return (
    canonical(report.environment_projection) ===
    canonical({ declaration: scope, world: library.world, states, references })
  );
}
/** @param {unknown} board @param {unknown} visual */
export function visualEnvironmentChoicesWithinScope(board, visual) {
  if (!record(board) || !Array.isArray(board.shots) || !record(visual)) return false;
  const chosen = board.shots
    .filter(record)
    .map((s) => s.environment_binding)
    .filter(record);
  if (visual.schema_version === "1.0.0")
    return (
      board.schema_version !== "1.5.0" &&
      chosen.every(
        (b) =>
          b.variant_id === null && Array.isArray(b.reference_ids) && b.reference_ids.length === 0,
      )
    );
  if (
    visual.schema_version !== "1.1.0" ||
    !visualEnvironmentScope(visual.environment_scope) ||
    !record(visual.environment_scope)
  )
    return false;
  const scope = visual.environment_scope;
  return chosen.every(
    (b) =>
      (b.variant_id === null || scope.scene_variant_ids.includes(b.variant_id)) &&
      Array.isArray(b.reference_ids) &&
      b.reference_ids.every((id) => scope.environment_reference_ids.includes(id)),
  );
}
