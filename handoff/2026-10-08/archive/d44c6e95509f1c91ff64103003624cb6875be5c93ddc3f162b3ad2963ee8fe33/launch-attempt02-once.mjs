import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const evidence = import.meta.dirname;
const owned = resolve(evidence, '../..');
const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const expected = {
  approval: '57013b9a15986e84877859782fb0d878c8a8e474b11b088527f7650d0223f713',
  preflight: 'a3eb2f7ea054e2e539bfdbb14b54feaf4cf18ee4fd35c91dcd00aedc0a4345ba',
  runner: '1a322e428fe7582af84b6af1bf8009d3d6ded1abbc7652b3bb43d3e933a7a00a',
  sender: '5d11ea3dd62e803c1947abb2dfde96cba7cf572f82835dea82cedaffa8679265',
  firstLedger: '8c2f15cfc225421736e52c4d4ad4060ba81be5295f3686d634bd420d1a0726b0',
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileHash = (path) => sha(readFileSync(path));
const approvalPath = join(owned, 'attempt02-approval-20260924T044400Z-mgr02b.json');
const preflightPath = join(owned, 'evidence',
  'attempt02-preflight-20260924T044400Z-mgr02b-corrected', 'receipt.json');
const runnerPath = join(owned, 'run-native-bm-click-attempt02.mjs');
const senderPath = join(owned, 'native-bm-click-attempt02.ps1');
const firstLedgerPath = join(owned, 'evidence',
  'bm-click-short-submit-569e8b63a2545d7178e18b22348330b10d8e5b628410b4e45732e4b3ccffc21f.ledger.json');
assert.equal(fileHash(approvalPath), expected.approval);
assert.equal(fileHash(preflightPath), expected.preflight);
assert.equal(fileHash(runnerPath), expected.runner);
assert.equal(fileHash(senderPath), expected.sender);
assert.equal(fileHash(firstLedgerPath), expected.firstLedger);
const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
const preflight = JSON.parse(readFileSync(preflightPath, 'utf8'));
assert.equal(preflight.exit_code, 0);
assert.equal(preflight.approval_sha256, expected.approval);
assert.equal(preflight.runner_sha256, expected.runner);
assert.equal(approval.attempt_id, 'qa02-submit-attempt02-20260924T044400Z-mgr02b');
assert.equal(approval.max_native_send, 1);
assert.equal(approval.idle_floor_ms, 60000);
assert.equal(approval.sender_sha256, expected.sender);
assert.equal(approval.attempt02_runner_sha256, expected.runner);
assert.equal(preflight.argv.at(-1), '--preflight-only=true');
assert.equal(preflight.argv[0], 'run-native-bm-click-attempt02.mjs');
const args = [runnerPath, ...preflight.argv.slice(1, -1)];
assert.equal(args.length, preflight.argv.length - 1);
assert.ok(args.every((arg) => !arg.startsWith('--preflight-only=')));
const innerEvidence = join(owned, 'evidence', approval.attempt_id);
const innerLedger = join(owned, 'evidence',
  `bm-click-short-submit-${approval.snapshot_sha256}-attempt02-${approval.attempt_id}.ledger.json`);
const profile = join(repo, '.aijian-dev', approval.attempt_id);
assert.equal(existsSync(innerEvidence), false, 'attempt evidence already exists');
assert.equal(existsSync(innerLedger), false, 'attempt ledger already exists');
assert.equal(existsSync(profile), false, 'attempt profile already exists');
const prelaunch = JSON.parse(readFileSync(join(evidence, 'prelaunch-readonly.json'), 'utf8'));
assert.ok(prelaunch.idle_ms >= 60000, 'prelaunch recent user input');
assert.equal(prelaunch.related_processes.length, 0, 'c19 process already running');
assert.equal(prelaunch.foreground.session_id, prelaunch.probe_session_id,
  'foreground session mismatch');
assert.equal(prelaunch.foreground.desktop_name, prelaunch.probe_desktop_name,
  'foreground desktop mismatch');
const intent = {
  kind: 'QA02_ATTEMPT02_ONE_LAUNCH_INTENT', created_utc: new Date().toISOString(),
  attempt_id: approval.attempt_id, approval_path: approvalPath, approval_sha256: expected.approval,
  preflight_path: preflightPath, preflight_sha256: expected.preflight,
  runner_path: runnerPath, runner_sha256: expected.runner,
  sender_path: senderPath, sender_sha256: expected.sender,
  first_ledger_sha256: expected.firstLedger, prelaunch_path: join(evidence, 'prelaunch-readonly.json'),
  prelaunch_sha256: fileHash(join(evidence, 'prelaunch-readonly.json')),
  executable: process.execPath, argv: args, inner_evidence: innerEvidence,
  inner_ledger: innerLedger, profile, outcome: 'UNKNOWN_UNTIL_AUTHORITATIVE_READBACK',
};
const handle = await open(join(evidence, 'launch-intent.json'), 'wx');
try { await handle.writeFile(JSON.stringify(intent, null, 2)); }
finally { await handle.close(); }
const child = spawn(process.execPath, args, { cwd: owned, windowsHide: true });
const stdoutParts = []; const stderrParts = [];
child.stdout.on('data', (part) => stdoutParts.push(part));
child.stderr.on('data', (part) => stderrParts.push(part));
let spawnError = null;
child.on('error', (error) => { spawnError = String(error); });
const exit = await new Promise((complete) => child.on('close', (code, signal) =>
  complete({ code, signal })));
const stdout = Buffer.concat(stdoutParts); const stderr = Buffer.concat(stderrParts);
await writeFile(join(evidence, 'run.stdout.raw'), stdout);
await writeFile(join(evidence, 'run.stderr.raw'), stderr);
const receipt = { kind: 'QA02_ATTEMPT02_OUTER_PROCESS_RECEIPT',
  finished_utc: new Date().toISOString(), attempt_id: approval.attempt_id,
  child_pid: child.pid, ...exit, spawn_error: spawnError,
  stdout_sha256: sha(stdout), stderr_sha256: sha(stderr),
  inner_evidence: innerEvidence, inner_ledger: innerLedger, profile };
await writeFile(join(evidence, 'run.json'), JSON.stringify(receipt, null, 2));
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (exit.code !== 0 || spawnError) process.exitCode = 1;
