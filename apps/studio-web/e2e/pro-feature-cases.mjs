import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installFeatureBridge, seedFeatureProject } from "./pro-feature-fixture.mjs";
export const featureStates = [
  "art-style-preview",
  "art-style-confirm",
  "waveform-known",
  "waveform-unknown-stale",
  "history-list",
  "history-restore-guard",
];
const mediaFields = (film) => ({
  characters: film.characters,
  shots: film.shots.map((s) => ({
    id: s.id,
    poster: s.poster,
    takes: s.takes,
    selectedTakeId: s.selectedTakeId,
  })),
  audioClips: film.audioClips,
});
export async function runFeatureCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href,
    mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of featureStates) {
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
          screenshot: path.join(combination, "feature.png"),
          pageerrors: [],
          blockedRequests: [],
        };
        let captured = false;
        const saved = () => page.evaluate(() => window.__proFeatureAudit.saved());
        const calls = () =>
          page.evaluate(() => ({
            text: window.__proFeatureAudit.text.length,
            waves: window.__proFeatureAudit.waves,
            pending: window.__proFeatureAudit.pending.length,
            history: window.__proFeatureAudit.history
              ? {
                  lists: window.__proFeatureAudit.history.list.length,
                  captures: window.__proFeatureAudit.history.capture,
                  restores: window.__proFeatureAudit.history.restore,
                  pending: window.__proFeatureAudit.history.pending.length,
                }
              : undefined,
            forbidden: [...window.__proFeatureAudit.forbidden, ...window.__exportQcAudit.forbidden],
          }));
        const nav = (label) =>
          page
            .getByRole("navigation", { name: "创作阶段" })
            .getByRole("button", { name: new RegExp(label) });
        const frame = () =>
          page.evaluate(
            () =>
              new Promise((resolve) =>
                window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
              ),
          );
        async function geometry(scopeSelector = ".pro-root") {
          result.geometry = await page.evaluate(probeProLayout, { scopeSelector });
          await page.screenshot({ path: path.join(config.out, result.screenshot) });
          captured = true;
          assert.deepEqual(
            result.geometry.issues,
            [],
            "Feature state has covered, clipped or overflowing controls",
          );
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
        await page.addInitScript(installExportQcBridge, { state: "clean", aspect });
        await page.addInitScript(installFeatureBridge, { state });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          result.seed = await page.evaluate(seedFeatureProject, { state });
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(() =>
            Object.hasOwn(window.__proFeatureAudit.saved().characters[0], "gender"),
          );
          const before = await saved();
          if (state.startsWith("history")) {
            await page.getByRole("button", { name: "作品", exact: true }).click();
            await page.getByRole("button", { name: "作品设置", exact: true }).click();
            const dialog = page.getByRole("dialog", { name: "作品设置", exact: true });
            const list = dialog.locator(".nx-history");
            const rows = list.locator(".nx-history-row");
            await rows.nth(2).waitFor();
            assert.equal(await rows.count(), 3);
            await list.getByText("批量生成前自动存的", { exact: true }).waitFor();
            await list.getByText("整部制作前自动存的", { exact: true }).waitFor();
            await list.getByText("手动保存的版本", { exact: true }).waitFor();
            assert.doesNotMatch(await list.innerText(), /hst_|film_/);
            assert.equal((await calls()).history.restores.length, 0);
            const save = dialog.getByRole("button", { name: "保存当前版本", exact: true });
            await save.click({ trial: true });
            const restore = () =>
              list.getByRole("button", { name: "恢复到这里", exact: true }).first();
            await restore().click({ trial: true });
            result.reached = true;
            await geometry('[role="dialog"][aria-label="作品设置"]');
            if (state === "history-list") {
              await save.click();
              await rows.nth(3).waitFor();
              await page
                .locator(".status-note")
                .filter({ hasText: "当前版本已保存到历史。" })
                .waitFor();
              const history = (await calls()).history;
              assert.equal(history.captures.length, 1);
              assert.equal(history.captures[0].matched, true);
              assert.equal(history.captures[0].reason, "manual");
              assert.equal(history.restores.length, 0);
              assert.deepEqual(mediaFields(await saved()), mediaFields(before));
              await geometry('[role="dialog"][aria-label="作品设置"]');
            } else {
              await restore().click();
              let confirm = dialog.getByRole("group", { name: "确认恢复", exact: true });
              await confirm.waitFor();
              assert.equal((await calls()).history.restores.length, 0);
              assert.equal(await confirm.locator("button.nx-primary").count(), 1);
              await confirm.getByRole("button", { name: "取消", exact: true }).click();
              assert.equal((await calls()).history.restores.length, 0);
              await restore().click();
              confirm = dialog.getByRole("group", { name: "确认恢复", exact: true });
              await confirm.getByRole("button", { name: "恢复", exact: true }).click();
              await page.waitForFunction(
                () => window.__proFeatureAudit.history.pending.length === 1,
              );
              assert.equal(
                await dialog
                  .getByRole("button", { name: "正在处理历史版本…", exact: true })
                  .isDisabled(),
                true,
              );
              await list.getByRole("button", { name: "正在恢复", exact: true }).waitFor();
              assert.equal((await calls()).history.restores[0].matched, true);
              await page.evaluate(() => window.__proFeatureAudit.resolveHistory(0));
              await page
                .locator(".status-note")
                .filter({ hasText: "历史恢复尚未确认，请核对当前作品。" })
                .waitFor();
              assert.deepEqual(mediaFields(await saved()), mediaFields(before));
              assert.equal((await saved()).styleZh, before.styleZh);
              assert.doesNotMatch(await page.locator(".status-note").innerText(), /已恢复历史版本/);
              await save.waitFor();
              await restore().click();
              await dialog
                .getByRole("group", { name: "确认恢复", exact: true })
                .getByRole("button", { name: "恢复", exact: true })
                .click();
              await page.waitForFunction(
                () => window.__proFeatureAudit.history.pending.length === 2,
              );
              await dialog.getByRole("button", { name: "关闭", exact: true }).click();
              await page.getByRole("button", { name: "作品", exact: true }).click();
              await page.getByRole("button", { name: "合成第2集", exact: true }).click();
              await page.waitForFunction(
                () => window.__proFeatureAudit.saved().id === "film_featureother000001",
              );
              await nav("角色与场景").click();
              const style = page.getByLabel("画风说明", { exact: true });
              await style.waitFor();
              assert.equal(await style.inputValue(), "另一个合成作品的画风，旧请求不可覆盖。");
              await page.evaluate(() => window.__proFeatureAudit.resolveHistory(1, "PARTIAL"));
              await frame();
              assert.equal(await style.inputValue(), "另一个合成作品的画风，旧请求不可覆盖。");
              assert.equal((await saved()).id, "film_featureother000001");
              assert.doesNotMatch(
                await page.locator(".status-note").innerText(),
                /已恢复历史版本|历史恢复尚未确认/,
              );
              result.lateHistoryRejected = true;
              await geometry();
            }
            assert.equal((await calls()).text, 0);
          } else if (state.startsWith("art")) {
            await nav("角色与场景").click();
            assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "cast");
            await page.waitForFunction(
              () =>
                document.querySelector('button[aria-label="账号"]')?.title === "Grok 会员 · 已连接",
            );
            const chip = page.getByRole("button", { name: "请美术定画风", exact: true });
            await chip.click();
            const card = page.getByRole("region", { name: "助手的建议" });
            await card.getByText("建议变更 1 个字段", { exact: true }).waitFor();
            assert.equal((await calls()).text, 1);
            assert.equal(await card.locator(".nx-suggest-apply").count(), 1);
            const fields = card.getByRole("list", { name: "字段改动" });
            assert.equal(await fields.locator(".nx-field-row").count(), 1);
            await fields.getByText("画风说明", { exact: true }).waitFor();
            assert.equal(await fields.locator("dd").first().innerText(), before.styleZh);
            const proposed = await fields.locator("dd").last().innerText();
            assert.notEqual(proposed, before.styleZh);
            assert.deepEqual(mediaFields(await saved()), mediaFields(before));
            assert.equal((await saved()).styleZh, before.styleZh);
            assert.equal(await card.getByRole("button", { name: "撤销", exact: true }).count(), 0);
            await card
              .getByRole("button", { name: "确认修改", exact: true })
              .click({ trial: true });
            await card.getByRole("button", { name: "不要", exact: true }).click({ trial: true });
            result.reached = true;
            await geometry();
            const fieldBoxes = await fields
              .locator("dd")
              .evaluateAll((elements) =>
                elements.map((e) => ({ width: e.clientWidth, scroll: e.scrollWidth })),
              );
            assert.ok(
              fieldBoxes.every((b) => b.scroll <= b.width + 2),
              "Long field values must wrap within their column",
            );
            result.fields = fieldBoxes;
            if (state === "art-style-confirm") {
              await card.getByRole("button", { name: "确认修改", exact: true }).click();
              await page.waitForFunction((style) => {
                const id = window.localStorage.getItem("aivora.film.activeId");
                return (
                  JSON.parse(window.localStorage.getItem(`aivora.film.v1.${id}`)).styleZh === style
                );
              }, proposed);
              assert.deepEqual(mediaFields(await saved()), mediaFields(before));
              result.confirmed = true;
              result.confirmScreenshot = path.join(combination, "confirmed.png");
              await page.screenshot({ path: path.join(config.out, result.confirmScreenshot) });
              result.geometryAfterConfirm = await page.evaluate(probeProLayout);
              assert.deepEqual(
                result.geometryAfterConfirm.issues,
                [],
                "Confirmed Cast state remains reachable",
              );
            }
          } else {
            await nav("剪辑").click();
            assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "edit");
            await page.locator(".preview-player").waitFor();
            const wave = page.getByRole("img", { name: "已核对音源的波形（混音前）", exact: true });
            await page.waitForFunction(() => window.__proFeatureAudit.pending.length === 1);
            assert.equal(await wave.count(), 0, "Unverified peaks must not be optimistic");
            if (state === "waveform-unknown-stale") {
              await page.getByText(/导入的音乐.*波形时长未确定/).waitFor();
              await page.evaluate(() => window.__proFeatureAudit.resolveWave(0));
            } else {
              await page.evaluate(() => window.__proFeatureAudit.resolveWave(0, true));
              const refresh = page.getByRole("button", { name: "刷新音频波形", exact: true });
              await refresh.waitFor();
              assert.equal(await wave.count(), 0, "Mismatched source keys must not display");
              await refresh.click();
              await page.waitForFunction(() => window.__proFeatureAudit.pending.length === 2);
              await page.evaluate(() => window.__proFeatureAudit.resolveWave(1));
              result.mismatchRejected = true;
            }
            await wave.waitFor();
            const timebase = await wave.locator("polyline").evaluate((e) => {
              const p = e
                .getAttribute("points")
                .split(" ")
                .map((v) => v.split(",").map(Number));
              return {
                count: p.length,
                first: p[0][0],
                last: p.at(-1)[0],
                finite: p.every((pair) => pair.every(Number.isFinite)),
              };
            });
            assert.equal(timebase.count, 256);
            assert.equal(timebase.first, 0);
            assert.equal(timebase.last, 25);
            assert.equal(timebase.finite, true);
            result.timebase = timebase;
            await page.waitForFunction(() => {
              const f = window.__proFeatureAudit.saved();
              return f.audioClips[0]?.waveform?.peaks.length === 256;
            });
            if (state === "waveform-unknown-stale") {
              await page.getByRole("button", { name: "刷新音频波形", exact: true }).click();
              await page.waitForFunction(() => window.__proFeatureAudit.pending.length === 2);
              assert.equal(await wave.count(), 0);
              await page.locator(".pb.bin .it").first().click();
              await page.locator(".cmp .nx-takes").waitFor();
              await page.getByRole("button", { name: "用第 2 版", exact: true }).click();
              await page.waitForFunction(() => {
                const f = window.__proFeatureAudit.saved(),
                  c = f.audioClips[0],
                  s = f.shots.find((s) => s.id === c.shotId);
                return s.selectedTakeId !== c.takeId && !c.waveform;
              });
              await page.evaluate(() => window.__proFeatureAudit.resolveWave(1));
              await frame();
              assert.equal(await wave.count(), 0);
              result.lateRejected = true;
              await page.getByRole("button", { name: "关掉对比", exact: true }).click();
            }
            result.reached = true;
            await geometry();
            assert.equal((await calls()).text, 0);
          }
          result.calls = await calls();
          assert.deepEqual(result.calls.forbidden, []);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.passed = true;
        } catch (error) {
          const checkFrame =
            typeof error.stack === "string"
              ? error.stack
                  .split("\n")
                  .find(
                    (line) =>
                      /^\s+at\s/.test(line) &&
                      /[\\/]pro-feature-cases\.mjs:\d{1,6}:\d{1,6}(?:\)|$)/.test(line),
                  )
              : undefined;
          const checkLine = Number(
            checkFrame?.match(/[\\/]pro-feature-cases\.mjs:(\d{1,6}):\d{1,6}(?:\)|$)/)?.[1],
          );
          result.checkLine =
            Number.isSafeInteger(checkLine) && checkLine >= 1 && checkLine <= 100000
              ? checkLine
              : null;
          result.error = error.message;
        } finally {
          if (!captured || !result.passed) {
            const failedScope = (await page
              .getByRole("dialog", { name: "作品设置", exact: true })
              .count())
              ? '[role="dialog"][aria-label="作品设置"]'
              : ".pro-root";
            if (captured) result.previousGeometry = result.geometry;
            result.geometry = await page
              .evaluate(probeProLayout, { scopeSelector: failedScope })
              .catch(() => null);
            const failureScreenshot = captured
              ? path.join(combination, "failure.png")
              : result.screenshot;
            result.failureScreenshot = failureScreenshot;
            await page
              .screenshot({ path: path.join(config.out, failureScreenshot) })
              .catch(() => undefined);
          }
          result.calls ??= await calls().catch(() => null);
          report.results.push(result);
          console.log(`${result.passed ? "PASS" : "FAIL"} ${combination}`);
          await persist();
          await context.close();
        }
      }
  return report.viewports.length * report.aspects.length * featureStates.length;
}
