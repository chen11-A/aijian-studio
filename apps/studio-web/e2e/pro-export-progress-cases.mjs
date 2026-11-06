import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installExportProgressBridge } from "./pro-export-progress-fixture.mjs";

export const progressStates = [
  "measured-units",
  "measured-time",
  "unknown",
  "requested",
  "stopped",
  "unavailable-retry",
  "stale-events",
  "partial-playable",
];

export async function runProgressCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
  const mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of progressStates) {
        const combination = `${viewport.width}x${viewport.height}-${aspect.replace(":", "x")}-${state}`;
        await mkdir(path.join(config.out, combination), { recursive: true });
        const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const result = {
          combination,
          page: state,
          reached: false,
          passed: false,
          screenshot: path.join(combination, "progress.png"),
          pageerrors: [],
          blockedRequests: [],
        };
        let captured = false;
        const dialog = page.getByRole("dialog", { name: "导出成片", exact: true });
        const progress = dialog.locator(".nx-export-progress");
        const stop = () => progress.getByRole("button", { name: "停止处理", exact: true });
        const emit = async (patch) => {
          await page.evaluate((value) => window.__exportProgressAudit.emit(value), patch);
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
              ),
          );
        };
        const calls = () =>
          page.evaluate(() => {
            const audit = window.__exportProgressAudit;
            return {
              prepare: audit.prepare,
              publish: audit.publish,
              cancel: audit.cancel,
              played: audit.played,
              events: audit.events,
              forbidden: window.__exportQcAudit.forbidden,
              discard: window.__exportQcAudit.discard,
            };
          });
        async function snapshot() {
          if (await progress.count()) await progress.scrollIntoViewIfNeeded();
          result.geometry = await page.evaluate(probeProLayout, {
            scopeSelector: '[role="dialog"][aria-label="导出成片"]',
          });
          await page.screenshot({ path: path.join(config.out, result.screenshot) });
          captured = true;
          assert.deepEqual(
            result.geometry.issues,
            [],
            "Progress dialog has inaccessible, covered or overflowing controls",
          );
          if (state === "stale-events") {
            // Keep the original unscrolled probe above. A later reachability check must not
            // conceal an overlap that was already visible when the stale shell appeared.
            const cancel = dialog.getByRole("button", { name: "取消本次导出", exact: true });
            await cancel.scrollIntoViewIfNeeded();
            await cancel.click({ trial: true });
            result.cancelReachability = await cancel.evaluate((button) => {
              const owner = button.closest('[role="dialog"]');
              const box = button.getBoundingClientRect();
              const panel = owner.getBoundingClientRect();
              return {
                box: { x: box.x, y: box.y, width: box.width, height: box.height },
                client: {
                  left: panel.left + owner.clientLeft,
                  top: panel.top + owner.clientTop,
                  right: panel.left + owner.clientLeft + owner.clientWidth,
                  bottom: panel.top + owner.clientTop + owner.clientHeight,
                },
                viewport: { width: window.innerWidth, height: window.innerHeight },
                scrollTop: owner.scrollTop,
              };
            });
            const { box, client, viewport: visibleViewport } = result.cancelReachability;
            assert.ok(
              box.x >= Math.max(0, client.left) - 1 &&
                box.y >= Math.max(0, client.top) - 1 &&
                box.x + box.width <= Math.min(visibleViewport.width, client.right) + 1 &&
                box.y + box.height <= Math.min(visibleViewport.height, client.bottom) + 1,
              "Review cancel must be fully reachable inside the real scroll container",
            );
            result.geometryAfterScroll = await page.evaluate(probeProLayout, {
              scopeSelector: '[role="dialog"][aria-label="导出成片"]',
            });
            result.scrollScreenshot = path.join(combination, "stale-cancel-reachable.png");
            await page.screenshot({ path: path.join(config.out, result.scrollScreenshot) });
            assert.deepEqual(
              result.geometryAfterScroll.issues,
              [],
              "Scrolling to cancel must not introduce covered or clipped controls",
            );
          }
        }
        page.on("pageerror", (error) => result.pageerrors.push(error.message));
        await page.route("**/*", (route) => {
          const url = new URL(route.request().url());
          if (
            /^https?:$/.test(url.protocol) &&
            (url.origin !== new URL(config.url).origin ||
              url.pathname === "/api" ||
              url.pathname.startsWith("/api/"))
          ) {
            result.blockedRequests.push(url.origin + url.pathname);
            return route.abort();
          }
          if (url.href === mediaUrl)
            return route.fulfill({ contentType: "video/mp4", body: media });
          return route.continue();
        });
        // One init script fixes ordering: both functions have no captured Node dependencies.
        await page.addInitScript({
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state: "clean", aspect })});(${installExportProgressBridge.toString()})(${JSON.stringify({ state, aspect })});`,
        });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          await page.evaluate(() => {
            const film = JSON.parse(window.localStorage.getItem("aivora.film.active"));
            window.localStorage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
            window.localStorage.setItem("aivora.film.activeId", film.id);
          });
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.locator("nav.tabs").waitFor();
          await page.getByRole("button", { name: "导出成片", exact: true }).click();
          await dialog.getByRole("button", { name: "检查成片", exact: true }).click();
          await page.waitForFunction(() => window.__exportProgressAudit.prepare.length === 1);
          const op = (await calls()).prepare[0];
          assert.equal(typeof op.operationId, "string");
          assert.ok(op.operationId.length > 0);
          assert.deepEqual(Object.keys(op.input).sort(), [
            "expectedSelection",
            "projectId",
            "settings",
          ]);
          await emit({
            phase: "rendering",
            progress: { kind: "media-time", outTimeSeconds: 7.5, durationSeconds: 30 },
          });
          await progress.getByRole("heading", { name: "正在制作导出画幅", exact: true }).waitFor();
          result.reached = true;
          assert.equal(await progress.getByRole("button").count(), 1);
          assert.equal(
            await dialog.getByRole("button", { name: "检查成片", exact: true }).count(),
            0,
          );
          await stop().click({ trial: true });
          const activeActions = await dialog
            .getByRole("button", { name: /^(检查成片|审核后发布|停止处理)$/ })
            .evaluateAll((buttons) =>
              buttons
                .filter(
                  (button) =>
                    !button.disabled &&
                    button.getBoundingClientRect().width > 0 &&
                    button.getBoundingClientRect().height > 0,
                )
                .map((button) => button.textContent.trim()),
            );
          assert.deepEqual(
            activeActions,
            ["停止处理"],
            "Only one main action can be submitted during active execution",
          );
          if (state === "measured-units") {
            await emit({
              phase: "joining",
              progress: { kind: "units", completed: 2, total: 3, unit: "镜头" },
            });
            await progress.getByText("本阶段已完成 2 / 3 个镜头", { exact: true }).waitFor();
            assert.equal(await progress.getByRole("progressbar").getAttribute("value"), "2");
            assert.equal(await progress.getByRole("progressbar").getAttribute("max"), "3");
          } else if (state === "measured-time") {
            await progress.getByText("本阶段 25%", { exact: true }).waitFor();
            assert.equal(await progress.getByRole("progressbar").getAttribute("value"), "7.5");
          } else if (state === "unknown") {
            await emit({ phase: "checking", progress: undefined });
            assert.equal(await progress.getByRole("progressbar").getAttribute("value"), null);
            await progress.getByText("暂时没有可用的进度数值。", { exact: true }).waitFor();
            await emit({
              phase: "checking",
              progress: { kind: "media-time", outTimeSeconds: NaN, durationSeconds: 30 },
            });
            assert.equal(await progress.getByRole("progressbar").getAttribute("value"), null);
            assert.doesNotMatch(await progress.innerText(), /NaN|Infinity|%|预计/);
          } else if (
            state === "requested" ||
            state === "stopped" ||
            state === "unavailable-retry"
          ) {
            await stop().click();
            await page.waitForFunction(() => window.__exportProgressAudit.cancel.length === 1);
            if (state === "unavailable-retry") {
              await progress.getByText("当前步骤无法停止，请等待结果。", { exact: true }).waitFor();
              assert.equal(await progress.getByRole("button").count(), 0);
              await emit({
                phase: "rendering",
                progress: { kind: "units", completed: 1, total: 2, unit: "画幅" },
              });
              await stop().click();
              await page.waitForFunction(() => window.__exportProgressAudit.cancel.length === 2);
            }
            const requested = progress.getByRole("button", { name: "正在请求停止", exact: true });
            await requested.waitFor();
            assert.equal(await requested.isDisabled(), true);
            await requested.evaluate((button) => button.click());
            assert.equal((await calls()).cancel.length, state === "unavailable-retry" ? 2 : 1);
            assert.equal(
              await progress.getByRole("heading", { name: "处理已停止", exact: true }).count(),
              0,
            );
            if (state === "stopped") {
              await emit({ phase: "rendering", cancelState: "stopped" });
              await progress.getByRole("heading", { name: "处理已停止", exact: true }).waitFor();
              assert.equal(await progress.getByRole("button").count(), 0);
              assert.equal(await progress.getByRole("progressbar").count(), 0);
            }
          } else if (state === "stale-events") {
            const current = (await calls()).events.at(-1);
            for (const patch of [
              { seq: current.seq },
              { seq: current.seq - 1 },
              { operationId: "old-operation" },
              { projectId: "wrong-project" },
            ]) {
              await emit({
                ...patch,
                progress: { kind: "media-time", outTimeSeconds: 29.7, durationSeconds: 30 },
              });
              await progress.getByText("本阶段 25%", { exact: true }).waitFor();
              assert.doesNotMatch(await progress.innerText(), /99%/);
            }
            await dialog.getByLabel("清晰度", { exact: true }).selectOption("720p");
            await page.waitForFunction(() => window.__exportProgressAudit.cancel.length >= 1);
            await emit({
              progress: { kind: "media-time", outTimeSeconds: 29.7, durationSeconds: 30 },
            });
            assert.equal(await dialog.getByText("本阶段 99%", { exact: true }).count(), 0);
            await page.evaluate(() => window.__exportProgressAudit.finishPrepare());
            await page.waitForFunction(() => window.__exportQcAudit.discard.length > 0);
            assert.equal(
              await dialog.getByRole("button", { name: "审核后发布", exact: true }).isDisabled(),
              true,
            );
          } else if (state === "partial-playable") {
            await page.evaluate(() => window.__exportProgressAudit.finishPrepare());
            const publish = dialog.getByRole("button", { name: "审核后发布", exact: true });
            await page.waitForFunction(
              () => document.querySelector(".nx-export button.nx-primary")?.disabled === false,
            );
            assert.equal((await calls()).publish.length, 0);
            await publish.click();
            await page.waitForFunction(() => window.__exportProgressAudit.publish.length === 1);
            const published = (await calls()).publish[0];
            assert.notEqual(published.operationId, op.operationId);
            await emit({
              phase: "publishing",
              published: [{ aspectRatio: aspect, label: "token=hidden /private/forbidden" }],
            });
            await progress.getByRole("region", { name: "已发布文件" }).waitFor();
            assert.doesNotMatch(await progress.innerHTML(), /private|hidden|token=/);
            await stop().click();
            await emit({
              phase: "partial",
              cancelState: "stopped",
              published: [{ aspectRatio: aspect }],
            });
            await snapshot();
            await page.evaluate(() => window.__exportProgressAudit.finishPublish());
            const play = dialog.getByRole("button", { name: "播放", exact: true });
            await play.click();
            assert.deepEqual((await calls()).played, ["/synthetic/published-part.mp4"]);
            result.playbackBoundary =
              "Production play control called a synthetic native-open spy; no real player or file";
          }
          if (!captured) await snapshot();
          const actual = await calls();
          assert.deepEqual(actual.forbidden, []);
          assert.equal(actual.prepare.length, 1);
          assert.equal(actual.publish.length, state === "partial-playable" ? 1 : 0);
          const expectedOperation =
            state === "partial-playable" ? actual.publish[0].operationId : op.operationId;
          assert.ok(
            actual.cancel.every((id) => id === expectedOperation),
            "A stop must target the same execution identity",
          );
          if (actual.publish.length)
            assert.deepEqual(actual.publish[0].input, {
              ...op.input,
              qcReceipt: "synthetic-opaque-receipt",
            });
          if (["measured-units", "measured-time", "unknown"].includes(state))
            assert.equal(actual.cancel.length, 0);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = actual;
          result.passed = true;
        } catch (error) {
          result.error = error.message;
        } finally {
          if (!captured) {
            if (result.reached)
              result.geometry = await page
                .evaluate(probeProLayout, {
                  scopeSelector: '[role="dialog"][aria-label="导出成片"]',
                })
                .catch(() => null);
            await page
              .screenshot({ path: path.join(config.out, result.screenshot) })
              .catch((error) => {
                result.screenshotError = error.message;
              });
          }
          result.calls ??= await calls().catch(() => null);
          report.results.push(result);
          console.log(`${result.passed ? "PASS" : "FAIL"} ${combination}`);
          await persist();
          await context.close();
        }
      }
  return report.viewports.length * report.aspects.length * progressStates.length;
}
