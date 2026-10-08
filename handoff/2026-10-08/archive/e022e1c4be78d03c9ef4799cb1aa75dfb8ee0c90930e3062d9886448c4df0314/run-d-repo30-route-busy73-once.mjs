import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const qaRoot = dirname(fileURLToPath(import.meta.url));
const wrapper = fileURLToPath(import.meta.url);
const bundle = "C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260928-d-repo30-qa-closure-152-1";
const filesManifest = join(bundle, "FILES.json");
const handoff = join(bundle, "QA-HANDOFF.json");
const preflight = join(bundle, "ENV-PREFLIGHT.json");
const seed = join(qaRoot, "d-repo30-import-replay-01", "after-action.sqlite3");
const approvalFile = join(qaRoot, "D-REPO30-ROUTE-BUSY73-ONE-SHOT-APPROVAL.json");
const requestFile = join(qaRoot, "D-REPO30-ROUTE-BUSY73-APPROVAL-REQUEST.json");
const out = join(qaRoot, "d-repo30-route-busy73-01");
const profile = join(out, "profile");
const db = join(profile, "workspace.sqlite3");
const python = "C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923\\.venv\\Scripts\\python.exe";
const expected = {
  files: "F3775529D3D431D5D914F80FB74552CD23B96402142808970963D75C296160E9",
  handoff: "56658FE0A3178200A07F7FB770A9AA86812FCBA19F0E5BED016A2410DE4C6700",
  preflight: "C8705CD68B05E056D302BB718F5C49F2345C24761743FC35588A7677A730979E",
  seed: "B72493AA3016C9E74283674DABE600DF812D7F8B99FF4A0EB176309ED6E64170",
  python: "461D6E5F9A0DCB724798D2B6DBD57555A9EB3084522CC5DC5B2347934F5A4060",
  node: "3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5",
};
const sha = (data) => createHash("sha256").update(data).digest("hex").toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const projectId = "prj_" + "a".repeat(32);
const episodeId = "ep_" + projectId;
const oldOperationId = "peop_" + "b".repeat(32);
const request = {
  assembly: {
    artifact_id: "art_" + "a".repeat(32),
    content_hash: "sha256:be55f56229462db7e8808296934423143e833a9e91968049a5badb4407073ca6",
    head_revision: 1, version_id: "ver_" + "a".repeat(32),
  },
  media_rights: [], operation_id: oldOperationId,
  output_relative_path: "qa-old.mp4",
  spec: { audio_codec: "AAC", container: "MP4", frame_rate_den: 1,
    frame_rate_num: 25, height: 1080, video_codec: "H264", width: 1920 },
};
const operationPath = `/api/v1/projects/${projectId}/product-exports/${oldOperationId}`;
const submitPath = `/api/v1/projects/${projectId}/episodes/${episodeId}/product-exports`;

// No filesystem or product process mutation occurs before exact approval.
assert.equal(fileSha(filesManifest), expected.files);
assert.equal(fileSha(handoff), expected.handoff);
assert.equal(fileSha(preflight), expected.preflight);
assert.equal(fileSha(seed), expected.seed);
assert.equal(fileSha(python), expected.python);
assert.equal(fileSha(process.execPath), expected.node);
assert.equal(existsSync(out), false, "fresh output directory required");
assert.equal(existsSync(approvalFile), true, "MGR02 approval absent");
const approval = JSON.parse(readFileSync(approvalFile, "utf8"));
assert.equal(approval.mode, "QA01_D_REPO30_ROUTE_BUSY73_ONE_SHOT");
assert.equal(approval.status, "APPROVED");
assert.equal(approval.approved_by, "MGR02");
assert.equal(approval.request_sha256, fileSha(requestFile));
assert.equal(approval.wrapper_sha256, fileSha(wrapper));
assert.equal(approval.files_sha256, expected.files);
assert.equal(approval.seed_sha256, expected.seed);
assert.equal(resolve(approval.output_path), resolve(out));
const sourceFiles = JSON.parse(readFileSync(filesManifest, "utf8")).files;
assert.equal(sourceFiles.length, 152);
for (const item of sourceFiles) {
  assert.match(item.name, /^aijian_api\/[a-zA-Z0-9_]+\.py$/);
  const path = join(bundle, item.name);
  assert.equal(lstatSync(path).isSymbolicLink(), false, `source link ${item.name}`);
  assert.equal(fileSha(path), item.sha256, `source drift ${item.name}`);
}

