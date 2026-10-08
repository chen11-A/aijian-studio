// One CJS case per child process; the parent records stdout, stderr and exit verbatim.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');

const [candidate, consumerName, specifier, symbol] = process.argv.slice(2);
assert.ok(candidate && consumerName && specifier && symbol, 'Four arguments required');
assert.ok([
  'api-client.js',
  'artifact-proposal-contract.js',
  'invalidation-operation-ipc.js',
  'remote-source-extract-v2-contract.js',
].includes(consumerName), 'Unknown frozen desktop consumer');
assert.ok([
  '@aijian/contracts/artifact-proposal',
  '@aijian/contracts/invalidation-operation',
].includes(specifier), 'Unknown contracts specifier');
const consumer = path.join(candidate, 'app', 'dist', consumerName);
const localRequire = createRequire(consumer);
const resolved = localRequire.resolve(specifier);
const packageModule = localRequire(specifier);
assert.equal(typeof packageModule[symbol], 'function', `Missing runtime export ${symbol}`);
const desktopModule = localRequire(consumer);
assert.equal(typeof desktopModule, 'object', 'Consumer did not load as CJS');
process.stdout.write(JSON.stringify({
  state: 'CJS_REQUIRE_PASS', consumer, specifier, symbol, resolved,
  consumerExports: Object.keys(desktopModule).sort(),
}) + '\n');
