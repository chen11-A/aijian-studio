import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalDigest, canonicalRows } from "./canonical-fingerprint.mjs";
import { sourceSnapshot } from "./source-snapshot.mjs";

const root = dirname(import.meta.filename);
const repo = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
const prior = join(root, "../cas-overlay-v3/component-02/before.json");
const output = join(root, "selfcheck-01");
assert.ok(!existsSync(output), "Selfcheck output already exists");
mkdirSync(output);
const sha = (data) => createHash("sha256").update(data).digest("hex").toUpperCase();
const evidence = { schema: "qa03.project-name-sidecar-source-selfcheck.v1",
  state: "RUNNING", priorManifestSha256: sha(readFileSync(prior)),
  currentHead: null, currentStatusSha256: null, sourceCount: null,
  sourceOrdinalSha256: null, individualRowsEqual: null, error: null };
try {
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const lines = git("status", "--porcelain", "-uall").trimEnd().split(/\r?\n/).filter(Boolean);
  const current = sourceSnapshot(repo, lines);
  const historical = JSON.parse(readFileSync(prior, "utf8"));
  assert.deepEqual(current, canonicalRows(historical.source));
  evidence.currentHead = git("rev-parse", "HEAD").trim();
  evidence.currentStatusSha256 = sha(lines.join("\n"));
  evidence.sourceCount = current.length;
  evidence.sourceOrdinalSha256 = canonicalDigest(current);
  evidence.individualRowsEqual = true;
  evidence.state = "SELF_CHECK_PASS";
} catch (error) {
  evidence.state = "SELF_CHECK_RED";
  evidence.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  writeFileSync(join(output, "SELFTEST.json"), JSON.stringify(evidence, null, 2) + "\n");
}
