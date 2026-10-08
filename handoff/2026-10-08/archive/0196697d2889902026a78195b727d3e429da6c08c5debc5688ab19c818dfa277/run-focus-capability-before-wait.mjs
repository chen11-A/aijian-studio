/* global process, Buffer */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';

// PROPOSAL ONLY. No UI run is authorized by the existence of this file.
const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const owned = 'C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924';
const helper = join(owned, 'focus-capability-proposal-20260924', 'focus-state.ps1');
const runner = join(owned, 'run-native-bm-click-once.mjs');
const snapshotPath = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260924-layout07-27/SNAPSHOT.json';
const qaPath = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260924-build05-qa-overlay-6/SNAPSHOT.json';
const buildPath = join(owned, 'evidence', 'm1-layout07-build-20260924T033449449Z', 'postbuild.json');
const inputPath = 'C:/Users/Administrator/Documents/AIVORA/production/inputs/20260924/离别30秒剧本.md';
const ledgerPath = join(owned, 'evidence',
  'bm-click-short-submit-569e8b63a2545d7178e18b22348330b10d8e5b628410b4e45732e4b3ccffc21f.ledger.json');
const expected = Object.freeze({
  head: '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2',
  snapshot: '569e8b63a2545d7178e18b22348330b10d8e5b628410b4e45732e4b3ccffc21f',
  qa: 'ed784de9f7610fbf3d4a767ff2c3b1a716472a72e0afa5860d33fc66bbd25048',
  build: '5b395e855b8502515741345efcc35a58ce5172ee1a3829437e2bbde0e133042f',
  sender: '19ab699de57efb2412d73edc497c1a1207814b7f25b5ade6e2b9453c8dfe9af0',
  runner: 'e646cd1d6017e8f92f19f75fbfa332b917829d06e48f4b61a85385e6f110c45f',
  input: '466f23b789b47fa1231b0891e80385a13e530b02de2f74481c4e98f5732de008',
  ledger: '8c2f15cfc225421736e52c4d4ad4060ba81be5295f3686d634bd420d1a0726b0',
});
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  if (!arg.startsWith('--') || at < 3) throw new Error(`invalid option: ${arg}`);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
assert.equal(process.platform, 'win32', 'Windows only');
assert.match(args['attempt-id'] ?? '', /^focus-capability-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6,16}$/);
assert.ok(args.approval && args['approval-sha256'], 'manager approval receipt required');
const approvalBytes = readFileSync(resolve(args.approval));
assert.equal(sha(approvalBytes), args['approval-sha256'].toLowerCase(), 'approval receipt hash changed');
const approval = JSON.parse(approvalBytes.toString('utf8'));
assert.equal(approval.kind, 'QA02_FOCUS_CAPABILITY_ONLY');
assert.equal(approval.approved_by, 'MGR02');
assert.equal(approval.attempt_id, args['attempt-id']);
assert.equal(approval.head, expected.head);
assert.equal(approval.snapshot_sha256, expected.snapshot);
assert.equal(approval.qa_sha256, expected.qa);
assert.equal(approval.build_sha256, expected.build);
assert.equal(approval.sender_sha256, expected.sender);
assert.equal(approval.runner_sha256, expected.runner);
assert.equal(approval.input_sha256, expected.input);
assert.equal(approval.first_ledger_sha256, expected.ledger);
assert.equal(approval.focus_script_sha256, sha(readFileSync(import.meta.filename)));
assert.equal(approval.helper_sha256, sha(readFileSync(helper)));
assert.equal(approval.max_focus_calls, 1);
assert.equal(approval.idle_floor_ms, 60000);
assert.equal(sha(readFileSync(runner)), expected.runner);
assert.equal(sha(readFileSync(ledgerPath)), expected.ledger, 'first attempt ledger changed');
const evidence = join(owned, 'evidence', args['attempt-id']);
const profile = join(repo, '.aijian-dev', args['attempt-id']);
assert.ok(!existsSync(evidence) && !existsSync(profile), 'attempt ID or profile reused');
await mkdir(evidence, { recursive: false });

