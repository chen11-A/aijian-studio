/* One approved offline freeze, with durable raw stdout/stderr and no retry. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const work = resolve(import.meta.dirname);
const qaRoot = resolve('C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa02-mlt-test-20260928');
const output = join(qaRoot, 'five-inputs-20260928T035901Z');
const script = join(work, 'freeze-mlt-five-inputs-v1.mjs');
const planPath = join(work, 'mlt-five-input-freeze-plan-20260928.md');
const fourPath = join(qaRoot, 'four-media-20260928T022740Z', 'four-media-manifest.json');
const identityPath = resolve('C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa01-mlt-20260928/script-identity-readback-01/IDENTITY-READBACK.json');
const capturePath = resolve('C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa01-mlt-20260928/script-identity-readback-01/CAPTURE.json');
const scriptSha = '1FB688C7696D7E5C5670FD0EA2CC9AD4317ECCF9E34A9E3BE63D566E6C02F730';
const fourSha = '211DDD8872F1DE47A569849C7A6AE9763D125DF6BAE9F8416534976C5B83FF78';
const identitySha = '67E4DAD955BC59EC573ADE5CD2373678738797CEC22022DFC4B0CC7798B4D32E';
const captureSha = '33B1E446820C663126D241F2ADB7C07B3E51E29F565EE02E8FDD429ECDB87F2A';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  assert.ok(arg.startsWith('--') && at > 2, 'Invalid argument');
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
assert.deepEqual(Object.keys(args).sort(), ['approval', 'approval-sha256']);
assert.match(args['approval-sha256'], /^[0-9a-f]{64}$/i);
const approvalPath = resolve(args.approval);
assert.equal(fileSha(approvalPath), args['approval-sha256'].toUpperCase());
const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
assert.equal(approval.kind, 'MGR02_QA02_MLT_FIVE_INPUT_FREEZE_APPROVAL');
assert.equal(approval.scope, 'SYNTHETIC_TEST_ONLY');
assert.equal(approval.maxAttempts, 1);
assert.equal(approval.output, output);
assert.equal(approval.noMlt, true);
assert.equal(approval.planSha256, fileSha(planPath));
assert.equal(approval.wrapperSha256, fileSha(import.meta.filename));
assert.equal(approval.scriptSha256, scriptSha);
assert.equal(approval.fourManifestSha256, fourSha);
assert.equal(approval.qa01IdentitySha256, identitySha);
assert.equal(approval.qa01CaptureSha256, captureSha);
assert.equal(fileSha(script), scriptSha);
assert.equal(fileSha(fourPath), fourSha);
assert.equal(fileSha(identityPath), identitySha);
assert.equal(fileSha(capturePath), captureSha);
assert.ok(!existsSync(output), 'Five-input output already exists');

const invocationRoot = join(qaRoot, 'invocations');
await mkdir(invocationRoot, { recursive: true });
const receiptDir = join(invocationRoot, 'five-inputs-20260928T035901Z');
await mkdir(receiptDir, { recursive: false });
const childArgs = [script,
  '--mode=freeze',
  '--four-manifest=' + fourPath, '--four-sha256=' + fourSha,
  '--qa01-identity=' + identityPath, '--qa01-identity-sha256=' + identitySha,
  '--qa01-capture=' + capturePath, '--qa01-capture-sha256=' + captureSha,
  '--output=' + output];
const startedUtc = new Date().toISOString();
const intent = { kind: 'QA02_MLT_FIVE_INPUT_FREEZE_INTENT',
  startedUtc, output, script, scriptSha256: scriptSha,
  wrapperSha256: fileSha(import.meta.filename),
  planPath, planSha256: fileSha(planPath),
  approvalPath, approvalSha256: fileSha(approvalPath),
  executable: process.execPath, executableSha256: fileSha(process.execPath),
  args: childArgs, cwd: work, maxAttempts: 1,
  outcome: 'UNKNOWN_UNTIL_READBACK' };
await writeFile(join(receiptDir, 'intent.json'),
  JSON.stringify(intent, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
const stdoutPath = join(receiptDir, 'stdout.raw');
const stderrPath = join(receiptDir, 'stderr.raw');
const out = openSync(stdoutPath, 'wx', 0o600);
const err = openSync(stderrPath, 'wx', 0o600);
let child;
let spawnError = null;
try {
  child = spawn(process.execPath, childArgs, {
    cwd: work, windowsHide: true, shell: false,
    stdio: ['ignore', out, err],
  });
} catch (error) {
  spawnError = { name: error.name, code: error.code ?? null,
    message: String(error.message ?? error) };
} finally {
  closeSync(out);
  closeSync(err);
}
let code = null;
let signal = null;
if (child) {
  child.once('error', (error) => {
    spawnError = { name: error.name, code: error.code ?? null,
      message: String(error.message ?? error) };
  });
  ({ code, signal } = await new Promise((done) => child.once('close',
    (exitCode, exitSignal) => done({ code: exitCode, signal: exitSignal }))));
}
const manifestPath = join(output, 'five-input-manifest.json');
const receipt = { kind: 'QA02_MLT_FIVE_INPUT_FREEZE_RECEIPT',
  startedUtc, finishedUtc: new Date().toISOString(),
  scriptSha256: scriptSha, wrapperSha256: fileSha(import.meta.filename),
  planSha256: fileSha(planPath), approvalSha256: fileSha(approvalPath),
  childPid: child?.pid ?? null, exitCode: code, signal, spawnError,
  stdoutPath, stdoutSha256: fileSha(stdoutPath),
  stderrPath, stderrSha256: fileSha(stderrPath),
  output, manifestPath: existsSync(manifestPath) ? manifestPath : null,
  manifestSha256: existsSync(manifestPath) ? fileSha(manifestPath) : null,
  status: code === 0 && !spawnError && existsSync(manifestPath)
    ? 'FIVE_INPUTS_FROZEN_NO_MLT' : 'FAILED_RAW_PRESERVED_NO_RETRY' };
await writeFile(join(receiptDir, 'receipt.json'),
  JSON.stringify(receipt, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ receiptDir,
  receiptSha256: fileSha(join(receiptDir, 'receipt.json')),
  status: receipt.status, manifestSha256: receipt.manifestSha256 }) + '\n');
if (receipt.status !== 'FIVE_INPUTS_FROZEN_NO_MLT') process.exitCode = 1;
