import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import {
  installVideoRecoveryBridge,
  seedVideoRecoveryProject,
} from "./pro-video-recovery-fixture.mjs";
import { videoRecoveryStates } from "./pro-video-recovery-cases.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const previous = globalThis.window;
afterEach(() => {
  globalThis.window = previous;
});
function setup(state = "recovery-success") {
  const film = {
    id: "film_recoverymain00001",
    seriesId: "film_recoveryseries01",
    title: "合成找回作品",
    seriesTitle: "合成找回作品",
    episodeNo: 1,
    episodeTitle: "第 1 集",
    shots: Array.from({ length: 6 }, (_, i) => ({
      id: `shot-${i + 1}`,
      selectedTakeId: `take-${i + 1}-1`,
      takes: Array.from({ length: 3 }, (_, j) => ({
        id: `take-${i + 1}-${j + 1}`,
        status: "done",
        index: j + 1,
        videoPath: `/synthetic/${i + 1}-${j + 1}.mp4`,
      })),
    })),
    audioClips: [
      {
        id: "voice-original",
        lane: "dialogue",
        shotId: "shot-1",
        takeId: "take-1-1",
        path: "/synthetic/voice.wav",
      },
    ],
  };
  const storage = { "aivora.film.active": JSON.stringify(film) };
  Object.defineProperties(storage, {
    getItem: { value: (key) => storage[key] ?? null },
    setItem: {
      value: (key, value) => {
        storage[key] = value;
      },
    },
  });
  globalThis.window = {
    localStorage: storage,
    aijian: {
      writeFilmProject: async (value) => {
        storage[`aivora.film.v1.${value.id}`] = JSON.stringify(value);
        return JSON.parse(JSON.stringify(value));
      },
    },
    aijianGrok: {},
  };
  const seed = seedVideoRecoveryProject({ state });
  installVideoRecoveryBridge({ state });
  return {
    seed,
    bridge: window.aijian,
    audit: window.__proVideoRecoveryAudit,
    record: (id) => JSON.parse(storage[`aivora.film.v1.${id}`]),
    attemptId: "a".repeat(32),
    film,
  };
}
test("four fixed modes declare exactly sixteen combinations", () => {
  assert.equal(videoRecoveryStates.length, 4);
  assert.equal(new Set(videoRecoveryStates).size, 4);
});
test("default success begins with zero RPCs and really lists, recovers, cancels then saves through three distinct methods", async () => {
  const f = setup(),
    before = f.record(f.seed.projectId);
  assert.deepEqual(f.audit.lists, []);
  assert.deepEqual(f.audit.recovers, []);
  assert.deepEqual(f.audit.saves, []);
  const listed = await f.bridge.listGenerationVideoRecoveries(f.seed.backendProjectId);
  assert.equal(listed.items[0].state, "UNKNOWN");
  assert.equal(f.audit.recovers.length, 0);
  const recovered = await f.bridge.recoverGenerationVideo(f.seed.backendProjectId, f.attemptId);
  assert.equal(recovered.kind, "RECOVERED");
  assert.match(recovered.file.sha256, /^[a-f0-9]{64}$/);
  assert.equal(recovered.file.fileName, `recovered-${f.attemptId}.mp4`);
  assert.equal(
    (await f.bridge.saveRecoveredGenerationVideo(f.seed.backendProjectId, f.attemptId)).kind,
    "CANCELLED",
  );
  assert.equal(
    (await f.bridge.saveRecoveredGenerationVideo(f.seed.backendProjectId, f.attemptId)).kind,
    "SAVED",
  );
  assert.deepEqual(f.record(f.seed.projectId), before);
  assert.deepEqual(f.audit.writes, []);
});
test("default unknown produces WAITING then write-unconfirmed; only explicit fresh list exposes a known file and no call auto-repeats", async () => {
  const f = setup("recovery-unknown");
  await f.bridge.listGenerationVideoRecoveries(f.seed.backendProjectId);
  assert.equal(
    (await f.bridge.recoverGenerationVideo(f.seed.backendProjectId, f.attemptId)).reason,
    "WAITING",
  );
  assert.equal(
    (await f.bridge.recoverGenerationVideo(f.seed.backendProjectId, f.attemptId)).code,
    "WRITE_UNCONFIRMED",
  );
  assert.equal(f.audit.recovers.length, 2);
  const fresh = await f.bridge.listGenerationVideoRecoveries(f.seed.backendProjectId);
  assert.equal(fresh.items[0].state, "RECOVERED");
  assert.equal(
    (await f.bridge.saveRecoveredGenerationVideo(f.seed.backendProjectId, f.attemptId)).code,
    "WRITE_UNCONFIRMED",
  );
  await f.bridge.listGenerationVideoRecoveries(f.seed.backendProjectId);
  assert.equal(f.audit.saves.length, 1);
  assert.equal(f.audit.recovers.length, 2);
});
test("late default really admits a held recover before release and isolates the other project's empty list", async () => {
  const f = setup("recovery-late"),
    before = f.record(f.seed.otherId);
  let settled = false;
  const pending = f.bridge
    .recoverGenerationVideo(f.seed.backendProjectId, f.attemptId)
    .then((result) => {
      settled = true;
      return result;
    });
  await Promise.resolve();
  assert.equal(f.audit.pending.length, 1);
  assert.equal(settled, false);
  assert.deepEqual(
    (await f.bridge.listGenerationVideoRecoveries(f.seed.otherBackendProjectId)).items,
    [],
  );
  f.audit.release(0);
  assert.equal((await pending).kind, "RECOVERED");
  assert.deepEqual(f.record(f.seed.otherId), before);
  assert.deepEqual(f.audit.writes, []);
  assert.equal(f.audit.saves.length, 0);
});
test("unavailable default genuinely lacks all optional methods; enabling controlled capability never manufactures the other work's API identity", async () => {
  const f = setup("recovery-unavailable");
  assert.equal(f.bridge.listGenerationVideoRecoveries, undefined);
  assert.equal(f.bridge.recoverGenerationVideo, undefined);
  assert.equal(f.bridge.saveRecoveredGenerationVideo, undefined);
  assert.equal(f.seed.otherBackendProjectId, "");
  assert.deepEqual(f.audit.lists, []);
  f.audit.exposeNative();
  assert.equal(typeof f.bridge.listGenerationVideoRecoveries, "function");
  await assert.rejects(f.bridge.listGenerationVideoRecoveries(""));
  assert.deepEqual(f.audit.forbidden, ["invalid-project"]);
});
test("initial fixture preserves six shots/three takes and original audio; current and other API scopes are distinct", () => {
  const f = setup();
  assert.equal(f.record(f.seed.projectId).shots.length, 6);
  assert(f.record(f.seed.projectId).shots.every((shot) => shot.takes.length === 3));
  assert.deepEqual(f.record(f.seed.projectId).shots, f.film.shots);
  assert.deepEqual(f.record(f.seed.projectId).audioClips, f.film.audioClips);
  assert.notEqual(f.seed.backendProjectId, f.seed.otherBackendProjectId);
});
test("unknown scope/attempt, generation, project creation and legacy export remain explicitly forbidden", async () => {
  const f = setup();
  await assert.rejects(f.bridge.recoverGenerationVideo(f.seed.backendProjectId, "wrong-attempt"));
  await assert.rejects(f.bridge.createStoryFilm());
  await assert.rejects(f.bridge.createProject());
  await assert.rejects(f.bridge.exportFilmCut());
  await assert.rejects(window.aijianGrok.completeText());
  assert.deepEqual(f.audit.forbidden, [
    "invalid-attempt",
    "createStoryFilm",
    "createProject",
    "exportFilmCut",
    "completeText",
  ]);
});
test("CLI declares sixteen and rejects unsafe flags/output without printing private argument values", async () => {
  const entry = path.join(root, "apps/studio-web/e2e/pro-video-recovery-audit.mjs");
  const help = spawnSync(process.execPath, [entry, "--help"], { cwd: root, encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /4 states.*16 expected/);
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
      ';emitGitHubErrors(report,{kind:"video-recovery"});',
    {
      process: { env: { GITHUB_ACTIONS: "true" } },
      videoRecoveryStates,
      console: { error: (line) => lines.push(line) },
      report: {
        exitCode: 1,
        results: Array.from({ length: 12 }, (_, i) => ({
          passed: false,
          reached: true,
          page: i ? "PRIVATE_BODY" : videoRecoveryStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${videoRecoveryStates[0]}`,
          checkLine: i ? Infinity : 88,
          error: "PRIVATE_TOKEN",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: NaN, y: Infinity, width: 20, height: 18 },
                diagnostic: {
                  control: i ? "PRIVATE_CONTROL" : "recovery-get",
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
  assert(lines[0].includes("PRO_VIDEO_RECOVERY_AUDIT"));
  assert(lines[0].includes("checkLine=88"));
  assert(lines[0].includes("control1=recovery-get"));
  assert(lines.every((line) => !/PRIVATE|NaN|Infinity/.test(line)));
  const start = source.indexOf("    const expected =\n"),
    end = source.indexOf("    report.expectedResults = expected;");
  assert.equal(
    runInNewContext(source.slice(start, end) + ";expected", {
      profile: { kind: "video-recovery" },
      videoRecoveryStates,
      viewports: [1, 2],
      aspects: [1, 2],
    }),
    16,
  );
});

test("real CLI setup failure retains sixteen expected combinations and sandbox metadata without launching a browser", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "video-recovery-negative-"));
  const out = path.join(folder, "missing-browser-report");
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "apps/studio-web/e2e/pro-video-recovery-audit.mjs"),
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
    assert.equal(report.expectedResults, 16);
    assert.deepEqual(report.expectedStates, videoRecoveryStates);
    assert.equal(report.results.length, 0);
    assert.equal(report.exitCode, 2);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
