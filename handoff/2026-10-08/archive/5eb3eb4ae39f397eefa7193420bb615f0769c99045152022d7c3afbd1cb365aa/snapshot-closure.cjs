"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ROOT = "C:\\Users\\Administrator\\.codex\\worktrees\\s2-q1-g1-d00-default-deny-59f-20260923\\sp";
const QA = __dirname;
const ts = require(path.join(ROOT, "node_modules", "typescript"));
const hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase();
const slash = (p) => path.resolve(p).replaceAll("\\", "/");
const item = (p) => {
  const absolute = path.resolve(p);
  const st = fs.statSync(absolute);
  if (!st.isFile()) throw new Error("Not a file: " + absolute);
  return {
    path: slash(absolute),
    realPath: slash(fs.realpathSync.native(absolute)),
    bytes: st.size,
    sha256: hash(absolute),
  };
};
function readConfig(configPath) {
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath), {}, configPath);
  if (parsed.errors.length) throw new Error(parsed.errors.map(x => ts.flattenDiagnosticMessageText(x.messageText, "\n")).join("\n"));
  return parsed;
}
function sourceClosure(parsed) {
  const program = ts.createProgram(parsed.fileNames, {...parsed.options, noEmit: true, incremental: false});
  return program.getSourceFiles().map(x => item(x.fileName)).sort((a,b) => a.path.localeCompare(b.path, "en"));
}
const releaseConfigPath = path.join(QA, "tsconfig.release.qa.json");
const fullConfigPath = path.join(ROOT, "apps", "desktop", "tsconfig.json");
const release = readConfig(releaseConfigPath);
const full = readConfig(fullConfigPath);
const required = [
  ["main.ts", "299099E3EA795874FEDB68CC68961A9BA70D0E2FE5126F53A444D1D22A61AFE1"],
  ["sidecar-process.ts", "8416388F3CC0B9D7031916B8A2C96FD672F6D6651CAD39675542F778ED70E516"],
  ["sidecar-extraction-temp.ts", "6EA5A2BA8ACD40F46CEE5F8A6F035C824A5A3479D93DD1565FF0C550511F7821"],
];
for (const [name, expected] of required) {
  const actual = hash(path.join(ROOT, "apps", "desktop", "src", name));
  if (actual !== expected) throw new Error(name + " candidate drift: " + actual);
}
const extra = [
  releaseConfigPath,
  fullConfigPath,
  path.join(ROOT, "package.json"),
  path.join(ROOT, "pnpm-lock.yaml"),
  path.join(ROOT, "apps", "desktop", "package.json"),
  path.join(ROOT, "packages", "contracts", "package.json"),
  path.join(ROOT, "node_modules", "typescript", "package.json"),
  path.join(ROOT, "node_modules", "typescript", "bin", "tsc"),
  path.join(ROOT, "node_modules", "typescript", "lib", "_tsc.js"),
  path.join(ROOT, "node_modules", "typescript", "lib", "typescript.js"),
].map(item);
const snapshot = {
  schema: "qa03.desktop.r1.ts.closure.v1",
  authorRoot: slash(ROOT),
  qaRoot: slash(QA),
  nodeVersion: process.version,
  nodeExecutable: slash(process.execPath),
  typescriptVersion: ts.version,
  candidate: required.map(([name, sha256]) => ({name, sha256})),
  releaseRoots: release.fileNames.map(slash).sort(),
  releaseSources: sourceClosure(release),
  fullConfigRoots: full.fileNames.map(slash).sort(),
  fullConfigSources: sourceClosure(full),
  extra,
};
if (snapshot.releaseRoots.length !== 2 || snapshot.releaseSources.length !== 237 ||
    snapshot.fullConfigRoots.length !== 80 || snapshot.fullConfigSources.length !== 320) {
  throw new Error("Unexpected TS program size: " + JSON.stringify({
    releaseRoots: snapshot.releaseRoots.length,
    releaseSources: snapshot.releaseSources.length,
    fullRoots: snapshot.fullConfigRoots.length,
    fullSources: snapshot.fullConfigSources.length,
  }));
}
const out = path.join(QA, "CLOSURE.json");
const bytes = JSON.stringify(snapshot, null, 2) + "\n";
if (process.argv[2] === "freeze") {
  fs.writeFileSync(out, bytes, {flag:"wx"});
  process.stdout.write(JSON.stringify({
    releaseRoots: snapshot.releaseRoots.length,
    releaseSources: snapshot.releaseSources.length,
    fullRoots: snapshot.fullConfigRoots.length,
    fullSources: snapshot.fullConfigSources.length,
    closureSha256: hash(out),
  }) + "\n");
} else if (process.argv[2] === "check") {
  if (fs.readFileSync(out, "utf8") !== bytes) throw new Error("Closure drift");
  process.stdout.write("CLOSURE_MATCH " + hash(out) + "\n");
} else {
  throw new Error("Use freeze or check");
}

