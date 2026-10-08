/* global process, Buffer */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';

const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const owned = resolve(import.meta.dirname);
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  if (at < 3 || !arg.startsWith('--')) throw new Error(`invalid option: ${arg}`);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
for (const key of ['script', 'novel', 'candidate']) {
  if (!options[key]) throw new Error(`missing --${key}=...`);
}
const scriptPath = resolve(options.script);
const novelPath = resolve(options.novel);
if (!existsSync(scriptPath) || !existsSync(novelPath)) throw new Error('frozen input path missing');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
assert.equal(head, options.candidate, 'candidate HEAD differs from approved SHA');
const status = git('status', '--porcelain=v1', '--untracked-files=normal');
const changed = git('diff', '--name-only', 'HEAD').split(/\r?\n/).filter(Boolean);
const productChanged = changed.filter((path) =>
  /^(apps\/(studio-web|desktop)\/src|services\/api\/src)\//.test(path) &&
  !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path));
const productDiff = Buffer.concat(productChanged.map((path) =>
  execFileSync('git', ['diff', '--binary', 'HEAD', '--', path], { cwd: repo })));
const built = ['apps/desktop/dist/main.js', 'apps/desktop/dist/preload.js', 'apps/studio-web/dist/index.html'];
const product = ['apps/studio-web/src/aivora/model.tsx', 'apps/desktop/src/source-manifest-review.ts', 'apps/desktop/src/source-manifest-review-ipc.ts'];
const hashes = Object.fromEntries([...built, ...product].map((path) => {
  const file = join(repo, path);
  if (!existsSync(file)) throw new Error(`required file missing: ${path}`);
  return [path, sha(readFileSync(file))];
}));
const electronExe = join(repo, 'apps/desktop/node_modules/electron/dist/electron.exe');
if (!existsSync(electronExe)) throw new Error('Electron binary missing');
const id = `qa02-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`;
const evidence = join(owned, 'evidence', id);
const profile = join(repo, '.aijian-dev', id);
if (existsSync(profile)) throw new Error('profile path already exists');
await mkdir(evidence, { recursive: true });
await mkdir(profile, { recursive: false });
const result = {
  id, status: 'IN_PROGRESS', started_utc: new Date().toISOString(),
  head, status_before: status, changed_paths: changed, product_changed_paths: productChanged,
  product_diff_sha256: sha(productDiff), hashes,
  runner_sha256: sha(readFileSync(import.meta.filename)),
  native_helper_sha256: sha(readFileSync(join(owned, 'native-dialog.ps1'))),
  profile, evidence, cases: [], errors: [],
};
const save = async () => writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
await save();

function nativeConfirm(pid, title, action, identity, output) {
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(owned, 'native-dialog.ps1'),
    '-ElectronPid', String(pid), '-ExpectedTitle', title, '-ExpectedAction', action,
    '-EvidencePath', output];
  if (identity) args.push('-ProjectId', identity.project_id, '-VersionId', identity.version_id, '-ContentHash', identity.content_hash);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('powershell.exe', args, { cwd: owned, windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (part) => { stdout += part; });
    child.stderr.on('data', (part) => { stderr += part; });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code !== 0) return rejectPromise(new Error(`native dialog helper exit ${code}: ${stderr || stdout}`));
      try { resolvePromise(JSON.parse(stdout.trim())); } catch (error) { rejectPromise(error); }
    });
  });
}

async function openSource(page) {
  if (await page.locator('.demo-root[data-page="source"]').count()) return;
  await page.locator('.nav-item[title="故事 / 剧本"]').click();
  const sourceButton = page.getByRole('button', { name: /返回来源审核|前往来源输入|返回来源|来源输入/ }).first();
  if (await sourceButton.count()) await sourceButton.click();
  if (!(await page.locator('.demo-root[data-page="source"]').count())) {
    await page.getByRole('button', { name: 'AIVORA 启动页' }).click();
    await page.getByRole('button', { name: '进入 UI 演示' }).click();
    await page.locator('.v2-welcome-copy').click();
    const entry = page.getByRole('dialog');
    await entry.getByRole('combobox', { name: '下一步' }).selectOption('从灵感模板开始');
    await entry.getByRole('button', { name: '确认' }).click();
  }
  await page.locator('.demo-root[data-page="source"]').waitFor({ timeout: 15000 });
}

