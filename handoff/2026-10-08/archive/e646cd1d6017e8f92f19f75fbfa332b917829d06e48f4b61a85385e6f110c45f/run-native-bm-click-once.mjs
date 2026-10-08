/* global process, Buffer, TextDecoder */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';

const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const owned = resolve(import.meta.dirname);
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  if (!arg.startsWith('--') || at < 3) throw new Error(`invalid option: ${arg}`);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
assert.ok(options['preflight-only'] === undefined || options['preflight-only'] === 'true',
  'invalid preflight-only option');
for (const key of ['input', 'snapshot', 'qa', 'build', 'candidate',
  'snapshot-sha256', 'qa-sha256', 'build-sha256', 'probe-sha256']) {
  if (!options[key]) throw new Error(`missing --${key}`);
}
const inputPath = resolve(options.input);
const snapshotPath = resolve(options.snapshot);
const qaPath = resolve(options.qa);
const buildPath = resolve(options.build);
const probeScript = join(owned, 'native-bm-click-once.ps1');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inputBytes = readFileSync(inputPath);
assert.ok(!inputBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'input has BOM');
const inputText = new TextDecoder('utf-8', { fatal: true }).decode(inputBytes);
assert.ok(inputText.trim() && !inputText.includes('\r'), 'input empty or not LF');
const inputHash = sha(inputBytes);
assert.equal(inputHash, '466f23b789b47fa1231b0891e80385a13e530b02de2f74481c4e98f5732de008',
  'frozen short script changed');
const snapshotBytes = readFileSync(snapshotPath);
assert.equal(sha(snapshotBytes), options['snapshot-sha256'].toLowerCase(),
  'signed product snapshot hash mismatch');
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
const qaBytes = readFileSync(qaPath);
assert.equal(sha(qaBytes), options['qa-sha256'].toLowerCase(),
  'signed QA snapshot hash mismatch');
const qa = JSON.parse(qaBytes.toString('utf8'));
const buildBytes = readFileSync(buildPath);
assert.equal(sha(buildBytes), options['build-sha256'].toLowerCase(),
  'signed build manifest hash mismatch');
