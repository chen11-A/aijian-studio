import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname;
const repo = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const source = join(repo, 'services', 'api', 'src', 'aijian_api');
const old = join(root, 'script-identity-01');
const run = join(root, 'script-identity-readback-01');
const profile = join(old, 'profile');
const workspace = join(profile, 'workspace');
const db = join(workspace, 'workspace.sqlite3');
const sha = (value) => createHash('sha256').update(value).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
const expected = new Map([
  [join(old, 'CAPTURE.json'), 'A62A7E389282789F350662CF42569432025D313560CEAD9300F4FDBD59BB5494'],
  [join(old, 'project-create-response.raw'), 'F158E22A804EDF51A261297BF534D640B7BA60ACD59895A82E6222145F0AEB29'],
  [join(old, 'episode-create-response.raw'), 'A7C70F8F8DA800402DCF3D586D9CF37927EAD88E1892FB02F231E64FB7BFC23C'],
  [join(old, 'script-create-response.raw'), '358F35C50B837E467C3F28664502978627B448BEED0D5BD94732243D465844EB'],
  [join(old, 'script-read-response.raw'), '8F3D28EC3CA4DE8957CA922CA93173681A900E21E0A050CDE75A1ED82F968B20'],
  [join(root, 'script-identity-01-invocation.json'), '4E491EB2E14E99668C5EDCF5B9D9E8DA9573DB8AE10DFA1CEA2363DAB07DD335'],
  [db, '54533ABEEAC1E45DB3D643303967EFDCF9379024405853DF1B240838B80F90CC'],
  [join(source, 'episode_script_contracts.py'), '0028DB1DB4F2EC9C488E8E58F41BA361EF373E3CFD9617DCD4372C4648E25426'],
  [join(source, 'episode_script_store.py'), 'CD58D0B0F7CE6B1CEAB32D233544246B67A14722F84E4FBD8ACB54C4C651A65E'],
  [join(source, 'media_asset_routes.py'), '931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770'],
]);
for (const [path, hash] of expected) assert.equal(fileSha(path), hash, `Input drift: ${path}`);
assert.ok(!existsSync(run), 'GET-only readback output already exists');
const oldCapture = JSON.parse(readFileSync(join(old, 'CAPTURE.json')));
const originalInvocation = JSON.parse(readFileSync(join(root, 'script-identity-01-invocation.json')));
assert.equal(originalInvocation.exit.code, 1);
assert.equal(oldCapture.failure.message, 'Immediate exact-version read differs');
assert.deepStrictEqual(oldCapture.calls.map((call) => [call.method, call.response?.status]),
  [['POST', 201], ['POST', 201], ['POST', 201], ['GET', 200]]);
const project = JSON.parse(readFileSync(join(old, 'project-create-response.raw'))).data;
const episode = JSON.parse(readFileSync(join(old, 'episode-create-response.raw'))).data;
const version = JSON.parse(readFileSync(join(old, 'script-create-response.raw'))).data.version;
const oldExact = JSON.parse(readFileSync(join(old, 'script-read-response.raw'))).data;
function sameVersion(actual, expected, currentHead) {
  assert.deepStrictEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected)) {
    if (key !== 'head_revision') assert.deepStrictEqual(actual[key], expected[key]);
  }
  assert.equal(actual.head_revision, currentHead);
}
sameVersion(oldExact, version, 1); // Object key order is irrelevant.
assert.equal(project.id, version.project_id);
assert.equal(episode.id, version.episode_id);
assert.equal(episode.project_id, project.id);
assert.equal(episode.target_duration_seconds, '5');
assert.equal(episode.is_default, false);
assert.equal(version.content.scenes.length, 1);
const blocks = version.content.scenes[0].blocks;
assert.deepStrictEqual(blocks.map((block) => [block.kind, block.text, block.speaker, block.delivery]), [
  ['DIALOGUE', 'TEST 提示音一（非语音）', 'TEST 提示音（非人声）', 'OFF_SCREEN'],
  ['DIALOGUE', 'TEST 提示音二（非语音）', 'TEST 提示音（非人声）', 'OFF_SCREEN'],
]);

mkdirSync(run);
const command = join(repo, '.venv', 'Scripts', 'python.exe');
const args = ['-m', 'aijian_api.sidecar'];
const allowed = new Set(['APPDATA', 'HOME', 'LANG', 'LC_ALL', 'LOCALAPPDATA', 'PATH',
  'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR']);
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (allowed.has(key.toUpperCase()) && value !== undefined) env[key] = value;
}
Object.assign(env, {
  APPDATA: join(profile, 'appdata'), LOCALAPPDATA: join(profile, 'localappdata'),
  HOME: join(profile, 'home'), USERPROFILE: profile,
  TEMP: join(profile, 'temp'), TMP: join(profile, 'temp'),
  AIJIAN_DATA_DIR: workspace, PYTHONPATH: join(repo, 'services', 'api', 'src'),
  PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1',
});
const capture = { scope: 'SYNTHETIC_TEST_ONLY', mode: 'GET_ONLY_RESTART',
  original_run_exit: 1, original_capture_sha256: expected.get(join(old, 'CAPTURE.json')),
  db_sha256_before: fileSha(db), command, args, cwd: repo, calls: [] };
