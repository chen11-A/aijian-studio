// One signed, external, headless Web-layout gate. Does not click product handlers.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const qa = __dirname;
const repo = 'C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923';
const webManifest = 'C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-web-p23-preview-renderer-dist-25-1/FILES.json';
const playwrightEntry = path.join(repo, 'node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.js');
const { chromium } = require(path.dirname(playwrightEntry));
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const fixturePath = path.join(qa, 'review-fixture.init.js');
const output = path.join(qa, 'run-01');
const copiedWeb = path.join(output, 'web-dist');
const receiptPath = path.join(output, 'RECEIPT.json');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const sha = string => createHash('sha256').update(string).digest('hex').toUpperCase();
const norm = file => path.resolve(file).toLowerCase();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trimEnd();
const statusSha = () => sha(git('status', '--porcelain', '-uall').replace(/\r\n/g, '\n'));
const itemFile = item => path.join(read(webManifest).frozen_renderer_root, item.path);
const sourcePins = {
  'apps/studio-web/src/aivora/v2-story.css': 'D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E',
  'apps/studio-web/src/aivora/StoryPages.tsx': '34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60',
  'apps/studio-web/src/aivora/SourceExtractionPanel.tsx': '61AFFCF1DEC5D555E6D94766DF68967196AFAC63277AA278BB45633089682A4B',
  'apps/studio-web/src/aivora/model.tsx': '0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211',
  'apps/studio-web/src/aivora/adapters/productionSourceStage.ts': 'A0597138E818C35D9C00598752C234FC7440B5EB896BC2AD48AFF17504874DA7',
};
const webName = item => item.path;
function assertFile(file, item) {
  assert.ok(fs.lstatSync(file).isFile(), `Not regular file: ${file}`);
  assert.equal(hash(file), item.sha256.toUpperCase(), `SHA drift: ${file}`);
  assert.equal(fs.statSync(file).size, item.bytes, `Byte drift: ${file}`);
}
function preflight(approval) {
  assert.equal(approval.schema, 'qa03.source-preview-three-button.one-shot.approval.v1');
  assert.equal(approval.state, 'APPROVED_SINGLE_RUN');
  assert.equal(norm(approval.qaRoot), norm(qa));
  assert.equal(approval.runnerSha256.toUpperCase(), hash(__filename));
  assert.equal(approval.packetSha256.toUpperCase(), hash(path.join(qa, 'RUN-PACKET.json')));
  assert.equal(approval.fixtureSha256.toUpperCase(), hash(fixturePath));
  assert.equal(approval.nodeSha256.toUpperCase(), hash(process.execPath));
  assert.equal(approval.edgeSha256.toUpperCase(), hash(edge));
  assert.equal(approval.playwrightEntrySha256.toUpperCase(), hash(playwrightEntry));
  assert.equal(approval.webManifestSha256.toUpperCase(), hash(webManifest));
  assert.equal(git('rev-parse', 'HEAD'), '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2');
  assert.equal(statusSha(), approval.repoStatusSha256.toUpperCase(), 'c19 status drift');
  assert.ok(!fs.existsSync(output), 'Fresh QA output already exists');
  for (const [name, expected] of Object.entries(sourcePins)) assert.equal(hash(path.join(repo, name)), expected, `Source drift: ${name}`);
  const manifest = read(webManifest);
  assert.equal(manifest.qa_receipt_sha256, '7CE9C71557B70EB12DBBA654258524D4A178A9DA61E2FC52F1CD23A12A6085C1');
  const files = manifest.renderer_files;
  assert.equal(files.length, 25);
  assert.equal(new Set(files.map(webName)).size, 25);
  for (const item of files) {
    const rel = webName(item);
    assert.ok(rel && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..'));
    assertFile(itemFile(item), item);
  }
  const target = new Map(files.map(item => [webName(item), item.sha256.toUpperCase()]));
  assert.equal(target.get('assets/index-jsEG3DHn.css'), '8B8AA7581262D68B1737A61C5587C4D545020C8C9AB73C211FC317555004ED0A');
  assert.equal(target.get('assets/index-CyIvZNT0.js'), '9C4E72498F28AD25C4B30FE365068FA64576201A1D9D736ADC4A0F15BF29BB4C');
  assert.equal(target.get('index.html'), 'AFE003E1635BAC787FC77FB32BCA0F34594D99D14DB8E63D0BF4A447F75C9D46');
  return files;
}

function staticServer(folder) {
  return http.createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
    catch { res.writeHead(400).end(); return; }
    const full = path.resolve(folder, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (full !== path.resolve(folder, 'index.html') && !full.startsWith(path.resolve(folder) + path.sep)) {
      res.writeHead(403).end(); return;
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404).end(); return; }
    const ext = path.extname(full).toLowerCase();
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.otf': 'font/otf' };
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    fs.createReadStream(full).pipe(res);
  });
}

