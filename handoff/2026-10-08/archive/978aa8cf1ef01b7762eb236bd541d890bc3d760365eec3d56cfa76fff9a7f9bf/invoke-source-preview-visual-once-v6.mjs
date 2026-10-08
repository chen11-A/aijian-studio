/* One-shot external invocation receipt for the MGR02-approved native visual run. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const work = resolve(import.meta.dirname);
const runId = 'qa02-source-preview-20260928T013557Z-qa02a';
const planPath = join(work, 'native-source-preview-plan-' + runId + '.json');
const runner = join(work, 'native-source-preview-visual-once-v6.mjs');
const helper = join(work, 'native-project-os-readonly.ps1');
const nativeHelper = join(work, 'native-bm-click-once-g1-v3.ps1');
const planSha = '0BDC1BDBB0AC4A13176198447C6C8C4CDED30338A61F396481C6A58B5A32C8DA';
const runnerSha = '778F56A3E3FA7F5ED53DB63F181BC8E760CFF7AC626FF9CFCC993E4EEDDF1041';
const helperSha = '1B10779A2B305F6C3805C1CFCE5F30E363CFA1A7DC7FE2229E1EF5F855158476';
const nativeHelperSha = 'FC9C7AF49529C9ED002B2CF9266519922D011802399E3C1A35155182D40FFF65';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  assert.ok(arg.startsWith('--') && at > 2, 'Invalid option');
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
assert.deepEqual(Object.keys(options).sort(), ['approval', 'approval-sha256']);
assert.match(options['approval-sha256'], /^[0-9a-f]{64}$/i);
const approvalPath = resolve(options.approval);
const approvalSha = sha(readFileSync(approvalPath));
assert.equal(approvalSha, options['approval-sha256'].toUpperCase());
assert.equal(sha(readFileSync(planPath)), planSha);
assert.equal(sha(readFileSync(runner)), runnerSha);
assert.equal(sha(readFileSync(helper)), helperSha);
assert.equal(sha(readFileSync(nativeHelper)), nativeHelperSha);
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
assert.equal(plan.runId, runId);
assert.equal(approval.kind, 'MGR02_QA02_SOURCE_PREVIEW_VISUAL_G1_SUBMIT_APPROVAL');
assert.equal(approval.runId, runId);
assert.equal(approval.planSha256.toUpperCase(), planSha);
assert.equal(approval.runnerSha256.toUpperCase(), runnerSha);
assert.equal(approval.helperSha256.toUpperCase(), helperSha);
assert.equal(approval.nativeHelperSha256.toUpperCase(), nativeHelperSha);
assert.equal(approval.maxLaunches, 2);
assert.equal(approval.maxFocusAttempts, 1);
assert.equal(approval.maxNativeSubmitAttempts, 1);
assert.equal(existsSync(plan.profile), false, 'Profile already exists');
assert.equal(existsSync(plan.evidenceDir), false, 'Evidence directory already exists');

const invocations = join(work, 'invocations');
await mkdir(invocations, { recursive: true });
const receiptDir = join(invocations, runId);
await mkdir(receiptDir, { recursive: false });
const intentPath = join(receiptDir, 'run-once-intent.json');
const intent = await open(intentPath, 'wx');
try {
  await intent.writeFile(JSON.stringify({
    utc: new Date().toISOString(), runId, planPath, planSha,
    runner, runnerSha, helperSha, nativeHelperSha, approvalPath, approvalSha,
    outcome: 'UNKNOWN_UNTIL_READBACK',
  }, null, 2));
} finally { await intent.close(); }

const args = [runner,
  '--plan=' + planPath, '--plan-sha256=' + planSha,
  '--approval=' + approvalPath, '--approval-sha256=' + approvalSha];
const startedUtc = new Date().toISOString();
const child = spawn(process.execPath, args, { cwd: work, windowsHide: true });
const stdoutParts = [];
const stderrParts = [];
child.stdout.on('data', (part) => stdoutParts.push(part));
child.stderr.on('data', (part) => stderrParts.push(part));
let spawnError = null;
child.on('error', (error) => { spawnError = String(error); });
const { code, signal } = await new Promise((done) =>
  child.on('close', (exitCode, exitSignal) => done({ code: exitCode, signal: exitSignal })));
const stdout = Buffer.concat(stdoutParts);
const stderr = Buffer.concat(stderrParts);
await writeFile(join(receiptDir, 'stdout.raw'), stdout);
await writeFile(join(receiptDir, 'stderr.raw'), stderr);
const receipt = { runId, startedUtc, finishedUtc: new Date().toISOString(),
  planPath, planSha, runner, runnerSha, helperSha, nativeHelperSha,
  approvalPath, approvalSha,
  childPid: child.pid, exitCode: code, signal, spawnError,
  stdoutSha256: sha(stdout), stderrSha256: sha(stderr),
  evidenceDir: plan.evidenceDir };
await writeFile(join(receiptDir, 'receipt.json'),
  JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify({ receiptDir, ...receipt }) + '\n');
if (code !== 0 || spawnError) process.exitCode = 1;
