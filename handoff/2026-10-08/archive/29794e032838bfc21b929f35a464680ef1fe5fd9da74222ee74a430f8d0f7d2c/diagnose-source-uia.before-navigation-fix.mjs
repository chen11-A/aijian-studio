/* global process, Buffer */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const profile = join(repo, '.aijian-dev', 'qa02-2026-09-24T01-29-20.112Z-11612');
const input = 'C:/Users/Administrator/Documents/AIVORA/production/inputs/20260924/离别30秒剧本.md';
const work = resolve(import.meta.dirname);
const uiaScript = join(work, 'diagnose-uia.ps1');
const oldRunId = 'qa02-2026-09-24T01-29-20.112Z-11612';
const projectName = `QA02 script ${oldRunId}`;
const id = `uia-diagnosis-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`;
const evidence = join(work, 'evidence', id);
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const expectedInputHash = '466f23b789b47fa1231b0891e80385a13e530b02de2f74481c4e98f5732de008';
const expectedHead = '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2';
const expectedDist = {
  'apps/desktop/dist/main.js': '343ace14a364be4e1f89248af2b85bd53b76e0ef60b8b2229af8c593c068fc7f',
  'apps/desktop/dist/preload.js': 'd899120b5e3890d7c27b7ef3e9de743a6750e9d225fb115333500de44509d591',
  'apps/studio-web/dist/index.html': 'ec604309b9599d4e3322dfe1138abc134fd9868552bfe0e522515221a17f7cee',
};

assert.ok(existsSync(profile), 'original isolated profile missing');
assert.equal(sha(readFileSync(input)), expectedInputHash, 'frozen input changed');
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
assert.equal(git.status, 0, String(git.stderr));
assert.equal(git.stdout.trim(), expectedHead, 'candidate HEAD changed');
for (const [path, hash] of Object.entries(expectedDist)) {
  assert.equal(sha(readFileSync(join(repo, path))), hash, `dist changed: ${path}`);
}
await mkdir(evidence, { recursive: false });
const result = {
  id, status: 'IN_PROGRESS', started_utc: new Date().toISOString(),
  profile, input, input_sha256: expectedInputHash, project_name: projectName,
  candidate: expectedHead, evidence, phases: [], errors: [],
  uia_script_sha256: sha(readFileSync(uiaScript)),
  diagnostic_script_sha256: sha(readFileSync(import.meta.filename)),
};
const save = async () => writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
await save();

function captureUia(name, mainPid, baselinePath) {
  const output = join(evidence, `${name}.json`);
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', uiaScript,
    '-MainPid', String(mainPid), '-EvidencePath', output];
  if (baselinePath) args.push('-BaselinePath', baselinePath);
  const call = spawnSync('powershell.exe', args, { cwd: work, windowsHide: true, timeout: 45000 });
  writeFileSync(join(evidence, `${name}.stdout.raw`), call.stdout ?? Buffer.alloc(0));
  writeFileSync(join(evidence, `${name}.stderr.raw`), call.stderr ?? Buffer.alloc(0));
  const record = { name, path: output, exit_code: call.status, signal: call.signal,
    error: call.error ? String(call.error) : null };
  result.phases.push({ phase: 'uia_capture', ...record });
  if (call.status !== 0 || call.error) throw new Error(`UIA capture failed: ${name}: ${call.error ?? call.status}`);
  return output;
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

async function openSource(page) {
  if (await page.locator('.demo-root[data-page="source"]').count()) return;
  await page.locator('.nav-item[title="故事 / 剧本"]').click();
  const sourceButton = page.getByRole('button', {
    name: /返回来源审核|前往来源输入|返回来源|来源输入/,
  }).first();
  if (await sourceButton.count()) await sourceButton.click();
  await page.locator('.demo-root[data-page="source"]').waitFor({ timeout: 15000 });
}

