import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname;
const script = join(root, 'readback-test-script-identity.mjs');
const run = join(root, 'script-identity-readback-01');
const sha = (value) => createHash('sha256').update(value).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
if (fileSha(script) !== '0E32CAD9C1A8A0892A9A83D0A5C89FD45F3B20773B8251BA03E9773C5A5AC8B8') {
  throw new Error('GET-only script drift');
}
if (existsSync(run)) throw new Error('GET-only run directory already exists');
for (const name of ['script-identity-readback-01-stdout.raw',
                    'script-identity-readback-01-stderr.raw',
                    'script-identity-readback-01-invocation.json']) {
  if (existsSync(join(root, name))) throw new Error(`Wrapper output exists: ${name}`);
}
const child = spawn(process.execPath, [script], {
  cwd: root, env: process.env, shell: false, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const out = [];
const err = [];
let error = null;
child.stdout.on('data', (chunk) => out.push(chunk));
child.stderr.on('data', (chunk) => err.push(chunk));
child.on('error', (e) => { error = { name: e.name, message: e.message, code: e.code }; });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 80000);
const exit = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
clearTimeout(timer);
const stdout = Buffer.concat(out);
const stderr = Buffer.concat(err);
writeFileSync(join(root, 'script-identity-readback-01-stdout.raw'), stdout);
writeFileSync(join(root, 'script-identity-readback-01-stderr.raw'), stderr);
const receipt = {
  scope: 'SYNTHETIC_TEST_ONLY', mode: 'GET_ONLY_RESTART', command: process.execPath,
  args: [script], cwd: root, pid: child.pid ?? null, exit, error, timed_out: timedOut,
  script_sha256: fileSha(script), output: run,
  stdout: { bytes: stdout.length, sha256: sha(stdout) },
  stderr: { bytes: stderr.length, sha256: sha(stderr) },
  capture_sha256: existsSync(join(run, 'CAPTURE.json')) ? fileSha(join(run, 'CAPTURE.json')) : null,
  identity_sha256: existsSync(join(run, 'IDENTITY-READBACK.json'))
    ? fileSha(join(run, 'IDENTITY-READBACK.json')) : null,
};
writeFileSync(join(root, 'script-identity-readback-01-invocation.json'),
  JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = exit.code ?? 1;
