import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge, seedCreationProject } from "./pro-creation-fixture.mjs";
import { installAudioMixBridge, seedAudioMixProject } from "./pro-audio-mix-fixture.mjs";
export const audioMixStates = [
  "mix-lane-settings",
  "mix-solo-export",
  "mix-preview-retry",
  "mix-stale-reply",
];
// Deterministic valid two-second PCM silence for the synthetic native read ABI, never product data.
export function silentWav() {
  const rate = 8000,
    dataSize = rate * 2 * 2,
    bytes = Buffer.alloc(44 + dataSize);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + dataSize, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(dataSize, 40);
  return bytes;
}
const takeFacts = (film) => film.shots.map((s) => ({ id: s.id, takes: s.takes }));
const expectedAssembly = (film) => ({
  projectId: film.id,
  seriesId: film.seriesId,
  paths: film.shots.map((s) => s.takes.find((t) => t.id === s.selectedTakeId).videoPath),
  musicPath: film.audioClips.find((c) => c.lane === "score" && c.path)?.path ?? "",
  gainDb: film.audioClips.find((c) => c.lane === "score" && c.path)?.gainDb ?? -14,
  // Fixed fixture expectation: only this selected-and-enabled voice is eligible. Old,
  // disabled and unbound clips are retained as negative data, never fallback choices.
  dialogue: film.shots.map((s) => {
    const voice = film.audioClips.find((c) => c.id === "mix-dialogue");
    return s.id === voice.shotId && s.selectedTakeId === voice.takeId && voice.enabled !== false
      ? "/synthetic/mix-dialogue.wav"
      : "";
  }),
});
export async function runAudioMixCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
  const planPath = fileURLToPath(
    new URL("../../../packages/contracts/src/film-audio-mix-plan.js", import.meta.url),
  );
  const planUrl = new URL(`/@fs${planPath}`, config.url).href;
  const mediaUrl = new URL("/__pro-audio-mix-video.mp4", config.url).href;
  const wav = silentWav();
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of audioMixStates) {
        const combination = `${viewport.width}x${viewport.height}-${aspect.replace(":", "x")}-${state}`;
        await mkdir(path.join(config.out, combination), { recursive: true });
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const result = {
          combination,
          viewport,
          aspect,
          page: state,
          reached: false,
          passed: false,
          screenshot: path.join(combination, "state.png"),
          pageerrors: [],
          blockedRequests: [],
        };
        let scopeSelector = ".pro-root";
        const frame = () =>
          page.evaluate(
            () =>
              new Promise((r) =>
                window.requestAnimationFrame(() => window.requestAnimationFrame(r)),
              ),
          );
        const saved = () => page.evaluate(() => window.__proCreationAudit.saved());
        const audit = () =>
          page.evaluate(() => ({
            requests: window.__proAudioMixAudit.requests,
            pending: window.__proAudioMixAudit.pending.length,
            reads: window.__proAudioMixAudit.reads,
            waves: window.__proAudioMixAudit.waves,
            prepare: window.__proAudioMixAudit.prepare,
            assemblies: window.__proCreationAudit.assemblies,
            forbidden: [
              ...window.__proAudioMixAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
            ],
          }));
        const button = (name) => page.getByRole("button", { name, exact: true });
        const nav = (label) =>
          page
            .getByRole("navigation", { name: "创作阶段" })
            .getByRole("button", { name: new RegExp(label) });
        async function geometry(phase = null) {
          result.geometry = await page.evaluate(probeProLayout, { scopeSelector });
          const screenshot = phase ? path.join(combination, `${phase}.png`) : result.screenshot;
          if (phase) (result.phases ??= []).push({ phase, screenshot, geometry: result.geometry });
          await page.screenshot({ path: path.join(config.out, screenshot) });
          assert.deepEqual(
            result.geometry.issues,
            [],
            "Audio mix controls must retain original geometry gates",
          );
        }
        async function reachable(control) {
          await control.scrollIntoViewIfNeeded();
          await frame();
          await control.click({ trial: true });
          await geometry();
        }
        async function ready() {
          await page.waitForFunction(() => window.__proAudioMixAudit.requests.length > 0);
          await page
            .getByText("正在核对所选版本的音轨…", { exact: true })
            .waitFor({ state: "hidden" });
          assert.equal(await button("重试音轨试听").count(), 0);
        }
        async function chooseSecond() {
          await page.locator(".pb.bin .it").first().click();
          await page.locator(".cmp .nx-takes").waitFor();
          await button("用第 2 版").click();
          await page.waitForFunction((shotId) => {
            const s = window.__proCreationAudit.saved().shots.find((s) => s.id === shotId);
            return s.selectedTakeId === s.takes[1].id;
          }, result.seed.shotId);
          await button("关掉对比").click();
        }
        page.on("pageerror", () => result.pageerrors.push("PAGE_ERROR"));
        await page.route("**/*", (route) => {
          const u = new URL(route.request().url());
          if (
            /^https?:$/.test(u.protocol) &&
            (u.origin !== new URL(config.url).origin ||
              u.pathname === "/api" ||
              u.pathname.startsWith("/api/"))
          ) {
            result.blockedRequests.push(
              u.origin === new URL(config.url).origin ? "API" : "EXTERNAL_HTTP",
            );
            return route.abort();
          }
          if (u.href === mediaUrl) return route.fulfill({ contentType: "video/mp4", body: media });
          return route.continue();
        });
        await page.addInitScript(installExportQcBridge, { state: "clean", aspect });
        await page.addInitScript(installCreationBridge, { state });
        await page.addInitScript(installAudioMixBridge, {
          state,
          planUrl,
          wavBase64: wav.toString("base64"),
          wavSha256: createHash("sha256").update(wav).digest("hex"),
        });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          await page.evaluate(seedCreationProject, { state });
          result.seed = await page.evaluate(seedAudioMixProject);
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(() =>
            Object.hasOwn(window.__proCreationAudit.saved().characters[0], "gender"),
          );
          const before = await saved();
          assert.equal(before.shots.length, 6);
          assert.ok(before.shots.every((s) => s.takes.length === 3));
          await nav("剪辑").click();
          assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "edit");
          await button("静音对白").waitFor();
          result.reached = true;
          await geometry();
          if (state === "mix-lane-settings") {
            await ready();
            const settings = [
              ["对白", "dialogue", 1],
              ["环境音", "ambience", 2],
              ["音效", "sfx", 3],
              ["配乐", "score", 4],
            ];
            for (const [label, lane, steps] of settings) {
              const slider = page.getByRole("slider", { name: `${label}音量`, exact: true });
              await slider.scrollIntoViewIfNeeded();
              await slider.press("End");
              for (let i = 0; i < steps; i++) await slider.press("ArrowLeft");
              assert.equal(await slider.inputValue(), String(100 - steps));
              await page.waitForFunction(
                ({ lane, gainDb }) =>
                  window.__proCreationAudit.saved().audioMix?.lanes[lane].gainDb === gainDb,
                { lane, gainDb: -steps / 10 },
              );
            }
            await button("静音对白").click();
            await page.waitForFunction(
              () => window.__proCreationAudit.saved().audioMix?.lanes.dialogue.muted === true,
            );
            const configured = await saved();
            assert.deepEqual(configured.audioClips, before.audioClips);
            assert.equal(configured.audioMix.autoAdjustVolume, false);
            await chooseSecond();
            await ready();
            assert.equal(await button("静音对白").getAttribute("aria-pressed"), "true");
            assert.deepEqual((await saved()).audioMix, configured.audioMix);
            result.persistedLanes = Object.keys(configured.audioMix.lanes).sort();
            await geometry();
          } else if (state === "mix-solo-export") {
            await ready();
            await reachable(button("单听环境音"));
            await button("单听环境音").click();
            await page.getByText("当前只试听环境音，不改变导出。", { exact: true }).waitFor();
            assert.equal((await saved()).audioMix, undefined);
            await button("导出成片").click();
            const dialog = page.getByRole("dialog", { name: "导出成片", exact: true });
            await dialog.waitFor();
            scopeSelector = '[role="dialog"][aria-label="导出成片"]';
            assert.equal(
              await dialog
                .getByRole("checkbox", { name: "导出时自动调整音量", exact: true })
                .isChecked(),
              false,
            );
            const prepare = dialog.getByRole("button", { name: "检查成片", exact: true });
            assert.equal(await dialog.locator("button.primary:visible").count(), 1);
            await reachable(prepare);
            await prepare.click();
            await page.waitForFunction(() => window.__proAudioMixAudit.prepare.length === 1);
            const call = (await audit()).prepare[0];
            assert.equal(call.matched, true);
            assert.equal(call.audioMix, null);
            assert.equal(JSON.stringify(call.input).includes("solo"), false);
            assert.equal(call.input.settings.autoAdjustVolume, false);
            result.soloExcludedFromExport = true;
            await geometry();
          } else if (state === "mix-preview-retry") {
            await page.getByText("正在核对所选版本的音轨…", { exact: true }).waitFor();
            assert.equal(await button("重试音轨试听").count(), 0);
            await geometry("busy");
            await page.waitForFunction(() => window.__proAudioMixAudit.pending.length === 1);
            await page.evaluate(() => {
              window.__proAudioMixAudit.mode = "busy";
              window.__proAudioMixAudit.resolve(0);
            });
            await page
              .getByText("音轨暂时无法核验，未播放未确认的声音。", { exact: true })
              .waitFor();
            assert.equal((await audit()).requests.length, 8);
            await geometry("bounded-failure");
            await reachable(button("重试音轨试听"));
            await page.evaluate(() => {
              window.__proAudioMixAudit.mode = "hold";
            });
            await button("重试音轨试听").click();
            await page.waitForFunction(() => window.__proAudioMixAudit.pending.length === 2);
            await page.getByText("正在核对所选版本的音轨…", { exact: true }).waitFor();
            assert.equal(await button("重试音轨试听").count(), 0);
            await geometry("retry-pending");
            await page.evaluate(() => window.__proAudioMixAudit.resolve(1, true));
            await button("重试音轨试听").waitFor();
            await page.evaluate(() => {
              window.__proAudioMixAudit.mode = "ready";
            });
            await button("重试音轨试听").click();
            await ready();
            assert.equal((await audit()).requests.length, 10);
            result.boundedRetry = true;
            await geometry();
          } else {
            await page.waitForFunction(() => window.__proAudioMixAudit.pending.length === 1);
            await chooseSecond();
            await page.waitForFunction(() => window.__proAudioMixAudit.pending.length === 2);
            const requests = (await audit()).requests;
            assert.notEqual(requests[0].input.expectedHash, requests[1].input.expectedHash);
            assert.notEqual(
              requests[0].selected.find(([id]) => id === result.seed.shotId)[1],
              requests[1].selected.find(([id]) => id === result.seed.shotId)[1],
            );
            await page.evaluate(() => window.__proAudioMixAudit.resolve(1));
            await ready();
            await page.evaluate(() => window.__proAudioMixAudit.resolve(0, true));
            await frame();
            assert.equal(await button("重试音轨试听").count(), 0);
            assert.equal(
              await page
                .getByText("音轨暂时无法核验，未播放未确认的声音。", { exact: true })
                .count(),
              0,
            );
            result.oldReplyRejected = true;
            await geometry();
          }
          const after = await saved();
          assert.deepEqual(takeFacts(after), takeFacts(before));
          assert.deepEqual(after.audioClips, before.audioClips);
          const calls = await audit();
          assert.ok(calls.requests.every((r) => r.matched));
          assert.ok(
            calls.requests.every(
              (r) =>
                !r.trackKeys ||
                r.trackKeys.every(
                  (key) =>
                    !["mix-old-voice", "mix-disabled-voice", "mix-pending-voice"].includes(key),
                ),
            ),
          );
          assert.ok(calls.reads.every((r) => r.matched));
          assert.ok(calls.waves.every((r) => r.matched));
          const expected = [expectedAssembly(before)];
          if (["mix-lane-settings", "mix-stale-reply"].includes(state))
            expected.push(expectedAssembly(after));
          assert.deepEqual(calls.assemblies, expected);
          assert.deepEqual(calls.forbidden, []);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = calls;
          result.passed = true;
        } catch (error) {
          const line = Number(
            error.stack?.match(/[\\/]pro-audio-mix-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
          );
          result.checkLine = Number.isSafeInteger(line) && line > 0 && line <= 100000 ? line : null;
          result.error = "PRO_AUDIO_MIX_CASE_FAILED";
        } finally {
          if (!result.passed) {
            result.geometry = await page
              .evaluate(probeProLayout, { scopeSelector })
              .catch(() => null);
            result.failureScreenshot = path.join(combination, "failure.png");
            await page
              .screenshot({ path: path.join(config.out, result.failureScreenshot) })
              .catch(() => undefined);
          }
          report.results.push(result);
          console.log(`${result.passed ? "PASS" : "FAIL"} ${combination}`);
          await persist();
          await context.close();
        }
      }
  return audioMixStates.length * report.viewports.length * report.aspects.length;
}
