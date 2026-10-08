// QA03 one-shot isolated sidecar build; acquisition tree is read-only.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const qa = __dirname;
const run = path.join(qa, 'run-01');
const acq = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/tool-review/sidecar-py312-win-x64-1';
const handoff = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs';
const uv = 'C:/Users/Administrator/AppData/Local/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe/uv.exe';
const basePython = path.join(acq, 'python-base/python/python.exe');
const venvPython = path.join(run, 'venv/Scripts/python.exe');
const probe = 'C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa03-project-name-source-20260928/backend-exe-consumer-view-v1/probe-readonly.py';
const guard = path.join(qa, 'build-guard.py');
const receiptPath = path.join(run, 'RECEIPT.json');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const norm = file => path.resolve(file).toLowerCase();
const strictFile = file => { const item = fs.lstatSync(file); assert.ok(item.isFile() && !item.isSymbolicLink(), `not regular: ${file}`); };
const pins = {
  request: ['rel02-minimal-sidecar-build-acquisition-request-20260928-v2.json', '490B20DF6734A969ABF47ECB45B4FDBC68DF91B64B47DDB67B118CDBD36CC223'],
  status: ['tool-review/sidecar-py312-win-x64-1/REL02-STATUS-LATEST.json', '15FF682C7937CC8FCC69AA10D593BC75D0DA28146C163263CACF4DCF69413FC4'],
  acquisition: ['tool-review/sidecar-py312-win-x64-1/acquisition-receipt.json', '7FC29A7C570A32519429B26A240AD82AD3037D0AEFF862C8A68D44282885E464'],
  base: ['tool-review/sidecar-py312-win-x64-1/python-base-inventory.json', '202F2DAB56F82C3ACB7A46E3D92C2F54C28A8BCF40151E49ACE60A413FC3CF28'],
  source: ['tool-review/sidecar-py312-win-x64-1/source-freeze-receipt.json', '7376390D93A9BF55E155C160480D6C83CFBCBB5D8EB3752FC3103C1FAA5CAB86'],
  wheelLicenses: ['tool-review/sidecar-py312-win-x64-1/wheel-license-inventory.json', 'CF8266C435E1846A49CDE6FF44C362F60B96E7D9AD943B200B4DF80F013A3373'],
  baseLicenses: ['tool-review/sidecar-py312-win-x64-1/python-base-licenses.json', '93B6E3FDBDEC09991F67F900325F8E6B894C9075223EAF4B4FE7FB47A0C8B1D8'],
  audit: ['release-snapshots/20260928-python-base-dual-view-audit-1/RESULT.json', '4CD14C3D8CB92C2C5DFDF394FB46B403085270F2828D14D68F55979DB1263BB2'],
  psView: ['tool-review/sidecar-py312-win-x64-1/powershell-base-view.json', '00047B90E2D9A2C84D56B56CDD8C64EEDEEA2E87F094D75F6089EC46CB26A1EF'],
  pythonView: ['tool-review/sidecar-py312-win-x64-1/python-process-view.json', '7D4909630E8BA6788A37AFCF794719BE8F83E1E9E890C5DEEAE04E9CD60B3703'],
};
const pinPath = name => path.join(handoff, pins[name][0]);

