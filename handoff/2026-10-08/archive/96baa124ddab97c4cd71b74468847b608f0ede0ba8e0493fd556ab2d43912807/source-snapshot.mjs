import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { canonicalRows } from "./canonical-fingerprint.mjs";

const fixed = ["package.json", "apps/studio-web/package.json",
  "apps/desktop/package.json", "pnpm-lock.yaml"];

export function sourceSnapshot(repo, statusLines) {
  const paths = new Set(statusLines.map((line) => line.slice(3).replaceAll("\\", "/"))
    .filter((path) => !/^apps\/(studio-web|desktop)\/dist\//.test(path)));
  for (const path of fixed) paths.add(path);
  return canonicalRows([...paths].map((path) => {
    const absolute = join(repo, path);
    assert.ok(existsSync(absolute) && statSync(absolute).isFile(), `Missing source: ${path}`);
    const bytes = readFileSync(absolute);
    return { path, bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase() };
  }));
}
