"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");

const QA = __dirname;
const RUN = path.join(QA, "run-01");
const PACKET = path.join(QA, "RUN-PACKET.json");
const APPROVAL = path.join(QA, "MGR02-APPROVAL.json");
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase();
const slash = p => path.resolve(p).replaceAll("\\", "/");
function demand(ok, code) { if (!ok) throw new Error(code); }
function fileIdentity(entry) {
  const st = fs.statSync(entry.path);
  demand(st.isFile() && st.size === entry.bytes, "FILE_SIZE_DRIFT:" + entry.path);
  demand(slash(fs.realpathSync.native(entry.path)) === entry.realPath, "REALPATH_DRIFT:" + entry.path);
  demand(hash(entry.path) === entry.sha256, "FILE_SHA_DRIFT:" + entry.path);
}
function checkFrozenFiles(packet, closure) {
  demand(hash(path.join(QA, "CLOSURE.json")) === packet.closureSha256, "CLOSURE_FILE_DRIFT");
  for (const [name, expected] of Object.entries(packet.qaInputSha256)) {
    demand(hash(path.join(QA, name)) === expected, "QA_INPUT_DRIFT:" + name);
  }
  for (const entry of [...closure.fullConfigSources, ...closure.releaseSources, ...closure.extra]) {
    fileIdentity(entry);
  }
  demand(hash(path.join(QA, "run-once.cjs")) === packet.runnerSha256, "RUNNER_DRIFT");
  demand(process.version === packet.nodeVersion &&
    slash(process.execPath) === packet.nodeExecutable, "NODE_IDENTITY_DRIFT");
}
function listFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(p));
    else if (entry.isFile()) found.push(p);
    else throw new Error("UNEXPECTED_EMIT_LINK:" + p);
  }
  return found.sort((a, b) => a.localeCompare(b, "en"));
}

const packet = JSON.parse(fs.readFileSync(PACKET, "utf8"));
const closure = JSON.parse(fs.readFileSync(path.join(QA, "CLOSURE.json"), "utf8"));
const approval = JSON.parse(fs.readFileSync(APPROVAL, "utf8"));
demand(packet.state === "PREPARED_NOT_APPROVED_NOT_RUN", "PACKET_STATE");
demand(approval.kind === "MGR02_QA01_AUTHOR_EIGHT_TS_ONE_SHOT" &&
  approval.status === "MGR02_APPROVED_ONCE", "APPROVAL_STATUS");
demand(approval.packetSha256 === hash(PACKET) && approval.runnerSha256 === packet.runnerSha256 &&
  approval.closureSha256 === packet.closureSha256 && approval.outputDirectory === RUN &&
  approval.runCount === 1, "APPROVAL_BINDING");
demand(closure.authorRoot === slash(packet.authorRoot) &&
  closure.nodeExecutable === packet.nodeExecutable, "CLOSURE_IDENTITY");
demand(closure.snapshotSha256 === packet.snapshotSha256 &&
  closure.sidecarSha256 === packet.sidecarProcessSha256 &&
  closure.typescriptVersion === packet.typescriptVersion, "CANDIDATE_IDENTITY");
demand(closure.fullConfigRoots.length === packet.actualProgramCounts.fullRoots &&
  closure.fullConfigSources.length === packet.actualProgramCounts.fullSources &&
  closure.releaseRoots.length === packet.actualProgramCounts.releaseRoots &&
  closure.releaseSources.length === packet.actualProgramCounts.releaseSources &&
  closure.extra.length === packet.actualProgramCounts.extraDependencyFiles, "PROGRAM_COUNT_IDENTITY");
const nodeEntry = closure.extra.find(e => e.path.toLowerCase() === packet.nodeExecutable.toLowerCase());
demand(nodeEntry && nodeEntry.sha256 === packet.nodeExeSha256, "NODE_SHA_IDENTITY");
checkFrozenFiles(packet, closure);  // No output directory or test process yet.
demand(!fs.existsSync(RUN), "RUN_ALREADY_EXISTS");
fs.mkdirSync(RUN);