function peMachine(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString('ascii', 0, 2), 'MZ');
  const off = data.readUInt32LE(0x3c);
  assert.equal(data.toString('ascii', off, off + 4), 'PE\0\0');
  return `0x${data.readUInt16LE(off + 4).toString(16).toUpperCase()}`;
}
function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).map(item => {
    assert.ok(item.isFile() && !item.isSymbolicLink(), `unexpected directory/link: ${item.name}`);
    return item.name;
  }).sort();
}
function preflight(approval) {
  assert.equal(approval.schema, 'qa03.sidecar-build.one-shot.approval.v1');
  assert.equal(approval.state, 'APPROVED_SINGLE_RUN');
  assert.equal(norm(approval.qaRoot), norm(qa));
  assert.equal(hash(path.join(qa, 'RUN-PACKET.json')), approval.packetSha256);
  assert.equal(hash(__filename), approval.runnerSha256);
  assert.equal(hash(probe), approval.probeSha256);
  assert.equal(hash(guard), approval.guardSha256);
  assert.equal(hash(path.join(qa, 'requirements.hashes.expected.txt')), approval.requirementsSha256);
  assert.equal(hash(process.execPath), approval.nodeSha256);
  assert.equal(hash(uv), approval.uvSha256);
  assert.equal(hash(basePython), approval.basePythonSha256);
  assert.equal(peMachine(basePython), '0x8664');
  assert.ok(!fs.existsSync(run), 'one-shot run directory already exists');
  for (const [name, [relative, expected]] of Object.entries(pins)) {
    assert.match(expected, /^[0-9A-F]{64}$/, `invalid pin length/format: ${name}`);
    const file = path.join(handoff, relative); strictFile(file);
    assert.equal(hash(file), expected, `receipt SHA drift: ${name}`);
  }
  const request = read(pinPath('request'));
  const acquisition = read(pinPath('acquisition'));
  const source = read(pinPath('source'));
  const base = read(pinPath('base'));
  const wheels = request.wheels;
  assert.equal(request.counts.unique_acquisition_items, 32);
  assert.equal(request.counts.published_total_bytes, 29081508);
  assert.equal(wheels.length, 31);
  assert.equal(new Set(wheels.map(w => w.filename)).size, 31);
  assert.equal(new Set(wheels.map(w => w.name.toLowerCase())).size, 31);
  assert.equal(acquisition.verified.length, 32);
  assert.equal(source.frozen_unique_file_count, 194);
  assert.equal(source.files.length, 194);
  assert.equal(base.file_count, 3318);
  assert.equal(base.files.length, 3318);
  assert.equal(base.python_exe_sha256, approval.basePythonSha256);
  assert.equal(norm(source.frozen_root), norm(path.join(acq, 'source')));
  assert.equal(norm(base.root), norm(path.join(acq, 'python-base/python')));
  const wheelhouse = path.join(acq, 'wheelhouse');
  assert.deepEqual(listFiles(wheelhouse), wheels.map(w => w.filename).sort());
  const verification = new Map(acquisition.verified.map(item => [item.filename, item]));
  for (const wheel of wheels) {
    const file = path.join(wheelhouse, wheel.filename); strictFile(file);
    assert.equal(fs.statSync(file).size, wheel.bytes);
    assert.equal(hash(file), wheel.sha256.toUpperCase(), `uv wheel bytes drift: ${wheel.filename}`);
    const prior = verification.get(wheel.filename);
    assert.ok(prior && prior.sha256 === wheel.sha256.toUpperCase() && prior.bytes === wheel.bytes);
    assert.ok(wheel.license && wheel.version && wheel.name);
  }
  const archive = request.python_archive;
  const archiveFile = path.join(acq, 'python-archive', archive.filename);
  assert.deepEqual(listFiles(path.dirname(archiveFile)), [archive.filename]);
  strictFile(archiveFile);
  assert.equal(fs.statSync(archiveFile).size, archive.bytes);
  assert.equal(hash(archiveFile), archive.sha256.toUpperCase());
  const priorArchive = verification.get(archive.filename);
  assert.ok(priorArchive && priorArchive.sha256 === archive.sha256.toUpperCase());
  const wheelLicenses = read(pinPath('wheelLicenses'));
  const baseLicenses = read(pinPath('baseLicenses'));
  assert.equal(wheelLicenses.wheel_count, 31);
  assert.equal(wheelLicenses.license_file_count, 51);
  assert.equal(baseLicenses.license_file_count, 44);
  const audit = read(pinPath('audit'));
  assert.equal(audit.powershell_raw_mismatch_count, 1062);
  assert.equal(audit.python_read_bytes_mismatch_count, 0);
  return { request, wheels };
}

