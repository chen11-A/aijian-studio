import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname;
const script = join(root, 'verify-workspace-owner-lock.py');
const source = 'C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260928-workspace-owner-lock-source-1\\services\\api\\src\\aijian_api\\workspace_owner_lock.py';
const run = join(root, 'workspace-lock-local-01');
const sha = (value) => createHash('sha256').update(value).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
if (fileSha(script) !== 'D9AEBC6CBE92D1A3E57AC69E9B9B6098403D733AE6AF296BACBDB6FA6B9DD6D6' ||
    fileSha(source) !== '94F62129EE9253425BBFE932D8822B032B7AF587D6DAB16DD0AE6870ABF410F6') {
  throw new Error('Frozen workspace lock source or test script drift');
}
if (existsSync(run)) throw new Error('Fresh lock test run directory required');
for (const name of ['workspace-lock-local-01-stdout.raw', 'workspace-lock-local-01-stderr.raw',
                    'workspace-lock-local-01-invocation.json']) {
  if (existsSync(join(root, name))) throw new Error(`Wrapper output exists: ${name}`);
}
const command = 'C:\\Users\\Administrator\\Documents\\sp\\.venv\\Scripts\\python.exe';
const interpreterSha256 = '5912D0884B23C0343983A864C6064242391E2265536F50B88624857E353882C9';
if (fileSha(command) !== interpreterSha256) throw new Error('Python interpreter drift');
const args = ['-B', script];
const child = spawn(command, args, { cwd: root, shell: false, windowsHide: true,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const out = [];
const err = [];
let error = null;
child.stdout.on('data', (chunk) => out.push(chunk));
child.stderr.on('data', (chunk) => err.push(chunk));
child.on('error', (e) => { error = { name: e.name, message: e.message, code: e.code }; });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 25000);
const exit = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
clearTimeout(timer);
const stdout = Buffer.concat(out);
const stderr = Buffer.concat(err);
writeFileSync(join(root, 'workspace-lock-local-01-stdout.raw'), stdout);
writeFileSync(join(root, 'workspace-lock-local-01-stderr.raw'), stderr);
const receipt = { mode: 'ISOLATED_WORKSPACE_LOCK_TEST', command, args, cwd: root,
  pid: child.pid ?? null, exit, error, timed_out: timedOut,
  script_sha256: fileSha(script), source_sha256: fileSha(source),
  interpreter_sha256: interpreterSha256,
  stdout: { bytes: stdout.length, sha256: sha(stdout) },
  stderr: { bytes: stderr.length, sha256: sha(stderr) },
  result_sha256: existsSync(join(run, 'RESULT.json'))
    ? fileSha(join(run, 'RESULT.json')) : null };
writeFileSync(join(root, 'workspace-lock-local-01-invocation.json'),
  JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = exit.code ?? 1;
