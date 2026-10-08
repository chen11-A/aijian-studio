/* One approved, isolated, two-path HTTP slice. Never launches a browser. */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, realpathSync, statSync,
  symlinkSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const PKG = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((part) => {
  const at = part.indexOf('=');
  assert.ok(part.startsWith('--') && at > 2, `Bad argument ${part}`);
  return [part.slice(2, at), part.slice(at + 1)];
}));
for (const key of ['approval', 'approval-sha256']) assert.ok(args[key], `Missing ${key}`);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const hash = (path) => sha(readFileSync(path));
const eq = (actual, expected, label) => assert.equal(actual, expected, label);
const approvalPath = resolve(args.approval);
eq(hash(approvalPath), args['approval-sha256'].toUpperCase(), 'Approval SHA');
const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
const envelopePath = join(PKG, 'RUN-ENVELOPE.json');
const indexPath = join(PKG, 'PACKAGE-SHA256.json');
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
eq(approval.kind, 'QA02_MEDIA_LONGPATH_HTTP_R03_ONE_SHOT', 'Approval kind');
eq(approval.status, 'MGR02_APPROVED_ONCE', 'Approval status');
eq(approval.provider_calls_allowed, 0, 'Provider boundary');
eq(approval.browser_launches_allowed, 0, 'Browser boundary');
eq(approval.package_index_sha256, hash(indexPath), 'Package SHA');
eq(approval.envelope_sha256, hash(envelopePath), 'Envelope SHA');
eq(approval.runner_sha256, hash(fileURLToPath(import.meta.url)), 'Runner SHA');
eq(envelope.schema, 'qa02.media-longpath-http.r03.envelope.v1', 'Envelope schema');
eq(index.schema, 'qa02.media-longpath-http.r03.package-index.v1', 'Index schema');
eq(envelope.status, 'READY_FOR_EXTERNAL_ONE_SHOT', 'Envelope status');
eq(approval.profile_265, envelope.profile_265, 'Profile 265');
eq(approval.profile_266, envelope.profile_266, 'Profile 266');
eq(approval.evidence_dir, envelope.evidence_dir, 'Evidence');
eq(approval.sidecar_max_launches, 4, 'Launch cap');
eq(envelope.sidecar_max_launches, 4, 'Envelope launch cap');
for (const item of index.files) {
  const path = join(PKG, item.name);
  eq(hash(path), item.sha256, `Package file ${item.name}`);
  eq(statSync(path).size, item.bytes, `Package bytes ${item.name}`);
}
for (const item of envelope.pins) {
  eq(hash(item.path), item.sha256, `Pin ${item.role}`);
  eq(statSync(item.path).size, item.bytes, `Pin bytes ${item.role}`);
}
const root = resolve(envelope.c19_root);
eq(realpathSync.native(process.execPath).toLowerCase(),
  realpathSync.native(envelope.node_exe).toLowerCase(), 'Node executable');
const profiles = [resolve(envelope.profile_265), resolve(envelope.profile_266)];
const evidence = resolve(envelope.evidence_dir);
for (const path of [...profiles, evidence]) {
  eq(dirname(path), PKG, `Output scope ${path}`);
  assert.ok(!existsSync(path), `Output already exists: ${path}`);
}
eq(profiles[0], join(PKG, 'profile-265'), 'Exact 265 profile');
eq(profiles[1], join(PKG, 'profile-266x'), 'Exact 266 profile');
eq(evidence, join(PKG, 'evidence-r03'), 'Exact evidence path');
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
eq(head.status, 0, 'git HEAD command');
eq(head.stdout.trim(), envelope.git_head, 'git HEAD');
const status = spawnSync('git', ['status', '--short', '--untracked-files=all'],
  { cwd: root, encoding: 'utf8' });
