import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const owned = 'C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924';
const evidence = join(owned, 'evidence', 'm1-layout07-native-submit-20260924T040958Z');
const runner = join(owned, 'run-native-bm-click-once.mjs');
const args = [
  `--input=C:/Users/Administrator/Documents/AIVORA/production/inputs/20260924/离别30秒剧本.md`,
  `--snapshot=C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260924-layout07-27/SNAPSHOT.json`,
  `--qa=C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260924-build05-qa-overlay-6/SNAPSHOT.json`,
  `--build=${join(owned, 'evidence', 'm1-layout07-build-20260924T033449449Z', 'postbuild.json')}`,
  '--candidate=211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2',
  '--snapshot-sha256=569E8B63A2545D7178E18B22348330B10D8E5B628410B4E45732E4B3CCFFC21F',
  '--qa-sha256=ED784DE9F7610FBF3D4A767FF2C3B1A716472A72E0AFA5860D33FC66BBD25048',
  '--build-sha256=5B395E855B8502515741345EFCC35A58CE5172EE1A3829437E2BBDE0E133042F',
  '--probe-sha256=19AB699DE57EFB2412D73EDC497C1A1207814B7F25B5ADE6E2B9453C8DFE9AF0',
];
const phase = process.argv[2];
assert.ok(phase === 'preflight' || phase === 'run');
await mkdir(evidence, { recursive: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (phase === 'run') {
  const preflight = JSON.parse(await readFile(join(evidence, 'preflight.json'), 'utf8'));
  assert.equal(preflight.exit_code, 0, 'preflight did not pass');
  assert.equal(preflight.stdout.startsWith('PREFLIGHT_OK '), true, 'preflight output missing');
  assert.equal(sha(await readFile(runner)), 'e646cd1d6017e8f92f19f75fbfa332b917829d06e48f4b61a85385e6f110c45f');
  const guard = join(evidence, 'run-once-intent.json');
  assert.equal(existsSync(guard), false, 'run already armed');
  const handle = await open(guard, 'wx');
  try {
    await handle.writeFile(JSON.stringify({
      armed_utc: new Date().toISOString(),
      runner, runner_sha256: sha(await readFile(runner)),
      args, outcome: 'UNKNOWN_UNTIL_READBACK',
    }, null, 2));
  } finally { await handle.close(); }
}
const started = new Date().toISOString();
const child = spawn(process.execPath, [runner, ...args, ...(phase === 'preflight' ? ['--preflight-only=true'] : [])],
  { cwd: owned, windowsHide: true });
const stdout = [];
const stderr = [];
child.stdout.on('data', (part) => stdout.push(part));
child.stderr.on('data', (part) => stderr.push(part));
let spawnError = null;
child.on('error', (error) => { spawnError = String(error); });
const { code, signal } = await new Promise((resolve) => child.on('close', (exitCode, exitSignal) =>
  resolve({ code: exitCode, signal: exitSignal })));
const out = Buffer.concat(stdout);
const err = Buffer.concat(stderr);
await writeFile(join(evidence, `${phase}.stdout.raw`), out);
await writeFile(join(evidence, `${phase}.stderr.raw`), err);
const receipt = {
  started_utc: started, ended_utc: new Date().toISOString(),
  phase, runner, runner_sha256: sha(await readFile(runner)), args,
  child_pid: child.pid, exit_code: code, signal, spawn_error: spawnError,
  stdout_sha256: sha(out), stderr_sha256: sha(err), stdout: out.toString('utf8'),
};
await writeFile(join(evidence, `${phase}.json`), JSON.stringify(receipt, null, 2));
process.stdout.write(`${phase.toUpperCase()} ${JSON.stringify({ code, signal, spawnError, evidence, stdout: receipt.stdout })}\n`);
if (code !== 0 || spawnError) process.exitCode = 1;
