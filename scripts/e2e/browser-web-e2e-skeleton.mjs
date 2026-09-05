import { deepStrictEqual, ok } from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { chromium } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const allowedRoot = resolve(repositoryRoot, ".aijian-dev/r04-a2-evidence");
const options = {};
for (let index = 2; index < globalThis.process.argv.length; index += 2) {
  const flag = globalThis.process.argv[index];
  const value = globalThis.process.argv[index + 1];
  if (!["--scenario", "--evidence-dir"].includes(flag) || options[flag] !== undefined)
    throw new Error(`Unknown or duplicate argument: ${flag}`);
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  options[flag] = value;
}
const scenario = options["--scenario"] ?? "ui01";
const evidenceRoot = resolve(
  repositoryRoot,
  options["--evidence-dir"] ?? join(allowedRoot, `${scenario}-${Date.now()}-${randomUUID()}`),
);
const isBelow = (path, root) => {
  const child = relative(root.toLowerCase(), path.toLowerCase());
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};
if (!["ui01", "invalidation-history"].includes(scenario)) throw new Error("unknown --scenario");
if (!isBelow(evidenceRoot, allowedRoot) || existsSync(evidenceRoot))
  throw new Error("--evidence-dir must be a new strict .aijian-dev/r04-a2-evidence child");
// Reject existing junction/symlink ancestors before any writes, including Windows aliases.
for (
  let ancestor = dirname(evidenceRoot);
  isBelow(ancestor, repositoryRoot);
  ancestor = dirname(ancestor)
) {
  if (existsSync(ancestor)) {
    const stat = await lstat(ancestor);
    if (stat.isSymbolicLink() || !isBelow(await realpath(ancestor), await realpath(repositoryRoot)))
      throw new Error("Evidence ancestor escapes the physical worktree");
  }
}
const runDirectory = resolve(
  globalThis.process.env.AIJIAN_BROWSER_E2E_DIR ?? join(evidenceRoot, "workspace"),
);
const screenshotPath = join(evidenceRoot, "web-e2e-skeleton-browser-1440x900.png");
const regression1920Path = join(evidenceRoot, "production-shell-regression-1920x1080.png");
const regression1440Path = join(evidenceRoot, "production-shell-regression-1440x900.png");
const reviewScreenshotPath = join(evidenceRoot, "production-shell-browser-980x720.png");
const mobileScreenshotPath = join(evidenceRoot, "production-shell-browser-390x844.png");
const resultPath = join(evidenceRoot, "web-e2e-skeleton-browser.json");
if (!isBelow(runDirectory, evidenceRoot))
  throw new Error("Browser E2E workspace must stay below its evidence directory");

const appRequire = createRequire(join(repositoryRoot, "apps", "studio-web", "package.json"));
const viteBin = join(dirname(appRequire.resolve("vite/package.json")), "bin", "vite.js");
const pythonBin = resolve(
  repositoryRoot,
  ".venv",
  globalThis.process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const expectedHead = globalThis.process.env.AIJIAN_E2E_EXPECTED_HEAD ?? null;
if (expectedHead !== null && !/^[0-9a-f]{40}$/i.test(expectedHead))
  throw new Error("AIJIAN_E2E_EXPECTED_HEAD must be 40 hexadecimal characters");
await mkdir(dirname(evidenceRoot), { recursive: true });
await mkdir(evidenceRoot); // Exclusive fresh directory: never remove a previous run.
const evidence = {
  scenario,
  passed: false,
  status: "RUNNING",
  expectedHead,
  actualHead: null,
  runnerSha256: createHash("sha256")
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest("hex"),
  chromeVersion: null,
  stages: [],
  failures: [],
  diagnostics: [],
  apiResponses: [],
  httpResponses: [],
  processes: [],
  cleanup: [],
  viewports: {},
};
const diagnostics = evidence.diagnostics;
const apiResponses = evidence.apiResponses;
let stage = "setup";
const mark = (name) => {
  stage = name;
  evidence.stages.push(name);
};
const safeError = (error) =>
  String(error?.stack ?? error).replace(/https?:\/\/[^\s)"']+/g, (url) => {
    try {
      const parsed = new globalThis.URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return "[url]";
    }
  });
const fail = (error) => evidence.failures.push({ stage, error: safeError(error) });
const delay = (ms) => new Promise((done) => globalThis.setTimeout(done, ms));
const processEnv = {
  ...globalThis.process.env,
  AIJIAN_DATA_DIR: runDirectory,
  PYTHONDONTWRITEBYTECODE: "1",
  TEMP: evidenceRoot,
  TMP: evidenceRoot,
  TMPDIR: evidenceRoot,
};
// Playwright's controller also creates temporary profiles; keep those in this run.
for (const key of ["TEMP", "TMP", "TMPDIR"]) globalThis.process.env[key] = evidenceRoot;
function seeder(command) {
  mark(`database:${command}`);
  try {
    return JSON.parse(
      execFileSync(
        pythonBin,
        [join(scriptDirectory, "seed_invalidation_operation_workspace.py"), command, runDirectory],
        {
          cwd: repositoryRoot,
          env: processEnv,
          encoding: "utf8",
          timeout: 30_000,
        },
      ),
    );
  } catch (error) {
    throw new Error(
      `Seeder ${command} failed: exit=${error.status}, signal=${error.signal}, ${safeError(error)}`,
      { cause: error },
    );
  }
}

