/** Node fixture checks only: no renderer, native media or listening claim. */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { URL, fileURLToPath } from "node:url";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { assemblyStates } from "./pro-assembly-cases.mjs";
import { assertAssemblyRequests, waitAssemblyIdle } from "./pro-assembly-assertions.mjs";
import {
  installAssemblyAuditBridge,
  installAssemblyMediaRequests,
} from "./pro-assembly-fixture.mjs";

const originalWindow = globalThis.window;
const clone = (value) => JSON.parse(JSON.stringify(value));
afterEach(() => {
  globalThis.window = originalWindow;
});
function setup(mode = "refuse") {
  const raw = {
    id: "film_aaaaaaaaaaaaaaaaaaaa",
    savedAt: "before",
    shots: [1, 2, 3].map((i) => ({
      id: `shot-${i}`,
      selectedTakeId: `take-${i}-2`,
      takes: [1, 2].map((n) => ({
        id: `take-${i}-${n}`,
        status: "done",
        videoPath: `/synthetic/${i}-${n}.mp4`,
      })),
    })),
  };
  globalThis.window = {
    crypto: webcrypto,
    TextEncoder,
    aijian: {
      readFilmProject: async () => clone(raw),
    },
  };
  installAssemblyAuditBridge({ mode, durations: [1.2, 2.4, 0.8] });
  const audit = window.__assemblyAudit,
    bridge = window.aijian;
  const input = async () => ({
    projectId: raw.id,
    expectedHash: await audit.hash(raw),
    expectedSelection: raw.shots.map((s) => ({ shotId: s.id, takeId: s.selectedTakeId })),
  });
  return { raw, audit, bridge, input };
}
test("default admission records exact current raw hash/selection and safely refuses local assembly", async () => {
  const f = setup();
  assert.deepEqual(await f.bridge.assembleFilmProject(await f.input(), "op-1"), {
    kind: "FAILED",
    code: "SOURCE_UNVERIFIED",
  });
  assert.equal(f.audit.calls.length, 1);
  assert.equal(f.audit.calls[0].matched, true);
  assert.equal(f.audit.calls[0].operationId, "op-1");
  assert.deepEqual(f.audit.legacy, []);
  assert.deepEqual(f.audit.forbidden, []);
});
test("hash, ordered selected take and exact field failures never create artifacts", async () => {
  const f = setup("success"),
    input = await f.input();
  assert.equal((await f.bridge.assembleFilmProject(undefined, "absent")).code, "INVALID_INPUT");
  assert.equal(f.audit.pendingNative.unknown, 0);
  assert.equal(
    (await f.bridge.assembleFilmProject({ ...input, expectedHash: "0".repeat(64) }, "stale")).code,
    "PROJECT_CHANGED",
  );
  assert.equal(
    (
      await f.bridge.assembleFilmProject(
        { ...input, expectedSelection: [...input.expectedSelection].reverse() },
        "order",
      )
    ).code,
    "PROJECT_CHANGED",
  );
  assert.equal(
    (await f.bridge.assembleFilmProject({ ...input, path: "/untrusted" }, "extra")).code,
    "INVALID_INPUT",
  );
  assert.deepEqual(f.audit.artifacts, []);
});
test("success clock is measured fixture data, not project planned seconds, and does not write", async () => {
  const f = setup("success"),
    before = clone(f.raw),
    input = await f.input();
  const result = await f.bridge.assembleFilmProject(input, "clock");
  assert.equal(result.kind, "ASSEMBLED");
  assert.equal(result.projectHash, input.expectedHash);
  assert.deepEqual(
    result.shots.map((s) => s.startSeconds),
    [0, 1.2, 3.5999999999999996],
  );
  assert.deepEqual(
    result.shots.map((s) => s.durationSeconds),
    [1.2, 2.4, 0.8],
  );
  assert.equal(result.durationSeconds, 4.3999999999999995);
  assert.deepEqual(f.raw, before);
});
test("REQUESTED ACK leaves pending promise until explicit stopped feed and result", async () => {
  const f = setup("hold"),
    events = [];
  f.bridge.onFilmAssemblyProgress((e) => events.push(e));
  const admitted = new Promise((resolve) => {
    f.audit.admitted = resolve;
  });
  let settled = false;
  const promise = f.bridge.assembleFilmProject(await f.input(), "pending").then((r) => {
    settled = true;
    return r;
  });
  await admitted;
  assert.equal(f.audit.pendingNative[f.raw.id], 1);
  const ack = await f.bridge.cancelFilmAssemblyOperation("pending");
  assert.equal(ack.kind, "REQUESTED");
  assert.equal(ack.snapshot.cancelState, "requested");
  assert.equal(settled, false);
  assert.equal(
    events.some((e) => e.cancelState === "stopped"),
    false,
  );
  f.audit.finish("pending", { stopped: true });
  assert.deepEqual(await promise, { kind: "FAILED", code: "OPERATION_STOPPED" });
  assert.equal(f.audit.pendingNative[f.raw.id], 0);
  assert.equal(events.at(-1).cancelState, "stopped");
  assert.equal((await f.bridge.cancelFilmAssemblyOperation("pending")).kind, "STOPPED");
  assert.deepEqual(f.audit.artifacts, []);
});
test("partial carries actual clock and explicit incomplete stage without pretending completion", async () => {
  const f = setup("partial"),
    result = await f.bridge.assembleFilmProject(await f.input(), "partial");
  assert.equal(result.kind, "PARTIAL");
  assert.equal(result.incomplete, "audio");
  assert.equal(f.audit.events.at(-1).phase, "partial");
  assert.ok(result.limitations.length);
});
test("legacy API remains forbidden and progress unsubscribe stops listener delivery", async () => {
  const f = setup(),
    events = [],
    unsubscribe = f.bridge.onFilmAssemblyProgress((e) => events.push(e));
  unsubscribe();
  await f.bridge.assembleFilmProject(await f.input(), "refused");
  assert.deepEqual(events, []);
  await assert.rejects(f.bridge.assembleFilm(), /FORBIDDEN_ASSEMBLY_DISPATCH/u);
  assert.deepEqual(f.audit.legacy, ["assembleFilm"]);
  assert.deepEqual(f.audit.forbidden, ["legacy-assemble"]);
});

