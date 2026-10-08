import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname;
const repo = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const source = join(repo, 'services', 'api', 'src', 'aijian_api');
const script = join(root, 'capture-test-script-identity.mjs');
const run = join(root, 'script-identity-01');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
const required = new Map([
  [script, '88F7AD1D25FAC9566B8372B35C9B0C60C8EA3A8D18D692252182148D54E0D738'],
  [join(source, 'episode_script_contracts.py'), '0028DB1DB4F2EC9C488E8E58F41BA361EF373E3CFD9617DCD4372C4648E25426'],
  [join(source, 'episode_script_store.py'), 'CD58D0B0F7CE6B1CEAB32D233544246B67A14722F84E4FBD8ACB54C4C651A65E'],
  [join(source, 'media_asset_routes.py'), '931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770'],
  ['C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\art04-mlt-test-20260928\\MLT-唯一合成TEST工程规格.md', '4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D'],
]);
for (const [path, expected] of required) {
  if (fileSha(path) !== expected) throw new Error(`Frozen input drift: ${path}`);
}
if (existsSync(run)) throw new Error('TEST identity run directory already exists');
for (const name of ['script-identity-01-wrapper-stdout.raw', 'script-identity-01-wrapper-stderr.raw',
                    'script-identity-01-invocation.json']) {
  if (existsSync(join(root, name))) throw new Error(`Wrapper output already exists: ${name}`);
}
const child = spawn(process.execPath, [script, run], {
  cwd: root, shell: false, windowsHide: true,
  env: { ...process.env, QA_A_CONTRACT_SHA256: required.get(join(source, 'episode_script_contracts.py')) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const out = [];
const err = [];
let error = null;
child.stdout.on('data', (chunk) => out.push(chunk));
child.stderr.on('data', (chunk) => err.push(chunk));
child.on('error', (e) => { error = { name: e.name, message: e.message, code: e.code }; });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 150000);
const exit = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
clearTimeout(timer);
const stdout = Buffer.concat(out);
const stderr = Buffer.concat(err);
writeFileSync(join(root, 'script-identity-01-wrapper-stdout.raw'), stdout);
writeFileSync(join(root, 'script-identity-01-wrapper-stderr.raw'), stderr);
const receipt = {
  scope: 'SYNTHETIC_TEST_ONLY', command: process.execPath, args: [script, run],
  cwd: root, pid: child.pid ?? null, exit, error, timed_out: timedOut,
  script_sha256: fileSha(script), run_path: run,
  stdout: { bytes: stdout.length, sha256: sha(stdout) },
  stderr: { bytes: stderr.length, sha256: sha(stderr) },
  capture_sha256: existsSync(join(run, 'CAPTURE.json')) ? fileSha(join(run, 'CAPTURE.json')) : null,
  identity_sha256: existsSync(join(run, 'IDENTITY.json')) ? fileSha(join(run, 'IDENTITY.json')) : null,
};
writeFileSync(join(root, 'script-identity-01-invocation.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = exit.code ?? 1;
