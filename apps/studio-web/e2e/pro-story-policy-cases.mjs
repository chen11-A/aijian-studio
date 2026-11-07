import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { seedRiskPolicyProject } from "./pro-risk-policy-fixture.mjs";
import { installStoryPolicyBridge } from "./pro-story-policy-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
export const storyPolicyStates = [
  "story-policy-values",
  "story-policy-conflict",
  "story-policy-unknown",
  "story-policy-session",
];
const mediaFacts = (film) =>
  film.shots.map((s) => ({
    id: s.id,
    poster: s.poster,
    stills: s.stills,
    takes: s.takes,
    selectedTakeId: s.selectedTakeId,
  }));
export async function runStoryPolicyCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
  const mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of storyPolicyStates) {
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
          screenshot: path.join(combination, "review.png"),
          pageerrors: [],
          blockedRequests: [],
        };
        const frame = () =>
          page.evaluate(
            () =>
              new Promise((resolve) =>
                window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
              ),
          );
        let scopeSelector = ".pro-root";
        async function geometry(label) {
          await frame();
          const value = await page.evaluate(probeProLayout, { scopeSelector });
          result.geometry = value;
          (result.checkpoints ??= []).push({ label, geometry: value });
          const image = path.join(combination, `${label}.png`);
          await page.screenshot({ path: path.join(config.out, image) });
          (result.checkpointScreenshots ??= []).push(image);
          assert.deepEqual(
            value.issues,
            [],
            "Actual review controls retain original geometry thresholds",
          );
        }
        async function reachable(control) {
          await control.scrollIntoViewIfNeeded();
          await frame();
          const complete = await control.evaluate((element) => {
            const r = element.getBoundingClientRect();
            let l = 0,
              t = 0,
              right = window.innerWidth,
              bottom = window.innerHeight;
            for (let p = element.parentElement; p; p = p.parentElement) {
              const css = getComputedStyle(p),
                b = p.getBoundingClientRect();
              if (/hidden|clip|auto|scroll/.test(css.overflowX)) {
                l = Math.max(l, b.left);
                right = Math.min(right, b.right);
              }
              if (/hidden|clip|auto|scroll/.test(css.overflowY)) {
                t = Math.max(t, b.top);
                bottom = Math.min(bottom, b.bottom);
              }
            }
            return (
              r.width > 2 &&
              r.height > 2 &&
              r.left >= l - 1 &&
              r.right <= right + 1 &&
              r.top >= t - 1 &&
              r.bottom <= bottom + 1
            );
          });
          assert.equal(complete, true, "Review control must be fully scroll reachable");
          await control.click({ trial: true });
        }
        const button = (name) => page.getByRole("button", { name, exact: true });
        const record = (id) =>
          page.evaluate((value) => window.__proCreationAudit.record(value), id);
        const calls = () =>
          page.evaluate(() => ({
            reads: window.__storyPolicyAudit.reads,
            videoReads: window.__storyPolicyAudit.videoReads,
            filmWrites: window.__storyPolicyAudit.filmWrites,
            writes: window.__storyPolicyAudit.writes,
            pending: window.__storyPolicyAudit.pending.map((p) => ({ released: p.released })),
            forbidden: [
              ...window.__storyPolicyAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
            ],
          }));
        async function showPolicy() {
          await button("作品").click();
          await button("作品设置").click();
          await button("设置创作流程失败上限").click();
          scopeSelector = '.pro-root [role="dialog"][aria-label="创作流程失败保护"]';
          return page.getByRole("dialog", { name: "创作流程失败保护", exact: true });
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
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state: "clean", aspect })});(${installCreationBridge.toString()})(${JSON.stringify({ state })});(${installStoryPolicyBridge.toString()})(${JSON.stringify({ state })});`,
        });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          const seed = await page.evaluate(seedRiskPolicyProject, { state });
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(
            (id) => window.__proCreationAudit.record(id)?.characters?.[0]?.gender !== undefined,
            seed.projectId,
          );
          const before = await record(seed.projectId),
            otherBefore = await record(seed.otherId);
          let otherBaseline = otherBefore;
          let writeBaseline = (await calls()).filmWrites.length;
          assert.equal(before.shots.length, 6);
          assert(before.shots.every((s) => s.takes.length === 3));
          assert.deepEqual((await calls()).reads, []);
          assert.deepEqual((await calls()).writes, []);
          let dialog = await showPolicy();
          await dialog.getByText("尚未配置创作流程上限。", { exact: true }).waitFor();
          result.reached = true;
          assert.equal(await dialog.getByRole("textbox").inputValue(), "");
          await geometry("unconfigured-review");
          const save = () => button("保存创作流程上限");
          const refresh = () => button("重新核对创作流程上限");
          if (state === "story-policy-values") {
            for (const value of ["", "-1", "1.5", "1e2", "1001"]) {
              await dialog.getByRole("textbox").fill(value);
              await save().click();
              await dialog.getByText("请输入0到1000的整数。", { exact: true }).waitFor();
              assert.equal((await calls()).writes.length, 0);
            }
            for (const value of ["0", "1000"]) {
              await dialog.getByRole("textbox").fill(value);
              await save().click();
              await dialog
                .getByText(`已保存的创作流程上限：${value} 次。`, { exact: true })
                .waitFor();
            }
            assert.deepEqual(
              (await calls()).writes.map((c) => c.input),
              [
                { expected_revision: 0, failure_limit: 0 },
                { expected_revision: 1, failure_limit: 1000 },
              ],
            );
            await button("关闭").click();
            await button("作品").click();
            await button("作品设置").click();
            await button("设置视频提交失败上限").click();
            await page.getByText("已保存的上限：77 次。", { exact: true }).waitFor();
            await button("关闭").click();
            dialog = await showPolicy();
            await dialog.getByText("已保存的创作流程上限：1000 次。", { exact: true }).waitFor();
            assert.equal(await dialog.getByRole("textbox").inputValue(), "");
          } else {
            const desired = state === "story-policy-conflict" ? "7" : "3";
            await dialog.getByRole("textbox").fill(desired);
            await save().click();
            if (state === "story-policy-conflict") {
              await dialog
                .getByText("设置已被修改，请核对已保存的值，再次提交你的创作流程上限。", {
                  exact: true,
                })
                .waitFor();
              assert.equal(await dialog.getByRole("textbox").inputValue(), "7");
              assert.equal((await calls()).writes.length, 1);
              await save().click();
              await dialog.getByText("已保存的创作流程上限：7 次。", { exact: true }).waitFor();
              assert.deepEqual(
                (await calls()).writes.map((c) => c.input),
                [
                  { expected_revision: 0, failure_limit: 7 },
                  { expected_revision: 1, failure_limit: 7 },
                ],
              );
            } else if (state === "story-policy-unknown") {
              await dialog
                .getByText("创作流程上限的保存结果尚未确认，请重新核对。不要重复提交。", {
                  exact: true,
                })
                .waitFor();
              assert.equal(await save().count(), 0);
              await refresh().click();
              await dialog
                .getByText("创作流程上限暂时没有读到，请重新核对。", { exact: true })
                .waitFor();
              assert.equal(await save().count(), 0);
              assert.equal((await calls()).writes.length, 1);
              await refresh().click();
              await dialog.getByText("已保存的创作流程上限：3 次。", { exact: true }).waitFor();
              assert.equal((await calls()).writes.length, 1);
              assert.equal((await calls()).reads.length, 3);
            } else {
              await page.waitForFunction(() => window.__storyPolicyAudit.pending.length === 1);
              assert.equal(await button("正在保存…").isDisabled(), true);
              await geometry("pending-write");
              await button("关闭").click();
              scopeSelector = ".pro-root";
              await button("作品").click();
              await button("合成配置第2集").click();
              await page
                .locator(".topbar .ep")
                .filter({ hasText: /^\/\s*合成配置第2集$/ })
                .waitFor();
              await page.waitForFunction(
                (id) => window.__proCreationAudit.record(id)?.characters?.[0]?.gender !== undefined,
                seed.otherId,
              );
              otherBaseline = await record(seed.otherId);
              writeBaseline = (await calls()).filmWrites.length;
              await page.evaluate(() => window.__storyPolicyAudit.release(0));
              dialog = await showPolicy();
              await dialog.getByText("尚未配置创作流程上限。", { exact: true }).waitFor();
              assert.equal((await calls()).reads.at(-1).projectId, `prj_${"b".repeat(32)}`);
              assert.equal(
                await dialog.getByText("创作流程上限已保存。", { exact: true }).count(),
                0,
              );
              assert.equal(await dialog.getByRole("textbox").inputValue(), "");
              await button("关闭").click();
              await page.evaluate(() => {
                window.__storyPolicyAudit.heldReads = true;
              });
              dialog = await showPolicy();
              await page.waitForFunction(() => window.__storyPolicyAudit.pending.length === 2);
              await page.evaluate(() =>
                window.dispatchEvent(new window.Event("aivora-grok-changed")),
              );
              await dialog.waitFor({ state: "hidden" });
              await page.evaluate(() => {
                window.__storyPolicyAudit.heldReads = false;
                window.__storyPolicyAudit.release(1);
              });
              dialog = await showPolicy();
              await dialog.getByText("尚未配置创作流程上限。", { exact: true }).waitFor();
              assert.equal((await calls()).writes.length, 1);
            }
          }
          await reachable(refresh());
          await reachable(button("关闭"));
          await geometry("policy-controls-reachable");
          await button("关闭").click();
          assert.deepEqual(mediaFacts(await record(seed.projectId)), mediaFacts(before));
          assert.deepEqual((await record(seed.projectId)).audioClips, before.audioClips);
          assert.deepEqual(mediaFacts(await record(seed.otherId)), mediaFacts(otherBefore));
          assert.deepEqual((await calls()).forbidden, []);
          assert((await calls()).writes.every((c) => c.projectId === before.backendProjectId));
          assert.equal((await calls()).videoReads.length, state === "story-policy-values" ? 1 : 0);
          assert.deepEqual(await record(seed.projectId), before);
          assert.deepEqual(await record(seed.otherId), otherBaseline);
          assert.equal((await calls()).filmWrites.length, writeBaseline);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = await calls();
          result.passed = true;
        } catch (error) {
          const line = Number(
            error.stack?.match(/[\\/]pro-story-policy-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
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
  return storyPolicyStates.length * report.viewports.length * report.aspects.length;
}
