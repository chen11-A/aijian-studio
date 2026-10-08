"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const AUTHOR = "C:\\Users\\Administrator\\.codex\\worktrees\\s2-q1-g1-d00-default-deny-59f-20260923\\sp";
const QA = __dirname;
const SNAPSHOT = "C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260928-desktop-eight-contract-tsfix-author-1\\SNAPSHOT.json";
const OLD_RUN = "C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\qa03-project-name-source-20260928\\desktop-r1-ts-gate-v1\\run-01";
const EXPECTED_SNAPSHOT = "31B6CD963F074240CCF57A8869BF09EAEA99F898576BBBBC2FC6B24FD869A8FD";
const EXPECTED_SIDECAR = "DE5D46DCE9CEB276F67A968F0B271B37498814CECECAF7AD7712FB6DBE22710F";
const EXPECTED_OLD = {
  "RECEIPT.json": "A2FC945967A380D9C9EC16348A5AE28C061C626C1FCD70FAC445D4C305830696",
  "full-typecheck.stdout.bin": "04EC9A2B322AFA2C195E689E1C892ABC19F312560939858300EDCF04997A57FF",
  "full-typecheck.stderr.bin": "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
};

const ts = require(path.join(AUTHOR, "node_modules", "typescript"));
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase();
const slash = p => path.resolve(p).replaceAll("\\", "/");
function demand(ok, code) { if (!ok) throw new Error(code); }
function item(p) {
  const absolute = path.resolve(p);
  const st = fs.statSync(absolute);
  demand(st.isFile(), "NOT_FILE:" + absolute);
  return {
    path: slash(absolute), realPath: slash(fs.realpathSync.native(absolute)),
    bytes: st.size, sha256: hash(absolute),
  };
}
function config(configPath) {
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  demand(!loaded.error, "CONFIG_READ:" + (loaded.error && ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n")));
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath), {}, configPath);
  demand(parsed.errors.length === 0, "CONFIG_PARSE:" + parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  return parsed;
}
function sourceClosure(parsed) {
  // Construct the actual compiler program. This only reads sources: no diagnostics or emit.
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, incremental: false });
  return program.getSourceFiles().map(sf => item(sf.fileName)).sort((a, b) => a.path.localeCompare(b.path, "en"));
}
function snapshot() {
  demand(hash(SNAPSHOT) === EXPECTED_SNAPSHOT, "SNAPSHOT_DRIFT");
  const manifest = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  demand(manifest.files.length === 8, "EIGHT_COUNT");
  const candidate = manifest.files.map(entry => {
    const p = path.join(AUTHOR, entry.path);
    demand(hash(p) === entry.new_sha256, "EIGHT_DRIFT:" + entry.path);
    return { path: slash(p), sha256: entry.new_sha256, authorClosure: entry.author_closure };
  });
  const sidecar = path.join(AUTHOR, "apps", "desktop", "src", "sidecar-process.ts");
  demand(hash(sidecar) === EXPECTED_SIDECAR, "SIDECAR_DRIFT");
  for (const [name, expected] of Object.entries(EXPECTED_OLD)) {
    demand(hash(path.join(OLD_RUN, name)) === expected, "OLD_RED_DRIFT:" + name);
  }
  const releaseConfig = path.join(QA, "tsconfig.release.qa.json");
  const fullConfig = path.join(AUTHOR, "apps", "desktop", "tsconfig.json");
  const release = config(releaseConfig);
  const full = config(fullConfig);
  const releaseSources = sourceClosure(release);
  const fullSources = sourceClosure(full);
  const releaseSet = new Set(releaseSources.map(x => x.path.toLowerCase()));
  const fullSet = new Set(fullSources.map(x => x.path.toLowerCase()));
  for (const entry of candidate) {
    demand(fullSet.has(entry.path.toLowerCase()), "FULL_MISSING:" + entry.path);
    demand(releaseSet.has(entry.path.toLowerCase()) === (entry.authorClosure === "RELEASE_ENTRY"),
      "RELEASE_CLASS_MISMATCH:" + entry.path);
  }
  demand(fullSet.has(slash(sidecar).toLowerCase()) && releaseSet.has(slash(sidecar).toLowerCase()), "SIDECAR_PROGRAM_MISSING");
  const extra = [
    SNAPSHOT, path.join(OLD_RUN, "RECEIPT.json"),
    path.join(OLD_RUN, "full-typecheck.stdout.bin"), path.join(OLD_RUN, "full-typecheck.stderr.bin"),
    releaseConfig, fullConfig,
    path.join(AUTHOR, "package.json"), path.join(AUTHOR, "pnpm-lock.yaml"),
    path.join(AUTHOR, "apps", "desktop", "package.json"),
    path.join(AUTHOR, "packages", "contracts", "package.json"),
    path.join(AUTHOR, "node_modules", "typescript", "package.json"),
    path.join(AUTHOR, "node_modules", "typescript", "bin", "tsc"),
    path.join(AUTHOR, "node_modules", "typescript", "lib", "_tsc.js"),
    path.join(AUTHOR, "node_modules", "typescript", "lib", "typescript.js"),
    process.execPath,
  ].map(item);
  return {
    schema: "qa01.desktop.eight-contract.ts.program-closure.v1",
    authorRoot: slash(AUTHOR), qaRoot: slash(QA), nodeVersion: process.version,
    nodeExecutable: slash(process.execPath), typescriptVersion: ts.version,
    snapshotSha256: EXPECTED_SNAPSHOT, sidecarSha256: EXPECTED_SIDECAR,
    candidate,
    fullConfigRoots: full.fileNames.map(slash).sort(), fullConfigSources: fullSources,
    releaseRoots: release.fileNames.map(slash).sort(), releaseSources,
    extra,
  };
}

const out = path.join(QA, "CLOSURE.json");
const bytes = JSON.stringify(snapshot(), null, 2) + "\n";
if (process.argv[2] === "freeze") {
  fs.writeFileSync(out, bytes, { flag: "wx" });
  const data = JSON.parse(bytes);
  process.stdout.write(JSON.stringify({
    closureSha256: hash(out), fullRoots: data.fullConfigRoots.length,
    fullSources: data.fullConfigSources.length, releaseRoots: data.releaseRoots.length,
    releaseSources: data.releaseSources.length,
  }) + "\n");
} else if (process.argv[2] === "check") {
  demand(fs.readFileSync(out, "utf8") === bytes, "CLOSURE_DRIFT");
  process.stdout.write("CLOSURE_MATCH " + hash(out) + "\n");
} else {
  throw new Error("USE_FREEZE_OR_CHECK");
}
