import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  runDesktopProviderResult,
  writeDesktopProviderRunState,
} from "./desktop-provider-result.mjs";

async function createResult(t) {
  const root = await mkdtemp(join(tmpdir(), "aijian-result-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, "result.json");
}
async function readResult(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("a cleanup failure turns a successful body into FAILED evidence", async (t) => {
  const resultPath = await createResult(t);
  await assert.rejects(
    runDesktopProviderResult({
      writePath: resultPath,
      runId: "cleanup-failure",
      body: async () => ({ check: "body-complete" }),
      cleanup: async () => {
        throw new Error("profile cleanup failed");
      },
    }),
    /profile cleanup failed/,
  );
  const result = await readResult(resultPath);
  assert.equal(result.stage, "FAILED");
  assert.equal(result.passed, false);
  assert.equal(result.failureStage, "CLEANUP");
  assert.equal(result.cleanupError, "profile cleanup failed");
  assert.equal(result.primaryError, undefined);
});

test("RUNNING replaces an old PASS before a body failure is recorded", async (t) => {
  const resultPath = await createResult(t);
  await writeDesktopProviderRunState(resultPath, { runId: "old", stage: "PASSED", passed: true });
  let bodyObserved;
  await assert.rejects(
    runDesktopProviderResult({
      writePath: resultPath,
      runId: "body-failure",
      body: async () => {
        bodyObserved = await readResult(resultPath);
        throw new Error("launch failed");
      },
      cleanup: async () => {},
    }),
    /launch failed/,
  );
  assert.deepEqual(
    { runId: bodyObserved.runId, stage: bodyObserved.stage, passed: bodyObserved.passed },
    { runId: "body-failure", stage: "RUNNING", passed: false },
  );
  const result = await readResult(resultPath);
  assert.equal(result.stage, "FAILED");
  assert.equal(result.failureStage, "BODY");
  assert.equal(result.primaryError, "launch failed");
});

test("a body and cleanup failure retain both failure reasons", async (t) => {
  const resultPath = await createResult(t);
  await assert.rejects(
    runDesktopProviderResult({
      writePath: resultPath,
      runId: "two-failures",
      body: async () => {
        throw new Error("renderer action failed");
      },
      cleanup: async () => {
        throw new Error("profile removal failed");
      },
    }),
    /renderer action failed/,
  );
  const result = await readResult(resultPath);
  assert.equal(result.failureStage, "BODY");
  assert.equal(result.primaryError, "renderer action failed");
  assert.equal(result.cleanupError, "profile removal failed");
});

test("PASSED is written only after cleanup completes", async (t) => {
  const resultPath = await createResult(t);
  const sequence = [];
  const passed = await runDesktopProviderResult({
    writePath: resultPath,
    runId: "success",
    body: async () => {
      sequence.push("body");
      return { check: "complete" };
    },
    cleanup: async () => {
      sequence.push("cleanup");
      assert.equal((await readResult(resultPath)).stage, "RUNNING");
    },
  });
  assert.deepEqual(sequence, ["body", "cleanup"]);
  assert.equal(passed.stage, "PASSED");
  assert.equal((await readResult(resultPath)).stage, "PASSED");
});
