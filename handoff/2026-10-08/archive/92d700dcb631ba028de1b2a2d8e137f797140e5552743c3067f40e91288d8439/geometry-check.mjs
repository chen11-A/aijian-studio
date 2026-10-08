import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "file:///C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs";

const [cssPath, outputPath] = process.argv.slice(2);
if (!cssPath || !outputPath) throw new Error("Usage: node geometry-check.mjs <built-css> <output-json>");
const css = readFileSync(cssPath, "utf8");
const longSource = "来源正文需要独立滚动，不遮住状态或按钮。".repeat(350);
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}</style>
<style>html,body{margin:0;width:100%;height:100%}.qa-shell{padding:24px;box-sizing:border-box}
.qa-side{width:440px;height:536px}</style><body><div class="demo-root qa-shell">
<div class="v2-source-side qa-side">
  <section class="v2-story-card v2-source-preview" id="preview">
    <h2>来源预览</h2>
    <div class="v2-source-excerpt" id="excerpt">${longSource}</div>
    <span class="pill v2-source-built-in" id="source-pill">内置文本 · 样例</span>
    <p class="v2-source-support" role="status" id="status">来源状态：待审核。请核对来源后继续。</p>
    <div class="actions"><button class="button" id="refresh">刷新来源状态</button>
      <button class="button" id="confirm">确认来源审核基线</button></div>
  </section>
  <section class="v2-story-card" id="privacy"><h2>隐私边界</h2><p>提交后由本地工作区核对来源。</p></section>
</div></div></body></html>`;

const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1424, height: 881 } });
  await page.setContent(html);
  const geometry = await page.evaluate(() => {
    const box = (id) => {
      const node = document.getElementById(id);
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height,
        right: r.right, bottom: r.bottom };
    };
    const excerpt = document.getElementById("excerpt");
    const preview = box("preview");
    const status = box("status");
    const refresh = box("refresh");
    const confirm = box("confirm");
    const privacy = box("privacy");
    const inside = (child) => child.x >= preview.x && child.right <= preview.right &&
      child.y >= preview.y && child.bottom <= preview.bottom;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      previewDisplay: getComputedStyle(document.getElementById("preview")).display,
      pillPosition: getComputedStyle(document.getElementById("source-pill")).position,
      excerptOverflow: getComputedStyle(excerpt).overflowY,
      excerptClientHeight: excerpt.clientHeight,
      excerptScrollHeight: excerpt.scrollHeight,
      excerptScrollable: excerpt.scrollHeight > excerpt.clientHeight,
      statusInside: inside(status), refreshInside: inside(refresh),
      confirmInside: inside(confirm), privacyBelow: privacy.y >= preview.bottom,
      preview, status, refresh, confirm, privacy,
    };
  });
  await page.screenshot({ path: outputPath.replace(/\.json$/, ".png") });
  const focusSequence = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    focusSequence.push(await page.evaluate(() => document.activeElement?.id ?? null));
  }
  const result = { cssPath, scope: "isolated component DOM with actual built CSS; Electron page remains untested",
    geometry, focusSequence };
  writeFileSync(outputPath, JSON.stringify(result, null, 2), { flag: "wx" });
  const passed = geometry.previewDisplay === "grid" && geometry.pillPosition === "static" &&
    geometry.excerptScrollable && geometry.statusInside && geometry.refreshInside &&
    geometry.confirmInside && geometry.privacyBelow &&
    focusSequence.indexOf("refresh") >= 0 &&
    focusSequence.indexOf("confirm") > focusSequence.indexOf("refresh");
  process.stdout.write(JSON.stringify({ passed, ...result }) + "\n");
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
}
