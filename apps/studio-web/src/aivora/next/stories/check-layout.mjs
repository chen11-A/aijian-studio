/* global document, getComputedStyle, innerWidth, innerHeight, Node, SVGElement, URL, localStorage */
/**
 * Layout check for the next/ story pages and for the whole workspace. It looks at every state
 * of every story, then at the workspace pages with the test novel loaded (adapters/
 * novelProject.ts): 首页, 剧本, 角色与场景, 分镜, 单镜, 剪辑, the export dialog and the task
 * center. On 分镜 it also opens 「更多」 and checks that Esc and a press outside close it (UIR-01).
 * At each window size it checks that the page does not scroll, nothing sits outside
 * the window, nothing is cut off by a box that does not scroll (one-line text with an ellipsis
 * is fine, and so is text cut to a few lines whose tooltip holds all of it), no two pieces of
 * text or controls overlap (a dialog or menu over the page is fine; so is text drawn on a
 * picture frame, .nx-frame or [data-layer]), no text is smaller than 12px, every button has a
 * name, the console stays clean, and each workspace page shows at most one filled primary
 * button outside dialogs (4A-U09).
 *
 * Start the dev server first, then run from the repository root:
 *   pnpm --filter @aijian/studio-web dev
 *   AIVORA_CHROMIUM=/path/to/chrome node apps/studio-web/src/aivora/next/stories/check-layout.mjs
 * AIVORA_SIZES picks window sizes (default 1280x800). AIVORA_ONLY=stories or pages runs one
 * half; AIVORA_PAGES=剧本,分镜 checks only those workspace pages (the others are still
 * walked through, since each page starts where the last one left off). AIVORA_SHOTS=<folder>
 * saves a screenshot of every workspace page. AIVORA_STORIES_URL and AIVORA_APP_URL change the
 * addresses.
 */
import { mkdir } from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import { chromium } from "playwright";

const base =
  process.env.AIVORA_STORIES_URL ?? "http://127.0.0.1:5173/src/aivora/next/stories/index.html";
const app = process.env.AIVORA_APP_URL ?? "http://127.0.0.1:5173/";
const only = process.env.AIVORA_ONLY ?? "";
const shots = process.env.AIVORA_SHOTS ?? "";
const pickedPages = (process.env.AIVORA_PAGES ?? "").split(",").filter(Boolean);
const sizes = (process.env.AIVORA_SIZES ?? "1280x800").split(",").map((size) => {
  const [width, height] = size.split("x").map(Number);
  return { width, height };
});
const stories = [
  "task-center",
  "export-check",
  "sound-panel",
  "take-picker",
  "subtitle-style",
  "cover-editor",
  "pipeline-steps",
  "suggestion-card",
];