eq(status.status, 0, 'git status command');
const source = JSON.parse(readFileSync(envelope.source_manifest, 'utf8'));
eq(source.schema, 'qa02.media-longpath-http.r03.source-files.v1', 'Source schema');
eq(approval.source_manifest_sha256, hash(envelope.source_manifest), 'Source approval SHA');
eq(source.git_head, envelope.git_head, 'Source HEAD');
assert.deepEqual(status.stdout.split(/\r?\n/).filter(Boolean), source.git_status,
  'git status changed');
eq(source.count, source.files.length, 'Source count');
for (const item of source.files) {
  const path = join(root, item.path);
  eq(hash(path), item.sha256, `Source SHA ${item.path}`);
  eq(statSync(path).size, item.bytes, `Source bytes ${item.path}`);
}
const sourceDir = join(root, 'services', 'api', 'src');
const helper = join(sourceDir, 'aijian_api', 'managed_local_paths.py');
const pin = (role) => envelope.pins.find((item) => item.role === role);
eq(hash(helper), envelope.expected_helper_sha256, 'New helper SHA');
eq(hash(join(sourceDir, 'aijian_api', 'media_asset_store.py')),
  envelope.expected_store_sha256, 'New store SHA');
eq(hash(join(sourceDir, 'aijian_api', 'media_asset_routes.py')),
  envelope.expected_route_sha256, 'Unchanged route SHA');
eq(hash(join(sourceDir, 'aijian_api', 'repository.py')),
  envelope.expected_repository_sha256, 'Schema 26 repository SHA');
const media = readFileSync(envelope.webm_path);
eq(sha(media), envelope.webm_sha256, 'WebM SHA');
eq(media.byteLength, envelope.webm_bytes, 'WebM size');
for (let i = 0; i < 2; i++) {
  const blob = join(profiles[i], 'data', 'media-assets', 'blobs',
    envelope.webm_sha256.slice(0, 2).toLowerCase(), envelope.webm_sha256.toLowerCase());
  eq(blob.length, 265 + i, `Blob logical path length ${i}`);
  for (const prefix of ['incoming-', 'staged-']) {
    const staging = join(profiles[i], 'data', 'media-assets', 'staging',
      prefix + '0'.repeat(32));
    assert.ok(staging.length < 260, `Route/store staging path too long: ${staging}`);
  }
}

await mkdir(evidence, { recursive: false, mode: 0o700 });
for (const profile of profiles) await mkdir(profile, { recursive: false, mode: 0o700 });
const result = { schema: 'qa02.media-longpath-http.r03.result.v1',
  status: 'STARTED', label: 'ISOLATED_SIDECAR_HTTP_NOT_ELECTRON',
  approval_sha256: hash(approvalPath), package_index_sha256: hash(indexPath),
  envelope_sha256: hash(envelopePath), provider_calls: 0, browser_launches: 0,
  electron_launches: 0, helper_negatives: [], cases: [], sidecar_launches: [] };
const save = async () => writeFile(join(evidence, 'result.json'),
  JSON.stringify(result, null, 2) + '\n');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
