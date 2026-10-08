/* Separate persistence gate. Template approval is deliberately unusable. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { canonicalDigest } from "./canonical-fingerprint.mjs";
import { sourceSnapshot } from "./source-snapshot.mjs";

const qaRoot = dirname(import.meta.filename);
const repo = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf("=");
  assert.ok(arg.startsWith("--") && at > 2, `Invalid argument: ${arg}`);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
for (const key of ["approval", "approval-sha256", "output"]) assert.ok(options[key], `Missing ${key}`);
const approvalPath = resolve(options.approval);
assert.notEqual(approvalPath.toLowerCase(),
  join(qaRoot, "RUN-APPROVAL.template.json").toLowerCase(), "Template is not approved");
const output = resolve(options.output);
const relationship = relative(qaRoot, output);
assert.ok(relationship && !relationship.startsWith("..") && !isAbsolute(relationship),
  "Output must be a new directory under the external QA03 packet");
assert.ok(!existsSync(output), "One-shot output already exists");
const sha = (data) => createHash("sha256").update(data).digest("hex").toUpperCase();
const hash = (path) => sha(readFileSync(path));
assert.equal(hash(approvalPath), options["approval-sha256"].toUpperCase(), "Approval SHA drift");
const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
assert.equal(approval.schema, "qa03.project-name-sidecar.cas-overlay.one-shot.approval.v5");
assert.equal(approval.state, "APPROVED_SINGLE_RUN");
assert.equal(approval.runId, "qa03-source-name-sidecar-03");
assert.equal(resolve(approval.outputDir), output);
assert.equal(hash(join(qaRoot, "PACKET.json")), approval.packetSha256, "Packet SHA drift");
assert.equal(approval.repoHead, "211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2");
assert.equal(hash(import.meta.filename), approval.runnerSha256, "Runner SHA drift");
assert.equal(hash(join(qaRoot, "canonical-fingerprint.mjs")), approval.canonicalSha256,
  "Canonical helper SHA drift");
assert.equal(hash(join(qaRoot, "source-snapshot.mjs")), approval.sourceSnapshotSha256,
  "Source snapshot helper SHA drift");
assert.equal(hash(approval.componentReceiptPath), approval.componentReceiptSha256,
  "Component receipt SHA drift");
assert.equal(approval.componentReceiptSha256,
  "A731DFE6E90B46BCD631CC097720CC12DE99A1E9F6D7A5420674CC84A78A9582");
const component = JSON.parse(readFileSync(approval.componentReceiptPath, "utf8"));
assert.equal(component.state, "TARGETED_LOCAL_COMPONENT_PASS",
  "Component gate must be accepted first");
assert.equal(hash(approval.webBuildReceiptPath), approval.webBuildReceiptSha256,
  "Web build receipt SHA drift");
assert.equal(resolve(approval.webBuildReceiptPath),
  resolve(qaRoot, "../web-gate-v3/web-03/RECEIPT.json"), "Web receipt path mismatch");
const webBuild = JSON.parse(readFileSync(approval.webBuildReceiptPath, "utf8"));
assert.equal(webBuild.state, "WEB_TYPECHECK_BUILD_PASS",
  "Web gate must be accepted first");
const python = join(repo, ".venv", "Scripts", "python.exe");
assert.equal(hash(python), approval.pythonSha256, "Python binary SHA drift");
assert.equal(hash(join(qaRoot, "probe-01/PROBE.json")), approval.probeReceiptSha256,
  "Venv launcher probe SHA drift");
assert.equal(approval.probeReceiptSha256,
  "380E996C21180E150222BD957755C6205B07E861EF476EEC22D1D0E5251B5169");
assert.equal(hash(approval.actualPythonPath), approval.actualPythonSha256,
  "Underlying Python binary SHA drift");
const required = [
  "services/api/src/aijian_api/sidecar.py",
  "services/api/src/aijian_api/main.py",
  "services/api/src/aijian_api/repository.py",
  "services/api/src/aijian_api/project_management_routes.py",
  "services/api/src/aijian_api/project_management.py",
  "services/api/src/aijian_api/project_management_contracts.py",
];
assert.deepEqual(approval.sourceFiles?.map((item) => item.path), required);
for (const item of approval.sourceFiles) {
  assert.match(item.sha256 ?? "", /^[0-9a-f]{64}$/i);
  assert.equal(hash(join(repo, item.path)), item.sha256.toUpperCase(), `Source SHA drift: ${item.path}`);
}
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const statusLines = () => git("status", "--porcelain", "-uall").trimEnd().split(/\r?\n/)
  .filter(Boolean);
const statusSha = () => sha(statusLines().join("\n"));
assert.equal(git("rev-parse", "HEAD").trim(), approval.repoHead, "HEAD drift");
assert.equal(statusSha(), approval.repoStatusSha256, "Status drift");
const beforeSource = sourceSnapshot(repo, statusLines());
assert.equal(beforeSource.length, approval.sourceCount, "Source count drift");
assert.equal(canonicalDigest(beforeSource), approval.sourceFingerprintSha256,
  "Source fingerprint drift");
mkdirSync(output);
writeFileSync(join(output, "source-before.json"), JSON.stringify(beforeSource, null, 2) + "\n");
const profile = join(output, "profile");
for (const child of ["workspace", "appdata", "localappdata", "home", "temp"])
  mkdirSync(join(profile, child), { recursive: true });
const env = {};
for (const key of ["PATH", "SYSTEMROOT", "WINDIR", "LANG", "LC_ALL"])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  APPDATA: join(profile, "appdata"), LOCALAPPDATA: join(profile, "localappdata"),
  HOME: join(profile, "home"), USERPROFILE: profile,
  TEMP: join(profile, "temp"), TMP: join(profile, "temp"),
  AIJIAN_DATA_DIR: join(profile, "workspace"),
  PYTHONPATH: join(repo, "services", "api", "src"),
  PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1",
});
const receipt = {
  schema: "qa03.project-name-sidecar-reopen.v2", state: "RUNNING", firstRed: null,
  runId: approval.runId, startedUtc: new Date().toISOString(),
  approvalSha256: hash(approvalPath), output, profile, launches: [], requests: [],
  patchCount: 0, error: null,
};
const save = () => writeFileSync(join(output, "RECEIPT.json"), JSON.stringify(receipt, null, 2) + "\n");
const raw = (name, data) => {
  const path = join(output, name);
  writeFileSync(path, data);
  return { path, bytes: statSync(path).size, sha256: hash(path) };
};
function processRecords(ids) {
  const condition = ids.map((pid) => `ProcessId = ${pid}`).join(" OR ");
  const script = `Get-CimInstance Win32_Process -Filter '${condition}' | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress`;
  const text = execFileSync("powershell.exe", ["-NoProfile", "-Command", script],
    { encoding: "utf8", timeout: 10000 }).trim();
  return text ? [JSON.parse(text)].flat() : [];
}
async function waitBothGone(ids) {
  let remaining = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    remaining = processRecords(ids);
    if (remaining.length === 0) return [];
    await new Promise((done) => setTimeout(done, 100));
  }
  return remaining;
}

async function launch(number) {
  const child = spawn(python, ["-m", "aijian_api.sidecar"], {
    cwd: repo, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const stdoutPath = join(output, `launch${number}.stdout.raw`);
  const stderrPath = join(output, `launch${number}.stderr.raw`);
  const stdout = createWriteStream(stdoutPath, { flags: "wx" });
  const stderr = createWriteStream(stderrPath, { flags: "wx" });
  const exit = new Promise((done) => child.once("close", (code, signal) => done({ code, signal })));
  let buffer = Buffer.alloc(0);
  let settle;
  let reject;
  const ready = new Promise((yes, no) => { settle = yes; reject = no; });
  let seen = false;
  const timer = setTimeout(() => reject(new Error(`Launch ${number} handshake timeout`)), 20000);
  child.stdout.on("data", (chunk) => {
    stdout.write(chunk);
    if (seen) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 65536) { seen = true; reject(new Error("Oversized handshake")); return; }
    const end = buffer.indexOf(10);
    if (end < 0) return;
    seen = true;
    try {
      const value = JSON.parse(buffer.subarray(0, end).toString("utf8"));
      assert.equal(value.event, "ready");
      assert.equal(value.host, "127.0.0.1");
      assert.ok(Number.isSafeInteger(value.pid) && value.pid > 0);
      item.sidecarPid = value.pid;
      const lineage = processRecords([child.pid, value.pid]);
      const launcher = lineage.find((record) => record.ProcessId === child.pid);
      const actual = lineage.find((record) => record.ProcessId === value.pid);
      assert.ok(launcher && actual, "Launcher or actual sidecar process absent at handshake");
      assert.notEqual(value.pid, child.pid, "Expected venv redirector and actual interpreter");
      assert.equal(actual.ParentProcessId, child.pid,
        "Actual sidecar is not a child of the venv redirector");
      assert.equal(resolve(launcher.ExecutablePath).toLowerCase(), resolve(python).toLowerCase(),
        "Launcher executable path mismatch");
      assert.equal(resolve(actual.ExecutablePath).toLowerCase(),
        resolve(approval.actualPythonPath).toLowerCase(), "Actual interpreter path mismatch");
      item.sidecarParentPid = actual.ParentProcessId;
      item.sidecarExecutablePath = actual.ExecutablePath;
      item.lineage = lineage;
      assert.match(value.token, /^[^\s]{43,}$/);
      settle(value);
    } catch (error) { reject(error); }
  });
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.once("error", reject);
  child.once("close", () => { if (!seen) reject(new Error("Exited before handshake")); });
  const item = { number, launcherPid: child.pid ?? null, sidecarPid: null,
    sidecarParentPid: null, sidecarExecutablePath: null, lineage: null,
    stdoutPath, stderrPath,
    exit: null, timeout: false, cleanup: "NOT_REQUIRED" };
  receipt.launches.push(item);
  let handshake;
  try {
    handshake = await ready;
  } catch (error) {
    try { child.stdin.end(); } catch { /* child may already have exited */ }
    const stopped = await Promise.race([exit, new Promise((done) => setTimeout(() => done(null), 5000))]);
    if (!stopped) {
      child.kill();
      item.cleanup = "KILL_LAUNCHER_REQUESTED";
      item.exit = await Promise.race([exit, new Promise((done) => setTimeout(done(null), 5000))]);
    } else {
      item.exit = stopped;
    }
    await Promise.all([new Promise((done) => stdout.end(done)),
      new Promise((done) => stderr.end(done))]);
    if (item.sidecarPid) item.afterCloseProcesses =
      await waitBothGone([item.launcherPid, item.sidecarPid]);
    item.stdout = { bytes: statSync(stdoutPath).size, sha256: hash(stdoutPath) };
    item.stderr = { bytes: statSync(stderrPath).size, sha256: hash(stderrPath) };
    throw error;
  } finally { clearTimeout(timer); }
  item.port = handshake.port;
  item.tokenLength = handshake.token.length;
  async function close() {
    child.stdin.end();
    const grace = new Promise((done) => setTimeout(() => done(null), 10000));
    let result = await Promise.race([exit, grace]);
    if (!result) {
      item.timeout = true;
      item.cleanup = "KILL_REQUESTED";
      child.kill();
      result = await Promise.race([exit, new Promise((done) => setTimeout(() => done(null), 5000))]);
    }
    item.exit = result;
    await Promise.all([new Promise((done) => stdout.end(done)),
      new Promise((done) => stderr.end(done))]);
    item.stdout = { bytes: statSync(stdoutPath).size, sha256: hash(stdoutPath) };
    item.stderr = { bytes: statSync(stderrPath).size, sha256: hash(stderrPath) };
    item.afterCloseProcesses = await waitBothGone([item.launcherPid, item.sidecarPid]);
    item.bothGone = item.afterCloseProcesses.length === 0;
    assert.ok(result && result.code === 0 && !item.timeout,
      `Launch ${number} did not close normally`);
    assert.equal(item.bothGone, true, `Launch ${number} left a launcher or sidecar process`);
  }
  return { child, handshake, close };
}

