import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const spec = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-09-23\\aivora-git-c-users-administrator-documents\\work\\art04-mlt-test-20260928\\MLT-唯一合成TEST工程规格.md';
const specHash = '4323dfef3eef9337baf49a5118de1397b4c2afbe2e67768e133f87c950ddf16d';
const requiredContractHash = process.env.QA_A_CONTRACT_SHA256?.toLowerCase();
const contractPath = join(repo, 'services', 'api', 'src', 'aijian_api', 'episode_script_contracts.py');
const storePath = join(repo, 'services', 'api', 'src', 'aijian_api', 'episode_script_store.py');
const routePath = join(repo, 'services', 'api', 'src', 'aijian_api', 'media_asset_routes.py');
const storeHash = 'cd58d0b0f7ce6b1ceab32d233544246b67a14722f84e4fbd8acb54c4c651a65e';
const routeHash = '931d14f8b3d3069ed89e224c6bf4ebf2ee4ca9ca34dafc9a6415cd2e1b3b8770';
const run = process.argv[2];
const sha = (value) => createHash('sha256').update(value).digest('hex');
if (sha(readFileSync(spec)) !== specHash) throw new Error('TEST specification SHA differs');
if (!requiredContractHash || sha(readFileSync(contractPath)) !== requiredContractHash) {
  throw new Error('The manager-frozen A contract SHA must match before any API call');
}
if (sha(readFileSync(storePath)) !== storeHash || sha(readFileSync(routePath)) !== routeHash) {
  throw new Error('The manager-frozen A store and sidecar route SHA must match before any API call');
}
if (!run || existsSync(run)) throw new Error('A new absent run directory is required');
mkdirSync(run);
const profile = join(run, 'profile');
for (const name of ['workspace', 'appdata', 'localappdata', 'home', 'temp']) {
  mkdirSync(join(profile, name), { recursive: true });
}
const command = join(repo, '.venv', 'Scripts', 'python.exe');
const args = ['-m', 'aijian_api.sidecar'];
const allowed = new Set(['APPDATA', 'HOME', 'LANG', 'LC_ALL', 'LOCALAPPDATA', 'PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR']);
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (allowed.has(key.toUpperCase()) && value !== undefined) env[key] = value;
}
Object.assign(env, {
  APPDATA: join(profile, 'appdata'), LOCALAPPDATA: join(profile, 'localappdata'),
  HOME: join(profile, 'home'), USERPROFILE: profile,
  TEMP: join(profile, 'temp'), TMP: join(profile, 'temp'),
  AIJIAN_DATA_DIR: join(profile, 'workspace'),
  PYTHONPATH: join(repo, 'services', 'api', 'src'),
  PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1',
});
const evidence = {
  scope: 'SYNTHETIC_TEST_ONLY', spec_sha256: specHash,
  a_contract_sha256: requiredContractHash, a_store_sha256: storeHash,
  sidecar_route_sha256: routeHash,
  command, args, cwd: repo, env,
  calls: [], processes: [],
};
function save() {
  writeFileSync(join(run, 'CAPTURE.json'), JSON.stringify(evidence, null, 2) + '\n');
}
save();
async function startSidecar(label) {
  const child = spawn(command, args, { cwd: repo, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdoutPath = join(run, `${label}-stdout.raw`);
  const stderrPath = join(run, `${label}-stderr.raw`);
  const stdout = createWriteStream(stdoutPath);
  const stderr = createWriteStream(stderrPath);
  const record = { label, launcher_pid: child.pid ?? null, stdout_path: stdoutPath, stderr_path: stderrPath };
  evidence.processes.push(record);
  save();
  let buf = Buffer.alloc(0);
  let parse;
  const ready = new Promise((resolve, reject) => { parse = { resolve, reject }; });
  let settled = false;
  child.stdout.on('data', (chunk) => {
    stdout.write(chunk);
    if (settled) return;
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 65536) { settled = true; parse.reject(new Error('Oversize sidecar handshake')); return; }
    const newline = buf.indexOf(10);
    if (newline < 0) return;
    settled = true;
    try {
      const message = JSON.parse(buf.subarray(0, newline).toString('utf8'));
      if (message.event !== 'ready' || message.host !== '127.0.0.1' ||
          !Number.isInteger(message.port) || message.protocol_version !== 1 ||
          typeof message.token !== 'string' || message.token.length < 43) {
        throw new Error('Invalid sidecar handshake');
      }
      record.handshake = { event: message.event, host: message.host, port: message.port,
        pid: message.pid, protocol_version: message.protocol_version, token_length: message.token.length };
      save();
      parse.resolve(message);
    } catch (error) { parse.reject(error); }
  });
  child.stdout.on('end', () => stdout.end());
  child.stderr.on('data', (chunk) => stderr.write(chunk));
  child.stderr.on('end', () => stderr.end());
  child.on('error', (error) => { record.error = String(error); if (!settled) { settled = true; parse.reject(error); } });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => {
    record.exit = { code, signal };
    if (!settled) { settled = true; parse.reject(new Error('Sidecar exited before handshake')); }
    resolve(record.exit);
  }));
  const timer = setTimeout(() => { if (!settled) { settled = true; parse.reject(new Error('Sidecar startup timeout')); } }, 20000);
  let message;
  try {
    message = await ready;
  } catch (error) {
    child.stdin.end();
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (!record.exit) child.kill();
    await closed;
    throw error;
  } finally { clearTimeout(timer); }
  async function stop() {
    child.stdin.end();
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (!record.exit) child.kill();
    await closed;
    await Promise.all([stdout, stderr].map((stream) => stream.writableFinished
      ? Promise.resolve() : new Promise((resolve) => stream.once('finish', resolve))));
    record.stdout_sha256 = sha(readFileSync(stdoutPath));
    record.stderr_sha256 = sha(readFileSync(stderrPath));
    record.stdout_bytes = statSync(stdoutPath).size;
    record.stderr_bytes = statSync(stderrPath).size;
    save();
  }
  return { message, stop };
}
async function request(session, method, path, body, label, extraHeaders = {}) {
  const requestId = randomUUID();
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers = {
    Authorization: `Bearer ${session.token}`, Origin: 'app://aijian',
    'X-Request-ID': requestId, ...extraHeaders,
  };
  if (bytes) headers['Content-Type'] = 'application/json';
  const requestPath = join(run, `${label}-request.raw`);
  if (bytes) writeFileSync(requestPath, bytes);
  const record = { label, method, path, request_id: requestId,
    request_file: bytes ? requestPath : null, request_sha256: bytes ? sha(bytes) : null,
    idempotency_key: extraHeaders['Idempotency-Key'] ?? null,
    dispatch_started: new Date().toISOString() };
  evidence.calls.push(record);
  save();
  const url = `http://127.0.0.1:${session.port}${path}`;
  try {
    const response = await fetch(url, { method, headers, body: bytes, signal: AbortSignal.timeout(10000) });
    const payload = Buffer.from(await response.arrayBuffer());
    const responsePath = join(run, `${label}-response.raw`);
    writeFileSync(responsePath, payload);
    record.response = { status: response.status, headers: Object.fromEntries(response.headers),
      file: responsePath, bytes: payload.length, sha256: sha(payload),
      received: new Date().toISOString() };
    save();
    const json = JSON.parse(payload.toString('utf8'));
    return { status: response.status, json };
  } catch (error) {
    record.uncertain = { name: error.name, message: error.message };
    save();
    throw error;
  }
}
function assertStatus(response, status, label) {
  if (response.status !== status) throw new Error(`${label} returned ${response.status}, expected ${status}`);
}
const blockIds = [`sblk_${randomUUID().replaceAll('-', '')}`, `sblk_${randomUUID().replaceAll('-', '')}`];
const sceneId = `scn_${randomUUID().replaceAll('-', '')}`;
const idempotencyKey = `qa-mlt-test-script:${randomUUID()}`;
let identity;
try {
  const first = await startSidecar('create');
  try {
    const project = await request(first.message, 'POST', '/api/v1/projects', {
      name: 'SYNTHETIC_TEST_ONLY MLT 20260928', aspect_ratio: '9:16',
      target_duration_seconds: 30, source_language: 'zh-CN',
    }, 'project-create');
    assertStatus(project, 201, 'project create');
    const projectId = project.json.data.id;
    const episode = await request(first.message, 'POST', `/api/v1/projects/${projectId}/episodes`, {
      title: 'MLT 合成 TEST 分集', target_duration_seconds: '5',
    }, 'episode-create');
    assertStatus(episode, 201, 'episode create');
    const episodeId = episode.json.data.id;
    const content = {
      schema_version: '1.0.0', project_id: projectId, episode_id: episodeId,
      scenes: [{ scene_id: sceneId, ordinal: 1, heading: 'MLT 合成 TEST 提示音', blocks: [
        { block_id: blockIds[0], ordinal: 1, kind: 'DIALOGUE', text: 'TEST 提示音一（非语音）', speaker: 'TEST 提示音（非人声）', delivery: 'OFF_SCREEN' },
        { block_id: blockIds[1], ordinal: 2, kind: 'DIALOGUE', text: 'TEST 提示音二（非语音）', speaker: 'TEST 提示音（非人声）', delivery: 'OFF_SCREEN' },
      ] }],
    };
    const script = await request(first.message, 'POST',
      `/api/v1/projects/${projectId}/episodes/${episodeId}/script/versions`,
      { content, change_summary: 'SYNTHETIC_TEST_ONLY MLT fixture' },
      'script-create', { 'Idempotency-Key': idempotencyKey });
    assertStatus(script, 201, 'script create');
    if (script.json.data.replayed !== false) throw new Error('A new TEST script unexpectedly replayed');
    const version = script.json.data.version;
    const versionPath = `/api/v1/projects/${projectId}/episodes/${episodeId}/script/versions/${version.version_id}`;
    const current = await request(first.message, 'GET', versionPath, undefined, 'script-read');
    assertStatus(current, 200, 'script read');
    if (JSON.stringify(current.json.data) !== JSON.stringify(version)) throw new Error('Immediate exact-version read differs');
    identity = {
      state: 'CREATED_PENDING_REOPEN', scope: 'SYNTHETIC_TEST_ONLY',
      spec_sha256: specHash, project_id: projectId, episode_id: episodeId,
      script_version_id: version.version_id, script_content_hash: version.content_hash,
      version_number: version.version_number, head_revision: version.head_revision,
      scene_id: sceneId, block_ids: blockIds,
      texts: content.scenes[0].blocks.map((block) => block.text),
      speaker: 'TEST 提示音（非人声）', delivery: 'OFF_SCREEN',
      idempotency_key: idempotencyKey,
    };
    writeFileSync(join(run, 'IDENTITY.json'), JSON.stringify(identity, null, 2) + '\n');
  } finally { await first.stop(); }
  const second = await startSidecar('reopen');
  try {
    const project = await request(second.message, 'GET',
      `/api/v1/projects/${identity.project_id}`, undefined, 'project-reopen');
    assertStatus(project, 200, 'project reopen');
    if (project.json.data.id !== identity.project_id ||
        project.json.data.name !== 'SYNTHETIC_TEST_ONLY MLT 20260928') {
      throw new Error('TEST project reopen identity differs');
    }
    const episode = await request(second.message, 'GET',
      `/api/v1/projects/${identity.project_id}/episodes/${identity.episode_id}`,
      undefined, 'episode-reopen');
    assertStatus(episode, 200, 'episode reopen');
    if (episode.json.data.id !== identity.episode_id ||
        episode.json.data.project_id !== identity.project_id ||
        episode.json.data.title !== 'MLT 合成 TEST 分集' ||
        episode.json.data.target_duration_seconds !== '5' ||
        episode.json.data.is_default !== false) {
      throw new Error('Explicit TEST episode reopen identity differs');
    }
    const path = `/api/v1/projects/${identity.project_id}/episodes/${identity.episode_id}/script/versions/${identity.script_version_id}`;
    const reread = await request(second.message, 'GET', path, undefined, 'script-reopen');
    assertStatus(reread, 200, 'script reopen');
    const data = reread.json.data;
    const blocks = data.content.scenes[0].blocks;
    if (data.project_id !== identity.project_id || data.episode_id !== identity.episode_id ||
        data.version_id !== identity.script_version_id || data.content_hash !== identity.script_content_hash ||
        data.version_number !== identity.version_number || data.head_revision !== identity.head_revision ||
        data.content.project_id !== identity.project_id || data.content.episode_id !== identity.episode_id ||
        data.content.scenes[0].scene_id !== sceneId ||
        blocks.length !== 2 || blocks.some((block, index) => block.block_id !== blockIds[index] ||
          block.text !== identity.texts[index] || block.speaker !== identity.speaker ||
          block.delivery !== 'OFF_SCREEN' || block.kind !== 'DIALOGUE')) {
      throw new Error('Exact-version reopen identity/content differs');
    }
    identity.state = 'REOPEN_VERIFIED';
    writeFileSync(join(run, 'IDENTITY.json'), JSON.stringify(identity, null, 2) + '\n');
  } finally { await second.stop(); }
  console.log(JSON.stringify({ state: identity.state, project_id: identity.project_id,
    episode_id: identity.episode_id, script_version_id: identity.script_version_id,
    script_content_hash: identity.script_content_hash, block_ids: identity.block_ids }));
} catch (error) {
  evidence.failure = { name: error.name, message: error.message };
  save();
  console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
}