const result = {
  attempt_id: args['attempt-id'], status: 'PREPARING', started_utc: new Date().toISOString(),
  approval_path: resolve(args.approval), approval_sha256: sha(approvalBytes),
  focus_script_sha256: sha(readFileSync(import.meta.filename)), helper_sha256: sha(readFileSync(helper)),
  runner_sha256: expected.runner, first_ledger_sha256: expected.ledger,
  evidence, profile, focus_call_count: 0, source_action_attempted: false, events: [], errors: [],
};
const save = () => writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
await save();

async function captureProcess(label, command, commandArgs) {
  const child = spawn(command, commandArgs, { cwd: owned, windowsHide: true });
  const stdoutParts = [];
  const stderrParts = [];
  child.stdout.on('data', (part) => stdoutParts.push(part));
  child.stderr.on('data', (part) => stderrParts.push(part));
  let spawnError = null;
  child.on('error', (error) => { spawnError = String(error); });
  const exit = await new Promise((resolveExit) => child.on('close', (code, signal) =>
    resolveExit({ code, signal })));
  const stdout = Buffer.concat(stdoutParts);
  const stderr = Buffer.concat(stderrParts);
  await writeFile(join(evidence, `${label}.stdout.raw`), stdout);
  await writeFile(join(evidence, `${label}.stderr.raw`), stderr);
  const receipt = { label, child_pid: child.pid, ...exit, spawn_error: spawnError,
    stdout_sha256: sha(stdout), stderr_sha256: sha(stderr) };
  await writeFile(join(evidence, `${label}.process.json`), JSON.stringify(receipt, null, 2));
  assert.equal(spawnError, null, `${label} spawn failed`);
  assert.equal(exit.code, 0, `${label} exited nonzero`);
  return receipt;
}

const preflightArgs = [runner,
  `--input=${inputPath}`, `--snapshot=${snapshotPath}`, `--qa=${qaPath}`, `--build=${buildPath}`,
  `--candidate=${expected.head}`, `--snapshot-sha256=${expected.snapshot}`,
  `--qa-sha256=${expected.qa}`, `--build-sha256=${expected.build}`,
  `--probe-sha256=${expected.sender}`, '--preflight-only=true'];
async function preflight(label) {
  await captureProcess(label, process.execPath, preflightArgs);
  const raw = await readFile(join(evidence, `${label}.stdout.raw`), 'utf8');
  assert.match(raw, /^PREFLIGHT_OK \{/);
  const proof = JSON.parse(raw.slice('PREFLIGHT_OK '.length));
  assert.equal(proof.product_count, 27);
  assert.equal(proof.qa_count, 6);
  assert.equal(proof.dist_count, 73);
  assert.equal(proof.ledger_created, false);
  assert.equal(proof.profile_created, false);
  assert.equal(proof.electron_launched, false);
  result.events.push({ phase: label, proof });
  await save();
}
async function state(label, expectedPid = 0, expectedHwnd = 0) {
  const output = join(evidence, `${label}.json`);
  await captureProcess(label, 'powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
    '-File', helper, '-ExpectedPid', String(expectedPid), '-ExpectedHwnd', String(expectedHwnd),
    '-RepoPath', repo, '-EvidencePath', output]);
  const snapshot = JSON.parse(await readFile(output, 'utf8'));
  result.events.push({ phase: label, state_path: output });
  await save();
  return snapshot;
}
const requireIdle = (snapshot, label) => {
  assert.ok(snapshot.idle_ms >= approval.idle_floor_ms, `${label}: recent user input`);
  assert.equal(snapshot.foreground.is_window, true, `${label}: no foreground window`);
  assert.equal(snapshot.foreground.session_id, snapshot.probe_session_id,
    `${label}: foreground is in another session`);
  assert.ok(snapshot.probe_desktop_name &&
    snapshot.foreground.desktop_name === snapshot.probe_desktop_name,
  `${label}: foreground desktop differs or is unknown`);
};
const requireAppWindow = (snapshot, pid, hwnd, label) => {
  assert.equal(snapshot.expected_window.is_window, true, `${label}: app window missing`);
  assert.equal(snapshot.expected_window.handle, hwnd, `${label}: app HWND changed`);
  assert.equal(snapshot.expected_window.pid, pid, `${label}: app HWND PID mismatch`);
  assert.equal(snapshot.expected_window.class_name, 'Chrome_WidgetWin_1',
    `${label}: app HWND class mismatch`);
  assert.equal(snapshot.expected_window.title, 'AIVORA', `${label}: app title mismatch`);
  assert.equal(snapshot.expected_session_id, snapshot.probe_session_id,
    `${label}: app session mismatch`);
  assert.equal(snapshot.expected_window.desktop_name, snapshot.probe_desktop_name,
    `${label}: app desktop mismatch`);
};

