// M2 one-shot entry. Runtime requires exact M1 handoff and separate manager approval.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, writeSync, closeSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runM2Once } from './m2-once-flow.mjs';

const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const productPath = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260924-layout07-27/SNAPSHOT.json';
const qaPath = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260924-build05-qa-overlay-6/SNAPSHOT.json';
const buildPath = 'C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/m1-layout07-build-20260924T033449449Z/postbuild.json';
const expected = Object.freeze({
  head: '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2',
  product: '569e8b63a2545d7178e18b22348330b10d8e5b628410b4e45732e4b3ccffc21f',
  qa: 'ed784de9f7610fbf3d4a767ff2c3b1a716472a72e0afa5860d33fc66bbd25048',
  build: '5b395e855b8502515741345efcc35a58ce5172ee1a3829437e2bbde0e133042f',
  input: '466f23b789b47fa1231b0891e80385a13e530b02de2f74481c4e98f5732de008',
  ffprobe: '9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015',
});
const work = dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex64 = /^[0-9a-f]{64}$/i;
const projectPattern = /^prj_[0-9a-f]{32}$/;
const sourcePattern = /^src_[0-9a-f]{32}$/;
const versionPattern = /^ver_[0-9a-f]{32}$/;
const contentPattern = /^sha256:[0-9a-f]{64}$/;

function optionsFrom(args) {
  const options = new Map();
  for (const arg of args) {
    const at = arg.indexOf('=');
    assert.ok(arg.startsWith('--') && at > 2, `invalid option: ${arg}`);
    const key = arg.slice(2, at);
    assert.ok(!options.has(key), `duplicate option: ${key}`);
    options.set(key, arg.slice(at + 1));
  }
  const allowed = new Set([
    'handoff', 'handoff-sha256', 'profile', 'project-id', 'source-id',
    'input', 'attempt-id', 'preflight-only', 'approval', 'approval-sha256',
    'ffprobe-path',
  ]);
  for (const key of options.keys()) assert.ok(allowed.has(key), `unknown option: ${key}`);
  for (const key of ['handoff', 'handoff-sha256', 'profile', 'project-id',
    'source-id', 'input', 'attempt-id', 'preflight-only'])
    assert.ok(options.get(key), `missing --${key}`);
  assert.ok(['true', 'false'].includes(options.get('preflight-only')),
    'preflight-only must be true or false');
  if (options.get('preflight-only') === 'false')
    for (const key of ['approval', 'approval-sha256', 'ffprobe-path'])
      assert.ok(options.get(key), `runtime requires --${key}`);
  assert.match(options.get('handoff-sha256'), hex64, 'handoff SHA-256 invalid');
  if (options.get('approval-sha256'))
    assert.match(options.get('approval-sha256'), hex64, 'approval SHA-256 invalid');
  assert.match(options.get('project-id'), projectPattern, 'project ID invalid');
  assert.match(options.get('source-id'), sourcePattern, 'source ID invalid');
  assert.match(options.get('attempt-id'), /^m2-qa01-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6,16}$/,
    'attempt ID invalid');
  return options;
}

function fixedJson(path, digest, label) {
  const bytes = readFileSync(path);
  assert.equal(hash(bytes), digest, `${label} manifest changed`);
  return JSON.parse(bytes.toString('utf8'));
}

function signedEvidence(item, label) {
  assert.ok(item && typeof item === 'object', `${label} evidence missing`);
  assert.ok(isAbsolute(item.path), `${label} path must be absolute`);
  assert.match(item.sha256, hex64, `${label} SHA-256 invalid`);
  assert.equal(hash(readFileSync(item.path)), item.sha256.toLowerCase(),
    `${label} evidence changed`);
}

function candidateFile(relativePath) {
  assert.equal(typeof relativePath, 'string', 'manifest path invalid');
  assert.ok(!isAbsolute(relativePath), `absolute manifest path: ${relativePath}`);
  const path = resolve(repo, relativePath);
  const inside = relative(repo, path);
  assert.ok(inside && inside !== '..' && !inside.startsWith(`..\\`) &&
    !inside.startsWith('../') && !isAbsolute(inside), `path escaped c19: ${relativePath}`);
  return path;
}

