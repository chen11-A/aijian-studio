/** Explicit node:test contract, never collected as a Vitest test module. */
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
const root = fileURLToPath(new URL("../../../", import.meta.url));
import { afterEach, test } from "node:test";
import { installRiskPolicyBridge, seedRiskPolicyProject } from "./pro-risk-policy-fixture.mjs";
import { riskPolicyStates } from "./pro-risk-policy-cases.mjs";
const oldWindow = globalThis.window;
afterEach(() => {
  globalThis.window = oldWindow;
});
const id = `prj_${"a".repeat(32)}`;
function setup(state = "policy-zero") {
  globalThis.window = { aijian: {}, aijianGrok: {} };
  installRiskPolicyBridge({ state });
  return { bridge: window.aijian, audit: window.__proRiskPolicyAudit };
}
test("eight fixed states retain four risk and four policy cases", () => {
  assert.equal(riskPolicyStates.length, 8);
  assert.equal(new Set(riskPolicyStates).size, 8);
  assert.equal(riskPolicyStates.filter((s) => s.startsWith("risk-")).length, 4);
  assert.equal(riskPolicyStates.filter((s) => s.startsWith("policy-")).length, 4);
});
test("the actual default mode has no policy default and persists explicit zero through a fresh GET", async () => {
  const { bridge, audit } = setup();
  assert.equal((await bridge.getGenerationFailurePolicy(id)).policy.failure_limit, null);
  assert.equal(
    (await bridge.configureGenerationFailurePolicy(id, { expected_revision: 0, failure_limit: 0 }))
      .policy.failure_limit,
    0,
  );
  assert.equal((await bridge.getGenerationFailurePolicy(id)).policy.revision, 1);
  assert.equal(audit.writes.length, 1);
  assert.deepEqual(audit.forbidden, []);
});
test("conflict mode changes the server revision without silently accepting a stale write", async () => {
  const { bridge, audit } = setup("policy-conflict");
  assert.deepEqual(
    await bridge.configureGenerationFailurePolicy(id, { expected_revision: 0, failure_limit: 7 }),
    { kind: "FAILED", code: "POLICY_CHANGED" },
  );
  assert.equal((await bridge.getGenerationFailurePolicy(id)).policy.failure_limit, 5);
  assert.equal(
    (await bridge.configureGenerationFailurePolicy(id, { expected_revision: 1, failure_limit: 7 }))
      .policy.failure_limit,
    7,
  );
  assert.equal(audit.writes.length, 2);
});
test("unknown mode applies once but requires readback and the session mode really admits a held request by default", async () => {
  let { bridge, audit } = setup("policy-unknown");
  assert.deepEqual(
    await bridge.configureGenerationFailurePolicy(id, { expected_revision: 0, failure_limit: 3 }),
    { kind: "FAILED", code: "WRITE_UNCONFIRMED" },
  );
  assert.equal((await bridge.getGenerationFailurePolicy(id)).policy.failure_limit, 3);
  assert.equal(audit.writes.length, 1);
  ({ bridge, audit } = setup("policy-session"));
  let delivered = false;
  const result = bridge
    .configureGenerationFailurePolicy(id, { expected_revision: 0, failure_limit: 8 })
    .then((value) => {
      delivered = true;
      return value;
    });
  assert.equal(audit.pending.length, 1);
  assert.equal(delivered, false);
  audit.release(0);
  assert.equal((await result).policy.failure_limit, 8);
  assert.equal(delivered, true);
  assert.throws(() => audit.release(0));
});
test("invalid identity, malformed input, project creation and generation remain forbidden", async () => {
  const { bridge, audit } = setup();
  await assert.rejects(
    bridge.configureGenerationFailurePolicy("local-film", {
      expected_revision: 0,
      failure_limit: 0,
    }),
  );
  await assert.rejects(
    bridge.configureGenerationFailurePolicy(id, { expected_revision: 0, failure_limit: 1.5 }),
  );
  await assert.rejects(bridge.createProject());
  await assert.rejects(window.aijianGrok.completeText());
  assert.deepEqual(audit.forbidden, [
    "invalidConfiguration",
    "invalidConfiguration",
    "createProject",
    "completeText",
  ]);
});
test("seed preserves all media and explicit empty choice instead of inventing a default selected take", () => {
  const film = {
    id: "synthetic-film",
    characters: [{ name: "合成甲" }],
    scenes: [{ id: "scene-1", text: "原文" }],
    shots: [
      {
        id: "shot-1",
        sceneId: "scene-1",
        selectedTakeId: "take-1",
        takes: [{ id: "take-1", status: "done", videoPath: "/synthetic/private.mp4" }],
      },
    ],
  };
  const values = new Map([["aivora.film.active", JSON.stringify(film)]]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  seedRiskPolicyProject({ state: "risk-explicit" });
  const saved = JSON.parse(values.get("aivora.film.active"));
  assert.equal(saved.shots[0].selectedTakeId, "");
  assert.deepEqual(saved.shots[0].takes, film.shots[0].takes);
});
test("policy state is isolated by the actual API project rather than leaking across works", async () => {
  const { bridge } = setup();
  await bridge.configureGenerationFailurePolicy(id, { expected_revision: 0, failure_limit: 8 });
  assert.equal(
    (await bridge.getGenerationFailurePolicy(`prj_${"b".repeat(32)}`)).policy.failure_limit,
    null,
  );
  assert.equal((await bridge.getGenerationFailurePolicy(id)).policy.failure_limit, 8);
});

test("CLI declares thirty-two and rejects unsafe flags/output without printing private argument values", async () => {
  const entry = path.join(root, "apps/studio-web/e2e/pro-risk-policy-audit.mjs");
  const help = spawnSync(process.execPath, [entry, "--help"], { cwd: root, encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /8 states.*32 expected/);
  for (const args of [
    ["--unknown", "PRIVATE_TOKEN"],
    ["--url", "https://PRIVATE_HOST/"],
    ["--out", path.join(root, "apps/PRIVATE_OUTPUT")],
  ]) {
    const result = spawnSync(process.execPath, [entry, ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 2);
    assert(!`${result.stdout}${result.stderr}`.includes("PRIVATE"));
  }
});
test("public annotations double-filter states/controls/geometry and bounded lines, at most eight, never raw DOM/path/error", async () => {
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8"),
    lines = [];
  runInNewContext(
    source.slice(source.indexOf("function auditIdentity"), source.indexOf("function options")) +
      ';emitGitHubErrors(report,{kind:"risk-policy"});',
    {
      process: { env: { GITHUB_ACTIONS: "true" } },
      riskPolicyStates,
      console: { error: (line) => lines.push(line) },
      report: {
        exitCode: 1,
        results: Array.from({ length: 12 }, (_, i) => ({
          passed: false,
          reached: true,
          page: i ? "PRIVATE_BODY" : riskPolicyStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${riskPolicyStates[0]}`,
          checkLine: i ? Infinity : 88,
          error: "PRIVATE_TOKEN",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: NaN, y: Infinity, width: 20, height: 18 },
                diagnostic: {
                  control: i ? "PRIVATE_CONTROL" : "policy-save",
                  tag: "PRIVATE_TAG",
                  hitTag: "PRIVATE_TAG",
                  hitClasses: ["PRIVATE_CLASS"],
                },
              },
            ],
          },
        })),
      },
    },
  );
  assert.equal(lines.length, 8);
  assert(lines[0].includes("PRO_RISK_POLICY_AUDIT"));
  assert(lines[0].includes("checkLine=88"));
  assert(lines[0].includes("control1=policy-save"));
  assert(lines.every((line) => !/PRIVATE|NaN|Infinity/.test(line)));
  const start = source.indexOf("    const expected =\n"),
    end = source.indexOf("    report.expectedResults = expected;");
  assert.equal(
    runInNewContext(source.slice(start, end) + ";expected", {
      profile: { kind: "risk-policy" },
      riskPolicyStates,
      viewports: [1, 2],
      aspects: [1, 2],
    }),
    32,
  );
});

test("real CLI setup failure retains thirty-two expected combinations and sandbox metadata without launching a browser", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "risk-policy-contract-"));
  const out = path.join(folder, "missing-browser-report");
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "apps/studio-web/e2e/pro-risk-policy-audit.mjs"),
        "--url",
        "http://127.0.0.1:1/",
        "--browser",
        "/aivora-synthetic-missing-browser",
        "--out",
        out,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 2);
    const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
    assert.equal(report.chromiumSandbox, true);
    assert.equal(report.expectedResults, 32);
    assert.deepEqual(report.expectedStates, riskPolicyStates);
    assert.equal(report.results.length, 0);
    assert.equal(report.exitCode, 2);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
