"use strict";
// Parse transpiled staged code; never evaluate product code.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = __dirname;
const stage = path.join(root, "stage");
const src = path.join(stage, "apps", "desktop", "src");
const ts = require(path.join(stage, "node_modules", "typescript"));
const stageInfo = JSON.parse(fs.readFileSync(path.join(root, "STAGE-MANIFEST.json")));
const toolInfo = JSON.parse(fs.readFileSync(path.join(root, "TOOLCHAIN-MANIFEST.json")));
const stageRows = [...stageInfo.files.map(row => ({
  path: path.join(stage, row.relative_path), sha256: row.sha256,
})), ...toolInfo.files.map(row => ({ path: row.staged, sha256: row.sha256 }))];
const expected = new Map(stageRows.map(row => [path.resolve(row.path).toLowerCase(), row.sha256]));
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
const stageReal = fs.realpathSync.native(stage);
function pinned(file) {
  const resolved = path.resolve(file), real = fs.realpathSync.native(resolved);
  assert.ok(real.toLowerCase().startsWith((stageReal + path.sep).toLowerCase()), "OUTSIDE_STAGE:" + file);
  assert.equal(real.toLowerCase(), resolved.toLowerCase(), "LINK_OR_ALIAS:" + file);
  assert.ok(fs.statSync(real).isFile(), "NOT_FILE:" + file);
  assert.equal(hash(real), expected.get(real.toLowerCase()), "UNPINNED_OR_CHANGED:" + file);
  return real;
}
const pkg = path.join(stage, "apps", "desktop", "node_modules", "@aijian", "contracts");
const pkgFile = pinned(path.join(pkg, "package.json"));
const pkgInfo = JSON.parse(fs.readFileSync(pkgFile));
assert.equal(pkgInfo.name, "@aijian/contracts");
const allowedBare = {
  "@aijian/contracts/invalidation-operation": pinned(path.join(pkg, "src", "invalidation-operation.ts")),
  "@aijian/contracts/artifact-proposal": pinned(path.join(pkg, "src", "artifact-proposal.ts")),
};
assert.equal(pkgInfo.exports["./invalidation-operation"].default, "./src/invalidation-operation.ts");
assert.equal(pkgInfo.exports["./artifact-proposal"].default, "./src/artifact-proposal.ts");
const roots = [
  "sub2api-connection-mutation-contract.ts",
  "sub2api-connection-mutation-ipc.ts",
  "preload.ts",
  "api-client.ts",
].map(name => pinned(path.join(src, name)));
const visited = new Set(), edges = [], externals = new Set();
function walk(file) {
  file = pinned(file);
  if (visited.has(file)) return;
  visited.add(file);
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const tree = ts.createSourceFile(file + ".js", output.outputText, ts.ScriptTarget.ES2022, true);
  const specs = [];
  function scan(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      throw Error("DYNAMIC_IMPORT:" + file);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      assert.equal(node.arguments.length, 1, "DYNAMIC_REQUIRE:" + file);
      assert.ok(ts.isStringLiteral(node.arguments[0]), "DYNAMIC_REQUIRE:" + file);
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, scan);
  }
  scan(tree);
  for (const spec of specs) {
    let dest;
    if (spec === "electron") dest = "MOCK:electron";
    else if (spec.startsWith("node:")) {
      assert.notEqual(spec, "node:child_process");
      dest = "BUILTIN:" + spec;
    } else if (Object.hasOwn(allowedBare, spec)) {
      dest = allowedBare[spec];
    } else if (spec.startsWith(".")) {
      const base = path.resolve(path.dirname(file), spec);
      dest = [base + ".ts", base + ".tsx", path.join(base, "index.ts")]
        .find(candidate => fs.existsSync(candidate));
      assert.ok(dest, "RELATIVE_MISSING:" + file + ":" + spec);
      dest = pinned(dest);
    } else {
      throw Error("UNKNOWN_EXTERNAL:" + file + ":" + spec);
    }
    edges.push({ from: path.relative(stage, file).replaceAll(path.sep, "/"),
                 specifier: spec,
                 to: dest.startsWith(stage) ? path.relative(stage, dest).replaceAll(path.sep, "/") : dest });
    if (dest.startsWith("BUILTIN:") || dest.startsWith("MOCK:")) externals.add(spec);
    else walk(dest);
  }
}
for (const file of roots) walk(file);
const report = {
  schema: "qa02.b31.v3.runtime-closure.v1",
  state: "STATIC_TS_AST_CLOSURE_NO_PRODUCT_EXECUTION",
  roots: roots.map(file => path.relative(stage, file).replaceAll(path.sep, "/")),
  allowed_bare: Object.fromEntries(Object.entries(allowedBare).map(([key, file]) => [key, {
    stage_relative_path: path.relative(stage, file).replaceAll(path.sep, "/"),
    sha256: hash(file),
  }])),
  external_mock_or_builtin: [...externals].sort(),
  modules: [...visited].sort().map(file => ({
    stage_relative_path: path.relative(stage, file).replaceAll(path.sep, "/"),
    sha256: hash(file),
  })),
  edges: edges.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  module_count: visited.size,
  edge_count: edges.length,
  product_executed: false,
};
fs.writeFileSync(path.join(root, "V3-RUNTIME-CLOSURE.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({module_count: report.module_count, edge_count: report.edge_count,
  allowed_bare: report.allowed_bare, externals: report.external_mock_or_builtin,
  report_sha256: hash(path.join(root, "V3-RUNTIME-CLOSURE.json"))}) + "\n");
