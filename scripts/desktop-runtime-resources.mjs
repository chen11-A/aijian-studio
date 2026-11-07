// Build-time closure review, not a runtime authorization or release approval.
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { isBuiltin } from "node:module";
import { isAbsolute, join, relative, resolve, sep, posix } from "node:path";
import { lstatSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const workspace = resolve(fileURLToPath(new URL("../", import.meta.url)));
const reviewFile = join(workspace, "config/desktop-runtime-resources.json");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Closed operation roles, not a per-filename exemption from dependency audit.
const roleEntries = new Map([
  ["loadQcEngine", "qc/index.mjs"],
  ["loadQcRunner", "qc/media.mjs"],
  ["loadAudioNormalizer", "qc/audio-normalize.mjs"],
  ["loadProjectArchiveEngine", "project-archive/archive.mjs"],
  ["loadTrustedAudioLibrary", "audio-library/audio-library.mjs"],
  ["loadTrustedAudioPicker", "audio-library/audio-picker.mjs"],
]);
const validHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const fail = () => {
  throw new Error("Bundled runtime resource closure needs review");
};
const plain = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 250 &&
  !/[\\:\0]/.test(value) &&
  !isAbsolute(value) &&
  value.split("/").every((part) => part && part !== "." && part !== "..");
function inside(root, name) {
  if (!plain(name)) fail();
  let path = root;
  for (const part of name.split("/")) {
    path = join(path, part);
    if (lstatSync(path).isSymbolicLink()) fail();
  }
  const canonical = realpathSync.native(path),
    part = relative(root, canonical);
  if (!part || isAbsolute(part) || part === ".." || part.startsWith(`..${sep}`)) fail();
  return canonical;
}
function bytes(root, name, maximum = 16 * 1024 * 1024) {
  const path = inside(root, name),
    info = lstatSync(path);
  if (!info.isFile() || info.size < 1 || info.size > maximum) fail();
  return readFileSync(path);
}
const lfDigest = (data) => digest(data.toString("utf8").replaceAll("\r\n", "\n"));
function exact(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === [...keys].sort().join()
  );
}

/** The review is checked-in source/compiled-byte binding. A same-directory
 * self-hash resource index is never sufficient to introduce executable bytes. */