async function probeViewport(context, origin, height, events) {
  const page = await context.newPage();
  const label = `1424x${height}`;
  page.on('console', message => events.push({ label, kind: 'console', type: message.type(), text: message.text() }));
  page.on('pageerror', error => events.push({ label, kind: 'pageerror', text: String(error.stack ?? error) }));
  page.on('requestfailed', request => events.push({ label, kind: 'requestfailed', url: request.url(), failure: request.failure() }));
  await page.route('**/*', route => {
    const request = route.request();
    if (request.url().startsWith(origin + '/') && request.method() === 'GET') return route.continue();
    events.push({ label, kind: 'blocked-network', url: request.url(), method: request.method() });
    return route.abort();
  });
  await page.setViewportSize({ width: 1424, height });
  await page.addInitScript({ path: fixturePath });
  try {
    await page.goto(`${origin}/#source`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(() => {
      const root = document.querySelector('.demo-root[data-page="source"]');
      const card = document.querySelector('.v2-source-preview');
      return root && card && card.textContent?.includes('来源状态：审核中') &&
        [...card.querySelectorAll('.actions button')].map(x => x.textContent?.trim()).join('|') ===
        '刷新来源状态|确认来源审核基线|审核来源版本';
    }, undefined, { timeout: 15000 });
    const initial = await page.evaluate(() => {
      const rect = node => { const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const title = document.querySelector('.page-title h1');
      const side = document.querySelector('.v2-source-side');
      const card = document.querySelector('.v2-source-preview');
      const cardTitle = card.querySelector('h2');
      const excerpt = card.querySelector('.v2-source-excerpt');
      const status = card.querySelector('.v2-source-support');
      const buttons = [...card.querySelectorAll('.actions button')];
      const scroll = node => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop });
      return { rootClass: document.querySelector('.demo-root')?.className, title: { text: title.textContent, rect: rect(title) },
        side: { rect: rect(side), scroll: scroll(side) }, card: { rect: rect(card) },
        cardTitle: { text: cardTitle.textContent, rect: rect(cardTitle) },
        excerpt: { rect: rect(excerpt), scroll: scroll(excerpt), textLength: excerpt.textContent.length },
        status: { text: status.textContent, rect: rect(status) },
        buttons: buttons.map(x => ({ text: x.textContent.trim(), rect: rect(x), disabled: x.disabled })) };
    });
    const scrollAfter = await page.evaluate(() => {
      const node = document.querySelector('.v2-source-excerpt');
      node.scrollTop = 120;
      return node.scrollTop;
    });
    const buttons = [];
    for (const text of ['刷新来源状态', '确认来源审核基线', '审核来源版本']) {
      const locator = page.locator('.v2-source-preview .actions button', { hasText: text });
      assert.equal(await locator.count(), 1, `${label}: ${text} count`);
      await locator.scrollIntoViewIfNeeded();
      const visible = await locator.isVisible();
      await locator.focus();
      const focused = await locator.evaluate(node => document.activeElement === node);
      const hit = await locator.evaluate(node => {
        const r = node.getBoundingClientRect();
        const found = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return found === node || node.contains(found);
      });
      await locator.click({ trial: true, timeout: 5000 });
      buttons.push({ text, visible, focused, hit, trialClick: true });
    }
    const screenshot = path.join(output, `${label}.png`);
    await page.screenshot({ path: screenshot });
    const calls = await page.evaluate(() => ({
      bridge: window.__qaBridgeCalls, forbidden: window.__qaForbiddenCalls,
    }));
    const result = { viewport: { width: 1424, height }, initial, scrollAfter, buttons,
      calls, screenshot, screenshotSha256: hash(screenshot) };
    fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify(result, null, 2) + '\n');
    assert.equal(initial.buttons.length, 3, 'Not three product buttons');
    assert.ok(initial.excerpt.scroll.scrollHeight > initial.excerpt.scroll.clientHeight, 'Excerpt cannot scroll');
    assert.ok(scrollAfter > 0, 'No actual scroll movement');
    assert.ok(buttons.every(item => item.visible && item.focused && item.hit && item.trialClick), 'Button actionability failed');
    assert.equal(calls.forbidden.length, 0, 'Product mutation/fetch attempted');
    assert.ok(calls.bridge.some(item => item.name === 'getSourceManifest'), 'Review fixture not consumed');
    assert.equal(events.filter(item => item.label === label && item.kind === 'blocked-network').length, 0, 'Blocked product network request');
    assert.equal(events.filter(item => item.label === label && item.kind === 'pageerror').length, 0, 'Browser page error');
    return result;
  } catch (error) {
    await page.screenshot({ path: path.join(output, `${label}.RED.png`) }).catch(() => {});
    throw error;
  } finally { await page.close(); }
}