const build = JSON.parse(buildBytes.toString('utf8'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
assert.equal(head, options.candidate, 'candidate HEAD mismatch');
assert.equal(snapshot.head, head, 'snapshot HEAD mismatch');
assert.equal(qa.head, head, 'QA snapshot HEAD mismatch');
assert.equal(options['probe-sha256'].toLowerCase(), sha(readFileSync(probeScript)),
  'signed native sender hash mismatch');
assert.equal(snapshot.files.length, build.product_file_count, 'product file count mismatch');
assert.equal(qa.files.length, build.qa_file_count, 'QA file count mismatch');
for (const file of snapshot.files) {
  const path = join(repo, file.path);
  assert.equal(sha(readFileSync(path)), file.sha256.toLowerCase(), `source drift: ${file.path}`);
}
for (const file of qa.files) {
  assert.equal(sha(readFileSync(join(repo, file.path))), file.sha256.toLowerCase(),
    `QA drift: ${file.path}`);
}
const frozenPaths = [...snapshot.files, ...qa.files].map((file) => file.path).sort();
const statusPaths = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'],
  { cwd: repo, encoding: 'utf8' }).trimEnd().split(/\r?\n/).map((line) => line.slice(3)).sort();
assert.deepEqual(statusPaths, frozenPaths, 'Git status paths differ from signed source and QA');
assert.equal(build.status, 'BUILT', 'build manifest is not a successful new-candidate build');
assert.equal(build.head, head, 'build HEAD mismatch');
assert.equal(build.product_snapshot_sha256.toLowerCase(), sha(snapshotBytes),
  'build source snapshot mismatch');
assert.equal(build.qa_snapshot_sha256.toLowerCase(), sha(qaBytes), 'build QA snapshot mismatch');
assert.equal(build.qa_final_manifest_sha256.toLowerCase(), qa.qaFinalManifestSha256.toLowerCase(),
  'frozen QA manifest mismatch');
assert.equal(build.web_exit, 0, 'web build did not pass');
assert.equal(build.desktop_exit, 0, 'desktop build did not pass');
assert.ok(build.dist_files.length > 0, 'build manifest has no dist files');
assert.equal(build.dist_files.length, build.web_dist_count + build.desktop_dist_count,
  'dist manifest count mismatch');
for (const file of build.dist_files) {
  const path = join(repo, file.path);
  const bytes = readFileSync(path);
  assert.equal(bytes.length, file.bytes, `dist byte count changed: ${file.path}`);
  assert.equal(sha(bytes), file.sha256.toLowerCase(), `dist drift: ${file.path}`);
}
const electronExe = join(repo, 'apps/desktop/node_modules/electron/dist/electron.exe');
assert.ok(existsSync(electronExe), 'Electron executable missing');
if (options['preflight-only'] === 'true') {
  process.stdout.write(`PREFLIGHT_OK ${JSON.stringify({
    head, product_snapshot_sha256: sha(snapshotBytes), qa_snapshot_sha256: sha(qaBytes),
    build_sha256: sha(buildBytes), sender_sha256: sha(readFileSync(probeScript)),
    input_sha256: inputHash, product_count: snapshot.files.length,
    qa_count: qa.files.length, dist_count: build.dist_files.length,
    ledger_created: false, profile_created: false, electron_launched: false,
  })}\n`);
  process.exit(0);
}
const id = `qa02-bm-click-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`;
const evidence = join(owned, 'evidence', id);
const profile = join(repo, '.aijian-dev', id);
assert.ok(!existsSync(evidence) && !existsSync(profile), 'run path already exists');
const ledgerPath = join(owned, 'evidence', `bm-click-short-submit-${sha(snapshotBytes)}.ledger.json`);
const ledger = await open(ledgerPath, 'wx');
try {
  await ledger.writeFile(JSON.stringify({
    created_utc: new Date().toISOString(), snapshot_sha256: sha(snapshotBytes),
    qa_sha256: sha(qaBytes), build_sha256: sha(buildBytes),
    input_sha256: inputHash, action: 'submit', process_pid: process.pid,
    outcome: 'UNCONSUMED_OR_UNKNOWN_UNTIL_AUTHORITATIVE_READBACK',
  }, null, 2));
} finally { await ledger.close(); }
await mkdir(evidence, { recursive: false });
await mkdir(profile, { recursive: false });
const result = {
  id, status: 'IN_PROGRESS', started_utc: new Date().toISOString(),
  head, snapshot_path: snapshotPath, snapshot_sha256: sha(snapshotBytes),
  qa_path: qaPath, qa_sha256: sha(qaBytes),
  source_fingerprint: snapshot.pathAndContentFingerprintSha256,
  build_path: buildPath, build_sha256: sha(buildBytes), dist_file_count: build.dist_files.length,
  input_path: inputPath, input_sha256: inputHash, input_chars: [...inputText].length,
  probe_script_sha256: sha(readFileSync(probeScript)),
  runner_sha256: sha(readFileSync(import.meta.filename)),
  evidence, profile, cases: [], errors: [],
  ledger_path: ledgerPath,
};
const save = async () => writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
await save();

function startProbe(mainPid, output, identity) {
  const probeArgs = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', probeScript,
    '-MainPid', String(mainPid), '-ExpectedTitle', '送审来源版本',
    '-ExpectedButtonName', '确认送审来源版本', '-ExpectedAction', 'submit',
    '-ProjectId', identity.project_id, '-VersionId', identity.version_id,
    '-ContentHash', identity.content_hash, '-ExpectedRevision', String(identity.expected_revision),
    '-EvidencePath', output];
  const child = spawn('powershell.exe', probeArgs, { cwd: owned, windowsHide: true });
  const stdoutParts = []; const stderrParts = [];
  child.stdout.on('data', (part) => stdoutParts.push(part));
  child.stderr.on('data', (part) => stderrParts.push(part));
  return new Promise((complete) => {
    let spawnError = null;
    child.once('error', (error) => { spawnError = String(error); });
    child.once('close', async (code, signal) => {
      try {
        await Promise.all([
          writeFile(`${output}.stdout.raw`, Buffer.concat(stdoutParts)),
          writeFile(`${output}.stderr.raw`, Buffer.concat(stderrParts)),
        ]);
        complete({ code, signal, spawn_error: spawnError, path: output });
      } catch (error) {
        complete({ code, signal, spawn_error: spawnError, output_error: String(error), path: output });
      }
    });
  });
}

