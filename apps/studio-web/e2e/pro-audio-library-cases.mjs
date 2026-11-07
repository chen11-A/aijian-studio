import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge, seedCreationProject } from "./pro-creation-fixture.mjs";
import {
  installAudioLibraryBridge,
  loadLibraryAuditCatalog,
} from "./pro-audio-library-fixture.mjs";
export const audioLibraryStates = [
  "library-catalog",
  "library-target-guard",
  "library-add-remove",
  "library-unknown-recovery",
];
/** Second whitelist before public annotations: never interpolate native/DOM payloads. */
export function libraryTargetDiagnostic(value) {
  if (!value || typeof value !== "object") return "";
  const states = new Set([
    "TARGET",
    "PENDING",
    "CHANGED",
    "SAVE_UNCONFIRMED",
    "SOURCE_UNVERIFIED",
    "UNSUPPORTED",
    "EMPTY",
  ]);
  const replies = new Set(["TARGET", "PENDING", "PROJECT_CHANGED", "SOURCE_UNVERIFIED", "BUSY"]);
  const count = (v) => (Number.isSafeInteger(v) && v >= 0 && v <= 1000 ? String(v) : "unknown");
  return ` targetState=${states.has(value.state) ? value.state : "unknown"} targetReply=${replies.has(value.reply) ? value.reply : "unknown"} targetCalls=${count(value.calls)} targetMatched=${count(value.matched)} targetBusy=${count(value.busy)} libraryWrites=${count(value.writes)} libraryPreview=${count(value.previews)} libraryAssembly=${count(value.assemblies)}`;
}
const mediaFacts = (film) => ({
  characters: film.characters,
  shots: film.shots.map((s) => ({ id: s.id, takes: s.takes, poster: s.poster })),
});
export async function runAudioLibraryCases({ browser, config, report, media, persist }) {
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
  const mediaUrl = new URL("/__pro-audio-library-video.mp4", config.url).href;
  const catalog = await loadLibraryAuditCatalog();
  assert.equal(catalog.assets.length, 206);
  assert.equal(catalog.assets.filter((a) => a.type === "sfx").length, 175);
  assert.equal(catalog.assets.filter((a) => a.type === "music").length, 31);
  const asset = catalog.assets.find(
    (a) =>
      a.type === "sfx" &&
      a.durationSeconds >= 4 &&
      !a.loopable &&
      /^https?:/.test(a.source) &&
      catalog.assets.filter((b) => b.name === a.name).length === 1,
  );
  assert.ok(asset);
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of audioLibraryStates) {
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
          screenshot: path.join(combination, "library.png"),
          pageerrors: [],
          blockedRequests: [],
          reachability: [],
        };
        let scopeSelector = ".pro-root";
        const button = (name) => page.getByRole("button", { name, exact: true });
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
        const audit = () =>
          page.evaluate(() => ({
            catalog: window.__proAudioLibraryAudit.catalog,
            writes: window.__proAudioLibraryAudit.writes,
            inspects: window.__proAudioLibraryAudit.inspects,
            adds: window.__proAudioLibraryAudit.adds,
            previews: window.__proAudioLibraryAudit.previews,
            waves: window.__proAudioLibraryAudit.waves,
            files: window.__proAudioLibraryAudit.files,
            assemblies: window.__proCreationAudit.assemblies,
            forbidden: [
              ...window.__proAudioLibraryAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
            ],
          }));
        async function geometry(phase = "state") {
          result.geometry = await page.evaluate(probeProLayout, { scopeSelector });
          const screenshot = path.join(combination, `${phase}.png`);
          result.screenshot = screenshot;
          (result.phases ??= []).push({ phase, screenshot, geometry: result.geometry });
          await page.screenshot({ path: path.join(config.out, screenshot) });
          assert.deepEqual(
            result.geometry.issues,
            [],
            "Library controls must retain original geometry rules",
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
        await page.addInitScript(installExportQcBridge, { state: "clean", aspect });
        await page.addInitScript(installCreationBridge, { state });
        await page.addInitScript(installAudioLibraryBridge, { state, catalog });
        try {
          await page.goto(config.url, { waitUntil: "domcontentloaded" });
          await page.evaluate(seedProProject, {
            projectModuleUrl,
            aspect,
            versions: 3,
            videoUrl: mediaUrl,
          });
          result.seed = await page.evaluate(seedCreationProject, { state });
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(() =>
            Object.hasOwn(window.__proCreationAudit.saved().characters[0], "gender"),
          );
          const before = await saved();
          assert.equal(before.shots.length, 6);
          assert.ok(before.shots.every((s) => s.takes.length === 3));
          await nav("剪辑").click();
          assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "edit");
          await button("重试音轨试听").waitFor();
          await reachable(button("选用本地音效/配乐"), "library-open");
          await button("选用本地音效/配乐").click();
          const dialog = page.getByRole("dialog", { name: "选用本地音效或配乐" });
          await dialog.waitFor();
          scopeSelector = '.bundled-audio-dialog[aria-label="选用本地音效或配乐"]';
          await dialog.getByText("206 份本地素材，当前显示 206 份。", { exact: true }).waitFor();
          assert.equal(await dialog.locator("button.primary:visible").count(), 1);
          assert.equal(await dialog.getByRole("radio").count(), 206);
          result.reached = true;
          await geometry("catalog");
          await dialog.getByLabel("查找名称或类别").fill(asset.name);
          await dialog.getByRole("radio").first().click();
          assert.equal(await dialog.getByRole("radio").count(), 1);
          await dialog.getByText(asset.author, { exact: true }).waitFor();
          await dialog.getByText(asset.license, { exact: true }).waitFor();
          assert.equal(await dialog.getByRole("link").getAttribute("href"), asset.source);
          const add = dialog.getByRole("button", { name: "加入当前版本", exact: true });
          const refresh = dialog.getByRole("button", { name: "核对当前版本时长", exact: true });
          const close = dialog.getByRole("button", { name: "关闭", exact: true });
          if (state === "library-target-guard") {
            await page.waitForFunction(
              () => window.__proAudioLibraryAudit.pendingTargets.length === 1,
            );
            assert.equal(await dialog.getByLabel("使用时长（秒）").inputValue(), "");
            assert.equal(await add.isDisabled(), true);
            await geometry("target-pending");
            await page.evaluate(() => window.__proAudioLibraryAudit.resolveTarget());
            await dialog
              .getByText("当前版本或素材来源暂时无法核验，尚不能加入。", { exact: true })
              .waitFor();
            assert.equal(await add.isDisabled(), true);
            assert.equal((await audit()).adds.length, 0);
            await page.evaluate(() => {
              window.__proAudioLibraryAudit.mode = "ready";
            });
            await refresh.click();
          }
          await dialog.getByText("当前版本已核对：2.25 秒。", { exact: true }).waitFor();
          assert.equal(await dialog.getByLabel("使用时长（秒）").inputValue(), "2.25");
          if (state === "library-catalog" || state === "library-target-guard") {
            await reachable(add, "library-add");
            await reachable(close, "dialog-close");
            if (state === "library-target-guard") {
              await dialog.getByLabel("使用时长（秒）").fill("3");
              assert.equal(await add.isDisabled(), true);
            }
            assert.equal((await audit()).adds.length, 0);
            await close.click();
            scopeSelector = ".pro-root";
            await geometry("closed");
          } else {
            await dialog.getByLabel("使用时长（秒）").fill("1.5");
            await reachable(add, "library-add");
            await add.click();
            if (state === "library-add-remove") {
              await dialog.getByText(/素材已加入并保存/).waitFor();
              const added = await record(before.id),
                clip = added.audioClips.find((c) => c.id === "audio-library-browser-added");
              assert.ok(clip);
              assert.equal(clip.libraryAsset.assetId, asset.id);
              assert.equal(clip.libraryAsset.sha256, asset.sha256);
              assert.equal(
                clip.takeId,
                before.shots.find((s) => s.id === result.seed.shotId).selectedTakeId,
              );
              assert.deepEqual(mediaFacts(added), mediaFacts(before));
              assert.equal((await audit()).adds.length, 1);
              const files = (await audit()).files;
              await reachable(close, "dialog-close");
              await close.click();
              scopeSelector = ".pro-root";
              const remove = page.getByRole("button", { name: `移除${asset.name}`, exact: true });
              await reachable(remove, "library-remove");
              await remove.click();
              await page.getByText("片段已移除并保存，素材文件仍保留。", { exact: true }).waitFor();
              await page.waitForFunction(
                (id) =>
                  window.__proCreationAudit
                    .record(id)
                    .audioClips.every((c) => c.id !== "audio-library-browser-added"),
                before.id,
              );
              const removed = await record(before.id);
              assert.deepEqual(removed.audioClips, before.audioClips);
              assert.deepEqual(mediaFacts(removed), mediaFacts(before));
              assert.deepEqual((await audit()).files, files);
              await geometry("removed");
            } else {
              await dialog.getByText(/本机写入尚未确认结束/).waitFor();
              assert.equal(await add.isDisabled(), true);
              assert.equal((await audit()).adds.length, 1);
              await reachable(close, "dialog-close");
              await close.click();
              scopeSelector = ".pro-root";
              await nav("剧本").click();
              assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "script");
              await page.getByRole("button", { name: /本地素材保存待核对/ }).waitFor();
              const originalBeforeSwitch = await record(before.id);
              await button("作品").click();
              await button("合成第2集").click();
              const currentEpisode = page.locator(".topbar .ep");
              await currentEpisode.filter({ hasText: /^\/\s*合成第2集$/ }).waitFor();
              await page.waitForFunction(
                (id) =>
                  window.__proAudioLibraryAudit.writes.some((write) => write.projectId === id),
                result.seed.otherId,
              );
              await page
                .locator(".sb-right .where")
                .filter({ hasText: /作品保存在|已保存在这台电脑上/ })
                .waitFor();
              const other = await record(result.seed.otherId);
              assert.equal(
                await page.evaluate(async (id) => {
                  const last = window.__proAudioLibraryAudit.writes
                    .filter((write) => write.projectId === id)
                    .at(-1);
                  return (
                    last?.hash ===
                    (await window.__proCreationAudit.hash(window.__proCreationAudit.record(id)))
                  );
                }, result.seed.otherId),
                true,
              );
              assert.deepEqual(await record(before.id), originalBeforeSwitch);
              const writesBeforeRecovery = (await audit()).writes.length;
              result.currentWorkVerified = { episodeVisible: true, canonicalWriteComplete: true };
              await reachable(
                page.getByRole("button", { name: /本地素材保存待核对/ }),
                "library-pending",
              );
              await page.getByRole("button", { name: /本地素材保存待核对/ }).click();
              const panel = page.getByRole("dialog", { name: "本地素材保存状态" });
              await panel.waitFor();
              scopeSelector = '.bundled-audio-dialog[aria-label="本地素材保存状态"]';
              const recover = panel.getByRole("button", { name: "核对这部作品", exact: true });
              await reachable(recover, "library-recover");
              await recover.click();
              await panel.getByText(/本机写入尚未确认结束/).waitFor();
              assert.equal((await audit()).adds.length, 1);
              await page.evaluate(() => window.__proAudioLibraryAudit.finish());
              await recover.click();
              await panel
                .getByText("已保存的作品与本次添加无法对应，保留当前编辑，请先核对。", {
                  exact: true,
                })
                .waitFor();
              const view = panel.getByRole("button", { name: "查看冲突处理", exact: true });
              await reachable(view, "library-conflict");
              await view.click();
              await panel.getByRole("region", { name: "保存冲突选择" }).waitFor();
              const adopt = panel.getByRole("button", {
                name: "采用已保存版本并放弃这份未保存稿",
                exact: true,
              });
              await reachable(adopt, "library-adopt-saved");
              await adopt.click();
              await panel.getByText("本地素材保存状态已核对。", { exact: true }).waitFor();
              assert.deepEqual(await record(result.seed.otherId), other);
              assert.equal(await currentEpisode.innerText(), "/ 合成第2集");
              assert.equal(
                (await audit()).writes
                  .slice(writesBeforeRecovery)
                  .some((write) => write.projectId === result.seed.otherId),
                false,
              );
              assert.deepEqual(mediaFacts(await record(before.id)), mediaFacts(before));
              assert.equal((await record(before.id)).title, "本机后来保存的片名");
              assert.equal((await audit()).adds.length, 1);
              await reachable(
                panel.getByRole("button", { name: "关闭", exact: true }),
                "dialog-close",
              );
              await panel.getByRole("button", { name: "关闭", exact: true }).click();
              scopeSelector = ".pro-root";
              await nav("角色").click();
              assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "cast");
              assert.equal(
                await page.getByLabel("画风说明", { exact: true }).inputValue(),
                other.styleZh,
              );
              await geometry("recovered");
            }
          }
          const calls = await audit();
          assert.equal(calls.catalog, 1);
          assert.equal(
            calls.inspects.length,
            state === "library-unknown-recovery" ? 6 : state === "library-catalog" ? 1 : 2,
          );
          assert.equal(
            calls.adds.length,
            ["library-add-remove", "library-unknown-recovery"].includes(state) ? 1 : 0,
          );
          assert.ok(calls.adds.every((row) => row.matched));
          assert.ok(calls.previews.every((row) => row.matched));
          assert.ok(calls.waves.every((row) => row.matched));
          const expectedProjects = [before];

          assert.equal(calls.assemblies.length, expectedProjects.length);
          for (let i = 0; i < expectedProjects.length; i++) {
            const film = expectedProjects[i];
            assert.deepEqual(calls.assemblies[i], {
              projectId: film.id,
              seriesId: film.seriesId,
              paths: film.shots.map(
                (s) => s.takes.find((t) => t.id === s.selectedTakeId).videoPath,
              ),
              musicPath: "",
              gainDb: -14,
              dialogue: film.shots.map(() => ""),
            });
          }
          assert.deepEqual(calls.forbidden, []);
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = calls;
          result.passed = true;
        } catch (error) {
          const line = Number(
            error.stack?.match(/[\\/]pro-audio-library-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
          );
          result.checkLine = Number.isSafeInteger(line) && line > 0 && line <= 100000 ? line : null;
          result.error = "PRO_AUDIO_LIBRARY_CASE_FAILED";
          result.targetReadiness = await page
            .evaluate(() => {
              const a = window.__proAudioLibraryAudit;
              if (!a) return null;
              const dialog = document.querySelector(".bundled-audio-dialog");
              const text = dialog?.textContent ?? "";
              const state = text.includes("当前版本已核对：")
                ? "TARGET"
                : text.includes("作品或所选版本已变化")
                  ? "CHANGED"
                  : text.includes("检查保存状态") || text.includes("检查保存状态后")
                    ? "SAVE_UNCONFIRMED"
                    : text.includes("素材来源暂时无法核验")
                      ? "SOURCE_UNVERIFIED"
                      : text.includes("不支持本地素材时长核对")
                        ? "UNSUPPORTED"
                        : dialog?.getAttribute("aria-busy") === "true"
                          ? "PENDING"
                          : "EMPTY";
              return {
                state,
                reply: a.inspects.at(-1)?.reply ?? "PENDING",
                calls: a.inspects.length,
                matched: a.inspects.filter((c) => c.matched === true).length,
                busy: a.inspects.filter((c) => c.busy === true).length,
                writes: a.writes.length,
                previews: a.previews.length,
                assemblies: window.__proCreationAudit.assemblies.length,
              };
            })
            .catch(() => null);
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
  return audioLibraryStates.length * report.viewports.length * report.aspects.length;
}
