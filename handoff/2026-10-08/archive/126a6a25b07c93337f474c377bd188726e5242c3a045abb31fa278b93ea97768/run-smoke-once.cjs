// QA-only, one approved invocation. Never mutates c19 or a frozen snapshot.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const qa = __dirname;
const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const desktopManifest = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-release-desktop-runtime-38-1/FILES.json';
const sourceGate = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-contracts-runtime-cjs-source-gate-2/INPUTS.json';
const normalizedInput = path.join(qa, 'FROZEN-INPUT.json');
const marker = path.join(qa, 'RUN-STARTED.json');
const receiptPath = path.join(qa, 'RECEIPT.json');
const candidate = path.join(qa, 'candidate');
const app = path.join(candidate, 'app');
const dist = path.join(app, 'dist');
const packageRoot = path.join(app, 'node_modules', '@aijian', 'contracts');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const sha = str => createHash('sha256').update(str).digest('hex').toUpperCase();
const norm = file => path.resolve(file).toLowerCase();
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trimEnd();
const statusSha = () => sha(git('status', '--porcelain', '-uall').replace(/\r\n/g, '\n'));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const assertFile = (file, expected) => {
  assert.ok(fs.lstatSync(file).isFile(), `Not a regular file: ${file}`);
  assert.equal(hash(file), expected.sha256.toUpperCase(), `SHA drift: ${file}`);
  assert.equal(fs.statSync(file).size, expected.bytes, `Byte drift: ${file}`);
};
const copy = (from, to, item) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  assertFile(to, item);
};
const walk = folder => {
  const result = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full);
      assert.ok(!stat.isSymbolicLink(), `Symlink in candidate: ${full}`);
      if (stat.isDirectory()) visit(full);
      else { assert.ok(stat.isFile(), `Non-file in candidate: ${full}`); result.push(full); }
    }
  }
  visit(folder);
  return result.sort();
};

