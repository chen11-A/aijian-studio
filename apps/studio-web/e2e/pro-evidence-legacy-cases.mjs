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
  readEvidencePointer,
} from "./pro-evidence-legacy-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
export const evidenceLegacyStates = [
  "evidence-written",
  "evidence-partial",
  "evidence-failed-legacy",
  "evidence-stale",
  "legacy-board-drag-bulk",
  "legacy-timeline-range",
  "legacy-empty-fullscreen",
  "legacy-cast-search",
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
export async function runEvidenceLegacyCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href,
    mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of evidenceLegacyStates) {
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
          await control.click({ trial: true });
        }
        async function review() {
          await button("导出成片").click();
          const dialog = page.getByRole("dialog", { name: "导出成片", exact: true });
          scopeSelector = '.pro-root [role="dialog"][aria-label="导出成片"]';
          await dialog.getByLabel("比例", { exact: true }).selectOption("both");
          await dialog.getByRole("radio", { name: "单独文件", exact: true }).click();
          assert.equal(
            await dialog
              .getByRole("radio", { name: "单独文件", exact: true })
              .getAttribute("aria-checked"),
            "true",
          );
          await dialog.getByRole("button", { name: "检查成片", exact: true }).click();
          await dialog.getByRole("button", { name: "审核后发布", exact: true }).waitFor();
          assert.equal(
            await dialog.getByRole("button", { name: "审核后发布", exact: true }).isEnabled(),
            true,
          );
          assert.equal(
            await dialog
              .locator("button.primary,button.nx-primary")
              .evaluateAll(
                (rows) =>
                  rows.filter(
                    (row) =>
                      row.getBoundingClientRect().width > 0 &&
                      row.getBoundingClientRect().height > 0,
                  ).length,
              ),
            1,
          );
          return dialog;
        }
        async function publish() {
          await button("审核后发布").click();
          await page.getByRole("region", { name: "交付证据", exact: true }).waitFor();
          await page.waitForFunction(
            () =>
              window.__proEvidenceLegacyAudit.results.length ===
              window.__proEvidenceLegacyAudit.publishes.length,
          );
          return page.getByRole("region", { name: "交付证据", exact: true });
        }
        async function metadata() {
          await page.waitForFunction(() => window.__assemblyAudit.artifacts.length === 1);
          await waitAssemblyIdle(page, result.seed.projectId);
          const artifact = await page.evaluate(() => window.__assemblyAudit.artifacts[0]);
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
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state: "clean", aspect })});(${installCreationBridge.toString()})(${JSON.stringify({ state })});(${installAssemblyAuditBridge.toString()})({mode:"complete"});(${installAssemblyMediaRequests.toString()})();(${installEvidenceLegacyBridge.toString()})(${JSON.stringify({ state })});`,
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
          const seed = result.seed;
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
          if (state.startsWith("evidence-")) {
            let dialog = await review();
            result.reached = true;
            assert.equal((await calls()).publishes.length, 0);
            assert.equal(
              await page.getByRole("region", { name: "交付证据", exact: true }).count(),
              0,
            );
            await geometry("review-before-publish");
            const evidence = await publish();
            if (state === "evidence-written") {
              const response = (await calls()).results[0],
                written = response.deliveryEvidence;
              await evidence
                .getByRole("heading", { name: "交付清单已生成", exact: true })
                .waitFor();
              assert.equal(await evidence.getByText(written.fileName, { exact: true }).count(), 1);
              assert.equal(
                await evidence.getByText(written.manifestSha256, { exact: true }).count(),
                1,
              );
              for (const file of written.manifest.files) {
                assert.equal(await evidence.getByText(file.fileName, { exact: true }).count(), 1);
                assert.equal(
                  await evidence.getByText(file.sha256, { exact: true }).count(),
                  written.manifest.files.filter((f) => f.sha256 === file.sha256).length,
                );
              }
              for (const note of written.manifest.unverified)
                assert.equal(await evidence.getByText(note, { exact: true }).count(), 1);
              await geometry("written-initial");
              for (const summary of await evidence.locator("summary").all()) {
                await reachable(summary);
                await summary.click();
              }
              for (const selected of written.manifest.selection) {
                assert((await evidence.innerText()).includes(selected.label));
                assert((await evidence.innerText()).includes(selected.versionLabel));
                assert(!(await evidence.innerText()).includes(selected.shotId));
                assert(!(await evidence.innerText()).includes(selected.takeId));
              }
              assert((await evidence.innerText()).includes("平均帧率（不代表恒定帧率）"));
              await geometry("all-facts-open");
              await reachable(dialog.getByRole("button", { name: "打开文件夹", exact: true }));
              await dialog.getByRole("button", { name: "打开文件夹", exact: true }).click();
              await dialog.getByRole("button", { name: "播放", exact: true }).click();
              assert.deepEqual((await calls()).revealed, [response.outputs[0].path]);
              assert.deepEqual((await calls()).opened, [response.outputs[0].path]);
              assert(!(await evidence.innerText()).includes("/synthetic/"));
            } else if (state === "evidence-partial") {
              await evidence
                .getByText("本次导出仅完成一部分，已写出的文件保留。", { exact: true })
                .waitFor();
              let response = (await calls()).results[0];
              assert.equal(response.outputs.length, 1);
              assert.equal(
                await evidence.locator(".delivery-file").count(),
                response.deliveryEvidence.manifest.files.length,
              );
              await geometry("actual-partial-files");
              await button("检查成片").click();
              await button("审核后发布").waitFor();
              await publish();
              response = (await calls()).results[1];
              assert.equal(response.deliveryEvidence.cleanupUnconfirmed, true);
              assert.equal(response.deliveryEvidence.manifest.status, "complete");
              await page.getByText("清单已写入，暂存清理未确认。", { exact: true }).waitFor();
              assert.equal(
                await page.getByRole("heading", { name: "交付清单已生成", exact: true }).count(),
                1,
              );
              assert.equal(
                await page
                  .getByText("本次导出仅完成一部分，已写出的文件保留。", { exact: true })
                  .count(),
                0,
              );
              assert.equal(
                await page
                  .getByText(response.deliveryEvidence.manifestSha256, { exact: true })
                  .count(),
                1,
              );
              assert.equal((await calls()).publishes.length, 2);
              await geometry("written-cleanup-unknown");
            } else if (state === "evidence-failed-legacy") {
              await evidence
                .getByText("交付清单未能确认写出。以下仅列出已经确认写出的文件。", { exact: true })
                .waitFor();
              assert.equal(
                await evidence
                  .getByRole("heading", { name: "交付清单已生成", exact: true })
                  .count(),
                0,
              );
              assert.equal(await evidence.getByText("清单 SHA256", { exact: true }).count(), 0);
              await geometry("failed-manifest-real-files");
              await button("检查成片").click();
              await button("审核后发布").waitFor();
              await publish();
              await page
                .getByText("这次导出未提供交付清单，暂时不能核对交付证据。", { exact: true })
                .waitFor();
              assert.equal(
                await page.getByRole("heading", { name: "交付清单已生成", exact: true }).count(),
                0,
              );
              assert.equal((await calls()).publishes.length, 2);
              await geometry("legacy-not-provided");
            } else {
              await evidence
                .getByRole("heading", { name: "交付清单已生成", exact: true })
                .waitFor();
              await button("检查成片").click();
              await button("审核后发布").waitFor();
              await button("审核后发布").click();
              await page.waitForFunction(
                () => window.__proEvidenceLegacyAudit.pending.length === 1,
              );
              assert.equal(await button("审核后发布").isDisabled(), true);
              await dialog.getByRole("button", { name: "关闭", exact: true }).click();
              scopeSelector = ".pro-root";
              await button("作品").click();
              await button("合成交付第2集").click();
              await page
                .locator(".topbar .ep")
                .filter({ hasText: /^\/\s*合成交付第2集$/ })
                .waitFor();
              await frame();
              await waitAssemblyIdle(page, seed.otherId);
              await page.waitForFunction(() =>
                window.__proEvidenceLegacyAudit.exportCancels.some(
                  (c) =>
                    c.operationId === window.__proEvidenceLegacyAudit.publishes[1].operationId &&
                    c.kind === "UNAVAILABLE",
                ),
              );
              const other = await record(seed.otherId),
                count = (await calls()).filmWrites.filter(
                  (w) => w.projectId === seed.otherId,
                ).length;
              await page.evaluate(() => window.__proEvidenceLegacyAudit.release(0));
              await page.waitForFunction(
                () => window.__proEvidenceLegacyAudit.results.length === 2,
              );
              await frame();
              assert.deepEqual(await record(seed.otherId), other);
              assert.equal(
                (await calls()).filmWrites.filter((w) => w.projectId === seed.otherId).length,
                count,
              );
              await button("导出成片").click();
              dialog = page.getByRole("dialog", { name: "导出成片", exact: true });
              scopeSelector = '.pro-root [role="dialog"][aria-label="导出成片"]';
              assert.equal(
                await page.getByRole("region", { name: "交付证据", exact: true }).count(),
                0,
              );
              assert.equal(
                await dialog.getByRole("button", { name: "打开文件夹", exact: true }).count(),
                0,
              );
              assert.equal(
                await dialog.getByRole("button", { name: "播放", exact: true }).count(),
                0,
              );
              assert.deepEqual((await calls()).opened, []);
              assert.equal((await calls()).publishes.length, 2);
              await geometry("old-reply-new-work");
            }
            assert.deepEqual(keptMedia(await record(seed.projectId)), keptMedia(before));
          } else if (state === "legacy-board-drag-bulk") {
            await nav("分镜").click();
            await button("全部镜头").click();
            const cards = page.locator(".grid .card");
            await cards.first().waitFor();
            assert.equal(await cards.count(), 6);
            result.reached = true;
            await waitAssemblyIdle(page, seed.projectId);
            const baseline = await record(seed.projectId);
            await reachable(cards.nth(0));
            await cards.nth(0).dragTo(cards.nth(2));
            const moved = [
              seed.shotIds[1],
              seed.shotIds[2],
              seed.shotIds[0],
              ...seed.shotIds.slice(3),
            ];
            await page.waitForFunction(
              ({ id, ids }) =>
                JSON.stringify(
                  window.__proCreationAudit
                    .record(id)
                    .shots.slice()
                    .sort((a, b) => a.no - b.no)
                    .map((s) => s.id),
                ) === JSON.stringify(ids),
              { id: seed.projectId, ids: moved },
            );
            assert.deepEqual(keptMedia(await record(seed.projectId)), keptMedia(baseline));
            await page.keyboard.press("Control+z");
            await page.waitForFunction(
              ({ id, ids }) =>
                JSON.stringify(
                  window.__proCreationAudit
                    .record(id)
                    .shots.slice()
                    .sort((a, b) => a.no - b.no)
                    .map((s) => s.id),
                ) === JSON.stringify(ids),
              { id: seed.projectId, ids: seed.shotIds },
            );
            assert.deepEqual(keptMedia(await record(seed.projectId)), keptMedia(baseline));
            await cards.nth(1).click();
            await cards.nth(3).click({ modifiers: ["Shift"] });
            assert.equal(await page.locator(".grid .card.sel").count(), 3);
            await cards.nth(2).click({ modifiers: ["Control"] });
            await cards.nth(5).click({ modifiers: ["Meta"] });
            assert.equal(await page.locator(".grid .card.sel").count(), 3);
            await button("删除这 3 个").click();
            await page.waitForFunction(
              (id) => window.__proCreationAudit.record(id).shots.length === 3,
              seed.projectId,
            );
            await page.keyboard.press("Control+z");
            await page.waitForFunction(
              (id) => window.__proCreationAudit.record(id).shots.length === 6,
              seed.projectId,
            );
            assert.deepEqual(keptMedia(await record(seed.projectId)), keptMedia(baseline));
            await cards.nth(0).click();
            await cards.nth(2).click({ modifiers: ["Control"] });
            await page.getByRole("button", { name: /^(重新)?生成这 2 个$/ }).click();
            const confirm = page.getByRole("dialog", { name: "生成前确认", exact: true });
            scopeSelector = '.pro-root [role="dialog"][aria-label="生成前确认"]';
            await confirm.waitFor();
            assert.equal(await confirm.locator("tbody tr").count(), 2);
            const names = await confirm.locator("tbody tr td:first-child").allTextContents();
            assert.deepEqual(
              names,
              [1, 3].map((no) => `第 ${before.scenes[0].no} 场第 ${no} 个镜头`),
            );
            assert.equal(await confirm.locator("button.primary").count(), 1);
            await geometry("batch-scope-no-submit");
            await reachable(confirm.getByRole("button", { name: "先不生成", exact: true }));
            await confirm.getByRole("button", { name: "先不生成", exact: true }).click();
            scopeSelector = ".pro-root";
            assert.deepEqual(keptMedia(await record(seed.projectId)), keptMedia(baseline));
            await geometry("board-drag-undo-multiselect");
          } else if (state === "legacy-timeline-range") {
            await nav("剪辑").click();
            assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "edit");
            const { artifact, video } = await metadata();
            expectedAssembly.push(before);
            result.reached = true;
            const width = () =>
              page
                .locator(".clip.v")
                .first()
                .evaluate((e) => e.getBoundingClientRect().width);
            const initial = await width();
            await button("放大时间线").click();
            assert((await width()) > initial);
            await button("缩小时间线").click();
            await button("看全片").click();
            const ruler = page.getByRole("slider", { name: "播放位置", exact: true });
            await ruler.focus();
            await page.keyboard.press("ArrowRight");
            // The synthetic protocol has no decoder metadata. Deliver the real DOM event
            // after the real seek effect registers, as in the existing B08 request spy.
            await frame();
            await video.evaluate((element) =>
              element.dispatchEvent(new window.Event("loadedmetadata")),
            );
            await page.waitForFunction(
              () =>
                Math.abs(document.querySelector(".preview-player video.frame").currentTime - 1) <
                0.00001,
            );
            await video.evaluate((element) =>
              element.dispatchEvent(new window.Event("timeupdate")),
            );
            assert.equal(Number(await ruler.getAttribute("aria-valuenow")), 1);
            async function drag(fraction, comparing = false) {
              const clip = await page.locator(".clip.v").nth(1).boundingBox(),
                box = await ruler.boundingBox();
              assert(clip && box);
              const from = { x: clip.x + clip.width * 0.3, y: box.y + box.height / 2 },
                to = { x: clip.x + clip.width * fraction, y: box.y + box.height / 2 };
              await page.mouse.move(from.x, from.y);
              result.dragBefore = await page.evaluate(readEvidencePointer, from);
              await page.mouse.down();
              await page.mouse.move(clip.x + clip.width * fraction, box.y + box.height / 2, {
                steps: 6,
              });
              await page.mouse.up();
              await frame();
              result.dragAfter = await page.evaluate(readEvidencePointer, to);
              if (comparing) {
                assert.equal(await page.locator(".preview-player video.frame").count(), 0);
                assert.equal(
                  await page.getByRole("heading", { name: "对比", exact: true }).count(),
                  1,
                );
                const sources = await page
                  .locator(".cmp-takes video")
                  .evaluateAll((rows) => rows.map((row) => row.getAttribute("src")));
                assert.deepEqual(
                  sources,
                  before.shots[1].takes.map((take) => take.videoUrl),
                );
              } else {
                await video.evaluate((element) =>
                  element.dispatchEvent(new window.Event("loadedmetadata")),
                );
              }
              await frame();
            }
            await drag(0.2);
            const globalIn = Number(await ruler.getAttribute("aria-valuenow"));
            assert(globalIn > artifact.shots[1].startSeconds);
            await button("设入点").click();
            await drag(0.8, true);
            const globalOut = Number(await ruler.getAttribute("aria-valuenow"));
            assert(
              Math.abs(
                globalOut -
                  (artifact.shots[1].startSeconds + artifact.shots[1].durationSeconds * 0.8),
              ) < 0.1,
            );
            await button("关掉对比").click();
            await page.locator(".preview-player video.frame").waitFor();
            await frame();
            await page
              .locator(".preview-player video.frame")
              .evaluate((element) => element.dispatchEvent(new window.Event("loadedmetadata")));
            await page.waitForFunction(
              (expected) =>
                Math.abs(
                  document.querySelector(".preview-player video.frame").currentTime - expected,
                ) < 0.1,
              globalOut,
            );
            // The range toolbar has no mark-out control. Its explicit close preserves the
            // recorded in-point and playhead, making the real mark-out button available.
            await button("取消选择").click();
            await button("设出点").click();
            await button("重新生成").click();
            await page.getByLabel("局部重做入点", { exact: true }).waitFor();
            scopeSelector = '.pro-root [role="dialog"][aria-label="秒级局部重做"]';
            const start = Number(
                await page.getByLabel("局部重做入点", { exact: true }).inputValue(),
              ),
              end = Number(await page.getByLabel("局部重做出点", { exact: true }).inputValue());
            assert(Math.abs(start - artifact.shots[1].durationSeconds * 0.2) < 0.25);
            assert(Math.abs(end - artifact.shots[1].durationSeconds * 0.8) < 0.25);
            assert(end > start);
            await geometry("actual-source-range-not-submitted");
            assert.deepEqual(keptMedia(await record(seed.projectId)), keptMedia(before));
          } else if (state === "legacy-empty-fullscreen") {
            await nav("分镜").click();
            await button("单个镜头").click();
            await page.getByText("还没有视频，这是开头画面", { exact: true }).waitFor();
            assert.equal((await record(seed.projectId)).shots[0].takes.length, 0);
            result.reached = true;
            await geometry("zero-take-first-frame");
            await button("全部镜头").click();
            await page.locator(".grid .card").nth(1).click();
            await nav("剪辑").click();
            const { artifact } = await metadata();
            expectedAssembly.push(before);
            await button("安全框").click();
            assert.equal(await page.locator(".safe-guide").count(), 1);
            await page.locator(".preview-player .screen").dblclick();
            await page.waitForFunction(() =>
              document.fullscreenElement?.classList.contains("preview-player"),
            );
            scopeSelector = ".preview-player";
            assert.equal(await page.locator(".preview-player .safe-guide").count(), 1);
            await geometry("actual-fullscreen-safe-guide");
            await page.keyboard.press("Escape");
            await page.waitForFunction(() => !document.fullscreenElement);
            scopeSelector = ".pro-root";
            await page.keyboard.press("f");
            await page.waitForFunction(() =>
              document.fullscreenElement?.classList.contains("preview-player"),
            );
            await page.keyboard.press("Escape");
            await page.waitForFunction(() => !document.fullscreenElement);
            assert(artifact.durationSeconds > 0);
            await geometry("fullscreen-returned");
            assert.deepEqual(keptMedia(await record(seed.projectId)), keptMedia(before));
          } else {
            await nav("角色").click();
            await page.getByRole("searchbox", { name: "找人物", exact: true }).waitFor();
            result.reached = true;
            await frame();
            await waitAssemblyIdle(page, seed.projectId);
            const baseline = await record(seed.projectId),
              writesBefore = (await calls()).filmWrites.length;
            const search = page.getByRole("searchbox", { name: "找人物", exact: true });
            assert.equal(await page.locator(".scene .t").count(), 12);
            await search.fill("12");
            assert.equal(await page.locator(".scene .t").count(), 1);
            const personRow = page.locator(".pb.scenes button.scene");
            assert.equal(await personRow.count(), 1);
            assert.equal(
              await personRow.locator(".t").evaluate((element) =>
                [...element.childNodes]
                  .filter((node) => node.nodeType === 3)
                  .map((node) => node.textContent)
                  .join("")
                  .trim(),
              ),
              seed.person,
            );
            await personRow.click();
            assert.equal(
              await page.getByLabel("人物名字", { exact: true }).inputValue(),
              seed.person,
            );
            assert((await page.locator(".chat-scope").innerText()).includes(seed.person));
            await geometry("searched-person-context");
            await search.fill("不存在的名字");
            await page.getByText("没有名字里带「不存在的名字」的人物。", { exact: true }).waitFor();
            await search.fill("");
            assert.equal(await page.locator(".scene .t").count(), 12);
            await button("提到人物、场景或镜头").click();
            const menu = page.getByRole("menu", { name: "提到谁", exact: true });
            scopeSelector = '.pro-root [role="menu"][aria-label="提到谁"]';
            const mention = menu.getByRole("menuitem", { name: `@${seed.person}`, exact: true });
            await reachable(mention);
            await geometry("long-person-reference-menu");
            await mention.click();
            scopeSelector = ".pro-root";
            assert.equal(
              await page.getByLabel("跟助手说", { exact: true }).inputValue(),
              `@${seed.person} `,
            );
            assert((await page.locator(".reference-summary").innerText()).includes("全项目"));
            await frame();
            assert.equal((await calls()).filmWrites.length, writesBefore);
            assert.equal((await record(seed.projectId)).characters.length, 12);
            assert.deepEqual(keptMedia(await record(seed.projectId)), keptMedia(baseline));
            await geometry("search-and-reference-only");
          }
          const final = await calls();
          if (["legacy-timeline-range", "legacy-empty-fullscreen"].includes(state)) {
            assert.equal(final.waveforms.length, 6);
            const expected = await page.evaluate(
              async ({ projectModuleUrl, projectId }) => {
                const { audioSourceKey } = await import(
                  new window.URL("../pro/actions/audio-waveforms.ts", projectModuleUrl).href
                );
                const film = window.__proCreationAudit.record(projectId);
                return Promise.all(
                  film.audioClips.map(async (clip) => ({
                    projectId,
                    clipId: clip.id,
                    expectedSourceKey: await audioSourceKey(film, clip),
                  })),
                );
              },
              { projectModuleUrl, projectId: seed.projectId },
            );
            assert.deepEqual(
              final.waveforms.map((call) => call.input),
              expected,
            );
            assert(
              final.waveforms.every(
                (call) =>
                  call.matched && ["TOOLS_UNAVAILABLE", "SOURCE_CHANGED"].includes(call.code),
              ),
            );
          } else assert.deepEqual(final.waveforms, []);
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
            error.stack?.match(/[\\/]pro-evidence-legacy-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
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
  return evidenceLegacyStates.length * report.viewports.length * report.aspects.length;
}
