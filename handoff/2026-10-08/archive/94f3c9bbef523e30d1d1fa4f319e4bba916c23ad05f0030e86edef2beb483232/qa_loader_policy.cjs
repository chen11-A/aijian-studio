"use strict";
// QA-only loader policy; can be tested without evaluating staged product modules.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = __dirname;
const stage = path.join(root, "stage");
const stageReal = fs.realpathSync.native(stage);
const closure = JSON.parse(fs.readFileSync(path.join(root, "V3-RUNTIME-CLOSURE.json")));
assert.equal(closure.state, "STATIC_TS_AST_CLOSURE_NO_PRODUCT_EXECUTION");
const closureMap = new Map(closure.modules.map(row => [
  path.resolve(stage, row.stage_relative_path).toLowerCase(), row.sha256,
]));
const bare = new Map(Object.entries(closure.allowed_bare).map(([specifier, row]) => [
  specifier, path.resolve(stage, row.stage_relative_path),
]));
assert.deepEqual([...bare.keys()].sort(), [
  "@aijian/contracts/artifact-proposal",
  "@aijian/contracts/invalidation-operation",
]);
const builtins = new Set(closure.external_mock_or_builtin.filter(value => value.startsWith("node:")));
assert.deepEqual([...builtins].sort(), ["node:crypto", "node:fs/promises", "node:path"]);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
function within(candidate) {
  const resolved = path.resolve(candidate);
  const real = fs.realpathSync.native(resolved);
  assert.ok(real.toLowerCase().startsWith((stageReal + path.sep).toLowerCase()), "module escaped QA stage");
  assert.equal(real.toLowerCase(), resolved.toLowerCase(), "module link or alias");
  assert.ok(fs.statSync(real).isFile(), "missing staged module");
  assert.equal(sha(real), closureMap.get(real.toLowerCase()), "module missing from pinned static closure");
  return real;
}
function resolveRuntime(parent, specifier) {
  within(parent);
  if (specifier === "electron") return { kind: "electron" };
  if (specifier.startsWith("node:")) {
    assert.ok(builtins.has(specifier), "unexpected builtin runtime import: " + specifier);
    return { kind: "builtin", specifier };
  }
  if (bare.has(specifier)) return { kind: "ts", file: within(bare.get(specifier)) };
  assert.ok(specifier.startsWith("."), "external runtime import denied: " + specifier);
  const base = path.resolve(path.dirname(parent), specifier);
  for (const candidate of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return { kind: "ts", file: within(candidate) };
  }
  throw Error("staged relative module missing: " + specifier);
}
module.exports = { within, resolveRuntime };
