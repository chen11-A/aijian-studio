import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname;
const repo = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const script = join(root, 'verify-script-history-restart.py');
const run = join(root, 'script-history-restart-01');
const sha = (value) => createHash('sha256').update(value).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
if (fileSha(script) !== 'EB965CF038CE52A99367C5EE77960816A1DCB8EFCACD62365FDF87501C15D29C') {
  throw new Error('History restart script drift');
}
if (existsSync(run)) throw new Error('History restart run directory already exists');
for (const name of ['script-history-restart-01-stdout.raw',
                    'script-history-restart-01-stderr.raw',
                    'script-history-restart-01-invocation.json']) {
  if (existsSync(join(root, name))) throw new Error(`Output exists: ${name}`);
}
const command = join(repo, '.venv', 'Scripts', 'python.exe');
const args = ['-B', script];
const child = spawn(command, args, { cwd: root,
  env: { ...process.env, QA_SCRIPT_REPO: repo, PYTHONDONTWRITEBYTECODE: '1' },
  shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
writeFileSync(join(root, 'script-history-restart-01-stdout.raw'), stdout);
writeFileSync(join(root, 'script-history-restart-01-stderr.raw'), stderr);
const receipt = { mode: 'GET_ONLY_NEW_PROCESS', command, args, cwd: root,
  pid: child.pid ?? null, exit, error, timed_out: timedOut,
  script_sha256: fileSha(script), run_path: run,
  stdout: { bytes: stdout.length, sha256: sha(stdout) },
  stderr: { bytes: stderr.length, sha256: sha(stderr) },
  http_sha256: existsSync(join(run, 'HTTP.json')) ? fileSha(join(run, 'HTTP.json')) : null,
  result_sha256: existsSync(join(run, 'RESULT.json')) ? fileSha(join(run, 'RESULT.json')) : null };
writeFileSync(join(root, 'script-history-restart-01-invocation.json'),
  JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = exit.code ?? 1;