async function assertPortIsFree(port) {
  await new Promise((done, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => probe.close(done));
  });
}

async function waitForUrl(url, processHandle, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      processHandle.exitCode !== null ||
      processHandle.signalCode !== null ||
      processHandle.startError
    ) {
      throw new Error(`${label} exited before becoming ready`);
    }
    try {
      const response = await globalThis.fetch(url, {
        signal: globalThis.AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // The service is still starting.
    }
    await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 100));
  }
  throw new Error(`${label} did not become ready`);
}

async function stopProcess(processHandle) {
  if (!processHandle) return;
  const running = () =>
    processHandle.exitCode === null &&
    processHandle.signalCode === null &&
    !processHandle.startError;
  processHandle.stopping = true;
  if (running()) processHandle.kill();
  for (let attempt = 0; running() && attempt < 50; attempt += 1) await delay(100);
  if (running()) {
    processHandle.kill("SIGKILL");
    for (let attempt = 0; running() && attempt < 50; attempt += 1) await delay(100);
  }
  evidence.cleanup.push({
    label: processHandle.label,
    pid: processHandle.pid,
    stopped: !running(),
    exitCode: processHandle.exitCode,
    signal: processHandle.signalCode,
  });
  ok(!running(), `${processHandle.label} survived cleanup`);
}

function start(label, executable, args, cwd) {
  const child = spawn(executable, args, {
    cwd,
    env: processEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record = { label, pid: child.pid, exitCode: null, signal: null, stderr: "" };
  child.label = label;
  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => {
    record.stderr = safeError(`${record.stderr}${chunk}`).slice(-8192);
  });
  child.on("error", (error) => {
    child.startError = error;
    record.error = safeError(error);
    fail(error);
  });
  child.on("close", (code, signal) => {
    record.exitCode = code;
    record.signal = signal;
    if (!child.stopping && !child.startError)
      fail(new Error(`${label} exited unexpectedly: ${code}/${signal}`));
  });
  evidence.processes.push(record);
  return child;
}

function observe(page, label) {
  page.setDefaultTimeout(10_000);
  const requests = new Map();
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      diagnostics.push({ label, type: message.type(), error: safeError(message.text()) });
  });
  page.on("pageerror", (error) =>
    diagnostics.push({ label, type: "pageerror", error: safeError(error) }),
  );
  page.on("request", (request) => {
    const path = new globalThis.URL(request.url()).pathname;
    if (/^https?:/.test(request.url())) {
      const record = { label, method: request.method(), path, status: null };
      requests.set(request, record);
      evidence.httpResponses.push(record);
      if (path.startsWith("/api/v1/")) apiResponses.push(record);
    }
  });
  page.on("response", (response) => {
    const record = requests.get(response.request());
    if (record) record.status = response.status();
  });
  page.on("requestfailed", (request) =>
    diagnostics.push({
      label,
      type: "requestfailed",
      method: request.method(),
      path: new globalThis.URL(request.url()).pathname,
      error: request.failure()?.errorText,
    }),
  );
}

