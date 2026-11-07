/** Node-only default ABI/safe CLI contract; never a Vitest test module. */
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { test, afterEach } from "node:test";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import { installEvidenceLegacyBridge } from "./pro-evidence-legacy-fixture.mjs";
import {
  installUiInteractionsBridge,
  observeUiSeekMetadata,
  seedUiInteractionsProject,
} from "./pro-ui-interactions-fixture.mjs";
import { uiInteractionStates } from "./pro-ui-interactions-cases.mjs";
const original = globalThis.window;
afterEach(() => {
  globalThis.window = original;
});
function setup(state = uiInteractionStates[0]) {
  const storage = {
    getItem(key) {
      return this[key] ?? null;
    },
    setItem(key, value) {
      this[key] = value;
    },
    removeItem(key) {
      delete this[key];
    },
  };
  globalThis.window = {
    localStorage: storage,
    crypto: webcrypto,
    TextEncoder: globalThis.TextEncoder,
    addEventListener() {},
  };
  installExportQcBridge({ state: "clean", aspect: "16:9" });
  installCreationBridge({ state });
  installAssemblyAuditBridge({ mode: "complete" });
  installEvidenceLegacyBridge({ state });
  installUiInteractionsBridge();
  const film = {
    id: "film_ui_interactions",
    seriesId: "series_ui_interactions",
    title: "原作品",
    seriesTitle: "原作品",
    shots: Array.from({ length: 6 }, (_, i) => ({
      id: `shot-${i}`,
      sceneId: "scene",
      selectedTakeId: `take-${i}`,
      sound: { source: "dub", ambience: "old", musicMood: "old" },
      takes: Array.from({ length: 3 }, (_, n) => ({
        id: `take-${i}-${n}`,
        index: n + 1,
        status: "done",
        videoPath: `/synthetic/${i}-${n}.mp4`,
      })),
    })),
    audioClips: [],
  };
  storage.setItem("aivora.film.active", JSON.stringify(film));
  storage.setItem("aivora.film.activeId", film.id);
  storage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
  return { film, storage, b: window.aijian, a: window.__uiInteractionsAudit };
}
test("four fixed states retain default local-only capabilities and sixteen combinations", () => {
  assert.equal(uiInteractionStates.length, 4);
  assert.equal(new Set(uiInteractionStates).size, 4);
  for (const state of uiInteractionStates) {
    const { a } = setup(state);
    assert.deepEqual(a, { renames: [], orphanRefusals: [], forbidden: [] });
    assert.equal(window.__assemblyAudit.calls.length, 0);
  }
});
test("default seeding retains six shots and every original version while making field counts deterministic", () => {
  const f = setup(),
    before = JSON.parse(JSON.stringify(f.film));
  const seed = seedUiInteractionsProject();
  const raw = window.__proCreationAudit.record(seed.projectId);
  assert.equal(raw.shots.length, 6);
  assert.deepEqual(
    raw.shots.map((s) => s.takes),
    before.shots.map((s) => s.takes),
  );
  assert.deepEqual(raw.shots[0].sound, { source: "native", ambience: "", musicMood: "" });
  assert.deepEqual(window.__uiInteractionsAudit.renames, []);
});
test("native rename preserves complete media and independent episode records; no implicit active selection change", async () => {
  const f = setup();
  f.storage.setItem("aivora.film.v1.other", JSON.stringify({ ...f.film, id: "other" }));
  await f.b.renameFilmSeries(f.film.seriesId, "新作品名");
  for (const id of [f.film.id, "other"]) {
    const raw = window.__proCreationAudit.record(id);
    assert.equal(raw.seriesTitle, "新作品名");
    assert.deepEqual(raw.shots, f.film.shots);
  }
  assert.equal(f.storage.getItem("aivora.film.activeId"), f.film.id);
  assert.equal(f.a.renames.length, 1);
});
test("invalid rename identity/text is refused instead of mutating a foreign record", async () => {
  const f = setup();
  for (const [series, title] of [
    ["missing", "name"],
    [f.film.seriesId, ""],
    [f.film.seriesId, " name "],
  ])
    await assert.rejects(f.b.renameFilmSeries(series, title));
  assert.equal(f.a.renames.length, 0);
  assert.deepEqual(window.__proCreationAudit.record(f.film.id), f.film);
});
test("retained orphan clip analysis receives SOURCE_CHANGED, never invented waveform or generic paid allowance", async () => {
  const f = setup();
  f.film.audioClips = [
    { id: "legacy-voice-0", shotId: "removed-shot", path: "/synthetic/voice-0.wav" },
  ];
  f.storage.setItem(`aivora.film.v1.${f.film.id}`, JSON.stringify(f.film));
  const input = {
    projectId: f.film.id,
    clipId: "legacy-voice-0",
    expectedSourceKey: "a".repeat(64),
  };
  assert.deepEqual(await f.b.readFilmAudioWaveform(input), {
    kind: "FAILED",
    code: "SOURCE_CHANGED",
  });
  assert.equal(f.a.orphanRefusals.length, 1);
  await assert.rejects(f.b.readFilmAudioWaveform({ ...input, expectedSourceKey: "PRIVATE" }));
  assert.equal(f.a.forbidden.length, 1);
});
test("generation, text, voice, legacy assembly and project creation remain closed", async () => {
  const f = setup();
  for (const method of [
    "createProject",
    "createStoryFilm",
    "generateFilmStill",
    "generateFilmVideo",
    "generateFilmRange",
    "assembleFilm",
  ])
    await assert.rejects(f.b[method]());
  for (const method of ["completeText", "generateVideo", "speak"])
    await assert.rejects(window.aijianGrok[method]());
  assert.equal(f.a.renames.length, 0);
  assert.equal(window.__assemblyAudit.calls.length, 0);
});
const root = fileURLToPath(new URL("../../../", import.meta.url));
test("UI interaction CLI keeps fixed sixteen and rejects unsafe flags without exposing private arguments", () => {
  const entry = path.join(root, "apps/studio-web/e2e/pro-ui-interactions-audit.mjs"),
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
test("UI interaction annotations allow only fixed states, labels, bounded geometry/lines and at most eight entries", async () => {
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8"),
    lines = [];
  runInNewContext(
    source.slice(source.indexOf("function auditIdentity"), source.indexOf("function options")) +
      ';emitGitHubErrors(report,{kind:"ui-interactions"});',
    {
      process: { env: { GITHUB_ACTIONS: "true" } },
      uiInteractionStates,
      console: { error: (line) => lines.push(line) },
      report: {
        exitCode: 1,
        results: Array.from({ length: 12 }, (_, i) => ({
          passed: false,
          reached: true,
          page: i ? "PRIVATE_STATE" : uiInteractionStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${uiInteractionStates[0]}`,
          checkLine: i ? Infinity : 99,
          error: "PRIVATE_BODY",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: i ? "PRIVATE" : 10, y: 20, width: 50, height: 30 },
                diagnostic: {
                  control: i ? "PRIVATE_CONTROL" : "interaction-more",
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
  assert.match(lines[0], /PRO_UI_INTERACTIONS_AUDIT/);
  assert.match(lines[0], /state=ui-context-menus/);
  assert.match(lines[0], /checkLine=99/);
  assert.match(lines[0], /control1=interaction-more/);
  assert(lines.every((line) => !/PRIVATE|Infinity|NaN/.test(line)));
  const start = source.indexOf("    const expected =\n"),
    end = source.indexOf("    report.expectedResults = expected;");
  assert.equal(
    runInNewContext(source.slice(start, end) + ";expected", {
      profile: { kind: "ui-interactions" },
      uiInteractionStates,
      viewports: [1, 2],
      aspects: [1, 2],
    }),
    16,
  );
});
test("actual setup failure reports sixteen expected combinations with sandbox enabled and no successful cases", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "ui-interactions-cli-"));
  try {
    const entry = path.join(root, "apps/studio-web/e2e/pro-ui-interactions-audit.mjs"),
      result = spawnSync(
        process.execPath,
        [entry, "--browser", "/nonexistent/ui-interactions-chrome", "--out", out],
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

test("seek admission observation delegates real native listener lifecycle without changing media state", () => {
  setup();
  const video = new globalThis.EventTarget();
  const state = observeUiSeekMetadata(video);
  assert.equal(state.registrations, 0);
  let callbacks = 0;
  video.addEventListener(
    "loadedmetadata",
    () => {
      callbacks += 1;
    },
    { once: true },
  );
  assert.equal(state.registrations, 1);
  video.dispatchEvent(new globalThis.Event("loadedmetadata"));
  video.dispatchEvent(new globalThis.Event("loadedmetadata"));
  assert.equal(callbacks, 1);
  video.addEventListener("timeupdate", () => undefined);
  assert.equal(state.registrations, 1);
  assert.equal(Object.hasOwn(video, "currentTime"), false);
  assert.equal(Object.hasOwn(video, "duration"), false);
  assert.equal(Object.hasOwn(video, "readyState"), false);
});
