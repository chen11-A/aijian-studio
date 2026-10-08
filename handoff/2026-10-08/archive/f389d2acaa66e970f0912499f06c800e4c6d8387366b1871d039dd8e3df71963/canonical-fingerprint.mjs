import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const distPath = (path) => /^apps\/(studio-web|desktop)\/dist\//.test(path);
const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex").toUpperCase();

export function canonicalRows(files, { excludeDist = false } = {}) {
  const rows = files.map((file) => {
    const path = file.path.replaceAll("\\", "/");
    assert.ok(path && !path.startsWith("/") && !path.includes("../"), "Unsafe manifest path");
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes >= 0, "Invalid byte count");
    assert.match(file.sha256, /^[0-9a-f]{64}$/i, "Invalid file SHA");
    return { path, bytes: file.bytes, sha256: file.sha256.toUpperCase() };
  }).filter((file) => !excludeDist || !distPath(file.path));
  rows.sort((a, b) => ordinal(a.path, b.path));
  for (let i = 1; i < rows.length; i++) assert.notEqual(rows[i].path, rows[i - 1].path,
    "Duplicate normalized path");
  return rows;
}

export function canonicalDigest(files, options) {
  const rows = canonicalRows(files, options);
  return sha(rows.map((file) => `${file.path}|${file.bytes}|${file.sha256}`).join("\n"));
}

export function nonDistStatus(lines) {
  return lines.filter((line) => !distPath(line.slice(3).replaceAll("\\", "/")));
}
