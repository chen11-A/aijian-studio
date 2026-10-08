/* Static draft: one approved, isolated, startup-only Electron diagnosis. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeSync, openSync, closeSync,
  readdirSync, statSync } from 'node:fs';
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

const PRODUCT_ROOT = resolve('C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923');
const QA_EVIDENCE_ROOT = resolve(import.meta.dirname, 'evidence');
const MAX_LOG_BYTES = 16 * 1024 * 1024;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const hashFile = (file) => sha(readFileSync(file));
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  assert.ok(arg.startsWith('--') && at > 2, 'Invalid option');
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
assert.deepEqual(Object.keys(options).sort(),
  ['approval', 'approval-sha256', 'plan', 'plan-sha256']);
assert.equal(process.platform, 'win32', 'Windows-only native diagnostic');
for (const key of ['plan-sha256', 'approval-sha256'])
  assert.match(options[key], /^[0-9a-f]{64}$/i);
const planPath = resolve(options.plan);
const approvalPath = resolve(options.approval);
assert.equal(hashFile(planPath), options['plan-sha256'].toUpperCase());
assert.equal(hashFile(approvalPath), options['approval-sha256'].toUpperCase());
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
assert.equal(plan.kind, 'QA02_NATIVE_STARTUP_DIAGNOSTIC_ONLY_PLAN');
assert.equal(approval.kind, 'MGR02_QA02_NATIVE_STARTUP_DIAGNOSTIC_ONLY_APPROVAL');
assert.equal(approval.runId, plan.runId);
assert.equal(approval.planSha256.toUpperCase(), hashFile(planPath));
assert.equal(approval.runnerSha256.toUpperCase(), hashFile(import.meta.filename));
assert.equal(plan.mode, 'PURE_SPAWN');
assert.equal(approval.mode, plan.mode);
assert.equal(plan.preloadSha256, null);
assert.equal(approval.preloadSha256, null);
assert.equal(plan.maxLaunches, 1);
assert.equal(approval.maxLaunches, 1);
assert.equal(plan.actions, 'NO_UI_NO_G1_NO_PROVIDER_NO_EXPORT');
assert.match(plan.runId, /^qa02-startup-diag-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{4,16}$/);
const root = resolve(plan.root);
assert.equal(root.toLowerCase(), PRODUCT_ROOT.toLowerCase());
const profile = resolve(plan.profile);
const profileRoot = join(root, '.aijian-dev');
const profileRelation = relative(profileRoot, profile);
assert.ok(profileRelation && !profileRelation.startsWith('..') &&
  !isAbsolute(profileRelation));
assert.equal(basename(profile), plan.runId);
const evidence = resolve(plan.evidenceDir);
const evidenceRelation = relative(QA_EVIDENCE_ROOT, evidence);
assert.ok(evidenceRelation && !evidenceRelation.startsWith('..') &&
  !isAbsolute(evidenceRelation));
assert.ok(!existsSync(profile) && !existsSync(evidence),
  'Fresh profile and evidence paths required');
const appPath = join(root, 'apps', 'desktop');
const electronExe = join(appPath, 'node_modules', 'electron', 'dist', 'electron.exe');
assert.ok(existsSync(electronExe));
assert.equal(realpathSync.native(electronExe).toLowerCase(),
  resolve(plan.electronExe).toLowerCase());
assert.equal(hashFile(electronExe), plan.electronExeSha256.toUpperCase());
assert.equal(hashFile(join(appPath, 'dist', 'main.js')),
  plan.mainJsSha256.toUpperCase());
assert.equal(hashFile(join(root, 'services', 'api', 'src', 'aijian_api', 'sidecar.py')),
  plan.sidecarPySha256.toUpperCase());
assert.equal(hashFile(join(root, '.venv', 'Scripts', 'python.exe')),
  plan.pythonExeSha256.toUpperCase());
assert.equal(hashFile(resolve(plan.priorV7ResultPath)),
  plan.priorV7ResultSha256.toUpperCase());
assert.equal(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' }).trim(), plan.head);
const gitStatus = execFileSync('git',
  ['-C', root, 'status', '--short', '--untracked-files=all'],
  { encoding: 'utf8' });
assert.equal(gitStatus, plan.gitStatus);
assert.ok(Array.isArray(plan.files) && plan.files.length > 0);
for (const item of plan.files) {
  const absolute = resolve(root, item.path);
  const relation = relative(root, absolute);
  assert.ok(relation && !relation.startsWith('..') && !isAbsolute(relation));
  const bytes = readFileSync(absolute);
  assert.equal(bytes.length, item.bytes, `Byte count drift: ${item.path}`);
  assert.equal(sha(bytes), item.sha256.toUpperCase(), `SHA drift: ${item.path}`);
}

// Windows ACL must be applied before creating any profile or launching Electron.
await mkdir(evidence, { recursive: false, mode: 0o700 });
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const sid = execFileSync(powershell,
  ['-NoProfile', '-Command',
    '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],
  { encoding: 'utf8' }).trim();
assert.match(sid, /^S-1-5-[0-9-]+$/);
const aclOutput = execFileSync('icacls', [evidence, '/inheritance:r',
  '/grant:r', `*${sid}:(OI)(CI)F`,
  '/grant:r', '*S-1-5-18:(OI)(CI)F'], { encoding: 'utf8' });
const aclReadback = execFileSync('icacls', [evidence], { encoding: 'utf8' });
await writeFile(join(evidence, 'acl-receipt.json'), JSON.stringify({
  sid, aclOutput, aclReadback,
}, null, 2));
const events = join(evidence, 'launcher-events.jsonl');
const record = (kind, fields = {}) => appendFile(events,
  JSON.stringify({ utc: new Date().toISOString(), kind, ...fields }) + '\n');
const logs = [];
function capture(name, source) {
  const file = join(evidence, name + '.raw');
  const fd = openSync(file, 'wx', 0o600);
  const item = { name, file, bytes: 0, truncated: false };
  logs.push(item);
  if (!source) { closeSync(fd); return item; }
  source.on('data', (chunk) => {
    const available = Math.max(0, MAX_LOG_BYTES - item.bytes);
    if (available) {
      const part = chunk.subarray(0, available);
      let offset = 0;
      while (offset < part.length) offset += writeSync(fd, part, offset);
      item.bytes += part.length;
    }
    if (chunk.length > available) item.truncated = true;
  });
  source.once('close', () => closeSync(fd));
  return item;
}
const env = { ...process.env,
  AIJIAN_E2E_USER_DATA_DIR: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AIJIAN_E2E_PROPOSAL_RUN_RESPONSE_FAULT;
delete env.AIJIAN_E2E_FAKE_TIMELINE_RUN_RESPONSE_FAULT;
// Playwright-core's Electron launcher strips NODE_OPTIONS before spawning.
delete env.NODE_OPTIONS;
await mkdir(profile, { recursive: false });
const startedUtc = new Date().toISOString();
await record('LAUNCH_INTENT', { runId: plan.runId, mode: plan.mode, maxLaunches: 1,
  planSha256: hashFile(planPath), approvalSha256: hashFile(approvalPath) });
const electronArgs = ['--inspect=0', '--remote-debugging-port=0',
  appPath, `--user-data-dir=${profile}`];
const child = spawn(electronExe, electronArgs, {
  cwd: root, env, windowsHide: true, shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});
await record('ELECTRON_SPAWN', { pid: child.pid ?? null });
capture('main.stdout', child.stdout);
capture('main.stderr', child.stderr);
let spawnError = null;
child.once('error', (error) => {
  spawnError = { name: error.name, code: error.code ?? null };
});
let windowObserved = false;
let windowHandle = null;
let closeRequested = false;
const windowPoll = setInterval(() => {
  if (windowObserved || !child.pid) return;
  try {
    const handle = execFileSync(powershell, ['-NoProfile', '-Command',
      `$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if ($p) { $p.MainWindowHandle }`],
    { encoding: 'utf8', timeout: 3000 }).trim();
    if (!/^[1-9][0-9]*$/.test(handle)) return;
    windowObserved = true;
    windowHandle = handle;
    void record('MAIN_WINDOW_OBSERVED', { pid: child.pid, hwnd: handle });
    setTimeout(() => {
      if (child.exitCode !== null || child.killed) return;
      try {
        const response = execFileSync(powershell, ['-NoProfile', '-Command',
          `(Get-Process -Id ${child.pid} -ErrorAction Stop).CloseMainWindow()`],
        { encoding: 'utf8', timeout: 3000 }).trim();
        closeRequested = true;
        void record('MAIN_WINDOW_CLOSE_REQUESTED', { response });
      } catch {
        void record('MAIN_WINDOW_CLOSE_REQUEST_FAILED');
      }
    }, 2000);
  } catch { /* A process that exited before the poll remains an exit result. */ }
}, 1000);
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill();
}, 45000);
const outcome = await new Promise((done) => child.once('close',
  (code, signal) => done({ code, signal })));
