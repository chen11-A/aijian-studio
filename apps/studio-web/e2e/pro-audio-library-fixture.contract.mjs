/** Node-only ABI/CLI tests, not browser, actual resource decoding or geometry validation. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
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
import {
  installAudioLibraryBridge,
  loadLibraryAuditCatalog,
} from "./pro-audio-library-fixture.mjs";
import { audioLibraryStates, libraryTargetDiagnostic } from "./pro-audio-library-cases.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url)),
  originalWindow = globalThis.window;
let server, project, folder, catalog;
before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "library-fixture-"));
  server = await createServer({
    root: path.join(root, "apps/studio-web"),
    configFile: path.join(root, "apps/studio-web/vite.config.ts"),
    cacheDir: path.join(folder, "vite-cache"),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
  });
  project = await server.ssrLoadModule("/src/aivora/film/project.ts");
  catalog = await loadLibraryAuditCatalog();
});
after(async () => {
  globalThis.window = originalWindow;
  await server?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
function setup(state = "library-catalog") {
  const map = new Map();
  const storage = new Proxy(
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
  installCreationBridge({ state });
  installAudioLibraryBridge({ state, catalog });
  const creation = window.__proCreationAudit,
    audit = window.__proAudioLibraryAudit,
    bridge = window.aijian;
  const target = async () => ({
    projectId: seed.projectId,
    expectedProjectHash: await creation.hash(creation.record(seed.projectId)),
    shotId: seed.shotId,
    takeId: creation.record(seed.projectId).shots.find((s) => s.id === seed.shotId).selectedTakeId,
  });
  const asset = catalog.assets.find(
    (a) => a.type === "sfx" && a.durationSeconds >= 4 && !a.loopable,
  );
  const input = async () => ({
    ...(await target()),
    catalogSha256: catalog.manifestSha256,
    assetId: asset.id,
    expectedAssetSha256: asset.sha256,
    lane: "sfx",
    placement: { startSeconds: 0, durationSeconds: 1.5, offsetSeconds: 0, gainDb: 0, loop: false },
  });
  return { creation, audit, bridge, seed, target, input, asset };
}
test("four default states retain six shots/three versions and actual 206 public metadata rows without paths", async () => {
  assert.equal(audioLibraryStates.length, 4);
  for (const state of audioLibraryStates) {
    const f = setup(state);
    assert.equal(f.creation.saved().shots.length, 6);
    assert(f.creation.saved().shots.every((s) => s.takes.length === 3));
    const r = await f.bridge.listBundledFilmAudio();
    assert.equal(r.assets.length, 206);
    assert.equal(r.assets.filter((a) => a.type === "sfx").length, 175);
    assert.equal(r.assets.filter((a) => a.type === "music").length, 31);
    assert(
      r.assets.every(
        (a) =>
          !Object.hasOwn(a, "path") && a.author && a.license && /^[a-f0-9]{64}$/.test(a.sha256),
      ),
    );
  }
});
test("default native write persists another work without pretending to select it via activeId", async () => {
  const f = setup("library-unknown-recovery");
  const selected = window.localStorage.getItem("aivora.film.activeId"),
    active = window.localStorage.getItem("aivora.film.active"),
    original = f.creation.record(f.seed.projectId);
  const other = f.creation.record(f.seed.otherId);
  other.styleZh = "另一个作品的合成保存变化";
  const stored = await f.bridge.writeFilmProject(other);
  assert.deepEqual(stored, other);
  assert.deepEqual(f.creation.record(f.seed.otherId), other);
  assert.deepEqual(f.creation.record(f.seed.projectId), original);
  assert.equal(window.localStorage.getItem("aivora.film.activeId"), selected);
  assert.equal(window.localStorage.getItem("aivora.film.active"), active);
  assert.deepEqual(f.audit.writes, [{ projectId: other.id, hash: await f.creation.hash(other) }]);
});
test("target guard default really holds the first request, then fails with no invented duration or add", async () => {
  const f = setup("library-target-guard");
  const admitted = new Promise((resolve) => {
    f.audit.targetAdmitted = resolve;
  });
  const waiting = f.bridge.inspectBundledFilmAudioTarget(await f.target());
  await admitted;
  assert.equal(f.audit.pendingTargets.length, 1);
  assert.equal(f.audit.mode, "hold-target");
  f.audit.resolveTarget();
  assert.deepEqual(await waiting, { kind: "FAILED", code: "SOURCE_UNVERIFIED", unchanged: true });
  assert.equal(f.audit.adds.length, 0);
});
test("ready target is narrower than stored shot length and binds exact project hash/take", async () => {
  const f = setup();
  const input = await f.target(),
    r = await f.bridge.inspectBundledFilmAudioTarget(input);
  assert.equal(r.kind, "TARGET");
  assert.equal(r.durationSeconds, 2.25);
  assert.equal(r.projectHash, input.expectedProjectHash);
  assert.equal(f.creation.saved().shots[0].seconds, 4);
  assert.deepEqual(
    await f.bridge.inspectBundledFilmAudioTarget({ ...input, expectedProjectHash: "bad" }),
    { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true },
  );
});
test("add preserves the complete original record and all takes, adding one provenance-bound clip and file registry entry", async () => {
  const f = setup(),
    before = f.creation.record(f.seed.projectId);
  const r = await f.bridge.addBundledFilmAudio(await f.input());
  assert.equal(r.kind, "ADDED");
  assert.equal(r.project.audioClips.length, 1);
  const { audioClips, ...rest } = r.project;
  const expected = JSON.parse(JSON.stringify(before));
  delete expected.audioClips;
  assert.deepEqual(rest, expected);
  assert.equal(audioClips[0].libraryAsset.assetId, f.asset.id);
  assert.equal(audioClips[0].libraryAsset.sha256, f.asset.sha256);
  assert.equal(f.audit.files[audioClips[0].path], f.asset.sha256);
  assert(f.audit.adds[0].matched);
});
test("unknown default holds native active until explicit completion, never allowing readback to mistake old bytes for completion", async () => {
  const f = setup("library-unknown-recovery"),
    input = await f.input();
  await assert.rejects(f.bridge.addBundledFilmAudio(input), /SYNTHETIC_TRANSPORT_UNKNOWN/);
  assert(f.audit.active);
  assert.equal(f.creation.record(f.seed.projectId).audioClips.length, 0);
  assert.equal((await f.bridge.inspectBundledFilmAudioTarget(await f.target())).code, "BUSY");
  window.localStorage.setItem("aivora.film.activeId", f.seed.otherId);
  const other = f.creation.record(f.seed.otherId);
  await f.audit.finish();
  assert.equal(f.creation.record(f.seed.projectId).audioClips.length, 1);
  assert.equal(f.creation.record(f.seed.projectId).title, "本机后来保存的片名");
  assert.deepEqual(f.creation.record(f.seed.otherId), other);
  assert.equal(window.localStorage.getItem("aivora.film.activeId"), f.seed.otherId);
  assert.equal((await f.bridge.inspectBundledFilmAudioTarget(input)).code, "PROJECT_CHANGED");
  assert.equal(f.audit.adds.length, 1);
});
test("invalid add and all model/old export/ZIP capabilities remain forbidden", async () => {
  const f = setup();
  await assert.rejects(
    f.bridge.addBundledFilmAudio({ ...(await f.input()), expectedProjectHash: "bad" }),
    /FORBIDDEN_AUDIO_LIBRARY/,
  );
  assert.equal(f.creation.saved().audioClips.length, 0);
  await assert.rejects(f.bridge.createStoryFilm(), /FORBIDDEN_CREATION/);
  await assert.rejects(window.aijianGrok.completeText(), /FORBIDDEN_CREATION/);
  await assert.rejects(f.bridge.exportFilmCut(), /FORBIDDEN_CREATION/);
  await assert.rejects(f.bridge.exportFilmProjectArchive(), /FORBIDDEN_AUDIO_LIBRARY/);
});
test("new CLI fixes sixteen and preserves existing profiles, safe usage errors redact input", () => {
  for (const [name, count] of [
    ["pro-audio-library", 16],
    ["pro-audio-mix", 16],
    ["pro-creation", 32],
    ["pro-export-qc", 32],
    ["pro-export-progress", 32],
    ["pro-feature", 24],
  ]) {
    const r = spawnSync(process.execPath, [`apps/studio-web/e2e/${name}-audit.mjs`, "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(r.status, 0);
    assert(r.stdout.includes(`(${count} expected)`));
  }
  for (const args of [
    ["--url", "https://private.invalid/?token=SECRET"],
    ["--out", path.join(root, "apps/studio-web/src")],
  ]) {
    const r = spawnSync(
      process.execPath,
      ["apps/studio-web/e2e/pro-audio-library-audit.mjs", ...args],
      { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" } },
    );
    assert.equal(r.status, 2);
    assert.match(r.stderr, /PRO_AUDIO_LIBRARY_CONFIGURATION/);
    assert.doesNotMatch(r.stderr, /SECRET|private.invalid/);
  }
});
test("annotation metadata stays bounded, double-whitelisted and does not disclose raw body/path/token/stack", async () => {
  const s = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8"),
    errors = [];
  runInNewContext(
    s.slice(s.indexOf("function auditIdentity"), s.indexOf("function options")) +
      `;emitGitHubErrors(input,{kind:"audio-library"});`,
    {
      audioLibraryStates,
      libraryTargetDiagnostic,
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
          page: i ? "PRIVATE_BODY" : audioLibraryStates[0],
          combination: i ? "PRIVATE_TOKEN" : `1280x800-16x9-${audioLibraryStates[0]}`,
          reached: true,
          error: "PRIVATE_STACK",
          targetReadiness: {
            state: "PRIVATE_BODY",
            reply: "PRIVATE_TOKEN",
            calls: Infinity,
            matched: "PRIVATE_PATH",
            busy: -1,
          },
          checkLine: i ? Infinity : 123,
          geometry: {
            issues: [
              {
                kind: "covered-center",
                diagnostic: {
                  control: "PRIVATE_KEY",
                  tag: "PRIVATE_TAG",
                  hitTag: "DIV",
                  hitClasses: ["PRIVATE_CLASS"],
                  point: { x: Infinity, y: 2 },
                  box: { x: 1, y: 2, width: 3, height: 4 },
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
  assert.doesNotMatch(errors.join("\n"), /PRIVATE_|Infinity/);
  assert(
    errors.every((s) =>
      s.startsWith("::error title=Pro audio library audit::PRO_AUDIO_LIBRARY_AUDIT"),
    ),
  );
});

test("target failure diagnostics expose only closed states and bounded counters, never payload text", async () => {
  const f = setup();
  const result = await f.bridge.inspectBundledFilmAudioTarget(await f.target());
  assert.equal(result.kind, "TARGET");
  assert.equal(f.audit.inspects[0].reply, "TARGET");
  assert.equal(
    libraryTargetDiagnostic({
      state: "EMPTY",
      reply: f.audit.inspects[0].reply,
      calls: 1,
      matched: 1,
      busy: 0,
      writes: 2,
      previews: 1,
      assemblies: 1,
    }),
    " targetState=EMPTY targetReply=TARGET targetCalls=1 targetMatched=1 targetBusy=0 libraryWrites=2 libraryPreview=1 libraryAssembly=1",
  );
  const privateText = "PRIVATE_TOKEN_/secret/file\n::error raw body";
  const output = libraryTargetDiagnostic({
    state: privateText,
    reply: privateText,
    calls: 1001,
    matched: -1,
    busy: NaN,
    writes: Infinity,
    previews: privateText,
    assemblies: 1.5,
    raw: privateText,
  });
  assert(!output.includes("PRIVATE"));
  assert(!output.includes("::error"));
  assert.equal(output.match(/unknown/g).length, 8);
});