function preflight(approval) {
  assert.equal(approval.schema, 'qa03.contracts-runtime-cjs-smoke.one-shot.approval.v2');
  assert.equal(approval.state, 'APPROVED_SINGLE_RUN');
  assert.equal(norm(approval.qaRoot), norm(qa));
  assert.equal(hash(__filename), approval.runnerSha256.toUpperCase());
  assert.equal(hash(path.join(qa, 'probe-cjs.cjs')), approval.probeCjsSha256.toUpperCase());
  assert.equal(hash(path.join(qa, 'probe-esm.mjs')), approval.probeEsmSha256.toUpperCase());
  assert.equal(hash(path.join(qa, 'probe-esm-static.mjs')), approval.probeEsmStaticSha256.toUpperCase());
  assert.equal(hash(path.join(qa, 'probe-validators.cjs')), approval.probeValidatorsSha256.toUpperCase());
  assert.equal(hash(path.join(qa, 'probe-types.ts')), approval.probeTypesSha256.toUpperCase());
  assert.equal(hash(approval.compilerPath), approval.compilerSha256.toUpperCase());
  assert.equal(hash(process.execPath), approval.nodeSha256.toUpperCase());
  assert.equal(hash(normalizedInput), approval.normalizedInputSha256.toUpperCase());
  assert.equal(hash(path.join(qa, 'RUN-PACKET.json')), approval.packetSha256.toUpperCase());
  assert.equal(hash(desktopManifest), '227375AE5ED3AB42BD40BDDFD0694EDCE0B654C89B9D999399A68655BA9E369D');
  assert.equal(hash(sourceGate), '27B7EB69996B8B52011E3472E4A5FE5BA3C9D0A9778785DD1B4B2FBA1AFA9A4D');
  assert.ok(!fs.existsSync(candidate), 'Fresh candidate already exists');
  assert.ok(!fs.existsSync(marker) && !fs.existsSync(receiptPath), 'One-shot already started');
  const input = read(normalizedInput);
  assert.equal(input.schema, 'qa03.contracts-runtime-cjs-smoke.frozen-input.v2');
  assert.equal(input.contractsManifestSha256, '6B45D6193436A9E8ED63CB9067AB5306F8653A5F53367B7266B8FC35831C9368');
  assert.equal(hash(input.contractsManifestPath), input.contractsManifestSha256.toUpperCase());
  assert.equal(hash(input.sourceBuildReceiptPath), input.sourceBuildReceiptSha256.toUpperCase());
  assert.equal(norm(input.desktopManifestPath), norm(desktopManifest));
  assert.equal(input.desktopManifestSha256, hash(desktopManifest));
  const frozen = read(input.contractsManifestPath);
  assert.equal(frozen.status, 'QA03_CJS_ISOLATED_BUILD_ACCEPTED_RUNTIME_SEVEN_FROZEN_LOAD_NOT_RUN');
  assert.equal(frozen.source_receipt_sha256, 'BA89D2644C8521AB7815980FA0E28D51682185F19C1492DDB781D464E2401F69');
  assert.equal(norm(input.contractsRoot), norm(frozen.frozen_runtime_dir));
  assert.deepEqual(input.runtimeFiles, frozen.files);
  const contractNames = [
    'package.json', 'generated.js', 'generated.d.ts', 'artifact-proposal.js',
    'artifact-proposal.d.ts', 'invalidation-operation.js', 'invalidation-operation.d.ts',
  ].sort();
  assert.deepEqual(input.runtimeFiles.map(x => x.path).sort(), contractNames);
  assert.equal(input.runtimeFiles.length, 7);
  const desktop = read(desktopManifest);
  assert.equal(desktop.file_count, 38);
  assert.equal(desktop.files.length, 38);
  assert.equal(norm(input.desktopDist), norm(desktop.frozen_dist));
  const desktopPaths = new Set();
  for (const item of desktop.files) {
    assert.ok(!path.isAbsolute(item.path) && !item.path.split(/[\\/]/).includes('..'));
    assert.ok(!desktopPaths.has(item.path)); desktopPaths.add(item.path);
    assertFile(path.join(input.desktopDist, item.path), item);
  }
  const contractPaths = new Set();
  for (const item of input.runtimeFiles) {
    assert.ok(contractNames.includes(item.path) && !contractPaths.has(item.path));
    contractPaths.add(item.path);
    assertFile(path.join(input.contractsRoot, item.path), item);
  }
  assert.deepEqual(walk(input.contractsRoot).map(file => path.relative(input.contractsRoot, file).replaceAll('\\', '/')).sort(), contractNames);
  const pkg = read(path.join(input.contractsRoot, 'package.json'));
  assert.equal(pkg.name, '@aijian/contracts');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.type, 'commonjs');
  for (const key of ['.', './artifact-proposal', './invalidation-operation']) {
    for (const condition of ['types', 'require', 'import', 'default']) assert.ok(pkg.exports?.[key]?.[condition], `Missing ${key} ${condition}`);
  }
  for (const key of ['.', './artifact-proposal', './invalidation-operation']) assert.ok(pkg.exports?.[key], `Missing export ${key}`);
  return { input, desktop, packageIdentity: pkg };
}

