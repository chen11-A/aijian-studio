import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge } from "./pro-creation-fixture.mjs";
import { installAssemblyAuditBridge } from "./pro-assembly-fixture.mjs";
import { waitAssemblyIdle, assertAssemblyRequests } from "./pro-assembly-assertions.mjs";
import { installActualTrialBridge, seedActualTrialProject } from "./pro-actual-trial-fixture.mjs";
import { measureEvidenceControl } from "./pro-evidence-legacy-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
export const actualTrialStates = [
  "trial-needs-changes",
  "trial-accepted-checkpoint",
  "trial-unknown-global",
  "trial-stale-source",
];
const onlyDecisionAppended = (after, before) => {
  assert.equal(after.riskTrialDecisions?.length, (before.riskTrialDecisions?.length ?? 0) + 1);
  assert.deepEqual(
    after.riskTrialDecisions.slice(0, before.riskTrialDecisions?.length ?? 0),
    before.riskTrialDecisions ?? [],
  );
  assert.deepEqual(after, {
    ...before,
    savedAt: after.savedAt,
    riskTrialDecisions: after.riskTrialDecisions,
  });
};
const mediaOf = (film) => ({
  shots: film.shots.map((shot) => ({
    id: shot.id,
    poster: shot.poster,
    stills: shot.stills,
    takes: shot.takes,
  })),
  audioClips: film.audioClips,
});
export async function runActualTrialCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href,
    mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of actualTrialStates) {
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
          screenshot: path.join(combination, "trial.png"),
          pageerrors: [],
          blockedRequests: [],
        };
        let scopeSelector = '.pro-root [role="dialog"][aria-label="实际版本试片审核"]';
        const button = (name) => page.getByRole("button", { name, exact: true }),
          nav = (name) =>
            page
              .getByRole("navigation", { name: "创作阶段" })
              .getByRole("button", { name: new RegExp(name) }),
          frame = () =>
            page.evaluate(
              () =>
                new Promise((resolve) =>
                  window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
                ),
            );
        const raw = (id) => page.evaluate((id) => window.__proCreationAudit.record(id), id);
        const audit = () =>
          page.evaluate(() => ({
            prepares: window.__actualTrialAudit.prepares,
            media: window.__actualTrialAudit.media,
            records: window.__actualTrialAudit.records,
            checks: window.__actualTrialAudit.checks,
            captures: window.__actualTrialAudit.captures,
            writes: window.__actualTrialAudit.writes,
            assembly: window.__assemblyAudit.calls,
            cancels: window.__assemblyAudit.cancels,
            forbidden: [
              ...window.__actualTrialAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
              ...window.__assemblyAudit.forbidden,
            ],
          }));
        async function reachable(control) {
          await control.scrollIntoViewIfNeeded();
          await frame();
          assert.equal((await control.evaluate(measureEvidenceControl)).complete, true);
          await control.click({ trial: true });
        }
        async function geometry(label) {
          await frame();
          const geometry = await page.evaluate(probeProLayout, { scopeSelector });
          result.geometry = geometry;
          (result.checkpoints ??= []).push({ label, geometry });
          const png = path.join(combination, `${label}.png`);
          await page.screenshot({ path: path.join(config.out, png) });
          (result.checkpointScreenshots ??= []).push(png);
          assert.deepEqual(geometry.issues, []);
        }
        async function show() {
          await button("审核实际版本试片").click();
          return page.getByRole("dialog", { name: "实际版本试片审核", exact: true });
        }
        async function loaded(dialog) {
          await dialog.getByText("实际素材时长：2.25 秒", { exact: true }).waitFor();
          await dialog.locator("video.actual-trial-video").waitFor();
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
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state: "clean", aspect })});(${installCreationBridge.toString()})(${JSON.stringify({ state })});(${installAssemblyAuditBridge.toString()})({mode:"complete"});(${installActualTrialBridge.toString()})(${JSON.stringify({ state, mediaBytes: Array.from(media) })});`,
        });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          const seed = await page.evaluate(seedActualTrialProject, {
            state,
            controllerUrl: new URL("/src/aivora/pro/film-pipeline-controller.ts", config.url).href,
            pipelineUrl: new URL("/src/aivora/film/production-pipeline.ts", config.url).href,
          });
          result.seed = seed;
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await waitAssemblyIdle(page, seed.projectId);
          const initial = await audit();
          for (const field of ["prepares", "media", "records", "checks"])
            assert.deepEqual(initial[field], []);
          await nav("剪辑").click();
          await waitAssemblyIdle(page, seed.projectId);
          const before = await raw(seed.projectId),
            expectedAssembly = [before];
          assert.equal(before.shots.length, 6);
          assert(before.shots.every((shot) => shot.takes.length === 3));
          let dialog = await show();
          if (state === "trial-stale-source") {
            await dialog.getByText("正在读取本次核对的素材…", { exact: true }).waitFor();
            result.reached = true;
            await geometry("held-media-no-form");
            assert.deepEqual((await audit()).records, []);
            await dialog.getByRole("button", { name: "关闭", exact: true }).click();
            await page.locator(".pb.bin .it").first().click();
            await page.locator(".cmp .nx-takes").waitFor();
            await button("用第 2 版").click();
            await button("关掉对比").click();
            await waitAssemblyIdle(page, seed.projectId);
            const changed = await raw(seed.projectId);
            assert.equal(changed.shots[0].selectedTakeId, changed.shots[0].takes[1].id);
            expectedAssembly.push(changed);
            await page.evaluate(() => window.__actualTrialAudit.release(0));
            await frame();
            assert.equal(
              await page.getByRole("dialog", { name: "实际版本试片审核", exact: true }).count(),
              0,
            );
            assert.deepEqual((await audit()).records, []);
            assert.equal((await audit()).prepares.length, 1);
            dialog = await show();
            await loaded(dialog);
            await dialog.getByRole("heading", { name: /第 2 版/ }).waitFor();
            assert.equal((await audit()).prepares.length, 2);
            await reachable(dialog.getByRole("button", { name: "关闭", exact: true }));
            await geometry("selected-version-fresh-not-recorded");
          } else {
            await loaded(dialog);
            result.reached = true;
            assert.equal(await dialog.getByRole("radio", { checked: true }).count(), 0);
            assert.equal(await dialog.getByRole("checkbox").isChecked(), false);
            assert.equal(
              await dialog
                .getByRole("button", { name: "保存本次人工决定", exact: true })
                .isEnabled(),
              false,
            );
            await dialog
              .locator("video.actual-trial-video")
              .evaluate((video) => video.dispatchEvent(new window.Event("ended")));
            assert.deepEqual((await audit()).records, []);
            assert.deepEqual((await audit()).checks, []);
            if (state === "trial-needs-changes") {
              const long = "😀".repeat(251);
              await dialog.getByRole("textbox").fill(long);
              await dialog
                .getByRole("radio", { name: "这个实际版本需要修改", exact: true })
                .check();
              assert.equal(await dialog.getByRole("textbox").inputValue(), long);
              assert.equal(
                await dialog
                  .getByRole("button", { name: "保存本次人工决定", exact: true })
                  .isEnabled(),
                false,
              );
              assert.deepEqual((await audit()).records, []);
              const note = "  本次人工说明🙂\n原样保留空白  ";
              await dialog.getByRole("textbox").fill(note);
              await reachable(
                dialog.getByRole("button", { name: "保存本次人工决定", exact: true }),
              );
              await geometry("full-limitations-explicit-decision");
              await dialog.getByRole("button", { name: "保存本次人工决定", exact: true }).click();
              await dialog.getByText("人工决定已记录：需修改。", { exact: true }).waitFor();
              const stored = await raw(seed.projectId);
              assert.equal(stored.riskTrialDecisions.length, 1);
              onlyDecisionAppended(stored, before);
              assert.equal(stored.riskTrialDecisions[0].note, note);
              assert.equal(stored.riskTrialDecisions[0].decision, "needs-changes");
              assert.deepEqual(mediaOf(stored), mediaOf(before));
              assert.equal(
                await dialog.getByRole("button", { name: "继续生成", exact: true }).count(),
                0,
              );
              assert.equal((await audit()).records.length, 1);
              await geometry("needs-changes-saved-no-continue");
            } else {
              await dialog.getByRole("radio", { name: "接受这个实际版本", exact: true }).check();
              await dialog.getByRole("checkbox").check();
              await reachable(
                dialog.getByRole("button", { name: "保存本次人工决定", exact: true }),
              );
              await dialog.getByRole("button", { name: "保存本次人工决定", exact: true }).click();
              if (state === "trial-accepted-checkpoint") {
                await dialog.getByText("人工决定已记录：接受。", { exact: true }).waitFor();
                onlyDecisionAppended(await raw(seed.projectId), before);
                assert.deepEqual((await audit()).checks, []);
                assert.equal((await audit()).records.length, 1);
                await dialog.getByText(/停在分镜：6 个镜头/).waitFor();
                await dialog.getByText(/约需 0 次生成 · 用会员额度/).waitFor();
                const next = dialog.getByRole("button", { name: "继续生成", exact: true });
                await reachable(next);
                await geometry("accepted-original-checkpoint-no-auto-continue");
                await next.click();
                await page.waitForFunction(() => window.__actualTrialAudit.checks.length === 1);
                assert.equal((await audit()).checks[0].matched, true);
                assert.equal((await audit()).captures.length, 1);
                assert.equal((await audit()).captures[0].matched, true);
                assert.deepEqual(mediaOf(await raw(seed.projectId)), mediaOf(before));
                assert.equal((await audit()).records.length, 1);
                await geometry("explicit-continue-native-rejected-no-provider");
              } else {
                await page.waitForFunction(() => window.__actualTrialAudit.pending.length === 1);
                await dialog
                  .getByText("人工决定的保存结果尚未确认，不会自动重复记录。", { exact: true })
                  .waitFor();
                assert.equal(
                  await dialog
                    .getByRole("button", { name: "保存本次人工决定", exact: true })
                    .isEnabled(),
                  false,
                );
                await dialog.getByRole("button", { name: "关闭", exact: true }).click();
                await button("作品").click();
                await button("合成试片第2集").click();
                await page
                  .locator(".topbar .ep")
                  .filter({ hasText: /^\/\s*合成试片第2集$/ })
                  .waitFor();
                await page.waitForFunction(
                  (id) => window.__assemblyAudit.calls.some((call) => call.input.projectId === id),
                  seed.otherId,
                );
                await waitAssemblyIdle(page, seed.otherId);
                const otherBefore = await raw(seed.otherId),
                  otherWrites = (await audit()).writes.filter(
                    (write) => write.projectId === seed.otherId,
                  ).length;
                expectedAssembly.push(otherBefore);
                await button("试片记录待核对（1）").click();
                const panel = page.getByRole("dialog", { name: "试片记录保存状态", exact: true });
                scopeSelector = '.pro-root [role="dialog"][aria-label="试片记录保存状态"]';
                await panel.getByRole("button", { name: "核对试片保存结果", exact: true }).click();
                await panel
                  .getByText("本机记录还在处理中，请稍后手动核对，不要重复记录。", { exact: true })
                  .waitFor();
                assert.equal((await audit()).records.length, 1);
                assert.equal((await raw(seed.projectId)).riskTrialDecisions, undefined);
                await geometry("busy-global-original-retained");
                await page.evaluate(() => window.__actualTrialAudit.release(0));
                await reachable(
                  panel.getByRole("button", { name: "核对试片保存结果", exact: true }),
                );
                await panel.getByRole("button", { name: "核对试片保存结果", exact: true }).click();
                await panel
                  .getByText("人工决定已记录。继续仍须重新确认生成范围、数量与费用。", {
                    exact: true,
                  })
                  .waitFor();
                assert.equal(await button("试片记录待核对（1）").count(), 0);
                assert.equal((await audit()).records.length, 1);
                assert.deepEqual(await raw(seed.otherId), otherBefore);
                assert.equal(
                  (await audit()).writes.filter((write) => write.projectId === seed.otherId).length,
                  otherWrites,
                );
                assert.equal((await raw(seed.projectId)).riskTrialDecisions.length, 1);
                onlyDecisionAppended(await raw(seed.projectId), before);
                assert.deepEqual(mediaOf(await raw(seed.projectId)), mediaOf(before));
                await geometry("fresh-global-recovery-other-untouched");
              }
            }
          }
          const final = await audit();
          assertAssemblyRequests(final.assembly, expectedAssembly);
          assert.deepEqual(final.cancels, []);
          assert(final.prepares.every((call) => call.matched && call.cas));
          assert(final.records.every((call) => call.matched));
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
            error.stack?.match(/[\\/]pro-actual-trial-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
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
  return actualTrialStates.length * report.viewports.length * report.aspects.length;
}
