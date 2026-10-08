/* Static-only packet builder. Never launches the sidecar or browser. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\native-source-qa-20260924';
const packet = join(base, 'qa02-media-http-headless-r02-20260928');
const old = JSON.parse(readFileSync(join(packet, 'RUN-ENVELOPE.json'), 'utf8'));
const root = old.c19_root;
const inputManifest = old.input_manifest;
const inputIndex = old.input_package_index;
const sourcePath = join(packet, 'SOURCE-FILES.json');
const envelopePath = join(packet, 'RUN-ENVELOPE.json');
const preflightPath = join(packet, 'STATIC-PREFLIGHT.json');
const indexPath = join(packet, 'PACKAGE-SHA256.json');
const approvalPath = join(packet, 'APPROVAL-TEMPLATE.json');
const receiptPath = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\qa03-project-name-source-20260928\\p23-sidecar-gate-v1\\sidecar-01\\RECEIPT.json';
const actualPython = 'C:\\Users\\Administrator\\AppData\\Roaming\\uv\\python\\cpython-3.12-windows-x86_64-none\\python.exe';
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
const file = (role, path) => ({ role, path, bytes: statSync(path).size, sha256: sha(path) });
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8' });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
const status = () => git('status', '--short', '--untracked-files=all').split(/\r?\n/).filter(Boolean);
const head = git('rev-parse', 'HEAD');
const before = status();
const names = execFileSync('rg', ['--files', 'services/api/src/aijian_api', '-g', '*.py'],
  { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).map((name) =>
  name.replaceAll('\\', '/')).sort();
assert.equal(names.length, 137, 'Sidecar Python file set changed');
const files = names.map((name) => ({ path: name,
  bytes: statSync(join(root, name)).size, sha256: sha(join(root, name)) }));
assert.deepEqual(status(), before, 'Git status changed during source hashing');
assert.equal(git('rev-parse', 'HEAD'), head, 'Git HEAD changed');
const source = { schema: 'qa02.media-http-headless.r02.source-files.v1',
  checked_utc: new Date().toISOString(), c19_root: root, git_head: head,
  git_status: before, files, count: files.length };
write(sourcePath, source);

const pins = [
  file('source-manifest', sourcePath),
  file('input-manifest', inputManifest),
  file('input-package-index', inputIndex),
  file('qa03-p23-sidecar-receipt', receiptPath),
  file('edge-exe', old.edge_exe),
  file('node-exe', old.node_exe),
  file('sidecar-python-launcher', old.python_exe),
  file('sidecar-python-actual', actualPython),
  file('playwright-package', join(root, 'node_modules/playwright-core/package.json')),
  file('playwright-entry', join(root, 'node_modules/playwright-core/index.js')),
];
const envelope = {
  schema: 'qa02.media-http-headless.r02.envelope.v1',
  status: 'READY_FOR_EXTERNAL_ONE_SHOT', c19_root: root, git_head: head,
  source_manifest: sourcePath, input_manifest: inputManifest,
  input_package_index: inputIndex, qa03_p23_sidecar_receipt: receiptPath,
  node_exe: old.node_exe, edge_exe: old.edge_exe,
  edge_exe_sha256: pins.find((pin) => pin.role === 'edge-exe').sha256,
  python_exe: old.python_exe, actual_python_exe: actualPython,
  actual_python_sha256: pins.find((pin) => pin.role === 'sidecar-python-actual').sha256,
  profile_dir: join(packet, 'profile-r02'),
  evidence_dir: join(packet, 'evidence-r02'),
  project_name: 'QA02 HTTP headless media r02 20260928',
  sidecar_max_launches: 2, headless_browser_max_launches: 1,
  provider_calls_allowed: 0, electron_visible: 'NOT_RUN', rights_g1: 'NOT_RUN',
  pins,
};
assert.ok(!existsSync(envelope.profile_dir) && !existsSync(envelope.evidence_dir),
  'r02 output already exists');
write(envelopePath, envelope);
execFileSync(old.node_exe, ['--check', join(packet, 'run-once.mjs')], { stdio: 'pipe' });
const input = JSON.parse(readFileSync(inputManifest, 'utf8'));
const inputPackage = JSON.parse(readFileSync(inputIndex, 'utf8'));
assert.equal(input.files.length, 5);
assert.equal(inputPackage.files.length, 13);
for (const item of inputPackage.files) {
  const path = join(resolve(inputIndex, '..'), item.name);
  assert.equal(sha(path), item.sha256, `Input package changed: ${item.name}`);
  assert.equal(statSync(path).size, item.bytes, `Input size changed: ${item.name}`);
}
const preflight = {
  schema: 'qa02.media-http-headless.r02.static-preflight.v1',
  status: 'PASS_STATIC_NOT_APPROVED_NOT_RUN', checked_utc: new Date().toISOString(),
  envelope_sha256: sha(envelopePath), source_manifest_sha256: sha(sourcePath),
  qa03_p23_sidecar_receipt_sha256: sha(receiptPath),
  source_count: files.length, pin_count: pins.length, input_count: input.files.length,
  node_check_exit: 0, profile_absent: true, evidence_absent: true,
  sidecar_runs: 0, browser_runs: 0, electron_runs: 0, provider_calls: 0,
  runner_sha256: sha(join(packet, 'run-once.mjs')),
  sqlite_readback: 'mode=ro_includes_wal',
};
write(preflightPath, preflight);
const index = { schema: 'qa02.media-http-headless.r02.package-index.v1',
  status: 'CANDIDATE_AWAITING_MGR02_SINGLE_SIGN',
  files: ['RUNBOOK.md', 'run-once.mjs', 'SOURCE-FILES.json', 'RUN-ENVELOPE.json',
    'STATIC-PREFLIGHT.json'].map((name) => ({ name,
      bytes: statSync(join(packet, name)).size, sha256: sha(join(packet, name)) })),
  self_excluded: 'PACKAGE-SHA256.json', approval_template_excluded: true };
write(indexPath, index);
const approval = {
  kind: 'QA02_MEDIA_HTTP_HEADLESS_R02_ONE_SHOT', status: 'TEMPLATE_NOT_APPROVED',
  headless_only: true, provider_calls_allowed: 0,
  package_index_sha256: sha(indexPath), envelope_sha256: sha(envelopePath),
  runner_sha256: sha(join(packet, 'run-once.mjs')),
  profile_dir: envelope.profile_dir, evidence_dir: envelope.evidence_dir,
  source_manifest_sha256: sha(sourcePath), max_sidecar_launches: 2,
  max_headless_browser_launches: 1,
};
write(approvalPath, approval);
assert.deepEqual(status(), before, 'Git status drifted during packet build');
for (const item of index.files) {
  assert.equal(sha(join(packet, item.name)), item.sha256, `Packet changed: ${item.name}`);
  assert.equal(statSync(join(packet, item.name)).size, item.bytes);
}
for (const item of pins) assert.equal(sha(item.path), item.sha256, `Pin changed: ${item.role}`);
process.stdout.write(JSON.stringify({ packet, index_sha256: sha(indexPath),
  envelope_sha256: sha(envelopePath), runner_sha256: approval.runner_sha256,
  source_manifest_sha256: sha(sourcePath), git_head: head,
  source_count: files.length, git_status_count: before.length,
  pin_count: pins.length, input_count: input.files.length,
  profile_absent: true, evidence_absent: true }, null, 2) + '\n');