function processes(ids) {
  if (ids.length === 0) return [];
  assert.ok(ids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
  const filter = ids.map((pid) => `ProcessId = ${pid}`).join(' OR ');
  const ps = `Get-CimInstance Win32_Process -Filter '${filter}' | ` +
    'Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ' +
    'ConvertTo-Json -Compress';
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps],
    { encoding: 'utf8', timeout: 10000 }).trim();
  return output ? [JSON.parse(output)].flat() : [];
}
async function waitGone(ids) {
  let active = [];
  for (let n = 0; n < 50; n++) {
    active = processes(ids);
    if (active.length === 0) return [];
    await delay(100);
  }
  return active;
}
function auth(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, Origin: 'app://aijian', ...extra };
}
async function http(session, method, path, label, body, extra = {}) {
  const response = await fetch(session.origin + path, {
    method, headers: auth(session.token, extra), body,
    signal: AbortSignal.timeout(30000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const stem = label.replace(/[^a-z0-9-]/gi, '_');
  await writeFile(join(evidence, `${stem}.body.raw`), bytes, { flag: 'wx' });
  const receipt = { method, path, status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    bytes: bytes.byteLength, sha256: sha(bytes), body_path: `${stem}.body.raw` };
  await writeFile(join(evidence, `${stem}.http.json`),
    JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return { bytes, receipt };
}
let session = null;
async function launch(profile, caseNumber, openNumber) {
  const data = join(profile, 'data');
  const local = join(profile, 'local-app-data');
  const temp = join(profile, 'temp');
  for (const path of [data, local, temp]) await mkdir(path, { recursive: true });
  const env = { ...process.env, AIJIAN_DATA_DIR: data, LOCALAPPDATA: local,
    APPDATA: local, TEMP: temp, TMP: temp, PYTHONNOUSERSITE: '1' };
  delete env.AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME;
  const code = `import sys; sys.path.insert(0, ${JSON.stringify(sourceDir)}); ` +
    'from aijian_api.sidecar import run; run()';
  const child = spawn(envelope.python_exe, ['-I', '-B', '-c', code],
    { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const record = { case_number: caseNumber, open_number: openNumber,
    launcher_pid: child.pid, sidecar_pid: null, status: 'STARTING' };
  result.sidecar_launches.push(record);
  session = { child, record, token: null, origin: null };
  child.stdout.pipe(createWriteStream(join(evidence,
    `sidecar-${caseNumber}-${openNumber}.stdout.raw`), { flags: 'wx' }));
  child.stderr.pipe(createWriteStream(join(evidence,
    `sidecar-${caseNumber}-${openNumber}.stderr.raw`), { flags: 'wx' }));
  const lines = createInterface({ input: child.stdout });
  const handshake = await Promise.race([
    new Promise((ready, failed) => {
      lines.once('line', (line) => {
        try { ready(JSON.parse(line)); } catch (error) { failed(error); }
      });
      child.once('exit', (code) => failed(new Error(`Sidecar exited: ${code}`)));
    }),
    new Promise((_, failed) => setTimeout(() => failed(new Error('Handshake timeout')), 30000)),
  ]);
  eq(handshake.event, 'ready', 'Sidecar handshake');
  eq(handshake.host, '127.0.0.1', 'Loopback host');
  eq(handshake.protocol_version, 1, 'Protocol');
  assert.ok(Number.isSafeInteger(handshake.pid) && handshake.pid > 0);
  assert.notEqual(handshake.pid, child.pid, 'Windows venv redirector expected');
  const lineage = processes([child.pid, handshake.pid]);
  const launcher = lineage.find((row) => row.ProcessId === child.pid);
  const actual = lineage.find((row) => row.ProcessId === handshake.pid);
  assert.ok(launcher && actual, 'Missing launcher or actual sidecar');
  eq(actual.ParentProcessId, child.pid, 'Sidecar parent');
  eq(resolve(launcher.ExecutablePath).toLowerCase(),
    resolve(envelope.python_exe).toLowerCase(), 'Launcher path');
  eq(resolve(actual.ExecutablePath).toLowerCase(),
    resolve(envelope.actual_python_exe).toLowerCase(), 'Actual Python path');
  eq(hash(launcher.ExecutablePath), pin('python-launcher').sha256, 'Launcher SHA');
  eq(hash(actual.ExecutablePath), pin('python-actual').sha256, 'Actual Python SHA');
  record.sidecar_pid = handshake.pid;
  record.launcher_executable_sha256 = hash(launcher.ExecutablePath);
  record.actual_executable_sha256 = hash(actual.ExecutablePath);
  record.lineage = lineage;
  record.handshake_sha256 = sha(Buffer.from(JSON.stringify(handshake)));
  record.port = handshake.port;
  session.token = handshake.token;
  session.origin = `http://127.0.0.1:${handshake.port}`;
  let healthy = false;
  for (let n = 0; n < 40; n++) {
    try {
      const response = await fetch(session.origin + '/api/v1/health', {
        headers: auth(session.token), signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) { healthy = true; break; }
    } catch { /* bounded readiness GET only */ }
    await delay(250);
  }
  assert.ok(healthy, 'Sidecar health timeout');
  record.status = 'HEALTHY';
  await save();
}
async function close() {
  if (!session) return;
  const { child, record } = session;
  const ended = child.exitCode !== null
    ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
    : new Promise((done) => child.once('exit', (code, signal) => done({ code, signal })));
  child.stdin.end();
  const outcome = await Promise.race([ended,
    new Promise((done) => setTimeout(() => done(null), 15000))]);
  record.normal_close = outcome;
  record.after_close_processes = await waitGone(
    [record.launcher_pid, record.sidecar_pid].filter(Boolean));
  if (!outcome) {
    const killed = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, encoding: 'utf8', timeout: 15000 });
    record.taskkill = { status: killed.status, stdout: killed.stdout,
      stderr: killed.stderr };
  }
  session = null;
  eq(outcome?.code, 0, 'Sidecar normal close');
  assert.deepEqual(record.after_close_processes, [], 'Sidecar process remains');
  record.status = 'NORMAL_CLOSE';
  await save();
}
function readDb(profile) {
  const path = join(profile, 'data', 'workspace.sqlite3');
  assert.ok(existsSync(path), 'Database missing');
  const inspected = spawnSync(envelope.python_exe,
    ['-I', '-B', join(PKG, 'inspect-db.py'), path],
    { cwd: root, windowsHide: true, timeout: 15000, encoding: 'utf8' });
  eq(inspected.status, 0, `DB readback: ${inspected.stderr}`);
  const rows = JSON.parse(inspected.stdout);
  eq(rows.integrity, 'ok', 'DB integrity');
  eq(rows.user_version, 26, 'Schema version');
  eq(rows.projects, 1, 'Project rows');
  eq(rows.media_assets, 1, 'Asset rows');
  eq(rows.media_asset_versions, 1, 'Version rows');
  eq(rows.media_asset_episode_references, 0, 'Reference rows');
  eq(rows.provider_connections, 0, 'Provider connections');
  eq(rows.sub2api_call_approvals, 0, 'Remote call approvals');
  eq(rows.sub2api_call_consumptions, 0, 'Remote call consumptions');
  return { path, bytes: statSync(path).size, sha256: hash(path), rows };
}
async function content(projectId, assetId, versionId, label) {
  const got = await http(session, 'GET', `/api/v1/projects/${projectId}/assets/` +
    `${assetId}/versions/${versionId}/content`, label);
  eq(got.receipt.status, 200, 'Content HTTP');
  eq(got.receipt.headers['content-type'], 'video/webm', 'Content MIME');
  eq(got.receipt.headers.etag,
    `"sha256-${envelope.webm_sha256.toLowerCase()}"`, 'Content ETag');
  eq(got.bytes.byteLength, media.byteLength, 'Content bytes');
  eq(sha(got.bytes), envelope.webm_sha256, 'Content SHA');
}
async function unsafeGate(profile) {
  const gate = join(profile, 'unsafe-gate');
  const target = join(gate, 'target');
  await mkdir(target, { recursive: true });
  symlinkSync(target, join(gate, 'junction'), 'junction');
  const checked = spawnSync(envelope.python_exe,
    ['-I', '-B', join(PKG, 'unsafe-gate.py'), helper, gate],
    { cwd: root, windowsHide: true, timeout: 15000, encoding: 'utf8' });
  await writeFile(join(evidence, 'unsafe-gate.stdout.raw'), checked.stdout ?? '',
    { flag: 'wx' });
  await writeFile(join(evidence, 'unsafe-gate.stderr.raw'), checked.stderr ?? '',
    { flag: 'wx' });
  eq(checked.status, 0, `Unsafe gate Python: ${checked.stderr}`);
  const observed = JSON.parse(checked.stdout);
  for (const name of ['relative', 'traversal', 'outside', 'unc', 'junction',
    'ambiguous']) assert.ok(['ValueError', 'FileNotFoundError'].includes(observed[name]),
    `Unsafe path accepted: ${name}`);
  result.helper_negatives = observed;
  await save();
}

try {
  await save();
  await unsafeGate(profiles[0]);
  for (let i = 0; i < profiles.length; i++) {
    const number = i + 1;
    const profile = profiles[i];
    const record = { number, logical_blob_path_length: 265 + i,
      status: 'STARTED' };
    result.cases.push(record);
    await launch(profile, number, 1);
    const created = await http(session, 'POST', '/api/v1/projects',
      `case-${number}-project-create`, JSON.stringify({
        name: `QA02 HTTP longpath ${265 + i} 20260928`, aspect_ratio: '9:16',
        target_duration_seconds: 90, source_language: 'zh-CN',
      }), { 'Content-Type': 'application/json' });
    eq(created.receipt.status, 201, 'Project create');
    const project = JSON.parse(created.bytes.toString('utf8')).data;
    assert.match(project.id, /^prj_[0-9a-f]{32}$/);
    record.project_id = project.id;
    const imported = await http(session, 'POST',
      `/api/v1/projects/${project.id}/assets/import`, `case-${number}-import-webm`,
      media, { 'Content-Type': 'application/octet-stream',
        'X-Aivora-Filename': 'v1-blue.webm' });
    eq(imported.receipt.status, 201, 'WebM import');
    const asset = JSON.parse(imported.bytes.toString('utf8')).data;
    assert.match(asset.id, /^asset_[0-9a-f]{32}$/);
    assert.match(asset.latest_version.id, /^asv_[0-9a-f]{32}$/);
    eq(asset.latest_version.sha256.toUpperCase(), envelope.webm_sha256, 'Stored SHA');
    eq(asset.latest_version.byte_size, media.byteLength, 'Stored bytes');
    eq(asset.latest_version.mime_type, 'video/webm', 'Stored MIME');
    eq(asset.latest_version.rights_status, 'PENDING_REVIEW', 'Rights default');
    record.asset_id = asset.id;
    record.version_id = asset.latest_version.id;
    const blob = join(profile, 'data', 'media-assets', 'blobs',
      envelope.webm_sha256.slice(0, 2).toLowerCase(),
      envelope.webm_sha256.toLowerCase());
    eq(blob.length, 265 + i, 'Observed blob logical length');
    eq(hash('\\\\?\\' + blob), envelope.webm_sha256, 'Managed blob SHA');
    await content(project.id, asset.id, asset.latest_version.id,
      `case-${number}-content-first`);
    await close();
    record.database_after_first_close = readDb(profile);
    await launch(profile, number, 2);
    const listed = await http(session, 'GET',
      `/api/v1/projects/${project.id}/assets`, `case-${number}-list-reopen`);
    eq(listed.receipt.status, 200, 'Reopen list');
    const rows = JSON.parse(listed.bytes.toString('utf8')).data;
    const reopened = rows.find((item) => item.id === asset.id);
    assert.ok(reopened, 'Asset absent after reopen');
    eq(reopened.latest_version.id, asset.latest_version.id, 'Reopened version');
    await content(project.id, asset.id, asset.latest_version.id,
      `case-${number}-content-reopen`);
    await close();
    record.database_after_second_close = readDb(profile);
    record.status = 'PASS_ISOLATED_HTTP_CASE';
    await save();
  }
  result.status = 'PASS_ISOLATED_HTTP_REVIEW_REQUIRED';
} catch (error) {
  result.status = 'FIRST_RED_OR_UNKNOWN_PRESERVED';
  result.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (session) {
    try { await close(); } catch (error) { result.sidecar_close_error = String(error); }
  }
  result.finished_utc = new Date().toISOString();
  await save();
}
