/* global document, getComputedStyle, innerWidth, innerHeight, Node, SVGElement, URL */
/**
 * Layout check for the next/ story pages. For every story and every example state it lists,
 * at each window size: the page does not scroll, nothing sits outside the window, nothing is
 * cut off by a box that does not scroll (one-line text with an ellipsis is fine), no two
 * pieces of text or controls overlap (text drawn on a picture frame, .nx-frame, is meant to),
 * no text is smaller than 12px, every button has a name, and the console stays clean.
 *
 * Start the dev server first, then run from the repository root:
 *   pnpm --filter @aijian/studio-web dev
 *   AIVORA_CHROMIUM=/path/to/chrome node apps/studio-web/src/aivora/next/stories/check-layout.mjs
 * AIVORA_STORIES_URL changes the address; AIVORA_SIZES picks window sizes (default 1280x800).
 */
import process from "node:process";
import console from "node:console";
import { chromium } from "playwright";

const base =
  process.env.AIVORA_STORIES_URL ?? "http://127.0.0.1:5173/src/aivora/next/stories/index.html";
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
];

// Runs inside the page. Returns a list of problems in Chinese.
function inspect() {
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
  if (!document.querySelector(".nx-root")) problems.push("页面上没有组件");

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
    return { el, rects, layer: el.closest(".nx-frame") };
  });
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
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

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.AIVORA_CHROMIUM || undefined,
  });
  let failed = 0;
  try {
    for (const size of sizes) {
      const page = await browser.newPage({ viewport: size });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      for (const story of stories) {
        await page.goto(`${base}?story=${story}`, { waitUntil: "networkidle" });
        const states = await page.$$eval('nav[aria-label="示例状态"] a', (links) =>
          links.map((link) => new URL(link.href).searchParams.get("state")),
        );
        for (const state of states) {
          errors.length = 0;
          await page.goto(`${base}?story=${story}&state=${state}`, { waitUntil: "networkidle" });
          await page.evaluate(() => document.fonts.ready);
          const passes = [["", await page.evaluate(inspect)]];
          // 「高级」 sections are closed at first; check the page again with them open.
          const opened = await page.$$eval("details", (all) => {
            for (const details of all) details.open = true;
            return all.length;
          });
          if (opened > 0) passes.push([" 高级打开", await page.evaluate(inspect)]);
          for (const [label, found] of passes) {
            const problems = [...found, ...errors.map((text) => `控制台：${text}`)];
            const where = `${story} ${state}${label} ${size.width}×${size.height}`;
            if (problems.length === 0) console.log(`✔ ${where}`);
            else {
              failed += 1;
              console.log(`✘ ${where}`);
              for (const problem of problems) console.log(`    - ${problem}`);
            }
          }
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failed === 0 ? "全部通过。" : `有 ${failed} 个页面没通过。`);
  process.exitCode = failed === 0 ? 0 : 1;
}

await main();