const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
assert.ok(systemRoot, "Windows SystemRoot unavailable");
mkdirSync(join(profile, "tmp"), { recursive: true });
mkdirSync(join(profile, "AppData", "Roaming"), { recursive: true });
mkdirSync(join(profile, "AppData", "Local"), { recursive: true });
copyFileSync(seed, db);
assert.equal(fileSha(db), expected.seed);
const env = {
  SystemRoot: systemRoot, WINDIR: systemRoot,
  PATH: [dirname(python), join(systemRoot, "System32"), systemRoot].join(";"),
  TEMP: join(profile, "tmp"), TMP: join(profile, "tmp"),
  APPDATA: join(profile, "AppData", "Roaming"),
  LOCALAPPDATA: join(profile, "AppData", "Local"),
  USERPROFILE: profile, HOME: profile,
  AIJIAN_DATA_DIR: profile, AIJIAN_RESOURCE_ROOT: join(profile, "resources"),
  AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME: "0",
  PYTHONPATH: bundle, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1",
  PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1",
};
const processes = [];
const phases = [];
const responses = [];
const checks = [];
let firstRed = null;
const note = (name, data = {}) => phases.push({ name, at: new Date().toISOString(), ...data });

function launch(name) {
  const child = spawn(python, ["-B", "-m", "aijian_api.sidecar"], {
    cwd: out, env, shell: false, windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const item = { name, child, stdout: [], stderr: [], handshake: null, error: null, exit: null };
  child.stdout.on("data", (chunk) => item.stdout.push(chunk));
  child.stderr.on("data", (chunk) => item.stderr.push(chunk));
  child.on("error", (error) => { item.error = { code: error.code ?? null, message: error.message }; });
  item.closed = new Promise((done) => child.once("close", (code, signal) => {
    item.exit = { code, signal }; done(item.exit);
  }));
  processes.push(item);
  note(`${name}_spawn`, { launcher_pid: child.pid ?? null });
  return item;
}

async function handshake(item, timeoutMs = 10000) {
  let timer;
  const line = await Promise.race([
    new Promise((done, fail) => {
      let buffer = Buffer.alloc(0);
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const newline = buffer.indexOf(10);
        if (buffer.length > 4096) { cleanup(); fail(new Error(`${item.name} handshake too long`)); }
        else if (newline >= 0) { cleanup(); done(buffer.subarray(0, newline).toString("utf8")); }
      };
      const onClose = () => { cleanup(); fail(new Error(`${item.name} closed before handshake`)); };
      const cleanup = () => { item.child.stdout.off("data", onData); item.child.off("close", onClose); };
      item.child.stdout.on("data", onData);
      item.child.once("close", onClose);
    }),
    new Promise((_done, fail) => { timer = setTimeout(() => fail(new Error(`${item.name} handshake timeout`)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
  const parsed = JSON.parse(line);
  assert.deepEqual(Object.keys(parsed).sort(), ["event", "host", "pid", "port", "protocol_version", "token"]);
  assert.equal(parsed.event, "ready"); assert.equal(parsed.host, "127.0.0.1");
  assert.equal(parsed.protocol_version, 1); assert.ok(Number.isInteger(parsed.pid) && parsed.pid > 0);
  assert.ok(Number.isInteger(parsed.port) && parsed.port > 0 && parsed.port <= 65535);
  assert.match(parsed.token, /^[A-Za-z0-9_-]{43,256}$/);
  item.handshake = parsed;
  note(`${item.name}_ready`, { launcher_pid: item.child.pid, python_pid: parsed.pid,
    port: parsed.port, token_sha256: sha(Buffer.from(parsed.token)) });
  return parsed;
}

async function boundedClose(item, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      item.closed,
      new Promise((_done, fail) => { timer = setTimeout(() => fail(new Error(`${item.name} close timeout`)), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

function taskkill(pid, label) {
  if (!pid) return null;
  const result = spawnSync(join(systemRoot, "System32", "taskkill.exe"),
    ["/PID", String(pid), "/T", "/F"],
    { shell: false, windowsHide: true, timeout: 10000, encoding: null });
  const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
  writeFileSync(join(out, `${label}-taskkill-stdout.raw`), stdout);
  writeFileSync(join(out, `${label}-taskkill-stderr.raw`), stderr);
  return { pid, status: result.status, error: result.error?.message ?? null,
    stdout_sha256: sha(stdout), stderr_sha256: sha(stderr) };
}

function pidPresent(pid, label) {
  const result = spawnSync(join(systemRoot, "System32", "tasklist.exe"),
    ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
    { shell: false, windowsHide: true, timeout: 10000, encoding: null });
  const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
  writeFileSync(join(out, `${label}-tasklist-stdout.raw`), stdout);
  writeFileSync(join(out, `${label}-tasklist-stderr.raw`), stderr);
  assert.equal(result.status, 0, `${label} tasklist failed`);
  return { present: stdout.toString("utf8").includes(`"${pid}"`),
    stdout_sha256: sha(stdout), stderr_sha256: sha(stderr) };
}

async function waitPidGone(pid, label) {
  let observed;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    observed = pidPresent(pid, `${label}-${attempt}`);
    if (!observed.present) return observed;
    await pause(250);
  }
  return observed;
}

async function httpCall(name, session, method, path, body, auth = "valid") {
  const headers = { Host: `127.0.0.1:${session.port}`, Origin: auth === "wrong_origin" ? "app://wrong" : "app://aijian" };
  if (auth !== "none") headers.Authorization = `Bearer ${session.token}`;
  const payload = body === null ? null : Buffer.from(JSON.stringify(body));
  if (payload !== null) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = String(payload.length); }
  if (payload !== null) writeFileSync(join(out, `${name}-request-body.raw`), payload);
  const requestMetadata = {
    name, method, path, host: headers.Host, origin: headers.Origin,
    authorization_present: auth !== "none",
    authorization_token_sha256: auth === "none" ? null : sha(Buffer.from(session.token)),
    content_type: headers["Content-Type"] ?? null,
    body_bytes: payload?.length ?? 0,
    body_sha256: sha(payload ?? Buffer.alloc(0)),
  };
  const requestMetadataBytes = Buffer.from(JSON.stringify(requestMetadata, null, 2) + "\n");
  writeFileSync(join(out, `${name}-request.json`), requestMetadataBytes);
  const response = await new Promise((done, fail) => {
    const req = http.request({ hostname: "127.0.0.1", port: session.port, path, method, headers }, (res) => {
      const chunks = []; let size = 0;
      res.on("data", (chunk) => { size += chunk.length; if (size > 1024 * 1024) req.destroy(new Error("HTTP body too large")); else chunks.push(chunk); });
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", fail);
    });
    req.setTimeout(3000, () => req.destroy(new Error(`${name} HTTP timeout`)));
    req.on("error", fail);
    req.end(payload ?? undefined);
  });
  const pathRaw = join(out, `${name}-response.raw`);
  writeFileSync(pathRaw, response.body);
  const summary = { name, method, path, status: response.status,
    response_headers: response.headers,
    request_metadata_sha256: sha(requestMetadataBytes),
    request_body_sha256: requestMetadata.body_sha256,
    body_bytes: response.body.length, body_sha256: sha(response.body),
    request_id: response.headers["x-request-id"] ?? null };
  responses.push(summary);
  return { ...summary, json: JSON.parse(response.body.toString("utf8")) };
}

async function waitHealthy(session, label) {
  const started = Date.now(); let attempt = 0;
  while (Date.now() - started < 6000) {
    attempt += 1;
    try {
      const result = await httpCall(`${label}-health-${attempt}`, session, "GET", "/api/v1/health", null);
      assert.equal(result.status, 200, `${label} health status`);
      return result;
    } catch (error) {
      if (!/ECONNREFUSED|ECONNRESET|socket hang up/.test(String(error))) throw error;
      note(`${label}_health_wait`, { attempt, error: String(error) });
      await pause(200);
    }
  }
  throw new Error(`${label} health did not become ready`);
}

function databaseState(label) {
  const current = { label, db_sha256: fileSha(db), wal_sha256: existsSync(`${db}-wal`) ? fileSha(`${db}-wal`) : null };
  checks.push(current); return current;
}

function ledgerCount() {
  const code = "import sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1].replace('\\\\','/')+'?mode=ro',uri=True,timeout=2); print(c.execute('select count(*) from product_export_operations').fetchone()[0]); c.close()";
  const result = spawnSync(python, ["-B", "-c", code, db], {
    cwd: out, env, shell: false, windowsHide: true, timeout: 5000, encoding: null,
  });
  assert.equal(result.status, 0, `ledger read failed: ${(result.stderr ?? Buffer.alloc(0)).toString("utf8")}`);
  return Number((result.stdout ?? Buffer.alloc(0)).toString("utf8").trim());
}

const startedAt = new Date().toISOString();
let A = null, B = null, C = null;
const cleanup = [];
try {
  assert.equal(ledgerCount(), 1, "seed ledger count");
  const initial = databaseState("initial");
  A = launch("A"); const aSession = await handshake(A);
  await waitHealthy(aSession, "A");
  assert.equal(ledgerCount(), 1, "A startup changed ledger");
  const afterStartup = databaseState("after_A_startup");
  const unauth = await httpCall("A-unauth", aSession, "GET", "/api/v1/health", null, "none");
  assert.equal(unauth.status, 401); assert.equal(unauth.json.error.code, "SIDECAR_AUTH_REQUIRED");
  const wrongOrigin = await httpCall("A-wrong-origin", aSession, "GET", "/api/v1/health", null, "wrong_origin");
  assert.equal(wrongOrigin.status, 403); assert.equal(wrongOrigin.json.error.code, "SIDECAR_REQUEST_REJECTED");
  const oldGet = await httpCall("A-old-get", aSession, "GET", operationPath, null);
  assert.equal(oldGet.status, 200); assert.equal(oldGet.json.data.status, "UNKNOWN");
  const oldPost = await httpCall("A-old-post", aSession, "POST", submitPath, request);
  assert.equal(oldPost.status, 200); assert.equal(oldPost.json.data.status, "UNKNOWN");
  const changedPost = await httpCall("A-changed-post", aSession, "POST", submitPath,
    { ...request, output_relative_path: "qa-changed.mp4" });
  assert.equal(changedPost.status, 409); assert.equal(changedPost.json.error.code, "OPERATION_CONFLICT");
  assert.equal(ledgerCount(), 1, "route ledger count");
  const afterRoute = databaseState("after_route");
  assert.equal(afterRoute.db_sha256, afterStartup.db_sha256, "route changed DB main file");
  assert.equal(afterRoute.wal_sha256, afterStartup.wal_sha256, "route changed DB WAL");
  assert.equal(existsSync(join(profile, "exports", "product-video")), false);
  note("route_auth_pass");

  const beforeB = databaseState("before_B");
  B = launch("B");
  const bExit = await boundedClose(B, 7000);
  assert.equal(bExit.code, 73); assert.equal(bExit.signal, null);
  assert.equal(Buffer.concat(B.stdout).length, 0, "B emitted ready or other stdout");
  const bStderr = Buffer.concat(B.stderr).toString("utf8");
  assert.ok(["AIVORA_STARTUP_WORKSPACE_BUSY\n", "AIVORA_STARTUP_WORKSPACE_BUSY\r\n"].includes(bStderr),
    "B stderr is not exactly one terminated Busy73 line");
  const afterB = databaseState("after_B");
  assert.deepEqual(afterB.db_sha256, beforeB.db_sha256);
  assert.deepEqual(afterB.wal_sha256, beforeB.wal_sha256);
  assert.equal(ledgerCount(), 1, "B changed ledger");
  const aAfterB = await httpCall("A-after-B-health", aSession, "GET", "/api/v1/health", null);
  assert.equal(aAfterB.status, 200);
  note("B_busy73_pass", { launcher_pid: B.child.pid, exit: bExit });

  A.child.stdin.end();
  const aExit = await boundedClose(A, 10000);
  assert.equal(aExit.code, 0); assert.equal(aExit.signal, null);
  const aLauncherCheck = await waitPidGone(A.child.pid, "A-launcher-after-close");
  const aPythonCheck = await waitPidGone(aSession.pid, "A-python-after-close");
  assert.equal(aLauncherCheck.present, false); assert.equal(aPythonCheck.present, false);
  note("A_normal_close", { launcher_pid: A.child.pid, python_pid: aSession.pid, exit: aExit });

  C = launch("C"); const cSession = await handshake(C);
  await waitHealthy(cSession, "C");
  C.child.stdin.end();
  const cExit = await boundedClose(C, 10000);
  assert.equal(cExit.code, 0); assert.equal(cExit.signal, null);
  const cLauncherCheck = await waitPidGone(C.child.pid, "C-launcher-after-close");
  const cPythonCheck = await waitPidGone(cSession.pid, "C-python-after-close");
  assert.equal(cLauncherCheck.present, false); assert.equal(cPythonCheck.present, false);
  assert.equal(ledgerCount(), 1, "C changed ledger");
  assert.equal(existsSync(join(profile, "exports", "product-video")), false);
  note("C_reacquire_and_close_pass", { launcher_pid: C.child.pid, python_pid: cSession.pid, exit: cExit });
  for (const item of sourceFiles) assert.equal(fileSha(join(bundle, item.name)), item.sha256);
} catch (error) {
  firstRed = { name: error?.name ?? "Error", message: error?.message ?? String(error), stack: error?.stack ?? null };
  note("FIRST_RED", { message: firstRed.message });
} finally {
  for (const item of [B, C, A]) {
    if (!item || item.exit) continue;
    item.child.stdin.end();
    try { await boundedClose(item, 3000); }
    catch {
      cleanup.push(taskkill(item.child.pid, `${item.name}-launcher-cleanup`));
      if (item.handshake?.pid) cleanup.push(taskkill(item.handshake.pid, `${item.name}-python-cleanup`));
      await Promise.race([item.closed, pause(5000)]);
    }
  }
  for (const item of processes) {
    const stdout = Buffer.concat(item.stdout), stderr = Buffer.concat(item.stderr);
    writeFileSync(join(out, `${item.name}-stdout.raw`), stdout);
    writeFileSync(join(out, `${item.name}-stderr.raw`), stderr);
    item.stdoutEvidence = { bytes: stdout.length, sha256: sha(stdout) };
    item.stderrEvidence = { bytes: stderr.length, sha256: sha(stderr) };
  }
  const receipt = {
    status: firstRed ? "FIRST_RED_STOPPED" : "PASS_ISOLATED_ROUTE_AUTH_DUAL_SIDECAR_ONLY",
    started_at: startedAt, ended_at: new Date().toISOString(), first_red: firstRed,
    approval_sha256: fileSha(approvalFile), request_sha256: fileSha(requestFile),
    wrapper_sha256: fileSha(wrapper), files_sha256: fileSha(filesManifest),
    seed_sha256: fileSha(seed), python_sha256: fileSha(python), node_sha256: fileSha(process.execPath),
    output_path: out, profile_path: profile, env_names: Object.keys(env).sort(),
    processes: processes.map((item) => ({ name: item.name,
      launcher_pid: item.child.pid ?? null, python_pid: item.handshake?.pid ?? null,
      port: item.handshake?.port ?? null,
      token_sha256: item.handshake ? sha(Buffer.from(item.handshake.token)) : null,
      exit: item.exit, spawn_error: item.error,
      stdout: item.stdoutEvidence, stderr: item.stderrEvidence })),
    phases, responses, database_checks: checks, cleanup,
    final_db_sha256: existsSync(db) ? fileSha(db) : null,
    final_wal_sha256: existsSync(`${db}-wal`) ? fileSha(`${db}-wal`) : null,
    output_root_created: existsSync(join(profile, "exports", "product-video")),
  };
  writeFileSync(join(out, "RESULT.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ status: receipt.status, result: join(out, "RESULT.json"), first_red: firstRed?.message ?? null }));
  if (firstRed) process.exitCode = 1;
}
