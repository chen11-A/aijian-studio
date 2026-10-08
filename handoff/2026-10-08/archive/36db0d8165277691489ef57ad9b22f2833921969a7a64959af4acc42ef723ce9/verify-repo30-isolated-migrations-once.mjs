import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const wrapper = fileURLToPath(import.meta.url);
const script = join(root, 'verify-repo30-isolated-migrations.py');
const approvalPath = join(root, 'REPO30-ONE-SHOT-APPROVAL.json');
const run = join(root, 'repo30-isolated-01');
const outputNames = [
  'repo30-isolated-01-stdout.raw',
  'repo30-isolated-01-stderr.raw',
  'repo30-isolated-01-invocation.json',
];
const python = 'C:\\Users\\Administrator\\Documents\\sp\\.venv\\Scripts\\python.exe';
const expected = {
  script: '51E1C587779AB8F471AA83414A3E6A2FD713C350BD0A17A22EDC7705A6F41F62',
  python: '5912D0884B23C0343983A864C6064242391E2265536F50B88624857E353882C9',
  node: '3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5',
  closure: '3D996986C7ED080B7994EF91ED17674E3E864C12F5402974AA1F6E90477605AE',
  preflight: '66CA4637BAB4104C5C42C9F1ED696F82C806CF3B52B8B3C853BD6F87F77EAFDC',
};
const snap = 'C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots';
const closure = join(snap, '20260928-repo30-isolated-migration-preflight-1', 'SOURCE-CLOSURE.json');
const preflight = join(snap, '20260928-repo30-isolated-migration-preflight-1', 'PREFLIGHT.json');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));

if (fileSha(script) !== expected.script || fileSha(python) !== expected.python ||
    fileSha(process.execPath) !== expected.node || fileSha(closure) !== expected.closure ||
    fileSha(preflight) !== expected.preflight) {
  throw new Error('Frozen script, runtime, or source manifest drift');
}
if (existsSync(run) || outputNames.some((name) => existsSync(join(root, name)))) {
  throw new Error('Fresh isolated output and raw evidence paths required');
}
if (!existsSync(approvalPath)) {
  throw new Error('MGR02 one-shot approval file is absent; no test started');
}
const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
const wrapperSha = fileSha(wrapper);
if (approval.mode !== 'QA01_REPO30_ISOLATED_MIGRATION_ONE_SHOT' ||
    approval.status !== 'APPROVED' || approval.script_sha256 !== expected.script ||
    approval.wrapper_sha256 !== wrapperSha || approval.closure_sha256 !== expected.closure ||
    approval.output_path !== run) {
  throw new Error('MGR02 one-shot approval does not match exact inputs/output');
}

const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
delete env.PYTHONPATH;
const args = ['-B', script];
const startedAt = new Date().toISOString();
const child = spawn(python, args, {
  cwd: root, shell: false, windowsHide: true, env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stdoutChunks = [];
const stderrChunks = [];
let spawnError = null;
let timeoutCleanup = null;
child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
child.on('error', (error) => {
  spawnError = { name: error.name, code: error.code ?? null, message: error.message };
});
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  if (child.pid) {
    const stopped = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false, windowsHide: true, timeout: 10000, encoding: null,
    });
    writeFileSync(join(root, 'repo30-isolated-01-taskkill-stdout.raw'), stopped.stdout ?? Buffer.alloc(0));
    writeFileSync(join(root, 'repo30-isolated-01-taskkill-stderr.raw'), stopped.stderr ?? Buffer.alloc(0));
    timeoutCleanup = { status: stopped.status, error: stopped.error?.message ?? null,
      stdout_sha256: sha(stopped.stdout ?? Buffer.alloc(0)),
      stderr_sha256: sha(stopped.stderr ?? Buffer.alloc(0)) };
  }
}, 300000);
const exit = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
clearTimeout(timer);
const stdout = Buffer.concat(stdoutChunks);
const stderr = Buffer.concat(stderrChunks);
writeFileSync(join(root, outputNames[0]), stdout);
writeFileSync(join(root, outputNames[1]), stderr);
const receipt = {
  mode: approval.mode, status: timedOut ? 'TIMEOUT' : exit.code === 0 ? 'EXIT_ZERO' : 'EXIT_NONZERO',
  started_at: startedAt, ended_at: new Date().toISOString(), command: python, args, cwd: root,
  pid: child.pid ?? null, exit, timed_out: timedOut, timeout_cleanup: timeoutCleanup,
  spawn_error: spawnError, approval_sha256: fileSha(approvalPath), wrapper_sha256: wrapperSha,
  script_sha256: fileSha(script), python_sha256: fileSha(python), node_sha256: fileSha(process.execPath),
  closure_sha256: fileSha(closure), preflight_sha256: fileSha(preflight),
  stdout: { bytes: stdout.length, sha256: sha(stdout) },
  stderr: { bytes: stderr.length, sha256: sha(stderr) },
  result_sha256: existsSync(join(run, 'RESULT.json')) ? fileSha(join(run, 'RESULT.json')) : null,
};
writeFileSync(join(root, outputNames[2]), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = exit.code === 0 && !timedOut && !spawnError ? 0 : 1;