const novelPath = join(runDirectory, "browser-golden-20000.txt");
const invalidNovelPath = join(runDirectory, "browser-invalid.md");
const paragraph = "夜航列车穿过雾城，周野核对旧信与车票，提醒林见不要遗漏任何来源证据。";
const novelText = `第一章 夜航\n${Array.from(
  { length: 700 },
  (_, index) => `${index + 1}。${paragraph}`,
).join("\n")}`;
if ([...novelText].length < 20_000) throw new Error("Browser novel fixture is too short");
async function runUi01(page) {
  await writeFile(novelPath, novelText, "utf8");
  await writeFile(invalidNovelPath, "invalid source fixture", "utf8");
  mark("ui01:create-import-shell");
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.getByText("本地工作区服务已连接").waitFor();
  await page.getByRole("button", { name: "创建第一个项目" }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("1");
  await page.getByRole("button", { name: "创建项目" }).click();
  await page.getByRole("heading", { name: "1", exact: true }).waitFor();
  const projectBodyFontSize = await page
    .locator(".project-hero p")
    .evaluate((element) => globalThis.getComputedStyle(element).fontSize);
  const projectNavigation = page.getByRole("navigation", { name: "项目工作台" });
  await projectNavigation.getByRole("button", { name: "原文", exact: true }).click();
  await page.getByRole("heading", { name: "来源追踪", exact: true }).waitFor();
  const modelApiTrigger = page.getByRole("button", { name: "打开模型与 API", exact: true });
  if ((await modelApiTrigger.textContent())?.trim() !== "模型与 API") {
    throw new Error("The Provider-only global entry must be honestly named 模型与 API");
  }
  await page.getByRole("button", { name: "收起项目栏" }).click();
  await page.getByRole("button", { name: "收起属性检查器" }).click();
  await page.getByRole("navigation", { name: "工作台布局" }).waitFor();
  const inspectShell = async () =>
    page.evaluate((bodyFontSize) => {
      const rail = globalThis.document.querySelector('[aria-label="展开项目栏"]');
      const inspector = globalThis.document.querySelector('[aria-label="展开属性检查器"]');
      const toolbar = globalThis.document.querySelector(".workspace-layout-controls");
      const stage = globalThis.document.querySelector(".project-stage");
      const sourceHeading = globalThis.document.querySelector(".preview-placeholder h3");
      const sourceBody = globalThis.document.querySelector(".preview-placeholder p");
      const stageMeta = globalThis.document.querySelector(".production-stage small");
      if (!rail || !inspector || !toolbar || !stage || !sourceHeading || !sourceBody || !stageMeta)
        return null;
      const contrastAgainstPanel = (color) => {
        const channels = color
          .match(/[0-9.]+/g)
          ?.slice(0, 3)
          .map(Number);
        if (!channels || channels.length !== 3) return 0;
        const luminance = (values) => {
          const linear = values.map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        };
        const foreground = luminance(channels);
        const panel = luminance([19, 20, 26]);
        return (Math.max(foreground, panel) + 0.05) / (Math.min(foreground, panel) + 0.05);
      };
      const railRect = rail.getBoundingClientRect();
      const inspectorRect = inspector.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      return {
        viewport: [globalThis.innerWidth, globalThis.innerHeight],
        documentWidth: globalThis.document.documentElement.scrollWidth,
        clientWidth: globalThis.document.documentElement.clientWidth,
        railButton: [railRect.x, railRect.y, railRect.width, railRect.height],
        inspectorButton: [
          inspectorRect.x,
          inspectorRect.y,
          inspectorRect.width,
          inspectorRect.height,
        ],
        toolbar: [toolbarRect.x, toolbarRect.y, toolbarRect.width, toolbarRect.height],
        stageTop: stageRect.top,
        sourceTitle: sourceHeading.textContent,
        sourceBodyFontSize: globalThis.getComputedStyle(sourceBody).fontSize,
        projectBodyFontSize: bodyFontSize,
        sourceBodyColor: globalThis.getComputedStyle(sourceBody).color,
        sourceBodyContrast: contrastAgainstPanel(globalThis.getComputedStyle(sourceBody).color),
        stageMetaFontSize: globalThis.getComputedStyle(stageMeta).fontSize,
        stageMetaContrast: contrastAgainstPanel(globalThis.getComputedStyle(stageMeta).color),
      };
    }, projectBodyFontSize);
  const regressionLayouts = {};
  for (const target of [
    { width: 1920, height: 1080, name: "1920x1080", path: regression1920Path },
    { width: 1440, height: 900, name: "1440x900", path: regression1440Path },
  ]) {
    await page.setViewportSize({ width: target.width, height: target.height });
    const layout = await inspectShell();
    if (
      layout === null ||
      layout.documentWidth !== layout.clientWidth ||
      Math.abs(layout.railButton[1] - layout.inspectorButton[1]) > 1 ||
      layout.railButton[2] < 44 ||
      layout.railButton[3] < 44 ||
      layout.inspectorButton[2] < 44 ||
      layout.inspectorButton[3] < 44 ||
      layout.stageTop < layout.toolbar[1] + layout.toolbar[3] ||
      layout.sourceTitle !== "来源追踪" ||
      layout.sourceBodyFontSize !== "14px" ||
      layout.projectBodyFontSize !== "14px" ||
      layout.stageMetaFontSize !== "12px" ||
      layout.sourceBodyContrast < 4.5 ||
      layout.stageMetaContrast < 4.5
    ) {
      throw new Error(`Production shell regression at ${target.name}: ${JSON.stringify(layout)}`);
    }
    regressionLayouts[target.name] = layout;
    await page.screenshot({ path: target.path, fullPage: true });
  }
  await page.getByRole("button", { name: "展开项目栏" }).click();
  await page.getByRole("button", { name: "展开属性检查器" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectCardTypography = await page.locator(".project-card-copy").evaluate((card) => {
    const title = card.querySelector("strong");
    const metadata = card.querySelector("small");
    if (!title || !metadata) return null;
    return {
      title: globalThis.getComputedStyle(title).fontSize,
      metadata: globalThis.getComputedStyle(metadata).fontSize,
    };
  });
  if (projectCardTypography?.title !== "14px" || projectCardTypography.metadata !== "12px") {
    throw new Error(`Project card typography regression: ${JSON.stringify(projectCardTypography)}`);
  }
  await page.getByLabel("选择 TXT 文件").setInputFiles(invalidNovelPath);
  const importError = page.getByRole("alert");
  await importError.waitFor();
  if (
    (await importError.evaluate((element) => globalThis.getComputedStyle(element).fontSize)) !==
    "14px"
  ) {
    throw new Error("Import error typography dropped below the 14px business-text token");
  }
  await page.getByLabel("选择 TXT 文件").setInputFiles(novelPath);
  await page.getByText("browser-golden-20000.txt", { exact: true }).first().waitFor();
  if (await page.getByRole("button", { name: "启动来源提取" }).isVisible()) {
    throw new Error("Ordinary Web exposed the Electron-only proposal run capability");
  }
  const sourceBodyFontSize = await page
    .locator(".source-block:not(.chapter_heading) p")
    .first()
    .evaluate((element) => globalThis.getComputedStyle(element).fontSize);
  if (sourceBodyFontSize !== "14px") {
    throw new Error(`Imported source body typography regression: ${sourceBodyFontSize}`);
  }
  mark("ui01:fake-generation-and-trim");
  await projectNavigation.getByRole("button", { name: "试制", exact: true }).click();
  await page.getByRole("button", { name: "生成 Fake 分镜时间线" }).waitFor();
  await page.getByRole("button", { name: "生成 Fake 分镜时间线" }).click();
  await page.getByText("3 个镜头 · REV 1").waitFor();
  await page.getByRole("button", { name: "查看任务记录" }).click();
  await page.getByText("已完成").first().waitFor();
  await page.getByRole("button", { name: "关闭制作控制中心" }).click();
  await page
    .getByRole("navigation", { name: "制作流程" })
    .getByRole("button", { name: "剪辑 · 剪辑台" })
    .click();
  const timelineHeader = page.locator(".timeline-header");
  await timelineHeader.getByText("REV 1", { exact: true }).waitFor();
  await page.getByRole("option", { name: /fake-shot-01/ }).click();
  await page.getByRole("spinbutton", { name: "源入点（帧）" }).fill("5");
  await page.getByRole("spinbutton", { name: "持续（帧）" }).fill("39");
  const [trimResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith("/timeline/trim"),
    ),
    page.getByRole("button", { name: "应用裁剪" }).click(),
  ]);
  if (!trimResponse.ok()) throw new Error(`Timeline trim failed with ${trimResponse.status()}`);
  await timelineHeader.getByText("REV 2", { exact: true }).waitFor();

  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("本地工作区服务已连接").waitFor();
  await page.getByRole("button", { name: "打开制作控制中心，查看任务和影响报告" }).click();
  await page.getByText("已完成").first().waitFor();
  await page.getByRole("button", { name: "关闭制作控制中心" }).click();
  await page
    .getByRole("navigation", { name: "制作流程" })
    .getByRole("button", { name: "剪辑 · 剪辑台" })
    .click();
  await page.locator(".timeline-header").getByText("REV 2", { exact: true }).waitFor();

  const viewport = await page.evaluate(() => ({
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    clientWidth: globalThis.document.documentElement.clientWidth,
    hasDesktopBridge: typeof globalThis.aijian !== "undefined",
    hasNodeProcess: typeof globalThis.process !== "undefined",
  }));
  if (viewport.scrollWidth !== viewport.clientWidth) {
    throw new Error("Unified browser workflow has horizontal page overflow");
  }
  if (viewport.hasDesktopBridge || viewport.hasNodeProcess) {
    throw new Error("Browser renderer exposed a desktop or Node boundary");
  }
  if (diagnostics.length > 0) {
    throw new Error(`Browser console was not clean: ${diagnostics.join(" | ")}`);
  }
  if (apiResponses.some((response) => response.status >= 400)) {
    throw new Error("Unified browser workflow observed a failed API response");
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page
    .getByRole("navigation", { name: "制作流程" })
    .getByRole("button", { name: /项目/ })
    .click();
  await page.setViewportSize({ width: 980, height: 720 });
  const reviewViewport = await page.evaluate(() => ({
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    clientWidth: globalThis.document.documentElement.clientWidth,
  }));
  if (reviewViewport.scrollWidth !== reviewViewport.clientWidth) {
    throw new Error("Production shell review viewport has horizontal page overflow");
  }
  await page.screenshot({ path: reviewScreenshotPath, fullPage: true });

  await page.setViewportSize({ width: 720, height: 450 });
  const zoom200Equivalent = await page.evaluate(() => ({
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    clientWidth: globalThis.document.documentElement.clientWidth,
    taskButtonHeight:
      globalThis.document
        .querySelector('button[aria-label^="打开制作控制中心"]')
        ?.getBoundingClientRect().height ?? null,
  }));
  if (
    zoom200Equivalent.scrollWidth !== zoom200Equivalent.clientWidth ||
    zoom200Equivalent.taskButtonHeight === null ||
    zoom200Equivalent.taskButtonHeight < 44
  ) {
    throw new Error(
      `Production shell failed the 1440px-at-200%-equivalent reflow check: ${JSON.stringify(zoom200Equivalent)}`,
    );
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileViewport = await page.evaluate(() => ({
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    clientWidth: globalThis.document.documentElement.clientWidth,
  }));
  const mobileVisibility = {
    director: await page
      .getByRole("navigation", { name: "制作流程" })
      .getByRole("button", { name: /^\d+导演$/ })
      .isVisible(),
    generate: await page
      .getByRole("navigation", { name: "制作流程" })
      .getByRole("button", { name: /^\d+生成$/ })
      .isVisible(),
    edit: await page
      .getByRole("navigation", { name: "制作流程" })
      .getByRole("button", { name: "剪辑 · 剪辑台" })
      .isVisible(),
    createProject: await page.getByRole("button", { name: /新建项目/ }).isVisible(),
    modelAndApi: await page
      .getByRole("button", { name: "打开模型与 API", exact: true })
      .isVisible(),
    importSource: await page.getByLabel("选择 TXT 文件").isVisible(),
    fakeGenerate: await page.getByRole("button", { name: "生成 Fake 分镜时间线" }).isVisible(),
    sourceExtract: await page.getByRole("button", { name: "启动来源提取" }).isVisible(),
  };
  await page.getByRole("region", { name: "移动端审阅模式" }).waitFor();
  if (
    mobileViewport.scrollWidth !== mobileViewport.clientWidth ||
    Object.values(mobileVisibility).some(Boolean)
  ) {
    throw new Error("Mobile review shell exposed overflow or a write/edit/generation entry point");
  }
  await page.screenshot({ path: mobileScreenshotPath, fullPage: true });
  evidence.ui01 = {
    check: "phase0-web-e2e-skeleton-browser",
    passed: true,
    novelCharacterCount: [...novelText].length,
    apiResponses,
    viewport,
    reviewViewport,
    regressionLayouts,
    zoom200Equivalent,
    mobileViewport,
    mobileVisibility,
    diagnostics,
    screenshot: "web-e2e-skeleton-browser-1440x900.png",
    responsiveScreenshots: [
      "production-shell-regression-1920x1080.png",
      "production-shell-regression-1440x900.png",
      "production-shell-browser-980x720.png",
      "production-shell-browser-390x844.png",
    ],
  };
}

async function focused(locator) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await locator.evaluate((element) => element === globalThis.document.activeElement)) return;
    await delay(20);
  }
  throw new Error(`Expected keyboard focus on ${locator}`);
}

