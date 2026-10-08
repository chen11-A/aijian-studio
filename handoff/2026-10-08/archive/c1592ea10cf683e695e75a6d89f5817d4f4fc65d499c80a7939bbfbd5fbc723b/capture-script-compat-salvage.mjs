import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const root = import.meta.dirname;
const original = join(root, 'script-compat-old-seed-01');
const script = join(root, 'salvage-script-compat-old.py');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
if (!existsSync(original)) throw new Error('Frozen failed seed is absent');
const expected = new Map([
  ['workspace.sqlite3', '411DCCC6603A8B3CAAF4C8E5A0872CF6F518C7FEFFC341F9CE378DAF6CF4AD18'],
  ['old-HTTP.json', '179F0CCD0FFCBBDAE6E893D435DC1D152684D0BBCA7BE7F4A61107B9CD18E8B9'],
  ['old-invocation.json', 'BEB311380388474194A273ED8EEA09E79EB6FDCAC67F5976576E5813F2F8D1E4'],
  ['old-stderr.raw', 'BA2022733D7F0F6042D1A00FD02315920F612F21B55816F52DB1A3F11C157AFE'],
]);
for (const [name, value] of expected) {
  if (fileSha(join(original, name)) !== value) throw new Error(`Frozen ${name} drifted`);
}
for (const name of ['salvage-invocation.json', 'salvage-stdout.raw', 'salvage-stderr.raw',
                    'baseline.json', 'old-DB-ROWS.json', 'old-workspace-preserved.sqlite3',
                    'old-runtime-get-copy.sqlite3', 'salvage-HTTP.json', 'salvage-result.json']) {
  if (existsSync(join(original, name))) throw new Error(`Output already exists: ${name}`);
}
const command = join(repo, '.venv', 'Scripts', 'python.exe');
const args = ['-B', script, original];
const child = spawn(command, args, {
  cwd: root, env: { ...process.env, QA_SCRIPT_REPO: repo, PYTHONDONTWRITEBYTECODE: '1' },
  shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
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
writeFileSync(join(original, 'salvage-stdout.raw'), stdout);
writeFileSync(join(original, 'salvage-stderr.raw'), stderr);
const receipt = {
  phase: 'old-salvage', command, args, cwd: root, pid: child.pid ?? null,
  exit, error, timed_out: timedOut, script_sha256: fileSha(script),
  original_db_sha256_after: fileSha(join(original, 'workspace.sqlite3')),
  stdout: { bytes: stdout.length, sha256: sha(stdout) },
  stderr: { bytes: stderr.length, sha256: sha(stderr) },
};
writeFileSync(join(original, 'salvage-invocation.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = exit.code ?? 1;