function verifyFiles(files, label) {
  const seen = new Set();
  for (const file of files) {
    assert.ok(!seen.has(file.path), `${label} duplicate path: ${file.path}`);
    seen.add(file.path);
    assert.match(file.sha256, hex64, `${label} file hash invalid`);
    const bytes = readFileSync(candidateFile(file.path));
    if (typeof file.bytes === 'number')
      assert.equal(bytes.length, file.bytes, `${label} byte length changed: ${file.path}`);
    assert.equal(hash(bytes), file.sha256.toLowerCase(), `${label} hash changed: ${file.path}`);
  }
  return seen;
}

function verifyProfile(path, handoff) {
  assert.ok(isAbsolute(path), 'profile path must be absolute');
  const allowedRoot = resolve(repo, '.aijian-dev');
  const requested = resolve(path);
  const relationship = relative(allowedRoot, requested);
  assert.ok(relationship && relationship !== '..' && !relationship.startsWith(`..\\`) &&
    !relationship.startsWith('../') && !isAbsolute(relationship),
  'profile must be a child of the c19 evidence root');
  assert.equal(requested.toLowerCase(), resolve(handoff.profile_path).toLowerCase(),
    'CLI profile differs from M1 handoff');
  assert.ok(lstatSync(requested).isDirectory(), 'M1 profile does not exist');
  assert.ok(!lstatSync(requested).isSymbolicLink(), 'profile is a link');
  assert.equal(realpathSync(requested).toLowerCase(), requested.toLowerCase(),
    'profile resolves to a different path');
  const workspace = join(requested, 'workspace');
  assert.ok(lstatSync(workspace).isDirectory(), 'M1 workspace does not exist');
  assert.ok(!lstatSync(workspace).isSymbolicLink(), 'workspace is a link');
  assert.equal(realpathSync(workspace).toLowerCase(), workspace.toLowerCase(),
    'workspace resolves to a different path');
  assert.equal(resolve(handoff.workspace_path).toLowerCase(), workspace.toLowerCase(),
    'handoff workspace path differs from profile');
  const database = join(workspace, 'workspace.sqlite3');
  assert.ok(lstatSync(database).isFile(), 'M1 workspace database is absent');
  assert.ok(!lstatSync(database).isSymbolicLink(), 'workspace database is a link');
  assert.ok(!existsSync(join(requested, 'SingletonLock')), 'profile still has SingletonLock');
  return { profile: requested, workspace, database };
}

function assertNoCandidateProcesses(profilePath) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$m2Root = $env:M2_REPO_ROOT.ToLowerInvariant()',
    '$m2ProfilePath = $env:M2_PROFILE_PATH.ToLowerInvariant()',
    '$m2SelfPid = [int]$env:M2_SELF_PID',
    '$found = @(Get-CimInstance Win32_Process | Where-Object {',
    "  $_.ProcessId -ne $m2SelfPid -and $_.Name -match '^(electron|python|pythonw|node|cmd)\\.exe$' -and",
    '  (($_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant().StartsWith($m2Root)) -or',
    '   ($_.CommandLine -and ($_.CommandLine.ToLowerInvariant().Contains($m2Root) -or',
    '     $_.CommandLine.ToLowerInvariant().Contains($m2ProfilePath))))',
    '} | Select-Object ProcessId,Name)',
    'ConvertTo-Json -InputObject $found -Compress',
  ].join('\n');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, M2_REPO_ROOT: resolve(repo), M2_PROFILE_PATH: profilePath,
      M2_SELF_PID: String(process.pid) },
  }).trim();
  const found = JSON.parse(output);
  assert.ok(Array.isArray(found), 'process scan was not an array');
  assert.equal(found.length, 0, `candidate processes still running: ${JSON.stringify(found)}`);
}