clearTimeout(timeout);
clearInterval(windowPoll);
await record('ELECTRON_CLOSE', { ...outcome, timedOut, spawnError,
  windowObserved, windowHandle, closeRequested });
const rawPaths = readdirSync(evidence)
  .filter((name) => name.endsWith('.raw') || name.endsWith('-events.jsonl'));
const rawFiles = rawPaths.map((name) => {
  const file = join(evidence, name);
  return { name, bytes: statSync(file).size, sha256: hashFile(file),
    truncated: logs.find((item) => basename(item.file) === name)?.truncated ?? false };
});
const captureTruncated = rawFiles.some((item) => item.truncated);
const result = {
  kind: 'QA02_NATIVE_STARTUP_DIAGNOSTIC_ONLY_RESULT', runId: plan.runId,
  mode: plan.mode,
  status: captureTruncated ? 'CAPTURE_TRUNCATED'
    : spawnError ? 'SPAWN_ERROR' : timedOut ? 'STARTUP_TIMEOUT'
    : windowObserved ? 'FIRST_WINDOW_OBSERVED'
      : 'EXIT_BEFORE_FIRST_WINDOW',
  startedUtc, finishedUtc: new Date().toISOString(),
  launcherPid: child.pid ?? null, exitCode: outcome.code,
  signal: outcome.signal, spawnError, rawFiles,
  planSha256: hashFile(planPath), approvalSha256: hashFile(approvalPath),
  runnerSha256: hashFile(import.meta.filename),
  preloadSha256: null,
  head: plan.head, profile, evidence,
  interpretation: 'Pure external spawn diagnostic; shell=false differs from Playwright Windows shell=true. No G1, layout, media, provider, or UAT claim.',
};
await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({ status: result.status,
  resultPath: join(evidence, 'result.json'),
  resultSha256: hashFile(join(evidence, 'result.json')) }) + '\n');
if (result.status !== 'FIRST_WINDOW_OBSERVED') process.exitCode = 1;
