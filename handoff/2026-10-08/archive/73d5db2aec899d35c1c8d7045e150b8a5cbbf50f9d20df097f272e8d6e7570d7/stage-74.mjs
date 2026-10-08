import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const control = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const stage = "C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\native-source-qa-20260924\\qa02-packaged-staging-r2-20260929";
const inputPath = "C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260929-packaged-isolated-readonly-plan-1\\INPUTS.json";
const c19 = "C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923";
const qaTsResult = "C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\native-source-qa-20260924\\qa02-c19-ts-postsync-20260929\\run-01\\result.json";
const expectedInputSha = "9B25674215BBC53C0BA9134EAAA5A2462F235083CCD3AF2FB8B1760E323F6A5E";
const expectedStatusSha = "FE92C6E787E71888226D3E3B9E5AE12833080C40194BA2C2A236BF6F7F258AEB";
const expectedQaTsSha = "7CDCA4482B832E25F23F149B4486B694DF40B528E081179173B37AC2639FA411";
const rawPath = path.join(control, "raw.log");
const prePath = path.join(control, "PRE.json");
const postPath = path.join(control, "POST.json");
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
const shaFile = (file) => sha(fs.readFileSync(file));

function log(message) {
  fs.appendFileSync(rawPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function plainPath(file, type) {
  assert.ok(path.isAbsolute(file) && !file.startsWith("\\\\"), `non-local absolute ${type}: ${file}`);
  const normalized = path.resolve(file);
  const real = fs.realpathSync.native(file);
  assert.equal(real.toLowerCase(), normalized.toLowerCase(), `reparse/symlink ${type}: ${file}`);
  const stat = fs.lstatSync(file);
  assert.ok(!stat.isSymbolicLink(), `symlink ${type}: ${file}`);
  assert.ok(type === "file" ? stat.isFile() : stat.isDirectory(), `wrong ${type} type: ${file}`);
  return real;
}

function safeDestination(destination) {
  assert.equal(typeof destination, "string");
  assert.ok(destination.length > 0 && !destination.includes("\\") && !destination.includes(":") &&
    !destination.includes("\0") && !destination.startsWith("/") && !path.win32.isAbsolute(destination),
    `unsafe destination: ${destination}`);
  const segments = destination.split("/");
  assert.ok(segments.every((segment) => segment.length && segment !== "." && segment !== ".." &&
    !/[<>:"|?*]/.test(segment) && !/[. ]$/.test(segment) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)),
    `unsafe destination segment: ${destination}`);
  assert.equal(path.posix.normalize(destination), destination, `destination normalization changed: ${destination}`);
  const target = path.resolve(stage, ...segments);
  const relative = path.relative(stage, target);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `destination escape: ${destination}`);
  return { destination, target, segments };
}

function gitState() {
  const head = execFileSync("git", ["-C", c19, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["-C", c19, "status", "--porcelain=v1", "-uall"], { encoding: "utf8" });
  return { head, statusSha256: sha(status), statusLines: status.trimEnd().split(/\r?\n/).filter(Boolean).length };
}

function versionMetadata(destination, source) {
  if (destination === "app/package.json") {
    const data = JSON.parse(fs.readFileSync(source, "utf8"));
    assert.equal(data.name, "@aijian/desktop");
    assert.equal(data.version, "0.1.0");
    assert.equal(data.type, "commonjs");
    assert.equal(data.main, "dist/main.js");
    return { name: data.name, version: data.version, type: data.type, main: data.main };
  }
  if (destination === "app/node_modules/@aijian/contracts/package.json") {
    const data = JSON.parse(fs.readFileSync(source, "utf8"));
    assert.equal(data.name, "@aijian/contracts");
    assert.equal(data.version, "0.1.0");
    assert.equal(data.type, "commonjs");
    return { name: data.name, version: data.version, type: data.type };
  }
  if (destination === "resources/config/media-toolchain-lock.json") {
    const data = JSON.parse(fs.readFileSync(source, "utf8"));
    assert.equal(data.expected_version, "8.1.2");
    assert.ok(data.profiles.every((item) => item.distribution_status === "DEVELOPMENT_ONLY"));
    return { expectedVersion: data.expected_version, profiles: data.profiles.map((item) => ({
      id: item.profile_id, distributionStatus: item.distribution_status, license: item.spdx_license,
    })) };
  }
  return undefined;
}

function inputInventory(requireStageAbsent) {
  assert.equal(shaFile(inputPath), expectedInputSha, "INPUTS.json hash drift");
  const manifest = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  assert.equal(manifest.schema, "aivora.release.packaged-isolated-readonly-input-plan.v1");
  assert.equal(manifest.inputs.length, 74);
  assert.equal(manifest.total_bytes, 56540415);
  assert.equal(manifest.c19_root.toLowerCase(), c19.toLowerCase());
  assert.equal(manifest.c19_head, "211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2");
  assert.equal(manifest.c19_status_sha256, expectedStatusSha);
  assert.equal(manifest.qa_c19_ts_result_sha256, expectedQaTsSha);
  assert.equal(shaFile(qaTsResult), expectedQaTsSha, "actual c19 TS result drift");
  const state = gitState();
  assert.equal(state.head, manifest.c19_head);
  assert.equal(state.statusSha256, expectedStatusSha);
  assert.equal(state.statusLines, 114);
  plainPath(path.dirname(stage), "directory");
  if (requireStageAbsent) assert.equal(fs.existsSync(stage), false, "staging destination already exists");
  const seen = new Set();
  const roles = {};
  let totalBytes = 0;
  const rows = [];
  for (const item of manifest.inputs) {
    const { destination, target } = safeDestination(item.destination);
    const key = destination.toLowerCase();
    assert.ok(!seen.has(key), `duplicate Windows destination: ${destination}`);
    seen.add(key);
    const real = plainPath(item.source_path, "file");
    const stat = fs.statSync(item.source_path);
    assert.equal(stat.size, item.bytes, `source byte length mismatch: ${item.source_path}`);
    const actualSha = shaFile(item.source_path);
    assert.equal(actualSha, item.sha256, `source SHA mismatch: ${item.source_path}`);
    totalBytes += stat.size;
    roles[item.role] = (roles[item.role] ?? 0) + 1;
    rows.push({ role: item.role, sourcePath: item.source_path, sourceRealPath: real,
      sourceSha256: actualSha, bytes: stat.size, destination, target,
      version: versionMetadata(destination, item.source_path) ?? null });
  }
  assert.equal(totalBytes, manifest.total_bytes);
  assert.deepEqual(roles, {
    "desktop-runtime-js": 39, "contracts-cjs-seven": 7, "renderer-existing-dist": 25,
    "app-runtime-package": 1, "media-toolchain-lock-development-only": 1, "sidecar-r2-exe": 1,
  });
  return { manifest, state, roles, totalBytes, rows };
}

function stageFiles(pre) {
  assert.equal(fs.existsSync(stage), false, "staging destination already exists");
  fs.mkdirSync(stage, { recursive: false });
  plainPath(stage, "directory");
  let copied = 0;
  for (const row of pre.rows) {
    const safe = safeDestination(row.destination);
    assert.equal(safe.target.toLowerCase(), row.target.toLowerCase());
    fs.mkdirSync(path.dirname(safe.target), { recursive: true });
    plainPath(path.dirname(safe.target), "directory");
    fs.copyFileSync(row.sourcePath, safe.target, fs.constants.COPYFILE_EXCL);
    copied += 1;
    assert.equal(fs.statSync(safe.target).size, row.bytes, `copied bytes mismatch: ${row.destination}`);
    assert.equal(shaFile(safe.target), row.sourceSha256, `copied SHA mismatch: ${row.destination}`);
    log(`COPIED ${copied}/74 ${row.destination} ${row.sourceSha256} ${row.bytes}`);
  }
  return copied;
}

function stageInventory(pre) {
  plainPath(stage, "directory");
  const found = [];
  const directories = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full);
      assert.ok(!stat.isSymbolicLink(), `stage symlink: ${full}`);
      if (entry.isDirectory()) {
        directories.push(path.relative(stage, full).replaceAll("\\", "/"));
        visit(full);
      } else {
        assert.ok(entry.isFile(), `stage non-file: ${full}`);
        found.push({ destination: path.relative(stage, full).replaceAll("\\", "/"),
          target: full, sha256: shaFile(full), bytes: stat.size });
      }
    }
  };
  visit(stage);
  found.sort((a, b) => a.destination.localeCompare(b.destination));
  directories.sort();
  assert.equal(found.length, 74, "stage file count mismatch");
  const expected = new Map(pre.rows.map((row) => [row.destination.toLowerCase(), row]));
  for (const file of found) {
    const row = expected.get(file.destination.toLowerCase());
    assert.ok(row, `extra staged file: ${file.destination}`);
    assert.equal(file.destination, row.destination, `destination case drift: ${file.destination}`);
    assert.equal(file.sha256, row.sourceSha256, `staged SHA mismatch: ${file.destination}`);
    assert.equal(file.bytes, row.bytes, `staged bytes mismatch: ${file.destination}`);
    assert.equal(file.target.toLowerCase(), row.target.toLowerCase(), `staged path mismatch: ${file.destination}`);
  }
  const requiredDirectories = new Set();
  for (const row of pre.rows) {
    let parent = path.posix.dirname(row.destination);
    while (parent !== ".") {
      requiredDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  for (const directory of requiredDirectories) plainPath(path.join(stage, ...directory.split("/")), "directory");
  assert.deepEqual(directories, [...requiredDirectories].sort(), "extra or missing stage directory");
  assert.equal(found.reduce((sum, item) => sum + item.bytes, 0), 56540415);
  return { files: found, directories };
}

function failure(error, phase) {
  const entry = { phase, at: new Date().toISOString(), name: error?.name,
    message: error?.message ?? String(error), code: error?.code, stack: error?.stack,
    control, stage, process: { pid: process.pid, execPath: process.execPath, stagedExecutableLaunchCount: 0 } };
  fs.writeFileSync(path.join(control, "RED.json"), JSON.stringify(entry, null, 2));
  log(`RED ${phase} ${entry.name} ${entry.message}`);
  console.error(JSON.stringify({ result: "RED_STOPPED", phase, message: entry.message }));
  process.exitCode = 1;
}

const mode = process.argv[2];
if (mode === "--preflight") {
  try {
    assert.equal(fs.existsSync(prePath), false, "PRE already exists");
    assert.equal(fs.existsSync(postPath), false, "POST already exists");
    const inventory = inputInventory(true);
    const pre = { schema: "qa02.packaged-source-assembly-pre.v1", state: "QA_ISOLATED_SOURCE_ASSEMBLY_PREPARED",
      at: new Date().toISOString(), inputPath, inputSha256: expectedInputSha, scriptSha256: shaFile(scriptPath), control, stage,
      process: { pid: process.pid, execPath: process.execPath, stagedExecutableLaunchCount: 0 },
      c19: inventory.state, roles: inventory.roles, totalBytes: inventory.totalBytes, rows: inventory.rows };
    fs.writeFileSync(prePath, JSON.stringify(pre, null, 2));
    log(`PRE PASS 74/74 ${inventory.totalBytes} stage_absent=true`);
    console.log(JSON.stringify({ result: "PRE_PASS", prePath, preSha256: shaFile(prePath), count: pre.rows.length,
      bytes: pre.totalBytes, stageExists: fs.existsSync(stage) }));
  } catch (error) { failure(error, "PRE"); }
} else if (mode === "--assemble") {
  try {
    const expectedPreSha = process.argv.find((value) => value.startsWith("--pre-sha="))?.slice("--pre-sha=".length);
    assert.ok(expectedPreSha && /^[A-F0-9]{64}$/.test(expectedPreSha), "missing exact PRE SHA");
    assert.equal(shaFile(prePath), expectedPreSha, "PRE hash drift");
    assert.equal(fs.existsSync(postPath), false, "POST already exists");
    assert.equal(fs.existsSync(path.join(control, "RED.json")), false, "prior RED exists; no retry");
    const frozenPre = JSON.parse(fs.readFileSync(prePath, "utf8"));
    assert.equal(shaFile(scriptPath), frozenPre.scriptSha256, "assembly script drift after PRE");
    const inventory = inputInventory(true);
    assert.deepEqual(inventory.rows, frozenPre.rows, "source/destination inventory drift after PRE");
    assert.deepEqual(inventory.state, frozenPre.c19, "c19 status drift after PRE");
    log(`ASSEMBLY START 74/74 ${inventory.totalBytes}`);
    const copied = stageFiles(inventory);
    const staged = stageInventory(inventory);
    const afterInput = inputInventory(false);
    assert.deepEqual(afterInput.rows, frozenPre.rows, "source inventory drift after copy");
    assert.deepEqual(afterInput.state, frozenPre.c19, "c19 status drift after copy");
    const post = { schema: "qa02.packaged-source-assembly-post.v1", state: "QA_ISOLATED_SOURCE_ASSEMBLY",
      at: new Date().toISOString(), inputSha256: expectedInputSha, scriptSha256: frozenPre.scriptSha256, preSha256: expectedPreSha,
      control, stage, process: { pid: process.pid, execPath: process.execPath, stagedExecutableLaunchCount: 0 },
      c19Before: frozenPre.c19, c19After: afterInput.state, copied,
      roles: inventory.roles, totalBytes: inventory.totalBytes, directories: staged.directories, files: staged.files };
    fs.writeFileSync(postPath, JSON.stringify(post, null, 2));
    log(`POST PASS ${copied}/74 ${inventory.totalBytes} no_extra_files=true`);
    console.log(JSON.stringify({ result: post.state, postPath, postSha256: shaFile(postPath), copied,
      bytes: post.totalBytes, directories: post.directories.length }));
  } catch (error) { failure(error, "ASSEMBLY"); }
} else {
  failure(new Error("Use --preflight or --assemble with --pre-sha"), "INVOCATION");
}
