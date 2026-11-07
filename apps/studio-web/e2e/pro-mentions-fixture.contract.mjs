/** Node-only reference fixture/CLI checks; never Chromium or a provider. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { createServer } from "vite";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { installMentionsBridge, seedMentionsProject } from "./pro-mentions-fixture.mjs";
import { mentionStates } from "./pro-mentions-cases.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url)),
  oldWindow = globalThis.window;
let server, folder, project, references, review, story, continuity, director, enrichment;
before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "mentions-contract-"));
  server = await createServer({
    root: path.join(root, "apps/studio-web"),
    configFile: path.join(root, "apps/studio-web/vite.config.ts"),
    cacheDir: path.join(folder, "vite-cache"),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
  });
  project = await server.ssrLoadModule("/src/aivora/film/project.ts");
  continuity = await server.ssrLoadModule("/src/aivora/film/continuity-rules.ts");
  references = await server.ssrLoadModule("/src/aivora/pro/actions/assistant-references.ts");
  review = await server.ssrLoadModule("/src/aivora/pro/actions/director-field-review.ts");
  story = await server.ssrLoadModule("/src/aivora/pro/actions/story-confirmation.ts");
  director = await server.ssrLoadModule("/src/aivora/pro/actions/director-draft.ts");
  enrichment = await server.ssrLoadModule("/src/aivora/pro/enrichment-workflow.ts");
});
after(async () => {
  globalThis.window = oldWindow;
  await server?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
function setup(state = mentionStates[0]) {
  const map = new Map(),
    storage = new Proxy(
      { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) },
      {
        ownKeys: () => [...map.keys()],
        getOwnPropertyDescriptor: (_t, k) =>
          map.has(k) ? { enumerable: true, configurable: true, value: map.get(k) } : undefined,
      },
    );
  const film = project.sampleFilm();
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.scenes = [film.scenes[1], film.scenes[0], film.scenes[2]];
  for (const s of film.shots) {
    s.takes = [1, 2, 3].map((i) => ({
      id: `${s.id}-${i}`,
      shotId: s.id,
      index: i,
      status: "done",
      videoPath: `/synthetic/${s.id}-${i}.mp4`,
      videoUrl: "",
      stillUrl: "",
      prompt: "",
      reason: "",
      createdAt: "",
    }));
    s.selectedTakeId = s.takes[0].id;
  }
  storage.setItem("aivora.film.active", JSON.stringify(film));
  globalThis.window = { localStorage: storage, aijian: {}, aijianGrok: {} };
  const seed = seedMentionsProject({ state });
  installCreationBridge({ state });
  installMentionsBridge({ state });
  const raw = () => window.__proCreationAudit.saved(),
    audit = window.__proMentionsAudit;
  const request = (role, asked) => {
    const result = references.captureAssistantReferences(
      raw(),
      {
        projectId: seed.projectId,
        page: role === "art" ? "cast" : "board",
        sceneId: seed.sceneId,
        ...(role === "art" ? {} : { shotId: seed.firstShotId }),
      },
      asked,
      role,
    );
    assert.equal(result.ok, true);
    audit.expect({ userRequest: asked, scope: result.capture.taskScope });
    return {
      agent: role,
      projectId: raw().backendProjectId,
      text: `synthetic context\n${result.capture.context}\nfixed contract`,
    };
  };
  return { seed, raw, audit, request, bridge: window.aijianGrok, native: window.aijian };
}
test("four fixed states preserve sixteen combinations and default mode does not hold or execute a request", () => {
  assert.deepEqual(mentionStates, [
    "refs-menu-project",
    "refs-director-inverse",
    "refs-invalid",
    "refs-stale",
  ]);
  const f = setup();
  assert.equal(f.audit.hold, false);
  assert.deepEqual(f.audit.requests, []);
  assert.deepEqual(f.audit.writes, []);
  assert.equal(mentionStates.length * 4, 16);
});
test("six-shot fixture preserves four unrelated three-version media groups while allowing a guarded empty target replacement", () => {
  const f = setup("refs-director-inverse"),
    raw = f.raw();
  assert.equal(raw.shots.length, 6);
  assert(raw.shots.slice(2).every((s) => s.takes.length === 3));
  assert(raw.shots.slice(0, 2).every((s) => !s.takes.length && !s.poster));
  assert.equal(raw.shots[0].id, f.seed.firstShotId);
});
test("real parser consumes the quoted existing place and complete long name, synthetic request validates project scope and never writes", async () => {
  const f = setup(),
    asked = `${f.seed.personToken} ${f.seed.placeToken} `;
  const reply = await f.bridge.completeText(f.request("art", asked));
  assert.equal(reply.kind, "OK");
  assert.equal(f.audit.requests.length, 1);
  assert.deepEqual(
    f.audit.requests[0].context.references.map((r) => r.name),
    [f.seed.person, f.seed.place],
  );
  assert(!JSON.stringify(f.audit.requests).includes("SYNTHETIC_REFERENCE_PRIVATE"));
  assert.deepEqual(f.audit.writes, []);
  assert.deepEqual(f.audit.forbidden, []);
});
test("director synthetic reply forms a complete real structural field review and new first-shot identity without losing outside media", async () => {
  const f = setup("refs-director-inverse"),
    base = continuity.applyContinuityChecks(project.upgradeFilm(f.raw()));
  const asked = `${f.seed.personToken} @镜头1 保持原文。`;
  const first = f.request("director", asked);
  const captured = first.text.split("\n").find((line) => line.startsWith('{"userRequest":'));
  const request = async (agent, context, instruction) => {
    const reply = await f.bridge.completeText({
      agent,
      projectId: base.backendProjectId,
      text: project.agentRequest(agent, `${context}\n${captured}`, instruction),
    });
    return { text: reply.text, detail: "" };
  };
  const planned = await director.planDirectorDraft(base, f.seed.sceneId, asked, {
    connected: true,
    current: () => true,
    progress: () => {},
    request,
    enrich: (film, sceneId, shots, valid, control) =>
      enrichment.enrichDirectorPlan(film, sceneId, shots, {
        request,
        valid,
        control,
        warning: () => {},
        unassigned: () => {},
      }),
    warnings: () => [],
  });
  assert.equal(planned.status, "complete");
  const shots = planned.shots;
  assert.deepEqual(
    f.audit.requests.map((r) => r.agent),
    ["director", "performance"],
  );
  assert(shots?.length);
  assert.notEqual(shots[0].id, base.shots[0].id);
  const origin = {
    projectId: base.id,
    page: "board",
    sceneId: f.seed.sceneId,
    shotId: f.seed.firstShotId,
  };
  const tx = story.prepareDirectorConfirmation(base, shots, []);
  const projected = review.prepareDirectorFieldReview(base, tx, origin);
  assert(projected);
  assert(projected.fieldRows.some((r) => r.label.includes("镜头顺序")));
  const result = story.applyStoryConfirmation(base, tx);
  assert(result.receipt);
  assert.deepEqual(result.film.shots.slice(1), base.shots.slice(2));
});
test("stale default really admits and holds one reply until explicit transport release without saving", async () => {
  const f = setup("refs-stale"),
    promise = f.bridge.completeText(f.request("art", `${f.seed.personToken} 请调整画风。`));
  assert.equal(f.audit.hold, true);
  assert.equal(f.audit.pending.length, 1);
  assert.equal(f.audit.pending[0].delivered, false);
  assert.equal(f.audit.requests.length, 1);
  assert.equal(f.audit.writes.length, 0);
  f.audit.release(0);
  assert.equal((await promise).kind, "OK");
  assert.equal(f.audit.pending[0].delivered, true);
});
test("duplicate or unknown references are rejected by the real parser with no fixture dispatch, missing context is not silently accepted", async () => {
  const f = setup("refs-invalid"),
    selection = { projectId: f.seed.projectId, page: "cast", sceneId: f.seed.sceneId };
  assert.equal(
    references.captureAssistantReferences(f.raw(), selection, f.seed.personToken, "art").code,
    "ASSISTANT_REFERENCE_AMBIGUOUS",
  );
  assert.equal(
    references.captureAssistantReferences(f.raw(), selection, "@unknown", "art").code,
    "ASSISTANT_REFERENCE_UNKNOWN",
  );
  assert.deepEqual(f.audit.requests, []);
  await assert.rejects(
    f.bridge.completeText({
      agent: "art",
      projectId: f.raw().backendProjectId,
      text: "no captured context",
    }),
    /FORBIDDEN_REFERENCE/,
  );
  assert.deepEqual(f.audit.forbidden, ["context"]);
});
test("media generation, speech and old exports remain forbidden, unknown manual agents cannot bypass the closed fixture", async () => {
  const f = setup();
  for (const method of ["createStoryFilm", "generateFilmVideo", "exportFilmCut"])
    await assert.rejects(f.native[method](), /FORBIDDEN/);
  await assert.rejects(f.bridge.speak(), /FORBIDDEN/);
  await assert.rejects(
    f.bridge.completeText({ agent: "writer", text: "not allowed" }),
    /FORBIDDEN/,
  );
  assert.equal(f.audit.requests.length, 0);
});
test("CLI declares sixteen and rejects unsafe flags/output without printing private argument values", async () => {
  const entry = path.join(root, "apps/studio-web/e2e/pro-mentions-audit.mjs");
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
      ';emitGitHubErrors(report,{kind:"mentions"});',
    {
      process: { env: { GITHUB_ACTIONS: "true" } },
      mentionStates,
      console: { error: (line) => lines.push(line) },
      report: {
        exitCode: 1,
        results: Array.from({ length: 12 }, (_, i) => ({
          passed: false,
          reached: true,
          page: i ? "PRIVATE_BODY" : mentionStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${mentionStates[0]}`,
          checkLine: i ? Infinity : 88,
          error: "PRIVATE_TOKEN",
          geometry: {
            issues: [
              {
                kind: "covered-center",
                box: { x: NaN, y: Infinity, width: 20, height: 18 },
                diagnostic: {
                  control: i ? "PRIVATE_CONTROL" : "reference-confirm",
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
  assert(lines[0].includes("PRO_MENTIONS_AUDIT"));
  assert(lines[0].includes("checkLine=88"));
  assert(lines[0].includes("control1=reference-confirm"));
  assert(lines.every((line) => !/PRIVATE|NaN|Infinity/.test(line)));
  const start = source.indexOf("    const expected =\n"),
    end = source.indexOf("    report.expectedResults = expected;");
  assert.equal(
    runInNewContext(source.slice(start, end) + ";expected", {
      profile: { kind: "mentions" },
      mentionStates,
      viewports: [1, 2],
      aspects: [1, 2],
    }),
    16,
  );
});

test("real CLI setup failure retains sixteen expected combinations and sandbox metadata without launching a browser", async () => {
  const out = path.join(folder, "missing-browser-report");
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "apps/studio-web/e2e/pro-mentions-audit.mjs"),
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
  assert.deepEqual(report.expectedStates, mentionStates);
  assert.equal(report.results.length, 0);
  assert.equal(report.exitCode, 2);
});
