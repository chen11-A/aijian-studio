import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import {
  installAssemblyAuditBridge,
  installAssemblyMediaRequests,
} from "./pro-assembly-fixture.mjs";
import { assertAssemblyRequests, waitAssemblyIdle } from "./pro-assembly-assertions.mjs";
import {
  installEvidenceLegacyBridge,
  seedEvidenceLegacyProject,
  measureEvidenceControl,
} from "./pro-evidence-legacy-fixture.mjs";
import {
  READY_SHOT_MENU,
  installUiInteractionsBridge,
  seedUiInteractionsProject,
} from "./pro-ui-interactions-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
export const uiInteractionStates = [
  "ui-context-menus",
  "ui-title-composition",
  "ui-property-counts",
  "ui-transport-delete",
];
const keptMedia = (film) => ({
  shots: film.shots
    .map((s) => ({
      id: s.id,
      poster: s.poster,
      stills: s.stills,
      takes: s.takes,
      selectedTakeId: s.selectedTakeId,
    }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  audioClips: [...film.audioClips].sort((a, b) => a.id.localeCompare(b.id)),
});
export async function runUiInteractionCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href,
    mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of uiInteractionStates) {
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
          screenshot: path.join(combination, "interaction.png"),
          pageerrors: [],
          blockedRequests: [],
        };
        let scopeSelector = ".pro-root";
        const button = (name) => page.getByRole("button", { name, exact: true });
        const nav = (name) =>
          page
            .getByRole("navigation", { name: "创作阶段" })
            .getByRole("button", { name: new RegExp(name) });
        const frame = () =>
          page.evaluate(
            () =>
              new Promise((resolve) =>
                window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
              ),
          );
        const record = (id) => page.evaluate((id) => window.__proCreationAudit.record(id), id);
        const calls = () =>
          page.evaluate(() => ({
            renames: window.__uiInteractionsAudit.renames,
            orphanRefusals: window.__uiInteractionsAudit.orphanRefusals,
            waveforms: window.__proEvidenceLegacyAudit.waveforms,
            prepares: window.__proEvidenceLegacyAudit.prepares,
            publishes: window.__proEvidenceLegacyAudit.publishes,
            results: window.__proEvidenceLegacyAudit.results,
            exportCancels: window.__proEvidenceLegacyAudit.exportCancels,
            opened: window.__proEvidenceLegacyAudit.opened,
            revealed: window.__proEvidenceLegacyAudit.revealed,
            filmWrites: window.__proEvidenceLegacyAudit.filmWrites,
            assembly: window.__assemblyAudit.calls,
            cancels: window.__assemblyAudit.cancels,
            forbidden: [
              ...window.__uiInteractionsAudit.forbidden,
              ...window.__proEvidenceLegacyAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
              ...window.__assemblyAudit.forbidden,
            ],
          }));
        async function geometry(label) {
          await frame();
          const value = await page.evaluate(probeProLayout, { scopeSelector });
          result.geometry = value;
          (result.checkpoints ??= []).push({ label, geometry: value });
          const image = path.join(combination, `${label}.png`);
          await page.screenshot({ path: path.join(config.out, image) });
          (result.checkpointScreenshots ??= []).push(image);
          assert.deepEqual(value.issues, [], "Actual controls keep original geometry thresholds");
        }
        async function reachable(control) {
          await control.scrollIntoViewIfNeeded();
          await frame();
          result.reachability = await control.evaluate(measureEvidenceControl);
          assert.equal(result.reachability.complete, true, "Control must scroll fully into view");
          if (!(await control.isDisabled())) await control.click({ trial: true });
        }
        async function metadata() {
          await page.waitForFunction(() => window.__assemblyAudit.artifacts.length === 1);
          await waitAssemblyIdle(page, result.seed.projectId);
          const artifact = await page.evaluate(() => window.__assemblyAudit.artifacts.at(-1));
          const video = page.locator(".preview-player video.frame");
          await video.waitFor();
          await video.evaluate((element, duration) => {
            Object.defineProperty(element, "duration", { configurable: true, value: duration });
            element.dispatchEvent(new window.Event("loadedmetadata"));
          }, artifact.durationSeconds);
          return { artifact, video };
        }
        page.on("pageerror", () => result.pageerrors.push("PAGE_ERROR"));
        await page.route("**/*", (route) => {
          const url = new URL(route.request().url());
          if (
            /^https?:$/.test(url.protocol) &&
            (url.origin !== new URL(config.url).origin ||
              url.pathname === "/api" ||
              url.pathname.startsWith("/api/"))
          ) {
            result.blockedRequests.push(
              url.origin === new URL(config.url).origin ? "API" : "EXTERNAL_HTTP",
            );
            return route.abort();
          }
          if (url.href === mediaUrl)
            return route.fulfill({ contentType: "video/mp4", body: media });
          return route.continue();
        });
        await page.addInitScript({
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state: "clean", aspect })});(${installCreationBridge.toString()})(${JSON.stringify({ state })});(${installAssemblyAuditBridge.toString()})({mode:"complete"});(${installAssemblyMediaRequests.toString()})();(${installEvidenceLegacyBridge.toString()})(${JSON.stringify({ state })});(${installUiInteractionsBridge.toString()})();`,
        });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          result.seed = await page.evaluate(seedEvidenceLegacyProject, { state });
          const seed = await page.evaluate(seedUiInteractionsProject);
          result.seed = seed;
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(
            (id) => window.__proEvidenceLegacyAudit.filmWrites.some((w) => w.projectId === id),
            seed.projectId,
          );
          await frame();
          await waitAssemblyIdle(page, seed.projectId);
          const before = await record(seed.projectId),
            expectedAssembly = [];
          assert.equal(before.shots.length, 6);
          assert.equal(before.audioClips.length, 6);
          result.reached = true;
          const summary = (name) =>
            page.locator(".pgroup > summary").filter({ hasText: new RegExp(`^${name}$`) });
          async function fold(name, open) {
            const s = summary(name);
            await reachable(s);
            if (((await s.locator("..").getAttribute("open")) !== null) !== open) await s.click();
            await page.waitForFunction(
              ({ name, open }) =>
                [...window.document.querySelectorAll(".pgroup")].find(
                  (d) => d.querySelector("summary")?.textContent === name,
                )?.open === open,
              { name, open },
            );
            return s;
          }
          async function counted(name, count) {
            await page.waitForFunction(
              ({ name, count }) => {
                const d = [...window.document.querySelectorAll(".pgroup")].find(
                    (d) => d.querySelector("summary")?.textContent === name,
                  ),
                  s = d?.querySelector("summary");
                return (
                  d?.open === false &&
                  s?.getAttribute("data-count") === (count ? `· ${count}` : null) &&
                  s?.getAttribute("title") === (count ? `里面有 ${count} 项填了内容` : null)
                );
              },
              { name, count },
            );
          }
          async function savedSound(ambience, musicMood) {
            await page.waitForFunction(
              ({ id, shotId, ambience, musicMood }) => {
                const f = window.__proCreationAudit.record(id),
                  shot = f?.shots.find((s) => s.id === shotId),
                  receipt = window.__proEvidenceLegacyAudit.filmWrites.at(-1),
                  written = receipt?.stored?.shots.find((s) => s.id === shotId);
                return (
                  shot?.sound.source === "native" &&
                  shot.sound.ambience === ambience &&
                  shot.sound.musicMood === musicMood &&
                  receipt?.projectId === id &&
                  written?.sound.source === "native" &&
                  written.sound.ambience === ambience &&
                  written.sound.musicMood === musicMood
                );
              },
              { id: seed.projectId, shotId: before.shots[0].id, ambience, musicMood },
            );
          }
          async function edit(n) {
            await nav("剪辑").click();
            await page.waitForFunction((n) => window.__assemblyAudit.artifacts.length === n, n);
            await waitAssemblyIdle(page, seed.projectId);
            return metadata();
          }
          async function settled(n) {
            await page.waitForFunction((n) => window.__assemblyAudit.artifacts.length === n, n);
            await waitAssemblyIdle(page, seed.projectId);
          }
          async function keep() {
            assert.deepEqual(keptMedia(await record(seed.projectId)), keptMedia(before));
          }
          if (state === "ui-context-menus") {
            await nav("分镜").click();
            const card = page.locator(".grid .card").nth(1);
            await card.click({ button: "right" });
            let menu = page.getByRole("menu", { name: /^镜头 \d+ 的操作$/ });
            await menu.waitFor({ state: "visible" });
            assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), READY_SHOT_MENU);
            scopeSelector = ".nx-context-menu";
            await geometry("board-context");
            await page.keyboard.press("Escape");
            await menu.waitFor({ state: "hidden" });
            scopeSelector = ".pro-root";
            await button("更多操作").click();
            const more = page.getByRole("menu", { name: "这一镜的更多操作", exact: true });
            await more.waitFor({ state: "visible" });
            assert.deepEqual(await more.getByRole("button").allTextContents(), READY_SHOT_MENU);
            scopeSelector = '.menu[aria-label="这一镜的更多操作"]';
            await geometry("more-menu");
            for (const control of await more.getByRole("button").all()) await reachable(control);
            await page.keyboard.press("Escape");
            await more.waitFor({ state: "hidden" });
            scopeSelector = ".pro-root";
            await card.click({ button: "right" });
            await page.getByRole("menuitem", { name: "后移", exact: true }).click();
            await page.waitForFunction(
              ({ id, ids }) =>
                window.__proCreationAudit
                  .record(id)
                  .shots.map((s) => s.id)
                  .join() !== ids.join(),
              { id: seed.projectId, ids: seed.shotIds },
            );
            await page.keyboard.press("Control+z");
            await page.waitForFunction(
              ({ id, ids }) =>
                window.__proCreationAudit
                  .record(id)
                  .shots.map((s) => s.id)
                  .join() === ids.join(),
              { id: seed.projectId, ids: seed.shotIds },
            );
            await page.locator(".scenes .scene").first().click({ button: "right" });
            menu = page.getByRole("menu", { name: /的操作$/ });
            assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), [
              "加镜头",
              "生成这一场",
            ]);
            for (const name of ["加镜头", "生成这一场"])
              assert.equal(await button(name).count(), 1);
            scopeSelector = ".nx-context-menu";
            await geometry("scene-context");
            await page.keyboard.press("Escape");
            await menu.waitFor({ state: "hidden" });
            scopeSelector = ".pro-root";
            await edit(1);
            expectedAssembly.push(before);
            await page.locator(".clip.v").nth(1).click({ button: "right" });
            menu = page.getByRole("menu", { name: /^镜头 \d+ 的操作$/ });
            assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), [
              "重新生成",
              "换配音",
              "剪掉",
            ]);
            for (const name of ["重新生成", "换配音", "删除"])
              assert.equal(await button(name).count(), 1);
            scopeSelector = ".nx-context-menu";
            await geometry("timeline-context");
            await page.keyboard.press("Escape");
            await menu.waitFor({ state: "hidden" });
            scopeSelector = ".pro-root";
            await keep();
          } else if (state === "ui-title-composition") {
            await button("作品").dblclick();
            let field = page.getByLabel("改作品名", { exact: true });
            await field.fill("Esc不应保存");
            await field.press("Escape");
            await field.waitFor({ state: "hidden" });
            assert.equal((await calls()).renames.length, 0);
            await button("作品").dblclick();
            field = page.getByLabel("改作品名", { exact: true });
            const cdp = await context.newCDPSession(page);
            await field.focus();
            await cdp.send("Input.imeSetComposition", {
              text: "合成输入中",
              selectionStart: 5,
              selectionEnd: 5,
            });
            await page.keyboard.press("4");
            assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "script");
            await page.keyboard.press("Enter");
            assert.equal(await field.count(), 1);
            assert.equal((await calls()).renames.length, 0);
            await cdp.send("Input.insertText", { text: "正常浏览器改名" });
            await field.fill("正常浏览器改名");
            await field.press("Enter");
            await field.waitFor({ state: "hidden" });
            await page.waitForFunction(() => window.__uiInteractionsAudit.renames.length === 1);
            assert.deepEqual((await calls()).renames, [
              { seriesId: seed.seriesId, title: "正常浏览器改名" },
            ]);
            const chat = page.getByLabel("跟助手说", { exact: true });
            await chat.fill("保持输入 jkl");
            await chat.press("Delete");
            assert.equal(await chat.inputValue(), "保持输入 jkl");
            await geometry("rename-and-input");
            await cdp.detach();
            await keep();
          } else if (state === "ui-property-counts") {
            await nav("分镜").click();
            await fold("声音", true);
            await page.getByLabel("这一镜的环境音", { exact: true }).fill("门外雨声");
            await page.getByLabel("配乐情绪", { exact: true }).fill("平静");
            await page.getByLabel("配乐情绪", { exact: true }).press("Tab");
            await savedSound("门外雨声", "平静");
            let s = await fold("声音", false);
            await counted("声音", 2);
            assert.equal(await s.getAttribute("data-count"), "· 2");
            assert.equal(await s.getAttribute("title"), "里面有 2 项填了内容");
            await geometry("sound-folded-count");
            await fold("声音", true);
            assert.equal(await summary("声音").getAttribute("data-count"), null);
            await page.getByLabel("配乐情绪", { exact: true }).fill("");
            await page.getByLabel("配乐情绪", { exact: true }).press("Tab");
            await savedSound("门外雨声", "");
            s = await fold("声音", false);
            await counted("声音", 1);
            assert.equal(await s.getAttribute("data-count"), "· 1");
            await fold("高级", true);
            await page.getByLabel("这一镜的画风", { exact: true }).fill("保留真实编辑");
            s = await fold("高级", false);
            await counted("高级", 1);
            assert.equal(await s.getAttribute("data-count"), "· 1");
            await geometry("advanced-folded-count");
            await fold("高级", true);
            assert.equal(await summary("高级").getAttribute("data-count"), null);
            await page.getByLabel("这一镜的画风", { exact: true }).fill("");
            s = await fold("高级", false);
            await counted("高级", 0);
            assert.equal(await s.getAttribute("data-count"), null);
            await keep();
          } else {
            const { artifact, video } = await edit(1);
            expectedAssembly.push(before);
            await page
              .locator(".pane.monitor .monitor-tabs")
              .getByRole("button", { name: "预览", exact: true })
              .click();
            await page.keyboard.press("l");
            await button("暂停").waitFor();
            await page.keyboard.press("l");
            await page.getByText("快放 2×", { exact: true }).waitFor();
            await page.keyboard.press("k");
            await button("播放").waitFor();
            await page.keyboard.press("ArrowDown");
            await page.waitForFunction(
              (expected) =>
                Math.abs(
                  window.document.querySelector(".preview-player video.frame").currentTime -
                    expected,
                ) < 0.001,
              artifact.shots[1].startSeconds,
            );
            await page.keyboard.press("ArrowUp");
            await page.waitForFunction(
              () => window.document.querySelector(".preview-player video.frame").currentTime === 0,
            );
            await page.keyboard.press("ArrowLeft");
            assert.equal(await video.evaluate((v) => v.currentTime), 0);
            await page.keyboard.press("ArrowRight");
            await page.waitForFunction(
              () =>
                Math.abs(
                  window.document.querySelector(".preview-player video.frame").currentTime - 1 / 30,
                ) < 0.0001,
            );
            await page.keyboard.press("ArrowDown");
            await page.keyboard.press("j");
            await page.getByText("倒放 1×", { exact: true }).waitFor();
            await page.keyboard.press("j");
            await page.getByText("倒放 2×", { exact: true }).waitFor();
            await page.keyboard.press("k");
            assert.equal(await page.locator(".ctrl .speed").count(), 0);
            await page.locator(".clip.v").first().click();
            const field = page.getByLabel("改这一镜的描述", { exact: true });
            await field.focus();
            await page.keyboard.press("Delete");
            assert.equal(await page.locator(".clip.v").count(), 6);
            await page.locator(".clip.v").first().click({ button: "right" });
            await page.keyboard.press("Delete");
            assert.equal(await page.locator(".clip.v").count(), 6);
            await page.keyboard.press("Escape");
            await button("导出成片").click();
            const dialog = page.getByRole("dialog", { name: "导出成片", exact: true });
            await dialog.waitFor();
            scopeSelector = '.pro-root [role="dialog"][aria-label="导出成片"]';
            await geometry("dialog-delete-guard");
            await page.keyboard.press("Backspace");
            assert.equal(await page.locator(".clip.v").count(), 6);
            await reachable(dialog.getByRole("button", { name: "关闭", exact: true }));
            await dialog.getByRole("button", { name: "关闭", exact: true }).click();
            scopeSelector = ".pro-root";
            for (const key of ["Delete", "Backspace"]) {
              await page.locator(".clip.v").first().click();
              await page.keyboard.press(key);
              await page.waitForFunction(
                () => window.document.querySelectorAll(".clip.v").length === 5,
              );
              await settled(expectedAssembly.length + 1);
              expectedAssembly.push(await record(seed.projectId));
              await page.keyboard.press("Control+z");
              await page.waitForFunction(
                () => window.document.querySelectorAll(".clip.v").length === 6,
              );
              await settled(expectedAssembly.length + 1);
              expectedAssembly.push(await record(seed.projectId));
              await keep();
            }
            await geometry("transport-and-delete-undo");
          }
          const final = await calls();
          assert(
            final.waveforms.every(
              (c) => c.matched && ["TOOLS_UNAVAILABLE", "SOURCE_CHANGED"].includes(c.code),
            ),
          );
          assert.deepEqual(final.prepares, []);
          assert.deepEqual(final.publishes, []);
          assert.equal(final.orphanRefusals.length, state === "ui-transport-delete" ? 2 : 0);
          assert.equal(
            final.waveforms.length,
            state === "ui-transport-delete" ? 28 : state === "ui-context-menus" ? 6 : 0,
          );
          assertAssemblyRequests(final.assembly, expectedAssembly);
          assert.deepEqual(final.cancels, []);
          assert.deepEqual(final.forbidden, []);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = final;
          result.passed = true;
        } catch (error) {
          result.geometry = await page
            .evaluate(probeProLayout, { scopeSelector })
            .catch(() => null);
          const line = Number(
            error.stack?.match(/[\\/]pro-ui-interactions-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
          );
          result.checkLine =
            Number.isSafeInteger(line) && line >= 1 && line <= 100000 ? line : null;
          result.errorCode = error.name === "AssertionError" ? "ASSERTION" : "INTERACTION";
        } finally {
          await page.screenshot({ path: path.join(config.out, result.screenshot) }).catch(() => {
            result.passed = false;
            result.errorCode = "SCREENSHOT";
          });
          report.results.push(result);
          await persist();
          await context.close();
        }
      }
  return uiInteractionStates.length * report.viewports.length * report.aspects.length;
}
