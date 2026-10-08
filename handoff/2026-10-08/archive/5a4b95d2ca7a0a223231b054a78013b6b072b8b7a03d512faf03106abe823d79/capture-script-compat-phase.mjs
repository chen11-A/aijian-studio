import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const repo = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const script = join(import.meta.dirname, 'verify-script-compat-phases.py');
const phase = process.argv[2];
const output = process.argv[3];
if (!['old', 'new'].includes(phase) || !output) throw new Error('phase and output are required');
if (phase === 'old' && existsSync(output)) throw new Error('Old phase requires absent output directory');
if (phase === 'new' && (!existsSync(join(output, 'old-HTTP.json')) ||
    existsSync(join(output, 'new-HTTP.json')))) throw new Error('New phase requires only completed old evidence');
const expectedContract = process.env.QA_EXPECTED_CONTRACT_SHA256?.toLowerCase();
const expectedStore = process.env.QA_EXPECTED_STORE_SHA256?.toLowerCase();
const hex = /^[0-9a-f]{64}$/;
if (!hex.test(expectedContract ?? '') || !hex.test(expectedStore ?? '')) throw new Error('Expected SHA inputs required');
const source = join(repo, 'services', 'api', 'src', 'aijian_api');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileSha = (path) => sha(readFileSync(path));
if (fileSha(join(source, 'episode_script_contracts.py')) !== expectedContract ||
    fileSha(join(source, 'episode_script_store.py')) !== expectedStore) {
  throw new Error('c19 source differs from protected phase input');
}
const db = join(output, 'workspace.sqlite3');
const beforeDbSha = existsSync(db) ? fileSha(db) : null;
const command = join(repo, '.venv', 'Scripts', 'python.exe');
const args = ['-B', script, phase, output];
const env = { ...process.env, QA_SCRIPT_REPO: repo,
  QA_EXPECTED_CONTRACT_SHA256: expectedContract,
  QA_EXPECTED_STORE_SHA256: expectedStore,
  PYTHONDONTWRITEBYTECODE: '1' };
const child = spawn(command, args, {
  cwd: dirname(output), env, shell: false, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const out = [];
const err = [];
let error = null;
child.stdout.on('data', (chunk) => out.push(chunk));
child.stderr.on('data', (chunk) => err.push(chunk));
child.on('error', (e) => { error = { name: e.name, message: e.message, code: e.code }; });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30000);
const exit = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
clearTimeout(timer);
const stdout = Buffer.concat(out);
const stderr = Buffer.concat(err);
const prefix = existsSync(output) ? join(output, phase) : output + '-' + phase;
writeFileSync(prefix + '-stdout.raw', stdout);
writeFileSync(prefix + '-stderr.raw', stderr);
const receipt = {
  phase, command, args, cwd: dirname(output), pid: child.pid ?? null, exit, error, timed_out: timedOut,
  script_sha256: fileSha(script), contract_sha256: expectedContract,
  store_sha256: expectedStore, db_sha256_before: beforeDbSha,
  db_sha256_after: existsSync(db) ? fileSha(db) : null,
  stdout: { path: prefix + '-stdout.raw', bytes: stdout.length, sha256: sha(stdout) },
  stderr: { path: prefix + '-stderr.raw', bytes: stderr.length, sha256: sha(stderr) },
};
writeFileSync(prefix + '-invocation.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
