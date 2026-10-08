"use strict";
// Read-only post-RED audit of actual Node-visible bytes; prints hashes, never contents.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = __dirname;
const stage = JSON.parse(fs.readFileSync(path.join(root, "STAGE-MANIFEST.json")));
const tool = JSON.parse(fs.readFileSync(path.join(root, "TOOLCHAIN-MANIFEST.json")));
const manifest = JSON.parse(fs.readFileSync(stage.source_manifest_path));
const hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase();
const mismatches = [];
function check(label, file, expected) {
  const actual = hash(file);
  if (actual !== expected) mismatches.push({ label, file, expected, actual });
}
for (const row of manifest.selected_dependency_files) {
  if (!row.source_path.toLowerCase().endsWith(".py")) check("selected", row.source_path, row.sha256);
}
for (const row of manifest.backend_version.source_files) {
  if (!row.source_path.toLowerCase().endsWith(".py")) check("backend_nonpy", row.source_path, row.sha256);
}
for (const row of manifest.c19_preserved_baseline) check("c19", row.path, row.sha256);
for (const row of Object.values(manifest.references)) check("reference", row.path, row.sha256);
for (const row of stage.files) {
  check("stage_source", row.source_path, row.sha256);
  check("stage_copy", path.join(stage.stage_root, row.relative_path), row.sha256);
}
for (const row of tool.files) {
  check("tool_source", row.source, row.sha256);
  check("tool_copy", row.staged, row.sha256);
}
check("node_binary", tool.node_binary.path, tool.node_binary.sha256);
process.stdout.write(JSON.stringify({
  state: "NODE_CONSUMER_VIEW_AUDIT_NO_PRODUCT_EXECUTION",
  checks: manifest.selected_dependency_files.filter((r) => !r.source_path.toLowerCase().endsWith(".py")).length +
    manifest.backend_version.source_files.filter((r) => !r.source_path.toLowerCase().endsWith(".py")).length +
    manifest.c19_preserved_baseline.length + Object.keys(manifest.references).length +
    stage.files.length * 2 + tool.files.length * 2 + 1,
  mismatch_count: mismatches.length, mismatches,
}) + "\n");
