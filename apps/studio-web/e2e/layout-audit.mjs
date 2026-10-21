/**
 * Layout audit for the running studio-web app.
 *
 * Window sizes cover the requested desktop sizes and the CSS-pixel viewports
 * Windows uses at 125% and 150% scaling (a 1920×1080 screen at 150% is 1280×720
 * CSS pixels). deviceScaleFactor matches that scaling; layout uses CSS pixels.
 *
 * The script fails when a control is covered, clipped with no scroll, or its
 * own text is cut off. Run against `pnpm --filter @aijian/studio-web dev`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.AIVORA_AUDIT_URL ?? "http://127.0.0.1:5173/";
const outDir = process.env.AIVORA_AUDIT_OUT ?? "/tmp/ui-audit/round1";

const viewports = [
  { name: "1920x1080", width: 1920, height: 1080, deviceScaleFactor: 1 },
  { name: "1536x864-win125", width: 1536, height: 864, deviceScaleFactor: 1.25 },
  { name: "1366x768", width: 1366, height: 768, deviceScaleFactor: 1 },
  { name: "1280x720-win150", width: 1280, height: 720, deviceScaleFactor: 1.5 },
  { name: "1093x614-1366-win125", width: 1093, height: 614, deviceScaleFactor: 1.25 },
  { name: "911x512-1366-win150", width: 911, height: 512, deviceScaleFactor: 1.5 },
];

const pages = [
  "launch",
  "home",
  "project",
  "projects",
  "source",
  "story",
  "script",
  "characters",
  "character",
  "world",
  "scenes",
  "storyboard",
  "generation",
  "assembly",
  "review",
  "changes",
  "assets",
  "voice",
  "export",
  "services",
  "costs",
  "settings",
  "projectSettings",
];

function layoutProbe() {
  const selector = "button, a, input, select, textarea, summary, h1, h2, h3, label, [role='tab']";
  const nodes = [...document.querySelectorAll(selector)];
  const issues = [];

  function visible(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.classList.contains("skip-link")) return false;
    if (element.closest("details:not([open])") && element.tagName !== "SUMMARY") return false;
    const overlay = document.querySelector("dialog[open]") || document.querySelector(".v2-launch");
    if (overlay instanceof HTMLElement && !overlay.contains(element) && !element.contains(overlay))
      return false;
    if (element.closest("[hidden]")) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)
      return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  }

  function labelOf(element) {
    if (element instanceof HTMLElement) {
      const named = element.getAttribute("aria-label") || element.innerText || element.textContent;
      return (named || element.tagName).replace(/\s+/g, " ").trim().slice(0, 80);
    }
    return element.tagName;
  }

  function insideScrollableRange(element) {
    const rect = element.getBoundingClientRect();
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent);
      const frame = parent.getBoundingClientRect();
      const scrollsY =
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        parent.scrollHeight > parent.clientHeight + 2;
      const scrollsX =
        (style.overflowX === "auto" || style.overflowX === "scroll") &&
        parent.scrollWidth > parent.clientWidth + 2;
      const outsideY = rect.top < frame.top - 1 || rect.bottom > frame.bottom + 1;
      const outsideX = rect.left < frame.left - 1 || rect.right > frame.right + 1;
      if ((scrollsY && outsideY) || (scrollsX && outsideX)) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  function clipsWithoutScroll(element) {
    if (insideScrollableRange(element)) return null;
    const rect = element.getBoundingClientRect();
    const fullyInView =
      rect.top >= -1 &&
      rect.left >= -1 &&
      rect.bottom <= window.innerHeight + 1 &&
      rect.right <= window.innerWidth + 1;
    if (fullyInView) return null;
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent);
      const frame = parent.getBoundingClientRect();
      const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
      const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
      const outside =
        (clipsX && (rect.left < frame.left - 1 || rect.right > frame.right + 1)) ||
        (clipsY && (rect.top < frame.top - 1 || rect.bottom > frame.bottom + 1));
      if (outside) {
        const canScrollX = parent.scrollWidth > parent.clientWidth + 2;
        const canScrollY = parent.scrollHeight > parent.clientHeight + 2;
        const reachableX = !clipsX || canScrollX;
        const reachableY = !clipsY || canScrollY;
        if (!reachableX || !reachableY) {
          return {
            tag: parent.className?.toString().slice(0, 80) || parent.tagName,
          };
        }
      }
      parent = parent.parentElement;
    }
    return null;
  }

  for (const element of nodes) {
    if (!visible(element)) continue;
    const rect = element.getBoundingClientRect();
    const interactive = ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(
      element.tagName,
    );
    if (interactive && !insideScrollableRange(element)) {
      const pointX = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 2);
      const pointY = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 2);
      const centerInside =
        rect.left >= -1 &&
        rect.top >= -1 &&
        rect.right <= window.innerWidth + 1 &&
        rect.bottom <= window.innerHeight + 1;
      if (centerInside) {
        const top = document.elementFromPoint(pointX, pointY);
        if (top && top !== element && !element.contains(top) && !top.contains(element)) {
          issues.push({
            kind: "covered",
            text: labelOf(element),
            by: labelOf(top),
          });
        }
      }
      const clip = clipsWithoutScroll(element);
      if (clip) {
        issues.push({ kind: "clipped", text: labelOf(element), by: clip.tag });
      }
    }

    const style = getComputedStyle(element);
    const ownText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0,
    );
    const clipsText =
      style.overflowX === "hidden" ||
      style.overflowX === "clip" ||
      style.textOverflow === "ellipsis";
    if (
      ownText &&
      clipsText &&
      (element.scrollWidth > element.clientWidth + 2 ||
        element.scrollHeight > element.clientHeight + 2)
    ) {
      issues.push({ kind: "truncated", text: labelOf(element) });
    }
  }

  const scroller = document.querySelector(".page-scroll");
  if (scroller instanceof HTMLElement) {
    const style = getComputedStyle(scroller);
    const locked = style.overflowY === "hidden" || style.overflowY === "clip";
    if (locked && scroller.scrollHeight > scroller.clientHeight + 8) {
      issues.push({
        kind: "scroll-locked",
        text: `主内容比可视区高 ${scroller.scrollHeight - scroller.clientHeight}px，且不能滚动`,
      });
    }
    if (scroller.scrollWidth > scroller.clientWidth + 8) {
      issues.push({
        kind: "horizontal-overflow",
        text: `主内容比可视区宽 ${scroller.scrollWidth - scroller.clientWidth}px`,
      });
    }
  }

  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.kind}|${issue.text}|${issue.by ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function shot(page, file) {
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, type: "jpeg", quality: 55, animations: "disabled" });
}

async function settle(page) {
  await page.waitForSelector(".demo-root", { timeout: 15000 });
  await page.waitForTimeout(250);
}

async function audit(page) {
  return page.evaluate(layoutProbe);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
      });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("pageerror", (error) => consoleErrors.push(String(error)));
      const dir = path.join(outDir, viewport.name);

      await page.goto(`${baseUrl}#launch`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const dialog = page.locator("dialog.first-run-service-choice");
      if (await dialog.count()) {
        await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
      }
      const firstRunVisible = await dialog.isVisible().catch(() => false);
      if (firstRunVisible) {
        const name = "dialog-first-run";
        await shot(page, path.join(dir, `${name}.jpg`));
        report.push({
          viewport: viewport.name,
          screen: name,
          issues: await audit(page),
          consoleErrors: [...consoleErrors],
        });
        await page.getByRole("button", { name: "暂时离线创作" }).click();
        await page.waitForTimeout(200);
      }

      for (const id of pages) {
        await page.goto(`${baseUrl}#${id}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await shot(page, path.join(dir, `${id}.jpg`));
        report.push({
          viewport: viewport.name,
          screen: id,
          issues: await audit(page),
          consoleErrors: consoleErrors.splice(0),
        });
      }

      await page.goto(`${baseUrl}#home`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const notify = page.getByRole("button", { name: "通知" });
      if (await notify.isVisible().catch(() => false)) {
        await notify.click();
        await page.waitForTimeout(200);
        await shot(page, path.join(dir, "dialog-notify.jpg"));
        report.push({
          viewport: viewport.name,
          screen: "dialog-notify",
          issues: await audit(page),
          consoleErrors: [],
        });
        const close = page.getByRole("button", { name: "关闭对话框" });
        if (await close.isVisible().catch(() => false)) await close.click();
      }

      const menu = page.getByRole("group", { name: "用户菜单" }).locator("summary");
      if (await menu.isVisible().catch(() => false)) {
        await menu.click();
        await page.waitForTimeout(150);
        await shot(page, path.join(dir, "menu-user.jpg"));
        report.push({
          viewport: viewport.name,
          screen: "menu-user",
          issues: await audit(page),
          consoleErrors: [],
        });
        await page.keyboard.press("Escape");
      }

      const assistant = page.getByRole("button", { name: "展开 AI 助手" });
      if (await assistant.isVisible().catch(() => false)) {
        await assistant.click();
        await page.waitForTimeout(200);
        await shot(page, path.join(dir, "drawer-assistant.jpg"));
        report.push({
          viewport: viewport.name,
          screen: "drawer-assistant",
          issues: await audit(page),
          consoleErrors: [],
        });
      }

      await page.goto(`${baseUrl}#services`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const apiTab = page.getByRole("button", { name: "API 连接（高级备用）" });
      const gptTab = page.getByRole("button", { name: "ChatGPT 官方账号" });
      if (await apiTab.isVisible().catch(() => false)) {
        await apiTab.click();
        await page.waitForTimeout(150);
        await shot(page, path.join(dir, "services-api.jpg"));
        report.push({
          viewport: viewport.name,
          screen: "services-api",
          issues: await audit(page),
          consoleErrors: [],
        });
      }
      if (await gptTab.isVisible().catch(() => false)) {
        await gptTab.click();
        await page.waitForTimeout(150);
        await shot(page, path.join(dir, "services-chatgpt.jpg"));
        report.push({
          viewport: viewport.name,
          screen: "services-chatgpt",
          issues: await audit(page),
          consoleErrors: [],
        });
      }

      await context.close();
      const count = report.filter((item) => item.viewport === viewport.name && item.issues.length)
        .length;
      console.log(`${viewport.name}: ${count} screens with issues`);
    }
  } finally {
    await browser.close();
  }

  await mkdir(outDir, { recursive: true });
  const flagged = report.filter((item) => item.issues.length > 0 || item.consoleErrors.length > 0);
  await writeFile(
    path.join(outDir, "report.json"),
    JSON.stringify({ screens: report.length, flagged: flagged.length, flagged }, null, 2),
  );
  console.log(`screens ${report.length}, flagged ${flagged.length}`);
  if (flagged.length > 0) process.exitCode = 1;
}

await main();
