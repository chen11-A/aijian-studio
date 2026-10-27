/**
 * No page scroll and no horizontal clip on the professional workspace.
 * Run against the studio-web dev server.
 */
import { chromium } from "playwright";

const base = process.env.AIVORA_AUDIT_URL ?? "http://127.0.0.1:5173/";
const viewports = [
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1920x1080", width: 1920, height: 1080 },
];
const stages = ["剧本", "角色与场景", "分镜", "剪辑"];

const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await page.goto(base, { waitUntil: "networkidle" });
    const empty = await page.evaluate(() => ({
      rootScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      bodyScroll: document.body.scrollHeight - document.body.clientHeight,
    }));
    if (empty.rootScroll > 1 || empty.bodyScroll > 1) {
      failures.push({ viewport: viewport.name, stage: "empty", metrics: empty });
    }
    await page.getByRole("button", { name: "打开示例" }).click();
    for (const stage of stages) {
      await page.locator("nav.tabs").getByRole("button", { name: stage }).click();
      if (stage === "分镜") await page.getByRole("button", { name: "单镜" }).click();
      if (stage === "剪辑") {
        await page.locator(".bin .it").nth(4).click();
      }
      const metrics = await page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        const shell = document.querySelector(".pro-root");
        const box = shell?.getBoundingClientRect();
        return {
          rootScroll: root.scrollHeight - root.clientHeight,
          bodyScroll: body.scrollHeight - body.clientHeight,
          shellRight: box ? box.right - window.innerWidth : 0,
          shellBottom: box ? box.bottom - window.innerHeight : 0,
        };
      });
      const bad =
        metrics.rootScroll > 1 ||
        metrics.bodyScroll > 1 ||
        metrics.shellRight > 1 ||
        metrics.shellBottom > 1;
      if (bad) failures.push({ viewport: viewport.name, stage, metrics });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log("pro layout ok");
