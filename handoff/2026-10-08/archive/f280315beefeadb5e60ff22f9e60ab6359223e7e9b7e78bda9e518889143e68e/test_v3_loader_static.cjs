"use strict";
// Exercise the exact loader policy on staged paths without loading product code.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = __dirname;
const stage = path.join(root, "stage");
const closure = JSON.parse(fs.readFileSync(path.join(root, "V3-RUNTIME-CLOSURE.json")));
const policy = require("./qa_loader_policy.cjs");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
let accepted = 0;
for (const edge of closure.edges) {
  const from = path.join(stage, edge.from);
  const outcome = policy.resolveRuntime(from, edge.specifier);
  if (edge.to.startsWith("BUILTIN:")) {
    assert.deepEqual(outcome, { kind: "builtin", specifier: edge.specifier });
  } else if (edge.to.startsWith("MOCK:")) {
    assert.deepEqual(outcome, { kind: "electron" });
  } else {
    assert.equal(outcome.kind, "ts");
    assert.equal(outcome.file.toLowerCase(), path.join(stage, edge.to).toLowerCase());
  }
  accepted++;
}
const from = path.join(stage, "apps", "desktop", "src", "api-client.ts");
const negatives = [
  () => policy.resolveRuntime(from, "@aijian/contracts"),
  () => policy.resolveRuntime(from, "@aijian/contracts/unknown"),
  () => policy.resolveRuntime(from, "typescript"),
  () => policy.resolveRuntime(from, "node:child_process"),
  () => policy.resolveRuntime(from, "node:fs"),
  () => policy.resolveRuntime(from, "../../../../../outside"),
  () => policy.within(path.join(root, "desktop_ipc_mock_once.cjs")),
  () => policy.within(path.join(stage, "apps", "desktop", "node_modules", "@aijian", "contracts", "package.json")),
];
for (const reject of negatives) assert.throws(reject);
const report = {
  schema: "qa02.b31.v3.loader-static.v1",
  state: "LOADER_POLICY_STATIC_PASS_NO_PRODUCT_EXECUTION",
  closure_sha256: hash(path.join(root, "V3-RUNTIME-CLOSURE.json")),
  policy_sha256: hash(path.join(root, "qa_loader_policy.cjs")),
  accepted_edges: accepted,
  denied_cases: negatives.length,
  stage_file_count: closure.module_count,
  product_executed: false,
  typescript_run: false,
  mock_run: false,
};
const output = path.join(root, "V3-LOADER-STATIC.json");
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ ...report, report_sha256: hash(output) }) + "\n");
