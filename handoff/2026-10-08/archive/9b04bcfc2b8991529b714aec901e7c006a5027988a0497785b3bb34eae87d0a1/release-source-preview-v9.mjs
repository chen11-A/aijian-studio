/* Read-only release audit for the stopped QA02 v9 native attempt. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const work = resolve(import.meta.dirname);
const runId = 'qa02-source-preview-20260928T024337Z-qa02a';
const planPath = join(work, `native-source-preview-plan-${runId}.json`);
const expectedPlanSha = 'F00CB559B638124B66A9637C717F6260AD543F8799EF1831186CEAC16B8F69A6';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
assert.equal(fileSha(planPath), expectedPlanSha);
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
assert.equal(plan.runId, runId);
const evidence = resolve(plan.evidenceDir);
const releasePath = join(evidence, 'window-release.json');
assert.ok(!existsSync(releasePath));
const result = JSON.parse(readFileSync(join(evidence, 'result.json'), 'utf8'));
const native = JSON.parse(readFileSync(join(evidence,
  'native-g1-submit-once.json'), 'utf8'));
const db = JSON.parse(readFileSync(join(evidence, 'db-readback.json'), 'utf8'));
assert.equal(result.status, 'STOP_OR_UNKNOWN');
assert.equal(result.launches.length, 1);
assert.equal(result.launches[0].status, 'FAILED');
assert.equal(result.launches[0].layoutSamples?.length ?? 0, 0);
assert.equal(native.status, 'STOP_BEFORE_NATIVE_SEND');
assert.equal(native.native_action_attempted, false);
assert.equal(native.focus_attempted, false);
assert.equal(db.projects.length, 1);
assert.equal(db.source_documents.length, 1);
assert.equal(db.source_heads.length, 1);
assert.equal(db.source_heads[0][1], null);
assert.equal(db.source_heads[0][2], null);
assert.deepEqual(db.challenges, [['G1', 'submit', null]]);
assert.equal(db.review_submissions, 0);
assert.equal(db.provider_connections, 0);
assert.equal(db.provider_approvals, 0);
assert.equal(db.provider_consumptions, 0);
assert.equal(db.integrity, 'ok');
assert.deepEqual(db.foreign_key_errors, []);
const root = resolve(plan.root);
const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' }).trim();
const gitStatus = execFileSync('git',
  ['-C', root, 'status', '--short', '--untracked-files=all'],
  { encoding: 'utf8' });
assert.equal(head, plan.head);
assert.equal(gitStatus, plan.gitStatus);
const mismatches = [];
for (const item of plan.files) {
  const bytes = readFileSync(join(root, item.path));
  if (bytes.length !== item.bytes || sha(bytes) !== item.sha256)
    mismatches.push(item.path);
}
assert.equal(plan.files.length, 197);
assert.deepEqual(mismatches, []);
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const helper = join(work, 'native-project-os-readonly.ps1');
const os = JSON.parse(execFileSync(powershell,
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-RootPath', root, '-ProfilePath', plan.profile,
    '-TargetLauncherPid', String(result.launches[0].launcherPid),
    '-TargetHwnd', '0', '-CheckLocks'],
  { encoding: 'utf8', timeout: 15000 }));
assert.equal(os.relatedProcesses.length, 0);
assert.ok(os.lockFiles.every((item) => item.exclusiveRead === true));
const invocation = join(work, 'invocations', runId, 'receipt.json');
const artifacts = Object.fromEntries([
  'result.json', 'events.jsonl', 'launch1-ready.png',
  'launch1-failure.png', 'native-g1-submit-once.json',
  'native-g1-submit.stdout.raw', 'native-g1-submit.stderr.raw',
  'db-readback.json',
].map((name) => [name, fileSha(join(evidence, name))]));
artifacts['invocation.receipt.json'] = fileSha(invocation);
const release = {
  kind: 'QA02_SOURCE_PREVIEW_V9_WINDOW_RELEASE', runId,
  utc: new Date().toISOString(), planSha256: expectedPlanSha,
  status: 'RELEASED_AFTER_PRE_SEND_STOP', head,
  statusCount: gitStatus.trimEnd().split(/\r?\n/).filter(Boolean).length,
  fileCount: plan.files.length, fileMismatches: mismatches,
  relatedProcesses: os.relatedProcesses, locks: os.lockFiles,
  profile: plan.profile, databaseSha256: db.database_sha256,
  nativeStatus: native.status, nativeActionAttempted: native.native_action_attempted,
  reviewSubmissions: db.review_submissions,
  artifacts,
};
writeFileSync(releasePath, JSON.stringify(release, null, 2) + '\n',
  { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ releasePath,
  releaseSha256: fileSha(releasePath), status: release.status,
  fileCount: release.fileCount, relatedProcessCount: 0 }) + '\n');