async function request(session, label, method, path, body, ifMatch) {
  const headers = { Authorization: `Bearer ${session.handshake.token}`,
    Origin: "app://aijian", Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (ifMatch) headers["If-Match"] = ifMatch;
  const requestRaw = raw(`${label}.request.json`, JSON.stringify({ method, path, body,
    ifMatch: ifMatch ?? null }) + "\n");
  const url = `http://127.0.0.1:${session.handshake.port}${path}`;
  const response = await fetch(url, { method, headers,
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const responseRaw = raw(`${label}.response.raw`, bytes);
  const result = { label, method, path, status: response.status,
    etag: response.headers.get("etag"), requestRaw, responseRaw };
  receipt.requests.push(result);
  if (method === "PATCH") receipt.patchCount += 1;
  return { status: response.status, etag: result.etag, data: JSON.parse(bytes.toString("utf8")) };
}

let first;
let second;
try {
  first = await launch(1);
  const created = await request(first, "create", "POST", "/api/v1/projects",
    { name: "QA03 项目旧名", aspect_ratio: "9:16",
      target_duration_seconds: 90, source_language: "zh-CN" });
  assert.equal(created.status, 201);
  const projectId = created.data.data.id;
  assert.match(projectId, /^prj_[0-9a-f]{32}$/);
  const revision = created.data.data.revision;
  assert.ok(Number.isSafeInteger(revision) && revision > 0);
  const renamed = await request(first, "rename", "PATCH", `/api/v1/projects/${projectId}`,
    { name: "QA03 项目新名" }, `"revision-${revision}"`);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.data.id, projectId);
  assert.equal(renamed.data.data.name, "QA03 项目新名");
  assert.equal(renamed.data.data.revision, revision + 1);
  assert.equal(renamed.etag, `"revision-${revision + 1}"`);
  const confirmed = await request(first, "confirm", "GET", `/api/v1/projects/${projectId}`);
  assert.equal(confirmed.status, 200);
  assert.deepEqual(confirmed.data.data, renamed.data.data);
  await first.close();
  first = null;
  const database = join(profile, "workspace", "workspace.sqlite3");
  assert.ok(existsSync(database), "Isolated workspace DB was not created");
  receipt.databaseAfterClose1 = { path: database, bytes: statSync(database).size,
    sha256: hash(database) };

  second = await launch(2);
  assert.notEqual(second.child.pid, receipt.launches[0].launcherPid,
    "Second venv launcher must have a new PID");
  assert.notEqual(second.handshake.pid, receipt.launches[0].sidecarPid,
    "Second actual sidecar must have a new PID");
  const listed = await request(second, "reopen-list", "GET", "/api/v1/projects");
  assert.equal(listed.status, 200);
  assert.equal(listed.data.data.filter((item) => item.id === projectId).length, 1);
  const reopened = await request(second, "reopen-get", "GET", `/api/v1/projects/${projectId}`);
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.data.id, projectId);
  assert.equal(reopened.data.data.name, "QA03 项目新名");
  assert.equal(reopened.data.data.revision, revision + 1);
  assert.equal(receipt.patchCount, 1);
  await second.close();
  second = null;
  receipt.databaseAfterClose2 = { path: database, bytes: statSync(database).size,
    sha256: hash(database) };
  receipt.projectId = projectId;
  receipt.savedRevision = revision + 1;
  assert.equal(statusSha(), approval.repoStatusSha256, "Source status drift");
  const afterSource = sourceSnapshot(repo, statusLines());
  writeFileSync(join(output, "source-after.json"), JSON.stringify(afterSource, null, 2) + "\n");
  assert.deepEqual(afterSource, beforeSource, "Source rows drift");
  assert.equal(canonicalDigest(afterSource), approval.sourceFingerprintSha256,
    "Source fingerprint drift");
  receipt.state = "SIDECAR_NEW_PROCESS_REOPEN_PASS";
} catch (error) {
  receipt.state = "RED";
  receipt.firstRed = String(error?.stack ?? error);
  receipt.error = receipt.firstRed;
} finally {
  for (const session of [first, second]) {
    if (session) {
      try { await session.close(); } catch (error) {
        receipt.error = [receipt.error, String(error?.stack ?? error)].filter(Boolean).join("\n");
      }
    }
  }
  receipt.finishedUtc = new Date().toISOString();
  receipt.profileDatabasePath = join(profile, "workspace", "workspace.sqlite3");
  receipt.profileDatabaseExists = existsSync(receipt.profileDatabasePath);
  receipt.rawFiles = readdirSync(output, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "RECEIPT.json")
    .map((entry) => { const path = join(output, entry.name);
      return { name: entry.name, bytes: statSync(path).size, sha256: hash(path) }; });
  save();
}
if (receipt.state !== "SIDECAR_NEW_PROCESS_REOPEN_PASS") process.exitCode = 1;
