import { readFileSync, writeFileSync } from "node:fs";

const [beforePath, afterPath, outputPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !outputPath) {
  throw new Error("Usage: node compare-fingerprints.mjs <before> <after> <output>");
}
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));
const index = (records) => new Map(records.map(({ path, bytes, sha256 }) => [path, { bytes, sha256 }]));
const oldSource = index(before.source);
const newSource = index(after.source);
const sourceChanges = [];
for (const path of new Set([...oldSource.keys(), ...newSource.keys()])) {
  if (JSON.stringify(oldSource.get(path)) !== JSON.stringify(newSource.get(path))) {
    sourceChanges.push({ path, before: oldSource.get(path) ?? null, after: newSource.get(path) ?? null });
  }
}
const oldDist = index(before.dist);
const newDist = index(after.dist);
const distChanges = [];
for (const path of new Set([...oldDist.keys(), ...newDist.keys()])) {
  if (JSON.stringify(oldDist.get(path)) !== JSON.stringify(newDist.get(path))) {
    distChanges.push({ path, before: oldDist.get(path) ?? null, after: newDist.get(path) ?? null });
  }
}
const result = {
  beforePath, afterPath,
  headEqual: before.head === after.head,
  statusEqual: JSON.stringify(before.status) === JSON.stringify(after.status),
  beforeStatusCount: before.status.length,
  afterStatusCount: after.status.length,
  sourceChanges,
  beforeDistCount: before.dist.length,
  afterDistCount: after.dist.length,
  distChanges,
};
writeFileSync(outputPath, JSON.stringify(result, null, 2), { flag: "wx" });
process.stdout.write(JSON.stringify({ headEqual: result.headEqual,
  statusEqual: result.statusEqual, sourceChanges: sourceChanges.length,
  distChanges: distChanges.length, beforeDistCount: result.beforeDistCount,
  afterDistCount: result.afterDistCount, outputPath }) + "\n");
if (!result.headEqual || !result.statusEqual || sourceChanges.length) process.exitCode = 1;
