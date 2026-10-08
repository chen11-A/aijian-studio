import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname;
const script = join(root, 'audit-test-identity-db.py');
const output = join(root, 'script-identity-readback-01');
const sha = (value) => createHash('sha256').update(value).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
if (fileSha(script) !== '8FF72011B414BAE830F2D58A760BDB51AEF386865D4910498255E8D29AE5F46E') {
  throw new Error('Read-only DB audit script drift');
}
for (const name of ['DB-READBACK.json', 'DB-READBACK-stdout.raw',
                    'DB-READBACK-stderr.raw', 'DB-READBACK-invocation.json']) {
  if (existsSync(join(output, name))) throw new Error(`Output exists: ${name}`);
}
const command = join('C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923',
  '.venv', 'Scripts', 'python.exe');
const args = ['-B', script];
const child = spawn(command, args, { cwd: root, env: { ...process.env,
  PYTHONDONTWRITEBYTECODE: '1' }, shell: false, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'] });
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
writeFileSync(join(output, 'DB-READBACK-stdout.raw'), stdout);
writeFileSync(join(output, 'DB-READBACK-stderr.raw'), stderr);
const receipt = { command, args, cwd: root, pid: child.pid ?? null, exit, error,
  timed_out: timedOut, script_sha256: fileSha(script),
  stdout: { bytes: stdout.length, sha256: sha(stdout) },
  stderr: { bytes: stderr.length, sha256: sha(stderr) },
  result_sha256: existsSync(join(output, 'DB-READBACK.json'))
    ? fileSha(join(output, 'DB-READBACK.json')) : null };
writeFileSync(join(output, 'DB-READBACK-invocation.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = exit.code ?? 1;
