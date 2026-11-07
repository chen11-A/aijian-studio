import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";
import { installExportQcBridge } from "./pro-export-qc-fixture.mjs";
import { installCreationBridge, seedCreationProject } from "./pro-creation-fixture.mjs";
import { loadLibraryAuditCatalog } from "./pro-audio-library-fixture.mjs";
import { installShotAudioBridge, seedShotAudioProject } from "./pro-shot-audio-fixture.mjs";
import {
  installDialogueSplitBridge,
  seedDialogueSplitProject,
} from "./pro-dialogue-split-fixture.mjs";
export const dialogueSplitStates = [
  "dialogue-split-review-accept",
  "dialogue-split-unknown",
  "dialogue-split-foreign-conflict",
  "dialogue-split-backup-delta-guard",
];
export async function runDialogueSplitCases({ browser, config, report, media, persist }) {
  const catalog = await loadLibraryAuditCatalog();
  assert.equal(catalog.assets.length, 206);
  const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href,
    mediaUrl = new URL("/__shot-audio-video.mp4", config.url).href;
  for (const viewport of report.viewports)
    for (const aspect of report.aspects)
      for (const state of dialogueSplitStates) {
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
            prepares: window.__dialogueSplitAudit.prepares,
            applies: window.__dialogueSplitAudit.applies,
            verifies: window.__dialogueSplitAudit.verifies,
            previews: window.__dialogueSplitAudit.previews,
            waves: window.__dialogueSplitAudit.waves,
            writes: window.__dialogueSplitAudit.writes,
            assemblies: window.__dialogueSplitAudit.assemblies,
            nativeWrites: window.__dialogueSplitAudit.nativeWrites,
            flushes: window.__shotAudioAudit.flushes,
            forbidden: [
              ...window.__dialogueSplitAudit.forbidden,
              ...window.__shotAudioAudit.forbidden,
              ...window.__proCreationAudit.forbidden,
              ...window.__exportQcAudit.forbidden,
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
        await page.addInitScript(installExportQcBridge, { state: "clean", aspect });
        await page.addInitScript(installCreationBridge, { state });
        await page.addInitScript(installShotAudioBridge, { state, catalog });
        await page.addInitScript(installDialogueSplitBridge, {
          state,
          helperModuleUrl: new URL("/e2e/pro-dialogue-split-browser-helper.mjs", config.url).href,
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
          await page.evaluate(seedDialogueSplitProject, { shotId: seed.shotId });
          await page.reload({ waitUntil: "networkidle" });
          await page.getByLabel("这一场", { exact: true }).waitFor();
          await page.waitForFunction(() =>
            Object.hasOwn(window.__proCreationAudit.saved().characters[0], "gender"),
          );
          await nav("剪辑").click();
          assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "edit");
          async function ready(id) {
            await page.waitForFunction(
              (id) => window.__dialogueSplitAudit.previews.some((p) => p.projectId === id),
              id,
            );
            await button("重试音轨试听").waitFor();
            await button("刷新音频波形").waitFor();
            await page.waitForFunction(() => {
              const w = document.querySelector(".statusbar .where");
              return !!w && !w.textContent.includes("正在保存");
            });
          }
          await ready(seed.projectId);
          const before = await record(seed.projectId),
            target = before.shots.find((s) => s.id === seed.shotId);
          assert.equal(before.shots.length, 6);
          assert(before.shots.every((s) => s.takes.length === 3));
          assert.equal(before.audioClips.length, 1);
          const open = async (wait = true) => {
            await reachable(button("查看完整句拆镜方案"));
            await button("查看完整句拆镜方案").click();
            const d = page.getByRole("dialog", { name: "按完整句拆镜" });
            await d.waitFor();
            scopeSelector = ".dialogue-split-dialog";
            result.reached = true;
            if (wait) await d.getByRole("region", { name: "完整句拆镜方案" }).waitFor();
            return d;
          };
          let dialog = await open(state !== "dialogue-split-foreign-conflict");
          const close = () => dialog.getByRole("button", { name: "关闭", exact: true });
          const submit = () =>
            dialog.getByRole("button", { name: "接受这份拆镜结构", exact: true });
          const pending = () => button("拆镜保存待核对（1）");
          const panel = () => page.getByRole("dialog", { name: "拆镜保存状态" });
          const recover = () =>
            panel().getByRole("button", { name: "核对拆镜保存结果", exact: true });
          const closed = async () => {
            await reachable(close());
            await close().click();
            scopeSelector = ".pro-root";
          };
          const plan = async () => {
            const source = dialog.getByRole("region", { name: "原镜完整台词", exact: true });
            assert((await source.textContent()).includes(target.line));
            assert.equal(await dialog.getByRole("article").count(), 3);
            assert((await dialog.textContent()).includes("预计新增 3 个视频"));
            assert((await dialog.textContent()).includes("不含配音、图片或失败重试"));
            assert.equal(await dialog.getByRole("checkbox").isChecked(), false);
            assert.equal(await submit().isDisabled(), true);
            assert.equal(await dialog.locator("button.primary:visible").count(), 1);
            const notes = dialog.getByRole("region", { name: "拆镜前需核对", exact: true });
            assert.equal(await notes.getByRole("listitem").count(), 12);
            await geometry("complete-plan");
            await notes.getByRole("listitem").last().scrollIntoViewIfNeeded();
            await geometry("last-note");
            await reachable(close());
            await reachable(dialog.getByRole("checkbox"));
            await reachable(submit());
          };
          const accept = async () => {
            const checkbox = dialog.getByRole("checkbox");
            await reachable(checkbox);
            await checkbox.check();
            await reachable(submit());
            await submit().dblclick();
          };
          const quit = async (status) => {
            const n = (await calls()).flushes.length;
            await page.evaluate(() => window.__shotAudioAudit.flush());
            await page.waitForFunction((n) => window.__shotAudioAudit.flushes.length === n + 1, n);
            assert.equal((await calls()).flushes.at(-1).status, status);
          };
          const mediaIdentity = (shot) => ({
            id: shot.id,
            selectedTakeId: shot.selectedTakeId,
            takes: shot.takes,
            stills: shot.stills,
            poster: shot.poster,
          });
          const checkStored = async () => {
            const after = await record(seed.projectId);
            assert.equal(after.shots.length, 8);
            assert(!after.shots.some((s) => s.id === seed.shotId));
            const children = after.shots.filter((s) => s.splitSource?.sourceShotId === seed.shotId);
            assert.equal(children.length, 3);
            assert.equal(children.map((s) => s.line).join(""), target.line);
            assert(
              children.every(
                (s) =>
                  s.takes.length === 0 && s.stills.length === 0 && !s.poster && !s.selectedTakeId,
              ),
            );
            assert.equal(new Set(children.map((s) => s.id)).size, 3);
            assert(children.every((s) => !before.shots.some((old) => old.id === s.id)));
            for (const shot of before.shots.filter((s) => s.id !== seed.shotId))
              assert.deepEqual(
                mediaIdentity(after.shots.find((s) => s.id === shot.id)),
                mediaIdentity(shot),
              );
            assert.deepEqual(after.characters, before.characters);
            assert.deepEqual(after.audioClips, before.audioClips);
            const backups = await page.evaluate(() =>
              Object.values(window.__dialogueSplitAudit.backups).map((b) => ({
                snapshot: b.snapshot,
                entry: b.entry,
              })),
            );
            assert.equal(backups.length, 1);
            assert.equal(backups[0].entry.reason, "before-dialogue-split");
            assert.deepEqual(
              mediaIdentity(backups[0].snapshot.shots.find((s) => s.id === seed.shotId)),
              mediaIdentity(target),
            );
            return after;
          };
          if (state === "dialogue-split-review-accept") {
            await plan();
            assert.equal((await calls()).applies.length, 0);
            await quit("saved");
            await closed();
            assert.equal((await calls()).applies.length, 0);
            assert.deepEqual((await record(seed.projectId)).shots, before.shots);
            dialog = await open();
            await plan();
            await accept();
            await page.waitForFunction(
              () =>
                !document.querySelector('[role="dialog"][aria-labelledby="dialogue-split-title"]'),
            );
            await checkStored();
            assert.equal(await pending().count(), 0);
            scopeSelector = ".pro-root";
            await ready(seed.projectId);
            await geometry("accepted-structure-no-generation");
          } else if (state === "dialogue-split-foreign-conflict") {
            await page.waitForFunction(() => window.__dialogueSplitAudit.pendingReads.length === 1);
            assert.equal(await close().isEnabled(), true);
            await quit("saved");
            await geometry("pending-read-no-owner");
            await closed();
            const description = page.getByLabel("改这一镜的描述", { exact: true });
            await description.fill("读取旧方案期间的新画面");
            await page.waitForFunction(
              ({ id, shotId }) =>
                window.__proCreationAudit.record(id).shots.find((s) => s.id === shotId).picture ===
                "读取旧方案期间的新画面",
              { id: seed.projectId, shotId: seed.shotId },
            );
            await page.evaluate(() => window.__dialogueSplitAudit.releaseRead());
            await frame();
            assert.equal(await page.getByRole("dialog", { name: "按完整句拆镜" }).count(), 0);
            assert.equal((await calls()).applies.length, 0);
            assert.equal(await description.inputValue(), "读取旧方案期间的新画面");
            dialog = await open();
            await plan();
            await accept();
            await pending().waitFor();
            await closed();
            await description.fill("未知保存期间必须保留的后编辑");
            await button("作品").click();
            await button("合成第2集").click();
            await page.locator(".topbar .ep").filter({ hasText: "/ 合成第2集" }).waitFor();
            await ready(seed.otherId);
            const otherRaw = await record(seed.otherId),
              writes = (await calls()).writes.filter((w) => w.projectId === seed.otherId).length;
            await page.evaluate(() => window.__dialogueSplitAudit.finish());
            await pending().click();
            scopeSelector = ".dialogue-split-dialog";
            await reachable(recover());
            await recover().click();
            await panel()
              .getByText(/与当前编辑不同/)
              .waitFor();
            const compare = panel().getByRole("button", { name: "查看两份状态", exact: true });
            await reachable(compare);
            await compare.click();
            const conflict = panel().getByRole("region", { name: "拆镜保存冲突选择" });
            await conflict.waitFor();
            assert(
              (
                await conflict.getByLabel("拆镜保留稿文字备忘", { exact: true }).inputValue()
              ).includes("未知保存期间必须保留的后编辑"),
            );
            await geometry("foreign-draft-and-saved-conflict");
            const choose = conflict.getByRole("button", {
              name: "采用已核对的拆镜版并放弃这份保留稿",
              exact: true,
            });
            await reachable(choose);
            await choose.click();
            await page.waitForFunction(
              () => !document.querySelector("footer")?.textContent.includes("拆镜保存待核对（1）"),
            );
            assert.deepEqual(await record(seed.otherId), otherRaw);
            assert.equal(
              (await calls()).writes.filter((w) => w.projectId === seed.otherId).length,
              writes,
            );
            assert.equal(await page.locator(".topbar .ep").textContent(), "/ 合成第2集");
            const stored = await checkStored();
            assert(
              stored.shots
                .filter((s) => s.splitSource)
                .every((s) => s.picture === "读取旧方案期间的新画面"),
            );
            await geometry("foreign-explicit-adoption-no-overwrite");
          } else {
            await plan();
            await accept();
            await pending().waitFor();
            await closed();
            await pending().click();
            scopeSelector = ".dialogue-split-dialog";
            if (state === "dialogue-split-unknown") {
              await reachable(recover());
              await recover().click();
              await panel()
                .getByText(/结构或原版备份尚不能完整核对/)
                .waitFor();
              assert(
                (await calls()).prepares.some((p) => p.kind === "FAILED" && p.code === "BUSY"),
              );
              await quit("unknown");
              await geometry("native-busy-does-not-confirm");
              await page.evaluate(() => window.__dialogueSplitAudit.finish());
              await reachable(recover());
              await recover().click();
              await page.waitForFunction(
                () =>
                  !document.querySelector("footer")?.textContent.includes("拆镜保存待核对（1）"),
              );
              await checkStored();
              await geometry("fresh-complete-delta-and-backup");
              await quit("saved");
            } else {
              assert.equal((await calls()).verifies.length, 0);
              await geometry("incomplete-raw-is-not-success");
              await page.evaluate(() => {
                window.__dialogueSplitAudit.incompleteRead = false;
              });
              await reachable(recover());
              await recover().click();
              await panel()
                .getByText(/结构或原版备份尚不能完整核对/)
                .waitFor();
              assert((await calls()).verifies.some((v) => v.kind === "BACKUP_FAILED"));
              assert.equal(
                await panel()
                  .getByRole("button", { name: "查看两份状态", exact: true })
                  .isDisabled(),
                true,
              );
              await quit("unknown");
              await geometry("bad-backup-cannot-confirm-or-discard");
            }
          }
          const adopted = ["dialogue-split-review-accept", "dialogue-split-unknown"].includes(
            state,
          );
          await page.waitForFunction(
            (n) => window.__dialogueSplitAudit.assemblies.length === n,
            adopted ? 2 : 1,
          );
          const actual = await calls();
          assert.equal(actual.applies.length, 1);
          assert(actual.applies.every((a) => a.matched));
          assert.equal(actual.nativeWrites, 1);
          assert.deepEqual(actual.forbidden, []);
          if (state !== "dialogue-split-backup-delta-guard")
            assert(actual.verifies.some((v) => v.kind === "VERIFIED"));
          const assembly = (paths) => ({
            seriesId: before.seriesId,
            paths,
            musicPath: "",
            gainDb: -14,
            dialogue: before.shots.map(() => ""),
          });
          const first = assembly(
            before.shots.map((s) => s.takes.find((t) => t.id === s.selectedTakeId).videoPath),
          );
          assert.deepEqual(actual.assemblies[0], first);
          assert.equal(actual.assemblies.length, adopted ? 2 : 1);
          if (adopted)
            assert.deepEqual(actual.assemblies[1], {
              ...assembly(
                before.shots
                  .filter((s) => s.id !== seed.shotId)
                  .map((s) => s.takes.find((t) => t.id === s.selectedTakeId).videoPath),
              ),
              dialogue: Array(8).fill(""),
            });
          assert.deepEqual(result.pageerrors, []);
          assert.deepEqual(result.blockedRequests, []);
          result.calls = actual;
          result.passed = true;
        } catch (error) {
          const line = Number(
            error.stack?.match(/[\\/]pro-dialogue-split-cases\.mjs:(\d{1,6}):\d{1,6}/)?.[1],
          );
          result.checkLine = Number.isSafeInteger(line) && line > 0 && line <= 100000 ? line : null;
          result.error = "PRO_DIALOGUE_SPLIT_CASE_FAILED";
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
  return dialogueSplitStates.length * report.viewports.length * report.aspects.length;
}
