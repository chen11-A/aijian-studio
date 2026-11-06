import process from "node:process";
import { Buffer } from "node:buffer";
import console from "node:console";
import {
  readFileSync,
  realpathSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, dirname, resolve, relative, isAbsolute, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import ts from "typescript";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out-dir" || !isAbsolute(args[1])))
  throw Error("Choose an absolute audio resource directory");
const destination = args[1] ?? join(root, "apps/desktop/dist/audio-library");
if (existsSync(destination)) {
  const marker = join(destination, "resource-index.json");
  if (
    lstatSync(destination).isSymbolicLink() ||
    !existsSync(marker) ||
    JSON.parse(readFileSync(marker, "utf8")).createdBy !== "aivora-bundled-audio-builder"
  )
    throw Error("Refusing to replace an unowned directory");
}
mkdirSync(dirname(destination), { recursive: true });
const output = mkdtempSync(join(dirname(destination), ".aivora-audio-build-")),
  source = realpathSync.native(join(root, "assets/audio-library"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const manifest = readFileSync(join(source, "manifest.json"));
  const rows = JSON.parse(manifest);
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
    throw Error("Invalid bundled catalog");
  const files = new Set(["manifest.json"]);
  for (const row of rows) {
    if (
      typeof row.path !== "string" ||
      /[\\:\0]/.test(row.path) ||
      row.path.split("/").some((part) => !part || part === "." || part === "..") ||
      extname(row.path) !== ".ogg" ||
      !/^[a-f0-9]{64}$/.test(row.sha256)
    )
      throw Error("Invalid bundled asset");
    const path = realpathSync.native(join(source, row.path)),
      part = relative(source, path);
    if (
      isAbsolute(part) ||
      part.startsWith("..") ||
      lstatSync(join(source, row.path)).isSymbolicLink() ||
      hash(readFileSync(path)) !== row.sha256
    )
      throw Error("Bundled asset SHA or containment mismatch");
    files.add(row.path);
  }
  // Only the reviewed source inventory is distributable: an untracked cache, download
  // response, token JSON or raw original placed beside the library is never globbed in.
  const inventory = JSON.parse(
    readFileSync(join(root, "config/bundled-audio-resources.json"), "utf8"),
  );
  if (
    inventory.schemaVersion !== 1 ||
    inventory.manifestSha256 !== hash(manifest) ||
    !Array.isArray(inventory.documents)
  )
    throw Error("Audio source inventory changed; review the bundled inputs");
  for (const entry of inventory.documents) {
    if (
      typeof entry.path !== "string" ||
      /[\\:\0]/.test(entry.path) ||
      entry.path.split("/").some((part) => !part || part === "." || part === "..") ||
      !/\.(md|txt|json|html)$/i.test(entry.path)
    )
      throw Error("Invalid audio evidence inventory");
    const path = realpathSync.native(join(source, entry.path)),
      part = relative(source, path);
    if (isAbsolute(part) || part.startsWith("..") || hash(readFileSync(path)) !== entry.sha256)
      throw Error("Audio evidence SHA or containment mismatch");
    files.add(entry.path);
  }
  mkdirSync(output, { recursive: true });
  for (const file of [...files].sort()) {
    mkdirSync(dirname(join(output, file)), { recursive: true });
    copyFileSync(join(source, file), join(output, file));
  }
  // Compile the existing loader; its AudioAsset import is type-only and emits no dependency
  // on the excluded npm module or a third implementation of catalog validation.
  const compiled = ts.transpileModule(
    readFileSync(join(root, "packages/aivora-modules/audio-library/index.ts"), "utf8"),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      reportDiagnostics: true,
    },
  );
  if (compiled.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error))
    throw Error("Audio loader compilation failed");
  writeFileSync(join(output, "audio-library.mjs"), compiled.outputText, { flag: "wx" });
  writeFileSync(
    join(output, "resource-index.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        createdBy: "aivora-bundled-audio-builder",
        manifestSha256: hash(manifest),
        loaderSha256: hash(Buffer.from(compiled.outputText)),
        assetCount: rows.length,
        files: [...files]
          .sort()
          .map((path) => ({ path, sha256: hash(readFileSync(join(output, path))) })),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  let backup = "";
  if (existsSync(destination)) {
    backup = `${output}-previous`;
    renameSync(destination, backup);
  }
  try {
    renameSync(output, destination);
  } catch (error) {
    if (backup) renameSync(backup, destination);
    throw error;
  }
  if (backup) rmSync(backup, { recursive: true });
  console.log(
    JSON.stringify({
      assetCount: rows.length,
      manifestSha256: hash(manifest),
      outputFiles: files.size + 2,
    }),
  );
} catch (error) {
  rmSync(output, { recursive: true, force: true });
  throw error;
}