const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const electronExe = join(repo, 'apps/desktop/node_modules/electron/dist/electron.exe');
let app;
try {
  assert.ok(existsSync(electronExe), 'Electron executable missing');
  await preflight('preflight-before');
  const prelaunch = await state('prelaunch');
  assert.equal(prelaunch.related_processes.length, 0, 'c19 process already running');
  requireIdle(prelaunch, 'prelaunch');
  await mkdir(profile, { recursive: false });
  result.status = 'LAUNCHING';
  await save();
  app = await electron.launch({ executablePath: electronExe,
    args: [join(repo, 'apps/desktop'), `--user-data-dir=${profile}`],
    cwd: repo, env: { ...process.env, AIJIAN_E2E_USER_DATA_DIR: profile }, timeout: 30000 });
  const page = await app.firstWindow({ timeout: 30000 });
  assert.equal(await page.title(), 'AIVORA', 'unexpected renderer title');
  const main = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length !== 1) throw new Error(`BrowserWindow count=${windows.length}`);
    const win = windows[0];
    const handle = win.getNativeWindowHandle();
    const hwnd = handle.length === 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
    return { pid: process.pid, exec_path: process.execPath, hwnd,
      title: win.getTitle(), visible: win.isVisible(), focused: win.isFocused() };
  });
  assert.ok(Number.isSafeInteger(main.hwnd) && main.hwnd > 0, 'invalid app HWND');
  assert.equal(basename(main.exec_path).toLowerCase(), 'electron.exe', 'unexpected main executable');
  assert.equal(main.title, 'AIVORA');
  assert.equal(main.visible, true, 'app window not visible');
  result.main = main;
  result.wrapper_pid = app.process().pid;
  await save();

  const before1 = await state('before-focus-1', main.pid, main.hwnd);
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const before2 = await state('before-focus-2', main.pid, main.hwnd);
  requireAppWindow(before1, main.pid, main.hwnd, 'before-focus-1');
  requireAppWindow(before2, main.pid, main.hwnd, 'before-focus-2');
  requireIdle(before1, 'before-focus-1');
  requireIdle(before2, 'before-focus-2');
  assert.equal(before1.last_input_tick, prelaunch.last_input_tick,
    'user input occurred during launch');
  assert.equal(before2.last_input_tick, before1.last_input_tick,
    'user input occurred during focus observations');
  assert.equal(before2.foreground.handle, before1.foreground.handle,
    'foreground changed during observations');
  const current = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length !== 1) throw new Error(`BrowserWindow count=${windows.length}`);
    return { focused: windows[0].isFocused(), visible: windows[0].isVisible() };
  });
  assert.equal(current.visible, true, 'app no longer visible');
  if (before2.foreground.handle === main.hwnd) {
    assert.equal(current.focused, true, 'Win32/Electron focus disagrees');
    result.status = 'ALREADY_FOCUSED_NO_CALL';
  } else {
    assert.equal(current.focused, false, 'Win32/Electron focus disagrees');
    const finalBefore = await state('final-before-focus', main.pid, main.hwnd);
    requireAppWindow(finalBefore, main.pid, main.hwnd, 'final-before-focus');
    requireIdle(finalBefore, 'final-before-focus');
    assert.equal(finalBefore.last_input_tick, before2.last_input_tick,
      'user input occurred before focus call');
    assert.equal(finalBefore.foreground.handle, before2.foreground.handle,
      'foreground changed before focus call');
    const intentPath = join(evidence, 'focus-intent.json');
    const intent = await open(intentPath, 'wx');
    try {
      await intent.writeFile(JSON.stringify({ armed_utc: new Date().toISOString(),
        focus_call_index: 1, method: 'BrowserWindow.focus', main_pid: main.pid,
        main_hwnd: main.hwnd, previous_foreground: finalBefore.foreground,
        outcome: 'UNKNOWN_UNTIL_READBACK' }, null, 2));
    } finally { await intent.close(); }
    result.focus_call_count = 1;
    result.status = 'FOCUS_CALL_ARMED_OUTCOME_UNKNOWN';
    await save();
    result.focus_call = await app.evaluate(({ BrowserWindow }, expectedHwnd) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length !== 1) throw new Error(`BrowserWindow count=${windows.length}`);
      const win = windows[0];
      const handle = win.getNativeWindowHandle();
      const hwnd = handle.length === 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
      if (hwnd !== expectedHwnd || win.isDestroyed() || !win.isVisible()) {
        throw new Error('BrowserWindow identity changed before focus');
      }
      win.focus(); // the only focus call in the entire probe
      return { hwnd, focused_after_call: win.isFocused() };
    }, main.hwnd);
    await save();
    const after1 = await state('after-focus-1', main.pid, main.hwnd);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const after2 = await state('after-focus-2', main.pid, main.hwnd);
    requireAppWindow(after2, main.pid, main.hwnd, 'after-focus-2');
    const final = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length !== 1) throw new Error(`BrowserWindow count=${windows.length}`);
      return { focused: windows[0].isFocused() };
    });
    result.focus_readback = { after1_foreground: after1.foreground,
      after2_foreground: after2.foreground, final_electron: final };
    if (after1.last_input_tick !== finalBefore.last_input_tick ||
        after2.last_input_tick !== finalBefore.last_input_tick) {
      result.status = 'USER_CONTENTION_AFTER_FOCUS';
    } else if (after2.foreground.handle === main.hwnd &&
               after2.foreground.pid === main.pid && final.focused) {
      result.status = 'FOCUS_CONFIRMED';
    } else {
      result.status = 'FOCUS_NOT_GAINED';
    }
  }
} catch (error) {
  result.errors.push({ message: String(error), stack: error.stack });
  result.status = result.focus_call_count ? 'FOCUS_UNKNOWN_OR_REJECTED' : 'STOP_BEFORE_FOCUS';
} finally {
  if (app) {
    try { await app.close(); result.normal_close = true; }
    catch (error) { result.close_error = String(error); }
  }
  try {
    await preflight('preflight-after');
    result.first_ledger_unchanged = sha(await readFile(ledgerPath)) === expected.ledger;
    const postclose = await state('postclose');
    result.postclose_related_processes = postclose.related_processes;
    result.profile_root_lock_names = existsSync(profile)
      ? (await readdir(profile)).filter((name) => /^Singleton|lock/i.test(name)) : [];
  } catch (error) {
    result.errors.push({ message: `postclose: ${String(error)}`, stack: error.stack });
  }
  result.postcheck_status = result.normal_close && result.first_ledger_unchanged &&
    result.postclose_related_processes?.length === 0 &&
    result.profile_root_lock_names?.length === 0 ? 'PASS' : 'FAIL';
  result.finished_utc = new Date().toISOString();
  await save();
  process.stdout.write(`${result.status}: ${join(evidence, 'result.json')}\n`);
  if (!['ALREADY_FOCUSED_NO_CALL', 'FOCUS_CONFIRMED'].includes(result.status) ||
      result.postcheck_status !== 'PASS' || result.errors.length) {
    process.exitCode = 1;
  }
}
