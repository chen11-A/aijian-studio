import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BundledAudioAsset,
  AudioLibraryProvenance,
} from "@aijian/contracts/film-audio-library";
import { exportFileHash } from "./film-export-io";
type Entry = BundledAudioAsset & { file: string; provenance: AudioLibraryProvenance };
export type TrustedAudioLibrary = { manifestSha256: string; assets: Entry[] };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function bundleRoot(rawRoot: string) {
  const root = await realpath(rawRoot);
  const inside = async (name: string) => {
    const file = await realpath(join(root, name)),
      part = relative(root, file);
    if (!part || part.startsWith("..") || isAbsolute(part)) throw Error("LIBRARY_UNAVAILABLE");
    return file;
  };
  return { root, inside };
}
/** Fixed main-owned root only. Public catalog projection deliberately omits executable/file paths. */
export async function loadTrustedAudioLibrary(rawRoot: string): Promise<TrustedAudioLibrary> {
  const { root, inside } = await bundleRoot(rawRoot);
  const pinPath = await inside("resource-index.json");
  if ((await stat(pinPath)).size > 2 * 1024 * 1024) throw Error("LIBRARY_UNAVAILABLE");
  const pin = JSON.parse(await readFile(pinPath, "utf8"));
  if (
    pin.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(pin.manifestSha256) ||
    !/^[a-f0-9]{64}$/.test(pin.loaderSha256)
  )
    throw Error("LIBRARY_UNAVAILABLE");
  const manifest = await inside("manifest.json"),
    modulePath = await inside("audio-library.mjs");
  if (
    (await stat(manifest)).size > 2 * 1024 * 1024 ||
    (await stat(modulePath)).size > 128 * 1024 ||
    hash(await readFile(manifest)) !== pin.manifestSha256 ||
    (await exportFileHash(modulePath)) !== pin.loaderSha256
  )
    throw Error("LIBRARY_UNAVAILABLE");
  const runtime: unknown = await import(pathToFileURL(modulePath).href);
  if (
    !runtime ||
    typeof runtime !== "object" ||
    !("loadAudioLibrary" in runtime) ||
    typeof runtime.loadAudioLibrary !== "function"
  )
    throw Error("LIBRARY_UNAVAILABLE");
  const rows: Record<string, unknown>[] = await runtime.loadAudioLibrary(root);
  if (rows.length !== pin.assetCount || rows.length > 1000) throw Error("LIBRARY_UNAVAILABLE");
  const assets: Entry[] = [];
  for (const row of rows) {
    if (
      !/^[a-f0-9]{64}$/.test(String(row.sha256)) ||
      typeof row.author !== "string" ||
      !row.author.trim() ||
      (row.loopable !== undefined && row.loopable !== row.loop)
    )
      throw Error("LIBRARY_UNAVAILABLE");
    const file = await inside(String(row.path));
    const info = await stat(file);
    if (
      !info.isFile() ||
      info.size <= 0 ||
      info.size > 16 * 1024 * 1024 ||
      (await exportFileHash(file)) !== row.sha256
    )
      throw Error("ASSET_CHANGED");
    const provenance: AudioLibraryProvenance = {
      assetId: String(row.id),
      source: String(row.source),
      author: row.author,
      license: String(row.license),
      sha256: String(row.sha256),
      loopable: row.loop === true,
      loudness: row.loudness as number | null,
      ...(typeof row.gainDb === "number" && Number.isFinite(row.gainDb)
        ? { processingGainDb: row.gainDb }
        : {}),
    };
    assets.push({
      id: String(row.id),
      name: String(row.name),
      type: row.type as "music" | "sfx",
      category: String(row.category),
      tags: row.tags as string[],
      scene: String(row.scene),
      durationSeconds: Number(row.duration),
      loopable: row.loop === true,
      loudness: row.loudness as number | null,
      source: provenance.source,
      author: provenance.author,
      license: provenance.license,
      sha256: provenance.sha256,
      file,
      provenance,
    });
  }
  if (
    hash(await readFile(manifest)) !== pin.manifestSha256 ||
    (await exportFileHash(modulePath)) !== pin.loaderSha256
  )
    throw Error("ASSET_CHANGED");
  return { manifestSha256: pin.manifestSha256, assets };
}
export function publicAudioCatalog(library: TrustedAudioLibrary) {
  return {
    kind: "CATALOG" as const,
    manifestSha256: library.manifestSha256,
    assets: library.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      category: asset.category,
      tags: asset.tags,
      scene: asset.scene,
      durationSeconds: asset.durationSeconds,
      loopable: asset.loopable,
      loudness: asset.loudness,
      source: asset.source,
      author: asset.author,
      license: asset.license,
      sha256: asset.sha256,
    })),
  };
}

export type TrustedAudioPicker = {
  /** Digest covers both compiled entry and synonyms, not merely the entry file. */
  sha256: string;
  pickAudio: (scene: unknown, assets: unknown) => unknown;
  verify: () => Promise<void>;
};
export async function loadTrustedAudioPicker(rawRoot: string): Promise<TrustedAudioPicker> {
  const { root, inside } = await bundleRoot(rawRoot);
  const pinPath = await inside("resource-index.json");
  const readPin = async () => {
    if ((await stat(pinPath)).size > 2 * 1024 * 1024) throw Error("LIBRARY_UNAVAILABLE");
    return readFile(pinPath);
  };
  const bytes = await readPin();
  const pin = JSON.parse(bytes.toString("utf8"));
  if (
    pin.schemaVersion !== 1 ||
    ![pin.pickerSha256, pin.synonymsSha256].every(
      (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    )
  )
    throw Error("LIBRARY_UNAVAILABLE");
  const entry = await inside("audio-picker.mjs"),
    synonyms = await inside("audio-picker-synonyms.mjs");
  const verify = async () => {
    if (
      (await realpath(rawRoot)) !== root ||
      (await inside("resource-index.json")) !== pinPath ||
      hash(await readPin()) !== hash(bytes) ||
      (await stat(entry)).size > 128 * 1024 ||
      (await stat(synonyms)).size > 128 * 1024 ||
      (await inside("audio-picker.mjs")) !== entry ||
      (await inside("audio-picker-synonyms.mjs")) !== synonyms ||
      (await exportFileHash(entry)) !== pin.pickerSha256 ||
      (await exportFileHash(synonyms)) !== pin.synonymsSha256
    )
      throw Error("ASSET_CHANGED");
  };
  await verify();
  if (
    !(await readFile(entry, "utf8")).includes(
      `"./audio-picker-synonyms.mjs?sha256=${pin.synonymsSha256}"`,
    )
  )
    throw Error("ASSET_CHANGED");
  const sha256 = hash(
    Buffer.from(JSON.stringify(["audio-picker-runtime-v1", pin.pickerSha256, pin.synonymsSha256])),
  );
  const url = pathToFileURL(entry);
  url.searchParams.set("sha256", sha256);
  const runtime: unknown = await import(url.href);
  if (
    !runtime ||
    typeof runtime !== "object" ||
    !("pickAudio" in runtime) ||
    typeof runtime.pickAudio !== "function"
  )
    throw Error("LIBRARY_UNAVAILABLE");
  const pick = runtime.pickAudio;
  await verify();
  return { sha256, pickAudio: (scene, assets) => pick(scene, assets), verify };
}
