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
import { sceneAudioStates } from "./pro-scene-audio-cases.mjs";
import {
  installSceneAudioBridge,
  seedSceneAudioProject,
  readSceneAudioApplyState,
} from "./pro-scene-audio-fixture.mjs";
import { installAudioGroupsBridge } from "./pro-audio-groups-fixture.mjs";
import * as groupHelpers from "./pro-audio-groups-browser-helper.mjs";
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
  validator = await server.ssrLoadModule("/src/aivora/pro/actions/scene-audio-suggestions.ts");
  catalog = await loadLibraryAuditCatalog();
});
after(async () => {
  globalThis.window = originalWindow;
  await server?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
function setup(state = sceneAudioStates[0]) {
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
  Object.assign(seed, seedSceneAudioProject());
  installCreationBridge({ state });
  installShotAudioBridge({ state, catalog });
  installSceneAudioBridge({ catalog });
  installAudioGroupsBridge({
    state,
    scope: "scene",
    helperModuleUrl: new URL("./pro-audio-groups-browser-helper.mjs", import.meta.url).href,
  });
  window.__audioGroupsAudit.helpers = groupHelpers;
  installAssemblyAuditBridge();
  const creation = window.__proCreationAudit,
    audit = window.__shotAudioAudit,
    bridge = window.aijian;
  const input = async () => {
    const raw = creation.record(seed.projectId);
    return {
      projectId: raw.id,
      expectedProjectHash: await creation.hash(raw),
      sceneId: seed.sceneId,
      expectedSelection: raw.shots.map((s) => ({ shotId: s.id, takeId: s.selectedTakeId })),
    };
  };
  return { creation, audit, bridge, seed, input, groups: window.__audioGroupsAudit };
}
async function prepare(f, lanes = ["ambience", "sfx"]) {
  const input = await f.input(),
    plan = await f.bridge.suggestBundledFilmSceneAudio(input);
  assert(validator.validSceneAudioPlan(plan, input));
  return {
    ...input,
    catalogSha256: plan.catalogSha256,
    pickerSha256: plan.pickerSha256,
    planFingerprint: plan.planFingerprint,
    lanes,
  };
}
test("default scene modes initialize actual six-shot three-take data and never apply automatically", () => {
  assert.equal(sceneAudioStates.length * 4, 16);
  for (const [i, state] of sceneAudioStates.entries()) {
    const f = setup(state),
      raw = f.creation.record(f.seed.projectId);
    assert.equal(f.groups.mode, ["success", "success", "transport", "partial-ack"][i]);
    assert.equal(raw.shots.length, 6);
    assert.equal(f.seed.shotId, raw.shots[0].id);
    assert(raw.shots.every((s) => s.takes.length === 3 && s.sceneId === f.seed.sceneId));
    assert.equal(f.groups.calls.length, 0);
    assert.equal(raw.audioClips.length, 1);
  }
});
test("real scene validator sees full measured clock, six cross-shot segments, complete envelopes and all notes without writes", async () => {
  const f = setup(),
    input = await f.input(),
    before = f.creation.record(f.seed.projectId);
  const reply = await f.bridge.suggestBundledFilmSceneAudio(input);
  assert(validator.validSceneAudioPlan(reply, input));
  assert.equal(reply.clock.shots.length, 6);
  assert.equal(reply.clock.durationSeconds, 13.5);
  assert.equal(reply.clips.length, 6);
  assert(new Set(reply.clips.map((c) => c.shotId)).size > 1);
  assert(
    reply.clips.every(
      (c) => c.envelope.fades.length === 2 && c.envelope.gainAutomation.length === 2,
    ),
  );
  assert.equal(reply.warnings.length, 5);
  assert.equal(reply.limitations.length, 5);
  assert.deepEqual(f.creation.record(f.seed.projectId), before);
  assert.equal(f.groups.calls.length, 0);
  assert.equal(f.audit.calls.length, 0);
});
test("explicit scene add uses one complete-lane RPC and actual shipped whole-group digest", async () => {
  const f = setup(sceneAudioStates[1]),
    input = await prepare(f),
    before = f.creation.record(f.seed.projectId);
  const reply = await f.bridge.applyBundledFilmSceneAudio(input);
  assert.equal(reply.kind, "ADDED");
  assert.equal(f.groups.calls.length, 1);
  assert.equal(f.groups.calls[0].reply, "ADDED");
  assert.equal(f.groups.calls[0].casMatched, true);
  assert.equal(f.groups.calls[0].reviewMatched, true);
  assert.equal(f.groups.calls[0].initialCas, true);
  assert.equal(f.groups.calls[0].finalCas, true);
  window.document = { querySelector: () => null, querySelectorAll: () => [] };
  const observed = readSceneAudioApplyState();
  assert.equal(observed.calls, 1);
  assert.equal(observed.nativeWrites, 1);
  assert.equal(observed.reply, "ADDED");
  assert.equal(observed.saved, false);
  assert.equal(observed.rebased, false);
  assert.equal(reply.receipt.memberCount, 4);
  assert.deepEqual(reply.project.audioClips.slice(0, 1), before.audioClips);
  assert.deepEqual(reply.project.shots, before.shots);
  assert.equal(new Set(reply.project.audioClips.slice(1).map((c) => c.shotId)).size, 4);
  const proof = groupHelpers.audioSuggestionGroupInputs(
    reply.project.audioClips,
    reply.receipt.groupId,
  );
  assert.equal(proof.members.length, 4);
  for (const member of proof.members)
    assert.equal(
      await groupHelpers.digestGroupText(member.creativeInput),
      reply.receipt.members.find((m) => m.key === member.key).creativeSha256,
    );
  assert.equal(
    await groupHelpers.digestGroupText(
      groupHelpers.audioSuggestionMemberSetInput(reply.receipt.members),
    ),
    reply.receipt.memberSetSha256,
  );
  assert.equal(
    groupHelpers.audioSuggestionGroupInputs(
      reply.project.audioClips.filter((c) => c.shotId === reply.project.shots[0].id),
      reply.receipt.groupId,
    ),
    null,
  );
});
test("default unknown keeps one apply BUSY until native completion; no test mode override", async () => {
  const f = setup("scene-audio-unknown"),
    input = await prepare(f);
  await assert.rejects(f.bridge.applyBundledFilmSceneAudio(input));
  assert.equal(f.groups.active, true);
  assert.equal(f.groups.nativeWrites, 0);
  const first = input.expectedSelection[0];
  assert.equal(
    (
      await f.bridge.inspectBundledFilmAudioTarget({
        projectId: input.projectId,
        expectedProjectHash: input.expectedProjectHash,
        ...first,
      })
    ).code,
    "BUSY",
  );
  const reply = await f.groups.finish();
  assert.equal(reply.kind, "ADDED");
  assert.equal(f.groups.active, false);
  assert.equal(f.groups.nativeWrites, 1);
  assert.equal(f.groups.calls.length, 1);
});
test("default partial ACK cannot equal complete group receipt and does not drop stored members", async () => {
  const f = setup("scene-audio-partial-conflict"),
    input = await prepare(f),
    reply = await f.bridge.applyBundledFilmSceneAudio(input);
  assert.equal(reply.receipt.memberCount, 4);
  assert.equal(reply.receipt.members.length, 3);
  assert.equal(f.creation.record(input.projectId).audioClips.length, 5);
  assert.equal(f.groups.calls.length, 1);
});
test("scene exact shape and whole-film selection cannot be replaced by a scene-only subset or caller paths", async () => {
  for (const change of [
    (v) => ({ ...v, path: "/private" }),
    (v) => ({ ...v, expectedSelection: v.expectedSelection.slice(0, 1) }),
    (v) => ({ ...v, lanes: ["sfx", "sfx"] }),
  ]) {
    const f = setup(),
      input = await prepare(f);
    await assert.rejects(f.bridge.applyBundledFilmSceneAudio(change(input)));
    assert.equal(f.groups.nativeWrites, 0);
  }
});
test("CLI fixes sixteen states, blocks unsafe options and missing-browser setup preserves a real failure report", async () => {
  const cli = fileURLToPath(new URL("./pro-scene-audio-audit.mjs", import.meta.url));
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /16 expected/);
  assert.match(help.stdout, /sandbox is always enabled/);
  for (const args of [["--unknown"], ["--url", "https://example.invalid"], ["--out", root]])
    assert.equal(spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" }).status, 2);
  const out = path.join(folder, "negative"),
    missing = path.join(folder, "missing-browser");
  const result = spawnSync(process.execPath, [cli, "--browser", missing, "--out", out], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "true" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PRO_SCENE_AUDIO_SETUP_BROWSER_DISCOVERY/);
  assert(!result.stderr.includes(missing));
  const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
  assert.equal(report.expectedResults, 16);
  assert.deepEqual(report.expectedStates, sceneAudioStates);
  assert.equal(report.chromiumSandbox, true);
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8");
  const count = source.slice(
    source.indexOf("    const expected =\n"),
    source.indexOf("    report.expectedResults = expected;"),
  );
  assert.equal(
    runInNewContext(count + ";expected", {
      profile: { kind: "scene-audio" },
      sceneAudioStates,
      viewports: [1, 2],
      aspects: [1, 2],
    }),
    16,
  );
});
test("public scene annotations only emit closed states, controls, finite geometry and at most eight messages", async () => {
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8"),
    lines = [];
  runInNewContext(
    source.slice(source.indexOf("function auditIdentity"), source.indexOf("function options")) +
      ';emitGitHubErrors(report,{kind:"scene-audio"});',
    {
      process: { env: { GITHUB_ACTIONS: "true" } },
      sceneAudioStates,
      console: { error: (line) => lines.push(line) },
      report: {
        exitCode: 1,
        results: Array.from({ length: 12 }, (_, i) => ({
          passed: false,
          reached: true,
          page: i ? "PRIVATE_BODY" : sceneAudioStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${sceneAudioStates[0]}`,
          checkLine: i ? "PRIVATE_KEY" : 88,
          error: "PRIVATE_SECRET",
          sceneApply: i
            ? {
                calls: Infinity,
                matched: "PRIVATE",
                reply: "PRIVATE",
                nativeWrites: -1,
                saved: "PRIVATE",
                rebased: NaN,
              }
            : {
                calls: 1,
                matched: true,
                casMatched: true,
                reviewMatched: true,
                initialCas: true,
                finalCas: true,
                reply: "ADDED",
                nativeWrites: 1,
                pending: 0,
                saved: false,
                rebased: true,
                stale: false,
                unknown: false,
              },
          geometry: {
            issues: [
              {
                kind: "covered-center",
                control: i ? "PRIVATE_CONTROL" : "scene-audio-open",
                box: { x: NaN, y: Infinity, width: 22, height: 18 },
                diagnostic: {
                  control: i ? "PRIVATE_CONTROL" : "scene-audio-open",
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
  assert(lines[0].includes("PRO_SCENE_AUDIO_AUDIT"));
  assert(lines[0].includes("checkLine=88"));
  assert(lines[0].includes("control1=scene-audio-open"));
  assert(lines[0].includes("sceneApplyCalls=1 sceneMatched=1 sceneCas=1 sceneReview=1"));
  assert(lines[0].includes("sceneReply=ADDED sceneNativeWrites=1"));
  assert(lines[0].includes("sceneSaved=0 sceneRebased=1"));
  assert(lines[1].includes("sceneReply=UNKNOWN"));
  assert(lines[1].includes("sceneApplyCalls=unknown"));
  assert(
    lines.every(
      (line) => !line.includes("PRIVATE") && !line.includes("NaN") && !line.includes("Infinity"),
    ),
  );
});
test("a legitimate stale raw hash returns native PROJECT_CHANGED instead of throwing a mock assertion, fresh success stays exact", async () => {
  const f = setup(),
    input = await f.input();
  const raw = f.creation.record(input.projectId);
  await f.bridge.writeFilmProject({ ...raw, savedAt: "later-ordinary-save" });
  assert.deepEqual(await f.bridge.suggestBundledFilmSceneAudio(input), {
    kind: "FAILED",
    code: "PROJECT_CHANGED",
    unchanged: true,
  });
  const fresh = await f.input(),
    reply = await f.bridge.suggestBundledFilmSceneAudio(fresh);
  assert(validator.validSceneAudioPlan(reply, fresh));
  assert.deepEqual(
    window.__sceneAudioAudit.calls.map((c) => [c.matched, c.reply]),
    [
      [false, "PROJECT_CHANGED"],
      [true, "SCENE_SUGGESTED"],
    ],
  );
  assert.deepEqual(window.__sceneAudioAudit.forbidden, []);
  assert.equal(f.groups.nativeWrites, 0);
});
