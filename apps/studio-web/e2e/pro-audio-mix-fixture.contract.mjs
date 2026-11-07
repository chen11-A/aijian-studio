/** Node-only contract checks, not browser/geometry or native FFmpeg certification. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TextEncoder } from "node:util";
import { runInNewContext } from "node:vm";
import { createServer } from "vite";
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { seedAudioMixProject, installAudioMixBridge } from "./pro-audio-mix-fixture.mjs";
import { audioMixStates, silentWav } from "./pro-audio-mix-cases.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const planUrl = new URL("../../../packages/contracts/src/film-audio-mix-plan.js", import.meta.url)
  .href;
const originalWindow = globalThis.window;
let server, project, folder;
before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "mix-fixture-"));
  server = await createServer({
    root: path.join(root, "apps/studio-web"),
    configFile: path.join(root, "apps/studio-web/vite.config.ts"),
    cacheDir: path.join(folder, "vite-cache"),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
  });
  project = await server.ssrLoadModule("/src/aivora/film/project.ts");
});
after(async () => {
  globalThis.window = originalWindow;
  await server?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
function setup(state = "mix-lane-settings") {
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
    atob: globalThis.atob,
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
  const seed = seedAudioMixProject();
  installCreationBridge({ state });
  const bytes = silentWav(),
    sha = createHash("sha256").update(bytes).digest("hex");
  installAudioMixBridge({ state, planUrl, wavBase64: bytes.toString("base64"), wavSha256: sha });
  installAssemblyAuditBridge();
  const creation = window.__proCreationAudit,
    audit = window.__proAudioMixAudit,
    bridge = window.aijian;
  const input = async () => ({
    projectId: seed.projectId,
    expectedHash: await creation.hash(creation.saved()),
  });
  return { seed, creation, audit, bridge, input, bytes, sha };
}
test("four fixed seeds preserve all six shots/three versions and bind only the selected current scene", () => {
  assert.equal(audioMixStates.length, 4);
  for (const state of audioMixStates) {
    const f = setup(state),
      film = f.creation.saved();
    assert.equal(film.shots.length, 6);
    assert(film.shots.every((s) => s.takes.length === 3));
    assert.equal(film.audioClips.length, 7);
    assert.equal(film.audioClips[0].shotId, f.seed.shotId);
    assert.equal(film.audioMix, undefined);
  }
});
test("READY uses the actual shared plan compiler with four source lanes and preserves clip gains", async () => {
  const f = setup();
  const before = f.creation.saved();
  const result = await f.bridge.getFilmAudioMixPreview(await f.input());
  assert.equal(result.kind, "READY");
  assert.deepEqual([...new Set(result.plan.tracks.map((t) => t.lane))].sort(), [
    "ambience",
    "dialogue",
    "score",
    "sfx",
  ]);
  assert.deepEqual(f.creation.saved().audioClips, before.audioClips);
  assert(
    result.plan.tracks.every(
      (t) => !["mix-old-voice", "mix-disabled-voice", "mix-pending-voice"].includes(t.key),
    ),
  );
  assert.equal(result.fingerprint, (await f.input()).expectedHash);
});
test("canonical input hash mismatch is forbidden, not silently accepted", async () => {
  const f = setup();
  await assert.rejects(
    f.bridge.getFilmAudioMixPreview({ projectId: f.seed.projectId, expectedHash: "wrong" }),
    /FORBIDDEN_AUDIO_MIX/,
  );
  assert.deepEqual(f.audit.forbidden, ["unverified-preview-hash"]);
});
test(
  "default retry admission holds before its first BUSY, then retains eight attempts and explicit failure",
  { timeout: 5000 },
  async () => {
    const f = setup("mix-preview-retry");
    assert.equal(f.audit.mode, "hold-busy");
    const admitted = new Promise((resolve) => {
      f.audit.pendingChanged = resolve;
    });
    let settled = false;
    const first = f.bridge.getFilmAudioMixPreview(await f.input()).then((value) => {
      settled = true;
      return value;
    });
    await admitted;
    assert.equal(f.audit.pending.length, 1);
    assert.equal(settled, false, "Default admission must still be held for the real busy UI probe");
    f.audit.mode = "busy";
    f.audit.resolve(0);
    assert.deepEqual(await first, { kind: "FAILED", code: "BUSY" });
    for (let i = 1; i < 8; i++)
      assert.deepEqual(await f.bridge.getFilmAudioMixPreview(await f.input()), {
        kind: "FAILED",
        code: "BUSY",
      });
    assert.equal(f.audit.requests.length, 8);
    f.audit.mode = "failed";
    assert.deepEqual(await f.bridge.getFilmAudioMixPreview(await f.input()), {
      kind: "FAILED",
      code: "SOURCE_UNVERIFIED",
    });
    assert.equal(f.audit.pending.length, 1);
  },
);

test(
  "controlled late reply retains its original selection while canonical save/read moves forward",
  { timeout: 5000 },
  async () => {
    const f = setup("mix-stale-reply"),
      first = await f.input();
    const admitted = new Promise((resolve) => {
      f.audit.pendingChanged = resolve;
    });
    const pending = f.bridge.getFilmAudioMixPreview(first);
    await admitted;
    assert.equal(f.audit.pending.length, 1);
    const changed = f.creation.saved(),
      target = changed.shots.find((s) => s.id === f.seed.shotId);
    target.selectedTakeId = target.takes[1].id;
    await f.bridge.writeFilmProject(changed);
    assert.equal(
      (await f.bridge.readFilmProject(changed.id)).shots.find((s) => s.id === target.id)
        .selectedTakeId,
      target.takes[1].id,
    );
    assert.notEqual((await f.input()).expectedHash, first.expectedHash);
    f.audit.resolve(0);
    const old = await pending;
    assert.equal(old.fingerprint, first.expectedHash);
    assert.notEqual(
      old.plan.shots.find((s) => s.shotId === target.id).takeId,
      target.selectedTakeId,
    );
  },
);
test("synthetic PCM bytes have stable SHA and exact native-read admission; provider/legacy export stay forbidden", async () => {
  const f = setup(),
    clip = f.creation.saved().audioClips[0];
  assert.equal(f.bytes.toString("ascii", 0, 4), "RIFF");
  assert(f.bytes.subarray(44).every((b) => b === 0));
  assert.deepEqual(
    await f.bridge.readFilmMedia(clip.path, { maxBytes: 16777216, expectedSha256: f.sha }),
    [...f.bytes],
  );
  await assert.rejects(
    f.bridge.readFilmMedia("/untrusted", { maxBytes: 16777216, expectedSha256: f.sha }),
    /FORBIDDEN_AUDIO_MIX/,
  );
  await assert.rejects(f.bridge.createStoryFilm(), /FORBIDDEN_CREATION/);
  await assert.rejects(window.aijianGrok.completeText(), /FORBIDDEN_CREATION/);
  await assert.rejects(f.bridge.exportFilmCut(), /FORBIDDEN_CREATION/);
});
test("new CLI fixes sixteen states while original profile counts/safe input rejection remain", () => {
  for (const [name, count] of [
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
      ["apps/studio-web/e2e/pro-audio-mix-audit.mjs", ...args],
      { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" } },
    );
    assert.equal(r.status, 2);
    assert.match(r.stderr, /PRO_AUDIO_MIX_CONFIGURATION/);
    assert.doesNotMatch(r.stderr, /SECRET|private.invalid/);
  }
});
test("actual mix annotation formatter stays bounded and never emits response bodies, paths or unknown labels", async () => {
  const s = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8"),
    errors = [];
  runInNewContext(
    s.slice(s.indexOf("function auditIdentity"), s.indexOf("function options")) +
      `;emitGitHubErrors(input,{kind:"audio-mix"});`,
    {
      audioMixStates,
      creationStates: [],
      featureStates: [],
      progressStates: [],
      qcStates: [],
      process: { env: { GITHUB_ACTIONS: "true" } },
      console: { error: (x) => errors.push(x) },
      input: {
        exitCode: 1,
        results: Array.from({ length: 12 }, () => ({
          page: audioMixStates[0],
          combination: `1280x800-16x9-${audioMixStates[0]}`,
          reached: true,
          checkLine: "SECRET",
          error: "/SECRET/private",
          geometry: {
            issues: [
              {
                kind: "control-clipped-without-scroll",
                box: { x: NaN, y: Infinity, width: 30, height: 20 },
                diagnostic: {
                  control: "SECRET",
                  tag: "SECRET",
                  clipTag: "SECTION",
                  clipClasses: ["SECRET", "pane"],
                },
              },
            ],
          },
        })),
      },
    },
  );
  assert.equal(errors.length, 8);
  assert(errors.every((x) => x.includes("PRO_AUDIO_MIX_AUDIT")));
  assert.doesNotMatch(errors.join("\n"), /SECRET|private|NaN|Infinity/);
});
