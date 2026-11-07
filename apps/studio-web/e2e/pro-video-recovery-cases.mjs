import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import { waitAssemblyIdle } from "./pro-assembly-assertions.mjs";
import {
  installVideoRecoveryBridge,
  seedVideoRecoveryProject,
} from "./pro-video-recovery-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
export const videoRecoveryStates = [
  "recovery-success",
  "recovery-unknown",
  "recovery-late",
  "recovery-unavailable",
];
export async function runVideoRecoveryCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
  const mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of videoRecoveryStates) {
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
          screenshot: path.join(combination, "recovery.png"),
          pageerrors: [],
          blockedRequests: [],
        };
        let scopeSelector = '.pro-root [role="dialog"][aria-label="找回原视频素材"]';
        const button = (name) => page.getByRole("button", { name, exact: true });
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
            histories: window.__proVideoRecoveryAudit.histories,
            lists: window.__proVideoRecoveryAudit.lists,
            recovers: window.__proVideoRecoveryAudit.recovers,
            saves: window.__proVideoRecoveryAudit.saves,
            writes: window.__proVideoRecoveryAudit.writes,
            assembly: window.__assemblyAudit.calls,
            forbidden: [
              ...window.__proVideoRecoveryAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
              ...window.__assemblyAudit.forbidden,
            ],
          }));
        async function show() {
          await button("作品").click();
          await button("作品设置").click();
          await button("查看可核对的视频记录").click();
          return page.getByRole("dialog", { name: "找回原视频素材", exact: true });
        }
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
            "Actual recovery controls retain all original geometry thresholds",
          );
        }
        async function reachable(control) {
          await control.scrollIntoViewIfNeeded();
          await frame();
          const valid = await control.evaluate((element) => {
            const r = element.getBoundingClientRect();
            let left = 0,
              top = 0,
              right = window.innerWidth,
              bottom = window.innerHeight;
            for (let p = element.parentElement; p; p = p.parentElement) {
              const css = window.getComputedStyle(p),
                box = p.getBoundingClientRect();
              if (/hidden|clip|auto|scroll/.test(css.overflowX)) {
                left = Math.max(left, box.left);
                right = Math.min(right, box.right);
              }
              if (/hidden|clip|auto|scroll/.test(css.overflowY)) {
                top = Math.max(top, box.top);
                bottom = Math.min(bottom, box.bottom);
              }
            }
            return (
              r.width > 2 &&
              r.height > 2 &&
              r.left >= left - 1 &&
              r.right <= right + 1 &&
              r.top >= top - 1 &&
              r.bottom <= bottom + 1
            );
          });
          assert.equal(valid, true);
          await control.click({ trial: true });
        }
        async function other(seed) {
          await button("作品").click();
          await button("合成找回第2集").click();
          await page
            .locator(".topbar .ep")
            .filter({ hasText: /^\/\s*合成找回第2集$/ })
            .waitFor();
          await frame();
          await waitAssemblyIdle(page, seed.otherId);
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
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state: "clean", aspect })});(${installCreationBridge.toString()})(${JSON.stringify({ state })});(${installAssemblyAuditBridge.toString()})({mode:"complete"});(${installVideoRecoveryBridge.toString()})(${JSON.stringify({ state })});`,
        });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          const seed = await page.evaluate(seedVideoRecoveryProject, { state });
          result.seed = seed;
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(
            (id) => window.__proVideoRecoveryAudit.writes.some((w) => w.projectId === id),
            seed.projectId,
          );
          await waitAssemblyIdle(page, seed.projectId);
          const before = await record(seed.projectId);
          assert.equal(before.shots.length, 6);
          assert(before.shots.every((s) => s.takes.length === 3));
          let audit = await calls();
          assert.deepEqual(audit.lists, []);
          assert.deepEqual(audit.recovers, []);
          assert.deepEqual(audit.saves, []);
          let dialog = await show();
          if (state === "recovery-unavailable") {
            await dialog
              .getByText("当前环境不支持找回原视频素材，请使用支持此功能的桌面版。", {
                exact: true,
              })
              .waitFor();
            result.reached = true;
            await geometry("legacy-no-capability");
            await reachable(dialog.getByRole("button", { name: "关闭", exact: true }));
            await dialog.getByRole("button", { name: "关闭", exact: true }).click();
            // Controlled native capability becomes available; no React state or record is changed.
            await page.evaluate(() => window.__proVideoRecoveryAudit.exposeNative());
            await other(seed);
            dialog = await show();
            await dialog
              .getByText("本集尚未关联可核对的作品，不能读取原任务。", { exact: true })
              .waitFor();
            await geometry("unbound-no-dispatch");
            audit = await calls();
            assert.deepEqual(audit.lists, []);
            assert.deepEqual(audit.recovers, []);
            assert.deepEqual(audit.saves, []);
          } else {
            await dialog.getByText("原素材尚未确认。", { exact: true }).waitFor();
            result.reached = true;
            assert.equal((await calls()).lists.length, 1);
            assert.deepEqual((await calls()).recovers, []);
            assert.deepEqual((await calls()).saves, []);
            await geometry("listed-no-auto-recovery");
            await reachable(dialog.getByRole("button", { name: "找回原素材", exact: true }));
            await dialog.getByRole("button", { name: "找回原素材", exact: true }).click();
            if (state === "recovery-success") {
              await dialog.getByText("原素材已找回", { exact: true }).waitFor();
              assert.equal(await dialog.getByText("c".repeat(64), { exact: true }).count(), 1);
              assert.equal((await calls()).saves.length, 0);
              await geometry("raw-found-not-applied");
              await reachable(dialog.getByRole("button", { name: "另存原素材", exact: true }));
              await dialog.getByRole("button", { name: "另存原素材", exact: true }).click();
              await dialog.getByText("已取消另存，当前镜头没有修改。", { exact: true }).waitFor();
              assert.equal(
                await dialog
                  .getByText("原素材已另存。当前镜头和版本没有替换。", { exact: true })
                  .count(),
                0,
              );
              await dialog.getByRole("button", { name: "另存原素材", exact: true }).click();
              await dialog
                .getByText("原素材已另存。当前镜头和版本没有替换。", { exact: true })
                .waitFor();
              await geometry("explicit-saved-original");
              audit = await calls();
              assert.equal(audit.recovers.length, 1);
              assert.equal(audit.saves.length, 2);
              assert.equal(audit.lists.length, 1);
            } else if (state === "recovery-unknown") {
              await dialog
                .getByText("原任务仍未确认完成，可以稍后手动核对。", { exact: true })
                .waitFor();
              assert.equal((await calls()).recovers.length, 1);
              await dialog.getByRole("button", { name: "找回原素材", exact: true }).click();
              await dialog
                .getByText("原素材的找回结果尚未确认，请重新读取列表后核对，不要重新提交生成。", {
                  exact: true,
                })
                .waitFor();
              assert.equal(
                await dialog.getByRole("button", { name: "找回原素材", exact: true }).isDisabled(),
                true,
              );
              await geometry("recovery-unknown-no-repeat");
              await reachable(dialog.getByRole("button", { name: "重新读取列表", exact: true }));
              await dialog.getByRole("button", { name: "重新读取列表", exact: true }).click();
              await dialog.getByText("原素材已找回", { exact: true }).waitFor();
              assert.equal((await calls()).recovers.length, 2);
              await dialog.getByRole("button", { name: "另存原素材", exact: true }).click();
              await dialog
                .getByText("保存结果尚未确认，请先核对已选择的保存位置，不要重复另存。", {
                  exact: true,
                })
                .waitFor();
              assert.equal(
                await dialog.getByRole("button", { name: "另存原素材", exact: true }).isDisabled(),
                true,
              );
              assert.equal(
                await dialog
                  .getByText("原素材已另存。当前镜头和版本没有替换。", { exact: true })
                  .count(),
                0,
              );
              await geometry("save-unknown-no-repeat");
              await dialog.getByRole("button", { name: "重新读取列表", exact: true }).click();
              await dialog.getByText("原素材已找回", { exact: true }).waitFor();
              assert.equal(
                await dialog.getByRole("button", { name: "另存原素材", exact: true }).isEnabled(),
                true,
              );
              audit = await calls();
              assert.equal(audit.recovers.length, 2);
              assert.equal(audit.saves.length, 1);
              assert.equal(audit.lists.length, 3);
            } else {
              await page.waitForFunction(() => window.__proVideoRecoveryAudit.pending.length === 1);
              assert.equal(
                await dialog.getByRole("button", { name: "找回原素材", exact: true }).isDisabled(),
                true,
              );
              await geometry("pending-real-request");
              await dialog.getByRole("button", { name: "关闭", exact: true }).click();
              await other(seed);
              const otherRaw = await record(seed.otherId),
                writes = (await calls()).writes.filter((w) => w.projectId === seed.otherId).length;
              await page.evaluate(() => window.__proVideoRecoveryAudit.release(0));
              await frame();
              assert.deepEqual(await record(seed.otherId), otherRaw);
              assert.equal(
                (await calls()).writes.filter((w) => w.projectId === seed.otherId).length,
                writes,
              );
              dialog = await show();
              await dialog
                .getByText("没有读到可核对的记录。这不代表所有视频都已生成。", { exact: true })
                .waitFor();
              assert.equal(await dialog.getByText("原素材已找回", { exact: true }).count(), 0);
              await geometry("old-reply-new-work");
              audit = await calls();
              assert.equal(audit.recovers.length, 1);
              assert.equal(audit.saves.length, 0);
              assert.deepEqual(
                audit.lists.map((call) => call.projectId),
                [seed.backendProjectId, seed.otherBackendProjectId],
              );
            }
          }
          assert.deepEqual(await record(seed.projectId), before);
          audit = await calls();
          assert.deepEqual(
            audit.histories.map((call) => call.projectId),
            [
              seed.projectId,
              ...(["recovery-late", "recovery-unavailable"].includes(state) ? [seed.otherId] : []),
            ],
          );
          assert.deepEqual(audit.assembly, []);
          assert.deepEqual(audit.forbidden, []);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          for (const call of [...audit.recovers, ...audit.saves]) {
            assert.equal(call.projectId, seed.backendProjectId);
            assert.equal(call.attemptId, "a".repeat(32));
          }
          await reachable(dialog.getByRole("button", { name: "关闭", exact: true }));
          result.calls = audit;
          result.passed = true;
        } catch (error) {
          const line = Number(
            error.stack?.match(/[\\/]pro-video-recovery-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
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
  return videoRecoveryStates.length * report.viewports.length * report.aspects.length;
}