test("shared request oracle rejects extra revisions, stale selections and reused operation IDs", async () => {
  const f = setup();
  const op = "12345678-1234-4234-8234-123456789abc";
  await f.bridge.assembleFilmProject(await f.input(), op);
  assertAssemblyRequests(f.audit.calls, [f.raw]);
  assert.throws(() => assertAssemblyRequests(f.audit.calls, []));
  const changed = clone(f.raw);
  changed.shots[0].selectedTakeId = changed.shots[0].takes[0].id;
  assert.throws(() => assertAssemblyRequests(f.audit.calls, [changed]));
  assert.throws(() => assertAssemblyRequests([...f.audit.calls, ...f.audit.calls], [f.raw, f.raw]));
});

test("media spy intercepts only declared synthetic artifacts and does not invent metadata", async () => {
  const f = setup("success");
  const artifact = await f.bridge.assembleFilmProject(await f.input(), "media");
  let nativePlay = 0,
    nativePause = 0;
  class Media {
    constructor(src) {
      this.src = src;
      this.currentSrc = "";
      this.currentTime = 0;
      this.duration = NaN;
    }
    play() {
      nativePlay++;
      return Promise.resolve();
    }
    pause() {
      nativePause++;
    }
  }
  window.URL = URL;
  window.HTMLMediaElement = Media;
  installAssemblyMediaRequests();
  const synthetic = new Media(`aivora-media://local/?path=${encodeURIComponent(artifact.path)}`);
  await synthetic.play();
  synthetic.pause();
  assert.equal(f.audit.playRequests.length, 1);
  assert.equal(f.audit.pauseRequests.length, 1);
  assert.equal(nativePlay, 0);
  assert.equal(nativePause, 0);
  assert.equal(Number.isNaN(synthetic.duration), true);
  assert.equal(synthetic.currentTime, 0);
  const ordinary = new Media("https://example.invalid/not-an-audit-artifact.mp4");
  await ordinary.play();
  ordinary.pause();
  assert.equal(nativePlay, 1);
  assert.equal(nativePause, 1);
  assert.equal(f.audit.playRequests.length, 1);
  // currentSrc can retain the previously loaded shot while React requests the artifact.
  synthetic.currentSrc = ordinary.src;
  await synthetic.play();
  assert.equal(f.audit.playRequests.length, 2);
  assert.equal(nativePlay, 1);
  // Conversely, a formerly loaded artifact cannot authorize a new ordinary URL.
  ordinary.currentSrc = synthetic.src;
  await ordinary.play();
  assert.equal(f.audit.playRequests.length, 2);
  assert.equal(nativePlay, 2);
});

