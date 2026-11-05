/** Model declarations only: none of these identifiers prove a media file exists. */
export type ArtDesign = {
  style_status?: string;
  preset?: string;
  era?: string;
  palette?: { name?: string; hex?: string }[];
  lighting?: string;
  lens?: string;
  grain?: string;
  contrast?: string;
  texture?: string;
  aspect?: string;
  prompt_block_en?: string;
  avoid?: string[];
  asset_ids?: string[];
  identities?: { name?: string; char_id?: string; role?: string; status?: string }[];
  portraits?: {
    name?: string;
    asset_id?: string;
    view?: string;
    costume_id?: string | null;
    prompt?: string;
  }[];
  locations?: { name?: string; loc_id?: string; asset_id?: string; status?: string }[];
  props?: {
    name?: string;
    prop_id?: string;
    asset_id?: string;
    prompt?: string;
    status?: string;
  }[];
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function strings<K extends string>(value: unknown, keys: readonly K[]): Partial<Record<K, string>> {
  const row = object(value);
  return Object.fromEntries(
    keys.flatMap((key) => (typeof row[key] === "string" ? [[key, row[key]]] : [])),
  ) as Partial<Record<K, string>>;
}
function rows<K extends string>(value: unknown, keys: readonly K[]) {
  return Array.isArray(value)
    ? value.map((row) => strings(row, keys)).filter((row) => Object.keys(row).length)
    : undefined;
}
export function parseArtDesign(value: unknown): ArtDesign | undefined {
  const row = object(value);
  const result: ArtDesign = strings(row, [
    "style_status",
    "preset",
    "era",
    "lighting",
    "lens",
    "grain",
    "contrast",
    "texture",
    "aspect",
    "prompt_block_en",
  ]);
  for (const key of ["avoid", "asset_ids"] as const)
    if (Array.isArray(row[key]))
      result[key] = row[key].filter((v): v is string => typeof v === "string");
  if (Array.isArray(row.palette)) result.palette = rows(row.palette, ["name", "hex"]);
  if (Array.isArray(row.identities))
    result.identities = rows(row.identities, ["name", "char_id", "role", "status"]);
  if (Array.isArray(row.locations))
    result.locations = rows(row.locations, ["name", "loc_id", "asset_id", "status"]);
  if (Array.isArray(row.props))
    result.props = rows(row.props, ["name", "prop_id", "asset_id", "prompt", "status"]);
  if (Array.isArray(row.portraits))
    result.portraits = row.portraits
      .map((value) => ({
        ...strings(value, ["name", "asset_id", "view", "costume_id", "prompt"]),
        ...(object(value).costume_id === null ? { costume_id: null } : {}),
      }))
      .filter((row) => Object.keys(row).length);
  return Object.keys(result).length ? result : undefined;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const declarationKey = (value: unknown) => {
  const row = object(value);
  return (
    row.asset_id ||
    row.char_id ||
    row.loc_id ||
    row.prop_id ||
    (row.name && row.view ? JSON.stringify([row.name, row.view, row.costume_id]) : row.name)
  );
};
/** Unknown old values and values edited after the last art response are conservatively retained. */
export function mergeArtDesign(
  current: ArtDesign | undefined,
  baseline: ArtDesign | undefined,
  incoming: ArtDesign,
) {
  const design = { ...current },
    nextBaseline = { ...baseline };
  for (const key of Object.keys(incoming) as (keyof ArtDesign)[]) {
    if (current?.[key] !== undefined && !same(current[key], baseline?.[key])) continue;
    let value = incoming[key];
    if (["portraits", "identities", "locations", "props"].includes(key) && Array.isArray(value)) {
      const old = (current?.[key] ?? []) as unknown[];
      const added = value as unknown[];
      value = [
        ...old.filter(
          (item) =>
            !added.some(
              (next) => declarationKey(next) && declarationKey(next) === declarationKey(item),
            ),
        ),
        ...added,
      ] as typeof value;
    }
    if (key === "asset_ids")
      value = [...new Set([...(current?.asset_ids ?? []), ...(incoming.asset_ids ?? [])])];
    Object.assign(design, { [key]: structuredClone(value) });
    Object.assign(nextBaseline, { [key]: structuredClone(value) });
  }
  return { artDesign: design, artDesignBaseline: nextBaseline };
}
