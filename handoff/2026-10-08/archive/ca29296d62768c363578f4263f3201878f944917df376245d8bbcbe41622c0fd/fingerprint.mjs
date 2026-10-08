import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const output = process.argv[2];
if (!output) throw new Error("output path required");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
const status = git("status", "--porcelain", "-uall").split(/\r?\n/).filter(Boolean);
const head = git("rev-parse", "HEAD");
const paths = new Set(status.map((line) => line.slice(3).replaceAll("\\", "/")));
for (const file of ["package.json", "apps/studio-web/package.json",
  "apps/desktop/package.json", "pnpm-lock.yaml"]) paths.add(file);

function record(path) {
  const bytes = readFileSync(path);
  return { path: relative(root, path).replaceAll("\\", "/"), bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    mtimeUtc: statSync(path).mtime.toISOString() };
}
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const source = [...paths].sort().map((path) => resolve(root, path))
  .filter((path) => existsSync(path) && statSync(path).isFile()).map(record);
const dist = ["apps/studio-web/dist", "apps/desktop/dist"]
  .flatMap((dir) => filesUnder(join(root, dir))).sort().map(record);
const manifest = { timeUtc: new Date().toISOString(), head, status,
  sourceCount: source.length, distCount: dist.length, source, dist };
writeFileSync(output, JSON.stringify(manifest, null, 2), "utf8");
process.stdout.write(JSON.stringify({ head, statusCount: status.length,
  sourceCount: source.length, distCount: dist.length, manifest: output }) + "\n");