async function launch() {
  let app;
  try {
    app = await electron.launch({ executablePath: electronExe,
      args: [join(repo, 'apps/desktop'), `--user-data-dir=${profile}`], cwd: repo,
      env: { ...process.env, AIJIAN_E2E_USER_DATA_DIR: profile }, timeout: 30000 });
    const page = await app.firstWindow({ timeout: 30000 });
    const wrapperPid = app.process().pid;
    const main = await app.evaluate(() => ({ pid: process.pid, execPath: process.execPath }));
    assert.ok(Number.isInteger(main.pid) && main.pid > 0, 'invalid Electron main PID');
    assert.equal(basename(main.execPath).toLowerCase(), 'electron.exe', 'unexpected main executable');
    assert.ok(existsSync(main.execPath), 'Electron main executable missing');
    process.kill(main.pid, 0);
    const title = await page.title();
    assert.match(title, /AIVORA/i, 'unexpected Electron window');
    return { app, page, pid: main.pid, wrapperPid, execPath: main.execPath, title };
  } catch (error) {
    if (app) {
      try { await app.close(); } catch { /* Preserve the launch error. */ }
    }
    throw error;
  }
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

async function createProject(page, name, label) {
  await page.getByRole('button', { name: '新建项目' }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建项目' });
  const diagnostic = { dialog_count: await dialog.count(), expected_title: '新建项目' };
  let submit;
  if (diagnostic.dialog_count === 1) {
    const nameField = dialog.getByRole('textbox', { name: '作品名称' });
    diagnostic.name_field_count = await nameField.count();
    if (diagnostic.name_field_count === 1) await nameField.fill(name);
    submit = dialog.locator('button[type="submit"]');
    diagnostic.submit_count = await submit.count();
    diagnostic.submit_text = diagnostic.submit_count === 1
      ? (await submit.textContent() ?? '').replace(/\s+/g, ' ').trim() : null;
    diagnostic.submit_enabled = diagnostic.submit_count === 1 ? await submit.isEnabled() : null;
    diagnostic.button_texts = await dialog.locator('button').allTextContents();
  }
  diagnostic.screenshot = `${label}-create-project-before-submit.png`;
  await page.screenshot({ path: join(evidence, diagnostic.screenshot) });
  await writeFile(join(evidence, `${label}-create-project-diagnostic.json`),
    JSON.stringify(diagnostic, null, 2));
  assert.equal(diagnostic.dialog_count, 1, 'expected one New Project dialog');
  assert.equal(diagnostic.name_field_count, 1, 'expected one project name field');
  assert.equal(diagnostic.submit_count, 1, 'expected one project submit button');
  assert.equal(diagnostic.submit_text, '保存演示修改', 'unexpected project submit label');
  assert.equal(diagnostic.submit_enabled, true, 'project submit button is disabled');
  await submit.click();
  await page.locator('.demo-root[data-page="source"]').waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole('textbox', { name: '项目名称' }).inputValue(), name);
}

async function runCase(label, inputPath) {
  const text = await readFile(inputPath, 'utf8');
  if (!text.trim()) throw new Error(`${label}: empty input`);
  if (label === 'novel' && [...text].length < 20000) throw new Error('novel is shorter than 20000 characters');
  const caseResult = { label, input_path: inputPath, input_chars: [...text].length,
    input_sha256: sha(Buffer.from(text, 'utf8')), phases: [] };
  result.cases.push(caseResult); await save();
  const name = `QA02 ${label} ${id}`;
  let session;
  try {
    session = await launch();
    caseResult.pid_first = session.pid; caseResult.window_title = session.title; await save();
    caseResult.wrapper_pid_first = session.wrapperPid;
    caseResult.electron_exec_path_first = session.execPath; await save();
    await ensureConnected(session.page);
    await createProject(session.page, name, label);
    await session.page.screenshot({ path: join(evidence, `${label}-created.png`) });
    await session.page.getByRole('button', { name: '粘贴故事' }).click();
    await session.page.getByRole('textbox', { name: '外部原文正文' }).fill(text);
    await session.page.getByRole('button', { name: '作为外部原文导入' }).click();
    await session.page.getByText(/来源已保存并读回确认/).waitFor({ timeout: 60000 });
    const imported = await session.page.locator('.v2-source-excerpt').textContent();
    assert.equal(imported, text, `${label}: source preview differs after import`);
    caseResult.phases.push({ phase: 'import', preview_sha256: sha(Buffer.from(imported, 'utf8')) });
    await session.page.screenshot({ path: join(evidence, `${label}-imported.png`) }); await save();

    await session.page.getByRole('button', { name: '开始理解故事' }).click();
    const drawer = session.page.getByRole('dialog');
    const reviewText = await drawer.locator('.dialog-description').textContent();
    assert.equal(reviewText, text, `${label}: review drawer differs from frozen input`);
    const submitNative = nativeConfirm(session.pid, '送审来源版本', 'submit', null, join(evidence, `${label}-native-submit.json`));
    await drawer.getByRole('button', { name: '提交真实来源审核' }).click();
    const identity = await submitNative;
    caseResult.identity = { project_id: identity.project_id, version_id: identity.version_id, content_hash: identity.content_hash };
    caseResult.phases.push({ phase: 'submitted', native: `${label}-native-submit.json` }); await save();
    await openSource(session.page);
    await session.page.getByRole('button', { name: '刷新来源状态' }).click();
    await session.page.getByText(/来源状态：审核中/).waitFor({ timeout: 30000 });
    await session.page.screenshot({ path: join(evidence, `${label}-review.png`) });

    await session.page.getByRole('button', { name: '确认来源审核基线' }).click();
    const confirmation = session.page.getByRole('dialog');
    const captured = await confirmation.locator('.dialog-description').textContent();
    for (const value of Object.values(caseResult.identity)) assert.ok(captured.includes(value), `${label}: captured identity mismatch`);
    await confirmation.getByRole('textbox', { name: /确认理由/ }).fill('QA02 原创材料独立核验，确认当前完整来源基线。');
    const signoffNative = nativeConfirm(session.pid, '签署来源基线', 'signoff', caseResult.identity, join(evidence, `${label}-native-signoff.json`));
    await confirmation.getByRole('button', { name: '确认来源审核基线' }).click();
    await signoffNative;
    await nativeConfirm(session.pid, '批准来源基线', 'decision', caseResult.identity, join(evidence, `${label}-native-decision.json`));
    await session.page.getByText(/来源状态：已批准/).waitFor({ timeout: 30000 });
    caseResult.phases.push({ phase: 'approved', status: '来源状态：已批准' });
    await session.page.screenshot({ path: join(evidence, `${label}-approved.png`) }); await save();

    await session.app.close(); session = null;
    caseResult.phases.push({ phase: 'normal_close_1' }); await save();
    session = await launch();
    caseResult.pid_reopen = session.pid;
    caseResult.wrapper_pid_reopen = session.wrapperPid;
    caseResult.electron_exec_path_reopen = session.execPath; await save();
    await ensureConnected(session.page);
    await session.page.getByRole('button', { name: '打开项目中心' }).first().click();
    const row = session.page.locator('.v2-project-row').filter({ hasText: name });
    await row.getByRole('button', { name: '打开项目' }).click();
    await openSource(session.page);
    await session.page.getByRole('button', { name: '刷新来源状态' }).click();
    await session.page.getByText(/来源状态：已批准/).waitFor({ timeout: 30000 });
    assert.equal(await session.page.getByRole('textbox', { name: '项目名称' }).inputValue(), name);
    const reopened = await session.page.locator('.v2-source-excerpt').textContent();
    assert.equal(reopened, text, `${label}: full text differs after reopen`);
    caseResult.reopened_text_sha256 = sha(Buffer.from(reopened, 'utf8'));
    caseResult.phases.push({ phase: 'reopened_readback', status: '来源状态：已批准', full_text_equal: true });
    await session.page.screenshot({ path: join(evidence, `${label}-reopened.png`) });
    await session.app.close(); session = null;
    caseResult.phases.push({ phase: 'normal_close_2' }); await save();
  } finally {
    if (session) {
      try { await session.app.close(); caseResult.phases.push({ phase: 'normal_close_after_error' }); }
      catch (error) { caseResult.close_error = String(error); }
      await save();
    }
  }
}

try {
  await runCase('script', scriptPath);
  await runCase('novel', novelPath);
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL_OR_UNKNOWN';
  result.errors.push({ message: String(error), stack: error.stack });
} finally {
  result.finished_utc = new Date().toISOString();
  result.status_after = git('status', '--porcelain=v1', '--untracked-files=normal');
  await save();
  process.stdout.write(`${result.status}: ${join(evidence, 'result.json')}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}
