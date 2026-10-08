import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Read-only c19 program inventory. No diagnostics, emit, child, or network.
const qaRoot = path.dirname(fileURLToPath(import.meta.url));
const c19 = "C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923";
const desktop = path.join(c19, "apps", "desktop");
const source = path.join(desktop, "src");
const postPath = "C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260929-c19-r1-four-path-prewrite-1\\POST.json";
const require = createRequire(import.meta.url);
const ts = require(path.join(c19, "node_modules", "typescript", "lib", "typescript.js"));
const { canonical, within } = require(path.join(qaRoot, "path-canonical.cjs"));
const { resolveDependencies } = require(path.join(qaRoot, "dependency-resolution.cjs"));

const sha = (data) => crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
const shaFile = (file) => sha(fs.readFileSync(file));
const expectedSources = new Map([
  ["main.ts", "BDAB4361B5D0671735253C8A57258FC48005165F07969DCD9D56C3BDC5636DAC"],
  ["sidecar-process.ts", "DE5D46DCE9CEB276F67A968F0B271B37498814CECECAF7AD7712FB6DBE22710F"],
  ["sidecar-startup-diagnostic.ts", "2B2147A6480824B6FBBC0489CB7A74780D04FE994C6C2F285E76308533FDABA6"],
  ["sidecar-extraction-temp.ts", "6EA5A2BA8ACD40F46CEE5F8A6F035C824A5A3479D93DD1565FF0C550511F7821"],
]);

function outputDirectoryInventory(relative) {
  const dir = path.join(c19, relative);
  if (!fs.existsSync(dir)) return { path: relative, exists: false, files: [] };
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else {
        assert.ok(entry.isFile(), `unexpected output link: ${full}`);
        files.push({ path: path.relative(dir, full).replaceAll("\\", "/"), sha256: shaFile(full), bytes: fs.statSync(full).size });
      }
    }
  };
  visit(dir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { path: relative, exists: true, files };
}

assert.equal(fs.existsSync(path.join(qaRoot, "run-01")), false, "QA run output already exists");
const head = execFileSync("git", ["-C", c19, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const status = execFileSync("git", ["-C", c19, "status", "--porcelain=v1", "-uall"], { encoding: "utf8" });
assert.equal(head, "211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2");
assert.equal(sha(status), "FE92C6E787E71888226D3E3B9E5AE12833080C40194BA2C2A236BF6F7F258AEB");
assert.equal(status.trimEnd().split(/\r?\n/).filter(Boolean).length, 114);
assert.equal(shaFile(postPath), "D7EF083ED343C9507725321BAF37333101E2E3B9DEDA0F25CEAAC00E82183D90");
for (const [name, expected] of expectedSources) assert.equal(shaFile(path.join(source, name)), expected);

const configPath = path.join(desktop, "tsconfig.json");
const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(loaded.error, undefined, "tsconfig read error");
const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, desktop, undefined, configPath);
assert.equal(parsed.errors.length, 0, "tsconfig parse error");
assert.equal(parsed.fileNames.length, 59, "root file count drift");
const program = ts.createProgram(parsed.fileNames, parsed.options);
const files = program.getSourceFiles().map((item) => ({
  path: item.fileName,
  canonicalPath: canonical(item.fileName),
  category: within(item.fileName, source) ? "C19_DESKTOP_SOURCE" :
    within(item.fileName, c19) ? "C19_READ_ONLY_DEPENDENCY" : "OUTSIDE_C19",
  sha256: shaFile(item.fileName),
})).sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
const categoryCounts = Object.fromEntries(["C19_DESKTOP_SOURCE", "C19_READ_ONLY_DEPENDENCY", "OUTSIDE_C19"].map(
  (category) => [category, files.filter((item) => item.category === category).length],
));
assert.equal(categoryCounts.C19_DESKTOP_SOURCE, 59);
assert.equal(categoryCounts.OUTSIDE_C19, 0, "external/author/QA fallback source detected");
const mainPath = canonical(path.join(source, "main.ts"));
const mainMatches = files.filter((item) => item.canonicalPath === mainPath);
assert.equal(mainMatches.length, 1);
const moduleResolutions = resolveDependencies(ts, parsed.options, source, desktop, c19, canonical);
const outputDirectories = ["apps/desktop/dist", "apps/desktop/build", "dist", "build"].map(outputDirectoryInventory);

const output = {
  schema: "qa02.c19-postsync-ts-static-closure.v1",
  boundary: "readConfig/parseJsonConfig/createProgram/getSourceFiles/module resolution only; no diagnostics, emit, child, network, or c19 write",
  c19,
  head,
  statusSha256: sha(status),
  statusLines: 114,
  postSha256: shaFile(postPath),
  tsconfigSha256: shaFile(configPath),
  packageSha256: shaFile(path.join(desktop, "package.json")),
  compilerVersion: ts.version,
  rootFileCount: parsed.fileNames.length,
  programFileCount: files.length,
  categoryCounts,
  releaseEntry: { path: mainPath, category: mainMatches[0].category, sha256: mainMatches[0].sha256 },
  sourceDestinations: Object.fromEntries(expectedSources),
  moduleResolutions,
  outputDirectories,
  files,
};
fs.writeFileSync(path.join(qaRoot, "STATIC-CLOSURE.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ rootFiles: output.rootFileCount, programFiles: output.programFileCount, categories: categoryCounts, mainHits: mainMatches.length, outputDirectories: outputDirectories.map((item) => ({ path: item.path, exists: item.exists, files: item.files.length })) }));
