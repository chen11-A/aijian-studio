// One authorized invocation only. All writes stay under this QA03 directory.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const snapshot = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-dev07-release-desktop-config-1/SNAPSHOT.json';
const configPath = path.join(root, 'tsconfig.release.json');
const sourcePath = path.join(root, 'SOURCE.json');
const dist = path.join(root, 'dist');
const tsc = path.join(repo, 'apps/desktop/node_modules/typescript/bin/tsc');
const typescript = require(path.join(repo, 'apps/desktop/node_modules/typescript'));
const markerPath = path.join(root, 'RUN-STARTED.json');
const receiptPath = path.join(root, 'RECEIPT.json');
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const sha = (s) => createHash('sha256').update(s).digest('hex').toUpperCase();
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trimEnd();
const statusSha = () => sha(git('status', '--porcelain', '-uall').replace(/\r\n/g, '\n'));
const norm = (file) => path.resolve(file).toLowerCase();
const files = (dir) => {
  const found = [];
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      const stat = fs.lstatSync(full);
      assert.ok(!stat.isSymbolicLink(), `Symlink in output: ${full}`);
      if (stat.isDirectory()) visit(full);
      else { assert.ok(stat.isFile(), `Non-file in output: ${full}`); found.push(full); }
    }
  }
  visit(dir);
  return found.sort((a, b) => a.localeCompare(b));
};

function verifyInputs(approval) {
  assert.equal(approval.schema, 'qa03.release-desktop.one-shot.approval.v1');
  assert.equal(approval.state, 'APPROVED_SINGLE_RUN');
  assert.equal(norm(approval.qaRoot), norm(root));
  assert.equal(approval.runnerSha256.toUpperCase(), hash(__filename));
  assert.equal(approval.snapshotSha256.toUpperCase(), hash(snapshot));
  assert.equal(hash(snapshot), '8F8CD22912410E0A3AF414A0AC3651B0EB1E7C3DE9199EE2818F55A972CEF8BA');
  assert.equal(hash(configPath), '78A912423D648016FED26B823D2C182E42A97F6A459745D2AAFCE4435EAA9062');
  assert.equal(hash(sourcePath), '5EDB58F5841731B5DFC1679C14BA623810809A86C62DBD43A4D6BB87F00CC27A');
  assert.equal(hash(tsc), '8D5FA5BD883FEC0979FC2004F1FE1D99AEF40570155D550EADC0B03B55513BF0');
  assert.equal(approval.nodeSha256.toUpperCase(), hash(process.execPath));
  assert.equal(git('rev-parse', 'HEAD'), '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2');
  assert.equal(statusSha(), approval.repoStatusSha256.toUpperCase(), 'c19 Git status drift');
  assert.ok(!fs.existsSync(dist), 'Fresh QA dist must not exist');
  assert.ok(!fs.existsSync(markerPath), 'One-shot marker already exists');
  assert.ok(!fs.existsSync(receiptPath), 'Receipt already exists');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  assert.equal(source.status, 'RELEASE_TSCONFIG_SOURCE_FROZEN_NOT_BUILT');
  assert.equal(source.source_head, git('rev-parse', 'HEAD'));
  assert.equal(source.desktop_sources.length, 57);
  assert.equal(source.contract_sources.length, 3);
  assert.equal(source.dependency_files.length, 8);
  const inputs = [...source.desktop_sources, ...source.contract_sources, ...source.dependency_files];
  assert.equal(new Set(inputs.map(x => norm(x.path))).size, 68);
  for (const item of inputs) {
    assert.equal(hash(item.path), item.sha256.toUpperCase(), `SHA drift: ${item.path}`);
    if (item.bytes !== undefined) assert.equal(fs.statSync(item.path).size, item.bytes, `Byte drift: ${item.path}`);
  }
  const cfg = typescript.readConfigFile(configPath, typescript.sys.readFile);
  assert.equal(cfg.error, undefined, 'Cannot parse release config');
  const parsed = typescript.parseJsonConfigFileContent(cfg.config, typescript.sys, root, undefined, configPath);
  assert.equal(parsed.errors.length, 0, 'Release config diagnostics');
  assert.equal(norm(parsed.options.outDir), norm(dist), 'Release output not in QA03 folder');
  assert.deepEqual(parsed.fileNames.map(norm).sort(), source.entrypoints.map(name => norm(path.join(repo, 'apps/desktop/src', name))).sort());
  return { source, parsed, inputs };
}