// Runs inside the page. Returns a list of problems in Chinese.
function inspect(rootSelector) {
  const OVERLAYS = ".dialog-back, .menu, [data-overlay]";
  const problems = [];
  const describe = (el) => {
    const cls =
      typeof el.className === "string" && el.className
        ? `.${el.className.trim().split(/\s+/).join(".")}`
        : "";
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24);
    return `<${el.tagName.toLowerCase()}${cls}>${text ? ` 「${text}」` : ""}`;
  };
  const shown = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      // A closed <details> draws only its <summary>.
      const parent = node.parentElement;
      if (parent?.tagName === "DETAILS" && !parent.open && node.tagName !== "SUMMARY") return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const scrolls = (style) => /(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`);
  const insideScroller = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (scrolls(getComputedStyle(node))) return true;
    }
    return false;
  };
  const clipsAt = (el) => {
    let box = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (
      let node = el.parentElement;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        const rect = node.getBoundingClientRect();
        box = {
          left: Math.max(box.left, rect.left),
          top: Math.max(box.top, rect.top),
          right: Math.min(box.right, rect.right),
          bottom: Math.min(box.bottom, rect.bottom),
        };
      }
    }
    return box;
  };

  const root = document.scrollingElement ?? document.documentElement;
  if (root.scrollWidth > innerWidth + 1 || root.scrollHeight > innerHeight + 1) {
    problems.push(
      `整页滚动：内容 ${root.scrollWidth}×${root.scrollHeight}，窗口 ${innerWidth}×${innerHeight}`,
    );
  }
  if (!document.querySelector(rootSelector)) problems.push(`页面上没有 ${rootSelector}`);

  const elements = [...document.body.querySelectorAll("*")].filter(
    (el) => !(el instanceof SVGElement) && shown(el),
  );
  for (const el of elements) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!insideScroller(el) && style.position !== "fixed") {
      if (
        rect.left < -1 ||
        rect.top < -1 ||
        rect.right > innerWidth + 1 ||
        rect.bottom > innerHeight + 1
      ) {
        problems.push(`超出窗口：${describe(el)}`);
      }
    }
    if (el.clientWidth === 0 && el.clientHeight === 0) continue;
    if (["INPUT", "SELECT", "TEXTAREA", "OPTION", "IMG"].includes(el.tagName)) continue;
    // Text cut to a few lines with an ellipsis is meant to be, when hovering shows all of it.
    const clamp = style.webkitLineClamp;
    const title = el.getAttribute("title")?.trim();
    if (clamp && clamp !== "none" && title && title === el.textContent.trim()) continue;
    const slackX = style.overflowX === "visible" ? 3 : 1;
    const slackY = style.overflowY === "visible" ? 3 : 1;
    if (el.scrollWidth > el.clientWidth + slackX && !/(auto|scroll)/.test(style.overflowX)) {
      if (style.textOverflow !== "ellipsis") {
        problems.push(`横向放不下：${describe(el)}（${el.scrollWidth}>${el.clientWidth}）`);
      }
    }
    if (el.scrollHeight > el.clientHeight + slackY && !/(auto|scroll)/.test(style.overflowY)) {
      problems.push(`纵向放不下：${describe(el)}（${el.scrollHeight}>${el.clientHeight}）`);
    }
  }

  const ownText = (el) =>
    [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  const leaves = elements.filter(
    (el) =>
      ownText(el) || ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(el.tagName),
  );
  for (const el of leaves) {
    if (ownText(el) && parseFloat(getComputedStyle(el).fontSize) < 12) {
      problems.push(`字号小于 12px：${describe(el)}`);
    }
  }
  for (const button of elements.filter((el) => el.tagName === "BUTTON")) {
    const name = (
      button.getAttribute("aria-label") ||
      (button.getAttribute("aria-labelledby") &&
        document.getElementById(button.getAttribute("aria-labelledby"))?.textContent) ||
      button.textContent ||
      ""
    ).trim();
    if (!name) problems.push(`按钮没有名字：${describe(button)}`);
  }

  const boxes = leaves.map((el) => {
    const clip = clipsAt(el);
    const rects = [...el.getClientRects()]
      .map((rect) => ({
        left: Math.max(rect.left, clip.left),
        top: Math.max(rect.top, clip.top),
        right: Math.min(rect.right, clip.right),
        bottom: Math.min(rect.bottom, clip.bottom),
      }))
      .filter((rect) => rect.right - rect.left > 0.5 && rect.bottom - rect.top > 0.5);
    return {
      el,
      rects,
      layer: el.closest(".nx-frame, [data-layer]"),
      overlay: el.closest(OVERLAYS),
    };
  });
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.layer && a.layer === b.layer) continue;
      // A dialog or a menu covers the page on purpose; what lies under it is checked alone.
      if (a.overlay !== b.overlay) continue;
      const hit = a.rects.some((ra) =>
        b.rects.some(
          (rb) =>
            Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 1.5 &&
            Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 1.5,
        ),
      );
      if (hit) problems.push(`重叠：${describe(a.el)} 和 ${describe(b.el)}`);
    }
  }
  return problems;
}

/** Checks the page as it is now, then again with every 「高级」 section open. */
async function inspectPage(page, rootSelector) {
  await page.evaluate(() => document.fonts.ready);
  const passes = [["", await page.evaluate(inspect, rootSelector)]];
  const opened = await page.$$eval("details", (all) => {
    for (const details of all) details.open = true;
    return all.length;
  });
  if (opened > 0) passes.push([" 高级打开", await page.evaluate(inspect, rootSelector)]);
  return passes;
}

function watchConsole(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

function report(where, found, errors) {
  const problems = [...found, ...errors.map((text) => `控制台：${text}`)];
  if (problems.length === 0) console.log(`✔ ${where}`);
  else {
    console.log(`✘ ${where}`);
    for (const problem of problems) console.log(`    - ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}

async function checkStories(browser, size) {
  let failed = 0;
  const page = await browser.newPage({ viewport: size });
  const errors = watchConsole(page);
  for (const story of stories) {
    await page.goto(`${base}?story=${story}`, { waitUntil: "networkidle" });
    const states = await page.$$eval('nav[aria-label="示例状态"] a', (links) =>
      links.map((link) => new URL(link.href).searchParams.get("state")),
    );
    for (const state of states) {
      errors.length = 0;
      await page.goto(`${base}?story=${story}&state=${state}`, { waitUntil: "networkidle" });
      for (const [label, found] of await inspectPage(page, ".nx-root")) {
        failed += report(`${story} ${state}${label} ${size.width}×${size.height}`, found, errors);
      }
    }
  }
  await page.close();
  return failed;
}

/**
 * The workspace pages, in the order a user meets them. Each step gets the page to its state;
 * the next step starts from there. The backend is not running, so its address answers empty.
 */
