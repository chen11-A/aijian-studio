import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";

export const qcStates = [
  "clean",
  "warn-long",
  "block",
  "other-block",
  "failed",
  "stale",
  "prepare-busy",
  "publish-busy",
];

export async function runQcCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
  const mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of qcStates) {
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
          pageerrors: [],
          blockedRequests: [],
          screenshot: path.join(combination, "review.png"),
        };
        let evidenceTaken = false;
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
        await page.addInitScript({
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state, aspect })});(${installAssemblyAuditBridge.toString()})();`,
        });
        const dialog = page.getByRole("dialog", { name: "导出成片", exact: true });
        const publish = dialog.getByRole("button", { name: "审核后发布", exact: true });
        const cancel = dialog.getByRole("button", { name: "取消本次导出", exact: true });
        const calls = () =>
          page.evaluate(() => {
            const a = window.__exportQcAudit;
            return {
              prepare: a.prepare,
              publish: a.publish,
              discard: a.discard,
              forbidden: a.forbidden,
            };
          });
        async function evidence() {
          await cancel.scrollIntoViewIfNeeded();
          result.geometry = await page.evaluate(probeProLayout, {
            scopeSelector: '[role="dialog"][aria-label="导出成片"]',
          });
          await page.screenshot({ path: path.join(config.out, result.screenshot) });
          evidenceTaken = true;
          assert.deepEqual(
            result.geometry.issues,
            [],
            "QC review has clipped, covered or overflowing controls",
          );
        }
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
          const selection = await page.evaluate(() => {
            const id = window.localStorage.getItem("aivora.film.activeId");
            const film = JSON.parse(window.localStorage.getItem(`aivora.film.v1.${id}`));
            return {
              projectId: film.id,
              expectedSelection: film.shots.map((shot) => ({
                shotId: shot.id,
                takeId: shot.selectedTakeId,
              })),
            };
          });
          await page.getByRole("button", { name: "导出成片", exact: true }).click();
          await dialog.waitFor();
          if (state === "other-block")
            await dialog.getByLabel("比例", { exact: true }).selectOption("both");
          await dialog.getByRole("button", { name: "检查成片", exact: true }).click();
          await dialog.getByRole("heading", { name: "导出前检查", exact: true }).waitFor();
          await page.waitForFunction(() => window.__exportQcAudit.prepare.length === 1);
          if (state !== "prepare-busy")
            await page.waitForFunction(
              () =>
                !document.querySelector(".nx-export")?.getAttribute("aria-busy") ||
                document.querySelector(".nx-export")?.getAttribute("aria-busy") === "false",
            );
          result.reached = true;
          const primaries = await dialog
            .locator("button.primary,button.nx-primary")
            .evaluateAll((buttons) =>
              buttons
                .filter(
                  (button) =>
                    button.getBoundingClientRect().width > 0 &&
                    button.getBoundingClientRect().height > 0,
                )
                .map((button) => button.textContent.trim()),
            );
          assert.deepEqual(
            primaries,
            ["审核后发布"],
            "Expected exactly one visible primary review action",
          );
          assert.equal(
            await dialog.getByRole("button", { name: "检查成片", exact: true }).count(),
            0,
          );
          const prepared = (await calls()).prepare[0];
          assert.deepEqual(Object.keys(prepared).sort(), [
            "expectedSelection",
            "projectId",
            "settings",
          ]);
          assert.deepEqual(
            { projectId: prepared.projectId, expectedSelection: prepared.expectedSelection },
            selection,
          );
          assert.deepEqual(
            prepared.settings.aspects,
            state === "other-block" ? [aspect, aspect === "16:9" ? "9:16" : "16:9"] : [aspect],
          );
          assert.equal(
            (await calls()).publish.length,
            0,
            "Preparation must not publish automatically",
          );
          if (state === "prepare-busy") {
            assert.equal(await publish.isDisabled(), true);
            assert.equal(await cancel.isDisabled(), true);
            await dialog
              .getByText("正在进行黑屏、画面停顿、音频及字幕技术检查。", { exact: true })
              .waitFor();
            await evidence();
            await page.evaluate(() => window.__exportQcAudit.resolvePrepare());
            await page.waitForFunction(
              () => document.querySelector(".nx-export")?.getAttribute("aria-busy") === "false",
            );
          } else if (state === "failed") {
            assert.equal(await publish.isDisabled(), true);
            await dialog.getByText("本次技术检查未完成，请重新检查。", { exact: true }).waitFor();
            await cancel.click({ trial: true });
            await evidence();
            await cancel.click();
          } else {
            await dialog
              .getByRole("region", { name: "仍需人工确认" })
              .getByText("对白完整性需要人工核对。", { exact: true })
              .waitFor();
            if (state === "other-block") {
              assert.equal(
                await publish.isDisabled(),
                true,
                "A clean output must not bypass another aspect's block",
              );
              await dialog
                .getByRole("button", { name: aspect === "16:9" ? "9:16" : "16:9", exact: true })
                .click();
              assert.equal(await publish.isDisabled(), true);
            } else if (state === "stale") {
              await dialog.getByLabel("清晰度", { exact: true }).selectOption("720p");
              await dialog
                .getByText("作品或导出设置已变化，需要重新检查。", { exact: true })
                .waitFor();
              assert.equal(await publish.isDisabled(), true);
              await page.waitForFunction(() => window.__exportQcAudit.discard.length > 0);
            } else if (state === "block") assert.equal(await publish.isDisabled(), true);
            else assert.equal(await publish.isEnabled(), true);
            if (state === "publish-busy") {
              await publish.click();
              await page.waitForFunction(() => window.__exportQcAudit.publish.length === 1);
              assert.equal(await publish.isDisabled(), true);
              assert.equal(await cancel.isDisabled(), true);
              await publish.evaluate((button) => button.click());
              await cancel.evaluate((button) => button.click());
              assert.equal((await calls()).publish.length, 1);
              await evidence();
              await page.evaluate(() => window.__exportQcAudit.resolvePublish());
            } else {
              if (state === "warn-long") {
                const fixes = dialog.getByRole("button", { name: /^去修/ });
                assert.equal(await fixes.count(), 18);
                await fixes.last().click({ trial: true });
                result.longReport = await dialog.locator(".nx-export-list").evaluate((element) => ({
                  scrollHeight: element.scrollHeight,
                  clientHeight: element.clientHeight,
                  scrollTop: element.scrollTop,
                }));
                assert.ok(
                  result.longReport.scrollHeight > result.longReport.clientHeight,
                  "Long report should have a real scroll region",
                );
                assert.ok(
                  result.longReport.scrollTop > 0,
                  "Last issue must be reachable by scrolling",
                );
                result.tailScreenshot = path.join(combination, "report-tail.png");
                await page.screenshot({ path: path.join(config.out, result.tailScreenshot) });
              }
              await cancel.click({ trial: true });
              if (await publish.isEnabled()) await publish.click({ trial: true });
              await evidence();
              if (state === "warn-long") {
                assert.equal(await dialog.locator(".nx-issue").count(), 18);
                // Retain the original full-dialog geometry above before testing deeper reachability.
                const advanced = dialog.locator(".nx-issue .nx-adv > summary");
                assert.equal(await advanced.count(), 18);
                for (const summary of [advanced.first(), advanced.last()]) {
                  await summary.scrollIntoViewIfNeeded();
                  await summary.click();
                  assert.equal(
                    await summary.evaluate((element) => element.parentElement.open),
                    true,
                    "Advanced issue details must open through an unobstructed user click",
                  );
                  await summary.click();
                }
                result.advancedReachable = true;
                await publish.click();
                await page.waitForFunction(() => window.__exportQcAudit.publish.length === 1);
              } else await cancel.click();
            }
          }
          const actual = await calls();
          assert.equal(
            actual.publish.length,
            ["warn-long", "publish-busy"].includes(state) ? 1 : 0,
          );
          if (actual.publish.length) {
            assert.deepEqual(actual.publish[0], {
              ...prepared,
              qcReceipt: "synthetic-opaque-receipt",
            });
          }
          if (["clean", "block", "other-block", "stale"].includes(state))
            assert.ok(actual.discard.length > 0, "Cancelling must discard the staged receipt");
          assert.deepEqual(actual.forbidden, []);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = actual;
          const assembly = await page.evaluate(() => ({
            calls: window.__assemblyAudit.calls,
            legacy: window.__assemblyAudit.legacy,
            forbidden: window.__assemblyAudit.forbidden,
          }));
          assert.deepEqual(assembly, { calls: [], legacy: [], forbidden: [] });
          result.assembly = assembly;
          result.passed = true;
        } catch (error) {
          result.error = error.message;
        } finally {
          if (!evidenceTaken) {
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
  return report.viewports.length * report.aspects.length * qcStates.length;
}
