/** Fixture/CLI/safety contracts only. These tests never launch Chromium or certify layout. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { TextEncoder } from "node:util";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import { creationStates } from "./pro-creation-cases.mjs";
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import { installCreationBridge, seedCreationProject } from "./pro-creation-fixture.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url));
let server, project, operations, compiler, folder;
const previousWindow = globalThis.window;
before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "creation-fixture-"));
  server = await createServer({
    root: path.join(root, "apps/studio-web"),
    configFile: path.join(root, "apps/studio-web/vite.config.ts"),
    cacheDir: path.join(folder, "vite-cache"),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
  });
  project = await server.ssrLoadModule("/src/aivora/film/project.ts");
  operations = await server.ssrLoadModule("/src/aivora/film/operations.ts");
  compiler = await server.ssrLoadModule("/src/aivora/film/seven-part-video.ts");
});
after(async () => {
  globalThis.window = previousWindow;
  await server?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
function setup(state) {
  const map = new Map();
  const target = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
  };
  const storage = new Proxy(target, {
    ownKeys: () => [...map.keys()],
    getOwnPropertyDescriptor: (_target, key) =>
      map.has(key) ? { enumerable: true, configurable: true, value: map.get(key) } : undefined,
  });
  globalThis.window = {
    localStorage: storage,
    crypto: webcrypto,
    TextEncoder,
    aijian: {},
    aijianGrok: {},
  };
  const film = project.sampleFilm();
  film.scenes = [film.scenes[1], film.scenes[0], film.scenes[2]];
  film.aspectRatio = "16:9";
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.audioClips = [];
  for (const shot of film.shots) {
    shot.poster = "data:image/png;base64,c3ludGhldGlj";
    shot.takes = Array.from({ length: 3 }, (_, i) => ({
      id: `${shot.id}-test-${i}`,
      shotId: shot.id,
      index: i + 1,
      status: "done",
      stillUrl: shot.poster,
      videoPath: `/synthetic/${shot.id}-${i}.mp4`,
      videoUrl: "http://127.0.0.1:5173/__pro-layout__/shot-a.mp4",
      prompt: "合成版本",
      createdAt: "",
      reason: "",
    }));
    shot.selectedTakeId = shot.takes[0].id;
  }
  storage.setItem("aivora.film.active", JSON.stringify(film));
  const seed = seedCreationProject({ state });
  installCreationBridge({ state });
  installAssemblyAuditBridge();
  return { seed, audit: window.__proCreationAudit, bridge: window.aijian, storage };
}
test("all eight fixed seeds retain real six-shot/three-version data and compile usable non-provider text", () => {
  assert.equal(creationStates.length, 8);
  assert.equal(new Set(creationStates).size, 8);
  for (const state of creationStates) {
    const { audit, seed, storage } = setup(state);
    const film = project.upgradeFilm(audit.saved());
    assert.equal(film.shots.length, 6);
    assert(film.shots.every((shot) => shot.takes.length === 3));
    assert.equal(film.id, seed.projectId);
    assert(storage.getItem(`aivora.film.v1.${seed.otherId}`));
    if (state.startsWith("seven")) {
      const target = film.shots.find((shot) => shot.id === seed.shotId);
      // Load the actual compiler, not a fixture copy, through the real exported builder.
      const compiled = compiler.compileSevenPartVideo(film, target);
      assert.deepEqual(compiled.issues, []);
      assert.equal(target.reviewedVideoPrompt, undefined);
      target.reviewedVideoPrompt = compiled.draft;
      const body = operations.storyFilmBatches(film, [target], false)[0].shots[0].prompt;
      assert(body.includes(compiled.draft.text));
      assert(body.length > 0 && body.length <= 2000);
      if (state === "seven-long-unknown") {
        assert(body.length > 600);
        assert(!/林骁|刀疤|待决定/.test(body));
      }
    }
    assert.deepEqual(audit.forbidden, []);
  }
});
test("export uses exact project/hash with canonical clone and holds one controlled completion", async () => {
  const { audit, seed, bridge } = setup("archive-export");
  const film = await bridge.readFilmProject(seed.projectId);
  film.title = "后来保存的合成标题";
  await bridge.writeFilmProject(film);
  film.title = "外部对象后改";
  assert.notEqual((await bridge.readFilmProject(seed.projectId)).title, film.title);
  const saved = await bridge.readFilmProject(seed.projectId);
  let entered;
  const checked = new Promise((resolve) => {
    entered = resolve;
  });
  const push = audit.exports.push.bind(audit.exports);
  audit.exports.push = (...rows) => {
    const length = push(...rows);
    entered();
    return length;
  };
  const pending = bridge.exportFilmProjectArchive({
    projectId: seed.projectId,
    expectedHash: await audit.hash(saved),
  });
  await checked;
  assert.equal(audit.exports.length, 1);
  assert.equal(audit.exports[0].matched, true);
  assert.equal(audit.pendingExports.length, 1);
  audit.resolveExport(0);
  assert.deepEqual(await pending, { kind: "EXPORTED", mediaCount: 4 });
  assert.deepEqual(
    await bridge.exportFilmProjectArchive({
      projectId: seed.projectId,
      expectedHash: "0".repeat(64),
      path: "renderer-path",
    }),
    { kind: "FAILED", code: "PROJECT_CHANGED" },
  );
});
test("failure and native-picker cancellation remain distinct outcomes", async () => {
  const { audit, seed, bridge } = setup("archive-export-outcomes");
  const input = {
    projectId: seed.projectId,
    expectedHash: await audit.hash(await bridge.readFilmProject(seed.projectId)),
  };
  assert.deepEqual(await bridge.exportFilmProjectArchive(input), {
    kind: "FAILED",
    code: "SOURCE_MISSING",
  });
  assert.deepEqual(await bridge.exportFilmProjectArchive(input), { kind: "CANCELLED" });
  assert(audit.exports.every((row) => row.matched));
});
test("native import takes zero arguments, creates another work, and library lookup reopens both original and imported identities", async () => {
  const { audit, seed, bridge } = setup("archive-import-reopen");
  const before = await bridge.readFilmProject(seed.projectId);
  assert.deepEqual(await bridge.importFilmProjectArchive("not-a-native-path"), {
    kind: "FAILED",
    code: "INVALID_INPUT",
  });
  const result = await bridge.importFilmProjectArchive();
  assert.equal(result.kind, "IMPORTED");
  assert.notEqual(result.projectId, seed.projectId);
  const imported = await bridge.readFilmProject(result.projectId);
  assert.equal(imported.shots.length, 6);
  assert(imported.shots.every((shot) => shot.takes.length === 3));
  assert.deepEqual(await bridge.readFilmProject(seed.projectId), before);
  assert.equal((await bridge.readFilmProject(before.seriesId)).id, before.id);
  assert.equal((await bridge.readFilmProject(imported.seriesId)).id, imported.id);
  assert.equal((await bridge.listFilmSeries()).length, 2);
  assert.deepEqual(
    audit.imports.map((call) => call.arity),
    [1, 0],
  );
});
test("native ABI completion stores the new work but never changes active selection by itself", async () => {
  const { audit, seed, bridge, storage } = setup("archive-import-guard");
  const before = await bridge.readFilmProject(seed.projectId);
  const pending = bridge.importFilmProjectArchive();
  assert.equal(audit.pendingImports.length, 1);
  storage.setItem("aivora.film.activeId", seed.otherId);
  audit.resolveImport(0);
  assert.equal((await pending).kind, "IMPORTED");
  assert.equal(audit.saved().id, seed.otherId);
  assert.deepEqual(await bridge.readFilmProject(seed.projectId), before);
  assert(await bridge.readFilmProject(seed.importedId));
});
test("provider/old export and legacy assembly stay forbidden with the new native capability installed", async () => {
  const { audit, bridge } = setup("seven-preview");
  await assert.rejects(bridge.createStoryFilm(), /FORBIDDEN_CREATION_DISPATCH/);
  await assert.rejects(window.aijianGrok.completeText({}), /FORBIDDEN_CREATION_DISPATCH/);
  await assert.rejects(bridge.exportFilmCut(), /FORBIDDEN_CREATION_DISPATCH/);
  await assert.rejects(
    bridge.assembleFilm("series", ["one"], "", -14, [""]),
    /FORBIDDEN_ASSEMBLY_DISPATCH/,
  );
  assert.deepEqual(audit.forbidden, ["createStoryFilm", "completeText", "exportFilmCut"]);
  assert.deepEqual(audit.assemblies, []);
  assert.deepEqual(window.__assemblyAudit.legacy, ["assembleFilm"]);
  assert.deepEqual(window.__assemblyAudit.forbidden, ["legacy-assemble"]);
});
test("CLI keeps original profile sizes and rejects remote/output inputs without leaking diagnostics", () => {
  for (const [name, count] of [
    ["pro-export-qc", 32],
    ["pro-export-progress", 32],
    ["pro-feature", 24],
    ["pro-creation", 32],
  ]) {
    const child = spawnSync(process.execPath, [`apps/studio-web/e2e/${name}-audit.mjs`, "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(child.status, 0);
    assert(child.stdout.includes(`(${count} expected)`));
  }
  for (const args of [
    ["--url", "https://private.invalid/?token=DO_NOT_PRINT"],
    ["--out", path.join(root, "apps/studio-web/src")],
  ]) {
    const child = spawnSync(
      process.execPath,
      ["apps/studio-web/e2e/pro-creation-audit.mjs", ...args],
      { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" } },
    );
    assert.equal(child.status, 2);
    assert.match(child.stderr, /PRO_CREATION_CONFIGURATION/);
    assert.doesNotMatch(child.stderr, /DO_NOT_PRINT|private.invalid/);
  }
});
test("actual shared annotation formatter keeps all profiles bounded and redacts arbitrary labels/keys/DOM", async () => {
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8");
  const section = source.slice(
    source.indexOf("function auditIdentity"),
    source.indexOf("function options"),
  );
  for (const kind of ["creation", "features", "progress", "qc"]) {
    const errors = [];
    const states = kind === "creation" ? creationStates : ["safe-state"];
    runInNewContext(section + ";emitGitHubErrors(input,{kind});", {
      kind,
      creationStates,
      featureStates: ["safe-state"],
      progressStates: ["safe-state"],
      qcStates: ["safe-state"],
      process: { env: { GITHUB_ACTIONS: "true" } },
      console: { error: (line) => errors.push(line) },
      input: {
        exitCode: 1,
        results: Array.from({ length: 12 }, () => ({
          page: states[0],
          combination: `1280x800-16x9-${states[0]}`,
          reached: true,
          failedControl: "SECRET_KEY",
          reachability: [{ box: { x: NaN, y: Infinity, width: 1, height: 2 } }],
          checkLine: "SECRET_KEY",
          error: "SECRET_KEY",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: NaN, y: Infinity, width: 4, height: 5 },
                diagnostic: {
                  control: "SECRET_KEY",
                  tag: "SECRET_KEY",
                  hitTag: "DIV",
                  hitClasses: ["SECRET_KEY", "acts"],
                  visible: { x: 1, y: 2, width: 3, height: 4 },
                  hitBox: { x: 1, y: 2, width: 3, height: 4 },
                  point: { x: NaN, y: Infinity },
                },
              },
              {
                kind: "control-clipped-without-scroll",
                diagnostic: {
                  control: "SECRET_KEY",
                  tag: "BUTTON",
                  clipTag: "SECTION",
                  clipClasses: ["SECRET_KEY"],
                },
              },
            ],
          },
        })),
      },
    });
    assert.equal(errors.length, 8);
    assert(
      errors.every(
        (line) =>
          !line.includes("SECRET_KEY") && !line.includes("NaN") && !line.includes("Infinity"),
      ),
    );
    assert(errors.every((line) => line.length < 1800));
  }
});
