import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { installActualTrialBridge } from "./pro-actual-trial-fixture.mjs";
import { actualTrialStates } from "./pro-actual-trial-cases.mjs";
const previous = globalThis.window;
afterEach(() => {
  globalThis.window = previous;
});
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, stable(v)]),
        )
      : value;
const hash = async (value) =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
function setup(state = "trial-needs-changes") {
  const film = {
    id: "film_actualtrialmain01",
    seriesId: "film_trialseries00001",
    title: "合成试片",
    styleZh: "原画风",
    savedAt: "",
    scenes: [{ id: "scene", no: 7 }],
    shots: Array.from({ length: 6 }, (_, i) => ({
      id: `shot-${i}`,
      sceneId: "scene",
      no: i + 1,
      selectedTakeId: `take-${i}-1`,
      takes: Array.from({ length: 3 }, (_, j) => ({
        id: `take-${i}-${j + 1}`,
        shotId: `shot-${i}`,
        index: j + 1,
        status: "done",
        videoPath: `/synthetic/${i}-${j}.mp4`,
        prompt: "原说明",
        createdAt: "",
      })),
    })),
    audioClips: [{ id: "old-audio", label: "旧声音", path: "/synthetic/original.wav" }],
  };
  const storage = {};
  Object.defineProperties(storage, {
    getItem: { value: (key) => storage[key] ?? null },
    setItem: {
      value: (key, value) => {
        storage[key] = value;
      },
    },
  });
  storage[`aivora.film.v1.${film.id}`] = JSON.stringify(film);
  storage["aivora.film.activeId"] = film.id;
  storage["aivora.film.active"] = JSON.stringify(film);
  const clone = (value) => JSON.parse(JSON.stringify(value)),
    raw = (id) =>
      storage[`aivora.film.v1.${id}`] ? JSON.parse(storage[`aivora.film.v1.${id}`]) : null;
  globalThis.window = {
    localStorage: storage,
    aijian: {},
    aijianGrok: {},
    __proCreationAudit: { hash, record: raw },
  };
  installActualTrialBridge({ state, mediaBytes: [1, 2, 3] });
  const bridge = window.aijian,
    audit = window.__actualTrialAudit;
  const input = async () => ({
    projectId: film.id,
    expectedHash: await hash(raw(film.id)),
    shotId: film.shots[0].id,
    takeId: film.shots[0].selectedTakeId,
  });
  const recordInput = async (ready) => ({
    projectId: film.id,
    expectedHash: await hash(raw(film.id)),
    reviewId: ready.reviewId,
    decision: "needs-changes",
    note: "  原文🙂\n  ",
  });
  return { film, bridge, audit, input, recordInput, raw: () => clone(raw(film.id)), storage };
}
test("four fixed actual trial states declare exactly sixteen combinations", () => {
  assert.equal(actualTrialStates.length, 4);
  assert.equal(new Set(actualTrialStates).size, 4);
});
test("default needs-changes starts with zero calls, returns bounded bytes, and appends exactly one intact original note", async () => {
  const f = setup(),
    before = f.raw();
  for (const field of ["prepares", "media", "records", "checks", "captures"])
    assert.deepEqual(f.audit[field], []);
  const ready = await f.bridge.prepareFilmRiskTrial(await f.input());
  assert.equal(ready.kind, "READY");
  assert.equal(ready.batchShotCount, 6);
  assert.equal(ready.existingDecision, null);
  assert.equal(
    (await f.bridge.readFilmRiskTrialMedia(f.film.id, ready.reviewId)).bytes.byteLength,
    3,
  );
  const input = await f.recordInput(ready),
    result = await f.bridge.recordFilmRiskTrialDecision(input);
  assert.equal(result.kind, "RECORDED");
  assert.equal(result.decision.note, input.note);
  assert.deepEqual(f.raw().shots, before.shots);
  assert.deepEqual(f.raw().audioClips, before.audioClips);
  assert.equal(f.raw().riskTrialDecisions.length, 1);
  const again = await f.bridge.prepareFilmRiskTrial(await f.input());
  assert.deepEqual(again.existingDecision, result.decision);
  assert.equal(f.audit.records.length, 1);
  assert.deepEqual(f.audit.checks, []);
  assert.deepEqual(f.audit.forbidden, []);
});
test("default accepted checkpoint closes final check without allowing paid work or auto continuing", async () => {
  const f = setup("trial-accepted-checkpoint"),
    ready = await f.bridge.prepareFilmRiskTrial(await f.input());
  const input = { ...(await f.recordInput(ready)), decision: "accepted" },
    result = await f.bridge.recordFilmRiskTrialDecision(input);
  assert.deepEqual(f.audit.checks, []);
  const checked = await f.bridge.checkFilmRiskTrialDecision({
    projectId: f.film.id,
    expectedHash: await hash(f.raw()),
    decisionId: result.decision.id,
  });
  assert.deepEqual(checked, { kind: "FAILED", code: "REVIEW_STALE", unchanged: true });
  assert.equal(f.audit.checks[0].matched, true);
  assert.equal(
    (
      await f.bridge.captureFilmHistory({
        projectId: f.film.id,
        expectedHash: await hash(f.raw()),
        reason: "before-pipeline",
      })
    ).kind,
    "CAPTURED",
  );
  assert.deepEqual(f.audit.forbidden, []);
});
test("default unknown mode really admits one held write, refuses BUSY, then commits once only on explicit controlled release", async () => {
  const f = setup("trial-unknown-global"),
    before = f.raw(),
    ready = await f.bridge.prepareFilmRiskTrial(await f.input());
  await assert.rejects(
    f.bridge.recordFilmRiskTrialDecision(await f.recordInput(ready)),
    /SYNTHETIC_LOST_TRIAL_ACK/,
  );
  assert.equal(f.audit.pending.length, 1);
  assert.deepEqual(f.raw(), before);
  assert.deepEqual(await f.bridge.prepareFilmRiskTrial(await f.input()), {
    kind: "FAILED",
    code: "BUSY",
    unchanged: true,
  });
  assert.equal(f.audit.records.length, 1);
  await f.audit.release(0);
  assert.equal(f.raw().riskTrialDecisions.length, 1);
  assert.equal(
    (await f.bridge.prepareFilmRiskTrial(await f.input())).existingDecision.note,
    "  原文🙂\n  ",
  );
  assert.equal(f.audit.records.length, 1);
  assert.deepEqual(f.audit.forbidden, []);
});
test("default stale mode holds media only, never writes a decision or changes canonical data", async () => {
  const f = setup("trial-stale-source"),
    before = f.raw(),
    ready = await f.bridge.prepareFilmRiskTrial(await f.input());
  const reading = f.bridge.readFilmRiskTrialMedia(f.film.id, ready.reviewId);
  assert.equal(f.audit.pending.length, 1);
  assert.equal(f.audit.pending[0].kind, "media");
  await f.audit.release(0);
  assert.equal((await reading).kind, "MEDIA");
  assert.deepEqual(f.raw(), before);
  assert.deepEqual(f.audit.records, []);
});
test("foreign writes never pretend to select another project", async () => {
  const f = setup(),
    other = { ...f.raw(), id: "film_actualtrialother01" };
  await f.bridge.writeFilmProject(other);
  assert.equal(f.storage["aivora.film.activeId"], f.film.id);
  assert.equal(JSON.parse(f.storage["aivora.film.active"]).id, f.film.id);
  assert.equal(f.audit.writes.length, 1);
});
test("stale complete raw hash is a structured refusal, not a success or mock assertion", async () => {
  const f = setup(),
    input = { ...(await f.input()), expectedHash: "0".repeat(64) };
  assert.deepEqual(await f.bridge.prepareFilmRiskTrial(input), {
    kind: "FAILED",
    code: "PROJECT_CHANGED",
    unchanged: true,
  });
  assert.equal(f.audit.prepares[0].cas, false);
  assert.deepEqual(f.audit.records, []);
});
test("wrong shape, missing scope, overlong notes and every paid method remain forbidden", async () => {
  const f = setup(),
    ready = await f.bridge.prepareFilmRiskTrial(await f.input());
  await assert.rejects(
    f.bridge.recordFilmRiskTrialDecision({
      ...(await f.recordInput(ready)),
      note: "😀".repeat(251),
    }),
  );
  assert.deepEqual(f.audit.records, []);
  await assert.rejects(f.bridge.prepareFilmRiskTrial({ ...(await f.input()), extra: "PRIVATE" }));
  for (const method of [
    "createProject",
    "createStoryFilm",
    "generateFilmStill",
    "generateFilmVideo",
    "exportFilmCut",
    "assembleFilm",
    "previewVoice",
  ])
    await assert.rejects(f.bridge[method]());
  assert.equal(f.audit.forbidden.length, 9);
});

