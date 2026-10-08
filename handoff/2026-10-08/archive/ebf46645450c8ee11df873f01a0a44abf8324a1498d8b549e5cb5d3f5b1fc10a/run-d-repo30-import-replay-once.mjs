import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const qaRoot = dirname(fileURLToPath(import.meta.url));
const script = join(qaRoot, "verify-d-repo30-import-replay.py");
const wrapper = fileURLToPath(import.meta.url);
const requestFile = join(qaRoot, "D-REPO30-IMPORT-REPLAY-APPROVAL-REQUEST.json");
const approvalFile = join(qaRoot, "D-REPO30-IMPORT-REPLAY-ONE-SHOT-APPROVAL.json");
const outputRoot = join(qaRoot, "d-repo30-import-replay-01");
const profile = join(outputRoot, "profile");
const python = "C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923\\.venv\\Scripts\\python.exe";
const bundle = "C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260928-d-repo30-qa-closure-152-1";
const expected = {
  script: "AB8642FC4C7C78A6FBF06BD123CFCFC01F151B6D5C24745D6DB42B7664F36035",
  python: "461D6E5F9A0DCB724798D2B6DBD57555A9EB3084522CC5DC5B2347934F5A4060",
  node: "3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5",
  files: "F3775529D3D431D5D914F80FB74552CD23B96402142808970963D75C296160E9",
  handoff: "56658FE0A3178200A07F7FB770A9AA86812FCBA19F0E5BED016A2410DE4C6700",
  preflight: "C8705CD68B05E056D302BB718F5C49F2345C24761743FC35588A7677A730979E",
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex").toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
const manifests = {
  files: join(bundle, "FILES.json"),
  handoff: join(bundle, "QA-HANDOFF.json"),
  preflight: join(bundle, "ENV-PREFLIGHT.json"),
};

if (fileSha(script) !== expected.script || fileSha(python) !== expected.python ||
    fileSha(process.execPath) !== expected.node ||
    Object.entries(manifests).some(([key, path]) => fileSha(path) !== expected[key])) {
  throw new Error("Frozen script, runtime, or source bundle manifest drift");
}
if (existsSync(outputRoot) || ["stdout.raw", "stderr.raw", "invocation.json"].some(
  (name) => existsSync(join(qaRoot, `d-repo30-import-replay-01-${name}`)))) {
  throw new Error("Fresh one-shot output paths required");
}
if (!existsSync(approvalFile)) throw new Error("MGR02 approval absent; no product import started");
const approval = JSON.parse(readFileSync(approvalFile, "utf8"));
if (approval.mode !== "QA01_D_REPO30_IMPORT_REPLAY_ONE_SHOT" ||
    approval.status !== "APPROVED" || approval.approved_by !== "MGR02" ||
    approval.script_sha256 !== expected.script ||
    approval.wrapper_sha256 !== fileSha(wrapper) ||
    approval.files_sha256 !== expected.files ||
    approval.handoff_sha256 !== expected.handoff ||
    approval.preflight_sha256 !== expected.preflight ||
    approval.request_sha256 !== fileSha(requestFile) ||
    resolve(approval.output_path) !== resolve(outputRoot)) {
  throw new Error("MGR02 one-shot approval does not match this exact scope");
}

const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
if (!systemRoot) throw new Error("Windows SystemRoot unavailable");
mkdirSync(join(profile, "tmp"), { recursive: true });
mkdirSync(join(profile, "AppData", "Roaming"), { recursive: true });
mkdirSync(join(profile, "AppData", "Local"), { recursive: true });
const env = {
  SystemRoot: systemRoot, WINDIR: systemRoot,
  PATH: [dirname(python), join(systemRoot, "System32"), systemRoot].join(";"),
  TEMP: join(profile, "tmp"), TMP: join(profile, "tmp"),
  APPDATA: join(profile, "AppData", "Roaming"),
  LOCALAPPDATA: join(profile, "AppData", "Local"),
  USERPROFILE: profile, HOME: profile,
  AIJIAN_DATA_DIR: profile,
  AIJIAN_RESOURCE_ROOT: join(profile, "resources"),
  PYTHONPATH: bundle, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1",
  PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1",
};
const args = ["-B", script];
const startedAt = new Date().toISOString();
const child = spawn(python, args, {
  cwd: outputRoot, env, shell: false, windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const stdoutParts = [], stderrParts = [];
child.stdout.on("data", (part) => stdoutParts.push(part));
child.stderr.on("data", (part) => stderrParts.push(part));
let spawnError = null;
child.on("error", (error) => {
  spawnError = { code: error.code ?? null, message: error.message };
});
let timedOut = false, cleanup = null;
const timer = setTimeout(() => {
  timedOut = true;
  if (!child.pid) return;
  const stopped = spawnSync(join(systemRoot, "System32", "taskkill.exe"),
    ["/PID", String(child.pid), "/T", "/F"],
    { windowsHide: true, shell: false, timeout: 10_000, encoding: null });
  const out = stopped.stdout ?? Buffer.alloc(0);
  const err = stopped.stderr ?? Buffer.alloc(0);
  writeFileSync(join(qaRoot, "d-repo30-import-replay-01-taskkill-stdout.raw"), out);
  writeFileSync(join(qaRoot, "d-repo30-import-replay-01-taskkill-stderr.raw"), err);
  cleanup = { status: stopped.status, error: stopped.error?.message ?? null,
    stdout_sha256: sha(out), stderr_sha256: sha(err) };
}, 45_000);
const exit = await new Promise((done) => child.once("close", (code, signal) => done({ code, signal })));
clearTimeout(timer);
const stdout = Buffer.concat(stdoutParts), stderr = Buffer.concat(stderrParts);
writeFileSync(join(qaRoot, "d-repo30-import-replay-01-stdout.raw"), stdout);
writeFileSync(join(qaRoot, "d-repo30-import-replay-01-stderr.raw"), stderr);
const optionalHash = (path) => existsSync(path) ? fileSha(path) : null;
const invocation = {
  mode: approval.mode,
  status: timedOut ? "TIMEOUT" : exit.code === 0 ? "EXIT_ZERO" : "EXIT_NONZERO",
  started_at: startedAt, ended_at: new Date().toISOString(),
  command: python, args, cwd: outputRoot,
  pid: child.pid ?? null, parent_pid: process.pid, exit, timed_out: timedOut,
  timeout_cleanup: cleanup, spawn_error: spawnError,
  approval_sha256: fileSha(approvalFile), request_sha256: fileSha(requestFile),
  wrapper_sha256: fileSha(wrapper), script_sha256: fileSha(script),
  python_sha256: fileSha(python), node_sha256: fileSha(process.execPath),
  files_sha256: fileSha(manifests.files), handoff_sha256: fileSha(manifests.handoff),
  preflight_sha256: fileSha(manifests.preflight),
  env_names: Object.keys(env).sort(),
  stdout: { bytes: stdout.length, sha256: sha(stdout) },
  stderr: { bytes: stderr.length, sha256: sha(stderr) },
  result_sha256: optionalHash(join(outputRoot, "RESULT.json")),
  database_sha256: optionalHash(join(profile, "workspace.sqlite3")),
  before_backup_sha256: optionalHash(join(outputRoot, "before-action.sqlite3")),
  after_backup_sha256: optionalHash(join(outputRoot, "after-action.sqlite3")),
};
writeFileSync(join(qaRoot, "d-repo30-import-replay-01-invocation.json"),
  JSON.stringify(invocation, null, 2) + "\n");
console.log(JSON.stringify(invocation));
process.exitCode = exit.code === 0 && !timedOut && !spawnError ? 0 : 1;