async function runCase(name, args, cwd, timeoutMs = 15000) {
  const stdoutPath = path.join(qa, `${name}.stdout.raw`);
  const stderrPath = path.join(qa, `${name}.stderr.raw`);
  const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [], err = [];
  child.stdout.on('data', chunk => out.push(chunk));
  child.stderr.on('data', chunk => err.push(chunk));
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  const result = await new Promise(resolve => {
    child.once('error', error => resolve({ code: null, signal: null, spawnError: String(error) }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  fs.writeFileSync(stdoutPath, Buffer.concat(out));
  fs.writeFileSync(stderrPath, Buffer.concat(err));
  return { name, pid: child.pid, args, cwd, ...result, timedOut,
    stdoutPath, stdoutSha256: hash(stdoutPath), stderrPath, stderrSha256: hash(stderrPath) };
}

async function main() {
  const [flag, approvalFile, shaFlag, approvalSha] = process.argv.slice(2);
  assert.equal(flag, '--approval'); assert.equal(shaFlag, '--approval-sha256');
  assert.ok(approvalFile && /^[0-9a-f]{64}$/i.test(approvalSha ?? ''));
  assert.notEqual(norm(approvalFile), norm(path.join(qa, 'APPROVAL.template.json')));
  assert.equal(hash(approvalFile), approvalSha.toUpperCase(), 'Approval SHA drift');
  const approved = read(approvalFile);
  const { input, desktop, packageIdentity } = preflight(approved);
  const statusBefore = statusSha();
  fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), approvalFile,
    approvalSha256: approvalSha.toUpperCase(), runnerSha256: hash(__filename) }, null, 2) + '\n');
  const receipt = { schema_version: 2, result: 'UNKNOWN', startedAt: new Date().toISOString(),
    executionRuntime: 'Node.js', electronExecution: 'NOT_RUN', stageExecution: 'NOT_RUN',
    approval_sha256: approvalSha.toUpperCase(), candidate_head: git('rev-parse', 'HEAD'),
    repoStatusSha256Before: statusBefore, desktopManifestSha256: hash(desktopManifest),
    contractsManifestSha256: hash(input.contractsManifestPath), normalizedInputSha256: hash(normalizedInput),
    desktop_main_sha256: desktop.files.find(x => x.path === 'main.js').sha256,
    contracts_package_sha256: input.runtimeFiles.find(x => x.path === 'package.json').sha256,
    contracts_artifact_js_sha256: input.runtimeFiles.find(x => x.path === 'artifact-proposal.js').sha256,
    contracts_invalidation_js_sha256: input.runtimeFiles.find(x => x.path === 'invalidation-operation.js').sha256,
    packageIdentity: { name: packageIdentity.name, version: packageIdentity.version,
      type: packageIdentity.type, exports: packageIdentity.exports }, candidatePath: candidate, cases: [] };
  try {
    for (const item of desktop.files) copy(path.join(input.desktopDist, item.path), path.join(dist, item.path), item);
    for (const item of input.runtimeFiles) copy(path.join(input.contractsRoot, item.path), path.join(packageRoot, item.path), item);
    fs.copyFileSync(path.join(qa, 'probe-esm.mjs'), path.join(app, 'probe-esm.mjs'), fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(path.join(qa, 'probe-types.ts'), path.join(app, 'probe-types.ts'), fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(path.join(qa, 'probe-esm-static.mjs'), path.join(app, 'probe-esm-static.mjs'), fs.constants.COPYFILE_EXCL);
    assert.equal(hash(path.join(app, 'probe-esm.mjs')), hash(path.join(qa, 'probe-esm.mjs')));
    assert.equal(hash(path.join(app, 'probe-types.ts')), hash(path.join(qa, 'probe-types.ts')));
    assert.equal(hash(path.join(app, 'probe-esm-static.mjs')), hash(path.join(qa, 'probe-esm-static.mjs')));
    const cjsCases = [
      ['api-client.js', '@aijian/contracts/invalidation-operation', 'validateInvalidationOperationPageQuery'],
      ['artifact-proposal-contract.js', '@aijian/contracts/artifact-proposal', 'isArtifactProposalResponse'],
      ['invalidation-operation-ipc.js', '@aijian/contracts/invalidation-operation', 'validateInvalidationOperationPageQuery'],
      ['remote-source-extract-v2-contract.js', '@aijian/contracts/artifact-proposal', 'isArtifactProposalResponse'],
    ];
    for (const [consumer, specifier, symbol] of cjsCases) {
      const result = await runCase(`CJS-${consumer.replace(/\.js$/, '')}`,
        [path.join(qa, 'probe-cjs.cjs'), candidate, consumer, specifier, symbol], app);
      receipt.cases.push(result);
      assert.ok(result.code === 0 && !result.timedOut && !result.spawnError,
        `First RED at ${result.name}; remaining cases NOT_RUN`);
    }
    const esmCases = [
      ['root', '@aijian/contracts', ''],
      ['artifact', '@aijian/contracts/artifact-proposal', 'isArtifactProposalResponse'],
      ['invalidation', '@aijian/contracts/invalidation-operation', 'validateInvalidationOperationPageQuery'],
    ];
    for (const [name, specifier, symbol] of esmCases) {
      const result = await runCase(`ESM-${name}`,
        [path.join(app, 'probe-esm.mjs'), specifier, symbol], app);
      receipt.cases.push(result);
      assert.ok(result.code === 0 && !result.timedOut && !result.spawnError,
        `First RED at ${result.name}; remaining cases NOT_RUN`);
    }
    const esmStatic = await runCase('ESM-STATIC-NAMED', [path.join(app, 'probe-esm-static.mjs')], app);
    receipt.cases.push(esmStatic);
    assert.ok(esmStatic.code === 0 && !esmStatic.timedOut && !esmStatic.spawnError, 'First RED at static ESM imports; validators NOT_RUN');
    const validator = await runCase('VALIDATORS-4x2', [path.join(qa, 'probe-validators.cjs'), app], app);
    receipt.cases.push(validator);
    assert.ok(validator.code === 0 && !validator.timedOut && !validator.spawnError, 'First RED at validators; types NOT_RUN');
    const types = await runCase('TYPES-3-EXPORTS', [approved.compilerPath, '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', path.join(app, 'probe-types.ts')], app, 120000);
    receipt.cases.push(types);
    assert.ok(types.code === 0 && !types.timedOut && !types.spawnError, 'First RED at d.ts resolution');
    for (const item of desktop.files) assertFile(path.join(dist, item.path), item);
    for (const item of input.runtimeFiles) assertFile(path.join(packageRoot, item.path), item);
    const all = walk(candidate).map(file => path.relative(candidate, file).replaceAll('\\', '/')).sort();
    const expected = [...desktop.files.map(x => `app/dist/${x.path.replaceAll('\\', '/')}`),
      ...input.runtimeFiles.map(x => `app/node_modules/@aijian/contracts/${x.path}`), 'app/probe-esm.mjs', 'app/probe-types.ts', 'app/probe-esm-static.mjs'].sort();
    assert.deepEqual(all, expected, 'Candidate unexpected/missing file');
    receipt.candidateFiles = all.map(name => { const file = path.join(candidate, name);
      return { path: name, bytes: fs.statSync(file).size, sha256: hash(file) }; });
    assert.equal(hash(desktopManifest), receipt.desktopManifestSha256);
    assert.equal(hash(input.contractsManifestPath), receipt.contractsManifestSha256);
    receipt.result = receipt.cases.every(x => x.code === 0 && !x.timedOut && !x.spawnError)
      ? 'CONTRACTS_CJS_ESM_SMOKE_PASS' : 'CONTRACTS_CJS_ESM_SMOKE_RED';
  } catch (error) {
    receipt.result = 'CONTRACTS_CJS_ESM_SMOKE_RED';
    receipt.error = String(error.stack ?? error);
    if (fs.existsSync(candidate)) {
      try { receipt.candidateFiles = walk(candidate).map(file => ({
        path: path.relative(candidate, file).replaceAll('\\', '/'),
        bytes: fs.statSync(file).size, sha256: hash(file),
      })); } catch (treeError) { receipt.candidateTreeError = String(treeError); }
    }
  } finally {
    receipt.finishedAt = new Date().toISOString();
    receipt.exit_code = receipt.result === 'CONTRACTS_CJS_ESM_SMOKE_PASS' ? 0 : 1;
    receipt.repoStatusSha256After = statusSha();
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
  if (receipt.exit_code !== 0) process.exitCode = 1;
}

main().catch(error => { fs.writeFileSync(path.join(qa, 'PREFLIGHT-RED.json'),
  JSON.stringify({ at: new Date().toISOString(), error: String(error.stack ?? error) }, null, 2) + '\n');
  process.stderr.write(String(error.stack ?? error) + '\n'); process.exitCode = 1; });
