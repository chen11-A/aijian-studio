"use strict";
// Actual Node/TypeScript consumer view of non-Python inputs; no product module load.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const nodeModule = require("node:module");
const root = __dirname;
const packetPath = path.join(root, "B31-PACKET.json");
const packet = JSON.parse(fs.readFileSync(packetPath));
const stageInfo = JSON.parse(fs.readFileSync(path.join(root, "STAGE-MANIFEST.json")));
const toolInfo = JSON.parse(fs.readFileSync(path.join(root, "TOOLCHAIN-MANIFEST.json")));
const closureInfo = JSON.parse(fs.readFileSync(path.join(root, "V3-RUNTIME-CLOSURE.json")));
const sourceInfo = JSON.parse(fs.readFileSync(packet.source_manifest_path));
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
const requireQA = (condition, code) => { if (!condition) throw new Error(code); };
const seen = [];
function check(file, expected, label) {
  requireQA(fs.statSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), "NONFILE_OR_LINK:" + label);
  const actual = sha(file);
  requireQA(actual === expected, "NODE_VIEW_CHANGED:" + label + ":" + file);
  seen.push(label + "|" + actual);
}
requireQA(sha(process.execPath) === packet.node_sha256, "NODE_BINARY_CHANGED");
requireQA(path.resolve(process.execPath).toLowerCase() === path.resolve(packet.node_path).toLowerCase(),
  "NODE_PATH_CHANGED");
requireQA(Object.keys(process.env).sort().join("|") === Object.keys(packet.environment).sort().join("|"),
  "NODE_ENV_KEYS");
requireQA(Object.keys(packet.environment).every((key) => process.env[key] === packet.environment[key]),
  "NODE_ENV_VALUES");
requireQA(process.env.NODE_DISABLE_COMPILE_CACHE === "1" &&
  nodeModule.enableCompileCache().status === nodeModule.constants.compileCacheStatus.DISABLED,
  "COMPILE_CACHE_NOT_DISABLED");
check(path.join(root, "desktop_ipc_mock_once.cjs"), packet.runner_sha256, "mock_runner");
check(path.join(root, "qa_loader_policy.cjs"), packet.loader_policy_sha256, "loader_policy");
check(path.join(root, "probe_node_sources.cjs"), packet.node_probe_sha256, "node_probe");
check(path.join(root, "scan_runtime_closure.cjs"), packet.closure_scanner_sha256, "closure_scanner");
check(path.join(root, "V3-RUNTIME-CLOSURE.json"), packet.closure_sha256, "closure");
check(path.join(root, "V4-LOADER-STATIC.json"), packet.loader_static_evidence_sha256, "loader_static");
check(path.join(root, "V4-NODE-CACHE-DISABLE-STATIC.json"),
  packet.cache_disable_static_evidence_sha256, "cache_disable_static");
check(path.join(root, "V4-CLAIM-STATIC.json"), packet.claim_static_evidence_sha256, "claim_static");
check(path.join(root, "V4-SHELL-STATIC.json"), packet.shell_static_evidence_sha256, "shell_static");
check(path.join(root, "V4-LINEAGE.json"), packet.lineage_sha256, "lineage");
check(path.join(root, "STAGE-MANIFEST.json"), packet.stage_manifest_sha256, "stage_manifest");
check(path.join(root, "TOOLCHAIN-MANIFEST.json"), packet.toolchain_manifest_sha256, "toolchain_manifest");
check(packet.source_manifest_path, packet.source_manifest_sha256, "source_manifest");
requireQA(sourceInfo.selected_dependency_files.length === 50 &&
  sourceInfo.backend_version.source_files.length === 194 &&
  sourceInfo.c19_preserved_baseline.length === 6 &&
  Object.keys(sourceInfo.references).length === 8 &&
  sourceInfo.superseded_dev05_author_observations.length === 6, "SOURCE_COUNTS");
const selectedByPath = new Map(sourceInfo.selected_dependency_files.map((row) => [row.relative_path, row.sha256]));
for (const row of sourceInfo.superseded_dev05_author_observations) {
  requireQA(selectedByPath.get(row.relative_path) === row.current_sha256,
    "SUPERSESSION_CHANGED:" + row.relative_path);
}
let nonpy = 0;
for (const row of [...sourceInfo.selected_dependency_files, ...sourceInfo.backend_version.source_files]) {
  if (path.extname(row.source_path).toLowerCase() === ".py") continue;
  check(row.source_path, row.sha256, "manifest:" + row.relative_path);
  nonpy++;
}
for (const row of sourceInfo.c19_preserved_baseline) check(row.path, row.sha256, "c19:" + row.relative_path);
for (const [key, row] of Object.entries(sourceInfo.references)) check(row.path, row.sha256, "ref:" + key);
requireQA(stageInfo.files.length === 92 && toolInfo.files.length === 286, "STAGE_COUNTS");
requireQA(closureInfo.state === "STATIC_TS_AST_CLOSURE_NO_PRODUCT_EXECUTION" &&
  closureInfo.module_count === 28 && closureInfo.edge_count === 57 &&
  Object.keys(closureInfo.allowed_bare).sort().join("|") ===
    "@aijian/contracts/artifact-proposal|@aijian/contracts/invalidation-operation",
  "CLOSURE_COUNTS_OR_BARE");
requireQA(path.resolve(stageInfo.stage_root) === path.resolve(packet.stage_root), "STAGE_ROOT");
const expectedStage = new Set();
for (const row of stageInfo.files) {
  const target = path.join(stageInfo.stage_root, row.relative_path);
  check(row.source_path, row.sha256, "project_source:" + row.relative_path);
  check(target, row.sha256, "project_stage:" + row.relative_path);
  expectedStage.add(path.resolve(target).toLowerCase());
}
for (const row of toolInfo.files) {
  check(row.source, row.sha256, "tool_source:" + row.package + ":" + row.staged);
  check(row.staged, row.sha256, "tool_stage:" + row.package + ":" + row.staged);
  expectedStage.add(path.resolve(row.staged).toLowerCase());
}
check(toolInfo.qa_tsconfig.path, toolInfo.qa_tsconfig.sha256, "qa_tsconfig");
expectedStage.add(path.resolve(toolInfo.qa_tsconfig.path).toLowerCase());
function visit(dir) {
  const results = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    requireQA(!item.isSymbolicLink(), "STAGE_LINK:" + full);
    if (item.isDirectory()) results.push(...visit(full));
    else { requireQA(item.isFile(), "STAGE_NONFILE:" + full); results.push(path.resolve(full).toLowerCase()); }
  }
  return results;
}
const actualStage = visit(stageInfo.stage_root);
requireQA(actualStage.length === expectedStage.size && actualStage.every((file) => expectedStage.has(file)),
  "STAGE_FILE_INVENTORY");
const digest = crypto.createHash("sha256").update(seen.join("\n")).digest("hex").toUpperCase();
process.stdout.write(JSON.stringify({
  state: "NODE_SOURCE_VIEW_PASS", node_sha256: packet.node_sha256,
  packet_sha256: sha(packetPath), checked: seen.length, nonpy_manifest_rows: nonpy,
  project_files: 92, toolchain_files: 286, stage_actual_files: actualStage.length,
  digest, product_imported: false, provider_called: false,
}) + "\n");