async function reportLayout(page, detail) {
  const layout = await page.evaluate((hasDetail) => {
    const drawer = globalThis.document.querySelector(".production-control-drawer");
    const backdrop = drawer.parentElement;
    const visible = (element) => element.checkVisibility({ checkVisibilityCSS: true });
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    };
    const groups = {
      business:
        ".production-control-tabs button, .task-drawer-heading button, .task-drawer-heading h2",
      metadata: hasDetail
        ? ".history-path p, .history-reasons li, .history-technical-details dt, .history-technical-details dd"
        : ".history-operation time, .history-operation small, .history-operation span",
      content: hasDetail
        ? ".history-path header span, .history-path header strong, .history-technical-details summary, .history-mobile-back"
        : ".history-operation strong",
    };
    return {
      drawer: rect(drawer),
      backdrop: rect(backdrop),
      clientWidth: globalThis.document.documentElement.clientWidth,
      documentWidth: globalThis.document.documentElement.scrollWidth,
      height: globalThis.innerHeight,
      horizontalOverflow: Array.from(
        drawer.querySelectorAll(".production-control-panel, .history-list, .history-detail"),
      )
        .filter(visible)
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.className),
      fonts: Object.fromEntries(
        Object.entries(groups).map(([name, selector]) => [
          name,
          Array.from(drawer.querySelectorAll(selector))
            .filter(visible)
            .map((element) => Number.parseFloat(globalThis.getComputedStyle(element).fontSize)),
        ]),
      ),
      controls: Array.from(drawer.querySelectorAll("button, summary")).filter(visible).map(rect),
      listVisible: visible(drawer.querySelector(".history-list")),
      renderer: {
        aijian: typeof globalThis.aijian,
        process: typeof globalThis.process,
        require: typeof globalThis.require,
      },
    };
  }, detail);
  deepStrictEqual(layout.renderer, {
    aijian: "undefined",
    process: "undefined",
    require: "undefined",
  });
  deepStrictEqual(layout.documentWidth, layout.clientWidth, "Page horizontal overflow");
  deepStrictEqual(layout.horizontalOverflow, [], "Panel horizontal overflow");
  ok(
    layout.drawer.x >= -1 &&
      layout.drawer.y >= -1 &&
      layout.drawer.right <= layout.clientWidth + 1 &&
      layout.drawer.bottom <= layout.height + 1,
    "Drawer outside viewport",
  );
  if (layout.clientWidth > 680) {
    ok(Math.abs(layout.drawer.width - 1120) <= 1, "Desktop drawer must be 1120px wide");
    ok(
      Math.abs(
        layout.drawer.x + layout.drawer.width / 2 - (layout.backdrop.x + layout.backdrop.width / 2),
      ) <= 1,
      "Drawer must center on the actual backdrop, not innerWidth",
    );
  } else deepStrictEqual(layout.listVisible, !detail, "Mobile list/detail visibility");
  for (const [name, sizes] of Object.entries(layout.fonts)) {
    ok(sizes.length > 0, `Empty ${name} typography group`);
    ok(
      sizes.every((size) => size >= (name === "metadata" ? 12 : 14)),
      `${name} text below minimum size`,
    );
  }
  ok(
    layout.controls.length > 0 &&
      layout.controls.every((control) => control.width >= 44 && control.height >= 44),
    "Visible control below 44px",
  );
  return layout;
}