function verifyRuntimeApproval(options, handoffBytes) {
  const approvalBytes = readFileSync(options.get('approval'));
  assert.equal(hash(approvalBytes), options.get('approval-sha256').toLowerCase(),
    'manager approval bytes changed');
  const approval = JSON.parse(approvalBytes.toString('utf8'));
  assert.equal(approval.kind, 'M2_MANAGER_SINGLE_RUN_APPROVAL_V1');
  assert.equal(approval.outcome, 'APPROVED');
  assert.equal(approval.manager_thread_id, '01a0d0ec-1393-7d72-bb98-9913bd2fecca');
  assert.equal(approval.qa01_thread_id, '01a0d0ec-c748-7001-a93d-0144770a11bc');
  assert.equal(approval.attempt_id, options.get('attempt-id'));
  assert.equal(approval.m1_handoff_sha256?.toLowerCase(), hash(handoffBytes));
  assert.equal(approval.head, expected.head);
  assert.equal(approval.product_snapshot_sha256?.toLowerCase(), expected.product);
  assert.equal(approval.qa_snapshot_sha256?.toLowerCase(), expected.qa);
  assert.equal(approval.build_manifest_sha256?.toLowerCase(), expected.build);
  for (const [name, path] of [
    ['runner_sha256', fileURLToPath(import.meta.url)],
    ['flow_sha256', join(work, 'm2-once-flow.mjs')],
    ['driver_sha256', join(work, 'm2-electron-driver.mjs')],
  ]) assert.equal(approval[name]?.toLowerCase(), hash(readFileSync(path)), `${name} changed`);
  const ffprobe = resolve(options.get('ffprobe-path'));
  assert.ok(isAbsolute(ffprobe), 'ffprobe path must be absolute');
  assert.ok(lstatSync(ffprobe).isFile() && !lstatSync(ffprobe).isSymbolicLink(),
    'ffprobe must be a real file');
  assert.equal(hash(readFileSync(ffprobe)), expected.ffprobe, 'ffprobe does not match lock');
  assert.equal(approval.ffprobe_sha256?.toLowerCase(), expected.ffprobe);
  return { approval, ffprobe };
}

function durableRecord(path) {
  return async (event, payload) => {
    const fd = openSync(path, 'a');
    try {
      writeSync(fd, JSON.stringify({ utc: new Date().toISOString(), event, payload }) + '\n');
      fsyncSync(fd);
    } finally { closeSync(fd); }
  };
}