const root = fileURLToPath(new URL("../../../", import.meta.url));
test("actual trial CLI keeps fixed sixteen and rejects unsafe flags without exposing private arguments", () => {
  const entry = path.join(root, "apps/studio-web/e2e/pro-actual-trial-audit.mjs"),
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
test("actual trial annotations allow only fixed states, labels, bounded geometry/lines and at most eight entries", async () => {
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8"),
    lines = [];
  runInNewContext(
    source.slice(source.indexOf("function auditIdentity"), source.indexOf("function options")) +
      ';emitGitHubErrors(report,{kind:"actual-trial"});',
    {
      process: { env: { GITHUB_ACTIONS: "true" } },
      actualTrialStates,
      console: { error: (line) => lines.push(line) },
      report: {
        exitCode: 1,
        results: Array.from({ length: 12 }, (_, i) => ({
          passed: false,
          reached: true,
          page: i ? "PRIVATE_STATE" : actualTrialStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${actualTrialStates[0]}`,
          checkLine: i ? Infinity : 99,
          error: "PRIVATE_BODY",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: i ? "PRIVATE" : 10, y: 20, width: 50, height: 30 },
                diagnostic: {
                  control: i ? "PRIVATE_CONTROL" : "trial-record",
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
  assert.match(lines[0], /PRO_ACTUAL_TRIAL_AUDIT/);
  assert.match(lines[0], /state=trial-needs-changes/);
  assert.match(lines[0], /checkLine=99/);
  assert.match(lines[0], /control1=trial-record/);
  assert(lines.every((line) => !/PRIVATE|Infinity|NaN/.test(line)));
  const start = source.indexOf("    const expected =\n"),
    end = source.indexOf("    report.expectedResults = expected;");
  assert.equal(
    runInNewContext(source.slice(start, end) + ";expected", {
      profile: { kind: "actual-trial" },
      actualTrialStates,
      viewports: [1, 2],
      aspects: [1, 2],
    }),
    16,
  );
});
test("actual setup failure reports sixteen expected combinations with sandbox enabled and no successful cases", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "actual-trial-cli-"));
  try {
    const entry = path.join(root, "apps/studio-web/e2e/pro-actual-trial-audit.mjs"),
      result = spawnSync(
        process.execPath,
        [entry, "--browser", "/nonexistent/actual-trial-chrome", "--out", out],
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
