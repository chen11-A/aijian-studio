"use strict";

// One approved, isolated runtime pass for the already built sidecar EXE.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { spawn } = require("node:child_process");

const root = __dirname;
const packetPath = path.join(root, "RUN-PACKET.json");
const runDir = path.join(root, "run-01");
const activeHandles = new Set();
const ownedPids = new Set();
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
const fail = (message) => { throw new Error(message); };
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
]);

function childEnvironment(dataDir, tempDir, profileDir) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toUpperCase();
    if (!["SYSTEMROOT", "WINDIR", "PATH"].includes(normalized) || value === undefined) continue;
    if (env[normalized] !== undefined && env[normalized] !== value) fail(`conflicting Windows environment key: ${normalized}`);
    env[normalized] = value;
  }
  Object.assign(env, {
    APPDATA: path.join(profileDir, "Roaming"),
    LOCALAPPDATA: path.join(profileDir, "Local"),
    USERPROFILE: profileDir,
    HOME: profileDir,
    TEMP: tempDir,
    TMP: tempDir,
    AIJIAN_DATA_DIR: dataDir,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONNOUSERSITE: "1",
  });
  return env;
}

function startChild(exe, args, env, name, stdinData, expectedSha256) {
  const executableSha256 = sha(exe);
  if (executableSha256 !== expectedSha256) fail(`${name} executable fingerprint changed`);
  const outPath = path.join(runDir, `${name}.stdout.raw`);
  const errPath = path.join(runDir, `${name}.stderr.raw`);
  const out = fs.createWriteStream(outPath, { flags: "wx" });
  const err = fs.createWriteStream(errPath, { flags: "wx" });
  const spawnStartedAt = new Date().toISOString();
  const child = spawn(exe, args, { cwd: runDir, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  const outDone = new Promise((resolve, reject) => { out.once("finish", resolve); out.once("error", reject); });
  const errDone = new Promise((resolve, reject) => { err.once("finish", resolve); err.once("error", reject); });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  if (stdinData !== undefined) child.stdin.end(stdinData);
  const handle = { child, closed, outDone, errDone, outPath, errPath, spawnStartedAt };
  activeHandles.add(handle);
  if (Number.isSafeInteger(child.pid)) ownedPids.add(child.pid);
  writeJson(path.join(runDir, `${name}.launch-envelope.json`), { name, executable: exe, executableSha256, arguments: args, cwd: runDir, launcherPid: child.pid ?? null, spawnStartedAt, windowsHide: true, environmentKeys: Object.keys(env).sort(), environmentWithoutPath: Object.fromEntries(Object.entries(env).filter(([key]) => key !== "PATH")), pathSha256: env.PATH ? crypto.createHash("sha256").update(env.PATH).digest("hex").toUpperCase() : null });
  return handle;
}

async function stopOwnTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, shell: false, stdio: "ignore" });
  await withTimeout(new Promise((resolve) => killer.once("close", resolve)), 5000, "taskkill own tree").catch(() => {});
}

