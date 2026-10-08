// Copy this exact file to candidate/app/probe-esm.mjs before running.
import assert from 'node:assert/strict';

const [specifier, symbol] = process.argv.slice(2);
assert.ok([
  '@aijian/contracts',
  '@aijian/contracts/artifact-proposal',
  '@aijian/contracts/invalidation-operation',
].includes(specifier), 'Unknown contracts specifier');
assert.ok(specifier === '@aijian/contracts' || symbol, 'Runtime export symbol required');
const resolved = import.meta.resolve(specifier);
const packageModule = await import(specifier);
if (symbol) assert.equal(typeof packageModule[symbol], 'function', `Missing runtime export ${symbol}`);
process.stdout.write(JSON.stringify({ state: 'ESM_IMPORT_PASS', specifier, symbol, resolved,
  exports: Object.keys(packageModule).sort() }) + '\n');