const save = () => writeFileSync(join(run, 'CAPTURE.json'), JSON.stringify(capture, null, 2) + '\n');
save();
const child = spawn(command, args, { cwd: repo, env, shell: false, windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'] });
const stdoutPath = join(run, 'sidecar-stdout.raw');
const stderrPath = join(run, 'sidecar-stderr.raw');
const stdout = createWriteStream(stdoutPath);
const stderr = createWriteStream(stderrPath);
capture.process = { launcher_pid: child.pid ?? null, stdout_path: stdoutPath, stderr_path: stderrPath };
save();
let buffer = Buffer.alloc(0);
let settle;
let settled = false;
const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });
child.stdout.on('data', (chunk) => {
  stdout.write(chunk);
  if (settled) return;
  buffer = Buffer.concat([buffer, chunk]);
  if (buffer.length > 65536) { settled = true; settle.reject(new Error('Handshake too large')); return; }
  const end = buffer.indexOf(10);
  if (end < 0) return;
  settled = true;
  try {
    const message = JSON.parse(buffer.subarray(0, end).toString('utf8'));
    assert.equal(message.event, 'ready');
    assert.equal(message.host, '127.0.0.1');
    assert.equal(message.protocol_version, 1);
    assert.ok(Number.isInteger(message.port));
    assert.ok(typeof message.token === 'string' && message.token.length >= 43);
    capture.process.handshake = { event: message.event, host: message.host,
      port: message.port, pid: message.pid, protocol_version: message.protocol_version,
      token_length: message.token.length };
    save();
    settle.resolve(message);
  } catch (error) { settle.reject(error); }
});
child.stdout.on('end', () => stdout.end());
child.stderr.on('data', (chunk) => stderr.write(chunk));
child.stderr.on('end', () => stderr.end());
child.on('error', (error) => { capture.process.error = String(error);
  if (!settled) { settled = true; settle.reject(error); } });
const closed = new Promise((resolve) => child.once('close', (code, signal) => {
  capture.process.exit = { code, signal };
  if (!settled) { settled = true; settle.reject(new Error('Sidecar exited before ready')); }
  resolve(capture.process.exit);
}));
const timer = setTimeout(() => { if (!settled) {
  settled = true; settle.reject(new Error('Sidecar startup timeout')); } }, 20000);
async function request(session, label, path) {
  const requestId = randomUUID();
  const record = { label, method: 'GET', path, request_id: requestId,
    dispatch_started: new Date().toISOString() };
  capture.calls.push(record); save();
  const response = await fetch(`http://127.0.0.1:${session.port}${path}`, {
    method: 'GET', headers: { Authorization: `Bearer ${session.token}`,
      Origin: 'app://aijian', 'X-Request-ID': requestId }, signal: AbortSignal.timeout(10000),
  });
  const body = Buffer.from(await response.arrayBuffer());
  const raw = join(run, `${label}-response.raw`);
  writeFileSync(raw, body);
  record.response = { status: response.status, headers: Object.fromEntries(response.headers),
    file: raw, bytes: body.length, sha256: sha(body) };
  save();
  assert.equal(response.status, 200, `${label} HTTP status`);
  return JSON.parse(body.toString('utf8')).data;
}
try {
  const session = await ready;
  clearTimeout(timer);
  const actualProject = await request(session, 'project-reopen', `/api/v1/projects/${project.id}`);
  assert.equal(actualProject.id, project.id);
  assert.equal(actualProject.name, project.name);
  const actualEpisode = await request(session, 'episode-reopen',
    `/api/v1/projects/${project.id}/episodes/${episode.id}`);
  assert.equal(actualEpisode.id, episode.id);
  assert.equal(actualEpisode.project_id, project.id);
  assert.equal(actualEpisode.target_duration_seconds, '5');
  assert.equal(actualEpisode.is_default, false);
  const exactPath = `/api/v1/projects/${project.id}/episodes/${episode.id}/script/versions/${version.version_id}`;
  const actualVersion = await request(session, 'script-exact-reopen', exactPath);
  sameVersion(actualVersion, version, 1);
  assert.equal(actualVersion.content_hash, version.content_hash);
  const latest = await request(session, 'script-latest-reopen',
    `/api/v1/projects/${project.id}/episodes/${episode.id}/script`);
  sameVersion(latest, version, 1);
  capture.status = 'GET_ONLY_RESTART_PASS';
} catch (error) {
  capture.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  child.stdin.end();
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (!capture.process.exit) child.kill();
  await closed;
  await Promise.all([stdout, stderr].map((stream) => stream.writableFinished
    ? Promise.resolve() : new Promise((resolve) => stream.once('finish', resolve))));
  capture.process.stdout_sha256 = fileSha(stdoutPath);
  capture.process.stderr_sha256 = fileSha(stderrPath);
  capture.process.stdout_bytes = statSync(stdoutPath).size;
  capture.process.stderr_bytes = statSync(stderrPath).size;
  capture.db_sha256_after = fileSha(db);
  save();
}
if (capture.status === 'GET_ONLY_RESTART_PASS' && capture.process.exit.code === 0) {
  const identity = { state: 'REOPEN_VERIFIED_WITH_ORIGINAL_EXIT_1', scope: 'SYNTHETIC_TEST_ONLY',
    project_id: project.id, episode_id: episode.id, script_version_id: version.version_id,
    script_content_hash: version.content_hash, version_number: version.version_number,
    head_revision: version.head_revision, scene_id: version.content.scenes[0].scene_id,
    block_ids: blocks.map((block) => block.block_id),
    texts: blocks.map((block) => block.text), speaker: 'TEST 提示音（非人声）',
    delivery: 'OFF_SCREEN', original_run_exit: 1, get_only_reopen: true,
  };
  writeFileSync(join(run, 'IDENTITY-READBACK.json'), JSON.stringify(identity, null, 2) + '\n');
  console.log(JSON.stringify(identity));
} else {
  console.error(JSON.stringify(capture.failure ?? { message: 'Sidecar exit was not zero' }));
  process.exitCode = 1;
}
