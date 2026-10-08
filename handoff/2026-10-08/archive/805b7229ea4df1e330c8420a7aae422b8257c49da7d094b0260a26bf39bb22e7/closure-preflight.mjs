import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

// Read-only program construction. No diagnostics, emit, fake child, or Electron.
const qaRoot = path.dirname(fileURLToPath(import.meta.url));
const c19 = "C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923";
const desktop = path.join(qaRoot, "overlay", "apps", "desktop");
const source = path.join(desktop, "src");
const require = createRequire(import.meta.url);
const ts = require(path.join(c19, "node_modules", "typescript", "lib", "typescript.js"));
const { canonical, within } = require(path.join(qaRoot, "path-canonical.cjs"));
const { resolveDependencies } = require(path.join(qaRoot, "dependency-resolution.cjs"));

assert.equal(fs.existsSync(path.join(qaRoot, "results-once")), false);
assert.equal(fs.existsSync("C:\\Users\\Administrator\\Documents\\Codex\\q2r1c-20260929"), false);
const configPath = path.join(desktop, "tsconfig.json");
const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(loaded.error, undefined, "tsconfig read error");
const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, desktop, undefined, configPath);
assert.equal(parsed.errors.length, 0, "tsconfig parse error");
assert.equal(parsed.fileNames.length, 59, "root file count drift");
const program = ts.createProgram(parsed.fileNames, parsed.options);
const moduleResolutions = resolveDependencies(ts, parsed.options, source, desktop, c19, canonical);
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
const files = program.getSourceFiles().map((item) => ({
  path: item.fileName,
  canonicalPath: canonical(item.fileName),
  category: within(item.fileName, source) ? "QA_OVERLAY_SOURCE" :
    within(item.fileName, c19) ? "C19_READ_ONLY_DEPENDENCY" : "OTHER_READ_ONLY_DEPENDENCY",
  sha256: sha256(item.fileName),
})).sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
const mainPath = canonical(path.join(source, "main.ts"));
const mainMatches = files.filter((item) => item.canonicalPath === mainPath);
const categoryCounts = Object.fromEntries(["QA_OVERLAY_SOURCE", "C19_READ_ONLY_DEPENDENCY", "OTHER_READ_ONLY_DEPENDENCY"].map(
  (category) => [category, files.filter((item) => item.category === category).length],
));
assert.equal(mainMatches.length, 1, "release main entry not uniquely resolved");
assert.equal(categoryCounts.QA_OVERLAY_SOURCE, 59, "QA overlay source classification incomplete");
const output = {
  schema: "qa02.c19-r1c-static-program-closure.v1",
  boundary: "createProgram/getSourceFiles only; no diagnostics, emit, fake child, Electron, network, or c19 write",
  compilerVersion: ts.version,
  rootFileCount: parsed.fileNames.length,
  programFileCount: files.length,
  categoryCounts,
  mainMatches,
  releaseEntry: { path: mainPath, category: mainMatches[0].category, sha256: mainMatches[0].sha256, expectedEmit: path.join(desktop, "dist", "main.js") },
  moduleResolutions,
  files,
};
fs.writeFileSync(path.join(qaRoot, "CLOSURE-PREFLIGHT.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ rootFiles: output.rootFileCount, programFiles: output.programFileCount, categoryCounts, mainHits: mainMatches.length, resolvedModules: moduleResolutions.map((item) => item.name) }));
