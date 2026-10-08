const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function resolveDependencies(ts, options, source, desktop, c19, canonical) {
  const cases = [
    { name: "node", kind: "type", from: "main.ts", package: "@types/node" },
    { name: "@aijian/contracts", kind: "module", from: "agent-skill-catalog-contract.ts", package: "@aijian/contracts" },
    { name: "@aijian/contracts/invalidation-operation", kind: "module", from: "api-client.test.ts", package: "@aijian/contracts" },
    { name: "vitest", kind: "module", from: "api-client.test.ts", package: "vitest" },
    { name: "electron", kind: "module", from: "main.ts", package: "electron" },
  ];
  return cases.map((item) => {
    const containing = path.join(source, item.from);
    const resolution = item.kind === "type"
      ? ts.resolveTypeReferenceDirective(item.name, containing, options, ts.sys).resolvedTypeReferenceDirective
      : ts.resolveModuleName(item.name, containing, options, ts.sys).resolvedModule;
    assert.ok(resolution?.resolvedFileName, `unresolved ${item.name}`);
    const resolved = canonical(resolution.resolvedFileName);
    assert.ok(resolved.startsWith(`${canonical(c19)}/`), `dependency outside fixed c19: ${item.name}`);
    const packageFile = path.join(desktop, "node_modules", item.package, "package.json");
    assert.ok(fs.existsSync(packageFile), `missing package metadata: ${item.package}`);
    const packageReal = canonical(packageFile);
    assert.ok(packageReal.startsWith(`${canonical(c19)}/`), `package outside fixed c19: ${item.package}`);
    return {
      name: item.name,
      kind: item.kind,
      containing,
      resolvedFileName: resolution.resolvedFileName,
      resolvedRealPath: resolved,
      resolvedSha256: sha256(resolution.resolvedFileName),
      package: item.package,
      packageRealPath: packageReal,
      packageVersion: JSON.parse(fs.readFileSync(packageFile, "utf8")).version,
      packageManifestSha256: sha256(packageFile),
    };
  });
}

module.exports = { resolveDependencies };
