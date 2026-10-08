import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { captured } from "./capture-process.mjs";
import { canonicalDigest, canonicalRows } from "./canonical-fingerprint.mjs";

const root = dirname(import.meta.filename);
const parent = dirname(root);
const priorComponent = join(parent, "cas-overlay-v3/component-02/before.json");
const priorWeb = join(parent, "web-gate-v1/web-01/before.json");
const output = join(root, "selfcheck-01");
assert.ok(!existsSync(output), "Selfcheck output already exists");
mkdirSync(output);
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const evidence = { schema: "qa03.project-name-web-selfcheck.v1", state: "RUNNING",
  inputs: [priorComponent, priorWeb].map((path) => ({ path, sha256: sha(path) })),
  source: {}, dist: {}, capture: null, error: null };
try {
  const [a, b] = [priorComponent, priorWeb]
    .map((path) => JSON.parse(readFileSync(path, "utf8")));
  assert.equal(a.head, b.head);
  assert.deepEqual(a.status, b.status);
  assert.equal(a.source.length, 113);
  assert.equal(a.dist.length, 82);
  assert.deepEqual(canonicalRows(a.source), canonicalRows(b.source));
  assert.deepEqual(canonicalRows(a.dist), canonicalRows(b.dist));
  for (const kind of ["source", "dist"]) {
    const left = canonicalDigest(a[kind]);
    const right = canonicalDigest(b[kind]);
    assert.equal(left, right);
    evidence[kind] = { count: a[kind].length, ordinalSha256: left,
      individualRowsEqual: true };
  }
  const steps = {};
  const args = ["-e", 'process.stdout.write(process.argv.slice(1).join("|")+"\\n");process.stderr.write("SELFTEST\\n")',
    "alpha", "beta"];
  const step = await captured({ name: "capture", executable: process.execPath, args,
    cwd: root, output, timeoutMs: 10000, steps });
  assert.equal(step.exitCode, 0);
  assert.equal(step.timedOut, false);
  assert.deepEqual(step.arguments, args);
  assert.equal(step.workingDirectory, root);
  assert.equal(readFileSync(step.stdoutPath, "utf8"), "alpha|beta\n");
  assert.equal(readFileSync(step.stderrPath, "utf8"), "SELFTEST\n");
  const cwdStep = await captured({ name: "cwd-check", executable: process.execPath,
    args: ["-e", 'process.stdout.write(process.cwd()+"\\n")'], cwd: output,
    output, timeoutMs: 10000, steps });
  assert.equal(cwdStep.exitCode, 0);
  assert.equal(cwdStep.timedOut, false);
  assert.equal(cwdStep.workingDirectory, output);
  assert.equal(resolve(readFileSync(cwdStep.stdoutPath, "utf8").trim()).toLowerCase(),
    resolve(output).toLowerCase());
  evidence.capture = { arguments: step, workingDirectory: cwdStep };
  evidence.state = "SELF_CHECK_PASS";
} catch (error) {
  evidence.state = "SELF_CHECK_RED";
  evidence.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  writeFileSync(join(output, "SELFTEST.json"), JSON.stringify(evidence, null, 2) + "\n");
}
