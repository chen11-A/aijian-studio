import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const root = import.meta.dirname;
const evidence = join(root, 'script-compat-old-seed-01');
const script = join(root, 'verify-script-compat-new.py');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
const required = new Map([
  [join(evidence, 'workspace.sqlite3'), '411DCCC6603A8B3CAAF4C8E5A0872CF6F518C7FEFFC341F9CE378DAF6CF4AD18'],
  [join(evidence, 'baseline.json'), '8E2D100B024F7D4C58EA2945AD59F44687D374DB4326E7F50E14BB093AB15348'],
  [join(evidence, 'old-DB-ROWS.json'), '7F908FB868EF87AEF2E2A142C470CD55FEE508D80EEED07D41524EBC6B01C0C5'],
  [join(evidence, 'old-workspace-preserved.sqlite3'), '9D34163EC02A2FEA2C60E3010F0F9D02312FD9DC3C82524C0B20A56B93FBB29C'],
  [join(repo, 'services', 'api', 'src', 'aijian_api', 'episode_script_contracts.py'), '0028DB1DB4F2EC9C488E8E58F41BA361EF373E3CFD9617DCD4372C4648E25426'],
  [join(repo, 'services', 'api', 'src', 'aijian_api', 'episode_script_store.py'), 'CD58D0B0F7CE6B1CEAB32D233544246B67A14722F84E4FBD8ACB54C4C651A65E'],
]);
for (const [path, expected] of required) {
  if (fileSha(path) !== expected) throw new Error(`Frozen input drift: ${path}`);
}
for (const name of ['new-invocation.json', 'new-stdout.raw', 'new-stderr.raw',
                    'new-HTTP.json', 'new-result.json']) {
  if (existsSync(join(evidence, name))) throw new Error(`New output already exists: ${name}`);
}
const command = join(repo, '.venv', 'Scripts', 'python.exe');
const args = ['-B', script, evidence];
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
writeFileSync(join(evidence, 'new-stdout.raw'), stdout);
writeFileSync(join(evidence, 'new-stderr.raw'), stderr);
const receipt = {
  phase: 'new', command, args, cwd: root, pid: child.pid ?? null,
  exit, error, timed_out: timedOut, script_sha256: fileSha(script),
  db_sha256_after: fileSha(join(evidence, 'workspace.sqlite3')),
  stdout: { bytes: stdout.length, sha256: sha(stdout) },
  stderr: { bytes: stderr.length, sha256: sha(stderr) },
};
writeFileSync(join(evidence, 'new-invocation.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = exit.code ?? 1;
