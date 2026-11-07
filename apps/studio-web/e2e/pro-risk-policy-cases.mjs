import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { installRiskPolicyBridge, seedRiskPolicyProject } from "./pro-risk-policy-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
export const riskPolicyStates = [
  "risk-default",
  "risk-long",
  "risk-explicit",
  "risk-navigation",
  "policy-zero",
  "policy-conflict",
  "policy-unknown",
  "policy-session",
];
const mediaFacts = (film) =>
  film.shots.map((s) => ({
    id: s.id,
    poster: s.poster,
    stills: s.stills,
    takes: s.takes,
    selectedTakeId: s.selectedTakeId,
  }));
export async function runRiskPolicyCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
  const mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of riskPolicyStates) {
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
            reads: window.__proRiskPolicyAudit.reads,
            writes: window.__proRiskPolicyAudit.writes,
            pending: window.__proRiskPolicyAudit.pending.map((p) => ({ released: p.released })),
            forbidden: [
              ...window.__proRiskPolicyAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
            ],
          }));
        async function showPolicy() {
          await button("作品").click();
          await button("作品设置").click();
          await button("设置视频提交失败上限").click();
          scopeSelector = '.pro-root [role="dialog"][aria-label="视频提交失败保护"]';
          return page.getByRole("dialog", { name: "视频提交失败保护", exact: true });
        }
        async function showRisk() {
          await button("作品").click();
          await button("查看试片候选").click();
          scopeSelector = '.pro-root [role="dialog"][aria-label="试片候选审阅"]';
          return page.getByRole("dialog", { name: "试片候选审阅", exact: true });
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
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state: "clean", aspect })});(${installCreationBridge.toString()})(${JSON.stringify({ state })});(${installRiskPolicyBridge.toString()})(${JSON.stringify({ state })});`,
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
          assert.equal(before.shots.length, 6);
          assert(before.shots.every((s) => s.takes.length === 3));
          if (state.startsWith("risk-")) {
            let dialog = await showRisk();
            await dialog.getByRole("radio").first().waitFor();
            result.reached = true;
            assert.equal(
              await dialog.getByRole("radio").evaluateAll((rows) => rows.some((r) => r.checked)),
              false,
            );
            assert.equal(await button("在分镜查看").isDisabled(), true);
            await geometry("default-review");
            await dialog.getByRole("radio").first().check();
            const detail = dialog.getByRole("region", { name: "候选详情", exact: true });
            await detail.getByText("当前画面文字", { exact: true }).waitFor();
            if (state === "risk-long") {
              const long = detail.getByText(
                before.shots.find((s) => s.id === seed.shotId).picture,
                { exact: true },
              );
              assert.equal(await long.count(), 1);
              assert((await long.innerText()).length > 1000);
              const tail = detail.getByText(
                "人物身份、画面、动作、口型、对白完整性和实际听感仍待播放核对；文字线索不证明素材质量。",
                { exact: true },
              );
              await tail.scrollIntoViewIfNeeded();
              await geometry("long-text-tail");
            }
            if (state === "risk-explicit")
              await detail
                .getByText("显式选版记录：显式选版字段为空；本页不推断默认版本", { exact: true })
                .waitFor();
            else
              await detail
                .getByText(/显式选版记录：第 1 版 · 完成记录（文件与内容未核验）/)
                .waitFor();
            await reachable(button("在分镜查看"));
            await reachable(button("刷新候选"));
            await reachable(button("关闭"));
            await geometry("review-controls-reachable");
            if (state === "risk-navigation") {
              await button("在分镜查看").click();
              scopeSelector = ".pro-root";
              assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "board");
              assert.equal(await page.getByRole("dialog", { name: "试片候选审阅" }).count(), 0);
            } else {
              await button("刷新候选").click();
              dialog = page.getByRole("dialog", { name: "试片候选审阅" });
              assert.equal(
                await dialog.getByRole("radio").evaluateAll((rows) => rows.some((r) => r.checked)),
                false,
              );
              assert.equal(await button("在分镜查看").isDisabled(), true);
              await button("关闭").click();
            }
            assert.deepEqual((await calls()).reads, []);
            assert.deepEqual((await calls()).writes, []);
          } else {
            let dialog = await showPolicy();
            await dialog.getByText("尚未配置上限。", { exact: true }).waitFor();
            result.reached = true;
            assert.equal(await dialog.getByRole("textbox").inputValue(), "");
            await geometry("unconfigured-review");
            const desired = {
              "policy-zero": "0",
              "policy-conflict": "7",
              "policy-unknown": "3",
              "policy-session": "8",
            }[state];
            await dialog.getByRole("textbox").fill(desired);
            await reachable(button("保存上限"));
            await button("保存上限").click();
            if (state === "policy-conflict") {
              await dialog
                .getByText("设置已被修改，请核对已保存的值，再次提交你的上限。", { exact: true })
                .waitFor();
              assert.equal(await dialog.getByRole("textbox").inputValue(), "7");
              assert.equal((await calls()).writes.length, 1);
              await button("保存上限").click();
              await dialog.getByText("上限已保存。", { exact: true }).waitFor();
              assert.equal((await calls()).writes.length, 2);
              assert.equal((await calls()).writes[1].input.expected_revision, 1);
            } else if (state === "policy-unknown") {
              await dialog
                .getByText("保存结果尚未确认，请重新核对。不要重复提交。", { exact: true })
                .waitFor();
              assert.equal(await button("保存上限").count(), 0);
              assert.equal((await calls()).reads.length, 1);
              await geometry("unknown-write-readonly");
              await button("重新核对").click();
              await dialog.getByText("已保存的上限：3 次。", { exact: true }).waitFor();
              assert.equal((await calls()).writes.length, 1);
            } else if (state === "policy-session") {
              await page.waitForFunction(() => window.__proRiskPolicyAudit.pending.length === 1);
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
              await page.evaluate(() => window.__proRiskPolicyAudit.release(0));
              dialog = await showPolicy();
              await dialog.getByText("尚未配置上限。", { exact: true }).waitFor();
              assert.equal(await dialog.getByText("上限已保存。", { exact: true }).count(), 0);
              assert.equal(await dialog.getByRole("textbox").inputValue(), "");
              assert.equal((await calls()).writes.length, 1);
              assert.equal((await calls()).reads.at(-1).projectId, `prj_${"b".repeat(32)}`);
            } else await dialog.getByText("上限已保存。", { exact: true }).waitFor();
            if (state !== "policy-session") {
              assert.equal((await calls()).writes[0].projectId, before.backendProjectId);
              assert.deepEqual((await calls()).writes[0].input, {
                expected_revision: 0,
                failure_limit: Number(desired),
              });
            }
            await reachable(button("重新核对"));
            await reachable(button("关闭"));
            await geometry("policy-controls-reachable");
            await button("关闭").click();
          }
          assert.deepEqual(mediaFacts(await record(seed.projectId)), mediaFacts(before));
          assert.deepEqual((await record(seed.projectId)).audioClips, before.audioClips);
          assert.deepEqual(mediaFacts(await record(seed.otherId)), mediaFacts(otherBefore));
          assert.deepEqual((await calls()).forbidden, []);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = await calls();
          result.passed = true;
        } catch (error) {
          const line = Number(
            error.stack?.match(/[\\/]pro-risk-policy-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
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
  return riskPolicyStates.length * report.viewports.length * report.aspects.length;
}
