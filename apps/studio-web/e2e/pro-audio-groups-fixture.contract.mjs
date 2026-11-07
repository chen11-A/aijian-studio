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
import { audioGroupStates } from "./pro-audio-groups-cases.mjs";
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
  validator = await server.ssrLoadModule("/src/aivora/pro/actions/shot-audio-suggestions.ts");
  catalog = await loadLibraryAuditCatalog();
});
after(async () => {
  globalThis.window = originalWindow;
  await server?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
function setup(state = audioGroupStates[0]) {
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
  installAudioGroupsBridge({
    state,
    helperModuleUrl: new URL("./pro-audio-groups-browser-helper.mjs", import.meta.url).href,
  });
  window.__audioGroupsAudit.helpers = groupHelpers;
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
  return { creation, audit, bridge, seed, input, groups: window.__audioGroupsAudit };
}
async function prepare(f, lanes = ["ambience", "sfx"]) {
  const input = await f.input(),
    plan = await f.bridge.suggestBundledFilmShotAudio(input);
  assert(validator.validShotAudioPlan(plan, input));
  return {
    ...input,
    catalogSha256: plan.catalogSha256,
    pickerSha256: plan.pickerSha256,
    planFingerprint: plan.planFingerprint,
    lanes,
  };
}
test("four real default modes and fixed sixteen combinations preserve six shots and all takes", () => {
  assert.equal(audioGroupStates.length * 2 * 2, 16);
  for (const [index, state] of audioGroupStates.entries()) {
    const f = setup(state),
      film = f.creation.record(f.seed.projectId);
    assert.equal(f.groups.mode, ["success", "hold", "transport", "partial-ack"][index]);
    assert.equal(film.shots.length, 6);
    assert(film.shots.every((s) => s.takes.length === 3));
    assert.equal(film.audioClips.length, 1);
    assert.equal(f.groups.calls.length, 0);
  }
});
test("default explicit selection appends all selected segments with actual helper digest and preserves raw prefix", async () => {
  const f = setup(),
    input = await prepare(f),
    before = f.creation.record(f.seed.projectId),
    reply = await f.bridge.applyBundledFilmShotAudio(input);
  assert.equal(reply.kind, "ADDED");
  assert.equal(reply.receipt.memberCount, 4);
  assert.deepEqual(reply.project.audioClips.slice(0, 1), before.audioClips);
  assert.deepEqual(reply.project.shots, before.shots);
  assert.equal(f.groups.nativeWrites, 1);
  const proof = groupHelpers.audioSuggestionGroupInputs(
    reply.project.audioClips,
    reply.receipt.groupId,
  );
  assert(proof);
  const members = await Promise.all(
    proof.members.map(async (m) => ({
      key: m.key,
      clipId: m.clipId,
      creativeSha256: await groupHelpers.digestGroupText(m.creativeInput),
    })),
  );
  assert.equal(
    await groupHelpers.digestGroupText(groupHelpers.audioSuggestionMemberSetInput(members)),
    reply.receipt.memberSetSha256,
  );
  assert(
    reply.project.audioClips
      .slice(1)
      .every((c) => c.envelope.fades.length === 2 && c.envelope.gainAutomation.length === 2),
  );
});
test("default busy mode really admits a pending first call and rejects duplicate dispatch until release", async () => {
  const f = setup("audio-groups-busy"),
    input = await prepare(f);
  let admitted;
  const entered = new Promise((r) => (admitted = r));
  f.groups.admitted = admitted;
  const request = f.bridge.applyBundledFilmShotAudio(input);
  await entered;
  assert.equal(f.groups.pending.length, 1);
  assert.equal(f.groups.nativeWrites, 0);
  assert.equal((await f.bridge.inspectBundledFilmAudioTarget(await f.input())).code, "BUSY");
  await assert.rejects(f.bridge.applyBundledFilmShotAudio(input), /FORBIDDEN/);
  await f.groups.finish();
  assert.equal((await request).kind, "ADDED");
  assert.equal(f.groups.nativeWrites, 1);
});
test("default transport unknown stays BUSY and never writes until native settles; readback is complete", async () => {
  const f = setup("audio-groups-unknown"),
    input = await prepare(f),
    before = f.creation.record(f.seed.projectId);
  await assert.rejects(f.bridge.applyBundledFilmShotAudio(input), /UNKNOWN/);
  assert.deepEqual(f.creation.record(f.seed.projectId), before);
  assert.equal((await f.bridge.inspectBundledFilmAudioTarget(await f.input())).code, "BUSY");
  await f.groups.finish();
  assert.equal(f.groups.calls.length, 1);
  assert.equal(f.groups.nativeWrites, 1);
  assert.equal((await f.bridge.inspectBundledFilmAudioTarget(await f.input())).kind, "TARGET");
  assert.equal(f.creation.record(f.seed.projectId).audioClips.length, 5);
});
test("default partial ACK keeps complete canonical group but does not pretend receipt is complete", async () => {
  const f = setup("audio-groups-partial-conflict"),
    reply = await f.bridge.applyBundledFilmShotAudio(await prepare(f));
  assert.equal(reply.kind, "ADDED");
  assert.equal(reply.receipt.memberCount, 4);
  assert.equal(reply.receipt.members.length, 3);
  assert.equal(f.creation.record(f.seed.projectId).audioClips.length, 5);
  assert.equal(f.groups.nativeWrites, 1);
});
test("pending native CAS rejects changed canonical and preserves media registry", async () => {
  const f = setup("audio-groups-unknown"),
    input = await prepare(f);
  await assert.rejects(f.bridge.applyBundledFilmShotAudio(input));
  const other = { ...f.creation.record(f.seed.projectId), title: "later canonical edit" };
  await f.bridge.writeFilmProject(other);
  assert.equal((await f.groups.finish()).code, "PROJECT_CHANGED");
  assert.equal(f.groups.nativeWrites, 0);
  assert.deepEqual(f.groups.copied, {});
  assert.equal(f.creation.record(f.seed.projectId).title, other.title);
});
test("background save of the other work never changes fixture active selection", async () => {
  const f = setup(),
    active = window.localStorage.getItem("aivora.film.activeId"),
    other = f.creation.record(f.seed.otherId);
  await f.bridge.writeFilmProject({ ...other, styleZh: "ordinary other write" });
  assert.equal(window.localStorage.getItem("aivora.film.activeId"), active);
  assert.equal(f.creation.record(f.seed.otherId).styleZh, "ordinary other write");
});
test("invalid subset and paid calls remain forbidden rather than partial execution", async () => {
  const f = setup(),
    input = await prepare(f);
  await assert.rejects(f.bridge.applyBundledFilmShotAudio({ ...input, lanes: [] }), /FORBIDDEN/);
  await assert.rejects(f.bridge.createStoryFilm({}), /FORBIDDEN/);
  assert.equal(f.groups.nativeWrites, 0);
  assert.equal(f.groups.calls[0].matched, false);
});
test("CLI setup safety still rejects unknown arguments and unsafe output without launching browser", () => {
  const script = path.join(root, "apps/studio-web/e2e/pro-audio-groups-audit.mjs");
  for (const args of [["--unknown"], ["--out", root], ["--url", "https://example.invalid/"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 2);
    assert(!result.stdout.includes("PASS "));
  }
});

test("public failure metadata has closed state/control allowlists, bounded source lines and at most eight entries", async () => {
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8"),
    errors = [];
  runInNewContext(
    source.slice(source.indexOf("function auditIdentity"), source.indexOf("function options")) +
      `;emitGitHubErrors(input,{kind:"audio-groups"});`,
    {
      audioGroupStates,
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
          page: i ? "PRIVATE_BODY" : audioGroupStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${audioGroupStates[0]}`,
          reached: true,
          checkLine: i ? Infinity : 123,
          error: "PRIVATE_STACK",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: 1, y: 2, width: 3, height: 4 },
                diagnostic: {
                  control: i ? "PRIVATE_TOKEN" : "shot-audio-apply",
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
  assert(errors[0].includes("control1=shot-audio-apply"));
  assert.doesNotMatch(errors.join("\n"), /PRIVATE_|Infinity/);
});
test("setup failure retains fixed sixteen-result report and bounded environment annotation", async () => {
  const out = path.join(folder, "missing-browser-report"),
    result = spawnSync(
      process.execPath,
      [
        path.join(root, "apps/studio-web/e2e/pro-audio-groups-audit.mjs"),
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
  assert.deepEqual(report.expectedStates, audioGroupStates);
  assert.match(result.stderr, /PRO_AUDIO_GROUPS_SETUP_BROWSER_DISCOVERY/);
  assert(!result.stderr.includes(path.join(folder, "missing-chrome")));
});
test("default preview wrapper records only a completed, hash-checked current-project reply without adding or saving", async () => {
  const f = setup(),
    other = f.creation.record(f.seed.otherId);
  const input = { projectId: other.id, expectedHash: await f.creation.hash(other) };
  assert.deepEqual(f.groups.previews, []);
  const result = await f.bridge.getFilmAudioMixPreview(input);
  assert.deepEqual(f.groups.previews, [{ ...input, kind: result.kind }]);
  assert.equal(result.kind, "FAILED");
  assert.equal(result.code, "SOURCE_UNVERIFIED");
  assert.equal(f.groups.writes.length, 0);
  assert.equal(f.groups.calls.length, 0);
  await assert.rejects(
    f.bridge.getFilmAudioMixPreview({ ...input, expectedHash: "0".repeat(64) }),
    /FORBIDDEN/,
  );
  assert.equal(f.groups.previews.length, 1);
});