export function createRuntimeResourceAudit(resourcesDirectory) {
  if (
    typeof resourcesDirectory !== "string" ||
    !isAbsolute(resourcesDirectory) ||
    lstatSync(resourcesDirectory).isSymbolicLink() ||
    !lstatSync(resourcesDirectory).isDirectory()
  )
    fail();
  const root = realpathSync.native(resourcesDirectory),
    sourceRoot = realpathSync.native(workspace);
  const reviewBytes = readFileSync(reviewFile),
    review = JSON.parse(reviewBytes);
  if (
    !exact(review, [
      "schemaVersion",
      "purpose",
      "loaders",
      "modules",
      "libraryIndexSha256",
      "sourceFiles",
    ]) ||
    review.schemaVersion !== 1 ||
    review.purpose !== "reviewed-bundled-runtime-resource-closure" ||
    !Array.isArray(review.loaders) ||
    review.loaders.length !== 4 ||
    !Array.isArray(review.modules) ||
    review.modules.length !== 9 ||
    !validHash(review.libraryIndexSha256) ||
    !review.sourceFiles ||
    typeof review.sourceFiles !== "object"
  )
    fail();
  for (const [name, sha] of Object.entries(review.sourceFiles))
    if (!validHash(sha) || digest(bytes(sourceRoot, name)) !== sha) fail();
  const compiledLoaders = new Map();
  const loaders = new Map(),
    modules = new Map(),
    observed = new Map(),
    consumed = new Set();
  function observe(name, expected) {
    if (!validHash(expected)) fail();
    const data = bytes(root, name),
      sha256 = digest(data);
    if (sha256 !== expected) fail();
    observed.set(name, { path: name, sha256, bytes: data.length });
    return data;
  }
  for (const entry of review.modules) {
    if (
      !exact(entry, ["path", "sha256"]) ||
      !plain(entry.path) ||
      !entry.path.endsWith(".mjs") ||
      modules.has(entry.path)
    )
      fail();
    modules.set(entry.path, observe(entry.path, entry.sha256));
  }
  for (const loader of review.loaders) {
    if (
      !exact(loader, ["source", "sourceSha256", "emitted", "emittedSha256", "imports"]) ||
      !plain(loader.source) ||
      !plain(loader.emitted) ||
      !validHash(loader.sourceSha256) ||
      !validHash(loader.emittedSha256) ||
      loaders.has(loader.emitted) ||
      digest(bytes(sourceRoot, loader.source)) !== loader.sourceSha256 ||
      !Array.isArray(loader.imports) ||
      !loader.imports.length
    )
      fail();
    const names = new Set();
    for (const item of loader.imports) {
      if (
        !exact(item, ["function", "resource"]) ||
        typeof item.function !== "string" ||
        !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(item.function) ||
        names.has(item.function) ||
        !modules.has(item.resource) ||
        roleEntries.get(item.function) !== item.resource
      )
        fail();
      names.add(item.function);
    }
    loaders.set(loader.emitted, loader);
  }
  const indexBytes = observe("audio-library/resource-index.json", review.libraryIndexSha256);
  const index = JSON.parse(indexBytes);
  if (
    !exact(index, [
      "schemaVersion",
      "createdBy",
      "manifestSha256",
      "loaderSha256",
      "pickerSha256",
      "synonymsSha256",
      "assetCount",
      "files",
    ]) ||
    index.schemaVersion !== 1 ||
    index.createdBy !== "aivora-bundled-audio-builder" ||
    !Number.isInteger(index.assetCount) ||
    index.assetCount < 1 ||
    index.assetCount > 1000 ||
    !Array.isArray(index.files) ||
    !index.files.length ||
    index.files.length > 5000
  )
    fail();
  for (const [name, sha] of [
    ["manifest.json", index.manifestSha256],
    ["audio-library.mjs", index.loaderSha256],
    ["audio-picker.mjs", index.pickerSha256],
    ["audio-picker-synonyms.mjs", index.synonymsSha256],
  ])
    observe(`audio-library/${name}`, sha);
  const inventory = new Set();
  for (const row of index.files) {
    if (!exact(row, ["path", "sha256"]) || !plain(row.path) || inventory.has(row.path)) fail();
    inventory.add(row.path);
    observe(`audio-library/${row.path}`, row.sha256);
  }
  function inventoryDirectory(name) {
    for (const entry of readdirSync(inside(root, name), { withFileTypes: true })) {
      const child = `${name}/${entry.name}`;
      if (entry.isSymbolicLink()) fail();
      if (entry.isDirectory()) {
        if (![...observed.keys()].some((path) => path.startsWith(`${child}/`))) fail();
        inventoryDirectory(child);
      } else if (!entry.isFile() || !observed.has(child)) fail();
    }
  }
  for (const group of ["qc", "project-archive", "audio-library"]) inventoryDirectory(group);
  const graph = new Set(),
    hostModules = new Set();
  function visitModule(name) {
    if (graph.has(name)) return;
    const data = modules.get(name);
    if (!data) fail();
    graph.add(name);
    for (const specifier of resourceImports(data.toString("utf8"))) {
      if (isBuiltin(specifier)) {
        hostModules.add(specifier);
        continue;
      }
      const match = specifier.match(/^\.\/([a-z0-9-]+\.mjs)(?:\?sha256=([a-f0-9]{64}))?$/);
      if (!match) fail();
      const target = posix.join(posix.dirname(name), match[1]);
      if (!modules.has(target) || (match[2] && digest(modules.get(target)) !== match[2])) fail();
      visitModule(target);
    }
  }
  return {
    // Every dynamic call remains audited; only the entire reviewed emitted bytes
    // and its exact named function bind a declared fixed resource entry.
    resolveImport(appDirectory, sourceFile, node) {
      if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) fail();
      const appRoot = realpathSync.native(appDirectory),
        path = realpathSync.native(sourceFile.fileName);
      const relativeFile = relative(appRoot, path).split(sep).join("/");
      const loader = loaders.get(relativeFile);
      compiledLoaders.set(relativeFile, path);
      if (!loader || lfDigest(Buffer.from(sourceFile.text)) !== loader.emittedSha256) fail();
      let owner = node.parent;
      while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
      const declaration = loader.imports.find((item) => item.function === owner?.name?.text);
      const key = `${relativeFile}:${declaration?.function}`;
      if (
        !declaration ||
        consumed.has(key) ||
        roleEntries.get(declaration.function) !== declaration.resource
      )
        fail();
      consumed.add(key);
      visitModule(declaration.resource);
    },
    finish() {
      if (
        consumed.size !== review.loaders.reduce((sum, row) => sum + row.imports.length, 0) ||
        graph.size !== modules.size
      )
        fail();
      for (const [name, sha] of Object.entries(review.sourceFiles))
        if (digest(bytes(sourceRoot, name)) !== sha) fail();
      for (const loader of review.loaders) {
        if (digest(bytes(sourceRoot, loader.source)) !== loader.sourceSha256) fail();
        const path = compiledLoaders.get(loader.emitted);
        if (!path || lfDigest(readFileSync(path)) !== loader.emittedSha256) fail();
      }
      for (const [name, record] of observed)
        if (digest(bytes(root, name)) !== record.sha256) fail();
      if (digest(readFileSync(reviewFile)) !== digest(reviewBytes)) fail();
      return {
        schemaVersion: 1,
        reviewSha256: digest(reviewBytes),
        reviewedImportSites: consumed.size,
        sourceFiles: review.sourceFiles,
        loaders: review.loaders.map((loader) => ({
          source: loader.source,
          sourceSha256: loader.sourceSha256,
          path: loader.emitted,
          sha256: digest(readFileSync(compiledLoaders.get(loader.emitted))),
          normalizedSha256: loader.emittedSha256,
          imports: loader.imports,
        })),
        modules: [...graph].sort(),
        files: [...observed.values()].sort((a, b) => a.path.localeCompare(b.path)),
        hostModules: [...hostModules].sort(),
        authorization: false,
      };
    },
  };
}

/** Pure parser also rejects unbounded operations inside an otherwise known ESM
 * closure. Tests exercise unknown bare imports and traversal, not a mirror list. */
export function resourceImports(text) {
  const source = ts.createSourceFile(
      "resource.mjs",
      text,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS,
    ),
    result = [];
  function literal(node) {
    if (!node || !ts.isStringLiteral(node)) fail();
    return node.text;
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) result.push(literal(node.moduleSpecifier));
    if (ts.isExportDeclaration(node) && node.moduleSpecifier)
      result.push(literal(node.moduleSpecifier));
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      if (node.arguments.length !== 1) fail();
      result.push(literal(node.arguments[0]));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const specifier of result)
    if (!isBuiltin(specifier) && !/^\.\/[a-z0-9-]+\.mjs(?:\?sha256=[a-f0-9]{64})?$/.test(specifier))
      fail();
  return result;
}
