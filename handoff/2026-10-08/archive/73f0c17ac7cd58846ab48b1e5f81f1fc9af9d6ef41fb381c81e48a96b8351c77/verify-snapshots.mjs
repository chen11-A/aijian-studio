import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";

const [repository, parentPath, ...remaining] = process.argv.slice(2);
const outputPath = remaining.at(-1);
const deltaPaths = remaining.slice(0, -1);
if (!repository || !parentPath || !outputPath || deltaPaths.length === 0) {
  throw new Error("Usage: node verify-snapshots.mjs <c19> <34-snapshot> <delta-snapshot>... <output-json>");
}
const root = resolve(repository);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex").toUpperCase();
function snapshot(path) {
  const bytes = readFileSync(path);
  return { path, sha256: sha(bytes), data: JSON.parse(bytes.toString("utf8")) };
}
const parent = snapshot(parentPath);
const expected = new Map(parent.data.files.map((file) => [file.path, file]));
const deltas = deltaPaths.map(snapshot);
for (const delta of deltas) {
  if (delta.data.parentSnapshotSha256 !== parent.sha256) {
    throw new Error("Delta does not name the supplied parent snapshot: " + delta.path);
  }
  for (const file of delta.data.files) {
    const previous = expected.get(file.path);
    if (!previous || file.baseSha256 !== previous.sha256) {
      throw new Error("Delta base hash does not match previous snapshot: " + file.path);
    }
    expected.set(file.path, file);
  }
}
const files = [];
const mismatches = [];
for (const [name, record] of [...expected].sort(([a], [b]) => a.localeCompare(b))) {
  const target = resolve(root, normalize(name));
  if (isAbsolute(name) || relative(root, target).startsWith("..")) {
    throw new Error("Snapshot path escapes c19: " + name);
  }
  try {
    const bytes = readFileSync(target);
    const actual = { path: name, bytes: statSync(target).size, sha256: sha(bytes) };
    files.push(actual);
    if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256) {
      mismatches.push({ path: name, expected: { bytes: record.bytes, sha256: record.sha256 }, actual });
    }
  } catch (error) {
    mismatches.push({ path: name, error: String(error) });
  }
}
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const status = execFileSync("git", ["status", "--porcelain", "-uall"],
  { cwd: root, encoding: "utf8" }).trimEnd().split(/\r?\n/).filter(Boolean);
const result = {
  parentSnapshot: { path: parent.path, sha256: parent.sha256 },
  deltaSnapshots: deltas.map((delta) => ({ path: delta.path, sha256: delta.sha256 })),
  root, head, status, statusCount: status.length,
  expectedCount: expected.size, verifiedCount: expected.size - mismatches.length,
  files, mismatches,
};
writeFileSync(outputPath, JSON.stringify(result, null, 2), { flag: "wx" });
process.stdout.write(JSON.stringify({ head, statusCount: status.length,
  expectedCount: expected.size, mismatches: mismatches.length, outputPath }) + "\n");
if (head !== parent.data.head || mismatches.length) process.exitCode = 1;
