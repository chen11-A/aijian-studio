/** Extended navigation on the production ProWorkspace. Browser-only IPC/media substitutes. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { installProAuditBridge, seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";

// Explicit state names also bound the public GitHub annotation metadata.
export const fullPageNames = [
  "home-empty",
  "new-work",
  "library-menu",
  "work-settings",
  "app-settings",
  "app-settings-bottom",
  "cast-people",
  "cast-places",
  "cast-props",
  "edit-sound",
  "edit-subtitles",
  "export-options",
  "export-cover",
  "export-missing",
  "interrupted-work",
];

export async function auditFullPages({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
  const mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects) {
      const combination = `${viewport.width}x${viewport.height}-${aspect.replace(":", "x")}-full`;
      await mkdir(path.join(config.out, combination), { recursive: true });
      for (const name of fullPageNames) {
        const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const result = {
          combination,
          page: name,
          reached: false,
          screenshot: path.join(combination, `${name}.png`),
          pageerrors: [],
          blockedRequests: [],
          controls: [],
        };
        const nav = (label) =>
          page.locator("nav.tabs").getByRole("button", { name: new RegExp(label) });
        const stage = async (label, expected) => {
          await nav(label).click();
          assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), expected);
        };
        const reachable = async (locator, label) => {
          result.reached = true;
          await locator.waitFor({ state: "visible" });
          assert.equal(await locator.count(), 1, `Expected one control: ${label}`);
          await locator.click({ trial: true });
          result.controls.push({ label, reachable: true });
        };
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
        await page.addInitScript(installProAuditBridge);
        let scopeSelector = ".pro-root";
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          const home = name === "home-empty" || name === "new-work";
          if (home) await page.evaluate(() => window.localStorage.clear());
          else
            await page.evaluate(seedProProject, {
              projectModuleUrl,
              aspect,
              versions: 3,
              videoUrl: mediaUrl,
              mode:
                name === "export-missing"
                  ? "missing"
                  : name === "interrupted-work"
                    ? "interrupted"
                    : "full",
            });
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.locator(".pro-root").waitFor();
          if (!home) await page.locator("nav.tabs").waitFor();
          if (name === "home-empty" || name === "new-work") {
            await page.getByRole("heading", { name: "把故事做成短剧" }).waitFor();
            assert.equal(await page.locator("nav.tabs").count(), 0);
            await page
              .getByRole("region", { name: "最近的作品" })
              .getByText("还没有保存的作品。", { exact: true })
              .waitFor();
            await page
              .getByRole("radio", {
                name: aspect === "16:9" ? "横屏 16:9" : "竖屏 9:16",
                exact: true,
              })
              .check();
            if (name === "new-work") {
              await page.getByRole("button", { name: "新建作品", exact: true }).click();
              await page.locator("nav.tabs").waitFor();
              assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "script");
              assert.equal(await page.locator(".pro-root").getAttribute("data-aspect"), aspect);
              await page.getByLabel("这一场", { exact: true }).waitFor();
              await reachable(nav("角色"), "下一阶段入口");
            } else
              await reachable(
                page.getByRole("button", { name: "新建作品", exact: true }),
                "新建作品",
              );
          } else if (name === "library-menu" || name === "work-settings") {
            await page.getByRole("button", { name: "作品", exact: true }).click();
            const menu = page.getByRole("menu", { name: "作品菜单" });
            await menu.waitFor();
            if (name === "library-menu") {
              // Production Pro has a work menu, not the old renderer's separate library page.
              scopeSelector = '[role="menu"][aria-label="作品菜单"]';
              await reachable(
                menu.getByRole("button", { name: "布局核验合成作品", exact: true }),
                "已保存作品入口",
              );
              await reachable(
                menu.getByRole("button", { name: "新建作品", exact: true }),
                "菜单新建作品",
              );
            } else {
              await menu.getByRole("button", { name: "作品设置", exact: true }).click();
              scopeSelector = '[role="dialog"][aria-label="作品设置"]';
              const dialog = page.getByRole("dialog", { name: "作品设置", exact: true });
              await dialog.getByLabel("作品名", { exact: true }).waitFor();
              await reachable(
                dialog.getByRole("button", { name: "保存名字", exact: true }),
                "保存作品名",
              );
            }
          } else if (name.startsWith("app-settings")) {
            await page.getByRole("button", { name: "账号", exact: true }).click();
            await page
              .getByRole("menu", { name: "账号菜单" })
              .getByRole("button", { name: "设置", exact: true })
              .click();
            scopeSelector = '[role="dialog"][aria-label="设置"]';
            const dialog = page.getByRole("dialog", { name: "设置", exact: true });
            await dialog.getByRole("heading", { name: "设置", exact: true }).waitFor();
            if (name === "app-settings-bottom")
              await reachable(
                dialog.getByRole("button", { name: "关闭", exact: true }),
                "设置底部关闭",
              );
            else
              await reachable(dialog.getByRole("checkbox", { name: /预览有声音/ }), "预览声音开关");
          } else if (name.startsWith("cast-")) {
            await stage("角色", "cast");
            const side = name === "cast-people" ? "角色" : name === "cast-places" ? "场景" : "道具";
            await page.getByRole("button", { name: side, exact: true }).click();
            const label =
              name === "cast-people"
                ? "人物名字"
                : name === "cast-places"
                  ? "场景名字"
                  : "第 1 个道具的名字";
            await page.getByLabel(label, { exact: true }).waitFor();
            await reachable(page.getByLabel(label, { exact: true }), label);
          } else if (name === "edit-sound" || name === "edit-subtitles") {
            await stage("剪辑", "edit");
            const sound = name === "edit-sound";
            await page
              .locator(".monitor-tabs")
              .getByRole("button", { name: sound ? "声音" : "字幕", exact: true })
              .click();
            await page.locator(sound ? ".nx-sound" : ".nx-subs").waitFor();
            await reachable(
              sound
                ? page.getByRole("radio", { name: "平静", exact: true })
                : page.getByRole("radio", { name: /清楚白字/ }),
              sound ? "声音情绪选择" : "字幕样式选择",
            );
          } else if (name.startsWith("export-")) {
            await page.getByRole("button", { name: "导出成片", exact: true }).click();
            scopeSelector = '[role="dialog"][aria-label="导出成片"]';
            const dialog = page.getByRole("dialog", { name: "导出成片", exact: true });
            await dialog.waitFor();
            if (name === "export-cover") {
              await dialog.getByRole("button", { name: "改封面", exact: true }).click();
              await dialog.locator(".nx-cover-editor").waitFor();
              await reachable(
                dialog.getByRole("button", { name: "返回", exact: true }),
                "返回导出选项",
              );
            } else {
              await dialog.getByLabel("清晰度", { exact: true }).waitFor();
              if (name === "export-options") {
                const aspectChoice = dialog.getByRole("combobox", { name: "比例", exact: true });
                await aspectChoice.waitFor({ state: "visible" });
                assert.equal(await aspectChoice.isVisible(), true);
                assert.deepEqual(
                  await aspectChoice
                    .locator("option")
                    .evaluateAll((options) => options.map((option) => option.value)),
                  ["work", "other", "both"],
                );
                await reachable(aspectChoice, "导出比例选择");
              }
              if (name === "export-missing") {
                await dialog.getByText("按场看还没生成的镜头", { exact: true }).click();
                assert.ok((await dialog.locator(".missing li").count()) > 0);
                assert.match(await dialog.getByTestId("export-summary").innerText(), /没|未|0/);
              }
              await reachable(
                dialog.getByRole("button", { name: "关闭", exact: true }),
                "关闭导出",
              );
              // Check reachability only: never dispatch an export/provider call.
              await reachable(
                dialog.getByRole("button", { name: "检查成片", exact: true }),
                "导出主动作",
              );
            }
          } else if (name === "interrupted-work") {
            await page.getByText(/上次生成已中断|上次.*已标成已中断/).waitFor();
            await stage("分镜", "board");
            assert.equal(await page.locator(".grid .card").count(), 6);
            await page.waitForFunction(() => {
              const id = window.localStorage.getItem("aivora.film.activeId");
              const raw = window.localStorage.getItem(`aivora.film.v1.${id}`);
              return raw && JSON.parse(raw).shots[0].takes[0].status === "failed";
            });
            const saved = await page.evaluate(() => {
              const id = window.localStorage.getItem("aivora.film.activeId");
              return JSON.parse(window.localStorage.getItem(`aivora.film.v1.${id}`));
            });
            assert.equal(saved.shots[0].takes[0].status, "failed");
            assert.equal(saved.shots[0].takes[0].interruptedFrom, "running");
          }
          result.reached = true;
          result.scopeSelector = scopeSelector;
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise((resolve) =>
              window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
            );
          });
          result.geometry = await page.evaluate(probeProLayout, { scopeSelector });
          assert.deepEqual(
            result.geometry.issues,
            [],
            "Layout probe found inaccessible, covered or overflowing content",
          );
          assert.deepEqual(result.pageerrors, [], "Page raised an uncaught error");
          assert.deepEqual(result.blockedRequests, [], "App attempted external/API access");
          assert.deepEqual(
            await page.evaluate(() => window.__proLayoutCalls),
            [],
            "Audit dispatched a prohibited operation",
          );
          result.passed = true;
        } catch (error) {
          result.passed = false;
          result.error = error.message;
        } finally {
          if (result.reached && !result.geometry) {
            result.scopeSelector = scopeSelector;
            result.geometry = await page
              .evaluate(probeProLayout, { scopeSelector })
              .catch(() => null);
          }
          await page
            .screenshot({ path: path.join(config.out, result.screenshot) })
            .catch((error) => {
              result.passed = false;
              result.screenshotError = error.message;
            });
          report.results.push(result);
          console.log(`${result.passed ? "PASS" : "FAIL"} ${combination} ${name}`);
          await persist();
          await context.close();
        }
      }
    }
  return report.viewports.length * report.aspects.length * fullPageNames.length;
}