function browserProcesses() {
  const profile = path.join(output, 'profile');
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replaceAll("'", "''")}*' -and $_.ProcessId -ne $PID } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {encoding:'utf8'}).trim();
  return raw ? [JSON.parse(raw)].flat() : [];
}
async function main() {
  const [flag, approvalFile, shaFlag, approvalSha] = process.argv.slice(2);
  assert.equal(flag, '--approval'); assert.equal(shaFlag, '--approval-sha256');
  assert.ok(approvalFile && /^[0-9a-f]{64}$/i.test(approvalSha ?? ''));
  assert.notEqual(norm(approvalFile), norm(path.join(qa, 'APPROVAL.template.json')));
  assert.equal(hash(approvalFile), approvalSha.toUpperCase(), 'Approval SHA drift');
  const approved = read(approvalFile);
  const files = preflight(approved);
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'RUN-STARTED.json'), JSON.stringify({ at: new Date().toISOString(),
    approvalFile, approvalSha256: approvalSha.toUpperCase(), runnerSha256: hash(__filename) }, null, 2) + '\n');
  const receipt = { schema: 'qa03.source-preview-three-button.receipt.v1', state: 'UNKNOWN',
    startedAt: new Date().toISOString(), approvalSha256: approvalSha.toUpperCase(),
    repoHead: git('rev-parse', 'HEAD'), repoStatusSha256Before: statusSha(),
    webManifestSha256: hash(webManifest), fixtureSha256: hash(fixturePath),
    nodeSha256: hash(process.execPath), edgeSha256: hash(edge), playwrightEntrySha256: hash(playwrightEntry),
    outputDir: output, webDistFiles: files.length, samples: [] };
  let server, context;
  const events = [];
  try {
    for (const item of files) {
      const destination = path.join(copiedWeb, webName(item));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(itemFile(item), destination, fs.constants.COPYFILE_EXCL);
      assertFile(destination, item);
    }
    server = staticServer(copiedWeb);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    context = await chromium.launchPersistentContext(path.join(output, 'profile'), {
      executablePath: edge, headless: true, viewport: { width: 1424, height: 881 },
      args: ['--no-first-run'],
    });
    receipt.browserProcessesDuring = browserProcesses();
    for (const height of [881, 720]) receipt.samples.push(await probeViewport(context, origin, height, events));
    for (const item of files) assertFile(path.join(copiedWeb, webName(item)), item);
    for (const [name, expected] of Object.entries(sourcePins)) assert.equal(hash(path.join(repo, name)), expected, `Post-run source drift: ${name}`);
    assert.equal(hash(webManifest), receipt.webManifestSha256);
    assert.equal(statusSha(), receipt.repoStatusSha256Before, 'c19 status drift');
    receipt.state = 'INTEGRATED_WEB_REVIEW_THREE_BUTTON_LAYOUT_PASS';
  } catch (error) {
    receipt.state = 'INTEGRATED_WEB_REVIEW_THREE_BUTTON_LAYOUT_RED';
    receipt.error = String(error.stack ?? error);
  } finally {
    if (context) await context.close().catch(error => events.push({ kind: 'close-error', text: String(error) }));
    if (server) await new Promise(resolve => server.close(resolve));
    for (let i = 0; i < 10; i++) {
      receipt.browserProcessesAfter = browserProcesses();
      if (receipt.browserProcessesAfter.length === 0) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (receipt.state === 'INTEGRATED_WEB_REVIEW_THREE_BUTTON_LAYOUT_PASS' &&
        receipt.browserProcessesAfter.length !== 0) {
      receipt.state = 'INTEGRATED_WEB_REVIEW_THREE_BUTTON_LAYOUT_RED';
      receipt.error = 'Headless browser process remains after context.close';
    }
    fs.writeFileSync(path.join(output, 'BROWSER.events.json'), JSON.stringify(events, null, 2) + '\n');
    receipt.finishedAt = new Date().toISOString();
    receipt.browserEventsSha256 = hash(path.join(output, 'BROWSER.events.json'));
    receipt.repoStatusSha256After = statusSha();
    receipt.exitCode = receipt.state === 'INTEGRATED_WEB_REVIEW_THREE_BUTTON_LAYOUT_PASS' ? 0 : 1;
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
  if (receipt.exitCode !== 0) process.exitCode = 1;
}
main().catch(error => {
  fs.writeFileSync(path.join(qa, 'PREFLIGHT-RED.json'),
    JSON.stringify({ at: new Date().toISOString(), error: String(error.stack ?? error) }, null, 2) + '\n');
  process.stderr.write(String(error.stack ?? error) + '\n'); process.exitCode = 1;
});