async function runReport(page, fixture, label) {
  const result = { list: null, detail: null, keyboard: [], mapping: false };
  evidence.viewports[label] = result;
  mark(`${label}:open-default-tasks`);
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.getByText("本地工作区服务已连接").waitFor();
  await page
    .locator(".project-card.selected strong")
    .filter({ hasText: "Invalidation operation smoke" })
    .waitFor();
  if (label === "390x844") {
    await page.getByRole("region", { name: "移动端审阅模式" }).waitFor();
    const hidden = [
      page.getByRole("button", { name: /新建项目|创建第一个项目|创建项目/ }),
      page.getByRole("button", { name: "打开模型与 API", exact: true }),
      page.getByLabel("选择 TXT 文件"),
      page.getByRole("button", { name: "生成 Fake 分镜时间线" }),
      page.getByRole("button", { name: "启动来源提取" }),
      page
        .getByRole("navigation", { name: "制作流程" })
        .getByRole("button", { name: /导演|生成|剪辑/ }),
    ];
    for (const group of hidden)
      for (const entry of await group.all())
        ok(!(await entry.isVisible()), "Mobile exposed create/import/generation/edit entry");
    result.mobileReviewOnly = true;
  }
  const trigger = page.getByRole("button", {
    name: "打开制作控制中心，查看任务和影响报告",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "制作控制中心", exact: true });
  const close = dialog.getByRole("button", { name: "关闭制作控制中心", exact: true });
  const tasks = dialog.getByRole("tab", { name: "制作任务", exact: true });
  const reports = dialog.getByRole("tab", { name: "影响报告", exact: true });
  const row = dialog.locator(".history-operation").first();
  const tabs = async (reportActive) => {
    deepStrictEqual(await tasks.getAttribute("aria-selected"), String(!reportActive));
    deepStrictEqual(await reports.getAttribute("aria-selected"), String(reportActive));
    deepStrictEqual(await tasks.getAttribute("tabindex"), reportActive ? "-1" : "0");
    deepStrictEqual(await reports.getAttribute("tabindex"), reportActive ? "0" : "-1");
  };
  const listResponse = () =>
    page.waitForResponse((response) => {
      const url = new globalThis.URL(response.url());
      return (
        url.pathname.endsWith("/invalidation-operations") &&
        url.searchParams.get("limit") === "20" &&
        response.request().method() === "GET"
      );
    });
  const readList = async (responsePromise) => {
    const response = await responsePromise;
    deepStrictEqual(response.status(), 200, "List response status");
    const items = (await response.json()).data.items;
    ok(items.length > 0, "Report list is empty");
    await row.waitFor();
    await page.waitForLoadState("networkidle");
    return items;
  };
  await trigger.click();
  await focused(close);
  await tabs(false);
  await page.keyboard.press("Tab");
  await focused(tasks);
  for (const [key, reportActive] of [
    ["ArrowRight", true],
    ["ArrowLeft", false],
    ["End", true],
    ["Home", false],
  ]) {
    mark(`${label}:keyboard-${key}`);
    await Promise.all([
      reportActive ? readList(listResponse()) : Promise.resolve(),
      (async () => {
        await page.keyboard.press(key);
        await tabs(reportActive);
        await focused(reportActive ? reports : tasks);
        if (!reportActive) await page.waitForLoadState("networkidle");
      })(),
    ]);
    result.keyboard.push(key);
  }
  mark(`${label}:list-ui-click`);
  const [items] = await Promise.all([readList(listResponse()), reports.click()]);
  const selected = items[0]; // Only the real list response chooses the row/detail ID.
  const shortId = (value) => `${value.slice(0, 14)}…${value.slice(-6)}`;
  deepStrictEqual(selected.operation_id, fixture.operation_id, "Seed oracle differs from GET list");
  deepStrictEqual(await row.locator("time").getAttribute("datetime"), selected.created_at);
  deepStrictEqual(await row.locator("time").innerText(), selected.created_at.replace("T", " "));
  deepStrictEqual(await row.locator("span").getAttribute("title"), selected.changed_artifact_id);
  deepStrictEqual(
    await row.locator("span").innerText(),
    `Artifact · ${shortId(selected.changed_artifact_id)}`,
  );
  deepStrictEqual(
    (await row.locator("small").innerText()).trim(),
    `${selected.reason_path_count} 条影响路径`,
  );
  result.list = await reportLayout(page, false);
  await page.screenshot({ path: join(evidenceRoot, `${label}-list.png`), fullPage: false });
  mark(`${label}:detail-ui-click`);
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new globalThis.URL(response.url()).pathname.endsWith(
          `/invalidation-operations/${selected.operation_id}`,
        ) && response.request().method() === "GET",
    ),
    row.click(),
  ]);
  deepStrictEqual(response.status(), 200, "Detail response status");
  const data = (await response.json()).data;
  ok(
    isDeepStrictEqual(data, fixture.expected_data),
    "Detail response differs from read-only seed oracle",
  );
  await dialog.locator(".history-path").first().waitFor();
  await focused(dialog.locator(".history-detail-heading h3"));
  deepStrictEqual(
    await dialog.locator(".history-detail-heading h3").innerText(),
    shortId(data.changed_artifact_id),
  );
  result.keyboard.push("detail-heading-focus");
  const impact = (value) =>
    ({ blocking: "阻塞下游", advisory: "建议复核", rerender_only: "仅重新渲染" })[value];
  deepStrictEqual(await dialog.locator(".history-path").count(), data.paths.length);
  ok(data.paths.length > 0, "No affected paths to verify");
  for (const [index, path] of data.paths.entries()) {
    const article = dialog.locator(".history-path").nth(index);
    deepStrictEqual(
      (await article.locator("header span").innerText()).trim(),
      path.classification === "INVALIDATE" ? "失效" : "待复核",
    );
    deepStrictEqual(
      (await article.locator("header strong").innerText()).trim(),
      impact(path.effective_impact),
    );
    for (const [position, id] of [path.affected_artifact_id, path.affected_version_id].entries()) {
      const code = article.locator("p code").nth(position);
      deepStrictEqual(await code.innerText(), shortId(id));
      deepStrictEqual(await code.getAttribute("title"), id);
    }
    const reasons = article.locator(".history-reasons li");
    ok(path.dependency_ids.length > 0, "No dependency reason chain");
    deepStrictEqual(await reasons.count(), path.dependency_ids.length);
    for (const [step, id] of path.dependency_ids.entries()) {
      const reason = reasons.nth(step);
      deepStrictEqual(await reason.locator("code").innerText(), shortId(id));
      deepStrictEqual(await reason.locator("code").getAttribute("title"), id);
      deepStrictEqual(await reason.locator("span").innerText(), path.relationships[step]);
      deepStrictEqual(await reason.locator("em").innerText(), impact(path.edge_impacts[step]));
    }
  }
  await page.screenshot({ path: join(evidenceRoot, `${label}-detail.png`), fullPage: false });
  const summary = dialog.locator("summary").filter({ hasText: "技术详情" });
  await summary.click();
  for (const [term, expected] of Object.entries({
    Operation: data.operation_id,
    Gate: data.gate_decision_id,
    旧版本: data.old_accepted_version_id,
    新版本: data.new_accepted_version_id,
    Assessment: data.assessment_hash,
  })) {
    const pair = dialog
      .locator(".history-technical-details dl > div")
      .filter({ has: page.getByText(term, { exact: true }) });
    deepStrictEqual(await pair.locator("dt").innerText(), term);
    deepStrictEqual(await pair.locator("dd").innerText(), expected);
    deepStrictEqual(await pair.locator("dd").getAttribute("title"), expected);
  }
  result.mapping = true;
  result.detail = await reportLayout(page, true);
  mark(`${label}:keyboard-modal-trap`);
  await focused(summary);
  await page.keyboard.press("Tab");
  await focused(close);
  await page.keyboard.press("Shift+Tab");
  await focused(summary);
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let count = 0; count < result.detail.controls.length + 2; count += 1) {
      await page.keyboard.press(key);
      ok(
        await dialog.evaluate((element) => element.contains(globalThis.document.activeElement)),
        `${key} escaped dialog`,
      );
    }
  }
  result.keyboard.push(
    "Tab-wrap-summary-to-close",
    "Shift+Tab-wrap-close-to-summary",
    "Tab/Shift+Tab-contained",
  );
  mark(`${label}:wheel-bottom-clipping`);
  const scrollState = () =>
    dialog.evaluate((element) =>
      Array.from(element.querySelectorAll(".production-control-panel, .history-detail")).map(
        (panel) => ({
          class: panel.className,
          top: panel.scrollTop,
          height: panel.clientHeight,
          scrollHeight: panel.scrollHeight,
        }),
      ),
    );
  const box = await dialog.locator(".history-detail").boundingBox();
  await page.mouse.move(
    Math.min(box.x + box.width / 2, result.detail.clientWidth - 20),
    Math.min(box.y + 120, result.detail.height - 80),
  );
  result.scrollInitial = await scrollState();
  for (let count = 0; count < 8; count += 1) {
    await page.mouse.wheel(0, -900);
    await delay(80);
  }
  result.scrollBefore = await scrollState();
  for (let count = 0; count < 8; count += 1) {
    await page.mouse.wheel(0, 900);
    await delay(80);
  }
  result.scrollAfter = await scrollState();
  result.overflowingPanelExercised = result.scrollBefore.some(
    (panel) => panel.scrollHeight > panel.height + 1,
  );
  if (result.overflowingPanelExercised)
    ok(
      result.scrollBefore.every(
        (before, index) =>
          before.scrollHeight <= before.height + 1 ||
          (result.scrollAfter[index].top > before.top &&
            result.scrollAfter[index].top >=
              result.scrollAfter[index].scrollHeight - result.scrollAfter[index].height - 1),
      ),
      "Wheel did not reach an overflowing panel bottom",
    );
  else
    result.scrollLimitation =
      "Seed fixture fits the panel; real wheel input does not prove overflowing-panel behavior.";
  result.lastFieldClip = await dialog
    .locator(".history-technical-details dl > div:last-child dd")
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const clip = {
        left: 0,
        top: 0,
        right: globalThis.document.documentElement.clientWidth,
        bottom: globalThis.innerHeight,
      };
      const ancestors = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = globalThis.getComputedStyle(parent);
        const box = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
          ancestors.push(parent.className);
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            clip.left = Math.max(clip.left, box.left);
            clip.right = Math.min(clip.right, box.right);
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            clip.top = Math.max(clip.top, box.top);
            clip.bottom = Math.min(clip.bottom, box.bottom);
          }
        }
      }
      return {
        ancestors,
        fullyVisible:
          rect.left >= clip.left - 1 &&
          rect.top >= clip.top - 1 &&
          rect.right <= clip.right + 1 &&
          rect.bottom <= clip.bottom + 1,
        clip,
        field: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      };
    });
  ok(
    result.lastFieldClip.ancestors.length > 0 && result.lastFieldClip.fullyVisible,
    "Bottom field clipped by overflow ancestor",
  );
  await page.screenshot({
    path: join(evidenceRoot, `${label}-technical-bottom.png`),
    fullPage: false,
  });
  mark(`${label}:return-close-reopen`);
  await dialog.getByRole("button", { name: "返回影响报告", exact: true }).click();
  await focused(row);
  result.keyboard.push("return-row-focus");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await focused(trigger);
  await trigger.click();
  await focused(close);
  await tabs(false);
  deepStrictEqual(
    await dialog.locator(".invalidation-history").count(),
    0,
    "Reopen retained report state",
  );
  await close.click();
  await focused(trigger);
  await page.waitForLoadState("networkidle");
  result.keyboard.push("Escape-trigger-focus", "reopen-default-tasks", "close-trigger-focus");
  result.passed = true;
}

