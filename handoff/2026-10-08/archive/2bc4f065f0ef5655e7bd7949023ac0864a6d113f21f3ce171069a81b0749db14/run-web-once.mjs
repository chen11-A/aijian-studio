import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { captured } from "./capture-process.mjs";
import { canonicalDigest, canonicalRows, nonDistStatus } from "./canonical-fingerprint.mjs";

const qaRoot = dirname(import.meta.filename);
const repo = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
const web = join(repo, "apps/studio-web");
const fingerprint = "C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa03-ac05-front-20260924/fingerprint.mjs";
const node = process.execPath;
const tsc = join(web, "node_modules/typescript/bin/tsc");
const vite = join(web, "node_modules/vite/bin/vite.js");
const argv = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const equal = entry.indexOf("=");
  assert.ok(entry.startsWith("--") && equal > 2, `Invalid argument: ${entry}`);
  return [entry.slice(2, equal), entry.slice(equal + 1)];
}));
for (const key of ["approval", "approval-sha256", "output"])
  assert.ok(argv[key], `Missing ${key}`);
const approvalPath = resolve(argv.approval);
const output = resolve(argv.output);
const relationship = relative(qaRoot, output);
assert.ok(relationship && !relationship.startsWith("..") && !isAbsolute(relationship),
  "Output must be under this external QA directory");
assert.ok(!existsSync(output), "One-shot output already exists");
assert.notEqual(approvalPath.toLowerCase(),
  join(qaRoot, "RUN-APPROVAL.template.json").toLowerCase(), "Template is not approved");
const sha = (data) => createHash("sha256").update(data).digest("hex").toUpperCase();
const hash = (path) => sha(readFileSync(path));
assert.equal(hash(approvalPath), argv["approval-sha256"].toUpperCase(), "Approval SHA drift");
const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
assert.equal(approval.schema, "qa03.project-name-web-build.one-shot.approval.v2");
assert.equal(approval.state, "APPROVED_SINGLE_RUN");
assert.equal(approval.runId, "qa03-source-name-web-02");
assert.equal(resolve(approval.outputDir), output);
assert.equal(approval.packetSha256, hash(join(qaRoot, "PACKET.json")));
assert.equal(approval.runnerSha256, hash(import.meta.filename));
assert.equal(approval.captureSha256, hash(join(qaRoot, "capture-process.mjs")));
assert.equal(approval.canonicalSha256, hash(join(qaRoot, "canonical-fingerprint.mjs")));
assert.equal(approval.fingerprintSha256, hash(fingerprint));
assert.equal(approval.nodeSha256, hash(node));
assert.equal(approval.tscSha256, hash(tsc));
assert.equal(approval.viteSha256, hash(vite));
assert.equal(approval.componentReceiptSha256, hash(approval.componentReceiptPath));
assert.equal(approval.componentReceiptSha256,
  "A731DFE6E90B46BCD631CC097720CC12DE99A1E9F6D7A5420674CC84A78A9582");
const component = JSON.parse(readFileSync(approval.componentReceiptPath, "utf8"));
assert.equal(component.state, "TARGETED_LOCAL_COMPONENT_PASS");
assert.equal(hash(approval.storySnapshotPath), approval.storySnapshotSha256);
assert.equal(hash(approval.syncReceiptPath), approval.syncReceiptSha256);
assert.equal(approval.storySnapshotSha256,
  "EE77C4EEB6B75A20C776CE9CF5C7048B14DEA23441F5F8B1F5B3F892DF5AF312");
assert.equal(approval.syncReceiptSha256,
  "6CB98F12620EEBCCC244ACEAD6DC1888B1E7302A403AAACEBAC63B22881B2ACF");
const requiredSource = [
  ["apps/studio-web/src/aivora/StoryPages.tsx", "34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60"],
  ["apps/studio-web/src/aivora/model.tsx", "0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211"],
  ["apps/studio-web/src/api/studio.ts", "7521270E03EF55B649E8B0EA150FE859CB04EADFD7D84C0886FD856FDD378679"],
  ["apps/studio-web/src/aivora/adapters/projectManagement.ts", "7B549DCDBE7A4E3F4051FD815E98B013A07610D995C24BB135EDEBA656F8CD66"],
];
for (const [path, expected] of requiredSource)
  assert.equal(hash(join(repo, path)), expected, `Source SHA drift: ${path}`);
for (const path of [tsc, vite]) assert.ok(existsSync(path), `Missing executable: ${path}`);
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const status = () => git("status", "--porcelain", "-uall").trimEnd().split(/\r?\n/).filter(Boolean);
const statusHash = (lines) => sha(lines.join("\n"));
assert.equal(git("rev-parse", "HEAD").trim(), approval.c19Head);
assert.equal(statusHash(status()), approval.c19StatusSha256);
function relatedProcesses() {
  const query = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*c19-trim-211c9e8-qa-20260923*' -and $_.ProcessId -ne $PID } | Select-Object ProcessId,Name | ConvertTo-Json -Compress";
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", query], { encoding: "utf8" }).trim();
  return raw ? [JSON.parse(raw)].flat() : [];
}
assert.equal(relatedProcesses().length, 0, "Another c19 process is active");
mkdirSync(output);
const receipt = { schema: "qa03.project-name-web-build.v2", state: "PREFLIGHT_PENDING",
  firstRed: null, startedUtc: new Date().toISOString(), approvalSha256: hash(approvalPath),
  output, preflight: {}, steps: {}, postflight: {}, distDiff: null, rawFiles: [] };
