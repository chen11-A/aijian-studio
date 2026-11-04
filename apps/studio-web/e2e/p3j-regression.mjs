/** Real Chromium UI regression; desktop image calls are replaced, no supplier is called. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.AIVORA_AUDIT_URL ?? "http://127.0.0.1:5173/";
const out = process.env.AIVORA_AUDIT_OUT ?? "/tmp/p3j-browser";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIVORA_CHROMIUM ? { executablePath: process.env.AIVORA_CHROMIUM } : {}),
});
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({ json: { data: { connections: [] } } }),
  );
  await page.addInitScript(() => {
    window.__imageCalls = [];
    window.__holdImages = false;
    window.__imageRelease = null;
    window.aijian = {
      generateFilmStill: async (...args) => {
        window.__imageCalls.push(args);
        if (window.__holdImages)
          await new Promise((resolve) => {
            window.__imageRelease = resolve;
          });
        return {
          path: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5XcAAAAASUVORK5CYII=",
        };
      },
    };
  });
  await page.goto(base);
  await page.evaluate(async () => {
    const { sampleFilm, FILM_KEY } = await import("/src/aivora/film/project.ts");
    const film = sampleFilm();
    film.shots = Array.from({ length: 13 }, (_, index) => ({
      ...film.shots[index % film.shots.length],
      id: `layout-${index}`,
      no: index + 1,
      picture: "雨落在旧书店的窗沿，人物停下脚步，望向门口。".repeat(12),
      performance: "凝视门口后缓缓转头，眼神中带着疑问。".repeat(8),
    }));
    window.localStorage.setItem(FILM_KEY, JSON.stringify(film));
  });
  await page.reload();
  await page.locator("nav.tabs").getByRole("button", { name: /分镜/ }).click();
  await page.locator(".scene").filter({ hasText: "巷战·初交手" }).click();
  await page.locator(".pb.grid .card").nth(12).waitFor();
  const cards = await page.locator(".pb.grid .card").evaluateAll((elements) =>
    elements.map((card) => {
      const box = card.getBoundingClientRect();
      const siblingOverlap = elements.some((other) => {
        if (other === card) return false;
        const otherBox = other.getBoundingClientRect();
        return (
          Math.min(box.right, otherBox.right) - Math.max(box.left, otherBox.left) > 1 &&
          Math.min(box.bottom, otherBox.bottom) - Math.max(box.top, otherBox.top) > 1
        );
      });
      const texts = [...card.querySelectorAll(".cb > p")];
      const tags = card.querySelector(".shot-tags").getBoundingClientRect();
      return {
        noSiblingOverlap: !siblingOverlap,
        clamp: texts.every((p) => getComputedStyle(p).webkitLineClamp === "3"),
        tooltips: texts.every((p) => p.title === p.textContent),
        noOverlap: texts.every((p) => p.getBoundingClientRect().bottom <= tags.top + 1),
        tagsInside: tags.bottom <= box.bottom + 1,
      };
    }),
  );
  await page.screenshot({ path: `${out}/board-1280x800.png` });
  assert.equal(cards.length, 13);
  const cardsPass = cards.every((card) => Object.values(card).every(Boolean));
  results.push({
    check: "13 long shot cards: three lines, full tooltips, separate unobscured tags",
    cards,
  });
  await page.screenshot({ path: `${out}/board-1280x800.png` });
  await page.evaluate(() => {
    window.__holdImages = true;
  });
  await page.getByRole("button", { name: "生成画面", exact: true }).click();
  await page.waitForFunction(() => window.__imageCalls.length === 1);
  assert.equal(await page.locator(".card.sel .badge").innerText(), "正在生成画面");
  assert.equal(
    await page.getByRole("button", { name: "正在生成画面", exact: true }).isDisabled(),
    true,
  );
  await page.screenshot({ path: `${out}/still-progress-1280x800.png` });
  await page.evaluate(() => {
    window.__holdImages = false;
    window.__imageRelease();
  });
  await page.getByRole("button", { name: "生成画面", exact: true }).waitFor();
  results.push({
    check: "first image click invokes bridge exactly once and displays card progress",
    pass: true,
  });
  await page
    .locator("nav.tabs")
    .getByRole("button", { name: /角色与场景/ })
    .click();
  const appearance = page.getByRole("textbox", { name: "外貌", exact: true });
  assert.equal(await appearance.getAttribute("rows"), "4");
  assert.ok((await appearance.boundingBox()).height >= 80);
  await page.getByRole("button", { name: "生成定妆照", exact: true }).click();
  await page.waitForFunction(() => window.__imageCalls.length === 5);
  await page.getByRole("button", { name: "生成定妆照", exact: true }).waitFor();
  await page.getByRole("button", { name: "补全缺少的定妆照", exact: true }).click();
  await page.waitForFunction(() => window.__imageCalls.length === 9);
  await page.getByRole("button", { name: "生成定妆照", exact: true }).waitFor();
  results.push({
    check: "one click generates four portraits; batch fills remaining character including face",
    imageCalls: 9,
  });
  await page.screenshot({ path: `${out}/cast-1280x800.png` });
  await page.locator("nav.tabs").getByRole("button", { name: /分镜/ }).click();
  await page.getByRole("button", { name: "生成画面", exact: true }).click();
  await page.waitForFunction(() => window.__imageCalls.length === 10);
  const references = await page.evaluate(() => window.__imageCalls[9][3]);
  // Mock images deliberately share a URL; references are deduplicated before sending.
  assert.equal(references.length, 1);
  assert.ok(references[0].startsWith("data:image/png;base64,"));
  results.push({
    check: "first-frame request explicitly receives completed portrait references",
    count: references.length,
  });
  await page.locator("nav.tabs").getByRole("button", { name: /剧本/ }).click();
  await page.getByRole("button", { name: "让导演拆镜头", exact: true }).click();
  await page.getByRole("button", { name: "写入分镜", exact: true }).waitFor();
  await page
    .locator("nav.tabs")
    .getByRole("button", { name: /角色与场景/ })
    .click();
  assert.equal(await page.getByRole("button", { name: "写入分镜", exact: true }).count(), 0);
  assert.equal(await page.getByText(/建议拆成 \d+ 个镜头/).count(), 0);
  await page.locator("nav.tabs").getByRole("button", { name: /剧本/ }).click();
  assert.equal(await page.getByRole("button", { name: "写入分镜", exact: true }).count(), 0);
  await page.getByRole("button", { name: "让导演拆镜头", exact: true }).click();
  await page.getByRole("button", { name: "写入分镜", exact: true }).waitFor();
  await page.locator(".scene").filter({ hasText: "雨夜·巷口" }).click();
  assert.equal(await page.getByRole("button", { name: "写入分镜", exact: true }).count(), 0);
  results.push({ check: "director suggestions expire on page and scene changes", pass: true });
  await page.getByRole("button", { name: "导出成片", exact: true }).click();
  const exportPath =
    "C:\\Users\\作者\\Documents\\AIVORA\\一个很长的作品名称\\长篇小说改编工程\\最终导出\\第001集";
  await page.getByRole("textbox", { name: "导出文件夹" }).fill(exportPath);
  const pathLabel = page.locator(".export-path");
  assert.equal(await pathLabel.getAttribute("title"), exportPath);
  assert.ok((await pathLabel.innerText()).includes("…"));
  assert.ok((await pathLabel.innerText()).endsWith("第001集"));
  await page.screenshot({ path: `${out}/export-1280x800.png` });
  results.push({ check: "export path middle ellipsis with full hover title", pass: true });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator("nav.tabs").getByRole("button", { name: /分镜/ }).click();
  await page.locator(".scene").filter({ hasText: "巷战·初交手" }).click();
  await writeFile(`${out}/board-1280x800.aria.txt`, await page.locator(".pro-root").ariaSnapshot());
  await page.getByRole("button", { name: "生成画面", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "出 4 张候选",
  );
  assert.equal(
    await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    true,
  );
  results.push({ check: "keyboard next action focus and reduced-motion preference", pass: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `${out}/board-${viewport.width}x${viewport.height}.png` });
    const metrics = await page.evaluate(() => ({
      width: window.innerWidth,
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      clippedControls: [...document.querySelectorAll("button,input,select,textarea")].filter(
        (element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 && box.height > 0 && (box.left < -1 || box.right > window.innerWidth + 1)
          );
        },
      ).length,
    }));
    results.push({
      check: "additional viewport observation",
      viewport,
      metrics,
      supportedDesktop: viewport.width >= 980,
      note:
        viewport.width < 980
          ? "390px is below the documented desktop minimum; observation only, not a mobile acceptance pass"
          : "desktop screenshot",
    });
  }
  assert.deepEqual(errors, []);
  assert.ok(cardsPass, JSON.stringify(cards));
  results.push({ check: "browser console errors/warnings and page errors", errors });
  await writeFile(
    `${out}/results.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        provider: "mock desktop image bridge",
        input:
          "repository sample film with synthetic repeated long descriptions; no user novel or credentials",
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
