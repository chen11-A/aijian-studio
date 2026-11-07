import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge, seedCreationProject } from "./pro-creation-fixture.mjs";
import { loadLibraryAuditCatalog } from "./pro-audio-library-fixture.mjs";
import { installShotAudioBridge, seedShotAudioProject } from "./pro-shot-audio-fixture.mjs";
export const shotAudioStates = [
  "shot-audio-review",
  "shot-audio-save-guard",
  "shot-audio-pending-stale",
  "shot-audio-empty-missing",
];
export async function runShotAudioCases({ browser, config, report, media, persist }) {
  const catalog = await loadLibraryAuditCatalog();
  assert.equal(catalog.assets.length, 206);
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href,
    mediaUrl = new URL("/__shot-audio-video.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of shotAudioStates) {
        const combination = `${viewport.width}x${viewport.height}-${aspect.replace(":", "x")}-${state}`;
        await mkdir(path.join(config.out, combination), { recursive: true });
        const context = await browser.newContext({ viewport, reducedMotion: "reduce" }),
          page = await context.newPage();
        page.setDefaultTimeout(10000);
        const result = {
          combination,
          page: state,
          reached: false,
          passed: false,
          pageerrors: [],
          blockedRequests: [],
          phases: [],
        };
        let scopeSelector = ".pro-root";
        const nav = (label) =>
          page
            .getByRole("navigation", { name: "创作阶段" })
            .getByRole("button", { name: new RegExp(label) });
        const button = (name) => page.getByRole("button", { name, exact: true });
        const record = (id) => page.evaluate((id) => window.__proCreationAudit.record(id), id);
        const calls = () =>
          page.evaluate(() => ({
            calls: window.__shotAudioAudit.calls,
            writes: window.__shotAudioAudit.writes,
            rejectedWrites: window.__shotAudioAudit.rejectedWrites,
            flushes: window.__shotAudioAudit.flushes,
            assemblies: window.__proCreationAudit.assemblies,
            forbidden: [
              ...window.__shotAudioAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
            ],
          }));
        const frame = () =>
          page.evaluate(
            () =>
              new Promise((resolve) =>
                window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
              ),
          );
        async function geometry(phase) {
          await frame();
          result.geometry = await page.evaluate(probeProLayout, { scopeSelector });
          const screenshot = path.join(combination, `${phase}.png`);
          result.screenshot = screenshot;
          result.phases.push({ phase, screenshot, geometry: result.geometry });
          await page.screenshot({ path: path.join(config.out, screenshot) });
          assert.deepEqual(
            result.geometry.issues,
            [],
            "Real suggestion controls retain original geometry rules",
          );
        }
        async function reachable(control) {
          await control.scrollIntoViewIfNeeded();
          await frame();
          const complete = await control.evaluate((element) => {
            const r = element.getBoundingClientRect();
            let left = 0,
              top = 0,
              right = window.innerWidth,
              bottom = window.innerHeight;
            for (let p = element.parentElement; p; p = p.parentElement) {
              const css = getComputedStyle(p),
                b = p.getBoundingClientRect();
              if (/hidden|clip|auto|scroll/.test(css.overflowX)) {
                left = Math.max(left, b.left);
                right = Math.min(right, b.right);
              }
              if (/hidden|clip|auto|scroll/.test(css.overflowY)) {
                top = Math.max(top, b.top);
                bottom = Math.min(bottom, b.bottom);
              }
            }
            return (
              r.left >= left - 1 &&
              r.top >= top - 1 &&
              r.right <= right + 1 &&
              r.bottom <= bottom + 1 &&
              r.width > 2 &&
              r.height > 2
            );
          });
          assert.equal(complete, true, "Suggestion action must scroll entirely into view");
          if (await control.isEnabled()) await control.click({ trial: true });
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
        await page.addInitScript(installShotAudioBridge, { state, catalog });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          const seed = await page.evaluate(seedCreationProject, { state });
          await page.evaluate(seedShotAudioProject, { shotId: seed.shotId });
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(() =>
            Object.hasOwn(window.__proCreationAudit.saved().characters[0], "gender"),
          );
          await nav("剪辑").click();
          assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "edit");
          await button("重试音轨试听").waitFor();
          const before = await record(seed.projectId);
          assert.equal(before.shots.length, 6);
          assert(before.shots.every((s) => s.takes.length === 3));
          assert.equal(before.audioClips.length, 1);
          if (state === "shot-audio-save-guard")
            await page.evaluate(() => {
              window.__shotAudioAudit.failWrites = true;
            });
          await reachable(button("查看本镜声音建议"));
          await button("查看本镜声音建议").click();
          const dialog = page.getByRole("dialog", { name: "本镜声音建议" });
          await dialog.waitFor();
          scopeSelector = ".shot-audio-suggestions";
          result.reached = true;
          const refresh = dialog.getByRole("button", { name: "刷新建议", exact: true }),
            close = dialog.getByRole("button", { name: "关闭", exact: true });
          async function showPlan() {
            await dialog.getByRole("heading", { name: "音效 · 2 段", exact: true }).waitFor();
            assert.equal(await dialog.getByRole("article").count(), 6);
            for (const lane of ["环境音", "音效", "配乐"])
              assert.equal(
                await dialog
                  .getByRole("region", { name: `${lane}建议`, exact: true })
                  .getByRole("article")
                  .count(),
                2,
              );
            assert.equal(await dialog.getByRole("button").count(), 2);
            assert.equal(await dialog.getByRole("button", { name: /加入|撤销|选用/ }).count(), 0);
            assert.equal(
              await dialog.getByRole("link", { name: "查看素材来源", exact: true }).count(),
              6,
            );
            assert.equal(
              await dialog.getByRole("heading", { name: "淡入淡出 · 2 项", exact: true }).count(),
              6,
            );
            assert.equal(
              await dialog.getByRole("heading", { name: "音量变化 · 2 项", exact: true }).count(),
              6,
            );
            assert((await dialog.textContent()).includes("0.1235"));
            assert((await dialog.textContent()).includes("-0.25"));
            assert((await dialog.textContent()).includes("-32 dB"));
            assert((await dialog.textContent()).includes("当前视频时长 2.25 秒"));
            assert.equal(before.shots.find((s) => s.id === seed.shotId).seconds, 4);
          }
          async function quit(status) {
            const old = (await calls()).flushes.length;
            await page.evaluate(() => window.__shotAudioAudit.flush());
            await page.waitForFunction(
              (n) => window.__shotAudioAudit.flushes.length === n + 1,
              old,
            );
            assert.equal((await calls()).flushes.at(-1).status, status);
          }
          if (state === "shot-audio-review") {
            await showPlan();
            await geometry("plan");
            const notes = dialog.getByRole("region", { name: "声音建议限制", exact: true });
            assert.equal(await notes.getByRole("listitem").count(), 5);
            assert.equal(
              await dialog
                .getByRole("region", { name: "声音建议提醒", exact: true })
                .getByRole("listitem")
                .count(),
              5,
            );
            await notes.getByRole("listitem").last().scrollIntoViewIfNeeded();
            await geometry("last-note");
            await reachable(refresh);
            await reachable(close);
            await geometry("actions");
            await quit("saved");
            const cached = (await calls()).calls[0];
            assert.equal(cached.matched, true);
            assert.equal(cached.mode, "ready");
            await close.click();
            scopeSelector = ".pro-root";
            await geometry("closed");
          } else if (state === "shot-audio-save-guard") {
            await dialog
              .getByText("当前编辑还没保存上，请先重试保存，再查看声音建议。", { exact: true })
              .waitFor();
            assert.equal((await calls()).calls.length, 0);
            assert((await calls()).rejectedWrites > 0);
            await quit("failed");
            await geometry("save-failed");
            await page.evaluate(() => {
              window.__shotAudioAudit.failWrites = false;
            });
            await reachable(refresh);
            await refresh.click();
            await showPlan();
            await quit("saved");
            await reachable(close);
            await geometry("saved-retry");
          } else if (state === "shot-audio-pending-stale") {
            await page.waitForFunction(() => window.__shotAudioAudit.pending.length === 1);
            assert.equal(await refresh.isDisabled(), true);
            assert.equal(await close.isEnabled(), true);
            await quit("saved");
            await geometry("pending");
            await reachable(close);
            await close.click();
            scopeSelector = ".pro-root";
            await nav("角色").click();
            const style = page.getByLabel("画风说明", { exact: true });
            await style.fill("这是读取期间后来修改的合成画风。");
            await page.waitForFunction(
              (id) =>
                window.__proCreationAudit.record(id).styleZh === "这是读取期间后来修改的合成画风。",
              seed.projectId,
            );
            await page.evaluate(() => window.__shotAudioAudit.resolvePending());
            assert.equal(await page.getByRole("dialog", { name: "本镜声音建议" }).count(), 0);
            assert.equal((await calls()).calls.length, 1);
            assert.equal(await style.inputValue(), "这是读取期间后来修改的合成画风。");
            await nav("剪辑").click();
            await reachable(button("查看本镜声音建议"));
            await button("查看本镜声音建议").click();
            await showPlan();
            assert.equal((await calls()).calls.length, 2);
            scopeSelector = ".shot-audio-suggestions";
            await reachable(close);
            await geometry("fresh-plan");
          } else {
            await dialog
              .getByText("本地素材目录暂时不可用，请稍后重新查看。", { exact: true })
              .waitFor();
            await geometry("missing");
            for (const [mode, text] of [
              ["source-failed", "当前版本的来源暂时无法核验，还不能给出声音安排。"],
              ["limit", "声音安排至少需要 129 段，目前最多容纳 128 段；没有截掉后面的片段。"],
              ["invalid", "声音建议没有完整读到，请刷新后重试。"],
            ]) {
              await page.evaluate((mode) => {
                window.__shotAudioAudit.mode = mode;
              }, mode);
              await reachable(refresh);
              await refresh.click();
              await dialog.getByText(text, { exact: true }).waitFor();
              assert.equal(await dialog.getByRole("article").count(), 0);
              await geometry(mode);
            }
            await page.evaluate(() => {
              window.__shotAudioAudit.mode = "empty";
            });
            await refresh.click();
            await dialog.getByText("配乐情绪待决定，暂未安排素材。", { exact: true }).waitFor();
            assert.equal(await dialog.getByRole("heading", { name: /· 0 段/ }).count(), 3);
            assert.equal(await dialog.getByRole("article").count(), 0);
            await reachable(close);
            await geometry("empty");
          }
          const after = await record(seed.projectId);
          assert.deepEqual(
            after.shots,
            state === "shot-audio-pending-stale"
              ? before.shots.map((s) => ({
                  ...s,
                  regenerationRequired: {
                    code: "STYLE_CHANGED",
                    styleRevision: after.styleRevision,
                  },
                }))
              : before.shots,
          );
          assert.deepEqual(after.audioClips, before.audioClips);
          assert.deepEqual(after.characters, before.characters);
          const actual = await calls();
          assert.equal(
            actual.calls.length,
            state === "shot-audio-pending-stale" ? 2 : state === "shot-audio-empty-missing" ? 5 : 1,
          );
          assert(actual.calls.every((c) => c.matched));
          assert.deepEqual(actual.forbidden, []);
          assert.equal(actual.assemblies.length, 1);
          assert.deepEqual(actual.assemblies[0], {
            projectId: before.id,
            seriesId: before.seriesId,
            paths: before.shots.map(
              (s) => s.takes.find((t) => t.id === s.selectedTakeId).videoPath,
            ),
            musicPath: "",
            gainDb: -14,
            dialogue: before.shots.map(() => ""),
          });
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = actual;
          result.passed = true;
        } catch (error) {
          const line = Number(
            error.stack?.match(/[\\/]pro-shot-audio-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
          );
          result.checkLine = Number.isSafeInteger(line) && line > 0 && line <= 100000 ? line : null;
          result.error = "PRO_SHOT_AUDIO_CASE_FAILED";
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
  return shotAudioStates.length * report.viewports.length * report.aspects.length;
}
