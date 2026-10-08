/* Static-only r04 packet freezer. Never starts sidecar, Edge, or Electron. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((part) => {
  const at = part.indexOf('=');
  assert.ok(part.startsWith('--') && at > 2, `Bad argument ${part}`);
  return [part.slice(2, at), part.slice(at + 1)];
}));
assert.ok(args.postflight && args['postflight-sha256'],
  'MGR04 postflight path and SHA required');
const base = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\native-source-qa-20260924';
const pkg = join(base, 'qa02-media-short-headless-r04-20260928');
const r02 = join(base, 'qa02-media-http-headless-r02-20260928');
const root = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const sourceDir = join(root, 'services', 'api', 'src', 'aijian_api');
const sourcePath = join(pkg, 'SOURCE-FILES.json');
const envelopePath = join(pkg, 'RUN-ENVELOPE.json');
const preflightPath = join(pkg, 'STATIC-PREFLIGHT.json');
const indexPath = join(pkg, 'PACKAGE-SHA256.json');
const approvalPath = join(pkg, 'APPROVAL-TEMPLATE.json');
const old = JSON.parse(readFileSync(join(r02, 'RUN-ENVELOPE.json'), 'utf8'));
const qa01Static = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\qa01-mlt-20260928\\C19-LONGPATH-TWO-SOURCE-STATIC.json';
const qa01Readback = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\qa01-mlt-20260928\\C19-TWO-SOURCE-PREFLIGHT-READBACK.json';
const mgr04Preflight = 'C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260928-c19-longpath-two-source-preflight-1\\PREFLIGHT.json';
const r02Db = join(r02, 'profile-r02', 'data', 'workspace.sqlite3');
const expected = {
  helper: '78FCCE4F28FF720F6610AB72EEC2C5C5AB179E7BEB758B980610303B7CA9D7AC',
  store: '2954042D87754211526891A5CC3506DD55DCA78CBB349FC44D19D54FDDC105B8',
  route: '931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770',
  repository: 'BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69',
  qa01Static: 'CAD331743083818AC808BE674D99430D74066C3FB7F85E57DCA92A380B937113',
  qa01Readback: '558390B3525EDD57696C7D8AA2E4BF7BB9C6041A62F91B4F4D5D31E2BFC14677',
  mgr04Preflight: 'D30EFC9E24513AE6EA2C6BBFB98308E3FAEA10C9F795A9F8E61549BE3944E6B0',
  r02Db: '5E9687CFBBBB83672A73F78B09D732513895A31CF19079E2DFD3E91065D71F09',
};
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
const checked = (path, expectedSha, label) =>
  assert.equal(sha(path), expectedSha, `${label} SHA`);
const file = (role, path) => ({ role, path, bytes: statSync(path).size,
  sha256: sha(path) });
const write = (path, value) => writeFileSync(path,
  JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8' });
const git = (...params) => execFileSync('git', params,
  { cwd: root, encoding: 'utf8' }).trimEnd();
const status = () => git('status', '--short', '--untracked-files=all')
  .split(/\r?\n/).filter(Boolean);

const postflight = resolve(args.postflight);
checked(postflight, args['postflight-sha256'].toUpperCase(), 'MGR04 postflight');
checked(mgr04Preflight, expected.mgr04Preflight, 'MGR04 preflight');
checked(qa01Static, expected.qa01Static, 'QA01 static review');
checked(qa01Readback, expected.qa01Readback, 'QA01 preflight readback');
const helper = join(sourceDir, 'managed_local_paths.py');
const store = join(sourceDir, 'media_asset_store.py');
const route = join(sourceDir, 'media_asset_routes.py');
const repository = join(sourceDir, 'repository.py');
checked(helper, expected.helper, 'New helper');
checked(store, expected.store, 'New store');
checked(route, expected.route, 'Unchanged route');
checked(repository, expected.repository, 'Schema26 repository');
checked(r02Db, expected.r02Db, 'Frozen r02 DB read-only selftest input');
const profile = 'C:\\Users\\Administrator\\Documents\\Codex\\qa02-r04-short-profile-20260928';
const evidence = join(pkg, 'evidence-r04');
assert.ok(!existsSync(profile) && !existsSync(evidence), 'r04 output already exists');
const webm = JSON.parse(readFileSync(old.input_manifest, 'utf8')).files.find(
  (item) => item.role === 'webm');
const blob = join(profile, 'data', 'media-assets', 'blobs',
  webm.sha256.slice(0, 2).toLowerCase(), webm.sha256.toLowerCase());
assert.equal(blob.length, 162, 'Short profile blob path length');
const inputIndex = JSON.parse(readFileSync(old.input_package_index, 'utf8'));
assert.equal(inputIndex.files.length, 13);
for (const item of inputIndex.files) {
  const path = join(resolve(old.input_package_index, '..'), item.name);
  checked(path, item.sha256, `Input package ${item.name}`);
  assert.equal(statSync(path).size, item.bytes);
}
execFileSync(old.node_exe, ['--check', join(pkg, 'run-once.mjs')], { stdio: 'pipe' });
const pyCheck = spawnSync(old.python_exe,
  ['-I', '-B', join(pkg, 'inspect-db.py'), r02Db],
  { cwd: root, windowsHide: true, timeout: 15000, encoding: 'utf8' });
assert.equal(pyCheck.status, 0, `DB selftest failed: ${pyCheck.stderr}`);
const rows = JSON.parse(pyCheck.stdout);
assert.deepEqual(rows, { integrity: 'ok', media_asset_episode_references: 0,
  media_asset_versions: 0, media_assets: 0, projects: 1,
  provider_connections: 0, sub2api_call_approvals: 0,
  sub2api_call_consumptions: 0, user_version: 26 },
  'DB selftest rows');
const p23 = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\qa03-project-name-source-20260928\\p23-sidecar-gate-v1\\sidecar-01\\RECEIPT.json';
checked(p23, 'A68F4FF76254CD32D9E1C8AC1E657DD25F651F6811494DD92635A3ACB5CA8850',
  'P23 PID baseline');
const p23Data = JSON.parse(readFileSync(p23, 'utf8'));
assert.equal(p23Data.launches.length, 2, 'P23 launch count');
for (const run of p23Data.launches) {
  assert.notEqual(run.launcherPid, run.sidecarPid, 'Windows venv redirector');
  assert.equal(run.sidecarParentPid, run.launcherPid, 'P23 parent-child');
  assert.deepEqual(run.afterCloseProcesses, [], 'P23 close process state');
}
const head = git('rev-parse', 'HEAD');
const before = status();
const names = execFileSync('rg', ['--files', 'services/api/src/aijian_api',
  '-g', '*.py'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/)
  .filter(Boolean).map((name) => name.replaceAll('\\', '/')).sort();
assert.ok(names.length >= 138, 'Expected new helper in sidecar source set');
const source = { schema: 'qa02.media-short-headless.r04.source-files.v1',
  checked_utc: new Date().toISOString(), c19_root: root, git_head: head,
  git_status: before, files: names.map((name) => ({ path: name,
    bytes: statSync(join(root, name)).size, sha256: sha(join(root, name)) })),
  count: names.length };
assert.deepEqual(status(), before, 'Git status drift while hashing');
write(sourcePath, source);
const pins = [
  file('source-manifest', sourcePath), file('mgr04-postflight', postflight),
  file('mgr04-preflight', mgr04Preflight), file('qa01-static', qa01Static),
  file('qa01-readback', qa01Readback), file('p23-pid-baseline', p23),
  file('helper', helper), file('store', store), file('route', route),
  file('repository', repository), file('input-manifest', old.input_manifest),
  file('input-package-index', old.input_package_index),
  file('node-exe', old.node_exe), file('sidecar-python-launcher', old.python_exe),
  file('sidecar-python-actual', old.actual_python_exe),
  file('edge-exe', old.edge_exe),
  file('playwright-package', join(root, 'node_modules/playwright-core/package.json')),
  file('playwright-entry', join(root, 'node_modules/playwright-core/index.js')),
];
const envelope = {
  schema: 'qa02.media-short-headless.r04.envelope.v1',
  status: 'READY_FOR_EXTERNAL_ONE_SHOT', c19_root: root, git_head: head,
  source_manifest: sourcePath, mgr04_postflight: postflight,
  expected_helper_sha256: expected.helper, expected_store_sha256: expected.store,
  expected_route_sha256: expected.route,
  expected_repository_sha256: expected.repository,
  input_manifest: old.input_manifest, input_package_index: old.input_package_index,
  node_exe: old.node_exe, python_exe: old.python_exe,
  actual_python_exe: old.actual_python_exe,
  actual_python_sha256: sha(old.actual_python_exe),
  edge_exe: old.edge_exe, edge_exe_sha256: sha(old.edge_exe),
  profile_dir: profile, evidence_dir: evidence,
  project_name: 'QA02 short HTTP headless media r04 20260928',
  sidecar_max_launches: 2, headless_browser_max_launches: 1,
  provider_calls_allowed: 0, electron_visible: 'NOT_RUN', rights_g1: 'NOT_RUN',
  pins,
};
write(envelopePath, envelope);
const preflight = {
  schema: 'qa02.media-short-headless.r04.static-preflight.v1',
  status: 'PASS_STATIC_NOT_APPROVED_NOT_RUN',
  checked_utc: new Date().toISOString(),
  source_manifest_sha256: sha(sourcePath), envelope_sha256: sha(envelopePath),
  runner_sha256: sha(join(pkg, 'run-once.mjs')),
  db_inspector_sha256: sha(join(pkg, 'inspect-db.py')),
  db_selftest: rows, db_selftest_source_sha256: expected.r02Db,
  p23_pid_selftest_sha256: sha(p23),
  source_count: names.length, pin_count: pins.length,
  input_count: 5, indexed_input_count: inputIndex.files.length,
  short_blob_path_length: blob.length,
  profile_absent: true, evidence_absent: true,
  sidecar_runs: 0, browser_runs: 0, electron_runs: 0, provider_calls: 0,
};
write(preflightPath, preflight);
const index = { schema: 'qa02.media-short-headless.r04.package-index.v1',
  status: 'CANDIDATE_AWAITING_MGR02_SINGLE_SIGN',
  files: ['RUNBOOK.md', 'run-once.mjs', 'inspect-db.py', 'SOURCE-FILES.json',
    'RUN-ENVELOPE.json', 'STATIC-PREFLIGHT.json'].map((name) => ({ name,
      bytes: statSync(join(pkg, name)).size, sha256: sha(join(pkg, name)) })),
  self_excluded: 'PACKAGE-SHA256.json', approval_template_excluded: true };
write(indexPath, index);
const approval = {
  kind: 'QA02_MEDIA_SHORT_HEADLESS_R04_ONE_SHOT',
  status: 'TEMPLATE_NOT_APPROVED', headless_only: true,
  provider_calls_allowed: 0, package_index_sha256: sha(indexPath),
  envelope_sha256: sha(envelopePath),
  runner_sha256: sha(join(pkg, 'run-once.mjs')),
  source_manifest_sha256: sha(sourcePath),
  profile_dir: profile, evidence_dir: evidence,
  max_sidecar_launches: 2, max_headless_browser_launches: 1,
};
write(approvalPath, approval);
assert.deepEqual(status(), before, 'Git status drift during package freeze');
for (const item of index.files) {
  assert.equal(sha(join(pkg, item.name)), item.sha256, `Package drift ${item.name}`);
  assert.equal(statSync(join(pkg, item.name)).size, item.bytes);
}
for (const item of pins) assert.equal(sha(item.path), item.sha256, `Pin drift ${item.role}`);
process.stdout.write(JSON.stringify({ packet: pkg, package_index_sha256: sha(indexPath),
  envelope_sha256: sha(envelopePath), runner_sha256: approval.runner_sha256,
  source_manifest_sha256: sha(sourcePath), git_head: head,
  source_count: names.length, git_status_count: before.length,
  pin_count: pins.length, short_blob_path_length: blob.length,
  profile_absent: true, evidence_absent: true }, null, 2) + '\n');
