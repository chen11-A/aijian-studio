/* global document, getComputedStyle, innerWidth, innerHeight, Node, SVGElement */
/**
 * Opens every prototype in docs/design at 1280×800 and 1920×1080, in every state the page
 * lists in body[data-states], and reports layout problems:
 *   - the page itself scrolls, or an element sits outside the window;
 *   - content is cut off by a box that does not scroll (single-line text with an ellipsis
 *     and text with a set line clamp are allowed);
 *   - two pieces of text or two controls overlap (children of one [data-layer] or [data-art]
 *     box may, for example a subtitle drawn over a preview frame);
 *   - text smaller than 12px, or a button without a name.
 * With --shots it also writes JPEG screenshots to docs/design/screenshots.
 *
 * playwright-core is a root devDependency; it does not download a browser. Set
 * AIVORA_CHROMIUM to a Chromium or Chrome executable. AIVORA_PLAYWRIGHT may point at another
 * playwright-core folder when the repository's node_modules is not installed.
 *
 *   AIVORA_CHROMIUM=/path/to/chrome node docs/design/tools/check-layout.mjs --shots
 */
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { join, resolve } from "node:path";
import process from "node:process";
import console from "node:console";

const DESIGN = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SIZES = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

const args = new Set(process.argv.slice(2));
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);

// Runs inside the page. Returns a list of Chinese problem descriptions.
function inspect() {
  const problems = [];
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls =
      typeof el.className === "string" && el.className
        ? `.${el.className.trim().split(/\s+/).join(".")}`
        : "";
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24);
    return `<${el.tagName.toLowerCase()}${id}${cls}>${text ? ` 「${text}」` : ""}`;
  };
  const shown = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const scrolls = (style) => /(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`);
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
  const insideScroller = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (scrolls(getComputedStyle(node))) return true;
    }
    return false;
  };

  const root = document.documentElement;
  if (root.scrollWidth > innerWidth + 1 || root.scrollHeight > innerHeight + 1) {
    problems.push(
      `页面整体超出窗口：内容 ${root.scrollWidth}×${root.scrollHeight}，窗口 ${innerWidth}×${innerHeight}`,
    );
  }

  const elements = [...document.body.querySelectorAll("*")].filter(
    (el) => !(el instanceof SVGElement) && shown(el),
  );
  for (const el of elements) {
    if (el.closest("[data-art]")) continue;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!insideScroller(el) && getComputedStyle(el).position !== "fixed") {
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
    if (["INPUT", "SELECT", "TEXTAREA", "OPTION"].includes(el.tagName)) continue;
    // A box that clips must hold its content; a visible box may let glyphs spill by 3px.
    const slackX = style.overflowX === "visible" ? 3 : 1;
    const slackY = style.overflowY === "visible" ? 3 : 1;
    if (el.scrollWidth > el.clientWidth + slackX && !/(auto|scroll)/.test(style.overflowX)) {
      if (style.textOverflow !== "ellipsis")
        problems.push(`横向放不下：${describe(el)}（${el.scrollWidth}>${el.clientWidth}）`);
    }
    const clamped = style.webkitLineClamp && style.webkitLineClamp !== "none";
    if (
      el.scrollHeight > el.clientHeight + slackY &&
      !/(auto|scroll)/.test(style.overflowY) &&
      !clamped
    ) {
      problems.push(`纵向放不下：${describe(el)}（${el.scrollHeight}>${el.clientHeight}）`);
    }
  }

  const ownText = (el) =>
    [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  const leaves = elements.filter(
    (el) =>
      !el.closest("[inert]") &&
      (ownText(el) || ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)),
  );
  for (const el of leaves) {
    if (ownText(el) && parseFloat(getComputedStyle(el).fontSize) < 12) {
      problems.push(`字号小于 12px：${describe(el)}`);
    }
  }
  for (const button of elements.filter((el) => el.tagName === "BUTTON")) {
    const name = (button.getAttribute("aria-label") || button.textContent || "").trim();
    if (!name) problems.push(`按钮没有名字：${describe(button)}`);
  }

  const visibleRects = leaves.map((el) => {
    const clip = clipsAt(el);
    const rects = [...el.getClientRects()]
      .map((rect) => ({
        left: Math.max(rect.left, clip.left),
        top: Math.max(rect.top, clip.top),
        right: Math.min(rect.right, clip.right),
        bottom: Math.min(rect.bottom, clip.bottom),
      }))
      .filter((rect) => rect.right - rect.left > 0.5 && rect.bottom - rect.top > 0.5);
    return { el, rects, layer: el.closest("[data-layer], [data-art]") };
  });
  for (let i = 0; i < visibleRects.length; i += 1) {
    for (let j = i + 1; j < visibleRects.length; j += 1) {
      const a = visibleRects[i];
      const b = visibleRects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.layer && a.layer === b.layer) continue;
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

/** AIVORA_PLAYWRIGHT may name the playwright-core folder or its index.js. */
function playwrightEntry() {
  const where = process.env.AIVORA_PLAYWRIGHT;
  if (!where) return "playwright-core";
  const path = resolve(where);
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "index.js") : path;
  return pathToFileURL(file).href;
}

async function loadChromium() {
  const module = await import(playwrightEntry());
  const chromium = module.chromium ?? module.default.chromium;
  return chromium.launch({ executablePath: process.env.AIVORA_CHROMIUM || undefined });
}

async function main() {
  const pages = (await readdir(DESIGN))
    .filter((name) => /^[0-9]{2}-.+\.html$/.test(name))
    .filter((name) => !only || name.startsWith(only))
    .sort();
  if (args.has("--shots")) await mkdir(join(DESIGN, "screenshots"), { recursive: true });
  const browser = await loadChromium();
  let failed = 0;
  try {
    for (const name of pages) {
      const base = pathToFileURL(join(DESIGN, name)).href;
      for (const size of SIZES) {
        const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const errors = [];
        page.on("console", (message) => {
          if (["error", "warning"].includes(message.type()))
            errors.push(`控制台：${message.text()}`);
        });
        page.on("pageerror", (error) => errors.push(`脚本错误：${error.message}`));
        await page.goto(base);
        const states = (await page.evaluate(() => document.body.dataset.states || "normal")).split(
          /\s+/,
        );
        for (const state of states) {
          await page.goto(`${base}?state=${state}`);
          await page.evaluate(() => document.fonts.ready);
          const problems = [...errors, ...(await page.evaluate(inspect))];
          errors.length = 0;
          const label = `${name} ${state} ${size.width}×${size.height}`;
          if (problems.length === 0) console.log(`✔ ${label}`);
          else {
            failed += 1;
            console.log(`✘ ${label}`);
            for (const problem of problems.slice(0, 20)) console.log(`    ${problem}`);
            if (problems.length > 20) console.log(`    …还有 ${problems.length - 20} 条`);
          }
          const wantShot = state === states[0] || size.width === 1280;
          if (args.has("--shots") && wantShot) {
            const stem = name.replace(/\.html$/, "");
            const suffix = state === states[0] ? "" : `-${state}`;
            await page.screenshot({
              path: join(
                DESIGN,
                "screenshots",
                `${stem}${suffix}-${size.width}x${size.height}.jpg`,
              ),
              type: "jpeg",
              quality: 86,
            });
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(failed === 0 ? "全部通过。" : `${failed} 处没有通过。`);
  process.exitCode = failed === 0 ? 0 : 1;
}

await main();