function fixedEnv() {
  const env = { ...process.env, UV_OFFLINE: '1', UV_NO_CONFIG: '1',
    UV_CACHE_DIR: path.join(run, 'uv-cache'),
    PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    PYINSTALLER_CONFIG_DIR: path.join(run, 'pyinstaller-config'),
    TEMP: path.join(run, 'temp'), TMP: path.join(run, 'temp'),
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
    ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: '' };
  delete env.PYTHONPATH; delete env.PIP_INDEX_URL; delete env.PIP_EXTRA_INDEX_URL;
  delete env.UV_INDEX_URL; delete env.UV_DEFAULT_INDEX; delete env.UV_EXTRA_INDEX_URL;
  delete env.UV_FIND_LINKS; delete env.UV_PYTHON;
  delete env.VIRTUAL_ENV; delete env.PYTHONHOME;
  return env;
}
function ownedProcesses(pid) {
  const target = run.replaceAll("'", "''");
  const script = `Get-CimInstance Win32_Process | Where-Object { ` +
    `($_.ProcessId -eq ${pid} -or $_.ParentProcessId -eq ${pid} -or ` +
    `($_.CommandLine -like '*${target}*' -and $_.Name -in @('python.exe','uv.exe','pyinstaller.exe'))) ` +
    `-and $_.ProcessId -ne $PID } | ` +
    `Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script],
    { encoding: 'utf8', timeout: 15000 }).trim();
  return raw ? [JSON.parse(raw)].flat() : [];
}
async function command(name, exe, args, timeoutMs, receipt) {
  const outFile = path.join(run, `${name}.stdout.raw`);
  const errFile = path.join(run, `${name}.stderr.raw`);
  const started = new Date().toISOString();
  const child = spawn(exe, args, { cwd: run, env: fixedEnv(), windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [], stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  let timer, timedOut = false, timeoutCleanup = null;
  const close = await new Promise(resolve => {
    child.once('error', error => resolve({ code: null, signal: null, error: String(error) }));
    child.once('close', (code, signal) => resolve({ code, signal }));
    timer = setTimeout(() => {
      timedOut = true;
      if (Number.isSafeInteger(child.pid) && child.pid > 0) {
        try {
          const raw = execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
            { encoding: 'utf8', timeout: 10000 });
          timeoutCleanup = { command: 'taskkill /PID /T /F', pid: child.pid, stdout: raw };
        } catch (error) {
          timeoutCleanup = { command: 'taskkill /PID /T /F', pid: child.pid,
            error: String(error), stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
        }
      }
      child.kill();
      setTimeout(() => resolve({ code: null, signal: null, error: 'timeout close not observed' }), 5000);
    }, timeoutMs);
  });
  clearTimeout(timer);
  fs.writeFileSync(outFile, Buffer.concat(stdout));
  fs.writeFileSync(errFile, Buffer.concat(stderr));
  const record = { name, executable: exe, arguments: args, cwd: run, pid: child.pid,
    startedAt: started, finishedAt: new Date().toISOString(), exit: close,
    timedOut, timeoutCleanup,
    environmentControls: { UV_OFFLINE: '1', UV_NO_CONFIG: '1',
      UV_CACHE_DIR: path.join(run, 'uv-cache'), PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1', TEMP: path.join(run, 'temp'),
      TMP: path.join(run, 'temp') },
    stdoutPath: outFile, stdoutSha256: hash(outFile), stderrPath: errFile,
    stderrSha256: hash(errFile) };
  if (Number.isSafeInteger(child.pid) && child.pid > 0) {
    try { record.postCloseProcesses = ownedProcesses(child.pid); }
    catch (error) { record.postCloseProcessCheckError = String(error.stack ?? error); }
  }
  receipt.commands.push(record);
  fs.writeFileSync(path.join(run, 'PROGRESS.json'), JSON.stringify(receipt, null, 2) + '\n');
  assert.equal(timedOut, false, `${name} timed out`);
  assert.equal(record.postCloseProcessCheckError, undefined, `${name} process close check failed`);
  assert.equal(record.postCloseProcesses?.length ?? 0, 0, `${name} left owned processes`);
  assert.equal(close.code, 0, `${name} failed: ${JSON.stringify(close)}`);
  return record;
}

async function main() {
  const [flag, approvalFile, shaFlag, approvalSha] = process.argv.slice(2);
  assert.equal(flag, '--approval'); assert.equal(shaFlag, '--approval-sha256');
  assert.ok(approvalFile && /^[0-9a-f]{64}$/i.test(approvalSha ?? ''));
  assert.notEqual(norm(approvalFile), norm(path.join(qa, 'APPROVAL.template.json')));
  assert.equal(hash(approvalFile), approvalSha.toUpperCase());
  const approval = read(approvalFile);
  const { wheels } = preflight(approval);
  fs.mkdirSync(run);
  for (const name of ['temp', 'uv-cache', 'pyinstaller-config'])
    fs.mkdirSync(path.join(run, name));
  fs.writeFileSync(path.join(run, 'RUN-STARTED.json'), JSON.stringify({
    at: new Date().toISOString(), approvalFile, approvalSha256: approvalSha.toUpperCase(),
    runnerSha256: hash(__filename) }, null, 2) + '\n', { flag: 'wx' });
  const receipt = { schema: 'qa03.sidecar-build.receipt.v1', state: 'UNKNOWN',
    startedAt: new Date().toISOString(), approvalSha256: approvalSha.toUpperCase(),
    acquisitionRoot: acq, acquisitionWrite: 'NOT_RUN', c19Write: 'NOT_RUN',
    provider: 'NOT_RUN', installer: 'NOT_RUN', exeRuntime: 'NOT_RUN',
    preservedPowerShellViewSha256: pins.psView[1],
    preservedPythonViewSha256: pins.pythonView[1], commands: [] };
  try {
    const reqFile = path.join(run, 'requirements.hashes.txt');
    const lines = wheels.slice().sort((a,b) => a.name.localeCompare(b.name))
      .map(w => `${w.name}==${w.version} --hash=sha256:${w.sha256.toLowerCase()}`);
    fs.writeFileSync(reqFile, lines.join('\n') + '\n', { flag: 'wx' });
    receipt.requirementsSha256 = hash(reqFile);
    assert.equal(lines.length, 31);
    assert.equal(receipt.requirementsSha256, approval.requirementsSha256,
      'derived 31-wheel hash requirements drift');
    await command('01-extracted-python-view', basePython, ['-I', '-B', probe], 120000, receipt);
    const baseView = read(path.join(run, '01-extracted-python-view.stdout.raw'));
    assert.equal(baseView.state, 'EXTRACTED_PYTHON_CONSUMER_VIEW_PASS');
    assert.equal(baseView.base.count, 3318); assert.equal(baseView.source.count, 194);
    receipt.extractedPythonView = { pid: baseView.pid, executable: baseView.sys_executable,
      baseFingerprint: baseView.base.observed_fingerprint,
      sourceFingerprint: baseView.source.observed_fingerprint };
    await command('02-uv-venv', uv,
      ['venv', '--no-project', '--offline', '--python', basePython, path.join(run, 'venv')], 180000, receipt);
    assert.ok(fs.existsSync(venvPython));
    await command('03-uv-pip-sync', uv,
      ['pip', 'sync', '--require-hashes', '--strict', '--no-build', '--offline', '--no-index',
       '--find-links', path.join(acq, 'wheelhouse'), '--python', venvPython, reqFile], 300000, receipt);
    await command('04-uv-pip-check', uv, ['pip', 'check', '--offline', '--python', venvPython], 120000, receipt);
    const venvProbe = path.join(run, 'VENV-PROBE.json');
    await command('05-venv-probe', venvPython,
      ['-I', '-B', guard, 'probe', venvProbe, run], 180000, receipt);
    assert.equal(read(venvProbe).state, 'VENV_PROBE_PASS');
    receipt.venvProbeSha256 = hash(venvProbe);
    const buildGuard = path.join(run, 'BUILD-GUARD.json');
    await command('06-pyinstaller-build', venvPython,
      ['-I', '-B', guard, 'build', buildGuard, run], 900000, receipt);
    const build = read(buildGuard);
    assert.equal(build.state, 'GUARDED_BUILD_PASS');
    receipt.buildGuardSha256 = hash(buildGuard);
    assert.equal(build.pre.base_view.fingerprint, build.post.base_view.fingerprint);
    assert.equal(build.pre.source_view.fingerprint, build.post.source_view.fingerprint);
    assert.deepEqual(build.pre.dependencies, build.post.dependencies);
    assert.equal(build.pre.dependencies.count, 31);
    const dist = path.join(run, 'dist');
    assert.deepEqual(listFiles(dist), ['aijian-sidecar.exe']);
    const exe = path.join(dist, 'aijian-sidecar.exe');
    strictFile(exe);
    assert.equal(hash(exe), build.artifact.sha256);
    assert.equal(fs.statSync(exe).size, build.artifact.bytes);
    assert.equal(peMachine(exe), '0x8664');
    receipt.artifact = { path: exe, sha256: hash(exe), bytes: fs.statSync(exe).size,
      peMachine: '0x8664' };
    for (const [name, [relative, expected]] of Object.entries(pins))
      assert.equal(hash(path.join(handoff, relative)), expected, `post-run receipt drift: ${name}`);
    receipt.state = 'EXE_BUILD_ONLY_PASS';
  } catch (error) {
    receipt.state = 'EXE_BUILD_RED';
    receipt.error = String(error.stack ?? error);
  } finally {
    receipt.finishedAt = new Date().toISOString();
    receipt.exitCode = receipt.state === 'EXE_BUILD_ONLY_PASS' ? 0 : 1;
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
  if (receipt.exitCode !== 0) process.exitCode = 1;
}
main().catch(error => {
  fs.writeFileSync(path.join(qa, 'PREFLIGHT-RED.json'),
    JSON.stringify({ at: new Date().toISOString(), error: String(error.stack ?? error) }, null, 2) + '\n');
  process.stderr.write(String(error.stack ?? error) + '\n'); process.exitCode = 1;
});
