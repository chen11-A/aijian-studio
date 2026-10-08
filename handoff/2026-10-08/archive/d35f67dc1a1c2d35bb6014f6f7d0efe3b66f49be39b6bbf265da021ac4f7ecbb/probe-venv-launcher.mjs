import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(import.meta.filename);
const output = join(root, "probe-01");
assert.ok(!existsSync(output), "Probe output already exists");
mkdirSync(output);
const python = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923/.venv/Scripts/python.exe";
const code = 'import json,os,sys; print(json.dumps({"pid":os.getpid(),"ppid":os.getppid(),"executable":sys.executable}),flush=True); sys.stdin.buffer.read()';
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const stdoutPath = join(output, "python.stdout.raw");
const stderrPath = join(output, "python.stderr.raw");
const stdout = createWriteStream(stdoutPath, { flags: "wx" });
const stderr = createWriteStream(stderrPath, { flags: "wx" });
const child = spawn(python, ["-c", code], { cwd: root, shell: false, windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"] });
child.stdout.pipe(stdout);
child.stderr.pipe(stderr);
const result = { schema: "qa03.venv-launcher-probe.v1", state: "RUNNING",
  launcherPid: child.pid ?? null, actualPid: null, reportedParentPid: null,
  pythonExecutable: null, processTree: null, exit: null, timedOut: false,
  afterCloseProcesses: null, stdoutPath, stderrPath, error: null };
const exit = new Promise((done) => child.once("close", (code, signal) => done({ code, signal })));
try {
  const line = await new Promise((yes, no) => {
    let buffer = "";
    const timer = setTimeout(() => no(new Error("Probe handshake timeout")), 10000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const end = buffer.indexOf("\n");
      if (end >= 0) { clearTimeout(timer); yes(buffer.slice(0, end)); }
    });
    child.once("error", (error) => { clearTimeout(timer); no(error); });
  });
  const handshake = JSON.parse(line);
  result.actualPid = handshake.pid;
  result.reportedParentPid = handshake.ppid;
  result.pythonExecutable = handshake.executable;
  const query = (ids) => {
    const condition = ids.map((pid) => `ProcessId = ${pid}`).join(" OR ");
    const script = `Get-CimInstance Win32_Process -Filter '${condition}' | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress`;
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", script],
      { encoding: "utf8", timeout: 10000 }).trim();
    return raw ? [JSON.parse(raw)].flat() : [];
  };
  result.processTree = query([result.launcherPid, result.actualPid]);
  writeFileSync(join(output, "process-tree.raw.json"),
    JSON.stringify(result.processTree, null, 2) + "\n");
  child.stdin.end();
  let closeTimer;
  result.exit = await Promise.race([exit, new Promise((done) => {
    closeTimer = setTimeout(() => { result.timedOut = true; done(null); }, 10000);
  })]);
  clearTimeout(closeTimer);
  if (!result.exit) { child.kill(); result.exit = await exit; }
  for (let attempt = 0; attempt < 20; attempt++) {
    result.afterCloseProcesses = query([result.launcherPid, result.actualPid]);
    if (result.afterCloseProcesses.length === 0) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(result.exit.code, 0, "Launcher did not close normally");
  assert.equal(result.timedOut, false, "Launcher close timed out");
  assert.deepEqual(result.afterCloseProcesses, [], "Probe process remained after close");
  result.state = "PROBE_PASS";
} catch (error) {
  result.state = "PROBE_RED";
  result.error = String(error?.stack ?? error);
  try { child.stdin.end(); child.kill(); } catch { /* preserve first error */ }
  process.exitCode = 1;
} finally {
  await Promise.all([new Promise((done) => stdout.end(done)),
    new Promise((done) => stderr.end(done))]);
  result.stdoutSha256 = sha(stdoutPath);
  result.stdoutBytes = statSync(stdoutPath).size;
  result.stderrSha256 = sha(stderrPath);
  result.stderrBytes = statSync(stderrPath).size;
  writeFileSync(join(output, "PROBE.json"), JSON.stringify(result, null, 2) + "\n");
}
