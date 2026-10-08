// QA-only one-shot Electron module-load gate; writes only under this QA directory.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const qa = __dirname;
const candidate = path.join(qa, 'candidate');
const app = path.join(candidate, 'app');
const dist = path.join(app, 'dist');
const contracts = path.join(app, 'node_modules', '@aijian', 'contracts');
const marker = path.join(qa, 'ELECTRON-READY.json');
const go = path.join(qa, 'ELECTRON-GO.json');
const receiptPath = path.join(qa, 'RECEIPT.json');
const started = path.join(qa, 'RUN-STARTED.json');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const norm = file => path.resolve(file).toLowerCase();
const assertFile = (file, item) => {
  assert.ok(fs.lstatSync(file).isFile(), `Not regular file: ${file}`);
  assert.equal(fs.statSync(file).size, item.bytes, `Byte drift: ${file}`);
  assert.equal(hash(file), item.sha256.toUpperCase(), `SHA drift: ${file}`);
};
const copy = (from, to, item) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  assertFile(to, item);
};
const files = root => {
  const list = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full);
      assert.ok(!stat.isSymbolicLink(), `Symlink: ${full}`);
      if (stat.isDirectory()) visit(full);
      else { assert.ok(stat.isFile()); list.push(full); }
    }
  }
  visit(root); return list.sort();
};
const processInfo = pid => {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const command = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){$p | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress}`;
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', command],
    { encoding: 'utf8', timeout: 10000 }).trim();
  return { raw, parsed: raw ? JSON.parse(raw) : null };
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const [flag, approvalPath, shaFlag, approvalSha] = process.argv.slice(2);
  assert.equal(flag, '--approval'); assert.equal(shaFlag, '--approval-sha256');
  assert.ok(approvalPath && /^[0-9A-F]{64}$/i.test(approvalSha ?? ''));
  assert.equal(hash(approvalPath), approvalSha.toUpperCase());
  assert.notEqual(norm(approvalPath), norm(path.join(qa, 'APPROVAL.template.json')));
  const approval = read(approvalPath);
  assert.equal(approval.schema, 'qa03.electron-module.one-shot.approval.v1');
  assert.equal(approval.state, 'APPROVED_SINGLE_RUN');
  assert.equal(norm(approval.qaRoot), norm(qa));
  assert.equal(hash(path.join(qa, 'RUN-PACKET.json')), approval.packetSha256);
  assert.equal(hash(__filename), approval.runnerSha256);
  assert.equal(hash(path.join(qa, 'probe-electron.cjs')), approval.probeSha256);
  assert.equal(hash(path.join(qa, 'app.package.json')), approval.appPackageSha256);
  assert.equal(hash(approval.electronExePath), approval.electronExeSha256);
  assert.equal(hash(approval.electronPackagePath), approval.electronPackageSha256);
  assert.equal(read(approval.electronPackagePath).version, '43.2.0');
  assert.equal(hash(approval.desktopManifestPath), approval.desktopManifestSha256);
  assert.equal(hash(approval.contractsManifestPath), approval.contractsManifestSha256);
  const desktop = read(approval.desktopManifestPath);
  const runtime = read(approval.contractsManifestPath);
  assert.equal(desktop.file_count, 38); assert.equal(desktop.files.length, 38);
  assert.equal(runtime.file_count, 7); assert.equal(runtime.files.length, 7);
  assert.equal(runtime.package_identity.type, 'commonjs');
  assert.equal(runtime.source_receipt_sha256, 'BA89D2644C8521AB7815980FA0E28D51682185F19C1492DDB781D464E2401F69');
  assert.ok(!fs.existsSync(candidate) && !fs.existsSync(marker) && !fs.existsSync(go) &&
    !fs.existsSync(started) && !fs.existsSync(receiptPath), 'One-shot already started');
  for (const item of desktop.files) assertFile(path.join(desktop.frozen_dist, item.path), item);
  for (const item of runtime.files) assertFile(path.join(runtime.frozen_runtime_dir, item.path), item);
  assert.deepEqual(files(runtime.frozen_runtime_dir).map(x => path.basename(x)).sort(),
    runtime.files.map(x => x.path).sort());
  fs.writeFileSync(started, JSON.stringify({ approvalSha256: approvalSha.toUpperCase(),
    runnerSha256: hash(__filename), at: new Date().toISOString() }, null, 2)+'\n', { flag: 'wx' });
  const receipt = { schema: 'qa03.electron-module.receipt.v1', state: 'UNKNOWN',
    startedAt: new Date().toISOString(), approvalSha256: approvalSha.toUpperCase(),
    exeSha256: approval.electronExeSha256, exeVersionFromPackage: '43.2.0',
    desktopManifestSha256: approval.desktopManifestSha256,
    contractsManifestSha256: approval.contractsManifestSha256,
    candidatePath: candidate, window: 'NOT_CREATED', sidecar: 'NOT_RUN',
    renderer: 'NOT_RUN', provider: 'NOT_RUN' };
  let child;
  let closePromise;
  const out = [], err = [];
  try {
    for (const item of desktop.files)
      copy(path.join(desktop.frozen_dist, item.path), path.join(dist, item.path), item);
    for (const item of runtime.files)
      copy(path.join(runtime.frozen_runtime_dir, item.path), path.join(contracts, item.path), item);
    fs.copyFileSync(path.join(qa, 'probe-electron.cjs'), path.join(app, 'probe-electron.cjs'), fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(path.join(qa, 'app.package.json'), path.join(app, 'package.json'), fs.constants.COPYFILE_EXCL);
    const env = { ...process.env, QA03_ELECTRON_MARKER: marker, QA03_ELECTRON_GO: go };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    const args = [app];
    child = spawn(approval.electronExePath, args, { cwd: app, env, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', x => out.push(x)); child.stderr.on('data', x => err.push(x));
    let closed = null;
    closePromise = new Promise(resolve => {
      child.once('error', error => { closed = { code: null, signal: null, error: String(error) }; resolve(closed); });
      child.once('close', (code, signal) => { closed = { code, signal }; resolve(closed); });
    });
    receipt.command = { executable: approval.electronExePath, arguments: args, cwd: app, pid: child.pid };
    let ready;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (fs.existsSync(marker)) { ready = read(marker); break; }
      if (closed) throw new Error(`Electron exited before ready: ${JSON.stringify(closed)}`);
      await wait(100);
    }
    assert.ok(ready, 'Electron ready marker timeout');
    assert.equal(ready.state, 'ELECTRON_MAIN_MODULE_LOAD_READY');
    assert.equal(ready.pid, child.pid);
    assert.equal(ready.electron, '43.2.0');
    assert.equal(norm(ready.execPath), norm(approval.electronExePath));
    assert.equal(ready.isPackaged, false);
    assert.equal(ready.loaded.length, 4);
    assert.equal(ready.esmNamed.length, 4);
    const os = processInfo(child.pid);
    assert.ok(os.parsed, 'Missing OS process snapshot');
    assert.equal(os.parsed.ProcessId, child.pid);
    assert.equal(norm(os.parsed.ExecutablePath), norm(approval.electronExePath));
    assert.ok(os.parsed.CommandLine.toLowerCase().includes(norm(app)));
    fs.writeFileSync(path.join(qa, 'PROCESS-OS.raw.json'), os.raw+'\n', { flag: 'wx' });
    receipt.ready = ready;
    receipt.readySha256 = hash(marker);
    receipt.osProcessSha256 = hash(path.join(qa, 'PROCESS-OS.raw.json'));
    fs.writeFileSync(go, JSON.stringify({ pid: child.pid, at: new Date().toISOString() })+'\n', { flag: 'wx' });
    const finish = await Promise.race([closePromise, wait(15000).then(() => ({ timeout: true }))]);
    if (finish.timeout) { child.kill(); throw new Error('Electron quit timeout'); }
    receipt.exit = finish;
    assert.equal(finish.code, 0, 'Electron exit nonzero');
    assert.equal(processInfo(child.pid).parsed, null, 'Electron PID still alive');
    const expected = [...desktop.files.map(x => `app/dist/${x.path}`),
      ...runtime.files.map(x => `app/node_modules/@aijian/contracts/${x.path}`),
      'app/package.json', 'app/probe-electron.cjs'].sort();
    const actual = files(candidate).map(x => path.relative(candidate, x).replaceAll('\\','/')).sort();
    assert.deepEqual(actual, expected);
    receipt.candidateFiles = actual.map(name => { const file = path.join(candidate, name);
      return { path: name, bytes: fs.statSync(file).size, sha256: hash(file) }; });
    for (const item of desktop.files) assertFile(path.join(dist, item.path), item);
    for (const item of runtime.files) assertFile(path.join(contracts, item.path), item);
    assert.equal(hash(approval.desktopManifestPath), approval.desktopManifestSha256);
    assert.equal(hash(approval.contractsManifestPath), approval.contractsManifestSha256);
    receipt.state = 'ELECTRON_MAIN_MODULE_LOAD_PASS';
  } catch (error) {
    if (child && child.exitCode === null) {
      child.kill();
      if (closePromise) receipt.cleanup = await Promise.race([closePromise, wait(5000).then(() => ({ timeout: true }))]);
    }
    receipt.state = 'ELECTRON_MAIN_MODULE_LOAD_RED';
    receipt.error = String(error.stack ?? error);
  } finally {
    if (child) {
      receipt.stdoutPath = path.join(qa, 'ELECTRON.stdout.raw');
      receipt.stderrPath = path.join(qa, 'ELECTRON.stderr.raw');
      fs.writeFileSync(receipt.stdoutPath, Buffer.concat(out));
      fs.writeFileSync(receipt.stderrPath, Buffer.concat(err));
      receipt.stdoutSha256 = hash(receipt.stdoutPath);
      receipt.stderrSha256 = hash(receipt.stderrPath);
    }
    if (fs.existsSync(candidate) && !receipt.candidateFiles) {
      try { receipt.partialCandidateFiles = files(candidate).map(file => ({
        path: path.relative(candidate, file).replaceAll('\\', '/'),
        bytes: fs.statSync(file).size, sha256: hash(file) }));
      } catch (error) { receipt.candidateReadbackError = String(error); }
    }
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2)+'\n');
  }
  if (receipt.state !== 'ELECTRON_MAIN_MODULE_LOAD_PASS') process.exitCode = 1;
}
main().catch(error => { fs.writeFileSync(path.join(qa, 'PREFLIGHT-RED.json'),
  JSON.stringify({ at: new Date().toISOString(), error: String(error.stack ?? error) }, null, 2)+'\n');
  process.stderr.write(String(error.stack ?? error)+'\n'); process.exitCode = 1; });