async function main() {
  assert.equal(process.platform, 'win32', 'Windows native candidate only');
  const options = optionsFrom(process.argv.slice(2));
  const handoffPath = resolve(options.get('handoff'));
  const handoffBytes = readFileSync(handoffPath);
  assert.equal(hash(handoffBytes), options.get('handoff-sha256').toLowerCase(),
    'M1 handoff bytes changed');
  const handoff = JSON.parse(handoffBytes.toString('utf8'));
  assert.equal(handoff.kind, 'M1_CONTROLLED_PROFILE_HANDOFF_V1');
  assert.equal(handoff.outcome, 'ACCEPTED_AND_SELECTED');
  assert.equal(handoff.normal_close, true);
  assert.equal(handoff.c19_released, true);
  assert.equal(handoff.head, expected.head);
  assert.equal(handoff.product_snapshot_sha256?.toLowerCase(), expected.product);
  assert.equal(handoff.qa_snapshot_sha256?.toLowerCase(), expected.qa);
  assert.equal(handoff.build_manifest_sha256?.toLowerCase(), expected.build);
  assert.equal(handoff.project_id, options.get('project-id'));
  assert.equal(handoff.source_document_id, options.get('source-id'));
  assert.equal(typeof handoff.project_name, 'string');
  assert.ok(handoff.project_name.length > 0 && handoff.project_name.length <= 200);
  assert.equal(handoff.selected_source_document_id, handoff.source_document_id,
    'M1 selected source differs from frozen source');
  assert.match(handoff.source_manifest_version_id, versionPattern);
  assert.equal(handoff.accepted_version_id, handoff.source_manifest_version_id);
  assert.equal(handoff.latest_version_id, handoff.source_manifest_version_id);
  assert.match(handoff.source_manifest_content_hash, contentPattern);
  assert.equal(handoff.source_sha256, `sha256:${expected.input}`);
  assert.equal(handoff.source_text_sha256?.toLowerCase(), expected.input);
  assert.equal(handoff.input_sha256?.toLowerCase(), expected.input);
  for (const name of ['m1_result', 'm1_postclose', 'm1_ledger'])
    signedEvidence(handoff.evidence?.[name], name);
  const profile = verifyProfile(options.get('profile'), handoff);
  assertNoCandidateProcesses(profile.profile);
  assert.equal(resolve(handoff.input_path).toLowerCase(),
    resolve(options.get('input')).toLowerCase(), 'CLI input path differs from M1 handoff');
  const input = readFileSync(options.get('input'));
  assert.equal(hash(input), expected.input, 'frozen short script changed');

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo,
    encoding: 'utf8' }).trim();
  assert.equal(head, expected.head, 'c19 HEAD changed');
  const product = fixedJson(productPath, expected.product, 'product');
  const qa = fixedJson(qaPath, expected.qa, 'QA');
  const build = fixedJson(buildPath, expected.build, 'build');
  assert.equal(product.files.length, 27);
  assert.equal(qa.files.length, 6);
  assert.equal(build.dist_files.length, 73);
  assert.equal(build.web_exit, 0);
  assert.equal(build.desktop_exit, 0);
  assert.equal(build.product_snapshot_sha256?.toLowerCase(), expected.product);
  assert.equal(build.qa_snapshot_sha256?.toLowerCase(), expected.qa);
  const productPaths = verifyFiles(product.files, 'product');
  const qaPaths = verifyFiles(qa.files, 'QA');
  const distPaths = verifyFiles(build.dist_files, 'dist');
  for (const path of qaPaths) assert.ok(!productPaths.has(path), `product/QA overlap: ${path}`);
  for (const path of distPaths) assert.ok(!productPaths.has(path) && !qaPaths.has(path),
    `source/dist overlap: ${path}`);
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'],
    { cwd: repo, encoding: 'utf8' }).trimEnd();
  const statusPaths = status ? status.split(/\r?\n/).map((line) => line.slice(3)).sort() : [];
  assert.deepEqual(statusPaths, [...productPaths, ...qaPaths].sort(),
    'Git status paths differ from the frozen product and QA manifests');
  const staticResult = {
    kind: 'M2_STATIC_PREFLIGHT', attempt_id: options.get('attempt-id'),
    project_id: handoff.project_id, source_document_id: handoff.source_document_id,
    source_manifest_version_id: handoff.source_manifest_version_id,
    profile: profile.profile, workspace: profile.workspace,
    verified: { product: 27, qa: 6, dist: 73, input_sha256: expected.input },
    runtime_authorized: options.get('preflight-only') === 'false',
  };
  if (options.get('preflight-only') === 'true') {
    process.stdout.write(JSON.stringify({ ...staticResult,
      kind: 'M2_STATIC_PREFLIGHT_ONLY', runtime_authorized: false }) + '\n');
    return;
  }
  const runtime = verifyRuntimeApproval(options, handoffBytes);
  const evidenceRoot = join(work, 'evidence');
  if (!existsSync(evidenceRoot)) mkdirSync(evidenceRoot);
  const attemptRoot = join(evidenceRoot, options.get('attempt-id'));
  mkdirSync(attemptRoot); // Existing attempt is never resumed or overwritten.
  const record = durableRecord(join(attemptRoot, 'events.jsonl'));
  await record('preflight', { ...staticResult, approval_sha256: hash(readFileSync(options.get('approval'))),
    handoff_sha256: hash(handoffBytes), ffprobe_path: runtime.ffprobe });
  const { M2ElectronDriver } = await import('./m2-electron-driver.mjs');
  const driver = new M2ElectronDriver({ handoff, ffprobePath: runtime.ffprobe,
    evidenceRoot: attemptRoot, record });
  let result;
  try {
    result = await runM2Once(driver, handoff, record);
  } catch (error) {
    result = { kind: 'M2_FAIL_OR_UNKNOWN', code: 'CLOSE_OR_RECORD_UNKNOWN',
      message: String(error?.message ?? error) };
    await record('runtime_exception', result);
  }
  // Postflight candidate and M1 evidence must still match; a mismatch downgrades PASS.
  try {
    verifyFiles(product.files, 'product postflight');
    verifyFiles(qa.files, 'QA postflight');
    verifyFiles(build.dist_files, 'dist postflight');
    for (const name of ['m1_result', 'm1_postclose', 'm1_ledger'])
      signedEvidence(handoff.evidence[name], `${name} postflight`);
    assertNoCandidateProcesses(profile.profile);
    await record('postflight', { files: { product: 27, qa: 6, dist: 73 },
      m1_evidence_unchanged: true, no_candidate_processes: true });
  } catch (error) {
    result = { kind: 'M2_FAIL_OR_UNKNOWN', code: 'POSTFLIGHT_UNKNOWN',
      message: String(error?.message ?? error), prior: result };
    await record('postflight_failed', result);
  }
  await record('result', result);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.kind !== 'M2_DEVELOPMENT_MP4_PASS') process.exitCode = 1;
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ kind: 'M2_BLOCKED',
    message: String(error?.message ?? error) }) + '\n');
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
