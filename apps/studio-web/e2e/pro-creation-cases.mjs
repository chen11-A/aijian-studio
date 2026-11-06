import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge, seedCreationProject } from "./pro-creation-fixture.mjs";
export const creationStates = [
  "seven-preview",
  "seven-confirm",
  "seven-stale",
  "seven-long-unknown",
  "archive-export",
  "archive-export-outcomes",
  "archive-import-reopen",
  "archive-import-guard",
];
const mediaFacts = (film) => ({
  people: film.characters.map((person) => ({ id: person.id, portraits: person.portraits })),
  shots: film.shots.map((shot) => ({ id: shot.id, poster: shot.poster, takes: shot.takes })),
  clips: film.audioClips,
});
export async function runCreationCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
  const operationsModuleUrl = new URL("/src/aivora/film/operations.ts", config.url).href;
  const mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of creationStates) {
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
          screenshot: path.join(combination, "creation.png"),
          pageerrors: [],
          blockedRequests: [],
          reachability: [],
        };
        let scopeSelector = ".pro-root",
          captured = false;
        const nav = (label) =>
          page
            .getByRole("navigation", { name: "创作阶段" })
            .getByRole("button", { name: new RegExp(label) });
        const saved = () => page.evaluate(() => window.__proCreationAudit.saved());
        const record = (id) => page.evaluate((id) => window.__proCreationAudit.record(id), id);
        const frame = () =>
          page.evaluate(
            () =>
              new Promise((resolve) =>
                window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
              ),
          );
        const calls = () =>
          page.evaluate(() => ({
            exports: window.__proCreationAudit.exports,
            imports: window.__proCreationAudit.imports,
            assemblies: window.__proCreationAudit.assemblies,
            forbidden: [
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
            ],
          }));
        async function geometry() {
          result.geometry = await page.evaluate(probeProLayout, { scopeSelector });
          await page.screenshot({ path: path.join(config.out, result.screenshot) });
          captured = true;
          assert.deepEqual(
            result.geometry.issues,
            [],
            "Creation controls must retain original geometry rules",
          );
        }
        async function reachable(control, label) {
          await control.scrollIntoViewIfNeeded();
          await frame();
          const measured = await control.evaluate((element) => {
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
            return {
              width: r.width,
              height: r.height,
              box: { x: r.x, y: r.y, width: r.width, height: r.height },
              fullyVisible:
                r.left >= left - 1 &&
                r.top >= top - 1 &&
                r.right <= right + 1 &&
                r.bottom <= bottom + 1,
            };
          });
          result.reachability.push({ control: label, ...measured });
          result.failedControl = label;
          assert.ok(measured.fullyVisible, "An action must scroll fully into view");
          assert.ok(measured.width > 2 && measured.height > 2);
          if (await control.isEnabled()) await control.click({ trial: true });
          result.geometry = await page.evaluate(probeProLayout, { scopeSelector });
          assert.deepEqual(result.geometry.issues, [], "Reachable actions must remain unoccluded");
          delete result.failedControl;
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
              url.origin !== new URL(config.url).origin ? "EXTERNAL_HTTP" : "API",
            );
            return route.abort();
          }
          if (url.href === mediaUrl)
            return route.fulfill({ contentType: "video/mp4", body: media });
          return route.continue();
        });
        await page.addInitScript(installExportQcBridge, { state: "clean", aspect });
        await page.addInitScript(installCreationBridge, { state });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          const seed = await page.evaluate(seedCreationProject, { state });
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(() =>
            Object.hasOwn(window.__proCreationAudit.saved().characters[0], "gender"),
          );
          const before = await saved();
          assert.equal(before.shots.length, 6, "Retain the original multi-shot project");
          assert.ok(before.shots.every((shot) => shot.takes.length === 3));
          if (state.startsWith("seven")) {
            await nav("分镜").click();
            assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "board");
            await page.getByRole("button", { name: "属性", exact: true }).click();
            const advanced = page
              .locator(".pgroup")
              .filter({ has: page.locator("summary", { hasText: /^高级$/ }) });
            if (!(await advanced.evaluate((element) => element.open)))
              await advanced.locator("summary").click();
            assert.equal(await advanced.getAttribute("open"), "");
            const organize = page.getByRole("button", { name: "整理视频说明", exact: true });
            await organize.click();
            const card = page.getByRole("region", { name: "七段视频说明", exact: true });
            await card.getByRole("button", { name: "确认视频说明", exact: true }).waitFor();
            assert.equal(await card.locator(".nx-video-facts > div").count(), 7);
            assert.equal(
              await card.getByRole("list", { name: "字段改动" }).locator(".nx-field-row").count(),
              1,
            );
            assert.equal(await card.locator("button.primary").count(), 1);
            assert.deepEqual(
              await record(before.id),
              before,
              "Preview alone must not change the archive",
            );
            result.reached = true;
            await geometry();
            const confirm = () => card.getByRole("button", { name: "确认视频说明", exact: true });
            await reachable(confirm(), "video-confirm");
            await reachable(
              card.getByRole("button", { name: "关闭说明", exact: true }),
              "video-review-close",
            );
            await reachable(card.locator("summary"), "video-prompt-text");
            await card.locator("summary").click();
            const model = card.locator(".nx-video-model");
            const modelText = await model.innerText();
            assert.ok(modelText.length > 0 && modelText.length <= 2000);
            assert.doesNotMatch(modelText, /film_sample|prj_|synthetic\/|factsKey/);
            const modelMetrics = await model.evaluate((element) => {
              element.scrollTop = element.scrollHeight;
              return {
                width: element.clientWidth,
                scrollWidth: element.scrollWidth,
                height: element.clientHeight,
                scrollHeight: element.scrollHeight,
                end: element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
              };
            });
            assert.ok(modelMetrics.scrollWidth <= modelMetrics.width + 2 && modelMetrics.end);
            result.modelTextLength = modelText.length;
            result.modelMetrics = modelMetrics;
            if (state === "seven-confirm") {
              await confirm().click();
              await card
                .getByText("视频说明已确认并保存。此次确认没有生成媒体。", { exact: true })
                .waitFor();
              await page.waitForFunction(
                ({ id, shotId }) => {
                  const raw = window.localStorage.getItem(`aivora.film.v1.${id}`);
                  return !!(
                    raw &&
                    JSON.parse(raw).shots.find((shot) => shot.id === shotId)?.reviewedVideoPrompt
                  );
                },
                { id: seed.projectId, shotId: seed.shotId },
              );
              const confirmed = await saved();
              const body = await page.evaluate(
                async ({ url, shotId }) => {
                  const { storyFilmBatches } = await import(url);
                  const film = window.__proCreationAudit.saved();
                  return storyFilmBatches(
                    film,
                    [film.shots.find((shot) => shot.id === shotId)],
                    film.draft,
                  )[0].shots[0].prompt;
                },
                { url: operationsModuleUrl, shotId: seed.shotId },
              );
              assert.equal(
                body,
                modelText,
                "Actual production request builder must consume exactly the previewed body",
              );
              assert.deepEqual(mediaFacts(confirmed), mediaFacts(before));
              assert.ok(
                confirmed.shots.find((shot) => shot.id === seed.shotId).reviewedVideoPrompt.text
                  .length > 0,
              );
              assert.equal(await confirm().isDisabled(), true);
              result.actualBuilderMatched = true;
              await geometry();
            } else if (state === "seven-stale") {
              await page
                .getByLabel("分镜画面", { exact: true })
                .fill("后来由用户改变的画面，需重新核对后确认。");
              assert.equal(await confirm().isDisabled(), true);
              await card
                .getByText("事实、选版或页面已变化，本次未应用；请重新整理。", { exact: true })
                .waitFor();
              await organize.click();
              assert.equal(await confirm().isEnabled(), true);
              await page.getByRole("button", { name: "单个镜头", exact: true }).click();
              await page.locator(".cands > .nx-takes").waitFor();
              assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "board");
              await page.getByRole("button", { name: "AI 助手", exact: true }).click();
              await card.waitFor({ state: "visible" });
              assert.equal(
                await confirm().isEnabled(),
                true,
                "Changing board layout alone does not change the request selection",
              );
              await page.getByRole("button", { name: "用第 2 版", exact: true }).click();
              const expected = before.shots.find((shot) => shot.id === seed.shotId).takes[1].id;
              await page.waitForFunction(
                ({ id, shotId, expected }) => {
                  const raw = window.localStorage.getItem(`aivora.film.v1.${id}`);
                  return (
                    raw &&
                    JSON.parse(raw).shots.find((shot) => shot.id === shotId).selectedTakeId ===
                      expected
                  );
                },
                { id: seed.projectId, shotId: seed.shotId, expected },
              );
              assert.equal(
                await page.locator(".nx-take.nx-in-use").getAttribute("aria-label"),
                "第 2 版",
              );
              assert.equal(await confirm().isDisabled(), true);
              assert.deepEqual(mediaFacts(await saved()), mediaFacts(before));
              assert.equal(
                (await saved()).shots.find((shot) => shot.id === seed.shotId).reviewedVideoPrompt,
                undefined,
              );
              result.inputAndSelectionRejected = true;
              await geometry();
              await reachable(
                card.getByRole("button", { name: "关闭说明", exact: true }),
                "video-review-close",
              );
              await reachable(card.locator("summary"), "video-prompt-text");
              await card.locator("summary").click();
              await card.locator("summary").click();
              await reachable(confirm(), "video-confirm");
            } else if (state === "seven-long-unknown") {
              await card.getByText("身份 · 待决定", { exact: true }).waitFor();
              assert.ok((await card.innerText()).includes("当前视频请求关闭原生声音"));
              assert.ok((await card.innerText()).includes("没有观看画面或验证动作"));
              assert.ok(modelText.length > 600);
              assert.doesNotMatch(modelText, /待决定|林骁|刀疤|雨声仅是后期设想/);
              const fields = await card
                .locator("dd")
                .evaluateAll((elements) =>
                  elements.map((e) => ({ width: e.clientWidth, scrollWidth: e.scrollWidth })),
                );
              assert.ok(fields.every((row) => row.scrollWidth <= row.width + 2));
              result.unknownAndSoundBoundaries = true;
              await geometry();
              await reachable(confirm(), "video-confirm");
            }
            assert.deepEqual((await calls()).exports, []);
            assert.deepEqual((await calls()).imports, []);
          } else {
            const importing = state.startsWith("archive-import");
            await page.getByRole("button", { name: "作品", exact: true }).click();
            await page
              .getByRole("button", { name: importing ? "打开工程包" : "导出工程包", exact: true })
              .click();
            const dialog = page.getByRole("dialog", {
              name: importing ? "打开工程包" : "导出工程包",
              exact: true,
            });
            await dialog.waitFor();
            scopeSelector = `[role="dialog"][aria-label="${importing ? "打开工程包" : "导出工程包"}"]`;
            assert.equal(await dialog.locator("button.primary").count(), 1);
            assert.ok((await dialog.innerText()).includes("不包含历史版本"));
            assert.ok((await dialog.innerText()).includes("不携带原生成的来源验证记录"));
            const main = dialog.getByRole("button", {
              name: importing ? "选择工程包" : "选择保存位置并打包",
              exact: true,
            });
            const close = dialog.getByRole("button", { name: "关闭", exact: true });
            result.reached = true;
            await geometry();
            await reachable(main, importing ? "archive-import" : "archive-export");
            await reachable(close, "dialog-close");
            assert.deepEqual((await calls()).exports, []);
            assert.deepEqual((await calls()).imports, []);
            await main.click();
            if (state === "archive-export") {
              await page.waitForFunction(
                () => window.__proCreationAudit.pendingExports.length === 1,
              );
              assert.equal(await main.isDisabled(), true);
              assert.equal(await close.isDisabled(), true);
              result.busyFenceChecked = true;
              assert.equal((await calls()).exports.length, 1);
              assert.equal((await calls()).exports[0].matched, true);
              await geometry();
              await page.evaluate(() => window.__proCreationAudit.resolveExport(0));
              await dialog
                .getByText("工程包已写入所选位置，包含 4 份引用素材。", { exact: true })
                .waitFor();
              assert.deepEqual(mediaFacts(await record(before.id)), mediaFacts(before));
              result.exportIdentityMatched = true;
              await geometry();
              await reachable(close, "dialog-close");
            } else if (state === "archive-export-outcomes") {
              await dialog
                .getByText("有引用素材找不到，工程包未导出。请先检查素材。", { exact: true })
                .waitFor();
              assert.equal(await main.isEnabled(), true);
              await geometry();
              await main.click();
              await dialog.getByText("已取消，原作品没有改动。", { exact: true }).waitFor();
              assert.equal((await calls()).exports.length, 2);
              assert.ok((await calls()).exports.every((row) => row.matched));
              assert.deepEqual(mediaFacts(await record(before.id)), mediaFacts(before));
              result.failureAndCancelPreserved = true;
              await geometry();
              await reachable(close, "dialog-close");
            } else if (state === "archive-import-reopen") {
              await dialog.waitFor({ state: "hidden" });
              await page.waitForFunction(
                (id) => window.localStorage.getItem("aivora.film.activeId") === id,
                seed.importedId,
              );
              assert.equal((await calls()).imports.length, 1);
              assert.equal((await calls()).imports[0].arity, 0);
              assert.deepEqual(mediaFacts(await record(before.id)), mediaFacts(before));
              const imported = await record(seed.importedId);
              assert.equal(imported.shots.length, 6);
              assert.ok(imported.shots.every((shot) => shot.takes.length === 3));
              await page.getByRole("button", { name: "作品", exact: true }).click();
              await page.getByRole("button", { name: before.seriesTitle, exact: true }).click();
              await page.waitForFunction(
                (id) => window.localStorage.getItem("aivora.film.activeId") === id,
                before.id,
              );
              await page.getByRole("button", { name: "作品", exact: true }).click();
              await page.getByRole("button", { name: "导入后的合成作品", exact: true }).click();
              await page.waitForFunction(
                (id) => window.localStorage.getItem("aivora.film.activeId") === id,
                seed.importedId,
              );
              assert.deepEqual(mediaFacts(await saved()), mediaFacts(imported));
              scopeSelector = ".pro-root";
              result.newIdentityReopened = true;
              await geometry();
            } else {
              await page.waitForFunction(
                () => window.__proCreationAudit.pendingImports.length === 1,
              );
              assert.equal(await main.isDisabled(), true);
              assert.equal(await close.isDisabled(), true);
              result.busyFenceChecked = true;
              await reachable(close, "dialog-close");
              await page.getByRole("button", { name: "作品", exact: true }).click();
              const otherWork = page.getByRole("button", { name: "合成第2集", exact: true });
              await otherWork.waitFor();
              const blocked = await otherWork.click({ trial: true, timeout: 750 }).then(
                () => false,
                () => true,
              );
              assert.equal(
                blocked,
                true,
                "Pending archive modal must prevent a real pointer work switch",
              );
              const fence = await otherWork.evaluate((element) => {
                const box = element.getBoundingClientRect(),
                  hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
                return {
                  modalBlocked: !!hit?.closest(".dialog-back"),
                  box: { x: box.x, y: box.y, width: box.width, height: box.height },
                };
              });
              assert.equal(
                fence.modalBlocked,
                true,
                "The blocker must be the real modal, not an unrelated failure",
              );
              result.modalWorkFence = fence;
              await page.keyboard.press("Escape");
              assert.equal((await saved()).id, before.id);
              assert.deepEqual(mediaFacts(await record(before.id)), mediaFacts(before));
              assert.equal((await calls()).imports.length, 1);
              await geometry();
              await page.evaluate(() => window.__proCreationAudit.resolveImport(0));
              await dialog.waitFor({ state: "hidden" });
              await page.waitForFunction(
                (id) => window.localStorage.getItem("aivora.film.activeId") === id,
                seed.importedId,
              );
              assert.equal((await calls()).imports.length, 1);
              assert.deepEqual(mediaFacts(await record(before.id)), mediaFacts(before));
              const imported = await saved();
              assert.equal(imported.id, seed.importedId);
              assert.notEqual(imported.id, before.id);
              assert.equal(imported.shots.length, 6);
              assert.ok(imported.shots.every((shot) => shot.takes.length === 3));
              result.pendingImportOpenedOnlyNewIdentity = true;
              scopeSelector = ".pro-root";
              await geometry();
            }
          }
          const observed = await calls();
          assert.deepEqual(observed.forbidden, []);
          assert.deepEqual(observed.assemblies, []);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = {
            exports: observed.exports.length,
            imports: observed.imports.length,
            assemblies: observed.assemblies.length,
            forbidden: observed.forbidden.length,
          };
          result.passed = true;
        } catch (error) {
          const match =
            typeof error.stack === "string"
              ? error.stack
                  .split("\n")
                  .find(
                    (line) =>
                      /^\s+at\s/.test(line) &&
                      /[\\/]pro-creation-cases\.mjs:\d{1,6}:\d{1,6}(?:\)|$)/.test(line),
                  )
              : null;
          const line = Number(
            match?.match(/[\\/]pro-creation-cases\.mjs:(\d{1,6}):\d{1,6}(?:\)|$)/)?.[1],
          );
          result.checkLine =
            Number.isSafeInteger(line) && line >= 1 && line <= 100000 ? line : null;
          result.error = "PRO_CREATION_CASE_FAILED";
        } finally {
          if (!captured || !result.passed) {
            if (captured) result.previousGeometry = result.geometry;
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
  return report.viewports.length * report.aspects.length * creationStates.length;
}
