/** Node-only fixture/CLI safety checks; no browser/FFmpeg/listening assertion. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { TextEncoder } from "node:util";
import { runInNewContext } from "node:vm";
import { createServer } from "vite";
import { installCreationBridge, seedCreationProject } from "./pro-creation-fixture.mjs";
import { loadLibraryAuditCatalog } from "./pro-audio-library-fixture.mjs";
import { installShotAudioBridge, seedShotAudioProject } from "./pro-shot-audio-fixture.mjs";
import { shotAudioStates } from "./pro-shot-audio-cases.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url)),
  originalWindow = globalThis.window;
let server, project, folder, catalog, validator;
before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "shot-audio-fixture-"));
  server = await createServer({
    root: path.join(root, "apps/studio-web"),
    configFile: path.join(root, "apps/studio-web/vite.config.ts"),
    cacheDir: path.join(folder, "vite-cache"),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
  });
  project = await server.ssrLoadModule("/src/aivora/film/project.ts");
  validator = await server.ssrLoadModule("/src/aivora/pro/actions/shot-audio-suggestions.ts");
  catalog = await loadLibraryAuditCatalog();
});
after(async () => {
  globalThis.window = originalWindow;
  await server?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
function setup(state = shotAudioStates[0]) {
  const map = new Map(),
    storage = new Proxy(
      { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) },
      {
        ownKeys: () => [...map.keys()],
        getOwnPropertyDescriptor: (_, k) =>
          map.has(k) ? { enumerable: true, configurable: true, value: map.get(k) } : undefined,
      },
    );
  globalThis.window = {
    localStorage: storage,
    crypto: webcrypto,
    TextEncoder,
    aijian: {},
    aijianGrok: {},
  };
  const film = project.sampleFilm();
  film.scenes = [film.scenes[1], film.scenes[0], film.scenes[2]];
  for (const s of film.shots) {
    s.takes = [1, 2, 3].map((i) => ({
      id: `${s.id}-${i}`,
      shotId: s.id,
      index: i,
      status: "done",
      videoPath: `/synthetic/${s.id}-${i}.mp4`,
      videoUrl: "",
      reason: "",
      createdAt: "",
      prompt: "",
      stillUrl: "",
    }));
    s.selectedTakeId = s.takes[0].id;
  }
  storage.setItem("aivora.film.active", JSON.stringify(film));
  storage.setItem("aivora.film.activeId", film.id);
  storage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
  const seed = seedCreationProject({ state });
  seedShotAudioProject({ shotId: seed.shotId });
  installCreationBridge({ state });
  installShotAudioBridge({ state, catalog });
  const creation = window.__proCreationAudit,
    audit = window.__shotAudioAudit,
    bridge = window.aijian;
  const input = async () => {
    const raw = creation.record(seed.projectId);
    return {
      projectId: raw.id,
      expectedProjectHash: await creation.hash(raw),
      shotId: seed.shotId,
      takeId: raw.shots.find((s) => s.id === seed.shotId).selectedTakeId,
    };
  };
  return { creation, audit, bridge, seed, input };
}
test("four actual default modes keep six shots/three takes and the pre-existing clip", () => {
  assert.equal(shotAudioStates.length, 4);
  assert.equal(catalog.assets.length, 206);
  for (const state of shotAudioStates) {
    const f = setup(state),
      raw = f.creation.record(f.seed.projectId);
    assert.equal(raw.shots.length, 6);
    assert(raw.shots.every((s) => s.takes.length === 3));
    assert.equal(raw.audioClips.length, 1);
    assert.equal(
      f.audit.mode,
      state === "shot-audio-pending-stale"
        ? "hold"
        : state === "shot-audio-empty-missing"
          ? "missing"
          : "ready",
    );
  }
});
test("complete actual default plan passes production validator and preserves precise segments/envelopes/all notes without saving", async () => {
  const f = setup(),
    before = f.creation.record(f.seed.projectId),
    input = await f.input(),
    reply = await f.bridge.suggestBundledFilmShotAudio(input);
  assert(validator.validShotAudioPlan(reply, input));
  assert.equal(reply.clips.length, 6);
  assert.equal(reply.clips[0].placement.startSeconds, 0.123456789);
  assert.equal(reply.clips[0].envelope.fades[0].startSeconds, -0.25);
  assert.equal(reply.clips[0].placement.gainDb, -30);
  assert.equal(reply.clips[0].envelope.gainAutomation.length, 2);
  assert.equal(reply.warnings.length, 5);
  assert.equal(reply.limitations.length, 5);
  assert.equal(reply.durationSeconds, 2.25);
  assert.deepEqual(f.creation.record(f.seed.projectId), before);
  assert.equal(f.audit.writes, 0);
  assert(f.audit.calls.every((c) => c.matched));
  assert.deepEqual(f.audit.forbidden, []);
});
test(
  "pending default really admits and holds the first native request until explicit release",
  { timeout: 5000 },
  async () => {
    const f = setup("shot-audio-pending-stale"),
      input = await f.input();
    const admitted = new Promise((resolve) => {
      f.audit.pendingAdmitted = resolve;
    });
    const waiting = f.bridge.suggestBundledFilmShotAudio(input);
    await admitted;
    assert.equal(f.audit.pending.length, 1);
    assert.equal(f.audit.calls.length, 1);
    assert.equal(f.audit.mode, "hold");
    f.audit.resolvePending();
    const reply = await waiting;
    assert(validator.validShotAudioPlan(reply, input));
    assert.equal(f.audit.pending.length, 0);
    assert.equal(f.audit.writes, 0);
  },
);
test("save fault is explicitly armed after initialization and cannot silently call suggest", async () => {
  const f = setup("shot-audio-save-guard"),
    before = f.creation.record(f.seed.projectId);
  await f.bridge.writeFilmProject(before);
  assert.equal(f.audit.writes, 1);
  f.audit.failWrites = true;
  await assert.rejects(f.bridge.writeFilmProject({ ...before, title: "new draft" }));
  assert.equal(f.audit.rejectedWrites, 1);
  assert.equal(f.audit.calls.length, 0);
  assert.deepEqual(f.creation.record(f.seed.projectId), before);
  f.audit.failWrites = false;
  await f.bridge.writeFilmProject(before);
  assert.equal(f.audit.writes, 2);
});
test("missing default and explicit source/limit/invalid/empty replies are finite, never partial plans", async () => {
  const f = setup("shot-audio-empty-missing"),
    input = await f.input();
  assert.equal((await f.bridge.suggestBundledFilmShotAudio(input)).code, "LIBRARY_UNAVAILABLE");
  f.audit.mode = "source-failed";
  assert.equal((await f.bridge.suggestBundledFilmShotAudio(input)).code, "SOURCE_UNVERIFIED");
  f.audit.mode = "limit";
  const limit = await f.bridge.suggestBundledFilmShotAudio(input);
  assert.equal(limit.minimumRequiredSegments, 129);
  assert.equal(limit.maxSegments, 128);
  f.audit.mode = "invalid";
  assert(!validator.validShotAudioPlan(await f.bridge.suggestBundledFilmShotAudio(input), input));
  f.audit.mode = "empty";
  const empty = await f.bridge.suggestBundledFilmShotAudio(input);
  assert(validator.validShotAudioPlan(empty, input));
  assert.equal(empty.clips.length, 0);
  assert.equal(empty.limitations.length, 2);
  assert.equal(f.audit.writes, 0);
});
test("fresh raw CAS changes on savedAt while equivalent synthetic plan fingerprint stays the same", async () => {
  const f = setup(),
    first = await f.input(),
    a = await f.bridge.suggestBundledFilmShotAudio(first),
    raw = f.creation.record(f.seed.projectId);
  await f.bridge.writeFilmProject({ ...raw, savedAt: "next-save" });
  const second = await f.input(),
    b = await f.bridge.suggestBundledFilmShotAudio(second);
  assert.notEqual(first.expectedProjectHash, second.expectedProjectHash);
  assert.equal(a.planFingerprint, b.planFingerprint);
  assert.equal(b.projectHash, second.expectedProjectHash);
  await assert.rejects(f.bridge.suggestBundledFilmShotAudio(first));
  assert.deepEqual(f.audit.forbidden, ["suggestion-input"]);
});
test("old add, new apply, model and old export methods remain forbidden", async () => {
  const f = setup();
  for (const name of [
    "addBundledFilmAudio",
    "applyBundledFilmShotAudio",
    "createStoryFilm",
    "generateFilmStill",
    "prepareFilmExport",
  ])
    await assert.rejects(f.bridge[name]({}));
  for (const name of ["completeText", "speak", "generateVideo"])
    await assert.rejects(window.aijianGrok[name]({}));
  assert.equal(f.audit.calls.length, 0);
  assert.equal(f.audit.writes, 0);
});
test("dedicated CLI fixes sixteen and rejects unsafe URL/output/flags without disclosing arguments", () => {
  const cli = path.join(root, "apps/studio-web/e2e/pro-shot-audio-audit.mjs"),
    help = spawnSync(process.execPath, [cli, "--help"], { cwd: root, encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /4 states.*16 expected/);
  for (const args of [
    ["--url", "https://private.example/SECRET_TOKEN"],
    ["--out", path.join(root, "PRIVATE_DIR")],
    ["--no-sandbox"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout + result.stderr, /SECRET_TOKEN|PRIVATE_DIR|private.example/);
  }
});
test("public failure metadata has closed state/control allowlists, bounded source lines and at most eight entries", async () => {
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8"),
    errors = [];
  runInNewContext(
    source.slice(source.indexOf("function auditIdentity"), source.indexOf("function options")) +
      `;emitGitHubErrors(input,{kind:"shot-audio"});`,
    {
      shotAudioStates,
      audioLibraryStates: [],
      audioMixStates: [],
      creationStates: [],
      featureStates: [],
      progressStates: [],
      qcStates: [],
      process: { env: { GITHUB_ACTIONS: "true" } },
      console: { error: (x) => errors.push(x) },
      input: {
        exitCode: 1,
        results: Array.from({ length: 20 }, (_, i) => ({
          page: i ? "PRIVATE_BODY" : shotAudioStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${shotAudioStates[0]}`,
          reached: true,
          checkLine: i ? Infinity : 123,
          error: "PRIVATE_STACK",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: 1, y: 2, width: 3, height: 4 },
                diagnostic: {
                  control: i ? "PRIVATE_TOKEN" : "shot-audio-refresh",
                  tag: "BUTTON",
                  hitTag: "DIV",
                  hitClasses: ["PRIVATE_CLASS"],
                  point: { x: Infinity, y: 2 },
                },
              },
            ],
          },
        })),
      },
    },
  );
  assert.equal(errors.length, 8);
  assert(errors[0].includes("checkLine=123"));
  assert(errors[0].includes("control1=shot-audio-refresh"));
  assert.doesNotMatch(errors.join("\n"), /PRIVATE_|Infinity/);
});
