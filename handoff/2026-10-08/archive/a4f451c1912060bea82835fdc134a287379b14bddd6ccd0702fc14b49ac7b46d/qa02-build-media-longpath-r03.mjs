/* Static packet freezer. Must be called after MGR04's protected two-source sync. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((part) => {
  const at = part.indexOf('=');
  assert.ok(part.startsWith('--') && at > 2, `Bad argument ${part}`);
  return [part.slice(2, at), part.slice(at + 1)];
}));
assert.ok(args.postflight && args['postflight-sha256'],
  'MGR04 postflight path and SHA required');
const base = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\native-source-qa-20260924';
const pkg = join(base, 'qa02-media-longpath-http-r03-20260928');
const root = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const api = join(root, 'services', 'api', 'src', 'aijian_api');
const helper = join(api, 'managed_local_paths.py');
const store = join(api, 'media_asset_store.py');
const route = join(api, 'media_asset_routes.py');
const repository = join(api, 'repository.py');
const webm = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\qa02-mlt-test-20260928\\four-media-20260928T022740Z\\v1-blue.webm';
const node = 'C:\\Program Files\\nodejs\\node.exe';
const launcher = join(root, '.venv', 'Scripts', 'python.exe');
const actualPython = 'C:\\Users\\Administrator\\AppData\\Roaming\\uv\\python\\cpython-3.12-windows-x86_64-none\\python.exe';
const mgr04Preflight = 'C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260928-c19-longpath-two-source-preflight-1\\PREFLIGHT.json';
const qa01Static = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\qa01-mlt-20260928\\C19-LONGPATH-TWO-SOURCE-STATIC.json';
const qa01PreflightReadback = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\qa01-mlt-20260928\\C19-TWO-SOURCE-PREFLIGHT-READBACK.json';
const r02Db = join(base, 'qa02-media-http-headless-r02-20260928',
  'profile-r02', 'data', 'workspace.sqlite3');
const p23 = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\qa03-project-name-source-20260928\\p23-sidecar-gate-v1\\sidecar-01\\RECEIPT.json';
const expected = {
  helper: '78FCCE4F28FF720F6610AB72EEC2C5C5AB179E7BEB758B980610303B7CA9D7AC',
  store: '2954042D87754211526891A5CC3506DD55DCA78CBB349FC44D19D54FDDC105B8',
  route: '931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770',
  repository: 'BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69',
  webm: '75FCA3022F0D4369175E5341505544D8AED1837C1DCE0899F35BF1D7EDB73947',
  mgr04Preflight: 'D30EFC9E24513AE6EA2C6BBFB98308E3FAEA10C9F795A9F8E61549BE3944E6B0',
  qa01Static: 'CAD331743083818AC808BE674D99430D74066C3FB7F85E57DCA92A380B937113',
  qa01PreflightReadback: '558390B3525EDD57696C7D8AA2E4BF7BB9C6041A62F91B4F4D5D31E2BFC14677',
  r02Db: '5E9687CFBBBB83672A73F78B09D732513895A31CF19079E2DFD3E91065D71F09',
  p23: 'A68F4FF76254CD32D9E1C8AC1E657DD25F651F6811494DD92635A3ACB5CA8850',
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
checked(qa01Static, expected.qa01Static, 'QA01 static receipt');
checked(qa01PreflightReadback, expected.qa01PreflightReadback,
  'QA01 preflight readback');
checked(r02Db, expected.r02Db, 'Frozen r02 DB selftest input');
checked(p23, expected.p23, 'P23 PID baseline');
checked(helper, expected.helper, 'Managed path helper');
checked(store, expected.store, 'Media asset store');
checked(route, expected.route, 'Unchanged route');
checked(repository, expected.repository, 'Schema26 repository');
checked(webm, expected.webm, 'WebM input');
assert.equal(statSync(webm).size, 2619, 'WebM bytes');
const profiles = [join(pkg, 'profile-265'), join(pkg, 'profile-266x')];
const evidence = join(pkg, 'evidence-r03');
for (const path of [...profiles, evidence]) assert.ok(!existsSync(path),
  `QA output already exists: ${path}`);
const stagingLengths = [];
for (let i = 0; i < 2; i++) {
  const blob = join(profiles[i], 'data', 'media-assets', 'blobs', '75',
    expected.webm.toLowerCase());
  assert.equal(blob.length, 265 + i, 'Blob logical path length');
  for (const prefix of ['incoming-', 'staged-']) {
    const staging = join(profiles[i], 'data', 'media-assets', 'staging',
      prefix + '0'.repeat(32));
    assert.ok(staging.length < 260, 'Route/store staging path length');
    stagingLengths.push(staging.length);
  }
}
execFileSync(node, ['--check', join(pkg, 'run-once.mjs')], { stdio: 'pipe' });
const unsafeSyntax = spawnSync(launcher, ['-I', '-B', '-c',
  'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))',
  join(pkg, 'unsafe-gate.py')],
{ cwd: root, windowsHide: true, timeout: 15000, encoding: 'utf8' });
assert.equal(unsafeSyntax.status, 0, `Unsafe gate syntax: ${unsafeSyntax.stderr}`);
const pyCheck = spawnSync(launcher,
  ['-I', '-B', join(pkg, 'inspect-db.py'), r02Db],
  { cwd: root, windowsHide: true, timeout: 15000, encoding: 'utf8' });
assert.equal(pyCheck.status, 0, `DB selftest failed: ${pyCheck.stderr}`);
const rows = JSON.parse(pyCheck.stdout);
assert.deepEqual(rows, { integrity: 'ok', media_asset_episode_references: 0,
  media_asset_versions: 0, media_assets: 0, projects: 1,
  provider_connections: 0, sub2api_call_approvals: 0,
  sub2api_call_consumptions: 0, user_version: 26 }, 'DB selftest rows');
const p23Data = JSON.parse(readFileSync(p23, 'utf8'));
assert.equal(p23Data.launches.length, 2, 'P23 launch count');
for (const run of p23Data.launches) {
  assert.notEqual(run.launcherPid, run.sidecarPid);
  assert.equal(run.sidecarParentPid, run.launcherPid);
  assert.deepEqual(run.afterCloseProcesses, []);
}
const head = git('rev-parse', 'HEAD');
const before = status();
const names = execFileSync('rg', ['--files', 'services/api/src/aijian_api',
  '-g', '*.py'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/)
  .filter(Boolean).map((name) => name.replaceAll('\\', '/')).sort();
assert.ok(names.length >= 138, 'Expected helper in complete Python set');
const source = { schema: 'qa02.media-longpath-http.r03.source-files.v1',
  checked_utc: new Date().toISOString(), c19_root: root, git_head: head,
  git_status: before, files: names.map((name) => ({ path: name,
    bytes: statSync(join(root, name)).size, sha256: sha(join(root, name)) })),
  count: names.length };
assert.deepEqual(status(), before, 'Git status drift during source hashing');
assert.equal(git('rev-parse', 'HEAD'), head, 'Git HEAD drift');
const sourcePath = join(pkg, 'SOURCE-FILES.json');
write(sourcePath, source);
const pins = [
  file('source-manifest', sourcePath), file('mgr04-postflight', postflight),
  file('mgr04-preflight', mgr04Preflight), file('qa01-static', qa01Static),
  file('qa01-preflight-readback', qa01PreflightReadback),
  file('r02-closed-db-selftest', r02Db), file('p23-pid-baseline', p23),
  file('helper', helper), file('store', store), file('route', route),
  file('repository', repository), file('webm', webm),
  file('node', node), file('python-launcher', launcher),
  file('python-actual', actualPython),
];
const envelope = {
  schema: 'qa02.media-longpath-http.r03.envelope.v1',
  status: 'READY_FOR_EXTERNAL_ONE_SHOT', c19_root: root, git_head: head,
  source_manifest: sourcePath, mgr04_postflight: postflight,
  expected_helper_sha256: expected.helper,
  expected_store_sha256: expected.store,
  expected_route_sha256: expected.route,
  expected_repository_sha256: expected.repository,
  webm_path: webm, webm_bytes: 2619, webm_sha256: expected.webm,
  node_exe: node, python_exe: launcher, actual_python_exe: actualPython,
  profile_265: profiles[0], profile_266: profiles[1], evidence_dir: evidence,
  sidecar_max_launches: 4, provider_calls_allowed: 0,
  browser_launches_allowed: 0, electron_visible: 'NOT_RUN',
  schema_version_expected: 26, pins,
};
const envelopePath = join(pkg, 'RUN-ENVELOPE.json');
write(envelopePath, envelope);
const preflight = {
  schema: 'qa02.media-longpath-http.r03.static-preflight.v1',
  status: 'PASS_STATIC_NOT_APPROVED_NOT_RUN',
  checked_utc: new Date().toISOString(),
  source_manifest_sha256: sha(sourcePath), envelope_sha256: sha(envelopePath),
  mgr04_postflight_sha256: sha(postflight), qa01_static_sha256: sha(qa01Static),
  runner_sha256: sha(join(pkg, 'run-once.mjs')),
  source_count: names.length, pin_count: pins.length,
  db_inspector_sha256: sha(join(pkg, 'inspect-db.py')),
  unsafe_gate_sha256: sha(join(pkg, 'unsafe-gate.py')),
  unsafe_gate_ast_parse_exit: 0,
  db_selftest: rows, p23_pid_selftest_sha256: sha(p23),
  blob_lengths: [265, 266], staging_lengths: stagingLengths,
  profile_265_absent: true, profile_266_absent: true,
  evidence_absent: true, sidecar_runs: 0, browser_runs: 0,
  electron_runs: 0, provider_calls: 0,
};
const preflightPath = join(pkg, 'STATIC-PREFLIGHT.json');
write(preflightPath, preflight);
const index = { schema: 'qa02.media-longpath-http.r03.package-index.v1',
  status: 'CANDIDATE_AWAITING_MGR02_SINGLE_SIGN',
  files: ['RUNBOOK.md', 'run-once.mjs', 'inspect-db.py', 'unsafe-gate.py',
    'SOURCE-FILES.json',
    'RUN-ENVELOPE.json', 'STATIC-PREFLIGHT.json'].map((name) => ({ name,
      bytes: statSync(join(pkg, name)).size, sha256: sha(join(pkg, name)) })),
  self_excluded: 'PACKAGE-SHA256.json', approval_template_excluded: true };
const indexPath = join(pkg, 'PACKAGE-SHA256.json');
write(indexPath, index);
const template = {
  kind: 'QA02_MEDIA_LONGPATH_HTTP_R03_ONE_SHOT',
  status: 'TEMPLATE_NOT_APPROVED', provider_calls_allowed: 0,
  browser_launches_allowed: 0, package_index_sha256: sha(indexPath),
  envelope_sha256: sha(envelopePath),
  runner_sha256: sha(join(pkg, 'run-once.mjs')),
  source_manifest_sha256: sha(sourcePath),
  profile_265: profiles[0], profile_266: profiles[1], evidence_dir: evidence,
  sidecar_max_launches: 4,
};
write(join(pkg, 'APPROVAL-TEMPLATE.json'), template);
assert.deepEqual(status(), before, 'Git status drift during packet freeze');
for (const item of index.files) {
  assert.equal(sha(join(pkg, item.name)), item.sha256, `Package drift ${item.name}`);
  assert.equal(statSync(join(pkg, item.name)).size, item.bytes);
}
for (const item of pins) assert.equal(sha(item.path), item.sha256, `Pin drift ${item.role}`);
process.stdout.write(JSON.stringify({ packet: pkg, package_index_sha256: sha(indexPath),
  envelope_sha256: sha(envelopePath), runner_sha256: template.runner_sha256,
  source_manifest_sha256: sha(sourcePath), git_head: head,
  git_status_count: before.length, source_count: names.length,
  pin_count: pins.length, output_dirs_absent: true }, null, 2) + '\n');
