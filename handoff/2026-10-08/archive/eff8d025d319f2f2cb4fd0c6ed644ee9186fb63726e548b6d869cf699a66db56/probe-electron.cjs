// QA-only Electron main-process module probe. No BrowserWindow, sidecar, network or provider.
const assert = require('node:assert/strict');
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const marker = process.env.QA03_ELECTRON_MARKER;
const go = process.env.QA03_ELECTRON_GO;
assert.ok(marker && go && path.isAbsolute(marker) && path.isAbsolute(go));
const consumers = [
  ['api-client.js', '@aijian/contracts/invalidation-operation', 'validateInvalidationOperationPageQuery'],
  ['artifact-proposal-contract.js', '@aijian/contracts/artifact-proposal', 'isArtifactProposalResponse'],
  ['invalidation-operation-ipc.js', '@aijian/contracts/invalidation-operation', 'isInvalidationOperationResponse'],
  ['remote-source-extract-v2-contract.js', '@aijian/contracts/artifact-proposal', 'isArtifactProposalResponse'],
];
async function main() {
  await app.whenReady();
  assert.ok(process.versions.electron, 'Not an Electron runtime');
  assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(app.isPackaged, false);
  const loaded = [];
  for (const [file, specifier, symbol] of consumers) {
    const consumer = path.join(__dirname, 'dist', file);
    const localRequire = createRequire(consumer);
    const resolved = localRequire.resolve(specifier);
    const runtime = localRequire(specifier);
    assert.equal(typeof runtime[symbol], 'function');
    const desktop = localRequire(consumer);
    assert.equal(typeof desktop, 'object');
    loaded.push({ file, specifier, symbol, resolved, desktopExports: Object.keys(desktop).sort() });
  }
  const artifact = await import('@aijian/contracts/artifact-proposal');
  const invalidation = await import('@aijian/contracts/invalidation-operation');
  assert.equal(typeof artifact.isArtifactProposalResponse, 'function');
  for (const name of ['validateInvalidationOperationPageQuery',
    'isInvalidationOperationPageResponse', 'isInvalidationOperationResponse'])
    assert.equal(typeof invalidation[name], 'function');
  const evidence = { state: 'ELECTRON_MAIN_MODULE_LOAD_READY', pid: process.pid,
    electron: process.versions.electron, node: process.versions.node,
    execPath: process.execPath, argv: process.argv, isPackaged: app.isPackaged,
    loaded, esmNamed: ['isArtifactProposalResponse',
      'validateInvalidationOperationPageQuery','isInvalidationOperationPageResponse',
      'isInvalidationOperationResponse'] };
  fs.writeFileSync(marker, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ state: evidence.state, pid: evidence.pid,
    electron: evidence.electron, loaded: loaded.length, esmNamed: evidence.esmNamed.length })+'\n');
  const started = Date.now();
  const timer = setInterval(() => {
    if (fs.existsSync(go)) { clearInterval(timer); app.quit(); }
    else if (Date.now() - started > 20000) {
      clearInterval(timer); process.stderr.write('GO signal timeout\n'); app.exit(2);
    }
  }, 50);
}
main().catch(error => { process.stderr.write(String(error.stack ?? error)+'\n'); app.exit(1); });