const save = () => writeFileSync(join(output, "RECEIPT.json"), JSON.stringify(receipt, null, 2) + "\n");
const capture = (name, args, timeoutMs) => captured({ name, executable: node, args,
  cwd: repo, output, timeoutMs, steps: receipt.steps });
async function fingerprintAt(name) {
  const path = join(output, `${name}.json`);
  const step = await capture(name, [fingerprint, path], 60000);
  assert.equal(step.exitCode, 0, `${name} fingerprint failed`);
  assert.equal(step.timedOut, false, `${name} fingerprint timeout`);
  assert.ok(existsSync(path), `${name} fingerprint missing`);
  step.manifestPath = path;
  step.manifestSha256 = hash(path);
  return JSON.parse(readFileSync(path, "utf8"));
}
let before;
try {
  before = await fingerprintAt("before");
  assert.equal(before.head, approval.c19Head);
  assert.equal(statusHash(before.status), approval.c19StatusSha256);
  assert.equal(before.sourceCount, 113);
  assert.equal(before.distCount, 82);
  assert.equal(canonicalDigest(before.source), approval.sourceFingerprintSha256);
  assert.equal(canonicalDigest(before.dist), approval.distFingerprintSha256);
  receipt.preflight = { head: before.head, statusSha256: statusHash(before.status),
    sourceCount: before.sourceCount, sourceFingerprintSha256: canonicalDigest(before.source),
    distCount: before.distCount, distFingerprintSha256: canonicalDigest(before.dist) };
  receipt.state = "PREFLIGHT_PASS";

  const type = await capture("typecheck", [tsc, "-b", "--pretty", "false"], 600000);
  const afterType = await fingerprintAt("after-typecheck");
  assert.deepEqual(nonDistStatus(afterType.status), nonDistStatus(before.status),
    "Non-dist status drift after typecheck");
  assert.equal(canonicalDigest(afterType.source, { excludeDist: true }),
    canonicalDigest(before.source), "Source drift after typecheck");
  assert.equal(canonicalDigest(afterType.dist), canonicalDigest(before.dist),
    "Dist drift after typecheck");
  assert.equal(type.exitCode, 0, "Web typecheck failed");
  assert.equal(type.timedOut, false, "Web typecheck timeout");

  const build = await capture("build", [vite, "build"], 600000);
  const afterBuild = await fingerprintAt("after-build");
  assert.equal(afterBuild.head, before.head, "HEAD drift after build");
  assert.deepEqual(nonDistStatus(afterBuild.status), nonDistStatus(before.status),
    "Non-dist status drift after build");
  assert.equal(canonicalDigest(afterBuild.source, { excludeDist: true }),
    canonicalDigest(before.source), "Source drift after build");
  const beforeMap = new Map(canonicalRows(before.dist).map((item) => [item.path, item]));
  const afterMap = new Map(canonicalRows(afterBuild.dist).map((item) => [item.path, item]));
  receipt.distDiff = { beforeCount: before.dist.length, afterCount: afterBuild.dist.length,
    added: [...afterMap.keys()].filter((path) => !beforeMap.has(path)),
    removed: [...beforeMap.keys()].filter((path) => !afterMap.has(path)),
    changed: [...afterMap.keys()].filter((path) => beforeMap.has(path) &&
      beforeMap.get(path).sha256 !== afterMap.get(path).sha256),
    beforeSha256: canonicalDigest(before.dist),
    afterSha256: canonicalDigest(afterBuild.dist) };
  assert.equal(build.exitCode, 0, "Web build failed");
  assert.equal(build.timedOut, false, "Web build timeout");
  receipt.state = "WEB_TYPECHECK_BUILD_PASS";
} catch (error) {
  receipt.firstRed = String(error?.stack ?? error);
  receipt.state = "RED";
} finally {
  try {
    receipt.postflight = { head: git("rev-parse", "HEAD").trim(),
      statusSha256: statusHash(status()), relatedProcesses: relatedProcesses() };
    if (receipt.state === "WEB_TYPECHECK_BUILD_PASS" &&
        (receipt.postflight.head !== approval.c19Head ||
         receipt.postflight.relatedProcesses.length !== 0)) {
      receipt.state = "POSTFLIGHT_RED";
      receipt.firstRed = "HEAD or related process changed after build";
    }
  } catch (error) {
    receipt.postflight = { error: String(error?.stack ?? error) };
    if (receipt.state === "WEB_TYPECHECK_BUILD_PASS") {
      receipt.state = "POSTFLIGHT_RED";
      receipt.firstRed = "Postflight unavailable";
    }
  }
  receipt.rawFiles = readdirSync(output, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "RECEIPT.json")
    .map((entry) => { const path = join(output, entry.name);
      return { name: entry.name, bytes: statSync(path).size, sha256: hash(path) }; });
  receipt.finishedUtc = new Date().toISOString();
  save();
}
if (receipt.state !== "WEB_TYPECHECK_BUILD_PASS") process.exitCode = 1;
