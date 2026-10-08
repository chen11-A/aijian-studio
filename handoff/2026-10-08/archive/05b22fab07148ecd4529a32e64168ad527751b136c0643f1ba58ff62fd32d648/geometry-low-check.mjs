import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "file:///C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs";

const [cssPath, outputPath] = process.argv.slice(2);
if (!cssPath || !outputPath) throw new Error("built CSS and output JSON required");
const css = readFileSync(cssPath, "utf8");
const longSource = "来源正文需要独立滚动，不遮住状态或按钮。".repeat(350);
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}</style>
<style>html,body{margin:0;width:100%;height:100%}.qa-shell{padding:24px;box-sizing:border-box}
.qa-side{width:440px;height:calc(100dvh - 300px)}</style><body><div class="demo-root qa-shell">
<div class="v2-source-side qa-side" id="side">
  <section class="v2-story-card v2-source-preview" id="preview">
    <h2>来源预览</h2>
    <div class="v2-source-excerpt" id="excerpt">${longSource}</div>
    <span class="pill v2-source-built-in" id="source-pill">内置文本 · 样例</span>
    <p class="v2-source-support" role="status" id="status">来源状态：待审核。请核对来源后继续。</p>
    <div class="actions"><button class="button" id="refresh" onclick="this.dataset.clicked='1'">刷新来源状态</button>
      <button class="button" id="confirm" onclick="this.dataset.clicked='1'">确认来源审核基线</button></div>
  </section>
  <section class="v2-story-card" id="privacy"><h2>隐私边界</h2><p>提交后由本地工作区核对来源。</p></section>
</div></div></body></html>`;

const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
try {
  const samples = [];
  for (const [width, height] of [[1424, 720], [1424, 881]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(html);
    const geometry = await page.evaluate(() => {
      const box = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height,
          right: r.right, bottom: r.bottom };
      };
      const side = document.getElementById("side");
      const excerpt = document.getElementById("excerpt");
      const preview = box("preview");
      const inside = (item) => item.x >= preview.x && item.right <= preview.right &&
        item.y >= preview.y && item.bottom <= preview.bottom;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        previewDisplay: getComputedStyle(document.getElementById("preview")).display,
        pillPosition: getComputedStyle(document.getElementById("source-pill")).position,
        sideOverflow: getComputedStyle(side).overflowY,
        sideClientHeight: side.clientHeight, sideScrollHeight: side.scrollHeight,
        excerptClientHeight: excerpt.clientHeight,
        excerptScrollHeight: excerpt.scrollHeight,
        excerptScrollable: excerpt.scrollHeight > excerpt.clientHeight,
        statusInside: inside(box("status")),
        refreshInside: inside(box("refresh")),
        confirmInside: inside(box("confirm")),
        preview, status: box("status"), refresh: box("refresh"),
        confirm: box("confirm"), privacy: box("privacy"),
      };
    });
    await page.screenshot({ path: outputPath.replace(/\.json$/, `-${width}x${height}.png`) });
    await page.locator("#refresh").click();
    await page.locator("#confirm").click();
    const clicks = await page.evaluate(() => ({
      refresh: document.getElementById("refresh").dataset.clicked === "1",
      confirm: document.getElementById("confirm").dataset.clicked === "1",
    }));
    const focusSequence = [];
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press("Tab");
      focusSequence.push(await page.evaluate(() => document.activeElement?.id ?? null));
    }
    const passed = geometry.previewDisplay === "grid" &&
      geometry.pillPosition === "static" && geometry.excerptScrollable &&
      geometry.excerptClientHeight >= 100 && geometry.statusInside &&
      geometry.refreshInside && geometry.confirmInside &&
      clicks.refresh && clicks.confirm;
    samples.push({ geometry, clicks, focusSequence, passed });
    await page.close();
  }
  const result = { cssPath, scope: "isolated DOM using built CSS; Electron page untested", samples };
  writeFileSync(outputPath, JSON.stringify(result, null, 2), { flag: "wx" });
  process.stdout.write(JSON.stringify({ passed: samples.every((item) => item.passed), samples }) + "\n");
  if (!samples.every((item) => item.passed)) process.exitCode = 1;
} finally {
  await browser.close();
}
