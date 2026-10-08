/* AC05 queue-only native QA draft. Never approve a provider call or send content externally. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

throw new Error('DRAFT_NOT_RUNNABLE: AC05 queue actions and DB checks are not implemented');

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
assert.equal(plan.kind, 'QA02_AC05_NATIVE_QUEUE_PLAN');
assert.equal(plan.scope, 'SYNTHETIC_LOCAL_SOURCE_SUB2API_QUEUE_READBACK_NO_CALL_APPROVAL');
assert.equal(plan.maxLaunches, 2);
assert.equal(approval.kind, 'MGR02_QA02_AC05_NATIVE_QUEUE_APPROVAL');
assert.equal(approval.runId, plan.runId);
assert.equal(approval.planSha256.toUpperCase(), args['plan-sha256'].toUpperCase());
assert.equal(approval.maxLaunches, 2);
matchHash(hashFile(import.meta.filename), approval.runnerSha256, 'runner');
matchHash(hashFile(helper), approval.helperSha256, 'OS helper');
assert.match(plan.runId, /^qa02-ac05-native-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{4,16}$/);

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
assert.equal(plan.origin, 'https://qa-native-ac05.invalid');
assert.equal(plan.connectionName, 'QA02 AC05 合成文本连接');
assert.equal(plan.modelId, 'qa-text-only');
assert.match(plan.projectName, /^QA02 AC05 本地队列 qa02-ac05-native-/);
assert.equal(plan.syntheticSourceText,
  '在虚构的测试城中，阿甲把纸船交给阿乙。此段仅用于本地自动化验证，不含真实作品内容。');
assert.ok(plan.prohibitedActions.includes('approveSub2APISourceExtractCall'));
assert.ok(Array.isArray(plan.files) && plan.files.length >= 5);

const required = new Set([
  'apps/desktop/src/main.ts',
  'apps/desktop/src/e2e-user-data.ts',
  'apps/desktop/src/remote-source-extract-v2-ipc.ts',
  'apps/studio-web/src/aivora/DemoApp.tsx',
  'apps/studio-web/src/aivora/Common.tsx',
  'apps/studio-web/src/aivora/ProviderConnectionForm.tsx',
  'apps/studio-web/src/aivora/SourceExtractionPanel.tsx',
  'apps/studio-web/src/aivora/UtilityPages.tsx',
  'services/api/src/aijian_api/sidecar.py',
  'services/api/src/aijian_api/sub2api_source_extract_runtime.py',
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
const beforeStatus = gitStatus();
assert.equal(beforeStatus, plan.gitStatus, 'Worktree differs from approved AC05 build');
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
const fakeKey = `qaFakeBusinessKey-${plan.runId}`;
const sanitize = (value) => String(value).replaceAll(fakeKey, '[REDACTED_FAKE_KEY]');
const env = { ...process.env, AIJIAN_E2E_USER_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AIJIAN_E2E_PROPOSAL_RUN_RESPONSE_FAULT;
delete env.AIJIAN_E2E_FAKE_TIMELINE_RUN_RESPONSE_FAULT;
const screenshot = (page, name) => page.screenshot({ path: join(evidence, name), fullPage: true });

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
    await useWindow({ page, launch, click, fill, guard });
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

