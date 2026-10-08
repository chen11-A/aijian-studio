/* Source-preview native layout QA draft. Synthetic local source only. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

throw new Error('DRAFT_NOT_RUNNABLE: visual actions are not yet implemented');

const PRODUCT_ROOT = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const helper = join(import.meta.dirname, 'native-project-os-readonly.ps1');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  if (!arg.startsWith('--') || at < 3) throw new Error(`Invalid option: ${arg}`);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
for (const key of ['plan', 'plan-sha256', 'approval', 'approval-sha256']) {
  assert.ok(args[key], `Missing --${key}`);
}
assert.equal(process.platform, 'win32', 'Windows-only native QA');

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const hashFile = (path) => sha(readFileSync(path));
const matchHash = (actual, expected, label) => {
  assert.match(expected ?? '', /^[0-9a-f]{64}$/i, `${label}: expected SHA invalid`);
  assert.equal(actual, expected.toUpperCase(), `${label}: SHA changed`);
};
const planPath = resolve(args.plan);
const approvalPath = resolve(args.approval);
matchHash(hashFile(planPath), args['plan-sha256'], 'plan');
matchHash(hashFile(approvalPath), args['approval-sha256'], 'approval');
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
assert.equal(plan.kind, 'QA02_SOURCE_PREVIEW_NATIVE_VISUAL_PLAN');
assert.equal(plan.scope, 'SYNTHETIC_LOCAL_SOURCE_LAYOUT_ONLY');
assert.equal(plan.maxLaunches, 2);
assert.equal(approval.kind, 'MGR02_QA02_SOURCE_PREVIEW_VISUAL_APPROVAL');
assert.equal(approval.runId, plan.runId);
assert.equal(approval.planSha256.toUpperCase(), args['plan-sha256'].toUpperCase());
assert.equal(approval.maxLaunches, 2);
matchHash(hashFile(import.meta.filename), approval.runnerSha256, 'runner');
matchHash(hashFile(helper), approval.helperSha256, 'OS helper');
assert.match(plan.runId, /^qa02-source-preview-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{4,16}$/);

const root = resolve(plan.root);
assert.equal(root.toLowerCase(), resolve(PRODUCT_ROOT).toLowerCase());
const profile = resolve(plan.profile);
const profileRoot = join(root, '.aijian-dev');
const profileRelationship = relative(profileRoot, profile);
assert.ok(profileRelationship && !profileRelationship.startsWith('..') &&
  !isAbsolute(profileRelationship), 'Profile must be a strict .aijian-dev child');
assert.equal(basename(profile), plan.runId, 'Profile must bind to run ID');
const evidence = resolve(plan.evidenceDir);
assert.ok(!evidence.toLowerCase().startsWith(root.toLowerCase() + '\\'),
  'Evidence output must remain outside c19');
assert.ok(!existsSync(profile), 'New isolated profile already exists');
assert.ok(!existsSync(evidence), 'New evidence directory already exists');
assert.equal(plan.head, '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2');
assert.equal(plan.cssPath, 'apps/studio-web/src/aivora/v2-story.css');
assert.equal(plan.cssTargetSha256,
  'FCCB6ACC0476641B0BFBE0D47028D008CF2C0FBCA35956F2B053C5D49EA16523');
assert.match(plan.webHtmlSha256, /^[0-9a-f]{64}$/i);
assert.notEqual(plan.webHtmlSha256,
  '97B5FA2976B03160D64E63F4AE7484C604286C6BDD35CF19799E95B1DFC7999F');
assert.deepEqual(plan.sizes, [
  { width: 1424, height: 881, label: 'reported' },
  { width: 1424, height: 720, label: 'lower' },
  { width: 1024, height: 881, label: 'narrow' },
]);
assert.match(plan.projectName, /^QA02 来源预览布局 qa02-source-preview-/);
assert.ok(plan.sourceText.includes('虚构测试城') && plan.sourceText.length > 3000);
assert.ok(plan.prohibitedActions.includes('providerCall'));
assert.ok(Array.isArray(plan.files) && plan.files.length >= 5);

const required = new Set([
  'apps/desktop/src/main.ts',
  'apps/desktop/src/e2e-user-data.ts',
  'apps/studio-web/src/aivora/v2-story.css',
  'apps/studio-web/src/aivora/DemoApp.tsx',
  'apps/studio-web/src/aivora/Common.tsx',
  'apps/studio-web/src/aivora/StoryPages.tsx',
  'apps/studio-web/src/aivora/HomePages.tsx',
  'apps/studio-web/src/aivora/model.tsx',
  'services/api/src/aijian_api/sidecar.py',
  'apps/desktop/dist/main.js',
  'apps/desktop/dist/preload.js',
  'apps/studio-web/dist/index.html',
]);
for (const item of plan.files) required.delete(item.path);
assert.equal(required.size, 0, `Frozen build input missing: ${[...required].join(', ')}`);
const planPaths = new Set(plan.files.map((item) => item.path));
const listFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap(
  (entry) => entry.isDirectory() ? listFiles(join(directory, entry.name))
    : [join(directory, entry.name)]);
for (const distRelative of ['apps/desktop/dist', 'apps/studio-web/dist']) {
  for (const absolute of listFiles(join(root, distRelative))) {
    const path = relative(root, absolute).replaceAll('\\', '/');
    assert.ok(planPaths.has(path), `Dist file not bound by frozen plan: ${path}`);
  }
}
const productHashes = () => plan.files.map((item) => {
  const absolute = resolve(root, item.path);
  const relationship = relative(root, absolute);
  assert.ok(relationship && !relationship.startsWith('..') && !isAbsolute(relationship),
    `Outside c19: ${item.path}`);
  const bytes = readFileSync(absolute);
  const actual = sha(bytes);
  assert.equal(bytes.length, item.bytes, `Byte count changed: ${item.path}`);
  matchHash(actual, item.sha256, item.path);
  return { path: item.path, sha256: actual, bytes: bytes.length };
});
const head = () => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' }).trim();
const gitStatus = () => execFileSync('git',
  ['-C', root, 'status', '--short', '--untracked-files=all'],
  { encoding: 'utf8' });
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const osState = (launcherPid = 0, checkLocks = false, hwnd = '0') => JSON.parse(execFileSync(powershell,
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-RootPath', root, '-ProfilePath', profile,
    '-TargetLauncherPid', String(launcherPid), '-TargetHwnd', String(hwnd),
    ...(checkLocks ? ['-CheckLocks'] : [])],
  { encoding: 'utf8', timeout: 15000 }).trim());
const requireCleanExit = async (launcherPid) => {
  let sample;
  for (let i = 0; i < 20; i++) {
    sample = osState(launcherPid, true);
    if (sample.relatedProcesses.length === 0 &&
        sample.lockFiles.every((item) => item.exclusiveRead === true))
      return sample;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Normal close left process or lock: ${JSON.stringify(sample)}`);
};
const readMain = (electronApp) => electronApp.evaluate(({ BrowserWindow }) => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length !== 1) throw new Error(`BrowserWindow count=${windows.length}`);
  const window = windows[0];
  const handle = window.getNativeWindowHandle();
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE(0).toString()
    : String(handle.readUInt32LE(0));
  return { pid: process.pid, hwnd, webContentsId: window.webContents.id,
    title: window.getTitle(), visible: window.isVisible(), focused: window.isFocused(),
    loading: window.webContents.isLoadingMainFrame() };
});

assert.equal(head(), plan.head, 'Git HEAD changed before launch');
const beforeHashes = productHashes();
assert.equal(beforeHashes.find((item) =>
  item.path === 'apps/studio-web/dist/index.html')?.sha256,
plan.webHtmlSha256, 'Final Web dist SHA changed');
assert.equal(beforeHashes.find((item) =>
  item.path === plan.cssPath)?.sha256,
plan.cssTargetSha256, 'DEV04 CSS source SHA changed');
const beforeStatus = gitStatus();
assert.equal(beforeStatus, plan.gitStatus, 'Worktree differs from approved visual build');
for (const line of beforeStatus.trimEnd().split(/\r?\n/)) {
  if (!line) continue;
  assert.ok(planPaths.has(line.slice(3).replaceAll('\\', '/')),
    `Dirty source not bound by frozen plan: ${line}`);
}
const preOs = osState();
assert.equal(preOs.relatedProcesses.length, 0, 'c19 process already running');
const require = createRequire(join(root, 'package.json'));
const { _electron: electron } = require('playwright-core');
const electronExe = join(root, 'apps', 'desktop', 'node_modules', 'electron',
  'dist', 'electron.exe');
assert.ok(existsSync(electronExe), 'Electron executable missing');
const electronImage = realpathSync.native(electronExe).toLowerCase();
const pythonExe = join(root, '.venv', 'Scripts', 'python.exe');
assert.ok(existsSync(pythonExe), 'Sidecar Python missing');

await mkdir(evidence, { recursive: false });
const eventsPath = join(evidence, 'events.jsonl');
const record = async (kind, data) => appendFile(eventsPath,
  `${JSON.stringify({ utc: new Date().toISOString(), kind, ...data })}\n`, 'utf8');
const result = { runId: plan.runId, status: 'RUNNING', preflight: {
  planSha256: hashFile(planPath), approvalSha256: hashFile(approvalPath),
  runnerSha256: hashFile(import.meta.filename), helperSha256: hashFile(helper),
  head: plan.head, files: beforeHashes, gitStatus: beforeStatus,
  os: preOs, profile, evidence }, launches: [], prohibitedRendererRequests: [] };
const save = () => writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
await record('preflight', { head: plan.head, fileCount: beforeHashes.length });
await mkdir(profile, { recursive: false });
await save();
const sanitize = (value) => String(value);
const env = { ...process.env, AIJIAN_E2E_USER_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AIJIAN_E2E_PROPOSAL_RUN_RESPONSE_FAULT;
delete env.AIJIAN_E2E_FAKE_TIMELINE_RUN_RESPONSE_FAULT;
const screenshot = (page, name) => page.screenshot({ path: join(evidence, name), fullPage: false });

async function launchAndUse(launchNumber, useWindow) {
  let electronApp;
  let launcherPid = 0;
  const launch = { launchNumber, status: 'RUNNING' };
  result.launches.push(launch);
  await save();
  try {
    electronApp = await electron.launch({ executablePath: electronExe,
      args: [join(root, 'apps', 'desktop'), `--user-data-dir=${profile}`],
      cwd: root, env, timeout: 30000 });
    launch.mainConsoleErrors = [];
    electronApp.on('console', (message) => {
      if (message.type() === 'error') launch.mainConsoleErrors.push({
        utc: new Date().toISOString(), kind: 'main-console',
        text: sanitize(message.text()).slice(0, 4000),
      });
    });
    launcherPid = electronApp.process().pid;
    launch.launcherPid = launcherPid;
    const page = await electronApp.firstWindow({ timeout: 30000 });
    launch.rendererErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') launch.rendererErrors.push({
        utc: new Date().toISOString(), kind: 'console',
        text: sanitize(message.text()).slice(0, 4000), location: message.location(),
      });
    });
    page.on('pageerror', (error) => launch.rendererErrors.push({
      utc: new Date().toISOString(), kind: 'pageerror',
      text: sanitize(error?.stack ?? error).slice(0, 4000),
    }));
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.locator('.demo-root').waitFor({ state: 'visible', timeout: 30000 });
    let main;
    for (let i = 0; i < 30; i++) {
      main = await readMain(electronApp);
      if (main.visible && !main.loading) break;
      await new Promise((done) => setTimeout(done, 500));
    }
    assert.equal(main.visible, true, 'Main window is not visible');
    assert.ok(page.url().startsWith('file:') &&
      decodeURIComponent(page.url()).toLowerCase().includes(
        '/apps/studio-web/dist/index.html'), 'Unexpected renderer URL');
    const verifyWindowOwner = (os, action) => {
      assert.equal(os.targetHwndPid, main.pid,
        `${action}: Win32 owner of main HWND does not match Electron main PID`);
      assert.equal(os.targetProcessChain[0]?.pid, main.pid,
        `${action}: missing main process in Win32 owner chain`);
      const observedImage = os.targetProcessChain[0]?.executablePath;
      assert.ok(observedImage, `${action}: main process image unavailable`);
      assert.equal(realpathSync.native(observedImage).toLowerCase(), electronImage,
        `${action}: main process is not the approved c19 Electron image`);
      assert.equal(os.targetProcessChain.at(-1)?.pid, launcherPid,
        `${action}: Electron main process is not descended from Playwright launcher`);
      assert.ok(os.relatedProcesses.some((item) => item.pid === main.pid),
        `${action}: Electron main process absent from c19 process inventory`);
    };
    const readyOs = osState(launcherPid, false, main.hwnd);
    launch.mainPid = main.pid;
    launch.mainWindow = main;
    launch.readyOs = readyOs;
    await record('window_owner_sample', { launchNumber, launcherPid, main, os: readyOs });
    await save();
    verifyWindowOwner(readyOs, 'window ready');
    launch.rendererUrl = page.url();
    launch.sidecarPids = readyOs.relatedProcesses.filter((item) =>
      item.parentPid === main.pid && item.name.toLowerCase().includes('python'))
      .map((item) => item.pid);
    assert.equal(launch.sidecarPids.length, 1, 'Expected one owned sidecar');
    await record('window_ready', { launchNumber, main, os: readyOs });
    await screenshot(page, `launch${launchNumber}-ready.png`);
    await page.route(/^https?:\/\//, async (route) => {
      const url = new URL(route.request().url());
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        await route.continue();
        return;
      }
      result.prohibitedRendererRequests.push({ launchNumber, host: url.hostname });
      await record('prohibited_renderer_request', { launchNumber, host: url.hostname });
      await route.abort('blockedbyclient');
    });
    const guard = async (action) => {
      const windows = await electronApp.windows();
      assert.equal(windows.length, 1, `${action}: Playwright window count`);
      assert.equal(windows[0], page, `${action}: target Page changed`);
      const actual = await readMain(electronApp);
      assert.equal(actual.pid, main.pid, `${action}: main PID changed`);
      assert.equal(actual.hwnd, main.hwnd, `${action}: HWND changed`);
      assert.equal(actual.webContentsId, main.webContentsId,
        `${action}: webContents changed`);
      const os = osState(launcherPid, false, main.hwnd);
      launch.lastActionOs = { action, os };
      await record('window_owner_sample', { launchNumber, action, main: actual, os });
      await save();
      verifyWindowOwner(os, action);
      await record('window_locator_action', { launchNumber, action,
        main: actual, foreground: { hwnd: os.foregroundHwnd, pid: os.foregroundPid,
          lastInputTick: os.lastInputTick } });
    };
    const click = async (locator, action) => {
      await guard(action);
      assert.equal(await locator.count(), 1, `${action}: locator count`);
      await locator.click({ timeout: 10000 });
    };
    const fill = async (locator, value, action) => {
      await guard(action);
      assert.equal(await locator.count(), 1, `${action}: locator count`);
      await locator.fill(value, { timeout: 10000 });
    };
    assert.equal(await page.getByText('UI 演示 · 样例', { exact: true }).count(), 0,
      'Production shows fixture controls');
    assert.equal(await page.getByLabel('演示存储空间').count(), 0,
      'Production shows fake quota');
    assert.equal(await page.getByText('128 GB / 1 TB', { exact: true }).count(), 0,
      'Production shows fake quota text');
    const resize = async (size) => {
      await guard('resize native content to ' + size.label);
      await electronApp.evaluate(({ BrowserWindow }, target) => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length !== 1) throw new Error('Unexpected BrowserWindow count on resize');
        windows[0].setContentSize(target.width, target.height);
      }, size);
      await page.waitForFunction((target) =>
        window.innerWidth === target.width && window.innerHeight === target.height,
      size, { timeout: 10000 });
      await guard('resized native content at ' + size.label);
    };
    await useWindow({ page, launch, click, fill, guard, resize });
    assert.equal(result.prohibitedRendererRequests.length, 0,
      'Renderer attempted an external request');
    assert.equal(launch.rendererErrors.length, 0,
      `Renderer reported errors: ${JSON.stringify(launch.rendererErrors)}`);
    assert.equal(launch.mainConsoleErrors.length, 0,
      `Electron main reported errors: ${JSON.stringify(launch.mainConsoleErrors)}`);
    launch.status = 'ACTIONS_PASS';
  } catch (error) {
    launch.status = 'FAILED';
    launch.error = sanitize(error?.stack ?? error);
    throw error;
  } finally {
    if (electronApp) {
      try {
        await electronApp.close();
        launch.normalClose = true;
      } catch (error) {
        launch.normalClose = false;
        launch.closeError = sanitize(error?.stack ?? error);
      }
      if (launcherPid > 0) {
        try { launch.postclose = await requireCleanExit(launcherPid); }
        catch (error) { launch.postcloseError = sanitize(error?.stack ?? error); }
      }
    }
    await record('launch_closed', { launchNumber, normalClose: launch.normalClose,
      rendererErrors: launch.rendererErrors, mainConsoleErrors: launch.mainConsoleErrors,
      postclose: launch.postclose, closeError: launch.closeError,
      postcloseError: launch.postcloseError });
    await save();
  }
  assert.equal(launch.normalClose, true, `launch${launchNumber}: normal close failed`);
  assert.ok(launch.postclose, `launch${launchNumber}: process or lock remains`);
}

const sourcePreview = (page) => page.locator('.v2-source-preview');
const readGeometry = (page) => page.evaluate(() => {
  const rect = (element) => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height,
      left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  const entry = document.querySelector('.v2-source-entry');
  const side = document.querySelector('.v2-source-side');
  const preview = document.querySelector('.v2-source-preview');
  const privacy = side?.children[1] ?? null;
  const excerpt = document.querySelector('.v2-source-excerpt');
  const status = preview?.querySelector(':scope > .v2-source-support');
  const actions = preview?.querySelector(':scope > .actions');
  const refresh = [...(actions?.querySelectorAll('button') ?? [])]
    .find((button) => button.textContent?.trim() === '刷新来源状态');
  const hit = (element) => {
    if (!element) return false;
    const r = element.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const at = document.elementFromPoint(x, y);
    return !!at && element.contains(at);
  };
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight,
      dpr: window.devicePixelRatio },
    hash: window.location.hash,
    entry: rect(entry), side: rect(side), preview: rect(preview),
    privacy: rect(privacy), excerpt: rect(excerpt),
    status: rect(status), actions: rect(actions), refresh: rect(refresh),
    refreshHit: hit(refresh),
    excerptScroll: excerpt ? { top: excerpt.scrollTop,
      clientHeight: excerpt.clientHeight, scrollHeight: excerpt.scrollHeight } : null,
    previewScroll: preview ? { top: preview.scrollTop,
      clientHeight: preview.clientHeight, scrollHeight: preview.scrollHeight } : null,
    sideScroll: side ? { top: side.scrollTop,
      clientHeight: side.clientHeight, scrollHeight: side.scrollHeight } : null,
    text: { status: status?.textContent?.trim() ?? null,
      refresh: refresh?.textContent?.trim() ?? null },
    focus: { tag: document.activeElement?.tagName ?? null,
      text: document.activeElement?.textContent?.trim().slice(0, 100) ?? null },
  };
});
const intersectArea = (a, b) => Math.max(0, Math.min(a.right, b.right) -
  Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) -
  Math.max(a.top, b.top));
function assertGeometry(sample, label) {
  assert.ok(sample.entry && sample.preview && sample.privacy &&
    sample.excerpt && sample.status && sample.actions && sample.refresh,
  label + ': source preview DOM incomplete');
  assert.equal(intersectArea(sample.entry, sample.preview), 0,
    label + ': entry and preview overlap');
  assert.equal(intersectArea(sample.preview, sample.privacy), 0,
    label + ': preview and privacy cards overlap');
  assert.ok(sample.excerpt.height >= 72, label + ': excerpt lost usable height');
  assert.ok(sample.status.top >= sample.preview.top - 1 &&
    sample.status.bottom <= sample.preview.bottom + 1,
  label + ': source status clipped from preview');
  assert.ok(sample.actions.top >= sample.preview.top - 1 &&
    sample.actions.bottom <= sample.preview.bottom + 1,
  label + ': preview actions clipped from card');
  assert.ok(sample.refresh.width > 0 && sample.refresh.height > 0 &&
    sample.refreshHit, label + ': refresh button not fully hit-testable');
  assert.match(sample.text.status ?? '', /来源状态：/);
  assert.equal(sample.text.refresh, '刷新来源状态');
}
async function collectSize({ page, launch, guard, resize }, size) {
  await resize(size);
  const preview = sourcePreview(page);
  await preview.waitFor({ state: 'visible', timeout: 15000 });
  const refresh = preview.getByRole('button', { name: '刷新来源状态', exact: true });
  await guard('scroll source preview into view at ' + size.label);
  await refresh.scrollIntoViewIfNeeded();
  let sample = await readGeometry(page);
  assert.deepEqual(
    { width: sample.viewport.width, height: sample.viewport.height },
    { width: size.width, height: size.height },
    size.label + ': native content dimensions differ');
  assertGeometry(sample, size.label);
  const excerpt = page.locator('.v2-source-excerpt');
  assert.ok(sample.excerptScroll.scrollHeight >
    sample.excerptScroll.clientHeight + 10,
  size.label + ': synthetic preview is not scrollable');
  await guard('scroll excerpt at ' + size.label);
  await excerpt.hover();
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(() =>
    (document.querySelector('.v2-source-excerpt')?.scrollTop ?? 0) > 0,
  null, { timeout: 5000 });
  await refresh.scrollIntoViewIfNeeded();
  sample = await readGeometry(page);
  assertGeometry(sample, size.label + ' after excerpt scroll');
  assert.ok(sample.excerptScroll.top > 0,
    size.label + ': excerpt wheel did not move content');
  const name = 'launch' + launch.launchNumber + '-' + size.label + '.png';
  const png = await screenshot(page, name);
  const pixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  assert.equal(pixels.width, Math.round(size.width * sample.viewport.dpr),
    size.label + ': screenshot width differs from native viewport');
  assert.equal(pixels.height, Math.round(size.height * sample.viewport.dpr),
    size.label + ': screenshot height differs from native viewport');
  const observation = { size, geometry: sample, screenshot: name, pixels };
  launch.layoutSamples ??= [];
  launch.layoutSamples.push(observation);
  await record('layout_sample', { launchNumber: launch.launchNumber, ...observation });
  await save();
  return observation;
}
async function connectWorkspace({ page, click }) {
  const button = page.getByRole('button', { name: '连接本地工作区', exact: true });
  const connected = page.getByRole('button', { name: '本地工作区已连接', exact: true });
  if (!(await button.count()) && !(await connected.count()))
    await click(page.getByRole('button', { name: '打开项目中心', exact: true }),
      'open project center');
  if (await button.count()) await click(button, 'connect isolated workspace');
  await connected.waitFor({ state: 'visible', timeout: 30000 });
}
async function openProjects({ page, click }) {
  const search = page.locator('.v2-project-search');
  if (!(await search.count()))
    await click(page.locator('aside[aria-label="主导航"]')
      .getByRole('button', { name: '项目中心', exact: true }), 'open project center');
  await search.waitFor({ state: 'visible', timeout: 15000 });
}
async function verifyTabFocus({ page, launch, guard }) {
  await guard('begin Tab focus traversal');
  const refresh = sourcePreview(page)
    .getByRole('button', { name: '刷新来源状态', exact: true });
  await refresh.scrollIntoViewIfNeeded();
  const trail = [];
  for (let i = 0; i < 130; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({
      text: document.activeElement?.textContent?.trim().slice(0, 100) ?? '',
      inPreview: !!document.activeElement?.closest('.v2-source-preview'),
      tag: document.activeElement?.tagName ?? '',
    }));
    trail.push(focus);
    if (focus.inPreview && focus.text === '刷新来源状态') {
      launch.tabFocus = { reached: true, presses: i + 1, trail };
      await screenshot(page, 'launch' + launch.launchNumber + '-tab-focus.png');
      await record('tab_focus', { launchNumber: launch.launchNumber,
        presses: i + 1, trail });
      return;
    }
  }
  launch.tabFocus = { reached: false, trail };
  throw new Error('Tab traversal did not reach source status refresh button');
}
async function inspectDatabase() {
  const database = join(profile, 'workspace', 'workspace.sqlite3');
  assert.ok(existsSync(database), 'Isolated workspace SQLite missing');
  const inspectCode = [
    'import json,pathlib,sqlite3,sys',
    'p=pathlib.Path(sys.argv[1]); c=sqlite3.connect(p.as_uri()+"?mode=ro",uri=True)',
    'r={"projects":c.execute("SELECT id,name FROM projects").fetchall(),"documents":c.execute("SELECT id,project_id,byte_size FROM source_documents").fetchall(),"connections":c.execute("SELECT COUNT(*) FROM provider_connections").fetchone()[0],"approvals":c.execute("SELECT COUNT(*) FROM sub2api_call_approvals").fetchone()[0],"consumptions":c.execute("SELECT COUNT(*) FROM sub2api_call_consumptions").fetchone()[0],"integrity":c.execute("PRAGMA integrity_check").fetchone()[0],"foreignKeyErrors":c.execute("PRAGMA foreign_key_check").fetchall()}',
    'print(json.dumps(r,ensure_ascii=True)); c.close()',
  ].join('; ');
  const snapshot = JSON.parse(execFileSync(pythonExe,
    ['-c', inspectCode, database], { encoding: 'utf8', timeout: 10000 }));
  assert.equal(snapshot.projects.length, 1, 'Expected one synthetic project');
  assert.equal(snapshot.projects[0][1], plan.projectName);
  assert.equal(snapshot.documents.length, 1, 'Expected one synthetic source');
  assert.equal(snapshot.documents[0][1], snapshot.projects[0][0]);
  assert.equal(snapshot.connections, 0, 'Visual QA created a provider connection');
  assert.equal(snapshot.approvals, 0, 'Visual QA approved a provider call');
  assert.equal(snapshot.consumptions, 0, 'Visual QA consumed a provider call');
  assert.deepEqual(snapshot.foreignKeyErrors, []);
  assert.equal(snapshot.integrity, 'ok');
  return { snapshot, sha256: hashFile(database) };
}

try {
  await launchAndUse(1, async ({ page, launch, click, fill, guard, resize }) => {
    await connectWorkspace({ page, click });
    await openProjects({ page, click });
    await click(page.locator('.v2-project-search')
      .getByRole('button', { name: '新建项目', exact: true }),
    'create visual QA project');
    const create = page.getByRole('dialog', { name: '新建项目' });
    await create.waitFor({ state: 'visible', timeout: 10000 });
    await fill(create.getByLabel('作品名称'), plan.projectName,
      'fill visual QA project name');
    await click(create.getByRole('button', { name: '确认', exact: true }),
      'save visual QA project');
    await page.getByRole('button', { name: '粘贴故事', exact: true })
      .waitFor({ state: 'visible', timeout: 30000 });
    await click(page.getByRole('button', { name: '粘贴故事', exact: true }),
      'select pasted synthetic source');
    await fill(page.getByLabel('外部原文正文'), plan.sourceText,
      'fill long synthetic source');
    await click(page.getByRole('button', { name: '作为外部原文导入', exact: true }),
      'import synthetic source locally');
    await page.getByText(/来源已保存并读回确认/)
      .waitFor({ state: 'visible', timeout: 30000 });
    await sourcePreview(page).getByText(/虚构测试城/).first()
      .waitFor({ state: 'visible', timeout: 15000 });
    for (const size of plan.sizes)
      await collectSize({ page, launch, guard, resize }, size);
    await verifyTabFocus({ page, launch, guard });
    await click(sourcePreview(page)
      .getByRole('button', { name: '刷新来源状态', exact: true }),
    'read-only refresh source status');
    await screenshot(page, 'launch1-refresh-click.png');
  });
  await launchAndUse(2, async ({ page, launch, click, guard, resize }) => {
    await connectWorkspace({ page, click });
    await openProjects({ page, click });
    const row = page.locator('.v2-project-row')
      .filter({ hasText: plan.projectName });
    await row.waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await row.count(), 1, 'Visual QA project missing on reopen');
    await click(row.getByRole('button', { name: '打开项目', exact: true }),
      'reopen visual QA project');
    await click(page.locator('aside[aria-label="主导航"]')
      .getByRole('button', { name: '故事 / 剧本', exact: true }),
    'open story to navigate to source');
    await click(page.getByRole('button', { name: '返回来源审核', exact: true }),
      'return to draft source without submitting review');
    await sourcePreview(page).getByText(/虚构测试城/).first()
      .waitFor({ state: 'visible', timeout: 15000 });
    const again = await collectSize({ page, launch, guard, resize }, plan.sizes[0]);
    const first = result.launches[0].layoutSamples[0];
    for (const field of ['width', 'height']) {
      assert.ok(Math.abs(again.geometry.preview[field] -
        first.geometry.preview[field]) <= 3,
      'Source preview ' + field + ' changed after reopen');
      assert.ok(Math.abs(again.geometry.excerpt[field] -
        first.geometry.excerpt[field]) <= 3,
      'Source excerpt ' + field + ' changed after reopen');
    }
    launch.reopenGeometryStable = true;
  });
  result.database = await inspectDatabase();
  assert.equal(head(), plan.head, 'Git HEAD changed during visual QA');
  const afterHashes = productHashes();
  assert.deepEqual(afterHashes, beforeHashes, 'Source or dist changed during visual QA');
  assert.equal(gitStatus(), beforeStatus, 'Worktree status changed during visual QA');
  result.postflight = { head: head(), files: afterHashes, gitStatus: gitStatus(),
    os: osState(0, true) };
  assert.equal(result.postflight.os.relatedProcesses.length, 0,
    'c19 process remains after close');
  assert.equal(result.prohibitedRendererRequests.length, 0);
  result.status = 'VISUAL_LAYOUT_PASS';
} catch (error) {
  result.status = 'STOP_OR_UNKNOWN';
  result.error = sanitize(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  result.finishedUtc = new Date().toISOString();
  await save();
  process.stdout.write(result.status + ' ' + join(evidence, 'result.json') + '\n');
}
