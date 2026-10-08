/* One approved local sidecar + headless Edge media slice. No Electron UI. */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const PACKAGE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((part) => {
  const at = part.indexOf('=');
  assert.ok(part.startsWith('--') && at > 2, `Bad argument ${part}`);
  return [part.slice(2, at), part.slice(at + 1)];
}));
for (const key of ['approval', 'approval-sha256']) assert.ok(args[key], `Missing ${key}`);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const hash = (path) => sha(readFileSync(path));
const exact = (actual, expected, label) => assert.equal(actual, expected, label);
const envelopePath = join(PACKAGE, 'RUN-ENVELOPE.json');
const indexPath = join(PACKAGE, 'PACKAGE-SHA256.json');
const approvalPath = resolve(args.approval);
exact(hash(approvalPath), args['approval-sha256'].toUpperCase(), 'Approval SHA');
const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
const envelope = JSON.parse(readFileSync(envelopePath, 'utf8'));
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
assert.equal(index.schema, 'qa02.media-short-headless.r04.package-index.v1');
assert.equal(approval.kind, 'QA02_MEDIA_SHORT_HEADLESS_R04_ONE_SHOT');
assert.equal(approval.status, 'MGR02_APPROVED_ONCE');
assert.equal(approval.headless_only, true);
assert.equal(approval.provider_calls_allowed, 0);
exact(approval.package_index_sha256, hash(indexPath), 'Package index SHA');
exact(approval.envelope_sha256, hash(envelopePath), 'Envelope SHA');
exact(approval.runner_sha256, hash(fileURLToPath(import.meta.url)), 'Runner SHA');
assert.equal(envelope.schema, 'qa02.media-short-headless.r04.envelope.v1');
assert.equal(envelope.status, 'READY_FOR_EXTERNAL_ONE_SHOT');
assert.equal(envelope.sidecar_max_launches, 2);
assert.equal(envelope.headless_browser_max_launches, 1);
assert.equal(envelope.provider_calls_allowed, 0);
assert.equal(envelope.electron_visible, 'NOT_RUN');
assert.equal(envelope.rights_g1, 'NOT_RUN');
assert.equal(approval.profile_dir, envelope.profile_dir);
assert.equal(approval.evidence_dir, envelope.evidence_dir);
assert.equal(approval.max_sidecar_launches, 2);
assert.equal(approval.max_headless_browser_launches, 1);
for (const item of index.files) {
  const path = join(PACKAGE, item.name);
  exact(hash(path), item.sha256, `Package changed: ${item.name}`);
  exact(readFileSync(path).byteLength, item.bytes, `Package size: ${item.name}`);
}
for (const item of envelope.pins) {
  exact(hash(item.path), item.sha256, `Pinned input changed: ${item.role}`);
  exact(readFileSync(item.path).byteLength, item.bytes, `Pinned size: ${item.role}`);
}
const root = resolve(envelope.c19_root);
assert.equal(realpathSync.native(process.execPath).toLowerCase(),
  realpathSync.native(envelope.node_exe).toLowerCase(), 'Wrong Node executable');
const profile = resolve(envelope.profile_dir);
const evidence = resolve(envelope.evidence_dir);
assert.equal(profile, 'C:\\Users\\Administrator\\Documents\\Codex\\qa02-r04-short-profile-20260928',
  'Profile must be the exact isolated short path');
assert.equal(dirname(evidence), PACKAGE, 'Evidence must be a new QA-owned sibling');
assert.ok(!existsSync(profile) && !existsSync(evidence), 'Output already exists');
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
assert.equal(head.status, 0);
exact(head.stdout.trim(), envelope.git_head, 'Git HEAD changed');
const sourceManifest = JSON.parse(readFileSync(envelope.source_manifest, 'utf8'));
assert.equal(sourceManifest.schema, 'qa02.media-short-headless.r04.source-files.v1');
exact(approval.source_manifest_sha256, hash(envelope.source_manifest),
  'Approval source manifest SHA');
assert.equal(sourceManifest.git_head, envelope.git_head);
assert.equal(sourceManifest.count, sourceManifest.files.length);
const status = spawnSync('git', ['status', '--short', '--untracked-files=all'],
  { cwd: root, encoding: 'utf8' });
assert.equal(status.status, 0);
assert.deepEqual(status.stdout.split(/\r?\n/).filter(Boolean), sourceManifest.git_status,
  'Git status changed');