async function auditOwnProcesses(name) {
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress -Depth 2";
  const auditor = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  auditor.stdout.on("data", (chunk) => stdout.push(chunk));
  auditor.stderr.on("data", (chunk) => stderr.push(chunk));
  const audit = { queryStatus: "UNKNOWN", stage: name, observedAt: new Date().toISOString(), knownOwnedPids: [...ownedPids].sort((a, b) => a - b), ownedResidual: [], pathConflicts: [] };
  let exit;
  try {
    exit = await withTimeout(new Promise((resolve, reject) => { auditor.once("error", reject); auditor.once("close", (code) => resolve(code)); }), 15000, "Win32_Process audit");
  } catch (error) {
    if (auditor.exitCode === null && auditor.signalCode === null) await stopOwnTree(auditor.pid);
    audit.error = error.message;
    writeJson(path.join(runDir, `${name}.process-audit.json`), audit);
    fail(`${name} process audit UNKNOWN`);
  }
  if (exit !== 0) {
    audit.error = Buffer.concat(stderr).toString("utf8").slice(0, 1000);
  } else {
    try {
      const parsed = JSON.parse(Buffer.concat(stdout).toString("utf8"));
      const processes = Array.isArray(parsed) ? parsed : [parsed];
      const descendants = new Set(ownedPids);
      let grew;
      do {
        grew = false;
        for (const process of processes) {
          if (descendants.has(process.ParentProcessId) && !descendants.has(process.ProcessId)) { descendants.add(process.ProcessId); grew = true; }
        }
      } while (grew);
      const detail = (process) => ({ pid: process.ProcessId, parentPid: process.ParentProcessId, commandLine: process.CommandLine || null });
      audit.ownedResidual = processes.filter((process) => descendants.has(process.ProcessId)).map(detail);
      audit.pathConflicts = processes.filter((process) => !descendants.has(process.ProcessId) && String(process.CommandLine || "").toLowerCase().includes(runDir.toLowerCase())).map(detail);
      audit.queryStatus = "OK";
    } catch (error) {
      audit.error = `Win32_Process JSON parse failed: ${error.message}`;
    }
  }
  writeJson(path.join(runDir, `${name}.process-audit.json`), audit);
  if (audit.queryStatus !== "OK") fail(`${name} process audit UNKNOWN`);
  if (audit.ownedResidual.length) fail(`${name} has owned residual process; no post-close process was killed`);
  if (audit.pathConflicts.length) fail(`${name} has external path conflict; no external process was killed`);
  return { path: path.join(runDir, `${name}.process-audit.json`), sha256: sha(path.join(runDir, `${name}.process-audit.json`)) };
}

async function finishChild(handle, limitMs, name) {
  let result;
  try {
    result = await withTimeout(handle.closed, limitMs, name);
  } catch (error) {
    if (handle.child.exitCode === null && handle.child.signalCode === null) await stopOwnTree(handle.child.pid);
    await withTimeout(handle.closed, 5000, `${name} post-kill`).catch(() => {});
    throw error;
  }
  await withTimeout(Promise.all([handle.outDone, handle.errDone]), 5000, `${name} output flush`);
  activeHandles.delete(handle);
  const closedAt = new Date().toISOString();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const processAudit = await auditOwnProcesses(name);
  return { name, pid: handle.child.pid, args: handle.child.spawnargs.slice(1), closedAt, exit: result, stdout: handle.outPath, stdoutSha256: sha(handle.outPath), stderr: handle.errPath, stderrSha256: sha(handle.errPath), processAudit };
}

