import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge, seedCreationProject } from "./pro-creation-fixture.mjs";
import {
  installAssemblyAuditBridge,
  installAssemblyMediaRequests,
  seedAssemblyProject,
  readAssemblyReadiness,
  readAssemblyInteraction,
} from "./pro-assembly-fixture.mjs";
import { assertAssemblyRequests, waitAssemblyIdle } from "./pro-assembly-assertions.mjs";

export const assemblyStates = [
  "assembly-actual-clock",
  "assembly-partial",
  "assembly-cancel-revision",
  "assembly-missing-cache",
];

/** Real Pro controls with controlled native results and DOM media requests; not codec playback. */
export async function runAssemblyCases({ browser, config, report, media, persist }) {
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of assemblyStates) {
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
          pageerrors: [],
          blockedRequests: [],
          phases: [],
        };
        const button = (name) => page.getByRole("button", { name, exact: true });
        const nav = (name) =>
          page
            .getByRole("navigation", { name: "创作阶段" })
            .getByRole("button", { name: new RegExp(name) });
        const record = (id) => page.evaluate((id) => window.__proCreationAudit.record(id), id);
        const frame = () =>
          page.evaluate(
            () =>
              new Promise((resolve) =>
                window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
              ),
          );
        async function geometry(phase) {
          await frame();
          result.geometry = await page.evaluate(probeProLayout, { scopeSelector: ".pro-root" });
          const screenshot = path.join(combination, `${phase}.png`);
          result.screenshot = screenshot;
          result.phases.push({ phase, screenshot, geometry: result.geometry });
          await page.screenshot({ path: path.join(config.out, screenshot) });
          assert.deepEqual(result.geometry.issues, []);
        }
        async function mediaMetadata(duration) {
          const video = page.locator(".pane.monitor video");
          await video.waitFor();
          await video.evaluate((element, duration) => {
            // Known synthetic metadata only: does not decode custom protocols or modify React state.
            Object.defineProperty(element, "duration", { configurable: true, value: duration });
            element.dispatchEvent(new window.Event("loadedmetadata"));
          }, duration);
          return video;
        }
        async function requestedTime(video, seconds) {
          // Let the real seek effect register its metadata listener before the controlled event.
          await frame();
          await video.evaluate((element) =>
            element.dispatchEvent(new window.Event("loadedmetadata")),
          );
          await page.waitForFunction(
            ({ seconds }) => {
              const video = document.querySelector(".pane.monitor video");
              return video && Math.abs(video.currentTime - seconds) < 0.00001;
            },
            { seconds },
          );
        }
        page.on("pageerror", () => result.pageerrors.push("PAGE_ERROR"));
        const mediaUrl = new URL("/__assembly-shot.mp4", config.url).href;
        await page.route("**/*", (route) => {
          const u = new URL(route.request().url());
          if (
            /^https?:$/.test(u.protocol) &&
            (u.origin !== new URL(config.url).origin ||
              u.pathname === "/api" ||
              u.pathname.startsWith("/api/"))
          ) {
            result.blockedRequests.push(
              u.origin === new URL(config.url).origin ? "API" : "EXTERNAL_HTTP",
            );
            return route.abort();
          }
          if (u.href === mediaUrl) return route.fulfill({ contentType: "video/mp4", body: media });
          return route.continue();
        });
        const mode =
          state === "assembly-cancel-revision"
            ? "hold"
            : state === "assembly-partial"
              ? "partial"
              : state === "assembly-missing-cache"
                ? "refuse"
                : "success";
        await page.addInitScript({
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state: "clean", aspect })});(${installCreationBridge.toString()})(${JSON.stringify({ state })});(${installAssemblyAuditBridge.toString()})(${JSON.stringify({ mode })});(${installAssemblyMediaRequests.toString()})();`,
        });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl: new URL("/src/aivora/film/project.ts", config.url).href,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          const seed = await page.evaluate(seedCreationProject, { state });
          await page.evaluate(seedAssemblyProject, {
            restarted: state === "assembly-missing-cache",
          });
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(() =>
            Object.hasOwn(window.__proCreationAudit.saved().characters[0], "gender"),
          );
          const before = await record(seed.projectId);
          assert.equal(before.shots.length, 6);
          assert(before.shots.every((s) => s.takes.length === 3));
          await nav("剪辑").click();
          assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "edit");
          await page.waitForFunction(() => window.__assemblyAudit.calls.length === 1);
          result.reached = true;
          result.interactions = {};
          result.interactions.entered = await page.evaluate(readAssemblyInteraction);
          if (state === "assembly-cancel-revision") {
            const first = await page.evaluate(() => window.__assemblyAudit.calls[0]);
            await page.locator(".pb.bin .it").first().click();
            await page.locator(".cmp .nx-takes").waitFor();
            await button("用第 2 版").click();
            await page.waitForFunction(() =>
              window.__assemblyAudit.cancels.some((c) => c.kind === "REQUESTED"),
            );
            assert.equal(
              await page.evaluate(() => window.__assemblyAudit.calls.length),
              1,
              "ACK is not stopped: the serialized next job remains unadmitted",
            );
            assert.equal(
              await page.evaluate(() =>
                window.__assemblyAudit.events.some((e) => e.cancelState === "stopped"),
              ),
              false,
            );
            assert.equal(
              (await record(seed.projectId)).assemblyPath || "",
              before.assemblyPath || "",
            );
            await geometry("cancel-requested-not-stopped");
            await page.evaluate((id) => {
              window.__assemblyAudit.mode = "success";
              window.__assemblyAudit.finish(id, { stopped: true });
            }, first.operationId);
            await page.waitForFunction(
              () =>
                window.__assemblyAudit.calls.length === 2 &&
                window.__assemblyAudit.artifacts.length === 1,
            );
            await button("关掉对比").click();
          }
          if (state === "assembly-missing-cache") {
            const notice = page.getByText(
              "粗剪时钟尚未核验，请重新合成后再按镜头跳转或标记范围。",
              { exact: true },
            );
            await notice.first().waitFor();
            const video = await mediaMetadata(9);
            await button("播放").click();
            await page.waitForFunction(() => window.__assemblyAudit.playRequests.length > 0);
            await button("暂停").click();
            await page.locator(".topbar .ep").click();
            await page.keyboard.press("Shift+ArrowRight");
            await requestedTime(video, 1);
            const previous = await video.evaluate((e) => e.currentTime);
            await page.keyboard.press("ArrowDown");
            await button("设入点").click();
            await button("设出点").click();
            assert.equal(
              await video.evaluate((e) => e.currentTime),
              previous,
              "Missing clock must not jump by planned shot proportions",
            );
            assert.equal(
              await page.getByRole("button", { name: "取消选择", exact: true }).count(),
              0,
              "No fabricated I/O range",
            );
            assert.equal(
              (await record(seed.projectId)).assemblyPath,
              "/synthetic/assembly/restarted.mp4",
            );
            await geometry("missing-clock-play-and-second-seek-only");
          } else {
            await page.waitForFunction(
              () =>
                window.__proCreationAudit.saved().assemblyPath ===
                window.__assemblyAudit.artifacts.at(-1)?.path,
            );
            const artifact = await page.evaluate(() => window.__assemblyAudit.artifacts.at(-1));
            const video = await mediaMetadata(artifact.durationSeconds);
            assert.equal(
              Number(
                await page.getByRole("slider", { name: "播放位置" }).getAttribute("aria-valuemax"),
              ),
              artifact.durationSeconds,
            );
            assert.notEqual(
              artifact.durationSeconds,
              before.shots.reduce((sum, s) => sum + s.seconds, 0),
            );
            // Actual edit transport moves to the next measured cut without opening range editing.
            await page.locator(".topbar .ep").click();
            await page.keyboard.press("ArrowDown");
            await requestedTime(video, artifact.shots[1].startSeconds);
            if (state === "assembly-actual-clock") {
              const description = page.getByLabel("改这一镜的描述", { exact: true });
              assert.equal(await description.inputValue(), before.shots[1].picture);
              const playingThird = artifact.shots[2].startSeconds + 0.2;
              await video.evaluate((element, seconds) => {
                element.currentTime = seconds;
                element.dispatchEvent(new window.Event("timeupdate"));
              }, playingThird);
              await page.waitForFunction(
                (value) =>
                  Number(
                    document
                      .querySelector('[aria-label="播放位置"]')
                      ?.getAttribute("aria-valuenow"),
                  ) ===
                  Math.round(value * 10) / 10,
                playingThird,
              );
              assert.equal(
                await description.inputValue(),
                before.shots[1].picture,
                "Playback time updates must not steal the chosen editing shot",
              );
              result.interactions.beforeMark = await page.evaluate(readAssemblyInteraction);
              await button("设入点").click();
              await page
                .getByText("请先选择当前正在播放的镜头，再标记范围。", { exact: true })
                .first()
                .waitFor();
              result.interactions.afterMark = await page.evaluate(readAssemblyInteraction);
              assert.equal(
                await page.getByRole("button", { name: "取消选择", exact: true }).count(),
                0,
              );
              await page.keyboard.press("ArrowDown");
              await requestedTime(video, artifact.shots[3].startSeconds);
              assert.equal(await description.inputValue(), before.shots[3].picture);
            }
            if (state === "assembly-partial") {
              await page
                .getByText("粗剪已有文件，声音或字幕处理还没完成。", { exact: true })
                .waitFor();
              assert.equal(artifact.kind, "PARTIAL");
              await button("播放").click();
              await page.waitForFunction(() => window.__assemblyAudit.playRequests.length > 0);
              await button("暂停").click();
            } else assert.equal(artifact.kind, "ASSEMBLED");
            await geometry("actual-clock-and-retained-artifact");
          }
          await waitAssemblyIdle(page, seed.projectId);
          const after = await record(seed.projectId),
            audit = await page.evaluate(() => ({
              calls: window.__assemblyAudit.calls,
              cancels: window.__assemblyAudit.cancels,
              events: window.__assemblyAudit.events,
              legacy: window.__assemblyAudit.legacy,
              forbidden: [
                ...window.__assemblyAudit.forbidden,
                ...window.__proCreationAudit.forbidden,
                ...window.__exportQcAudit.forbidden,
              ],
              artifacts: window.__assemblyAudit.artifacts,
              playRequests: window.__assemblyAudit.playRequests,
              legacyCalls: window.__proCreationAudit.assemblies,
              paid: window.__proCreationAudit.forbidden.filter((name) =>
                [
                  "completeText",
                  "speak",
                  "generateVideo",
                  "generateFilmStill",
                  "generateFilmVideo",
                  "createStoryFilm",
                ].includes(name),
              ).length,
              qcPrepare: window.__exportQcAudit.prepare.length,
              qcPublish: window.__exportQcAudit.publish.length,
              archiveExports: window.__proCreationAudit.exports.length,
              archiveImports: window.__proCreationAudit.imports.length,
            }));
          assertAssemblyRequests(
            audit.calls,
            state === "assembly-cancel-revision" ? [before, after] : [before],
          );
          assert.deepEqual(audit.legacy, []);
          assert.deepEqual(audit.legacyCalls, []);
          assert.deepEqual(audit.forbidden, []);
          assert.equal(audit.paid, 0);
          assert.equal(audit.qcPrepare, 0);
          assert.equal(audit.qcPublish, 0);
          assert.equal(audit.archiveExports, 0);
          assert.equal(audit.archiveImports, 0);
          assert.deepEqual(after.audioClips, before.audioClips);
          assert.deepEqual(
            after.shots.map((s) => s.takes),
            before.shots.map((s) => s.takes),
          );
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = audit;
          result.passed = true;
        } catch (error) {
          result.assemblyInteraction = await page
            .evaluate(readAssemblyInteraction)
            .catch(() => null);
          result.assemblyReadiness = await page.evaluate(readAssemblyReadiness).catch(() => null);
          const line = Number(
            error.stack?.match(/[\\/]pro-assembly-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
          );
          result.checkLine = Number.isSafeInteger(line) && line > 0 && line <= 100000 ? line : null;
          result.error = "PRO_ASSEMBLY_CASE_FAILED";
          await page
            .screenshot({ path: path.join(config.out, combination, "failure.png") })
            .catch(() => undefined);
          result.screenshot = path.join(combination, "failure.png");
        } finally {
          report.results.push(result);
          console.log(`${result.passed ? "PASS" : "FAIL"} ${combination}`);
          await persist();
          await context.close();
        }
      }
  return assemblyStates.length * report.viewports.length * report.aspects.length;
}