async function ensureConnected(page) {
  if (!(await page.getByRole('button', { name: '连接本地工作区' }).count()) &&
      !(await page.getByRole('button', { name: '本地工作区已连接' }).count())) {
    await page.getByRole('button', { name: '打开项目中心' }).first().click();
  }
  const connect = page.getByRole('button', { name: '连接本地工作区' }).first();
  if (await connect.count()) await connect.click();
  await page.getByRole('button', { name: '本地工作区已连接' }).first().waitFor({ timeout: 30000 });
}

async function createProject(page, name) {
  await page.getByRole('button', { name: '新建项目' }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建项目' });
  assert.equal(await dialog.count(), 1, 'new-project dialog count');
  const nameField = dialog.getByRole('textbox', { name: '作品名称' });
  assert.equal(await nameField.count(), 1, 'project-name field count');
  await nameField.fill(name);
  const submit = dialog.locator('button[type="submit"]');
  assert.equal(await submit.count(), 1, 'new-project submit count');
  assert.equal((await submit.textContent() ?? '').trim(), '保存演示修改', 'new-project submit label');
  assert.equal(await submit.isEnabled(), true, 'new-project submit disabled');
  await page.screenshot({ path: join(evidence, 'create-project-before-submit.png') });
  await submit.click();
  await page.locator('.demo-root[data-page="source"]').waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole('textbox', { name: '项目名称' }).inputValue(), name);
}