let apiProcess;
let webProcess;
let browser;
let page;
try {
  evidence.actualHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  if (expectedHead) deepStrictEqual(evidence.actualHead.toLowerCase(), expectedHead.toLowerCase());
  await assertPortIsFree(8000);
  await assertPortIsFree(5173);
  await mkdir(runDirectory, { recursive: true });
  let fixture;
  if (scenario === "invalidation-history") {
    fixture = seeder("seed");
    evidence.before = seeder("snapshot");
  }
  mark("services:start");
  apiProcess = start(
    "API",
    pythonBin,
    [
      "-m",
      "uvicorn",
      "aijian_api.main:app",
      "--app-dir",
      "services/api/src",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
      "--no-access-log",
    ],
    repositoryRoot,
  );
  await waitForUrl("http://127.0.0.1:8000/api/v1/health", apiProcess, "API");
  webProcess = start(
    "Vite",
    globalThis.process.execPath,
    [viteBin, "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
    join(repositoryRoot, "apps/studio-web"),
  );
  await waitForUrl("http://127.0.0.1:5173", webProcess, "Vite");
  mark("chrome:launch");
  browser = await chromium.launch({ channel: "chrome", env: processEnv });
  evidence.chromeVersion = browser.version();
  for (const viewport of scenario === "ui01"
    ? [{ width: 1440, height: 900 }]
    : [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
    const label = `${viewport.width}x${viewport.height}`;
    page = await browser.newPage({ viewport });
    observe(page, label);
    try {
      if (scenario === "ui01") await runUi01(page);
      else await runReport(page, fixture, label);
    } catch (error) {
      fail(error);
      await page
        .screenshot({ path: join(evidenceRoot, `${label}-failure.png`), fullPage: false })
        .catch(fail);
    } finally {
      await page.close().catch(fail);
    }
  }
} catch (error) {
  fail(error);
  if (page && !page.isClosed())
    await page.screenshot({ path: join(evidenceRoot, "failure.png"), fullPage: false }).catch(fail);
} finally {
  mark("cleanup");
  if (browser) {
    await browser.close().catch(fail);
    evidence.cleanup.push({ label: "Chrome", stopped: !browser.isConnected() });
    if (browser.isConnected()) fail(new Error("Chrome remained connected after close"));
  }
  await stopProcess(webProcess).catch(fail);
  await stopProcess(apiProcess).catch(fail);
  for (const [port, ownedProcess] of [
    [8000, apiProcess],
    [5173, webProcess],
  ]) {
    if (!ownedProcess) continue;
    try {
      await assertPortIsFree(port);
      evidence.cleanup.push({ port, verifiedFree: true });
    } catch (error) {
      evidence.cleanup.push({ port, verifiedFree: false });
      fail(error); // Report occupied ports; never kill a process discovered by port.
    }
  }
  if (evidence.before) {
    try {
      evidence.after = seeder("snapshot");
      deepStrictEqual(evidence.after, evidence.before);
      evidence.databaseUnchanged = true;
    } catch (error) {
      fail(error);
      evidence.databaseUnchanged = false;
    }
  }
  mark("final-audit");
  if (evidence.httpResponses.some(({ status }) => status !== null && status >= 400))
    fail(new Error("Workflow observed an HTTP failure, including events through close"));
  if (diagnostics.length)
    fail(
      new Error(
        `${diagnostics.length} browser diagnostic event(s), including events through close`,
      ),
    );
  if (
    scenario === "invalidation-history" &&
    apiResponses.some(({ method, status }) => method !== "GET" || status !== 200)
  )
    fail(new Error("Report workflow observed a write, unfinished request, or failed API response"));
  evidence.passed = evidence.failures.length === 0;
  evidence.status = evidence.passed ? "PASS" : "FAIL";
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  globalThis.process.stdout.write(
    `${JSON.stringify({ status: evidence.status, scenario, resultPath, failures: evidence.failures }, null, 2)}\n`,
  );
  globalThis.process.exitCode = evidence.passed ? 0 : 1;
}
