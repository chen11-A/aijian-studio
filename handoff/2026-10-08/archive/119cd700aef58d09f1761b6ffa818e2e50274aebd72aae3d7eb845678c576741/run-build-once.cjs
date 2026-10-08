// MGR02-signed one-shot build from frozen author inputs into this QA03 directory.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const qa = __dirname;
const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const sourceGate = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-contracts-runtime-cjs-source-gate-2/INPUTS.json';
const output = path.join(qa, 'runtime-output');
const marker = path.join(qa, 'RUN-STARTED.json');
const receiptPath = path.join(qa, 'RECEIPT.json');
const stdoutPath = path.join(qa, 'BUILD.stdout.raw');
const stderrPath = path.join(qa, 'BUILD.stderr.raw');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const sha = text => createHash('sha256').update(text).digest('hex').toUpperCase();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const norm = file => path.resolve(file).toLowerCase();
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trimEnd();
const statusSha = root => sha(git(root, 'status', '--porcelain', '-uall').replace(/\r\n/g, '\n'));
const relatedProcesses = () => {
  const query = 'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "(build-contracts-runtime\\.mjs|tsconfig\\.runtime\\.json)" } | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress';
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', query], { encoding: 'utf8' }).trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : [parsed]).sort((a, b) => a.ProcessId - b.ProcessId);
};
const expectedNames = [
  'package.json', 'generated.js', 'generated.d.ts', 'artifact-proposal.js',
  'artifact-proposal.d.ts', 'invalidation-operation.js', 'invalidation-operation.d.ts',
].sort();
function assertItem(file, item) {
  assert.ok(fs.lstatSync(file).isFile(), `Not a regular file: ${file}`);
  assert.equal(hash(file), item.sha256.toUpperCase(), `SHA drift: ${file}`);
  assert.equal(fs.statSync(file).size, item.bytes, `Byte drift: ${file}`);
}
function preflight(approval) {
  assert.equal(approval.schema, 'qa03.contracts-runtime-build.one-shot.approval.v1');
  assert.equal(approval.state, 'APPROVED_SINGLE_RUN');
  assert.equal(norm(approval.qaRoot), norm(qa));
  assert.equal(hash(__filename), approval.runnerSha256.toUpperCase());
  assert.equal(hash(sourceGate), '27B7EB69996B8B52011E3472E4A5FE5BA3C9D0A9778785DD1B4B2FBA1AFA9A4D');
  assert.equal(hash(process.execPath), approval.nodeSha256.toUpperCase());
  assert.ok(!fs.existsSync(output), 'Fresh runtime-output already exists');
  assert.ok(!fs.existsSync(marker) && !fs.existsSync(receiptPath), 'One-shot already used');
  // The separate c19 Web write window may change HEAD/status concurrently.
  // This gate hashes only the frozen contracts author inputs; c19 is observed below.
  const input = read(sourceGate);
  assert.equal(input.status, 'CJS_SOURCE_FROZEN_NOT_BUILT_NOT_SMOKED');
  assert.equal(input.dev01_review_sha256, '30EC1C21D01D5217D87AB38B71EA01C2331C8BF92E57B5A3B5D05C9EB99704F6');
  assert.equal(git(input.source_root, 'rev-parse', 'HEAD'), input.source_head);
  assert.deepEqual(relatedProcesses(), [], 'Related contracts build/tsc process already running');
  assert.equal(input.source_files.length, 11);
  assert.equal(input.primary_copies, 7);
  assert.equal(input.dependency_refs, 4);
  assert.deepEqual([...input.expected_runtime_files].sort(), expectedNames);
  assert.ok(!fs.existsSync(input.proposed_fresh_output_dir), 'MGR04 proposed output already exists');
  for (const item of input.source_files) {
    assert.ok(!path.isAbsolute(item.path) && !item.path.split(/[\\/]/).includes('..'));
    assertItem(path.join(input.source_root, item.path), item);
    if (item.copied) assertItem(path.join(input.source_copy_root, item.path), item);
  }
  const compiler = path.join(input.source_root, 'node_modules/typescript/bin/tsc');
  assert.equal(hash(compiler), '8D5FA5BD883FEC0979FC2004F1FE1D99AEF40570155D550EADC0B03B55513BF0');
  const tscShim = path.join(input.source_root, 'node_modules/typescript/lib/tsc.js');
  const tscCore = path.join(input.source_root, 'node_modules/typescript/lib/_tsc.js');
  assert.equal(hash(tscShim), approval.tscShimSha256.toUpperCase());
  assert.equal(hash(tscCore), approval.tscCoreSha256.toUpperCase());
  const script = path.join(input.source_root, 'scripts/build-contracts-runtime.mjs');
  assert.equal(hash(script), '9EE011623897973A56F796AD66CCA7A849801CA04420E428C7EA6FAE78D4E617');
  return { input, script, compiler, tscShim, tscCore };
}
function outputFiles() {
  if (!fs.existsSync(output)) return [];
  return fs.readdirSync(output, { withFileTypes: true }).map(entry => {
    const file = path.join(output, entry.name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      return { path: entry.name, kind: stat.isSymbolicLink() ? 'symlink' : 'non-file' };
    return { path: entry.name, bytes: stat.size, sha256: hash(file) };
  }).sort((a, b) => a.path.localeCompare(b.path));
}
function verifyPackage(files) {
  assert.deepEqual(files.map(x => x.path).sort(), expectedNames);
  assert.ok(files.every(x => x.kind === undefined), 'Unexpected output entry type');
  const pkg = read(path.join(output, 'package.json'));
  assert.deepEqual(pkg, {
    name: '@aijian/contracts', version: '0.1.0', private: true, type: 'commonjs',
    exports: {
      '.': { types: './generated.d.ts', require: './generated.js', import: './generated.js', default: './generated.js' },
      './artifact-proposal': { types: './artifact-proposal.d.ts', require: './artifact-proposal.js', import: './artifact-proposal.js', default: './artifact-proposal.js' },
      './invalidation-operation': { types: './invalidation-operation.d.ts', require: './invalidation-operation.js', import: './invalidation-operation.js', default: './invalidation-operation.js' },
    },
  });
  return pkg;
}
async function main() {
  const [flag, approvalFile, shaFlag, approvalSha] = process.argv.slice(2);
  assert.equal(flag, '--approval'); assert.equal(shaFlag, '--approval-sha256');
  assert.ok(approvalFile && /^[0-9a-f]{64}$/i.test(approvalSha ?? ''));
  assert.notEqual(norm(approvalFile), norm(path.join(qa, 'APPROVAL.template.json')));
  assert.equal(hash(approvalFile), approvalSha.toUpperCase());
  const approval = read(approvalFile);
  const { input, script, compiler, tscShim, tscCore } = preflight(approval);
  const authorStatusBefore = statusSha(input.source_root);
  const repoStatusBefore = statusSha(repo);
  const repoHeadBefore = git(repo, 'rev-parse', 'HEAD');
  const command = [process.execPath, script, '--out-dir', output];
  fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), command,
    approvalFile, approvalSha256: approvalSha.toUpperCase() }, null, 2) + '\n');
  const receipt = { schema: 'qa03.contracts-runtime-build.receipt.v1', state: 'UNKNOWN',
    startedAt: new Date().toISOString(), approvalSha256: approvalSha.toUpperCase(),
    sourceGateSha256: hash(sourceGate), dev01ReviewSha256: input.dev01_review_sha256,
    sourceHead: input.source_head, priorEsmSevenSha256: input.historical_esm_seven_sha256,
    authorStatusSha256Before: authorStatusBefore, repoStatusSha256Before: repoStatusBefore,
    repoHeadBefore,
    relatedProcessesBefore: relatedProcesses(),
    nodePath: process.execPath, nodeSha256: hash(process.execPath),
    scriptPath: script, scriptSha256: hash(script), compilerPath: compiler, compilerSha256: hash(compiler),
    tscShimSha256: hash(tscShim), tscCoreSha256: hash(tscCore), command, outputDir: output,
    inputCount: input.source_files.length, expectedFiles: expectedNames };
  try {
    const stdout = [], stderr = [];
    const env = { ...process.env, NODE_COMPILE_CACHE: path.join(qa, 'node-compile-cache') };
    const child = spawn(process.execPath, [script, '--out-dir', output], {
      cwd: input.source_root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    receipt.pid = child.pid;
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180000);
    const exit = await new Promise(resolve => {
      child.once('error', error => resolve({ code: null, signal: null, spawnError: String(error) }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timer);
    fs.writeFileSync(stdoutPath, Buffer.concat(stdout));
    fs.writeFileSync(stderrPath, Buffer.concat(stderr));
    receipt.exit = exit;
    receipt.timedOut = timedOut;
    receipt.stdoutSha256 = hash(stdoutPath);
    receipt.stderrSha256 = hash(stderrPath);
    receipt.outputFiles = outputFiles();
    assert.equal(exit.code, 0, 'Contracts runtime build exit nonzero');
    assert.equal(exit.signal, null, 'Contracts runtime build signal');
    assert.ok(!timedOut, 'Contracts runtime build timeout');
    receipt.packageIdentity = verifyPackage(receipt.outputFiles);
    for (const item of input.source_files) {
      assertItem(path.join(input.source_root, item.path), item);
      if (item.copied) assertItem(path.join(input.source_copy_root, item.path), item);
    }
    assert.equal(hash(sourceGate), receipt.sourceGateSha256, 'Frozen manifest drift');
    assert.equal(git(input.source_root, 'rev-parse', 'HEAD'), input.source_head, 'Author HEAD drift');
    assert.deepEqual(relatedProcesses(), [], 'Related contracts process remains after build');
    receipt.state = 'CONTRACTS_RUNTIME_ISOLATED_BUILD_PASS';
  } catch (error) {
    receipt.state = 'CONTRACTS_RUNTIME_ISOLATED_BUILD_RED';
    receipt.error = String(error.stack ?? error);
    if (!receipt.outputFiles) receipt.outputFiles = outputFiles();
  } finally {
    receipt.finishedAt = new Date().toISOString();
    receipt.authorStatusSha256After = statusSha(input.source_root);
    receipt.repoStatusSha256After = statusSha(repo);
    receipt.repoHeadAfter = git(repo, 'rev-parse', 'HEAD');
    receipt.relatedProcessesAfter = relatedProcesses();
    receipt.exitCode = receipt.state === 'CONTRACTS_RUNTIME_ISOLATED_BUILD_PASS' ? 0 : 1;
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
  if (receipt.exitCode !== 0) process.exitCode = 1;
}
main().catch(error => {
  fs.writeFileSync(path.join(qa, 'PREFLIGHT-RED.json'),
    JSON.stringify({ at: new Date().toISOString(), error: String(error.stack ?? error) }, null, 2) + '\n');
  process.stderr.write(String(error.stack ?? error) + '\n'); process.exitCode = 1;
});
