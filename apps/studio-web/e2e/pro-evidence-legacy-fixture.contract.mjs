import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, before, after, test } from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { createServer } from "vite";
import {
  installEvidenceLegacyBridge,
  seedEvidenceLegacyProject,
} from "./pro-evidence-legacy-fixture.mjs";
import { evidenceLegacyStates } from "./pro-evidence-legacy-cases.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url));
let server, folder, view, audioSourceKey;
before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "evidence-legacy-contract-"));
  server = await createServer({
    root: path.join(root, "apps/studio-web"),
    configFile: path.join(root, "apps/studio-web/vite.config.ts"),
    cacheDir: path.join(folder, "vite-cache"),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
  });
  view = await server.ssrLoadModule("/src/aivora/pro/actions/delivery-evidence-view.ts");
  ({ audioSourceKey } = await server.ssrLoadModule("/src/aivora/pro/actions/audio-waveforms.ts"));
});
after(async () => {
  await server?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
const oldWindow = globalThis.window;
afterEach(() => {
  globalThis.window = oldWindow;
});
function setup(state = "evidence-written") {
  const film = {
    id: "evidence-main-project",
    scenes: [{ id: "scene-main", no: 7 }],
    shots: [
      {
        id: "shot-main",
        sceneId: "scene-main",
        no: 4,
        selectedTakeId: "take-main",
        takes: [{ id: "take-main", index: 3, status: "done", videoPath: "/synthetic/source.mp4" }],
      },
    ],
  };
  globalThis.window = {
    aijian: {},
    aijianGrok: {},
    __proCreationAudit: {
      hash: async (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
      record: (id) => (id === film.id ? globalThis.structuredClone(film) : null),
    },
  };
  installEvidenceLegacyBridge({ state });
  const input = {
    projectId: film.id,
    expectedSelection: [{ shotId: "shot-main", takeId: "take-main" }],
    settings: {
      aspects: ["16:9", "9:16"],
      quality: "1080p",
      subtitles: "srt",
      style: "white",
      aiMark: true,
    },
  };
  async function publish() {
    const ready = await window.aijian.prepareFilmExport(
      input,
      `prepare-${window.__proEvidenceLegacyAudit.prepares.length + 1}`,
    );
    return window.aijian.publishFilmExport(
      { ...input, qcReceipt: ready.qcReceipt },
      `publish-${window.__proEvidenceLegacyAudit.publishes.length + 1}`,
    );
  }
  return { film, input, publish, bridge: window.aijian, audit: window.__proEvidenceLegacyAudit };
}
test("fixed eight states contain four evidence and four existing interaction bundles", () => {
  assert.equal(evidenceLegacyStates.length, 8);
  assert.equal(new Set(evidenceLegacyStates).size, 8);
  assert.equal(evidenceLegacyStates.filter((s) => s.startsWith("legacy-")).length, 4);
});
test("default actual fixture mode has a real review lifecycle and keeps all written files, real labels and unknown facts", async () => {
  const f = setup(),
    result = await f.publish();
  assert.equal(result.kind, "PUBLISHED");
  assert.equal(result.deliveryEvidence.kind, "WRITTEN");
  assert.equal(f.audit.prepares.length, 1);
  assert.equal(f.audit.publishes.length, 1);
  assert.equal(result.outputs.length, 2);
  assert.equal(result.deliveryEvidence.manifest.files.length, 4);
  assert.equal(result.deliveryEvidence.manifest.selection[0].label, "第 7 场 · 镜头 4");
  assert.equal(result.deliveryEvidence.manifest.selection[0].versionLabel, "第 3 版");
  assert.deepEqual(result.deliveryEvidence.manifest.settings, f.input.settings);
  assert.equal(result.deliveryEvidence.manifest.unverified.length, 6);
  assert.equal(view.deliveryEvidenceView(result.deliveryEvidence, result.kind).kind, "written");
  assert.deepEqual(f.audit.forbidden, []);
});
test("partial includes only the first written aspect without inventing the missing video or sidecars", async () => {
  const f = setup("evidence-partial"),
    result = await f.publish();
  assert.equal(result.kind, "PARTIAL");
  assert.equal(result.outputs.length, 1);
  assert.equal(result.deliveryEvidence.manifest.status, "partial");
  assert.equal(result.deliveryEvidence.manifest.files.length, 2);
  assert(result.deliveryEvidence.manifest.files.every((file) => file.aspectRatio === "16:9"));
  assert.equal(result.deliveryEvidence.manifest.files[0].technical.audioTracks, null);
  const cleanup = await f.publish();
  assert.equal(cleanup.kind, "PARTIAL");
  assert.equal(cleanup.deliveryEvidence.kind, "WRITTEN");
  assert.equal(cleanup.deliveryEvidence.cleanupUnconfirmed, true);
  assert.equal(cleanup.deliveryEvidence.manifest.status, "complete");
  assert.equal(Object.hasOwn(cleanup.deliveryEvidence.manifest, "cleanupUnconfirmed"), false);
  assert.equal(cleanup.deliveryEvidence.manifest.files.length, 4);
  assert.equal(view.deliveryEvidenceView(cleanup.deliveryEvidence, cleanup.kind).kind, "written");
});
test("failed/legacy mode really changes on two distinct explicit publishes rather than returning fabricated evidence", async () => {
  const f = setup("evidence-failed-legacy"),
    first = await f.publish(),
    second = await f.publish();
  assert.equal(first.kind, "PARTIAL");
  assert.equal(first.deliveryEvidence.kind, "FAILED");
  assert.equal(first.deliveryEvidence.files.length, 2);
  assert(first.deliveryEvidence.files.every((file) => !Object.hasOwn(file, "sha256")));
  assert.equal(second.kind, "PUBLISHED");
  assert.equal(Object.hasOwn(second, "deliveryEvidence"), false);
  assert.equal(f.audit.publishes.length, 2);
});
test("stale mode actually admits and holds the second publish by default until explicitly released", async () => {
  const f = setup("evidence-stale");
  await f.publish();
  let delivered = false;
  const promise = f.publish().then((value) => {
    delivered = true;
    return value;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.audit.pending.length, 1);
  assert.equal(delivered, false);
  assert.deepEqual(await f.bridge.cancelFilmExportOperation("publish-2"), { kind: "UNAVAILABLE" });
  assert.equal(delivered, false);
  f.audit.release(0);
  assert.equal((await promise).kind, "PUBLISHED");
  assert.equal(delivered, true);
  assert.throws(() => f.audit.release(0));
});
test("receipt/settings/selection mismatch and unexpected paid or legacy dispatch remain forbidden", async () => {
  const f = setup(),
    ready = await f.bridge.prepareFilmExport(f.input, "prepare-1");
  await assert.rejects(
    f.bridge.publishFilmExport(
      {
        ...f.input,
        settings: { ...f.input.settings, quality: "720p" },
        qcReceipt: ready.qcReceipt,
      },
      "publish-1",
    ),
  );
  await assert.rejects(f.bridge.createStoryFilm());
  await assert.rejects(window.aijianGrok.completeText());
  assert.deepEqual(f.audit.forbidden, ["publishScope", "createStoryFilm", "completeText"]);
});
test("the legacy seed keeps all audio/take references; empty/search modify only their actual scenario input", () => {
  const make = () => ({
    id: "seed-work",
    scenes: [{ id: "scene-1", no: 1 }],
    characters: [{ id: "person-1", name: "合成甲", portraits: [] }],
    shots: [
      {
        id: "shot-1",
        sceneId: "scene-1",
        no: 1,
        poster: "synthetic-first-frame",
        selectedTakeId: "take-1",
        takes: [{ id: "take-1", status: "done", index: 1, videoPath: "/synthetic/one.mp4" }],
      },
    ],
  });
  for (const state of ["legacy-board-drag-bulk", "legacy-empty-fullscreen", "legacy-cast-search"]) {
    const film = make(),
      values = new Map([["aivora.film.active", JSON.stringify(film)]]);
    globalThis.window = {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    };
    seedEvidenceLegacyProject({ state });
    const saved = JSON.parse(values.get("aivora.film.active"));
    assert.equal(saved.audioClips[0].takeId, "take-1");
    if (state === "legacy-empty-fullscreen") {
      assert.deepEqual(saved.shots[0].takes, []);
      assert.equal(saved.shots[0].poster, film.shots[0].poster);
    } else assert.deepEqual(saved.shots[0].takes, film.shots[0].takes);
    if (state === "legacy-cast-search") assert.equal(saved.characters.length, 12);
  }
});

test("local waveform refusal validates exact canonical source keys and clip/selection scope without enabling paid dispatch", async () => {
  const f = setup();
  Object.assign(f.film, {
    seriesId: "synthetic-series",
    backendProjectId: `prj_${"a".repeat(32)}`,
  });
  const clip = {
    id: "voice-main",
    lane: "dialogue",
    shotId: "shot-main",
    takeId: "take-main",
    label: "原对白",
    path: "/synthetic/voice.wav",
    offsetSeconds: 0,
    durationSeconds: 1,
  };
  f.film.audioClips = [clip];
  const input = {
    projectId: f.film.id,
    clipId: clip.id,
    expectedSourceKey: await audioSourceKey(f.film, clip),
  };
  assert.deepEqual(await f.bridge.readFilmAudioWaveform(input), {
    kind: "FAILED",
    code: "TOOLS_UNAVAILABLE",
  });
  assert.equal(f.audit.waveforms.length, 1);
  assert.equal(f.audit.waveforms[0].matched, true);
  assert.deepEqual(f.audit.forbidden, []);
  await assert.rejects(
    f.bridge.readFilmAudioWaveform({ ...input, expectedSourceKey: "b".repeat(64) }),
  );
  await assert.rejects(f.bridge.readFilmAudioWaveform({ ...input, clipId: "unknown-clip" }));
  f.film.shots[0].selectedTakeId = "";
  const changed = { ...input, expectedSourceKey: await audioSourceKey(f.film, clip) };
  assert.deepEqual(await f.bridge.readFilmAudioWaveform(changed), {
    kind: "FAILED",
    code: "SOURCE_CHANGED",
  });
  assert.deepEqual(f.film.audioClips, [clip]);
  assert.deepEqual(f.audit.forbidden, ["waveform-key", "waveform-scope"]);
});

test("CLI declares thirty-two and rejects unsafe flags/output without printing private argument values", async () => {
  const entry = path.join(root, "apps/studio-web/e2e/pro-evidence-legacy-audit.mjs");
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
      ';emitGitHubErrors(report,{kind:"evidence-legacy"});',
    {
      process: { env: { GITHUB_ACTIONS: "true" } },
      evidenceLegacyStates,
      console: { error: (line) => lines.push(line) },
      report: {
        exitCode: 1,
        results: Array.from({ length: 12 }, (_, i) => ({
          passed: false,
          reached: true,
          page: i ? "PRIVATE_BODY" : evidenceLegacyStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${evidenceLegacyStates[0]}`,
          checkLine: i ? Infinity : 88,
          error: "PRIVATE_TOKEN",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: NaN, y: Infinity, width: 20, height: 18 },
                diagnostic: {
                  control: i ? "PRIVATE_CONTROL" : "delivery-technical",
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
  assert(lines[0].includes("PRO_EVIDENCE_LEGACY_AUDIT"));
  assert(lines[0].includes("checkLine=88"));
  assert(lines[0].includes("control1=delivery-technical"));
  assert(lines.every((line) => !/PRIVATE|NaN|Infinity/.test(line)));
  const start = source.indexOf("    const expected =\n"),
    end = source.indexOf("    report.expectedResults = expected;");
  assert.equal(
    runInNewContext(source.slice(start, end) + ";expected", {
      profile: { kind: "evidence-legacy" },
      evidenceLegacyStates,
      viewports: [1, 2],
      aspects: [1, 2],
    }),
    32,
  );
});

test("real CLI setup failure retains thirty-two expected combinations and sandbox metadata without launching a browser", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "evidence-legacy-negative-"));
  const out = path.join(folder, "missing-browser-report");
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "apps/studio-web/e2e/pro-evidence-legacy-audit.mjs"),
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
    assert.deepEqual(report.expectedStates, evidenceLegacyStates);
    assert.equal(report.results.length, 0);
    assert.equal(report.exitCode, 2);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
