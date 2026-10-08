import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const moduleUrl = import.meta.url;
const sourceRoot = fileURLToPath(new URL("../", moduleUrl));
const assetRoot = resolve(sourceRoot, "src/aivora/assets");
const virtualPrefix = "\0aivora-development-core-art:";
// Locally authored neutral vector; no source/reference artwork is embedded.
// Original images and all default-build visuals remain untouched.
export const omittedCrop =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
      '<rect width="640" height="360" fill="#152031"/>' +
      '<g fill="none" stroke="#536278" stroke-width="3" opacity=".65">' +
      '<rect x="290" y="150" width="60" height="60" rx="10"/>' +
      '<path d="m296 198 15-17 12 12 10-10 12 15"/><circle cx="330" cy="169" r="5"/>' +
      "</g></svg>",
  );
export type DemoCrop = { name: string; sha256: string; bytes: Buffer; path: string };
export type ExcludedArtwork = DemoCrop & { category: "demo-crop" | "unreviewed-raster" };
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function readDemoCrops(root = assetRoot): DemoCrop[] {
  const manifest: unknown = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  if (!Array.isArray(manifest) || manifest.length === 0)
    throw new Error("The DEVELOPMENT_CORE demo-crop manifest must not be empty.");
  const names = new Set<string>();
  return manifest.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid demo-crop entry.");
    const item = entry as Record<string, unknown>;
    if (
      typeof item.name !== "string" ||
      !/^[a-z]+(?:-[a-z]+)*$/.test(item.name) ||
      names.has(item.name) ||
      typeof item.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/i.test(item.sha256) ||
      typeof item.purpose !== "string" ||
      !item.purpose.toLowerCase().includes("demo only")
    )
      throw new Error("Unverified DEVELOPMENT_CORE demo-crop entry.");
    names.add(item.name);
    const path = resolve(root, `${item.name}.jpg`);
    const bytes = readFileSync(path);
    if (sha256(bytes) !== item.sha256.toLowerCase())
      throw new Error(`Demo-crop source hash changed: ${item.name}.jpg`);
    return { name: item.name, sha256: item.sha256.toLowerCase(), bytes, path };
  });
}

/** Unmanifested raster placeholders have no redistribution evidence in this checkout. */
export function readDevelopmentCoreArtwork(root = assetRoot): ExcludedArtwork[] {
  const crops = readDemoCrops(root);
  const demoPaths = new Set(crops.map((crop) => crop.path));
  const excluded: ExcludedArtwork[] = crops.map((crop) => ({ ...crop, category: "demo-crop" }));
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Symlinked artwork cannot be audited for DEVELOPMENT_CORE.");
      if (entry.isDirectory()) visit(path);
      else if (
        !demoPaths.has(path) &&
        [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp"].includes(
          extname(path).toLowerCase(),
        )
      ) {
        const bytes = readFileSync(path);
        excluded.push({
          name: relative(root, path).split("\\").join("/"),
          sha256: sha256(bytes),
          bytes,
          path,
          category: "unreviewed-raster",
        });
      }
    }
  }
  visit(root);
  return excluded;
}

/** Also detects Vite's inline data URLs for the small street thumbnails. */
export function assertNoDemoCropBytes(
  bytes: Uint8Array | string,
  crops: DemoCrop[],
  filename: string,
) {
  const output = Buffer.from(bytes);
  const text = output.toString("utf8");
  for (const crop of crops) {
    if (output.includes(crop.bytes) || text.includes(crop.bytes.toString("base64")))
      throw new Error(`DEVELOPMENT_CORE contains excluded artwork ${crop.name}: ${filename}`);
  }
}

export function developmentCoreAssets(): Plugin {
  const crops = readDevelopmentCoreArtwork();
  const paths = new Map(crops.map((crop) => [crop.path, crop]));
  return {
    name: "aivora-development-core-artwork-exclusion",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      const clean = source.split("?")[0]!;
      const path = clean.startsWith("/src/")
        ? resolve(sourceRoot, clean.slice(1))
        : clean.startsWith(".") && importer
          ? resolve(dirname(importer.split("?")[0]!), clean)
          : resolve(clean);
      const crop = paths.get(path);
      return crop
        ? `${virtualPrefix}${relative(assetRoot, crop.path).split("\\").join("/")}`
        : null;
    },
    load(id) {
      return id.startsWith(virtualPrefix) ? `export default ${JSON.stringify(omittedCrop)};` : null;
    },
    generateBundle(_options, bundle) {
      for (const [filename, item] of Object.entries(bundle))
        assertNoDemoCropBytes(item.type === "asset" ? item.source : item.code, crops, filename);
      this.emitFile({
        type: "asset",
        fileName: "development-core-artwork-exclusions.json",
        source:
          JSON.stringify(
            {
              profile: "DEVELOPMENT_CORE",
              replacement: "locally-authored-neutral-svg",
              excluded: crops.map(({ path, sha256, category }) => ({
                source: relative(assetRoot, path).split("\\").join("/"),
                sha256,
                category,
              })),
              fonts_and_favicon_preserved: true,
            },
            null,
            2,
          ) + "\n",
      });
    },
  };
}