for (const item of sourceManifest.files) {
  const path = join(root, item.path);
  exact(hash(path), item.sha256, `Source changed: ${item.path}`);
  exact(readFileSync(path).byteLength, item.bytes, `Source size: ${item.path}`);
}
const edge = resolve(envelope.edge_exe);
const python = resolve(envelope.python_exe);
const actualPython = resolve(envelope.actual_python_exe);
exact(hash(actualPython), envelope.actual_python_sha256, 'Actual Python SHA');
exact(hash(edge), envelope.edge_exe_sha256, 'Edge SHA');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright-core');
const manifest = JSON.parse(readFileSync(envelope.input_manifest, 'utf8'));
const inputIndex = JSON.parse(readFileSync(envelope.input_package_index, 'utf8'));
assert.equal(inputIndex.files.length, 13);
for (const item of inputIndex.files) {
  const path = join(dirname(envelope.input_package_index), item.name);
  exact(hash(path), item.sha256, `Input package changed: ${item.name}`);
  exact(readFileSync(path).byteLength, item.bytes,
    `Input package size: ${item.name}`);
}
const positive = manifest.files.filter((item) => item.case === 'positive');
const invalid = manifest.files.find((item) => item.role === 'decoder-invalid');
assert.deepEqual(positive.map((item) => item.role), ['webm', 'wav', 'mp3']);
assert.ok(invalid);

await mkdir(profile, { recursive: false, mode: 0o700 });
await mkdir(evidence, { recursive: false, mode: 0o700 });
await mkdir(join(profile, 'temp'), { recursive: false });
process.env.TEMP = join(profile, 'temp');
process.env.TMP = join(profile, 'temp');
const result = {
  schema: 'qa02.media-short-headless.r04.result.v1',
  status: 'STARTED', label: 'HTTP_PLUS_HEADLESS_CHROMIUM_NOT_ELECTRON',
  approval_sha256: hash(approvalPath), envelope_sha256: hash(envelopePath),
  package_index_sha256: hash(indexPath), sidecar_launches: [],
  imported: [], reopened: [], browser: [], provider_calls: 0,
};
const save = async () => writeFile(join(evidence, 'result.json'),
  JSON.stringify(result, null, 2) + '\n', { flag: 'w' });
let child = null;
let browser = null;
let token = null;
let origin = null;
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
function processRecords(ids) {
  assert.ok(ids.length > 0 && ids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
  const condition = ids.map((pid) => `ProcessId = ${pid}`).join(' OR ');
  const script = `Get-CimInstance Win32_Process -Filter '${condition}' | ` +
    'Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ' +
    'ConvertTo-Json -Compress';
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script],
    { encoding: 'utf8', timeout: 10000 }).trim();
  return output ? [JSON.parse(output)].flat() : [];
}
async function waitGone(ids) {
  let remaining = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    remaining = processRecords(ids);
    if (remaining.length === 0) return [];
    await delay(100);
  }
  return remaining;
}
function edgeProcesses() {
  const script = "Get-CimInstance Win32_Process -Filter \"Name = 'msedge.exe'\" | " +
    'Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ' +
    'ConvertTo-Json -Compress';
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script],
    { encoding: 'utf8', timeout: 10000 }).trim();
  const all = output ? [JSON.parse(output)].flat() : [];
  const profileMarker = join(profile, 'edge-user-data').replaceAll('/', '\\')
    .toLowerCase();
  return all.filter((row) => String(row.CommandLine ?? '').replaceAll('/', '\\')
    .toLowerCase().includes(profileMarker));
}
async function waitEdgeGone() {
  let remaining = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    remaining = edgeProcesses();
    if (remaining.length === 0) return [];
    await delay(100);
  }
  return remaining;
}