const pages = [
  {
    name: "首页",
    async open(page) {
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: "networkidle" });
    },
  },
  {
    name: "剧本",
    async open(page) {
      await page.evaluate(async () => {
        const { novelProject } = await import("/src/aivora/next/adapters/novelProject.ts");
        const { FILM_KEY } = await import("/src/aivora/film/project.ts");
        localStorage.setItem(FILM_KEY, JSON.stringify(novelProject()));
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("nav.tabs").getByRole("button", { name: "剧本" }).click();
    },
    // 3J-U03: the chat keeps at least 60% of the assistant column.
    rules: () => {
      const pane = document.querySelector(".pane.ai")?.getBoundingClientRect();
      const chat = document.querySelector(".pane.ai .pb.chat")?.getBoundingClientRect();
      if (!pane || !chat) return ["找不到 AI 助手的聊天区"];
      const share = Math.round((chat.height / pane.height) * 100);
      return share >= 60 ? [] : [`聊天区只占右栏 ${share}% 高，要不少于 60%`];
    },
  },
  { name: "角色与场景", tab: "角色与场景" },
  {
    name: "分镜",
    tab: "分镜",
    // UIR-01: 「更多」 closes on Esc and on a press on an empty part of the page.
    async act(page) {
      const problems = [];
      const more = page.getByRole("button", { name: "更多操作" });
      const menu = page.getByRole("menu", { name: "这一镜的更多操作" });
      await more.click();
      if (!(await menu.isVisible())) problems.push("点「更多」没有打开菜单");
      await page.keyboard.press("Escape");
      if (await menu.isVisible()) problems.push("按 Esc 以后「更多」菜单还在");
      await more.click();
      await page.locator(".pane .tool h3").first().click();
      if (await menu.isVisible()) problems.push("点页面空白处以后「更多」菜单还在");
      return problems;
    },
  },
  { name: "单镜", button: "单镜" },
  { name: "剪辑", tab: "剪辑" },
  { name: "导出对话框", button: "导出成片", close: "关闭" },
  { name: "任务中心", button: /后台生成/ },
];

// 4A-U09: one filled primary button per screen; a dialog's own buttons do not count.
function onePrimary() {
  const shown = [...document.querySelectorAll(".pro-root .btn.primary")].filter((el) => {
    if (el.closest(".dialog, [role=dialog]")) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
  });
  if (shown.length <= 1) return [];
  const names = shown.map((el) => `「${(el.textContent || "").replace(/\s+/g, " ").trim()}」`);
  return [`一屏有 ${shown.length} 个主按钮：${names.join("、")}`];
}

async function checkPages(browser, size) {
  let failed = 0;
  const page = await browser.newPage({ viewport: size });
  const errors = watchConsole(page);
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({ json: { data: { connections: [] } } }),
  );
  await page.goto(app, { waitUntil: "networkidle" });
  if (shots) await mkdir(shots, { recursive: true });
  for (const step of pages) {
    errors.length = 0;
    if (step.open) await step.open(page);
    if (step.tab) await page.locator("nav.tabs").getByRole("button", { name: step.tab }).click();
    if (step.button) await page.getByRole("button", { name: step.button }).first().click();
    await page.waitForLoadState("networkidle");
    const picked = pickedPages.length === 0 || pickedPages.includes(step.name);
    if (!picked) {
      if (step.close) await page.getByRole("button", { name: step.close }).first().click();
      continue;
    }
    if (shots) {
      await page.screenshot({ path: `${shots}/${step.name}-${size.width}x${size.height}.png` });
    }
    const extra = [
      ...(step.rules ? await page.evaluate(step.rules) : []),
      ...(await page.evaluate(onePrimary)),
    ];
    for (const [label, found] of await inspectPage(page, ".pro-root")) {
      const where = `页面 ${step.name}${label} ${size.width}×${size.height}`;
      failed += report(where, label ? found : [...found, ...extra], errors);
    }
    if (step.act) {
      const acted = await step.act(page);
      failed += report(`页面 ${step.name} 菜单 ${size.width}×${size.height}`, acted, []);
    }
    if (step.close) await page.getByRole("button", { name: step.close }).first().click();
  }
  await page.close();
  return failed;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.AIVORA_CHROMIUM || undefined,
  });
  let failed = 0;
  try {
    for (const size of sizes) {
      if (only !== "pages") failed += await checkStories(browser, size);
      if (only !== "stories") failed += await checkPages(browser, size);
    }
  } finally {
    await browser.close();
  }
  console.log(failed === 0 ? "全部通过。" : `有 ${failed} 个页面没通过。`);
  process.exitCode = failed === 0 ? 0 : 1;
}

await main();
