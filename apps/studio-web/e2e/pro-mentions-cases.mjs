import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { installMentionsBridge, seedMentionsProject } from "./pro-mentions-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
export const mentionStates = [
  "refs-menu-project",
  "refs-director-inverse",
  "refs-invalid",
  "refs-stale",
];
const mediaFields = (film) =>
  film.shots.map((s) => ({
    id: s.id,
    poster: s.poster,
    stills: s.stills,
    takes: s.takes,
    selectedTakeId: s.selectedTakeId,
  }));
export async function runMentionCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
  const mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of mentionStates) {
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
          screenshot: path.join(combination, "references.png"),
          pageerrors: [],
          blockedRequests: [],
        };
        const calls = () =>
          page.evaluate(() => ({
            requests: window.__proMentionsAudit.requests,
            forbidden: [
              ...window.__proMentionsAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
            ],
            legacyAssemblies: window.__proCreationAudit.assemblies,
            writes: window.__proMentionsAudit.writes.length,
          }));
        const saved = () => page.evaluate(() => window.__proCreationAudit.saved());
        const nav = (text) =>
          page
            .getByRole("navigation", { name: "创作阶段" })
            .getByRole("button", { name: new RegExp(text) });
        const composer = () => page.getByLabel("跟助手说", { exact: true });
        const send = () => page.getByRole("button", { name: "发送", exact: true });
        const card = () => page.getByRole("region", { name: "助手的建议" });
        const frame = () =>
          page.evaluate(
            () =>
              new Promise((resolve) =>
                window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
              ),
          );
        async function geometry(label) {
          await frame();
          const value = await page.evaluate(probeProLayout);
          result.geometry = value;
          (result.checkpoints ??= []).push({ label, geometry: value });
          const image = path.join(combination, `${label}.png`);
          await page.screenshot({ path: path.join(config.out, image) });
          (result.checkpointScreenshots ??= []).push(image);
          assert.deepEqual(
            value.issues,
            [],
            "Actual Pro reference controls retain the original geometry checks",
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
          assert.equal(complete, true, "Reference control must scroll fully into view");
          await control.click({ trial: true });
        }
        async function expectRequest(userRequest, scope) {
          await page.evaluate((value) => window.__proMentionsAudit.expect(value), {
            userRequest,
            scope,
          });
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
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state: "clean", aspect })});(${installCreationBridge.toString()})(${JSON.stringify({ state })});(${installMentionsBridge.toString()})(${JSON.stringify({ state })});`,
        });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          const seed = await page.evaluate(seedMentionsProject, { state });
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(
            () =>
              document.querySelector('button[aria-label="账号"]')?.title === "Grok 会员 · 已连接",
          );
          await nav("角色与场景").click();
          assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "cast");
          await page.waitForFunction(() => window.__proMentionsAudit.writes.length > 0);
          const before = await saved();
          assert.equal(before.shots.length, 6);
          assert(before.shots.slice(2).every((s) => s.takes.length === 3));
          if (state === "refs-menu-project") {
            await page.getByLabel("正在和：", { exact: true }).selectOption("art");
            await page.getByRole("button", { name: "提到人物、场景或镜头", exact: true }).click();
            await page
              .getByRole("menu", { name: "提到谁", exact: true })
              .getByRole("menuitem", { name: seed.personToken, exact: true })
              .click();
            await page.getByRole("button", { name: "提到人物、场景或镜头", exact: true }).click();
            await page
              .getByRole("menu", { name: "提到谁", exact: true })
              .getByRole("menuitem", { name: seed.placeToken, exact: true })
              .click();
            const asked = `${seed.personToken} ${seed.placeToken} `;
            assert.equal(await composer().inputValue(), asked);
            await expectRequest(asked, "project");
            await send().click();
            await card().getByText("全项目 · 画风说明", { exact: true }).waitFor();
            assert.equal((await calls()).requests.length, 1);
            assert.deepEqual(
              (await calls()).requests[0].context.references.map((r) => r.name),
              [seed.person, seed.place],
            );
            assert.equal(
              (await calls()).requests[0].context.modificationScope,
              "全项目；引用仅作参考，不缩小写入范围",
            );
            assert.equal((await saved()).styleZh, before.styleZh);
            assert.deepEqual(mediaFields(await saved()), mediaFields(before));
            assert.equal(
              await card().getByRole("button", { name: "确认修改", exact: true }).count(),
              1,
            );
            result.reached = true;
            await geometry("project-review-unscrolled");
            await reachable(card().getByRole("button", { name: "确认修改", exact: true }));
            await reachable(card().getByRole("button", { name: "不要", exact: true }));
            await geometry("project-review-reachable");
            await card().getByRole("button", { name: "不要", exact: true }).click();
            assert.equal((await saved()).styleZh, before.styleZh);
          } else if (state === "refs-director-inverse") {
            await nav("分镜").click();
            await page.getByRole("button", { name: "AI 助手", exact: true }).click();
            await page.getByLabel("正在和：", { exact: true }).selectOption("director");
            const asked = `${seed.personToken} @镜头1 保持原文，不增加剧情。`;
            await composer().fill(asked);
            await expectRequest(asked, "scene");
            await send().click();
            await card()
              .getByText(/镜头顺序/, { exact: false })
              .first()
              .waitFor();
            assert.equal((await saved()).shots[0].id, seed.firstShotId);
            assert.deepEqual(mediaFields(await saved()), mediaFields(before));
            const actual = (await calls()).requests;
            assert.deepEqual(
              actual.map((r) => r.agent),
              ["director", "performance"],
            );
            assert(
              actual.every(
                (r) => r.context.userRequest === asked && r.context.taskScope === "scene",
              ),
            );
            assert.equal(actual[0].context.references[1].no, 1);
            result.reached = true;
            await geometry("director-review-unscrolled");
            await reachable(card().getByRole("button", { name: "确认修改", exact: true }));
            await card().getByRole("button", { name: "确认修改", exact: true }).click();
            await card().getByRole("button", { name: "撤销", exact: true }).waitFor();
            await page.waitForFunction(
              (id) => window.__proCreationAudit.saved().shots[0].id !== id,
              seed.firstShotId,
            );
            const applied = await saved();
            assert.deepEqual(
              mediaFields(applied).filter((s) => s.id !== applied.shots[0].id),
              mediaFields(before).slice(2),
            );
            await geometry("director-applied-unscrolled");
            await reachable(card().getByRole("button", { name: "撤销", exact: true }));
            await card().getByRole("button", { name: "撤销", exact: true }).click();
            await page.waitForFunction(
              (id) => window.__proCreationAudit.saved().shots[0].id === id,
              seed.firstShotId,
            );
            assert.deepEqual(mediaFields(await saved()), mediaFields(before));
            assert.deepEqual(
              (await calls()).requests.map((r) => r.agent),
              ["director", "performance"],
            );
            await geometry("director-inversed");
          } else if (state === "refs-invalid") {
            await page.getByLabel("正在和：", { exact: true }).selectOption("art");
            await page.getByRole("button", { name: "提到人物、场景或镜头", exact: true }).click();
            const duplicate = page
              .getByRole("menu", { name: "提到谁", exact: true })
              .getByRole("menuitem", {
                name: `${seed.personToken}（重名，暂不能引用）`,
                exact: true,
              });
            assert.equal(await duplicate.isDisabled(), true);
            await page.getByRole("button", { name: "提到人物、场景或镜头", exact: true }).click();
            for (const [asked, text] of [
              [seed.personToken, "引用有重名或重复镜号，请先核对，暂未发送。"],
              ["@不存在的参考对象", "引用没有对上当前作品和场次，请从 @ 菜单重新选择。"],
              ['@"尚未写完', "引用写法还没完整，请从 @ 菜单重新选择。"],
            ]) {
              await composer().fill(asked);
              await send().click();
              await page.locator(".status-note").filter({ hasText: text }).waitFor();
              assert.equal(await composer().inputValue(), asked);
              assert.equal((await calls()).requests.length, 0);
            }
            result.reached = true;
            await geometry("invalid-draft-retained");
            assert.equal((await saved()).styleZh, before.styleZh);
            assert.deepEqual(mediaFields(await saved()), mediaFields(before));
          } else {
            await page.getByLabel("正在和：", { exact: true }).selectOption("art");
            const asked = `${seed.personToken} 请调整全作品画风。`;
            await composer().fill(asked);
            await expectRequest(asked, "project");
            await send().click();
            await page.waitForFunction(() => window.__proMentionsAudit.pending.length === 1);
            const next = "下一条未发送的新稿，不能被晚回包清掉。";
            await composer().fill(next);
            await nav("剧本").click();
            assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "script");
            await nav("角色与场景").click();
            assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "cast");
            await page.getByLabel("正在和：", { exact: true }).selectOption("art");
            assert.equal(await composer().inputValue(), next);
            await page.getByLabel("人物名字", { exact: true }).fill(`${seed.person}已改名`);
            await page.evaluate(() => window.__proMentionsAudit.release(0));
            // This observes the synthetic transport return, not the host's completion.
            // The real follow-up request/card below proves the composer can continue.
            await page.waitForFunction(
              () => window.__proMentionsAudit.pending[0]?.delivered === true,
            );
            await send().waitFor({ state: "visible" });
            assert.equal(await send().isEnabled(), true);
            await send().click({ trial: true });
            assert.equal(await composer().inputValue(), next);
            assert.equal(await card().count(), 0);
            assert.equal((await calls()).requests.length, 1);
            assert.equal((await saved()).styleZh, before.styleZh);
            assert.deepEqual(mediaFields(await saved()), mediaFields(before));
            result.reached = true;
            await geometry("stale-reply-next-draft");
            // A fresh, explicit request gets a new capture; it cannot resurrect the old name.
            await page.evaluate(() => {
              window.__proMentionsAudit.hold = false;
            });
            const fresh = `@${seed.person}已改名 请调整全作品画风。`;
            await composer().fill(fresh);
            await expectRequest(fresh, "project");
            await send().click();
            await card().getByText("全项目 · 画风说明", { exact: true }).waitFor();
            await page.getByLabel("人物名字", { exact: true }).fill(`${seed.person}再次改名`);
            await reachable(card().getByRole("button", { name: "确认修改", exact: true }));
            await card().getByRole("button", { name: "确认修改", exact: true }).click();
            await page
              .locator(".status-note")
              .filter({ hasText: "引用内容或当前范围已变化，请重新检查后再发送。" })
              .waitFor();
            assert.equal((await saved()).styleZh, before.styleZh);
            assert.equal(
              await page.getByLabel("画风说明", { exact: true }).inputValue(),
              before.styleZh,
            );
            assert.deepEqual(mediaFields(await saved()), mediaFields(before));
            assert.equal((await calls()).requests.length, 2);
            assert.equal((await calls()).requests[0].context.userRequest, asked);
            assert.equal((await calls()).requests[1].context.userRequest, fresh);
            await geometry("stale-pending-confirmation");
          }
          const actual = await calls();
          assert.deepEqual(actual.forbidden, []);
          assert.deepEqual(actual.legacyAssemblies, []);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = actual;
          result.passed = true;
        } catch (error) {
          const line = Number(
            error.stack?.match(/[\\/]pro-mentions-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
          );
          result.checkLine = Number.isSafeInteger(line) && line > 0 && line <= 100000 ? line : null;
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
  return mentionStates.length * report.viewports.length * report.aspects.length;
}
