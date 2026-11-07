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
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import { installCreationBridge, seedCreationProject } from "./pro-creation-fixture.mjs";
import { loadLibraryAuditCatalog } from "./pro-audio-library-fixture.mjs";
import { installShotAudioBridge, seedShotAudioProject } from "./pro-shot-audio-fixture.mjs";
import { dialogueSplitStates } from "./pro-dialogue-split-cases.mjs";
import { installDialogueSplitBridge } from "./pro-dialogue-split-fixture.mjs";
import * as splitHelpers from "./pro-dialogue-split-browser-helper.mjs";
import { seedDialogueSplitProject } from "./pro-dialogue-split-fixture.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url)),
  originalWindow = globalThis.window;
let server, project, folder, catalog, validator, operations;
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
  validator = await server.ssrLoadModule("/src/aivora/pro/actions/dialogue-split-native.ts");
  operations = await server.ssrLoadModule("/src/aivora/film/operations.ts");
  catalog = await loadLibraryAuditCatalog();
});
after(async () => {
  globalThis.window = originalWindow;
  await server?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
function setup(state = dialogueSplitStates[0]) {
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
  installDialogueSplitBridge({
    state,
    helperModuleUrl: new URL("./pro-dialogue-split-browser-helper.mjs", import.meta.url).href,
  });
  window.__dialogueSplitAudit.helpers = splitHelpers;
  seedDialogueSplitProject({ shotId: seed.shotId });
  installAssemblyAuditBridge();
  const creation = window.__proCreationAudit,
    audit = window.__shotAudioAudit,
    bridge = window.aijian;
  const input = async () => {
    const raw = creation.record(seed.projectId);
    return {
      projectId: raw.id,
      expectedHash: await creation.hash(raw),
      shotId: seed.shotId,
      versions: 1,
    };
  };
  return { creation, audit, bridge, seed, input, split: window.__dialogueSplitAudit };
}
test("four actual default native modes retain six shots/three takes and fix sixteen combinations", () => {
  assert.equal(dialogueSplitStates.length * 2 * 2, 16);
  for (const state of dialogueSplitStates) {
    const f = setup(state),
      raw = f.creation.record(f.seed.projectId);
    assert.equal(raw.shots.length, 6);
    assert(raw.shots.every((s) => s.takes.length === 3));
    assert.equal(f.split.readMode, state === "dialogue-split-foreign-conflict" ? "hold" : "ready");
    assert.equal(
      f.split.applyMode,
      ["dialogue-split-unknown", "dialogue-split-foreign-conflict"].includes(state)
        ? "transport"
        : "ready",
    );
    assert.equal(f.split.incompleteRead, state === "dialogue-split-backup-delta-guard");
    assert.equal(f.split.corruptBackup, state === "dialogue-split-backup-delta-guard");
  }
});
test("default completed native review passes production whole-review validator and does not save or apply", async () => {
  const f = setup(),
    input = await f.input(),
    before = f.creation.record(f.seed.projectId),
    ready = await f.bridge.prepareFilmDialogueSplit(input);
  assert(validator.validNativeSplitReview(ready, before, input));
  assert.equal(ready.plan.parts.length, 3);
  assert.equal(ready.plan.videoCount, 3);
  assert.equal(ready.plan.parts.map((p) => p.text).join(""), ready.plan.sourceLines[0].text);
  assert.equal(ready.notes.length, 8);
  assert.equal(f.split.writes.length, 0);
  assert.equal(f.split.applies.length, 0);
});
async function accept(f) {
  const input = await f.input(),
    ready = await f.bridge.prepareFilmDialogueSplit(input);
  assert.equal(ready.kind, "READY");
  return f.bridge.applyFilmDialogueSplit({ ...input, reviewFingerprint: ready.reviewFingerprint });
}
test("default explicit acceptance appends no audio, preserves all original media in modeled backup and verifies full before hash", async () => {
  const f = setup(),
    before = f.creation.record(f.seed.projectId),
    beforeHash = await f.creation.hash(before),
    result = await accept(f);
  assert.equal(result.kind, "APPLIED");
  assert.equal(result.childIds.length, 3);
  assert.equal(new Set(result.childIds).size, 3);
  assert.equal(before.shots.length, 6);
  assert.equal(result.project.shots.length, 8);
  assert.deepEqual(operations.dialogueTracks(before), Array(6).fill(""));
  const exported = result.project.shots.flatMap((s) => {
    const take = s.takes.find(
      (t) => t.id === s.selectedTakeId && t.status === "done" && t.videoPath,
    );
    return take ? [take.videoPath] : [];
  });
  assert.equal(exported.length, 5);
  assert.deepEqual(
    exported,
    before.shots
      .filter((s) => s.id !== f.seed.shotId)
      .map((s) => s.takes.find((t) => t.id === s.selectedTakeId).videoPath),
  );
  assert.deepEqual(
    operations.dialogueTracks(result.project),
    exported.map(() => ""),
  );
  assert.deepEqual(result.project.audioClips, before.audioClips);
  const proof = await f.bridge.verifyFilmDialogueSplitBackup({
    projectId: before.id,
    historyId: result.backup.id,
    beforeHash,
  });
  assert.equal(proof.kind, "VERIFIED");
  assert.deepEqual(f.split.backups[result.backup.id].snapshot, before);
  assert.equal(f.split.nativeWrites, 1);
});
test("default unknown really admits once, remains BUSY, and completes only when controlled native operation settles", async () => {
  const f = setup("dialogue-split-unknown"),
    input = await f.input(),
    before = f.creation.record(f.seed.projectId);
  await assert.rejects(accept(f), /UNKNOWN/);
  assert.equal(f.split.nativeWrites, 0);
  assert.deepEqual(f.creation.record(f.seed.projectId), before);
  assert.equal((await f.bridge.prepareFilmDialogueSplit(input)).code, "BUSY");
  await f.split.finish();
  assert.equal(f.split.nativeWrites, 1);
  assert.equal(f.split.applies.length, 1);
  assert.equal(f.creation.record(f.seed.projectId).shots.length, 8);
});
test("default foreign-conflict mode actually holds first prepare without a manual override or owner/write", async () => {
  const f = setup("dialogue-split-foreign-conflict"),
    input = await f.input();
  let admit;
  const admitted = new Promise((r) => (admit = r));
  f.split.readAdmitted = admit;
  const pending = f.bridge.prepareFilmDialogueSplit(input);
  await admitted;
  assert.equal(f.split.pendingReads.length, 1);
  assert.equal(f.split.active, "");
  assert.equal(f.split.nativeWrites, 0);
  assert.equal(f.split.writes.length, 0);
  f.split.releaseRead();
  assert.equal((await pending).kind, "READY");
  assert.equal(f.split.readMode, "ready");
});
test("default guard returns incomplete read and bad checksum; source IDs never count as verified backup", async () => {
  const f = setup("dialogue-split-backup-delta-guard"),
    input = await f.input(),
    result = await accept(f);
  assert.equal(result.kind, "APPLIED");
  assert.equal((await f.bridge.readFilmProject(input.projectId)).shots.length, 7);
  f.split.incompleteRead = false;
  assert.equal((await f.bridge.readFilmProject(input.projectId)).shots.length, 8);
  assert.equal(
    (
      await f.bridge.verifyFilmDialogueSplitBackup({
        projectId: input.projectId,
        historyId: result.backup.id,
        beforeHash: input.expectedHash,
      })
    ).code,
    "BACKUP_FAILED",
  );
  const list = await f.bridge.listFilmHistory(input.projectId);
  assert.equal(list.entries.length, 0);
  assert.equal(list.unreadable, 1);
  assert.equal(f.split.nativeWrites, 1);
});
test("wrong fresh CAS or review fingerprint cannot dispatch structural changes", async () => {
  const f = setup(),
    input = await f.input(),
    ready = await f.bridge.prepareFilmDialogueSplit(input);
  await assert.rejects(
    f.bridge.applyFilmDialogueSplit({ ...input, reviewFingerprint: "0".repeat(64) }),
    /FORBIDDEN/,
  );
  assert.equal(f.split.nativeWrites, 0);
  await assert.rejects(
    f.bridge.applyFilmDialogueSplit({
      ...input,
      reviewFingerprint: ready.reviewFingerprint,
      path: "forged",
    }),
    /FORBIDDEN/,
  );
  const current = f.creation.record(f.seed.projectId);
  await f.bridge.writeFilmProject({ ...current, title: "changed after review" });
  await assert.rejects(
    f.bridge.applyFilmDialogueSplit({ ...input, reviewFingerprint: ready.reviewFingerprint }),
    /FORBIDDEN/,
  );
  assert.equal(f.split.nativeWrites, 0);
});
test("foreign background write never changes active selection and preview records only validated completed reply", async () => {
  const f = setup(),
    active = window.localStorage.getItem("aivora.film.activeId"),
    other = f.creation.record(f.seed.otherId);
  await f.bridge.writeFilmProject(other);
  assert.equal(window.localStorage.getItem("aivora.film.activeId"), active);
  const input = { projectId: other.id, expectedHash: await f.creation.hash(other) };
  await f.bridge.getFilmAudioMixPreview(input);
  assert.deepEqual(f.split.previews, [{ projectId: other.id, kind: "FAILED" }]);
});
test("history restore/capture, audio apply and paid providers remain forbidden, with no legacy assembly fallback", async () => {
  const f = setup();
  for (const name of [
    "captureFilmHistory",
    "restoreFilmHistory",
    "suggestBundledFilmShotAudio",
    "applyBundledFilmShotAudio",
    "createStoryFilm",
    "previewVoice",
  ])
    await assert.rejects(f.bridge[name]({}), /FORBIDDEN/);
  await assert.rejects(
    f.bridge.assembleFilm("series", ["a", "b"], "", -14, ["", ""]),
    /FORBIDDEN_ASSEMBLY_DISPATCH/,
  );
  assert.deepEqual(f.split.assemblies, []);
  assert.deepEqual(window.__assemblyAudit.legacy, ["assembleFilm"]);
  assert.deepEqual(window.__assemblyAudit.forbidden, ["legacy-assemble"]);
  assert.equal(f.split.nativeWrites, 0);
});
test("CLI fixes sixteen states and rejects remote/output/unknown input without browser launch", () => {
  const script = path.join(root, "apps/studio-web/e2e/pro-dialogue-split-audit.mjs");
  for (const args of [["--unknown"], ["--url", "https://example.invalid/"], ["--out", root]]) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 2);
  }
  const help = spawnSync(process.execPath, [script, "--help"], { cwd: root, encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /16 expected/);
});

test("public failure metadata has closed state/control allowlists, bounded source lines and at most eight entries", async () => {
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8"),
    errors = [];
  runInNewContext(
    source.slice(source.indexOf("function auditIdentity"), source.indexOf("function options")) +
      `;emitGitHubErrors(input,{kind:"dialogue-split"});`,
    {
      dialogueSplitStates,
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
          page: i ? "PRIVATE_BODY" : dialogueSplitStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${dialogueSplitStates[0]}`,
          reached: true,
          checkLine: i ? Infinity : 123,
          error: "PRIVATE_STACK",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: 1, y: 2, width: 3, height: 4 },
                diagnostic: {
                  control: i ? "PRIVATE_TOKEN" : "dialogue-split-apply",
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
  assert(errors[0].includes("control1=dialogue-split-apply"));
  assert.doesNotMatch(errors.join("\n"), /PRIVATE_|Infinity/);
});
test("setup failure still creates the fixed sixteen-state report and bounded environment annotation", async () => {
  const out = path.join(folder, "missing-browser-report"),
    result = spawnSync(
      process.execPath,
      [
        path.join(root, "apps/studio-web/e2e/pro-dialogue-split-audit.mjs"),
        "--browser",
        path.join(folder, "missing-chrome"),
        "--out",
        out,
      ],
      { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" } },
    );
  assert.equal(result.status, 2);
  const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
  assert.equal(report.expectedResults, 16);
  assert.deepEqual(report.expectedStates, dialogueSplitStates);
  assert.match(result.stderr, /PRO_DIALOGUE_SPLIT_SETUP_BROWSER_DISCOVERY/);
  assert(!result.stderr.includes(path.join(folder, "missing-chrome")));
});
