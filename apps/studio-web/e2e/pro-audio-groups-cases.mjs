import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
import { assertAssemblyRequests, waitAssemblyIdle } from "./pro-assembly-assertions.mjs";
import { installAssemblyAuditBridge, readAssemblyReadiness } from "./pro-assembly-fixture.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge, seedCreationProject } from "./pro-creation-fixture.mjs";
import { loadLibraryAuditCatalog } from "./pro-audio-library-fixture.mjs";
import { installShotAudioBridge, seedShotAudioProject } from "./pro-shot-audio-fixture.mjs";
import { installAudioGroupsBridge } from "./pro-audio-groups-fixture.mjs";
export const audioGroupStates = [
  "audio-groups-confirm-remove",
  "audio-groups-busy",
  "audio-groups-unknown",
  "audio-groups-partial-conflict",
];
export async function runAudioGroupCases({ browser, config, report, media, persist }) {
  const catalog = await loadLibraryAuditCatalog();
  assert.equal(catalog.assets.length, 206);
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href,
    mediaUrl = new URL("/__shot-audio-video.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of audioGroupStates) {
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
        let scopeSelector = ".pro-root";
        const nav = (label) =>
          page
            .getByRole("navigation", { name: "创作阶段" })
            .getByRole("button", { name: new RegExp(label) });
        const button = (name) => page.getByRole("button", { name, exact: true });
        const record = (id) => page.evaluate((id) => window.__proCreationAudit.record(id), id);
        const calls = () =>
          page.evaluate(() => ({
            calls: window.__audioGroupsAudit.calls,
            inspects: window.__audioGroupsAudit.inspects,
            nativeWrites: window.__audioGroupsAudit.nativeWrites,
            copied: window.__audioGroupsAudit.copied,
            groupWrites: window.__audioGroupsAudit.writes,
            writes: window.__shotAudioAudit.writes,
            rejectedWrites: window.__shotAudioAudit.rejectedWrites,
            flushes: window.__shotAudioAudit.flushes,
            assemblies: window.__proCreationAudit.assemblies,
            nativeAssemblies: window.__assemblyAudit.calls,
            legacyAssemblies: window.__assemblyAudit.legacy,
            forbidden: [
              ...window.__shotAudioAudit.forbidden,
              ...window.__audioGroupsAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
              ...window.__assemblyAudit.forbidden,
            ],
          }));
        const frame = () =>
          page.evaluate(
            () =>
              new Promise((resolve) =>
                window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
              ),
          );
        async function geometry(phase) {
          await frame();
          result.geometry = await page.evaluate(probeProLayout, { scopeSelector });
          const screenshot = path.join(combination, `${phase}.png`);
          result.screenshot = screenshot;
          result.phases.push({ phase, screenshot, geometry: result.geometry });
          await page.screenshot({ path: path.join(config.out, screenshot) });
          assert.deepEqual(
            result.geometry.issues,
            [],
            "Real suggestion controls retain original geometry rules",
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
          assert.equal(complete, true, "Suggestion action must scroll entirely into view");
          if (await control.isEnabled()) await control.click({ trial: true });
        }
        page.on("pageerror", () => result.pageerrors.push("PAGE_ERROR"));
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
        await page.addInitScript({
          content: `(${installExportQcBridge.toString()})(${JSON.stringify({ state: "clean", aspect })});(${installCreationBridge.toString()})(${JSON.stringify({ state })});(${installShotAudioBridge.toString()})(${JSON.stringify({ state, catalog })});(${installAudioGroupsBridge.toString()})(${JSON.stringify({ state, helperModuleUrl: new URL("/e2e/pro-audio-groups-browser-helper.mjs", config.url).href })});(${installAssemblyAuditBridge.toString()})();`,
        });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          const seed = await page.evaluate(seedCreationProject, { state });
          await page.evaluate(seedShotAudioProject, { shotId: seed.shotId });
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(() =>
            Object.hasOwn(window.__proCreationAudit.saved().characters[0], "gender"),
          );
          await nav("剪辑").click();
          assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "edit");
          await button("重试音轨试听").waitFor();
          await page.waitForFunction(() => window.__assemblyAudit.calls.length === 1);
          await waitAssemblyIdle(page, seed.projectId);
          const before = await record(seed.projectId),
            expectedAssemblies = [before];
          assert.equal(before.shots.length, 6);
          assert(before.shots.every((s) => s.takes.length === 3));
          assert.equal(before.audioClips.length, 1);
          const sourceIdentity = (film) =>
            film.shots.map((s) => ({ id: s.id, selectedTakeId: s.selectedTakeId, takes: s.takes }));
          const open = async () => {
            await reachable(button("查看本镜声音建议"));
            await button("查看本镜声音建议").click();
            const dialog = page.getByRole("dialog", { name: "本镜声音建议" });
            await dialog.getByRole("heading", { name: "音效 · 2 段", exact: true }).waitFor();
            scopeSelector = ".shot-audio-suggestions";
            assert.equal(await dialog.getByRole("article").count(), 6);
            return dialog;
          };
          if (state === "audio-groups-confirm-remove") {
            await page.getByLabel("改这一镜的描述", { exact: true }).fill("选用声音之前的字段编辑");
            await page.waitForFunction(
              ({ id, shotId }) =>
                window.__proCreationAudit.record(id).shots.find((s) => s.id === shotId).picture ===
                "选用声音之前的字段编辑",
              { id: seed.projectId, shotId: seed.shotId },
            );
          }
          let dialog = await open();
          result.reached = true;
          const confirm = () =>
            dialog.getByRole("button", { name: "选用所选轨道的完整建议", exact: true });
          const close = () => dialog.getByRole("button", { name: "关闭", exact: true });
          const pick = async () => {
            for (const lane of ["音效", "环境音"]) {
              const box = dialog.getByRole("checkbox", {
                name: `${lane} · 完整 2 段`,
                exact: true,
              });
              await reachable(box);
              await box.check();
            }
          };
          const pendingButton = () => button("本地素材保存待核对（1）");
          const panel = () => page.getByRole("dialog", { name: "本地素材保存状态" });
          const recover = () => panel().getByRole("button", { name: "核对这部作品", exact: true });
          const closeReview = async () => {
            await reachable(close());
            await close().click();
            scopeSelector = ".pro-root";
          };
          const quit = async (status) => {
            const count = (await calls()).flushes.length;
            await page.evaluate(() => window.__shotAudioAudit.flush());
            await page.waitForFunction(
              (n) => window.__shotAudioAudit.flushes.length === n + 1,
              count,
            );
            assert.equal((await calls()).flushes.at(-1).status, status);
          };
          const waitClips = async (count) =>
            page.waitForFunction(
              ({ id, count }) => window.__proCreationAudit.record(id).audioClips.length === count,
              { id: seed.projectId, count },
            );
          assert.equal(await dialog.getByRole("checkbox", { checked: true }).count(), 0);
          assert.equal(await confirm().isDisabled(), true);
          assert.equal((await calls()).calls.length, 0);
          await geometry("default-unselected");
          await pick();
          if (state === "audio-groups-confirm-remove") {
            // Closing an explicitly selected review must never submit it.
            await closeReview();
            assert.equal((await calls()).calls.length, 0);
            dialog = await open();
            assert.equal(await dialog.getByRole("checkbox", { checked: true }).count(), 0);
            await pick();
            await reachable(confirm());
            await confirm().click();
            await dialog.getByText(/声音已加入并保存/).waitFor();
            await waitClips(5);
            const added = await record(seed.projectId);
            expectedAssemblies.push(added);
            await page.waitForFunction(() => window.__assemblyAudit.calls.length === 2);
            await waitAssemblyIdle(page, seed.projectId);
            assert.deepEqual(added.audioClips[0], before.audioClips[0]);
            assert.deepEqual(sourceIdentity(added), sourceIdentity(before));
            assert.deepEqual(
              added.audioClips
                .slice(1)
                .map((c) => c.lane)
                .sort(),
              ["ambience", "ambience", "sfx", "sfx"],
            );
            assert(
              added.audioClips
                .slice(1)
                .every(
                  (c) => c.envelope?.fades.length === 2 && c.envelope?.gainAutomation.length === 2,
                ),
            );
            assert.equal(
              new Set(added.audioClips.slice(1).map((c) => c.suggestionGroup.groupId)).size,
              1,
            );
            const files = (await calls()).copied;
            await geometry("added");
            await closeReview();
            await button("撤销").click();
            await page.waitForFunction(
              ({ id, shotId, picture }) =>
                window.__proCreationAudit.record(id).shots.find((s) => s.id === shotId).picture ===
                picture,
              {
                id: seed.projectId,
                shotId: seed.shotId,
                picture: before.shots.find((s) => s.id === seed.shotId).picture,
              },
            );
            assert.equal((await record(seed.projectId)).audioClips.length, 5);
            const remove = button("移除第1组声音");
            await reachable(remove);
            await remove.click();
            await waitClips(1);
            const removed = await record(seed.projectId);
            expectedAssemblies.push(removed);
            await page.waitForFunction(() => window.__assemblyAudit.calls.length === 3);
            await waitAssemblyIdle(page, seed.projectId);
            assert.deepEqual(removed.audioClips, before.audioClips);
            assert.deepEqual(sourceIdentity(removed), sourceIdentity(before));
            assert.deepEqual((await calls()).copied, files);
            await geometry("references-removed-files-retained");
          } else if (state === "audio-groups-busy") {
            await reachable(confirm());
            await confirm().dblclick();
            await page.waitForFunction(() => window.__audioGroupsAudit.pending.length === 1);
            assert.equal(await close().isDisabled(), true);
            assert.equal(await confirm().isDisabled(), true);
            assert.equal(await dialog.getByRole("checkbox", { disabled: true }).count(), 3);
            assert.equal((await calls()).calls.length, 1);
            await quit("busy");
            await geometry("native-pending");
            await page.evaluate(() => window.__audioGroupsAudit.finish());
            await dialog.getByText(/声音已加入并保存/).waitFor();
            await waitClips(5);
            expectedAssemblies.push(await record(seed.projectId));
            await page.waitForFunction(() => window.__assemblyAudit.calls.length === 2);
            await waitAssemblyIdle(page, seed.projectId);
            await geometry("native-confirmed");
            await closeReview();
            await quit("saved");
          } else if (state === "audio-groups-unknown") {
            await reachable(confirm());
            await confirm().click();
            await pendingButton().waitFor();
            await closeReview();
            await reachable(pendingButton());
            await pendingButton().click();
            scopeSelector = ".bundled-audio-dialog";
            await reachable(recover());
            await recover().click();
            await panel()
              .getByText(/本机写入尚未确认结束/)
              .waitFor();
            assert.equal((await calls()).calls.length, 1);
            assert((await calls()).inspects.some((i) => i.reply === "BUSY"));
            await quit("unknown");
            await geometry("busy-no-reapply");
            await panel().getByRole("button", { name: "关闭", exact: true }).click();
            scopeSelector = ".pro-root";
            const description = page.getByLabel("改这一镜的描述", { exact: true });
            // The user edits the real timeline description, not internal React state.
            await description.fill("未知配声期间保留的镜头描述");
            await button("作品").click();
            await button("合成第2集").click();
            await page.locator(".topbar .ep").filter({ hasText: "/ 合成第2集" }).waitFor();
            // Wait for this work's actual ordinary write before taking its full raw baseline.
            await page.waitForFunction(
              (id) => window.__audioGroupsAudit.writes.some((w) => w.projectId === id),
              seed.otherId,
            );
            // The waveform hook saves before/after its read, then the real mix
            // preview admits another save. A first write is not a settled baseline.
            await page.waitForFunction(
              (id) => window.__audioGroupsAudit.previews.some((p) => p.projectId === id),
              seed.otherId,
            );
            await button("重试音轨试听").waitFor();
            await button("刷新音频波形").waitFor();
            await page.waitForFunction(() => {
              const where = document.querySelector(".statusbar .where");
              return !!where && !where.textContent.includes("正在保存");
            });
            // New shared assembly performs a legitimate canonical save after mix readiness.
            // Its actual admission must finish before the foreign no-write recovery baseline.
            await page.waitForFunction(() => window.__assemblyAudit.calls.length === 2);
            await waitAssemblyIdle(page, seed.otherId);
            await page.waitForFunction(
              () => !document.querySelector(".statusbar .where")?.textContent.includes("正在保存"),
            );
            const otherRaw = await record(seed.otherId),
              otherWrites = (await calls()).groupWrites.filter(
                (w) => w.projectId === seed.otherId,
              ).length;
            expectedAssemblies.push(otherRaw);
            await page.evaluate(() => window.__audioGroupsAudit.finish());
            await pendingButton().click();
            scopeSelector = ".bundled-audio-dialog";
            await reachable(recover());
            await recover().click();
            await page.waitForFunction(
              () =>
                !document.querySelector("footer")?.textContent.includes("本地素材保存待核对（1）"),
            );
            assert.deepEqual(await record(seed.otherId), otherRaw);
            assert.equal(
              (await calls()).groupWrites.filter((w) => w.projectId === seed.otherId).length,
              otherWrites,
            );
            assert.equal(await page.locator(".topbar .ep").textContent(), "/ 合成第2集");
            const original = await record(seed.projectId);
            assert.equal(
              original.shots.find((s) => s.id === seed.shotId).picture,
              "未知配声期间保留的镜头描述",
            );
            assert.equal(original.audioClips.length, 5);
            await geometry("foreign-recovered");
          } else {
            await reachable(confirm());
            await confirm().click();
            await pendingButton().waitFor();
            assert.equal((await record(seed.projectId)).audioClips.length, 5);
            // Incomplete ACK is not success even though this synthetic native commit stored a complete group.
            assert.equal(await dialog.getByText(/声音已加入并保存/).count(), 0);
            await closeReview();
            await pendingButton().click();
            scopeSelector = ".bundled-audio-dialog";
            await reachable(recover());
            await recover().click();
            await panel()
              .getByText(/无法对应/)
              .waitFor();
            const conflict = panel().getByRole("button", { name: "查看冲突处理", exact: true });
            await reachable(conflict);
            await conflict.click();
            const review = panel().getByRole("region", { name: "保存冲突选择" });
            await review.waitFor();
            await geometry("partial-ack-conflict-review");
            const adopt = review.getByRole("button", {
              name: "采用已保存版本并放弃这份未保存稿",
              exact: true,
            });
            await reachable(adopt);
            await adopt.click();
            await page.waitForFunction(
              () =>
                !document.querySelector("footer")?.textContent.includes("本地素材保存待核对（1）"),
            );
            assert.equal((await calls()).calls.length, 1);
            expectedAssemblies.push(await record(seed.projectId));
            await page.waitForFunction(() => window.__assemblyAudit.calls.length === 2);
            await waitAssemblyIdle(page, seed.projectId);
            await geometry("explicit-fresh-saved-adopted");
          }
          const after = await record(seed.projectId),
            actual = await calls();
          assert.deepEqual(sourceIdentity(after), sourceIdentity(before));
          assert.deepEqual(after.characters, before.characters);
          assert.deepEqual(after.audioClips[0], before.audioClips[0]);
          assert.equal(actual.calls.length, 1);
          assert(actual.calls.every((c) => c.matched));
          assert.equal(actual.nativeWrites, 1);
          assert.deepEqual(actual.forbidden, []);
          assert.deepEqual(actual.assemblies, []);
          assert.deepEqual(actual.legacyAssemblies, []);
          assertAssemblyRequests(actual.nativeAssemblies, expectedAssemblies);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = actual;
          result.passed = true;
        } catch (error) {
          result.assemblyReadiness = await page.evaluate(readAssemblyReadiness).catch(() => null);
          const line = Number(
            error.stack?.match(/[\\/]pro-audio-groups-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
          );
          result.checkLine = Number.isSafeInteger(line) && line > 0 && line <= 100000 ? line : null;
          result.error = "PRO_AUDIO_GROUPS_CASE_FAILED";
        } finally {
          if (!result.passed) {
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
  return audioGroupStates.length * report.viewports.length * report.aspects.length;
}
