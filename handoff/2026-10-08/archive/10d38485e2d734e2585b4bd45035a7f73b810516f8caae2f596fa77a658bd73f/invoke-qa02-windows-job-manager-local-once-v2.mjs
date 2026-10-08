// Capture one approved local test invocation without shell redirection or retries.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const base = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\native-source-qa-20260924';
const script = path.join(base, 'qa02-windows-job-manager-local-once-v2.py');
const python = 'C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
const snapshotRoot = 'C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260928-d-managed-export-integration-candidate-4-1';
const snapshot = path.join(snapshotRoot, 'SNAPSHOT.json');
const sourceManifest = path.join(snapshotRoot, 'SOURCE.json');
const source = path.join(snapshotRoot, 'services', 'api', 'src', 'aijian_api', 'product_export_windows_job.py');
const invocation = path.join(base, 'windows-job-manager-local-invocations', 'qa02-windows-job-manager-local-01');
const result = path.join(base, 'windows-job-manager-local-runs', 'qa02-windows-job-manager-local-01');
const expectedSource = '11A5762844F0C79471DFB46719E00ACC0D951A71FAC4E11F9C58202A2DBACFA2';
const expectedSnapshot = '839074A0F355D42E5AAC2E309184524E10F90C14817EDECB544FC1AE7B6A6CA4';
const expectedSourceManifest = '8879C124F5F722A734AF185C37B31AA6A4409EE6A8F9ED4B58C4F151D6CCDA9D';
const expectedScript = '38F7F8CA7E2C7E2434ADBFA28DCF7D713BB6BF935C40D138F452C7A51C2C82C1';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const flags = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  if (!arg.startsWith('--') || at < 3) throw Error('Expected --name=value');
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
const names = Object.keys(flags).sort();
if (JSON.stringify(names) !== JSON.stringify(['approval', 'approval-sha256'].sort())) {
  throw Error('Expected exact approval path and SHA');
}
const approval = path.resolve(flags.approval);
if (sha(approval) !== flags['approval-sha256'].toUpperCase()) throw Error('Approval SHA changed');
const grant = JSON.parse(fs.readFileSync(approval, 'utf8'));
if (grant.kind !== 'MGR02_QA02_WINDOWS_JOB_MANAGER_LOCAL_ONCE_APPROVAL' ||
    grant.maxAttempts !== 1 || grant.scope !== 'SELF_OWNED_PYTHON_ONLY' ||
    grant.runId !== 'qa02-windows-job-manager-local-01' || grant.resultDirectory !== result ||
    grant.sourceSha256 !== expectedSource || grant.snapshotSha256 !== expectedSnapshot ||
    grant.sourceManifestSha256 !== expectedSourceManifest ||
    grant.scriptSha256 !== expectedScript || sha(script) !== expectedScript ||
    grant.pythonSha256 !== sha(python) ||
    grant.wrapperSha256 !== sha(new URL(import.meta.url)) ||
    sha(source) !== expectedSource || sha(snapshot) !== expectedSnapshot ||
    sha(sourceManifest) !== expectedSourceManifest ||
    fs.existsSync(invocation) || fs.existsSync(result)) {
  throw Error('Approved local test inputs or one-shot target differ');
}
fs.mkdirSync(path.dirname(invocation), { recursive: true });
fs.mkdirSync(invocation, { recursive: false });
const argv = [script, `--approval=${approval}`, `--approval-sha256=${sha(approval)}`];
fs.writeFileSync(path.join(invocation, 'intent.json'), JSON.stringify({
  kind: 'QA02_WINDOWS_JOB_MANAGER_LOCAL_INVOCATION_INTENT', python, argv,
  cwd: base, sourceSha256: expectedSource, snapshotSha256: expectedSnapshot,
  sourceManifestSha256: expectedSourceManifest,
  scriptSha256: expectedScript, wrapperSha256: sha(new URL(import.meta.url)),
  pythonSha256: sha(python), approvalSha256: sha(approval), startedUtc: new Date().toISOString(),
}, null, 2) + '\n', { flag: 'wx' });
const stdoutPath = path.join(invocation, 'stdout.raw');
const stderrPath = path.join(invocation, 'stderr.raw');
const out = fs.openSync(stdoutPath, 'wx');
const err = fs.openSync(stderrPath, 'wx');
let child;
let spawnError = null;
let timeoutFired = false;
let killAccepted = null;
let killError = null;
let graceExpired = false;
try {
  child = spawn(python, argv, {
    cwd: base, windowsHide: true, shell: false, detached: false,
    stdio: ['ignore', out, err], env: process.env,
  });
} catch (error) {
  spawnError = String(error);
}
const completed = child ? await new Promise((resolve) => {
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    clearTimeout(grace);
    resolve(value);
  };
  const timeout = setTimeout(() => {
    timeoutFired = true;
    try {
      // Node's ChildProcess handle targets only this wrapper-created Python.
      // Python owns the private kill-on-close Job for its own helper.
      killAccepted = child.kill();
    } catch (error) {
      killError = String(error);
    }
  }, 40000);
  const grace = setTimeout(() => {
    graceExpired = true;
    child.unref();
    finish({ code: null, signal: null, closeObserved: false });
  }, 45000);
  child.once('error', (error) => {
    spawnError = String(error);
    finish({ code: null, signal: null, closeObserved: false });
  });
  child.once('close', (code, signal) => finish({ code, signal, closeObserved: true }));
}) : { code: null, signal: null, closeObserved: false };
fs.closeSync(out);
fs.closeSync(err);
const innerReceipt = path.join(result, 'receipt.json');
const receipt = {
  kind: 'QA02_WINDOWS_JOB_MANAGER_LOCAL_INVOCATION_RECEIPT', childPid: child?.pid ?? null,
  exitCode: completed.code, signal: completed.signal, spawnError,
  timeoutMs: 40000, graceMs: 5000, timeoutFired, killAccepted, killError,
  graceExpired, closeObserved: completed.closeObserved,
  rawFinal: completed.closeObserved || !child?.pid,
  stdoutPath, stderrPath, stdoutSha256: sha(stdoutPath), stderrSha256: sha(stderrPath),
  innerReceiptSha256: fs.existsSync(innerReceipt) ? sha(innerReceipt) : null,
  finishedUtc: new Date().toISOString(),
  status: graceExpired ? 'TIMEOUT_EXIT_UNKNOWN_RAW_MAY_GROW' :
    timeoutFired ? 'TIMEOUT_OWNED_PYTHON_TERMINATION_REQUESTED' :
    completed.code === 0 && !spawnError ? 'LOCAL_TEST_EXIT_ZERO' : 'FAILED_RAW_PRESERVED_NO_RETRY',
};
fs.writeFileSync(path.join(invocation, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify(receipt) + '\n');
if (completed.code !== 0 || spawnError || timeoutFired) process.exitCode = 1;