let app;
try {
  const electronExe = join(repo, 'apps/desktop/node_modules/electron/dist/electron.exe');
  app = await electron.launch({ executablePath: electronExe,
    args: [join(repo, 'apps/desktop'), `--user-data-dir=${profile}`], cwd: repo,
    env: { ...process.env, AIJIAN_E2E_USER_DATA_DIR: profile }, timeout: 30000 });
  const page = await app.firstWindow({ timeout: 30000 });
  const main = await app.evaluate(() => ({ pid: process.pid, execPath: process.execPath }));
  assert.ok(Number.isInteger(main.pid) && main.pid > 0);
  assert.equal(main.execPath.toLowerCase(), electronExe.toLowerCase());
  result.wrapper_pid = app.process().pid;
  result.main_pid = main.pid;
  result.main_exec_path = main.execPath;
  result.window_title = await page.title();
  assert.match(result.window_title, /AIVORA/i);
  await save();

  await ensureConnected(page);
  if (!(await page.locator('.demo-root[data-page="projects"]').count())) {
    await page.getByRole('button', { name: '打开项目中心' }).first().click();
  }
  const row = page.locator('.v2-project-row').filter({ hasText: projectName });
  assert.equal(await row.count(), 1, 'prior project identity not unique');
  await row.getByRole('button', { name: '打开项目' }).click();
  await openSource(page);
  await page.getByRole('button', { name: '刷新来源状态' }).click();
  await page.waitForTimeout(1000);
  const readback = {
    project_name: await page.getByRole('textbox', { name: '项目名称' }).inputValue(),
    source_status: (await page.locator('.v2-source-preview [role="status"]').textContent())?.trim(),
    source_excerpt_sha256: sha(Buffer.from(await page.locator('.v2-source-excerpt').textContent() ?? '', 'utf8')),
    source_excerpt_chars: [...(await page.locator('.v2-source-excerpt').textContent() ?? '')].length,
  };
  await page.screenshot({ path: join(evidence, 'readback-before-any-submit.png') });
  await writeFile(join(evidence, 'readback.json'), JSON.stringify(readback, null, 2));
  result.phases.push({ phase: 'readback', ...readback });
  await save();
  if (readback.project_name !== projectName ||
      readback.source_excerpt_sha256 !== expectedInputHash ||
      !readback.source_status?.includes('来源状态：待审核。')) {
    result.status = 'STOP_NOT_CONFIRMED_DRAFT';
  } else {
    await page.getByRole('button', { name: '开始理解故事' }).click();
    const drawer = page.getByRole('dialog');
    const reviewed = await drawer.locator('.dialog-description').textContent();
    assert.equal(sha(Buffer.from(reviewed ?? '', 'utf8')), expectedInputHash,
      'review drawer differs from frozen input');
    await page.screenshot({ path: join(evidence, 'before-renderer-submit.png') });
    const baseline = captureUia('uia-before-submit', main.pid);
    await save();
    await drawer.getByRole('button', { name: '提交真实来源审核' }).click();
    result.phases.push({ phase: 'renderer_submit_clicked_once_no_native_invoke' });
    await save();
    await page.waitForTimeout(400);
    captureUia('uia-during-native-dialog', main.pid, baseline);
    await save();
    try { await page.screenshot({ path: join(evidence, 'page-during-native-dialog.png'), timeout: 5000 }); }
    catch (error) { result.page_screenshot_error = String(error); }
    result.status = 'UIA_OBSERVED_NO_INVOKE';
  }
} catch (error) {
  result.status = 'DIAGNOSTIC_FAILED_OR_UNKNOWN';
  result.errors.push({ message: String(error), stack: error.stack });
} finally {
  if (app) {
    try { await app.close(); result.phases.push({ phase: 'normal_close' }); }
    catch (error) { result.close_error = String(error); }
  }
  result.finished_utc = new Date().toISOString();
  await save();
  process.stdout.write(`${result.status}: ${join(evidence, 'result.json')}\n`);
  if (result.status !== 'UIA_OBSERVED_NO_INVOKE' && result.status !== 'STOP_NOT_CONFIRMED_DRAFT') process.exitCode = 1;
}