let app;
try {
  app = await electron.launch({
    executablePath: electronExe,
    args: [join(repo, 'apps/desktop'), `--user-data-dir=${profile}`],
    cwd: repo, env: { ...process.env, AIJIAN_E2E_USER_DATA_DIR: profile }, timeout: 30000,
  });
  const page = await app.firstWindow({ timeout: 30000 });
  const main = await app.evaluate(() => ({ pid: process.pid, execPath: process.execPath }));
  assert.ok(Number.isInteger(main.pid) && main.pid > 0, 'invalid main PID');
  assert.equal(basename(main.execPath).toLowerCase(), 'electron.exe', 'unexpected main executable');
  assert.ok(existsSync(main.execPath), 'main executable missing');
  result.main_pid = main.pid;
  result.wrapper_pid = app.process().pid;
  result.main_executable = main.execPath;
  result.window_title = await page.title();
  assert.match(result.window_title, /AIVORA/i, 'unexpected Electron window');
  await save();

  await ensureConnected(page);
  const projectName = `QA02 capability ${id}`;
  await createProject(page, projectName);
  result.project_name = projectName;
  result.cases.push({ phase: 'project_created', project_name: projectName });
  await save();
  await page.getByRole('button', { name: '粘贴故事' }).click();
  await page.getByRole('textbox', { name: '外部原文正文' }).fill(inputText);
  await page.getByRole('button', { name: '作为外部原文导入' }).click();
  await page.getByText(/来源已保存并读回确认/).waitFor({ timeout: 60000 });
  const imported = await page.locator('.v2-source-excerpt').textContent();
  assert.equal(imported, inputText, 'full short script preview differs');
  result.cases.push({ phase: 'import_readback', preview_sha256: sha(Buffer.from(imported, 'utf8')) });
  await page.screenshot({ path: join(evidence, 'short-script-imported.png') });
  await save();
  const authoritative = await page.evaluate(async (expectedName) => {
    const bridge = window.aijian;
    if (!bridge) throw new Error('Electron preload bridge missing');
    const listed = await bridge.listProjects();
    const matches = listed.data.filter((project) => project.name === expectedName);
    if (matches.length !== 1) throw new Error(`Project list identity count=${matches.length}`);
    const project = await bridge.getProject(matches[0].id);
    const manifest = await bridge.getSourceManifest(matches[0].id);
    const documents = manifest?.data?.latest_version?.content?.documents;
    if (!Array.isArray(documents) || documents.length !== 1) {
      throw new Error('Expected one manifest source document');
    }
    const sourceText = await bridge.getSourceText(matches[0].id, documents[0].source_document_id);
    return { listed_request_id: listed.request_id, project, manifest, sourceText };
  }, projectName);
  await writeFile(join(evidence, 'authoritative-source-readback.json'),
    JSON.stringify(authoritative, null, 2));
  const project = authoritative.project?.data;
  const manifest = authoritative.manifest?.data;
  assert.ok(project && manifest, 'same-project authoritative readback missing');
  assert.equal(project.name, projectName, 'project name differs on bridge GET');
  assert.match(project.id, /^prj_[0-9a-f]{32}$/, 'project ID invalid');
  assert.equal(manifest.project_id, project.id, 'manifest belongs to another project');
  assert.equal(manifest.head.latest_version_id, manifest.latest_version.id, 'manifest latest version mismatch');
  assert.equal(manifest.head.artifact_id, manifest.latest_version.artifact_id, 'manifest artifact mismatch');
  assert.ok(Number.isSafeInteger(manifest.head.revision) && manifest.head.revision >= 1,
    'manifest head revision invalid');
  assert.equal(manifest.head.review_version_id ?? null, null, 'new source is already under review');
  assert.equal(manifest.head.accepted_version_id ?? null, null, 'new source is already accepted');
  const sourceDocument = manifest.latest_version.content.documents[0];
  assert.equal(sourceDocument.raw_sha256, inputHash, 'manifest document differs from frozen input');
  assert.equal(sourceDocument.byte_size, inputBytes.length, 'manifest document byte size differs');
  assert.equal(authoritative.sourceText.data.project_id, project.id, 'source text belongs to another project');
  assert.equal(authoritative.sourceText.data.id, sourceDocument.source_document_id,
    'source text ID differs from manifest');
  assert.equal(authoritative.sourceText.data.raw_sha256, inputHash, 'source text raw hash differs');
  assert.equal(authoritative.sourceText.data.normalized_text, inputText, 'source text full readback differs');
  assert.equal(authoritative.sourceText.data.normalized_sha256,
    sha(Buffer.from(authoritative.sourceText.data.normalized_text, 'utf8')),
    'source text normalized hash differs');
  const identity = {
    project_id: project.id,
    version_id: manifest.latest_version.id,
    content_hash: manifest.latest_version.content_hash,
    expected_revision: manifest.head.revision,
  };
  assert.match(identity.version_id, /^ver_[0-9a-f]{32}$/, 'version ID invalid');
  assert.match(identity.content_hash, /^sha256:[0-9a-f]{64}$/, 'source content hash invalid');
  result.authoritative_identity = identity;
  result.cases.push({ phase: 'same_project_bridge_get', identity,
    project_request_id: authoritative.project.request_id,
    manifest_request_id: authoritative.manifest.request_id,
    source_text_request_id: authoritative.sourceText.request_id,
    source_text_full_sha256: sha(Buffer.from(authoritative.sourceText.data.normalized_text, 'utf8')) });
  await save();
  await page.getByRole('button', { name: '开始理解故事' }).click();
  const drawer = page.getByRole('dialog');
  const reviewed = await drawer.locator('.dialog-description').textContent();
  assert.equal(reviewed, inputText, 'review drawer differs from frozen short script');
  await page.screenshot({ path: join(evidence, 'before-renderer-submit.png') });
  const probeOutput = join(evidence, 'native-bm-click.json');
  const probePromise = startProbe(main.pid, probeOutput, identity);
  let rendererClickError = null;
  try {
    await drawer.getByRole('button', { name: '提交真实来源审核' }).click();
    result.cases.push({ phase: 'renderer_submit_clicked_once' });
    await save();
  } catch (error) {
    rendererClickError = error;
  }
  const probe = await probePromise;
  result.probe = probe;
  await save();
  const postReadbacks = [];
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const value = await page.evaluate(async ({ projectId, sourceId }) => {
        const bridge = window.aijian;
        if (!bridge) throw new Error('Electron preload bridge missing after native send');
        const project = await bridge.getProject(projectId);
        const manifest = await bridge.getSourceManifest(projectId);
        const sourceText = await bridge.getSourceText(projectId, sourceId);
        return { project, manifest, sourceText };
      }, { projectId: identity.project_id, sourceId: sourceDocument.source_document_id });
      postReadbacks.push({ attempt, utc: new Date().toISOString(), value });
      await writeFile(join(evidence, 'post-send-authoritative-readbacks.json'),
        JSON.stringify(postReadbacks, null, 2));
      if (value.manifest?.data?.head?.review_version_id === identity.version_id) break;
    } catch (error) {
      postReadbacks.push({ attempt, utc: new Date().toISOString(), error: String(error) });
      await writeFile(join(evidence, 'post-send-authoritative-readbacks.json'),
        JSON.stringify(postReadbacks, null, 2));
    }
    if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  result.post_readback_count = postReadbacks.length;
  try {
    await page.screenshot({ path: join(evidence, 'after-native-send-renderer.png') });
  } catch (error) {
    result.post_send_screenshot_error = String(error);
  }
  await save();
  if (rendererClickError) throw rendererClickError;
  if (probe.spawn_error || probe.output_error || probe.code !== 0) {
    throw new Error(`native send failed or is unknown: ${JSON.stringify(probe)}`);
  }
  const receipt = JSON.parse(await readFile(probeOutput, 'utf8'));
  assert.equal(receipt.read_only, false, 'sender mode mismatch');
  assert.equal(receipt.native_action_attempted, true, 'native send attempt was not recorded');
  assert.equal(receipt.status, 'SEND_RETURNED_BUSINESS_UNVERIFIED',
    'native message outcome is unknown');
  assert.equal(receipt.send.attempt_index, 1, 'native send attempt count mismatch');
  assert.notEqual(receipt.send.api_return, 0, 'SendMessageTimeout did not return success');
  assert.equal(receipt.main_pid, main.pid, 'probe PID mismatch');
  assert.equal(receipt.expected_project_id, identity.project_id, 'probe expected project mismatch');
  assert.equal(receipt.expected_version_id, identity.version_id, 'probe expected version mismatch');
  assert.equal(receipt.expected_content_hash, identity.content_hash, 'probe expected hash mismatch');
  assert.equal(receipt.identity.project_id, identity.project_id, 'native project differs from bridge GET');
  assert.equal(receipt.identity.version_id, identity.version_id, 'native version differs from bridge GET');
  assert.equal(receipt.identity.content_hash, identity.content_hash, 'native hash differs from bridge GET');
  assert.equal(receipt.identity.action, 'submit', 'probe action mismatch');
  assert.equal(receipt.identity.revision, identity.expected_revision,
    'native revision differs from bridge GET');
  const post = postReadbacks.at(-1)?.value;
  assert.ok(post, 'post-send authoritative bridge GET missing');
  assert.equal(post.project?.data?.id, identity.project_id, 'post-send project differs');
  assert.equal(post.project?.data?.name, projectName, 'post-send project name differs');
  assert.equal(post.manifest?.data?.project_id, identity.project_id,
    'post-send manifest belongs to another project');
  assert.equal(post.manifest.data.latest_version.id, identity.version_id,
    'post-send latest source version differs');
  assert.equal(post.manifest.data.latest_version.content_hash, identity.content_hash,
    'post-send source hash differs');
  assert.equal(post.manifest.data.head.review_version_id, identity.version_id,
    'service did not confirm review version');
  assert.match(post.manifest.data.head.review_submission_id, /^sub_[0-9a-f]{32}$/,
    'service review submission ID missing');
  assert.equal(post.manifest.data.review_version?.id, identity.version_id,
    'service review version differs');
  assert.equal(post.sourceText?.data?.normalized_text, inputText,
    'post-send full source text differs');
  assert.equal(post.sourceText.data.raw_sha256, inputHash,
    'post-send raw source hash differs');
  result.native_send = {
    project_id: receipt.identity.project_id,
    version_id: receipt.identity.version_id,
    content_hash: receipt.identity.content_hash,
    receipt: probeOutput,
    api_return: receipt.send.api_return,
    message_result: receipt.send.message_result,
    last_error: receipt.send.last_error,
    review_submission_id: post.manifest.data.head.review_submission_id,
  };
  result.status = 'SOURCE_SUBMISSION_CONFIRMED';
} catch (error) {
  result.status = 'STOP_OR_UNKNOWN';
  result.errors.push({ message: String(error), stack: error.stack });
} finally {
  if (app) {
    try { await app.close(); result.normal_close = true; }
    catch (error) { result.close_error = String(error); }
  }
  result.finished_utc = new Date().toISOString();
  await save();
  process.stdout.write(`${result.status}: ${join(evidence, 'result.json')}\n`);
  if (result.status !== 'SOURCE_SUBMISSION_CONFIRMED') process.exitCode = 1;
}