test("assembly CLI is fixed at sixteen states and rejects unsafe options before a browser", () => {
  assert.equal(assemblyStates.length * 4, 16);
  const cli = new URL("./pro-assembly-audit.mjs", import.meta.url);
  for (const args of [
    ["--unknown"],
    ["--url", "https://example.invalid"],
    ["--out", process.cwd()],
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(cli), ...args], { encoding: "utf8" });
    assert.equal(result.status, 2);
  }
  const help = spawnSync(process.execPath, [fileURLToPath(cli), "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /16 expected/u);
  assert.match(help.stdout, /sandbox is always enabled/u);
});

test("assembly public annotations retain eight-item bound and never emit arbitrary failure strings", async () => {
  const source = await readFile(new URL("./pro-export-qc-audit.mjs", import.meta.url), "utf8");
  const errors = [];
  runInNewContext(
    source.slice(source.indexOf("function auditIdentity"), source.indexOf("function options")) +
      `;emitGitHubErrors(input,{kind:"assembly"});`,
    {
      process: { env: { GITHUB_ACTIONS: "true" } },
      assemblyStates,
      console: { error: (line) => errors.push(line) },
      input: {
        exitCode: 1,
        results: Array.from({ length: 12 }, (_, i) => ({
          passed: false,
          page: i ? "PRIVATE_BODY" : assemblyStates[0],
          combination: i ? "PRIVATE_PATH" : `1280x800-16x9-${assemblyStates[0]}`,
          reached: true,
          error: "PRIVATE_SECRET",
          checkLine: i ? "PRIVATE_SECRET" : 77,
          assemblyReadiness: i
            ? {
                phase: "PRIVATE_KEY",
                generation: "PRIVATE_SECRET",
                pendingTimers: Infinity,
                unboundTimers: -1,
                pendingWrites: NaN,
                pendingNative: 999999,
                saving: "PRIVATE_BODY",
              }
            : {
                phase: "scoped",
                generation: 2,
                pendingTimers: 1,
                unboundTimers: 0,
                pendingWrites: 1,
                pendingNative: 0,
                saving: true,
              },
          interactions: { beforeMark: { range: i ? "PRIVATE_KEY" : 0 } },
          assemblyInteraction: {
            range: i ? Infinity : 1,
            menu: "PRIVATE_BODY",
            mediaCalls: i ? -1 : 2,
            currentMatched: true,
            attributeMatched: true,
            mediaAttributeMatched: true,
            mediaCurrentMatched: "PRIVATE_SECRET",
            playRequests: 0,
            pauseRequests: NaN,
            playing: false,
            mediaTime: i ? Infinity : 1.25,
            sliderTime: i ? "PRIVATE_PATH" : 1.2,
            noticeCode: i ? "PRIVATE_BODY" : "ASSEMBLY_SHOT_REQUIRED",
          },
          geometry: { issues: [] },
        })),
      },
    },
  );
  assert.equal(errors.length, 8);
  assert(errors[0].includes("rangeBeforeMark=0"));
  assert(errors[0].includes("mediaTime=1.25 sliderTime=1.2 notice=ASSEMBLY_SHOT_REQUIRED"));
  assert(errors[1].includes("mediaTime=unknown sliderTime=unknown notice=unknown"));
  assert(errors[1].includes("rangeNow=unknown"));
  assert(errors[1].includes("mediaCalls=unknown"));
  assert(errors[0].includes("state=assembly-actual-clock"));
  assert(errors[0].includes("checkLine=77"));
  assert(errors[0].includes("assemblyScope=scoped assemblyGen=2 saveTimersPending=1"));
  assert(errors[1].includes("assemblyScope=unknown assemblyGen=unknown"));
  assert(
    errors
      .slice(1)
      .every((line) => line.includes("state=unknown") && line.includes("checkLine=unknown")),
  );
  assert(errors.every((line) => !line.includes("PRIVATE")));
});

test("save readiness observes scoped Pro timer generations and actual writes without changing the timer lifecycle", async () => {
  const f = setup();
  Object.assign(f.raw, { title: "合成作品", seriesTitle: "合成作品", episodeTitle: "合成第一集" });
  const storage = { [`aivora.film.v1.${f.raw.id}`]: JSON.stringify(f.raw) };
  storage.getItem = (key) => storage[key] ?? null;
  window.localStorage = storage;
  window.requestAnimationFrame = (callback) => Promise.resolve().then(() => callback(0));
  window.document = {
    querySelector: (selector) =>
      selector === ".pro-root"
        ? { getAttribute: () => "edit" }
        : selector === ".topbar .proj"
          ? {
              querySelector: () => ({ textContent: "/ 合成第一集" }),
              childNodes: [{ nodeType: 3, textContent: "合成作品" }],
            }
          : null,
  };
  let stackFile = "ProWorkspace.tsx",
    serial = 0,
    calls = 0,
    releaseWrite;
  const timers = new Map(),
    clears = [];
  window.Error = class {
    constructor() {
      this.stack = `at http://127.0.0.1/src/aivora/pro/${stackFile}:10:20`;
    }
  };
  window.setTimeout = (handler, delay, ...args) => {
    const id = ++serial;
    timers.set(id, { handler, delay, args });
    return id;
  };
  window.clearTimeout = (id) => {
    clears.push(id);
    timers.delete(id);
  };
  window.aijian.writeFilmProject = (value) =>
    new Promise((resolve) => {
      releaseWrite = () => resolve(clone(value));
    });
  installAssemblyAuditBridge();
  const audit = window.__assemblyAudit;
  const page = {
    evaluate: (fn, arg) => fn(arg),
    waitForFunction: (fn, arg) => {
      assert.equal(fn(arg), true);
    },
  };
  const cancelled = window.setTimeout(() => calls++, 400);
  assert.equal(timers.get(cancelled).delay, 400);
  assert.equal(calls, 0);
  assert.deepEqual(audit.saveTimers[0], {
    projectId: f.raw.id,
    stage: "edit",
    generation: 1,
    status: "scheduled",
  });
  window.clearTimeout(cancelled);
  assert.deepEqual(clears, [cancelled]);
  assert.equal(audit.saveTimers[0].status, "cancelled");
  stackFile = "Unrelated.tsx";
  window.setTimeout(() => calls++, 400);
  assert.equal(audit.saveTimers.length, 1, "Unrelated timers cannot supply a Pro save generation");
  stackFile = "ProWorkspace.tsx";
  const id = window.setTimeout(() => {
    calls++;
    return window.aijian.writeFilmProject(f.raw);
  }, 400);
  assert.equal(audit.saveTimers[1].generation, 2);
  assert.equal(calls, 0);
  await assert.rejects(waitAssemblyIdle(page, f.raw.id));
  const result = timers.get(id).handler();
  assert.equal(calls, 1);
  assert.equal(audit.saveTimers[1].status, "fired");
  assert.equal(
    audit.pendingWrites[f.raw.id],
    1,
    "A fired timer is not a completed asynchronous save",
  );
  await assert.rejects(waitAssemblyIdle(page, f.raw.id));
  releaseWrite();
  assert.deepEqual(await result, f.raw);
  assert.equal(audit.pendingWrites[f.raw.id], 0);
  await waitAssemblyIdle(page, f.raw.id);
  assert.equal(
    audit.lastReadiness.operationId,
    null,
    "No native operation is a real initial idle state",
  );
  await window.aijian.assembleFilmProject(await f.input(), "12345678-1234-4234-8234-123456789abc");
  await waitAssemblyIdle(page, f.raw.id);
  assert.equal(audit.lastReadiness.operationId, "12345678-1234-4234-8234-123456789abc");
  const originalWait = page.waitForFunction;
  page.waitForFunction = async (fn, marker) => {
    await window.aijian.assembleFilmProject(
      await f.input(),
      "22345678-1234-4234-8234-123456789abc",
    );
    assert.equal(fn(marker), true);
  };
  await assert.rejects(
    waitAssemblyIdle(page, f.raw.id),
    "A new real operation cannot borrow an older readiness marker",
  );
  page.waitForFunction = originalWait;
  await waitAssemblyIdle(page, f.raw.id);
  assert.equal(audit.lastReadiness.operationId, "22345678-1234-4234-8234-123456789abc");
  storage[`aivora.film.v1.film_duplicate00000001`] = JSON.stringify({
    ...f.raw,
    id: "film_duplicate00000001",
  });
  assert.deepEqual(
    audit.scope(),
    { projectId: null, stage: "edit" },
    "Ambiguous rendered scope cannot borrow another project's readiness",
  );
  await assert.rejects(waitAssemblyIdle(page, f.raw.id));
});

test("missing-browser setup preserves the fixed sixteen-state report and safe environment annotation", async () => {
  const folder = await mkdtemp(join(tmpdir(), "assembly-audit-negative-"));
  try {
    const out = join(folder, "report"),
      missing = join(folder, "missing-chrome");
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./pro-assembly-audit.mjs", import.meta.url)),
        "--browser",
        missing,
        "--out",
        out,
      ],
      { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" } },
    );
    assert.equal(result.status, 2);
    const report = JSON.parse(await readFile(join(out, "report.json"), "utf8"));
    assert.equal(report.expectedResults, 16);
    assert.deepEqual(report.expectedStates, assemblyStates);
    assert.equal(report.chromiumSandbox, true);
    assert.match(result.stderr, /PRO_ASSEMBLY_SETUP_BROWSER_DISCOVERY/u);
    assert(!result.stderr.includes(missing));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
