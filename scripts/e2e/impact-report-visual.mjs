import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const evidenceDirectory = join(repositoryRoot, ".aijian-dev", "impact-report-visual");
const browserExecutable =
  globalThis.process.env.AIJIAN_BROWSER_EXECUTABLE ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const stylesCss = await readFile(join(repositoryRoot, "apps/studio-web/src/styles.css"), "utf8");
const impactCss = await readFile(
  join(repositoryRoot, "apps/studio-web/src/components/ImpactReport/impact-report.css"),
  "utf8",
);

const longArt = `art_${"2".repeat(32)}`;
const longOld = `ver_${"3".repeat(32)}`;
const longNew = `ver_${"7".repeat(32)}`;
const longOp = `invop_${"6".repeat(32)}`;
const longDep = `dep_${"c".repeat(32)}`;

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Impact Report Visual Fixture</title>
    <style>${stylesCss}\n${impactCss}
      body { margin: 0; background: #0a0b10; }
      .fixture-stack { display: grid; gap: 28px; padding: 16px; }
      .fixture-label { color: #9b99a7; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
    </style>
  </head>
  <body>
    <div class="fixture-stack">
      <div>
        <div class="fixture-label">Empty history</div>
        <section class="impact-report-workspace" aria-labelledby="empty-title">
          <header class="impact-hero">
            <span class="eyebrow">改稿记录</span>
            <h2 id="empty-title">改稿影响</h2>
            <p><strong>雾城来信</strong> · 记录每一次接受头替换在事件当时冻结的下游影响。这是历史证据，不是当前实时可用性。</p>
            <div class="impact-event-notice" role="note">
              <strong>事件时证据（非实时状态）</strong>
              <span>本视图只展示 T04 账本中已冻结的替换结果。它不会调用实时评估、不会修改任务队列，也不表示任何产物现已修复或可消费。</span>
            </div>
          </header>
          <div class="impact-empty">
            <span aria-hidden="true">◎</span>
            <h3>还没有影响记录</h3>
            <p>当某次接受头替换被写入失效账本后，历史影响会出现在这里。</p>
          </div>
        </section>
      </div>

      <div>
        <div class="fixture-label">Zero impact</div>
        <section class="impact-report-workspace">
          <header class="impact-hero">
            <span class="eyebrow">EVENT-TIME EVIDENCE</span>
            <h2>改稿影响</h2>
            <p><strong>雾城来信</strong> · 历史证据，不是当前实时可用性。</p>
            <div class="impact-event-notice" role="note">
              <strong>事件时证据（非实时状态）</strong>
              <span>所选事件是冻结快照，不是实时状态。</span>
            </div>
          </header>
          <div class="impact-layout">
            <div class="impact-list">
              <ul class="impact-operation-list">
                <li>
                  <button type="button" class="impact-operation-card selected" aria-pressed="true">
                    <div class="impact-operation-top">
                      <time>2026/08/03 20:00:00</time>
                      <span class="impact-badge" data-tone="none"><span aria-hidden="true">○</span>无影响</span>
                    </div>
                    <div class="impact-id-block">
                      <span>操作 ID</span>
                      <code>invop_${"1".repeat(32)}</code>
                    </div>
                    <div class="impact-id-block">
                      <span>变更产物 · 旧接受版 → 新接受版</span>
                      <code>${longArt}</code>
                      <code>${longOld} → ${longNew}</code>
                    </div>
                    <dl class="impact-counts">
                      <div><dt>阻断</dt><dd>0</dd></div>
                      <div><dt>仅渲染</dt><dd>0</dd></div>
                      <div><dt>提示</dt><dd>0</dd></div>
                    </dl>
                  </button>
                </li>
              </ul>
            </div>
            <div class="impact-detail">
              <div class="impact-zero-note">该次接受头替换在事件当时没有独立下游路径，受影响版本数与路径数均为 0。这是有效的“无影响”结果，不是加载失败。</div>
            </div>
          </div>
        </section>
      </div>

      <div>
        <div class="fixture-label">Populated report</div>
        <section class="impact-report-workspace">
          <header class="impact-hero">
            <span class="eyebrow">EVENT-TIME EVIDENCE</span>
            <h2>改稿影响</h2>
            <p><strong>雾城来信</strong> · 历史证据，不是当前实时可用性。</p>
            <div class="impact-event-notice" role="note">
              <strong>所选事件是冻结快照</strong>
              <span>以下内容描述事件当时的影响，不是这些版本的当前实时状态。</span>
            </div>
          </header>
          <div class="impact-layout">
            <div class="impact-list">
              <ul class="impact-operation-list">
                <li>
                  <button type="button" class="impact-operation-card selected" aria-pressed="true">
                    <div class="impact-operation-top">
                      <time>2026/08/03 21:00:00</time>
                      <span class="impact-badge" data-tone="blocking"><span aria-hidden="true">■</span>阻断</span>
                    </div>
                    <div class="impact-id-block">
                      <span>操作 ID</span>
                      <code>${longOp}</code>
                    </div>
                    <div class="impact-id-block">
                      <span>变更产物 · 旧接受版 → 新接受版</span>
                      <code>${longArt}</code>
                      <code>${longOld} → ${longNew}</code>
                    </div>
                    <dl class="impact-counts" aria-label="影响分型计数">
                      <div><dt>阻断</dt><dd>1</dd></div>
                      <div><dt>仅渲染</dt><dd>1</dd></div>
                      <div><dt>提示</dt><dd>1</dd></div>
                    </dl>
                  </button>
                </li>
              </ul>
            </div>
            <div class="impact-detail">
              <section class="impact-section">
                <h3>事件摘要</h3>
                <dl class="impact-summary-grid" aria-label="事件计数摘要">
                  <div><dt>受影响版本</dt><dd>1</dd></div>
                  <div><dt>独立路径</dt><dd>2</dd></div>
                  <div><dt>阻断 / 仅渲染 / 提示</dt><dd>1 / 1 / 0</dd></div>
                  <div><dt>最强有效影响</dt><dd><span class="impact-badge" data-tone="blocking"><span aria-hidden="true">■</span>阻断</span></dd></div>
                </dl>
              </section>
              <section class="impact-section">
                <h3>受影响精确版本</h3>
                <p>不同版本即使属于同一产物也分别列出；路径按 path_ordinal 升序展示。</p>
                <ul class="impact-version-list">
                  <li class="impact-version-card">
                    <div class="impact-version-header">
                      <div class="impact-id-block">
                        <span>受影响产物 / 版本</span>
                        <code>art_${"9".repeat(32)}</code>
                        <code>ver_${"a".repeat(32)}</code>
                      </div>
                      <span class="impact-badge" data-tone="blocking"><span aria-hidden="true">■</span>阻断</span>
                    </div>
                    <ul class="impact-flag-list">
                      <li>通用过期（事件时）</li>
                      <li>通用阻断（事件时）</li>
                      <li>渲染阻断（事件时）</li>
                    </ul>
                    <ul class="impact-path-list">
                      <li class="impact-path-card">
                        <div class="impact-path-header">
                          <div class="impact-id-block">
                            <span>路径序号 0 · 影响 ID invimp_${"b".repeat(32)}</span>
                            <code>有效影响：阻断</code>
                          </div>
                          <span class="impact-badge" data-tone="blocking"><span aria-hidden="true">■</span>阻断</span>
                        </div>
                        <div class="impact-chain">
                          <strong>依赖 ID 链 · 关系 · 边影响</strong>
                          <ol>
                            <li>
                              <strong>边 1</strong>
                              <code>${longDep}</code>
                              <div class="impact-edge-row">
                                <span>关系 derived_from</span>
                                <span class="impact-badge" data-tone="blocking"><span aria-hidden="true">■</span>阻断</span>
                              </div>
                            </li>
                          </ol>
                        </div>
                      </li>
                      <li class="impact-path-card">
                        <div class="impact-path-header">
                          <div class="impact-id-block">
                            <span>路径序号 1 · 影响 ID invimp_${"d".repeat(32)}</span>
                            <code>有效影响：仅渲染</code>
                          </div>
                          <span class="impact-badge" data-tone="render"><span aria-hidden="true">▲</span>仅渲染</span>
                        </div>
                        <div class="impact-chain">
                          <strong>依赖 ID 链 · 关系 · 边影响</strong>
                          <ol>
                            <li>
                              <strong>边 1</strong>
                              <code>dep_${"e".repeat(32)}</code>
                              <div class="impact-edge-row">
                                <span>关系 references</span>
                                <span class="impact-badge" data-tone="advisory"><span aria-hidden="true">◇</span>提示</span>
                              </div>
                            </li>
                            <li>
                              <strong>边 2</strong>
                              <code>dep_${"f".repeat(32)}</code>
                              <div class="impact-edge-row">
                                <span>关系 derived_from</span>
                                <span class="impact-badge" data-tone="render"><span aria-hidden="true">▲</span>仅渲染</span>
                              </div>
                            </li>
                          </ol>
                        </div>
                      </li>
                    </ul>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </section>
      </div>
    </div>
  </body>
</html>`;

await mkdir(evidenceDirectory, { recursive: true });
const fixturePath = join(evidenceDirectory, "fixture.html");
await writeFile(fixturePath, html, "utf8");

const browser = await chromium.launch({
  executablePath: browserExecutable,
  headless: true,
});
const findings = [];

async function capture(viewport, name) {
  const page = await browser.newPage({ viewport });
  await page.goto(`file://${fixturePath.replace(/\\/g, "/")}`, { waitUntil: "domcontentloaded" });
  const screenshotPath = join(evidenceDirectory, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const metrics = await page.evaluate(() => {
    const codes = [...globalThis.document.querySelectorAll("code")].map((node) => {
      const rect = node.getBoundingClientRect();
      const styles = globalThis.getComputedStyle(node);
      return {
        text: node.textContent ?? "",
        width: rect.width,
        scrollWidth: node.scrollWidth,
        overflowWrap: styles.overflowWrap,
        clipped: node.scrollWidth > node.clientWidth + 1,
      };
    });
    const selected = globalThis.document.querySelector(".impact-operation-card.selected");
    const selectedStyles = selected ? globalThis.getComputedStyle(selected) : null;
    const versionGroup = globalThis.document.querySelector(".impact-version-card");
    const versionStyles = versionGroup ? globalThis.getComputedStyle(versionGroup) : null;
    const edgeRow = globalThis.document.querySelector(".impact-chain li");
    const edgeStyles = edgeRow ? globalThis.getComputedStyle(edgeRow) : null;
    const countCell = globalThis.document.querySelector(".impact-counts div");
    const countStyles = countCell ? globalThis.getComputedStyle(countCell) : null;
    const badges = [...globalThis.document.querySelectorAll(".impact-badge")].map((node) =>
      node.textContent?.trim(),
    );
    return {
      innerWidth: globalThis.innerWidth,
      scrollWidth: globalThis.document.documentElement.scrollWidth,
      clientWidth: globalThis.document.documentElement.clientWidth,
      horizontalOverflow:
        globalThis.document.documentElement.scrollWidth >
        globalThis.document.documentElement.clientWidth + 1,
      selectedPresent: Boolean(selected),
      selectedUsesGradient: Boolean(
        selectedStyles?.backgroundImage && selectedStyles.backgroundImage !== "none",
      ),
      versionGroupFramed: Boolean(
        versionStyles &&
        versionStyles.borderStyle !== "none" &&
        versionStyles.borderBottomStyle === "solid" &&
        Number.parseFloat(versionStyles.borderTopWidth) === 0 &&
        Number.parseFloat(versionStyles.borderLeftWidth) === 0,
      ),
      edgeRowFramed: Boolean(
        edgeStyles &&
        Number.parseFloat(edgeStyles.borderLeftWidth) > 0 &&
        Number.parseFloat(edgeStyles.borderRightWidth) > 0 &&
        Number.parseFloat(edgeStyles.borderTopWidth) > 0,
      ),
      countCellFramed: Boolean(
        countStyles &&
        Number.parseFloat(countStyles.borderTopWidth) > 0 &&
        Number.parseFloat(countStyles.borderLeftWidth) > 0 &&
        Number.parseFloat(countStyles.borderBottomWidth) > 0,
      ),
      badges,
      clippedIds: codes.filter((item) => item.clipped).map((item) => item.text),
      liveLanguageHits:
        globalThis.document.body.innerText.includes("当前实时可用性") &&
        globalThis.document.body.innerText.includes("事件时证据"),
    };
  });
  findings.push({ viewport, name, screenshotPath, metrics });
  await page.close();
}

await capture({ width: 1440, height: 900 }, "impact-report-1440x900");
await capture({ width: 390, height: 844 }, "impact-report-390x844");
await browser.close();

const summary = {
  generated_at: new Date().toISOString(),
  findings,
};
await writeFile(join(evidenceDirectory, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
globalThis.console.log(JSON.stringify(summary, null, 2));