function verifyOutput(parsed) {
  assert.ok(fs.existsSync(dist), 'No dist emitted');
  const emitted = files(dist);
  assert.ok(emitted.length > 0, 'Empty dist');
  const rels = emitted.map(file => path.relative(dist, file).replaceAll('\\', '/'));
  for (const name of ['main.js', 'preload.js']) assert.ok(rels.includes(name), `Missing ${name}`);
  for (const rel of rels) {
    assert.match(rel, /\.js$/i, `Unexpected output type: ${rel}`);
    assert.ok(!/(^|\/)(__tests__\/|[^/]*\.(?:test|spec)\.[cm]?js$|[^/]*test-fixture\.[cm]?js$)/i.test(rel), `Test output: ${rel}`);
  }
  const program = typescript.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = typescript.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, 'Post-build TypeScript diagnostics');
  const srcRoot = norm(parsed.options.rootDir) + path.sep;
  const runtimeSources = program.getSourceFiles().filter(sf => !sf.isDeclarationFile && norm(sf.fileName).startsWith(srcRoot));
  const expected = runtimeSources.map(sf => path.relative(parsed.options.rootDir, sf.fileName)
    .replaceAll('\\', '/').replace(/\.tsx?$/i, '.js')).sort();
  assert.deepEqual([...rels].sort(), expected, 'Output differs from TypeScript runtime source closure');
  let relativeImports = 0;
  for (const file of emitted) {
    const content = fs.readFileSync(file, 'utf8');
    const ast = typescript.createSourceFile(file, content, typescript.ScriptTarget.ES2022, true, typescript.ScriptKind.JS);
    function visit(node) {
      if (typescript.isCallExpression(node) && node.arguments.length === 1 &&
          typescript.isStringLiteral(node.arguments[0]) &&
          ((typescript.isIdentifier(node.expression) && node.expression.text === 'require') ||
           node.expression.kind === typescript.SyntaxKind.ImportKeyword)) {
        const spec = node.arguments[0].text;
        if (spec.startsWith('./') || spec.startsWith('../')) {
          relativeImports++;
          const base = path.resolve(path.dirname(file), spec);
          const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, `${base}.json`,
            path.join(base, 'index.js')];
          assert.ok(candidates.some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()),
            `Unresolved emitted relative import ${spec} in ${file}`);
        }
      }
      typescript.forEachChild(node, visit);
    }
    visit(ast);
  }
  return { emitted: emitted.map((file, i) => ({ path: rels[i], bytes: fs.statSync(file).size, sha256: hash(file) })),
    runtimeSourceCount: runtimeSources.length, relativeImports };
}

async function main() {
  const [flag, approvalFile, shaFlag, approvalSha] = process.argv.slice(2);
  assert.equal(flag, '--approval');
  assert.equal(shaFlag, '--approval-sha256');
  assert.ok(approvalFile && /^[0-9a-f]{64}$/i.test(approvalSha ?? ''));
  assert.notEqual(norm(approvalFile), norm(path.join(root, 'APPROVAL.template.json')));
  assert.equal(hash(approvalFile), approvalSha.toUpperCase(), 'Approval file drift');
  const approval = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));
  const { parsed, inputs } = verifyInputs(approval);
  const c19DistMain = path.join(repo, 'apps/desktop/dist/main.js');
  const oldDistMainSha = hash(c19DistMain);
  fs.writeFileSync(markerPath, JSON.stringify({ at: new Date().toISOString(), approvalFile,
    approvalSha256: approvalSha.toUpperCase(), command: [process.execPath, tsc, '-p', configPath, '--pretty', 'false', '--listEmittedFiles'] }, null, 2));
  const out = fs.createWriteStream(path.join(root, 'TSC.stdout.raw'));
  const err = fs.createWriteStream(path.join(root, 'TSC.stderr.raw'));
  const outDone = new Promise((resolve, reject) => { out.once('finish', resolve); out.once('error', reject); });
  const errDone = new Promise((resolve, reject) => { err.once('finish', resolve); err.once('error', reject); });
  const receipt = { schema: 'qa03.release-desktop.receipt.v1', state: 'UNKNOWN',
    startedAt: new Date().toISOString(), approvalSha256: approvalSha.toUpperCase(),
    configSha256: hash(configPath), sourceSha256: hash(sourcePath), snapshotSha256: hash(snapshot),
    nodePath: process.execPath, nodeSha256: hash(process.execPath), tscPath: tsc, tscSha256: hash(tsc),
    gitHead: git('rev-parse', 'HEAD'), statusSha256Before: statusSha(), inputCount: inputs.length,
    oldC19DistMainSha256: oldDistMainSha, outputDir: dist };
  try {
    const child = spawn(process.execPath, [tsc, '-p', configPath, '--pretty', 'false', '--listEmittedFiles'],
      { cwd: path.join(repo, 'apps/desktop'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    receipt.pid = child.pid;
    child.stdout.pipe(out); child.stderr.pipe(err);
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    receipt.exit = exit;
    assert.equal(exit.code, 0, 'Pinned tsc failed');
    assert.equal(exit.signal, null, 'Pinned tsc terminated by signal');
    receipt.output = verifyOutput(parsed);
    for (const item of inputs) assert.equal(hash(item.path), item.sha256.toUpperCase(), `Post-build input drift: ${item.path}`);
    assert.equal(hash(c19DistMain), oldDistMainSha, 'c19 old dist changed');
    assert.equal(statusSha(), receipt.statusSha256Before, 'c19 status changed during run');
    receipt.state = 'RELEASE_DESKTOP_TSC_ISOLATED_PASS';
  } catch (error) {
    receipt.state = 'RELEASE_DESKTOP_TSC_RED';
    receipt.error = String(error.stack ?? error);
    if (fs.existsSync(dist)) receipt.outputTree = files(dist).map(file => ({
      path: path.relative(dist, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: hash(file) }));
  } finally {
    out.end(); err.end();
    await Promise.allSettled([outDone, errDone]);
    receipt.finishedAt = new Date().toISOString();
    receipt.stdoutSha256 = hash(path.join(root, 'TSC.stdout.raw'));
    receipt.stderrSha256 = hash(path.join(root, 'TSC.stderr.raw'));
    receipt.statusSha256After = statusSha();
    receipt.c19DistMainSha256After = hash(c19DistMain);
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
  if (receipt.state !== 'RELEASE_DESKTOP_TSC_ISOLATED_PASS') process.exitCode = 1;
}

main().catch(error => { process.stderr.write(String(error.stack ?? error) + '\n'); process.exitCode = 1; });