async function launchSidecar(number) {
  const data = join(profile, 'data');
  const local = join(profile, 'local-app-data');
  await mkdir(data, { recursive: true });
  await mkdir(local, { recursive: true });
  const env = { ...process.env,
    AIJIAN_DATA_DIR: data,
    LOCALAPPDATA: local,
    APPDATA: local,
    TEMP: join(profile, 'temp'), TMP: join(profile, 'temp'),
    PYTHONPATH: join(root, 'services', 'api', 'src'),
    PYTHONNOUSERSITE: '1',
  };
  delete env.AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME;
  await mkdir(env.TEMP, { recursive: true });
  const stdout = createWriteStream(join(evidence, `sidecar-${number}.stdout.raw`), { flags: 'wx' });
  const stderr = createWriteStream(join(evidence, `sidecar-${number}.stderr.raw`), { flags: 'wx' });
  const entry = `import sys; sys.path.insert(0, ${JSON.stringify(join(root,
    'services', 'api', 'src'))}); from aijian_api.sidecar import run; run()`;
  child = spawn(python, ['-I', '-B', '-c', entry],
    { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const launch = { number, launcher_pid: child.pid, sidecar_pid: null,
    status: 'STARTING' };
  result.sidecar_launches.push(launch);
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const lines = createInterface({ input: child.stdout });
  const handshake = await Promise.race([
    new Promise((resolveReady, rejectReady) => {
      lines.once('line', (line) => {
        try { resolveReady(JSON.parse(line)); } catch (error) { rejectReady(error); }
      });
      child.once('exit', (code) => rejectReady(new Error(`Sidecar exited before ready: ${code}`)));
    }),
    new Promise((_, rejectTimeout) => setTimeout(() =>
      rejectTimeout(new Error('Sidecar handshake timeout')), 30000)),
  ]);
  assert.equal(handshake.event, 'ready');
  assert.ok(Number.isSafeInteger(handshake.pid) && handshake.pid > 0);
  assert.notEqual(handshake.pid, child.pid, 'Expected venv redirector child');
  const lineage = processRecords([child.pid, handshake.pid]);
  const launcherRecord = lineage.find((row) => row.ProcessId === child.pid);
  const actualRecord = lineage.find((row) => row.ProcessId === handshake.pid);
  assert.ok(launcherRecord && actualRecord, 'Sidecar lineage missing');
  assert.equal(actualRecord.ParentProcessId, child.pid, 'Sidecar parent mismatch');
  assert.equal(resolve(launcherRecord.ExecutablePath).toLowerCase(),
    python.toLowerCase(), 'Venv launcher executable mismatch');
  exact(hash(launcherRecord.ExecutablePath), envelope.pins.find((item) =>
    item.role === 'sidecar-python-launcher').sha256,
  'Venv launcher SHA changed');
  assert.equal(resolve(actualRecord.ExecutablePath).toLowerCase(),
    actualPython.toLowerCase(), 'Actual Python executable mismatch');
  exact(hash(actualRecord.ExecutablePath), envelope.actual_python_sha256,
    'Actual Python SHA changed');
  assert.equal(handshake.host, '127.0.0.1');
  assert.equal(handshake.protocol_version, 1);
  assert.match(handshake.token, /^[A-Za-z0-9_-]{43,}$/);
  token = handshake.token;
  origin = `http://127.0.0.1:${handshake.port}`;
  launch.port = handshake.port;
  launch.sidecar_pid = handshake.pid;
  launch.launcher_executable_path = launcherRecord.ExecutablePath;
  launch.launcher_executable_sha256 = hash(launcherRecord.ExecutablePath);
  launch.sidecar_executable_path = actualRecord.ExecutablePath;
  launch.sidecar_executable_sha256 = hash(actualRecord.ExecutablePath);
  launch.lineage = lineage;
  launch.handshake_sha256 = sha(Buffer.from(JSON.stringify(handshake)));
  launch.status = 'HANDSHAKE_RECEIVED';
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${origin}/api/v1/health`, {
        headers: authHeaders(), signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) { healthy = true; break; }
    } catch { /* bounded readiness GET, no write retry */ }
    await delay(250);
  }
  assert.ok(healthy, 'Sidecar not healthy after handshake');
  launch.status = 'HEALTHY';
  await save();
}

function authHeaders(extra = {}) {
  assert.ok(token && origin, 'No sidecar session');
  return { Authorization: `Bearer ${token}`, Origin: 'app://aijian', ...extra };
}

async function request(method, path, label, body, extra = {}) {
  const response = await fetch(origin + path, {
    method, headers: authHeaders(extra), body,
    signal: AbortSignal.timeout(30000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const stem = label.replace(/[^a-z0-9-]/gi, '_');
  await writeFile(join(evidence, `${stem}.body.raw`), bytes, { flag: 'wx' });
  const headers = Object.fromEntries(response.headers.entries());
  const receipt = { method, path, status: response.status, headers,
    bytes: bytes.byteLength, sha256: sha(bytes), body_path: `${stem}.body.raw` };
  await writeFile(join(evidence, `${stem}.http.json`),
    JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return { response, bytes, receipt };
}

async function stopSidecar(number) {
  if (!child) return;
  const current = child;
  const launch = result.sidecar_launches[number - 1];
  const ended = current.exitCode !== null
    ? Promise.resolve({ code: current.exitCode, signal: current.signalCode })
    : new Promise((resolveEnded) => current.once('exit',
      (code, signal) => resolveEnded({ code, signal })));
  current.stdin.end();
  const outcome = await Promise.race([ended,
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(null), 15000))]);
  launch.normal_close = outcome;
  launch.after_close_processes = await waitGone(
    [launch.launcher_pid, launch.sidecar_pid].filter(Boolean));
  if (!outcome || outcome.code !== 0) {
    if (!outcome) {
      const killed = spawnSync('taskkill', ['/PID', String(current.pid), '/T', '/F'],
        { windowsHide: true, timeout: 15000, encoding: 'utf8' });
      launch.taskkill = { status: killed.status, stdout: killed.stdout,
        stderr: killed.stderr };
    }
    child = null;
    throw new Error(`Sidecar ${number} did not close normally`);
  }
  assert.deepEqual(launch.after_close_processes, [],
    `Sidecar ${number} left launcher or actual process`);
  launch.status = 'NORMAL_CLOSE';
  child = null;
  token = null;
  origin = null;
  await save();
}

function inspectDatabase(path) {
  const inspected = spawnSync(python, ['-I', '-B', join(PACKAGE, 'inspect-db.py'), path],
    { cwd: root, windowsHide: true, timeout: 15000, encoding: 'utf8' });
  assert.equal(inspected.status, 0, `DB inspect: ${inspected.stderr}`);
  const rows = JSON.parse(inspected.stdout);
  assert.equal(rows.integrity, 'ok');
  assert.equal(rows.user_version, 26);
  assert.equal(rows.projects, 1);
  assert.equal(rows.media_assets, 4);
  assert.equal(rows.media_asset_versions, 4);
  assert.equal(rows.media_asset_episode_references, 0);
  assert.equal(rows.provider_connections, 0);
  assert.equal(rows.sub2api_call_approvals, 0);
  assert.equal(rows.sub2api_call_consumptions, 0);
  return rows;
}

function databaseFiles(path) {
  return [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]
    .filter((candidate) => existsSync(candidate))
    .map((candidate) => ({ path: candidate, bytes: readFileSync(candidate).byteLength,
      sha256: hash(candidate) }));
}

async function readOriginal(projectId, imported, label) {
  const path = `/api/v1/projects/${projectId}/assets/${imported.asset_id}` +
    `/versions/${imported.version_id}/content`;
  const got = await request('GET', path, label);
  exact(got.response.status, 200, `Content GET ${imported.role}`);
  exact(got.receipt.headers['content-type'], imported.mime_type, 'Content MIME');
  exact(got.receipt.headers.etag, `"sha256-${imported.sha256.toLowerCase()}"`, 'Content ETag');
  exact(got.bytes.byteLength, imported.bytes, 'Content length');
  exact(sha(got.bytes), imported.sha256, 'Content bytes SHA');
  return got.bytes;
}

async function decodeMedia(role, bytes, mime, expectError = false) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><button id="play">Play</button>' +
    '<button id="pause">Pause</button><div id="mount"></div></body></html>');
  await page.evaluate(({ role: kind, data, mimeType }) => {
    const media = document.createElement(kind === 'webm' ? 'video' : 'audio');
    media.id = 'media'; media.controls = true; media.preload = 'auto';
    window.__mediaEvents = [];
    for (const name of ['loadedmetadata', 'canplay', 'playing', 'timeupdate',
      'pause', 'seeked', 'error']) media.addEventListener(name, () =>
      window.__mediaEvents.push({ name, time: media.currentTime,
        error: media.error?.code ?? null }));
    window.__mediaUrl = URL.createObjectURL(new Blob([new Uint8Array(data)],
      { type: mimeType }));
    media.src = window.__mediaUrl;
    document.querySelector('#mount').append(media);
    document.querySelector('#play').onclick = () => { void media.play(); };
    document.querySelector('#pause').onclick = () => media.pause();
  }, { role, data: [...bytes], mimeType: mime });
  await page.waitForFunction(() => window.__mediaEvents.some((item) =>
    item.name === 'loadedmetadata' || item.name === 'error'), null,
  { timeout: 15000 });
  const initial = await page.locator('#media').evaluate((media) => ({
    duration: media.duration, readyState: media.readyState,
    networkState: media.networkState, error: media.error?.code ?? null,
    videoWidth: media.videoWidth ?? null, videoHeight: media.videoHeight ?? null,
  }));
  if (expectError) {
    assert.ok(initial.error !== null, 'Undecodable bytes unexpectedly loaded');
    assert.ok(!(await page.evaluate(() => window.__mediaEvents.some((item) =>
      item.name === 'playing'))), 'Invalid media played');
  } else {
    assert.equal(initial.error, null, `Decoder error for ${role}`);
    assert.ok(Number.isFinite(initial.duration) && initial.duration > 0,
      `No duration for ${role}`);
    await page.locator('#play').click();
    await page.waitForFunction(() => {
      const media = document.querySelector('#media');
      return media.currentTime > 0.2 && window.__mediaEvents.some((item) =>
        item.name === 'playing') && window.__mediaEvents.some((item) =>
        item.name === 'timeupdate');
    }, null, { timeout: 15000 });
    await page.locator('#pause').click();
    assert.equal(await page.locator('#media').evaluate((media) => media.paused), true);
    await page.locator('#media').evaluate((media) => {
      media.currentTime = Math.min(media.duration * 0.5, media.duration - 0.1);
    });
    await page.waitForFunction(() => window.__mediaEvents.some((item) =>
      item.name === 'seeked'), null, { timeout: 15000 });
  }
  const observed = await page.evaluate(() => ({
    events: window.__mediaEvents,
    currentTime: document.querySelector('#media').currentTime,
    paused: document.querySelector('#media').paused,
  }));
  await page.screenshot({ path: join(evidence, `headless-${role}.png`) });
  await page.evaluate(() => {
    URL.revokeObjectURL(window.__mediaUrl);
    document.querySelector('#media').removeAttribute('src');
    document.querySelector('#media').load();
  });
  await page.close();
  const record = { role, bytes: bytes.byteLength, sha256: sha(bytes),
    mime_type: mime, initial, ...observed, blob_url_revoked: true };
  result.browser.push(record);
  await writeFile(join(evidence, `headless-${role}.json`),
    JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  await save();
}

try {
  await save();
  await launchSidecar(1);
  const created = await request('POST', '/api/v1/projects', 'project-create',
    JSON.stringify({ name: envelope.project_name, aspect_ratio: '9:16',
      target_duration_seconds: 90, source_language: 'zh-CN' }),
    { 'Content-Type': 'application/json' });
  exact(created.response.status, 201, 'Project create HTTP status');
  const project = JSON.parse(created.bytes.toString('utf8')).data;
  assert.match(project.id, /^prj_[0-9a-f]{32}$/);
  result.project_id = project.id;
  await save();
  for (const input of [...positive, invalid]) {
    const bytes = readFileSync(input.path);
    exact(sha(bytes), input.sha256, `Input changed ${input.role}`);
    const imported = await request('POST',
      `/api/v1/projects/${project.id}/assets/import`,
      `import-${input.role}`, bytes,
      { 'Content-Type': 'application/octet-stream',
        'X-Aivora-Filename': encodeURIComponent(input.role + (input.role === 'webm'
          ? '.webm' : input.role === 'wav' ? '.wav' : '.mp3')) });
    exact(imported.response.status, 201, `Import ${input.role}`);
    const asset = JSON.parse(imported.bytes.toString('utf8')).data;
    const version = asset.latest_version;
    assert.match(asset.id, /^asset_[0-9a-f]{32}$/);
    assert.match(version.id, /^asv_[0-9a-f]{32}$/);
    exact(version.sha256.toUpperCase(), input.sha256, `Stored SHA ${input.role}`);
    exact(version.byte_size, input.bytes, `Stored bytes ${input.role}`);
    exact(version.mime_type, input.expected_mime_type, `Stored MIME ${input.role}`);
    const item = { role: input.role, asset_id: asset.id,
      version_id: version.id, sha256: input.sha256, bytes: input.bytes,
      mime_type: input.expected_mime_type,
      import_request_id: JSON.parse(imported.bytes.toString('utf8')).request_id };
    result.imported.push(item);
    await save();
    await readOriginal(project.id, item, `content-first-${input.role}`);
  }
  await stopSidecar(1);
  const dbPath = join(profile, 'data', 'workspace.sqlite3');
  assert.ok(existsSync(dbPath), 'Isolated database missing');
  result.database_after_first_close_sha256 = hash(dbPath);
  result.database_after_first_close_files = databaseFiles(dbPath);
  result.database_after_first_close = inspectDatabase(dbPath);
  await launchSidecar(2);
  assert.notEqual(result.sidecar_launches[1].launcher_pid,
    result.sidecar_launches[0].launcher_pid, 'Second launcher reused PID');
  assert.notEqual(result.sidecar_launches[1].sidecar_pid,
    result.sidecar_launches[0].sidecar_pid, 'Second sidecar reused PID');
  const listed = await request('GET',
    `/api/v1/projects/${project.id}/assets`, 'list-after-reopen');
  exact(listed.response.status, 200, 'Reopen list status');
  const rows = JSON.parse(listed.bytes.toString('utf8')).data;
  for (const item of result.imported) {
    const asset = rows.find((candidate) => candidate.id === item.asset_id);
    assert.ok(asset, `Missing reopened asset ${item.role}`);
    exact(asset.latest_version.id, item.version_id, `Version changed ${item.role}`);
    const bytes = await readOriginal(project.id, item,
      `content-reopen-${item.role}`);
    result.reopened.push({ role: item.role, asset_id: item.asset_id,
      version_id: item.version_id, bytes: bytes.byteLength, sha256: sha(bytes) });
  }
  await stopSidecar(2);
  result.database_after_second_close_sha256 = hash(dbPath);
  result.database_after_second_close_files = databaseFiles(dbPath);
  result.database_after_second_close = inspectDatabase(dbPath);
  browser = await chromium.launchPersistentContext(join(profile, 'edge-user-data'),
    { executablePath: edge, headless: true,
      args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run'],
      timeout: 30000, acceptDownloads: false });
  const edgeLineage = edgeProcesses();
  assert.ok(edgeLineage.length > 0, 'Headless Edge process not found');
  const edgeMain = edgeLineage.find((row) => !String(row.CommandLine ?? '')
    .includes('--type='));
  assert.ok(edgeMain, 'Headless Edge main process not found');
  assert.equal(resolve(edgeMain.ExecutablePath).toLowerCase(), edge.toLowerCase(),
    'Edge executable path mismatch');
  assert.ok(String(edgeMain.CommandLine).includes('--headless'),
    'Edge did not launch headless');
  exact(hash(edgeMain.ExecutablePath), envelope.edge_exe_sha256,
    'Running Edge executable SHA changed');
  result.edge_pid = edgeMain.ProcessId;
  result.edge_command_line = edgeMain.CommandLine;
  result.edge_executable_path = edgeMain.ExecutablePath;
  result.edge_executable_sha256 = hash(edgeMain.ExecutablePath);
  result.edge_processes_at_start = edgeLineage;
  for (const item of result.imported) {
    const bytes = readFileSync(join(evidence, `content-reopen-${item.role}.body.raw`));
    await decodeMedia(item.role, bytes, item.mime_type,
      item.role === 'decoder-invalid');
  }
  await browser.close();
  browser = null;
  result.edge_processes_after_close = await waitEdgeGone();
  assert.deepEqual(result.edge_processes_after_close, [],
    'Headless Edge process remains after close');
  result.status = 'PASS_HTTP_PLUS_HEADLESS_REVIEW_REQUIRED';
} catch (error) {
  result.status = 'FIRST_RED_OR_UNKNOWN_PRESERVED';
  result.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (browser) {
    try {
      await browser.close();
      result.edge_processes_after_failure_close = await waitEdgeGone();
    } catch (error) { result.browser_close_error = String(error); }
  }
  if (child) {
    try { await stopSidecar(result.sidecar_launches.length); }
    catch (error) { result.sidecar_close_error = String(error); }
  }
  result.finished_utc = new Date().toISOString();
  await save();
}