const receipt = {
  schema: "qa01.desktop.eight-contract.ts.receipt.v1", state: "RUNNING",
  packetSha256: hash(PACKET), approvalSha256: hash(APPROVAL),
  closureSha256: packet.closureSha256, startedAt: new Date().toISOString(),
  parentPid: process.pid, nodeVersion: process.version, phases: [], outputFiles: [],
};
function writeReceipt() {
  fs.writeFileSync(path.join(RUN, "RECEIPT.json"), JSON.stringify(receipt, null, 2) + "\n");
}
function runPhase(name, args, cwd, timeout) {
  const result = cp.spawnSync(process.execPath, args, {
    cwd, timeout, encoding: "buffer", maxBuffer: 32 * 1024 * 1024,
    windowsHide: true, shell: false, input: Buffer.alloc(0),
  });
  const stdoutPath = path.join(RUN, name + ".stdout.raw");
  const stderrPath = path.join(RUN, name + ".stderr.raw");
  fs.writeFileSync(stdoutPath, result.stdout || Buffer.alloc(0), { flag: "wx" });
  fs.writeFileSync(stderrPath, result.stderr || Buffer.alloc(0), { flag: "wx" });
  receipt.phases.push({
    name, command: [process.execPath, ...args], cwd, pid: result.pid ?? null,
    exitCode: result.status, signal: result.signal,
    error: result.error ? String(result.error) : null,
    stdout: { bytes: fs.statSync(stdoutPath).size, sha256: hash(stdoutPath) },
    stderr: { bytes: fs.statSync(stderrPath).size, sha256: hash(stderrPath) },
  });
  writeReceipt();
  demand(result.status === 0 && !result.error, "PHASE_RED:" + name);
  checkFrozenFiles(packet, closure);
}

writeReceipt();
try {
  const author = packet.authorRoot;
  const tsc = packet.tscBin;
  const fullConfig = path.join(author, "apps", "desktop", "tsconfig.json");
  const releaseConfig = path.join(QA, "tsconfig.release.qa.json");
  runPhase("closure-before", [path.join(QA, "snapshot-closure.cjs"), "check"], QA, 30000);
  runPhase("full-typecheck", [tsc, "--noEmit", "-p", fullConfig],
    path.join(author, "apps", "desktop"), 120000);
  runPhase("release-typecheck", [tsc, "--noEmit", "-p", releaseConfig], QA, 120000);
  runPhase("release-emit", [tsc, "-p", releaseConfig], QA, 120000);
  const dist = path.join(RUN, "dist");
  demand(fs.existsSync(dist), "EMIT_DIST_ABSENT");
  const outputs = listFiles(dist);
  const names = new Set(outputs.map(p => path.relative(dist, p).replaceAll("\\", "/").toLowerCase()));
  for (const required of ["main.js", "preload.js", "sidecar-process.js"]) {
    demand(names.has(required), "EMIT_MISSING:" + required);
  }
  demand(outputs.every(p => !/\.(test|spec)\.js$/i.test(p) &&
    !/fixture/i.test(path.basename(p))), "UNEXPECTED_TEST_OR_FIXTURE_EMIT");
  receipt.outputFiles = outputs.map(p => ({ path: slash(p), bytes: fs.statSync(p).size, sha256: hash(p) }));
  writeReceipt();
  runPhase("closure-after", [path.join(QA, "snapshot-closure.cjs"), "check"], QA, 30000);
  receipt.state = "PASS_AUTHOR_FULL_TS_AND_RELEASE_EMIT_ONLY";
} catch (error) {
  receipt.state = "RED_STOP";
  receipt.failure = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  receipt.finishedAt = new Date().toISOString();
  try { checkFrozenFiles(packet, closure); receipt.sourceHashesAfter = "MATCH"; }
  catch (error) {
    receipt.sourceHashesAfter = "DRIFT";
    receipt.state = "RED_STOP";
    receipt.failure = (receipt.failure || "") + "\n" + String(error);
    process.exitCode = 1;
  }
  writeReceipt();
  const line = JSON.stringify({ state: receipt.state, receipt: path.join(RUN, "RECEIPT.json") }) + "\n";
  fs.writeFileSync(path.join(RUN, "runner.stdout.raw"), line, { flag: "wx" });
  fs.writeFileSync(path.join(RUN, "runner.stderr.raw"), "", { flag: "wx" });
  process.stdout.write(line);
}
