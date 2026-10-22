/**
 * Layout audit for the running studio-web app.
 *
 * Window sizes cover the requested desktop sizes and the CSS-pixel viewports
 * Windows uses at 125% and 150% scaling (a 1920×1080 screen at 150% is 1280×720
 * CSS pixels). deviceScaleFactor matches that scaling; layout uses CSS pixels.
 *
 * The script fails when a control is covered, clipped with no scroll, or its
 * own text is cut off. It also fails when the window, the app shell, or a
 * page panel scrolls, when scrollbars nest, or when a primary action sits
 * below the fold. Sibling cards that overlap, and form controls clipped
 * inside a fixed-height card, fail even when that card can scroll. A list,
 * ledger, or transcript may scroll inside its own panel; that scroll is
 * recorded and is not a failure by itself.
 * Run against `pnpm --filter @aijian/studio-web dev`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.AIVORA_AUDIT_URL ?? "http://127.0.0.1:5173/";
const outDir = process.env.AIVORA_AUDIT_OUT ?? "/tmp/ui-audit/round1";

const viewports = [
  { name: "1920x1080", width: 1920, height: 1080, deviceScaleFactor: 1 },
  { name: "1440x900", width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: "1536x864-win125", width: 1536, height: 864, deviceScaleFactor: 1.25 },
  { name: "1366x768", width: 1366, height: 768, deviceScaleFactor: 1 },
  { name: "1280x720-win150", width: 1280, height: 720, deviceScaleFactor: 1.5 },
  { name: "1093x614-1366-win125", width: 1093, height: 614, deviceScaleFactor: 1.25 },
  { name: "911x512-1366-win150", width: 911, height: 512, deviceScaleFactor: 1.5 },
].filter((viewport) => {
  const wanted = process.env.AIVORA_AUDIT_VIEWPORTS;
  return !wanted || wanted.split(",").includes(viewport.name);
});

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

  const scrollers = [];
  const threshold = 8;
  const candidates = [
    document.documentElement,
    document.body,
    ...document.querySelectorAll("body *"),
  ];
  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue;
    const style = getComputedStyle(el);
    const canY =
      (style.overflowY === "auto" ||
        style.overflowY === "scroll" ||
        style.overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight + threshold;
    const canX =
      (style.overflowX === "auto" || style.overflowX === "scroll") &&
      el.scrollWidth > el.clientWidth + threshold;
    if (!canY && !canX) continue;
    if (el !== document.documentElement && el !== document.body && !visible(el)) continue;
    let nested = false;
    let parent = el.parentElement;
    while (parent) {
      const parentStyle = getComputedStyle(parent);
      if (
        (parentStyle.overflowY === "auto" || parentStyle.overflowY === "scroll") &&
        parent.scrollHeight > parent.clientHeight + threshold
      ) {
        nested = true;
        break;
      }
      parent = parent.parentElement;
    }
    const className = typeof el.className === "string" ? el.className : "";
    const element = `${el.id ? `#${el.id}` : el.tagName.toLowerCase()}${
      className ? `.${className.split(/\s+/).filter(Boolean).slice(0, 2).join(".")}` : ""
    }`.slice(0, 90);
    const entry = {
      element,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      deltaY: el.scrollHeight - el.clientHeight,
      deltaX: el.scrollWidth - el.clientWidth,
      nested,
      horizontal: canX,
      vertical: canY,
    };
    scrollers.push(entry);
    const shell = el.tagName === "NAV" && el.closest(".left-nav");
    const pageScroll =
      el.id === "demo-scroll" ||
      className.includes("page-scroll") ||
      className.includes("v2-launch");
    const doc = el === document.documentElement || el === document.body;
    if (canX) {
      issues.push({
        kind: "horizontal-overflow",
        text: `${element} 横向超出 ${entry.deltaX}px`,
      });
    }
    if (canY && (shell || pageScroll || doc || nested)) {
      issues.push({
        kind: shell
          ? "shell-scroll"
          : pageScroll
            ? "page-scroll"
            : nested
              ? "nested-scroll"
              : "document-scroll",
        text: `${element} 高 ${entry.scrollHeight} / 可视 ${entry.clientHeight}，差 ${entry.deltaY}px`,
      });
    }
  }
  const allowedClip = [
    ".v2-recent-list",
    ".v2-project-rows",
    ".assistant-chat-scroll",
    ".assistant-chat-messages",
    ".v2-cost-rows",
    ".project-cost-ledger",
    ".provider-form-body",
    ".sandbox-body",
    ".v2-profile-content",
    ".v2-settings-categories",
    ".left-nav",
    "[data-scroll-region]",
    "section[aria-label='已连接账号']",
  ].join(",");

  function cardClip(element) {
    if (element.closest(allowedClip)) return null;
    const rect = element.getBoundingClientRect();
    let parent = element.parentElement;
    while (parent && parent !== document.documentElement) {
      const style = getComputedStyle(parent);
      const oy = style.overflowY;
      const clips = oy === "hidden" || oy === "clip" || oy === "auto" || oy === "scroll";
      if (clips) {
        const frame = parent.getBoundingClientRect();
        const outside =
          rect.top < frame.top - 1 ||
          rect.bottom > frame.bottom + 1 ||
          rect.left < frame.left - 1 ||
          rect.right > frame.right + 1;
        if (outside && frame.width > 2 && frame.height > 2) {
          return (
            parent.getAttribute("aria-label") ||
            (typeof parent.className === "string" ? parent.className : parent.tagName)
          ).slice(0, 80);
        }
      }
      parent = parent.parentElement;
    }
    return null;
  }

  for (const element of nodes) {
    if (!(element instanceof HTMLElement) || !visible(element)) continue;
    const formControl = ["SELECT", "INPUT", "TEXTAREA"].includes(element.tagName);
    const primary =
      element.tagName === "BUTTON" &&
      (element.classList.contains("primary") || element.classList.contains("provider-save"));
    if (!formControl && !primary) continue;
    const clip = cardClip(element);
    if (clip) issues.push({ kind: "card-clip", text: labelOf(element), by: clip });
  }

  const cards = [...document.querySelectorAll(".v2-utility-card, details.account-advanced")].filter(
    (element) => element instanceof HTMLElement && visible(element),
  );
  for (const card of cards) {
    if (!(card instanceof HTMLElement)) continue;
    const rect = card.getBoundingClientRect();
    let parent = card.parentElement;
    while (parent && parent !== document.documentElement) {
      const style = getComputedStyle(parent);
      const frame = parent.getBoundingClientRect();
      const outside = rect.top < frame.top - 8 || rect.bottom > frame.bottom + 8;
      if (outside && frame.height > 2) {
        const oy = style.overflowY;
        const canScroll =
          (oy === "auto" || oy === "scroll") && parent.scrollHeight > parent.clientHeight + 2;
        if (canScroll) break;
        if (oy === "hidden" || oy === "clip") {
          const name =
            parent.getAttribute("aria-label") ||
            (typeof parent.className === "string" ? parent.className : parent.tagName);
          issues.push({ kind: "card-clip", text: labelOf(card), by: name.slice(0, 80) });
          break;
        }
      }
      parent = parent.parentElement;
    }
  }
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const a = cards[i];
      const b = cards[j];
      if (!(a instanceof HTMLElement) || !(b instanceof HTMLElement)) continue;
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const width = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const height = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (width > 8 && height > 8) {
        issues.push({ kind: "card-overlap", text: labelOf(a), by: labelOf(b) });
      }
    }
  }

  for (const el of document.querySelectorAll("button, .provider-save")) {
    if (!(el instanceof HTMLElement) || !visible(el)) continue;
    const text = (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim();
    const named = /用 Grok 账号登录$/.test(text) || /^(保存|确认|下一步|新建|创建)/.test(text);
    if (!el.classList.contains("primary") && !el.classList.contains("provider-save") && !named)
      continue;
    if (/^(取消|关闭|上一步)/.test(text)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.top > window.innerHeight - 12 || rect.bottom > window.innerHeight + 8) {
      issues.push({
        kind: "below-fold",
        text: `${text.slice(0, 40)} 在首屏之外（top ${Math.round(rect.top)}）`,
      });
    }
  }

  const seen = new Set();
  return {
    issues: issues.filter((issue) => {
      const key = `${issue.kind}|${issue.text}|${issue.by ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    scrolls: scrollers,
  };
}

async function shot(page, file) {
  if (process.env.AIVORA_AUDIT_SHOTS === "0") return;
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, type: "jpeg", quality: 55, animations: "disabled" });
}

async function settle(page) {
  await page.waitForSelector(".demo-root", { timeout: 15000 });
  await page.waitForTimeout(250);
}

async function audit(page) {
  const result = await page.evaluate(layoutProbe);
  return {
    issues: Array.isArray(result) ? result : (result?.issues ?? []),
    scrolls: Array.isArray(result?.scrolls) ? result.scrolls : [],
  };
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
          ...(await audit(page)),
          consoleErrors: [...consoleErrors],
        });
        await page.getByRole("button", { name: "暂时离线创作" }).click();
        await page.waitForTimeout(200);
      }

      const pageFilter = process.env.AIVORA_AUDIT_PAGES?.split(",").filter(Boolean);
      const pageIds = pageFilter ? pages.filter((id) => pageFilter.includes(id)) : pages;
      for (const id of pageIds) {
        await page.goto(`${baseUrl}#${id}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await shot(page, path.join(dir, `${id}.jpg`));
        report.push({
          viewport: viewport.name,
          screen: id,
          ...(await audit(page)),
          consoleErrors: consoleErrors.splice(0),
        });
      }

      if (!pageFilter) {
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
            ...(await audit(page)),
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
            ...(await audit(page)),
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
            ...(await audit(page)),
            consoleErrors: [],
          });
          const collapse = page.locator(".assistant-collapse");
          if (await collapse.isVisible().catch(() => false)) await collapse.click();
          else await page.keyboard.press("Escape");
          await page.waitForTimeout(150);
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
            ...(await audit(page)),
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
            ...(await audit(page)),
            consoleErrors: [],
          });
        }
      }

      await context.close();
      const here = report.filter((item) => item.viewport === viewport.name);
      const count = here.filter((item) => item.issues.length).length;
      const scrolling = here.filter((item) => item.scrolls.length);
      console.log(
        `${viewport.name}: ${count} screens with issues, ${scrolling.length} screens that scroll`,
      );
      for (const item of scrolling) {
        const parts = item.scrolls.map(
          (entry) =>
            `${entry.element} ${entry.scrollHeight}/${entry.clientHeight} Δ${entry.deltaY}${entry.horizontal ? ` xΔ${entry.deltaX}` : ""}`,
        );
        console.log(`  ${item.screen}: ${parts.join(" | ")}`);
      }
    }
  } finally {
    await browser.close();
  }

  await mkdir(outDir, { recursive: true });
  const flagged = report.filter((item) => item.issues.length > 0 || item.consoleErrors.length > 0);
  const scrolling = report
    .filter((item) => item.scrolls.length > 0)
    .map((item) => ({
      viewport: item.viewport,
      screen: item.screen,
      scrolls: item.scrolls,
      belowFold: item.issues.filter((issue) => issue.kind === "below-fold"),
    }));
  await writeFile(
    path.join(outDir, "report.json"),
    JSON.stringify(
      { screens: report.length, flaggedCount: flagged.length, flagged, scrolling },
      null,
      2,
    ),
  );
  console.log(`screens ${report.length}, flagged ${flagged.length}, scrolling ${scrolling.length}`);
  if (flagged.length > 0) process.exitCode = 1;
}

await main();