async function health(port, token, origin) {
  return withTimeout(new Promise((resolve, reject) => {
    const headers = { Origin: origin };
    if (token) headers.Authorization = `Bearer ${token}`;
    const request = http.request({ host: "127.0.0.1", port, path: "/api/v1/health", method: "GET", headers, agent: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    request.end();
  }), 5000, "health HTTP");
}

async function handshakeProcess(launcherPid, handshakePid, expectedExe, spawnStartedAt) {
  const evidencePath = path.join(runDir, "01-handshake-process.json");
  const filter = handshakePid === launcherPid ? `ProcessId = ${launcherPid}` : `ProcessId = ${launcherPid} OR ProcessId = ${handshakePid}`;
  const script = `Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId,ParentProcessId,ExecutablePath,@{Name='CreationDate';Expression={$_.CreationDate.ToString('o')}} | ConvertTo-Json -Compress`;
  const query = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  query.stdout.on("data", (chunk) => stdout.push(chunk));
  query.stderr.on("data", (chunk) => stderr.push(chunk));
  let exit;
  try {
    exit = await withTimeout(new Promise((resolve, reject) => { query.once("error", reject); query.once("close", (code) => resolve(code)); }), 15000, "handshake PID query");
  } catch (error) {
    if (query.exitCode === null && query.signalCode === null) await stopOwnTree(query.pid);
    writeJson(evidencePath, { status: "UNKNOWN", launcherPid, handshakePid, error: error.message });
    throw error;
  }
  if (exit !== 0) {
    writeJson(evidencePath, { status: "UNKNOWN", launcherPid, handshakePid, queryExit: exit, error: Buffer.concat(stderr).toString("utf8").slice(0, 300) });
    fail("handshake PID query failed");
  }
  let rows;
  try {
    const found = JSON.parse(Buffer.concat(stdout).toString("utf8"));
    rows = Array.isArray(found) ? found : [found];
  }
  catch (error) {
    writeJson(evidencePath, { status: "UNKNOWN", launcherPid, handshakePid, error: error.message });
    throw error;
  }
  const launcher = rows.find((item) => item.ProcessId === launcherPid);
  const ready = rows.find((item) => item.ProcessId === handshakePid);
  const startedMs = Date.parse(spawnStartedAt);
  const queryUpperMs = Date.now();
  const launcherMs = Date.parse(launcher?.CreationDate || "");
  const readyMs = Date.parse(ready?.CreationDate || "");
  const sameExe = (item) => typeof item?.ExecutablePath === "string" && item.ExecutablePath.length > 0 && path.normalize(item.ExecutablePath).toLowerCase() === path.normalize(expectedExe).toLowerCase();
  const validTimes = Number.isFinite(startedMs) && Number.isFinite(launcherMs) && Number.isFinite(readyMs) && launcherMs >= startedMs - 5000 && launcherMs <= queryUpperMs + 5000 && readyMs >= launcherMs - 1000 && readyMs <= queryUpperMs + 5000;
  const relation = handshakePid === launcherPid ? "same-process" : "direct-child";
  const accepted = launcher && ready && sameExe(launcher) && sameExe(ready) && validTimes && (handshakePid === launcherPid || ready.ParentProcessId === launcherPid);
  const status = !launcher || !ready || !launcher.ExecutablePath || !ready.ExecutablePath || !Number.isFinite(launcherMs) || !Number.isFinite(readyMs) ? "UNKNOWN" : accepted ? "PASS" : "RED";
  const evidence = { status, launcherPid, handshakePid, relation, spawnStartedAt, queryUpperAt: new Date(queryUpperMs).toISOString(), toleranceMs: { beforeSpawn: 5000, afterQuery: 5000, childBeforeLauncher: 1000 }, launcher: launcher ? { pid: launcher.ProcessId, parentPid: launcher.ParentProcessId, executablePath: launcher.ExecutablePath, creationDate: launcher.CreationDate, parsedCreationMs: launcherMs } : null, ready: ready ? { pid: ready.ProcessId, parentPid: ready.ParentProcessId, executablePath: ready.ExecutablePath, creationDate: ready.CreationDate, parsedCreationMs: readyMs } : null, checks: { launcherExecutableMatches: sameExe(launcher), readyExecutableMatches: sameExe(ready), creationWindow: validTimes, parentChain: handshakePid === launcherPid || ready?.ParentProcessId === launcherPid } };
  writeJson(evidencePath, evidence);
  if (!accepted) fail("handshake PID ownership or creation window is unverified");
  ownedPids.add(handshakePid);
  return evidence;
}

function meipaths(tempDir) {
  return fs.readdirSync(tempDir).filter((name) => name.startsWith("_MEI")).sort();
}

function inventory(directory) {
  const files = [];
  const visit = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, item.name);
      if (item.isSymbolicLink()) fail("fixture contains a link");
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) files.push({ path: path.relative(directory, file).replaceAll("\\", "/"), size: fs.statSync(file).size, sha256: sha(file) });
      else fail("fixture contains unsupported file type");
    }
  };
  visit(directory);
  return files;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 2 || argv[0] !== "--approval") fail("usage: node run-once.cjs --approval ABSOLUTE_APPROVAL_PATH");
  const approvalPath = path.resolve(argv[1]);
  if (!path.isAbsolute(argv[1])) fail("approval path must be absolute");
  if (fs.existsSync(runDir)) fail("one-shot run-01 already exists");
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
  if (packet.schema !== "qa03.sidecar-runtime-shortprofile.packet.v1" || packet.state !== "PREPARED_NOT_APPROVED_NOT_RUN") fail("packet state/schema mismatch");
  if (approval.schema !== "qa03.sidecar-runtime-shortprofile.one-shot.approval.v1" || approval.state !== "APPROVED_SINGLE_RUN" || approval.approvedBy !== "MGR02") fail("approval state/schema mismatch");
  if (approval.packetSha256 !== sha(packetPath) || approval.runnerSha256 !== sha(__filename) || approval.sqliteFixtureSha256 !== sha(packet.sqliteFixturePath) || approval.pathBudgetSha256 !== sha(packet.pathBudgetPath) || approval.exeSha256 !== sha(packet.exePath)) fail("approval hashes mismatch");
  if (packet.exeSha256 !== sha(packet.exePath) || packet.buildReceiptSha256 !== sha(packet.buildReceiptPath) || packet.basePythonSha256 !== sha(packet.basePythonPath) || packet.sqliteFixtureSha256 !== sha(packet.sqliteFixturePath) || packet.pathBudgetSha256 !== sha(packet.pathBudgetPath) || packet.oldR1ReceiptSha256 !== sha(packet.oldR1ReceiptPath) || packet.oldR2ReceiptSha256 !== sha(packet.oldR2ReceiptPath) || !fs.existsSync(packet.oldR1MeiPath) || !fs.existsSync(packet.oldR2TempDir) || fs.readdirSync(packet.oldR2TempDir).length !== 0) fail("input hashes or old RED preservation mismatch");
  if (packet.outputDir !== runDir || packet.qaRoot !== root) fail("packet paths mismatch");
  const tempParent = path.join(process.env.LOCALAPPDATA || "", "Temp");
  if (packet.isolationRoot !== path.join(tempParent, "QA03-R3-20260928") || packet.isolationRoot.length > 80 || fs.existsSync(packet.isolationRoot) || fs.lstatSync(tempParent).isSymbolicLink() || fs.realpathSync(tempParent).toLowerCase() !== tempParent.toLowerCase()) fail("short isolation root must be new, local and canonical");
  const budget = JSON.parse(fs.readFileSync(packet.pathBudgetPath, "utf8"));
  const plannedProfile = path.join(packet.isolationRoot, "profile");
  const plannedDataDir = path.join(plannedProfile, "Roaming", "AIVORA", "workspace");
  const plannedDatabase = path.join(plannedDataDir, "workspace.sqlite3");
  const lockDigest = crypto.createHash("sha256").update(path.normalize(plannedDatabase).toLowerCase(), "utf8").digest("hex");
  const plannedLock = path.join(path.dirname(plannedDataDir), `.aivora-workspace-${lockDigest}.lock`);
  if (budget.proposedR3.isolationRoot.path !== packet.isolationRoot || budget.proposedR3.AIJIAN_DATA_DIR.path !== plannedDataDir || budget.proposedR3.database.path !== plannedDatabase || budget.proposedR3.actualOwnerLockNameFromSourceFormula.path !== plannedLock || plannedLock.length >= 248) fail("short profile path budget mismatch");
  const receipt = { schema: "qa03.sidecar-runtime.receipt.v1", state: "RUNNING", approvalPath, approvalSha256: sha(approvalPath), startedAt: new Date().toISOString(), exeSha256: packet.exeSha256, phases: [], provider: "NOT_RUN", productWorkspace: "NOT_TOUCHED", c19Write: "NOT_RUN", acquisitionWrite: "NOT_RUN", installer: "NOT_RUN" };
  fs.mkdirSync(runDir);
  const profile = plannedProfile;
  const appdata = path.join(profile, "Roaming");
  const localdata = path.join(profile, "Local");
  const temp = path.join(packet.isolationRoot, "temp");
  const dataDir = path.join(appdata, "AIVORA", "workspace");
  for (const dir of [profile, appdata, localdata, temp, dataDir]) fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(packet.isolationRoot).isSymbolicLink() || fs.realpathSync(packet.isolationRoot).toLowerCase() !== packet.isolationRoot.toLowerCase()) fail("new isolation root changed when resolved");
  const env = childEnvironment(dataDir, temp, profile);
  writeJson(path.join(runDir, "environment-controls.json"), Object.fromEntries(Object.entries(env).filter(([key]) => key !== "PATH")));
  let live;
  try {
    const sqliteProbe = async (mode, database, name) => {
      const handle = startChild(packet.basePythonPath, ["-I", "-B", packet.sqliteFixturePath, mode, database], env, name, "", packet.basePythonSha256);
      const result = await finishChild(handle, 20000, name);
      if (result.exit.code !== 0 || result.exit.signal !== null) fail(`${name} failed`);
      const payload = JSON.parse(fs.readFileSync(result.stdout, "utf8").trim());
      if (payload.mode !== mode || payload.integrity !== "ok" || payload.rows?.length !== 1 || payload.rows[0][0] !== 1 || payload.rows[0][1] !== "QA03 恢复回读 / 片段一") fail(`${name} payload mismatch`);
      receipt.phases.push({ ...result, payload });
    };
    if (meipaths(temp).length) fail("TEMP baseline contains _MEI");
    live = startChild(packet.exePath, [], env, "01-sidecar", undefined, packet.exeSha256);
    let prefix = "";
    const line = await withTimeout(new Promise((resolve, reject) => {
      live.child.stdout.on("data", (chunk) => {
        prefix += chunk.toString("utf8");
        if (prefix.length > 8192) reject(new Error("handshake exceeds 8192 bytes"));
        const index = prefix.indexOf("\n");
        if (index >= 0) resolve(prefix.slice(0, index).trimEnd());
      });
      live.child.once("error", reject);
      live.child.once("exit", () => reject(new Error("sidecar exited before handshake")));
    }), 45000, "sidecar handshake");
    const handshake = JSON.parse(line);
    const keys = Object.keys(handshake).sort().join(",");
    if (keys !== "event,host,pid,port,protocol_version,token" || handshake.event !== "ready" || handshake.host !== "127.0.0.1" || handshake.protocol_version !== 1 || !Number.isSafeInteger(handshake.pid) || handshake.pid <= 0 || !Number.isSafeInteger(handshake.port) || handshake.port < 1 || handshake.port > 65535 || !/^[A-Za-z0-9_-]{43,256}$/.test(handshake.token)) fail("handshake contract mismatch");
    await handshakeProcess(live.child.pid, handshake.pid, packet.exePath, live.spawnStartedAt);
    const liveMei = meipaths(temp);
    writeJson(path.join(runDir, "01-mei-live.json"), { temp, observedAt: new Date().toISOString(), entries: liveMei });
    if (liveMei.length !== 1 || fs.lstatSync(path.join(temp, liveMei[0])).isSymbolicLink() || !fs.statSync(path.join(temp, liveMei[0])).isDirectory()) fail("onefile extraction root is not one owned short TEMP directory");
    const noAuth = await health(handshake.port, null, "app://aijian");
    const wrongOrigin = await health(handshake.port, handshake.token, "http://example.invalid");
    const authorized = await health(handshake.port, handshake.token, "app://aijian");
    for (const [name, result] of [["01-health-no-auth", noAuth], ["01-health-wrong-origin", wrongOrigin], ["01-health-authorized", authorized]]) writeJson(path.join(runDir, `${name}.json`), result);
    if (noAuth.status !== 401 || wrongOrigin.status !== 403 || authorized.status !== 200) fail("health boundary status mismatch");
    const healthBody = JSON.parse(authorized.body);
    if (typeof healthBody.data?.version !== "string" || !healthBody.request_id) fail("health payload mismatch");
    writeJson(path.join(runDir, "01-handshake-redacted.json"), { ...handshake, token: "REDACTED", tokenSha256: crypto.createHash("sha256").update(handshake.token).digest("hex").toUpperCase() });
    live.child.stdin.end();
    const first = await finishChild(live, 20000, "01-sidecar");
    live = null;
    if (first.exit.code !== 0 || first.exit.signal !== null) fail("sidecar normal close failed");
    if (meipaths(temp).length) fail("_MEI remains after sidecar close");
    if (!fs.existsSync(path.join(dataDir, "workspace.sqlite3"))) fail("isolated workspace sqlite missing");
    const mediaFile = path.join(dataDir, "media-assets", "中文", "样本.bin");
    fs.mkdirSync(path.dirname(mediaFile), { recursive: true });
    fs.writeFileSync(mediaFile, Buffer.from("QA03 media fixture / 中文路径 / 2026-09-28\n", "utf8"), { flag: "wx" });
    await sqliteProbe("seed", path.join(dataDir, "workspace.sqlite3"), "02-sqlite-seed");
    const sourceBeforeBackup = inventory(dataDir);
    receipt.phases.push({ ...first, handshakePath: path.join(runDir, "01-handshake-redacted.json"), healthStatuses: [401, 403, 200], tempMEIAfter: meipaths(temp) });

    const backup = path.join(runDir, "backup-output");
    const backupHandle = startChild(packet.exePath, ["--backup-workspace", dataDir, "--output", backup], env, "02-backup", "", packet.exeSha256);
    const backupResult = await finishChild(backupHandle, 20000, "02-backup");
    if (backupResult.exit.code !== 0 || backupResult.exit.signal !== null || meipaths(temp).length) fail("backup CLI failed or left _MEI");
    const backupEvent = JSON.parse(fs.readFileSync(backupResult.stdout, "utf8").trim());
    if (backupEvent.event !== "backup-complete" || backupEvent.output !== backup || backupEvent.file_count < 1 || !fs.existsSync(path.join(backup, "receipt.json"))) fail("backup event/receipt mismatch");
    if (backupEvent.receipt_sha256?.toUpperCase() !== sha(path.join(backup, "receipt.json"))) fail("backup receipt hash mismatch");
    const sourceAfterBackup = inventory(dataDir);
    writeJson(path.join(runDir, "02-source-before-backup.json"), sourceBeforeBackup);
    writeJson(path.join(runDir, "02-source-after-backup.json"), sourceAfterBackup);
    if (JSON.stringify(sourceBeforeBackup) !== JSON.stringify(sourceAfterBackup)) fail("backup changed source fixture");
    const backupReceipt = JSON.parse(fs.readFileSync(path.join(backup, "receipt.json"), "utf8"));
    if (!Array.isArray(backupReceipt.files) || backupReceipt.files.length !== backupEvent.file_count) fail("backup file count mismatch");
    const restored = path.join(runDir, "restore-readback");
    fs.mkdirSync(restored);
    for (const file of backupReceipt.files) {
      if (typeof file.path !== "string" || file.path.startsWith("/") || file.path.includes("..") || file.path.includes("\\")) fail("unsafe backup receipt path");
      const sourceFile = path.join(backup, file.path);
      const restoredFile = path.join(restored, file.path);
      if (sha(sourceFile) !== file.sha256.toUpperCase() || fs.statSync(sourceFile).size !== file.byte_size) fail("backup file receipt mismatch");
      fs.mkdirSync(path.dirname(restoredFile), { recursive: true });
      fs.copyFileSync(sourceFile, restoredFile, fs.constants.COPYFILE_EXCL);
      if (sha(restoredFile) !== file.sha256.toUpperCase() || fs.statSync(restoredFile).size !== file.byte_size) fail("restored file readback mismatch");
    }
    if (!backupReceipt.files.some((file) => file.path === "media-assets/中文/样本.bin")) fail("backup omitted Chinese media fixture");
    if (sha(path.join(restored, "media-assets", "中文", "样本.bin")) !== sha(mediaFile)) fail("restored media differs from source");
    await sqliteProbe("verify", path.join(restored, "workspace.sqlite3"), "02-restored-sqlite-verify");
    receipt.phases.push({ ...backupResult, backupEvent, backupReceiptSha256: sha(path.join(backup, "receipt.json")), sourceBeforeSha256: sha(path.join(runDir, "02-source-before-backup.json")), sourceAfterSha256: sha(path.join(runDir, "02-source-after-backup.json")), restoredFileCount: backupReceipt.files.length, mediaFixtureSha256: sha(mediaFile), tempMEIAfter: meipaths(temp) });

    const fakeAgent = startChild(packet.exePath, ["-m", "aijian_api.fake_agent_subprocess"], env, "03-fake-agent-dispatch", "{}\n", packet.exeSha256);
    const agentResult = await finishChild(fakeAgent, 20000, "03-fake-agent-dispatch");
    const agentBody = JSON.parse(fs.readFileSync(agentResult.stdout, "utf8").trim());
    if (agentResult.exit.code !== 0 || agentBody.kind !== "error" || agentBody.error_stage !== "request" || meipaths(temp).length) fail("frozen fake Agent dispatch failed");
    receipt.phases.push({ ...agentResult, response: agentBody, tempMEIAfter: meipaths(temp) });

    const fakeDb = path.join(runDir, "fake-provider.sqlite3");
    const fakeProvider = startChild(packet.exePath, ["-m", "aijian_api.fake_provider_worker", fakeDb, runDir], env, "04-fake-provider-dispatch", '{"request_id":1,"operation":"shutdown"}\n', packet.exeSha256);
    const providerResult = await finishChild(fakeProvider, 20000, "04-fake-provider-dispatch");
    const providerBody = JSON.parse(fs.readFileSync(providerResult.stdout, "utf8").trim());
    if (providerResult.exit.code !== 0 || providerBody.request_id !== 1 || providerBody.ok !== true || fs.existsSync(fakeDb) || meipaths(temp).length) fail("frozen fake Provider dispatch failed");
    receipt.phases.push({ ...providerResult, response: providerBody, tempMEIAfter: meipaths(temp) });
    receipt.state = "EXE_LOCAL_RUNTIME_PASS_MULTIPROCESS_NOT_RUN";
  } catch (error) {
    receipt.state = "RED_STOPPED";
    receipt.error = { name: error.name, message: error.message };
  } finally {
    receipt.cleanup = [];
    for (const [index, handle] of [...activeHandles].entries()) {
      handle.child.stdin.end();
      try {
        const result = await finishChild(handle, 5000, `cleanup-${index + 1}`);
        receipt.cleanup.push({ pid: handle.child.pid, state: "CLOSED", processAudit: result.processAudit });
      } catch (error) {
        if (handle.child.exitCode === null && handle.child.signalCode === null) await stopOwnTree(handle.child.pid);
        const streams = await Promise.allSettled([
          withTimeout(handle.outDone, 5000, "cleanup stdout"),
          withTimeout(handle.errDone, 5000, "cleanup stderr"),
        ]);
        receipt.cleanup.push({ pid: handle.child.pid, state: "UNKNOWN_AFTER_KILL", error: error.message, streams: streams.map((item) => item.status) });
      }
    }
    receipt.finishedAt = new Date().toISOString();
    receipt.tempMEIFinal = meipaths(temp);
    const streamsStable = receipt.cleanup.every((item) => item.state === "CLOSED");
    receipt.rawFiles = fs.readdirSync(runDir).filter((name) => name.endsWith(".raw")).sort().map((name) => ({ path: path.join(runDir, name), sha256: streamsStable ? sha(path.join(runDir, name)) : null, state: streamsStable ? "CLOSED_SHA256" : "UNKNOWN_STREAM_STATE" }));
    if (!streamsStable) {
      receipt.state = "RED_STOPPED";
      receipt.error ??= { name: "CleanupUncertain", message: "owned process or raw stream cleanup is UNKNOWN" };
    }
    writeJson(path.join(runDir, "RECEIPT.json"), receipt);
  }
  if (receipt.state === "RED_STOPPED") fail(receipt.error.message);
  process.stdout.write(JSON.stringify({ state: receipt.state, receipt: path.join(runDir, "RECEIPT.json"), receiptSha256: sha(path.join(runDir, "RECEIPT.json")) }) + "\n");
}

main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
