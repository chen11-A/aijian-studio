/** Closed node:test contract, not a Vitest discovery file. */
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { test, afterEach } from "node:test";
import { installStoryPolicyBridge } from "./pro-story-policy-fixture.mjs";
import { storyPolicyStates } from "./pro-story-policy-cases.mjs";
const original = globalThis.window;
afterEach(() => {
  globalThis.window = original;
});
const id = `prj_${"a".repeat(32)}`;
function setup(state = "story-policy-values") {
  globalThis.window = { aijian: {}, aijianGrok: {} };
  installStoryPolicyBridge({ state });
  return { b: window.aijian, a: window.__storyPolicyAudit };
}
test("four fixed default modes have sixteen combinations and no bridge request on installation", () => {
  assert.equal(storyPolicyStates.length, 4);
  assert.equal(new Set(storyPolicyStates).size, 4);
  for (const state of storyPolicyStates) {
    const { a } = setup(state);
    assert.deepEqual([a.reads, a.writes, a.forbidden], [[], [], []]);
  }
});
test("default blank parent never inherits video77 and exact zero/1000 acknowledgements advance revisions", async () => {
  const { b, a } = setup();
  assert.equal((await b.getStoryCreationFailurePolicy(id)).policy.failure_limit, null);
  assert.equal((await b.getGenerationFailurePolicy(id)).policy.failure_limit, 77);
  for (const [expected_revision, failure_limit] of [
    [0, 0],
    [1, 1000],
  ]) {
    const r = await b.configureStoryCreationFailurePolicy(id, { expected_revision, failure_limit });
    assert.deepEqual(r.policy, {
      state: "CONFIGURED",
      revision: expected_revision + 1,
      failure_limit,
      scope: "GROK_STORY_CREATION_FAILURES",
    });
  }
  assert.equal(a.writes.length, 2);
});
test("default CAS conflict requires an explicit fresh revision and no write is auto repeated", async () => {
  const { b, a } = setup("story-policy-conflict");
  assert.deepEqual(
    await b.configureStoryCreationFailurePolicy(id, { expected_revision: 0, failure_limit: 7 }),
    { kind: "FAILED", code: "POLICY_CHANGED" },
  );
  const r = await b.getStoryCreationFailurePolicy(id);
  assert.equal(r.policy.revision, 1);
  assert.equal(a.writes.length, 1);
  assert.equal(
    (await b.configureStoryCreationFailurePolicy(id, { expected_revision: 1, failure_limit: 7 }))
      .policy.failure_limit,
    7,
  );
});
test("default unknown returns one unresolved GET before readback, without repeating native PUT", async () => {
  const { b, a } = setup("story-policy-unknown");
  await b.getStoryCreationFailurePolicy(id);
  assert.deepEqual(
    await b.configureStoryCreationFailurePolicy(id, { expected_revision: 0, failure_limit: 3 }),
    { kind: "FAILED", code: "WRITE_UNCONFIRMED" },
  );
  assert.deepEqual(await b.getStoryCreationFailurePolicy(id), {
    kind: "FAILED",
    code: "WRITE_UNCONFIRMED",
  });
  assert.equal((await b.getStoryCreationFailurePolicy(id)).policy.failure_limit, 3);
  assert.equal(a.writes.length, 1);
  assert.equal(a.reads.length, 3);
});
test("default session admits held native PUT without mode override; another scope remains blank", async () => {
  const { b, a } = setup("story-policy-session");
  let settled = false;
  const p = b
    .configureStoryCreationFailurePolicy(id, { expected_revision: 0, failure_limit: 3 })
    .then((r) => {
      settled = true;
      return r;
    });
  assert.equal(a.pending.length, 1);
  assert.equal(settled, false);
  assert.equal(
    (await b.getStoryCreationFailurePolicy(`prj_${"b".repeat(32)}`)).policy.failure_limit,
    null,
  );
  a.release(0);
  assert.equal((await p).policy.failure_limit, 3);
  assert.throws(() => a.release(0));
  a.heldReads = true;
  const reading = b.getStoryCreationFailurePolicy(id);
  assert.equal(a.pending.length, 2);
  a.release(1);
  assert.equal((await reading).policy.revision, 1);
});
test("invalid API identity, extra keys, bounds and every explicit paid/create method are refused", async () => {
  const { b, a } = setup();
  for (const input of [
    { expected_revision: 0, failure_limit: -1 },
    { expected_revision: 0, failure_limit: 1.5 },
    { expected_revision: 0, failure_limit: 1001 },
    { expected_revision: 0, failure_limit: 0, extra: "PRIVATE" },
  ])
    await assert.rejects(b.configureStoryCreationFailurePolicy(id, input));
  await assert.rejects(b.getStoryCreationFailurePolicy("local-film"));
  for (const method of [
    "createProject",
    "createStoryFilm",
    "createFilmVideo",
    "generateFilmRange",
    "prepareFilmRange",
    "submitGeneration",
    "assembleFilm",
    "assembleFilmProject",
  ])
    await assert.rejects(b[method]());
  for (const method of ["completeText", "generateVideo", "speak"])
    await assert.rejects(window.aijianGrok[method]());
  assert.deepEqual(a.writes, []);
});
const root = fileURLToPath(new URL("../../../", import.meta.url));
test("story policy CLI keeps fixed sixteen and rejects unsafe flags without exposing private arguments", () => {
  const entry = path.join(root, "apps/studio-web/e2e/pro-story-policy-audit.mjs"),
    help = spawnSync(process.execPath, [entry, "--help"], { cwd: root, encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /4 states.*16 expected/);
  assert.match(help.stdout, /sandbox is always enabled/);
  for (const args of [
    ["--unknown", "PRIVATE_TOKEN"],
    ["--url", "https://PRIVATE_HOST/"],
    ["--out", path.join(root, "apps/PRIVATE_OUTPUT")],
  ]) {
    const result = spawnSync(process.execPath, [entry, ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 2);
    assert(!/PRIVATE/.test(result.stdout + result.stderr));
  }
});
test("story policy annotations allow only fixed states, labels, bounded geometry/lines and at most eight entries", async () => {
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8"),
    lines = [];
  runInNewContext(
    source.slice(source.indexOf("function auditIdentity"), source.indexOf("function options")) +
      ';emitGitHubErrors(report,{kind:"story-policy"});',
    {
      process: { env: { GITHUB_ACTIONS: "true" } },
      storyPolicyStates,
      console: { error: (line) => lines.push(line) },
      report: {
        exitCode: 1,
        results: Array.from({ length: 12 }, (_, i) => ({
          passed: false,
          reached: true,
          page: i ? "PRIVATE_STATE" : storyPolicyStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${storyPolicyStates[0]}`,
          checkLine: i ? Infinity : 99,
          error: "PRIVATE_BODY",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: i ? "PRIVATE" : 10, y: 20, width: 50, height: 30 },
                diagnostic: {
                  control: i ? "PRIVATE_CONTROL" : "story-policy-save",
                  tag: "BUTTON",
                  hitTag: i ? "PRIVATE" : "DIV",
                  hitClasses: ["PRIVATE_CLASS"],
                  point: { x: 20, y: 20 },
                },
              },
            ],
          },
        })),
      },
    },
  );
  assert.equal(lines.length, 8);
  assert.match(lines[0], /PRO_STORY_POLICY_AUDIT/);
  assert.match(lines[0], /state=story-policy-values/);
  assert.match(lines[0], /checkLine=99/);
  assert.match(lines[0], /control1=story-policy-save/);
  assert(lines.every((line) => !/PRIVATE|Infinity|NaN/.test(line)));
  const start = source.indexOf("    const expected =\n"),
    end = source.indexOf("    report.expectedResults = expected;");
  assert.equal(
    runInNewContext(source.slice(start, end) + ";expected", {
      profile: { kind: "story-policy" },
      storyPolicyStates,
      viewports: [1, 2],
      aspects: [1, 2],
    }),
    16,
  );
});
test("actual setup failure reports sixteen expected combinations with sandbox enabled and no successful cases", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "story-policy-cli-"));
  try {
    const entry = path.join(root, "apps/studio-web/e2e/pro-story-policy-audit.mjs"),
      result = spawnSync(
        process.execPath,
        [entry, "--browser", "/nonexistent/story-policy-chrome", "--out", out],
        { cwd: root, encoding: "utf8" },
      );
    assert.equal(result.status, 2);
    const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
    assert.equal(report.expectedResults, 16);
    assert.equal(report.chromiumSandbox, true);
    assert.equal(report.exitCode, 2);
    assert.deepEqual(report.results, []);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
