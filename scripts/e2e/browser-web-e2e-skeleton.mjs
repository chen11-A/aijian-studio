import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const runDirectory = resolve(
  globalThis.process.env.AIJIAN_BROWSER_E2E_DIR ??
    join(repositoryRoot, ".aijian-dev", "web-e2e-browser-run"),
);
const evidenceRoot = join(repositoryRoot, "docs", "quality", "evidence");
const screenshotPath = join(evidenceRoot, "web-e2e-skeleton-browser-1440x900.png");
const reviewScreenshotPath = join(evidenceRoot, "production-shell-browser-980x720.png");
const mobileScreenshotPath = join(evidenceRoot, "production-shell-browser-390x844.png");
const resultPath = join(evidenceRoot, "web-e2e-skeleton-browser.json");
const expectedRoot = `${resolve(repositoryRoot, ".aijian-dev")}\\`;
if (!`${runDirectory}\\`.toLowerCase().startsWith(expectedRoot.toLowerCase())) {
  throw new Error("Browser E2E directory must stay under .aijian-dev");
}

const appRequire = createRequire(join(repositoryRoot, "apps", "studio-web", "package.json"));
const viteBin = join(dirname(appRequire.resolve("vite/package.json")), "bin", "vite.js");
const uvicornBin = resolve(
  repositoryRoot,
  ".venv",
  globalThis.process.platform === "win32" ? "Scripts/uvicorn.exe" : "bin/uvicorn",
);

async function assertPortIsFree(url, label) {
  try {
    await globalThis.fetch(url);
  } catch {
    return;
  }
  throw new Error(`${label} is already running; the isolated E2E owns its fixed local port`);
}

async function waitForUrl(url, processHandle, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready`);
    }
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return;
    } catch {
      // The service is still starting.
    }
    await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 100));
  }
  throw new Error(`${label} did not become ready`);
}

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  processHandle.kill();
  await Promise.race([
    new Promise((resolveClose) => processHandle.once("close", resolveClose)),
    new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 5_000)),
  ]);
  if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
}

await assertPortIsFree("http://127.0.0.1:8000/api/v1/health", "API");
await assertPortIsFree("http://127.0.0.1:5173", "Vite");
await rm(runDirectory, { recursive: true, force: true });
await mkdir(runDirectory, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
const novelPath = join(runDirectory, "browser-golden-20000.txt");
const paragraph = "夜航列车穿过雾城，周野核对旧信与车票，提醒林见不要遗漏任何来源证据。";
const novelText = `第一章 夜航\n${Array.from(
  { length: 700 },
  (_, index) => `${index + 1}。${paragraph}`,
).join("\n")}`;
if ([...novelText].length < 20_000) throw new Error("Browser novel fixture is too short");
await writeFile(novelPath, novelText, "utf8");

let apiProcess;
let webProcess;
let browser;
const diagnostics = [];
const apiResponses = [];

try {
  apiProcess = spawn(
    uvicornBin,
    [
      "aijian_api.main:app",
      "--app-dir",
      "services/api/src",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
    ],
    {
      cwd: repositoryRoot,
      env: { ...globalThis.process.env, AIJIAN_DATA_DIR: runDirectory },
      stdio: "ignore",
    },
  );
  await waitForUrl("http://127.0.0.1:8000/api/v1/health", apiProcess, "API");
  webProcess = spawn(globalThis.process.execPath, [viteBin, "--host", "127.0.0.1"], {
    cwd: join(repositoryRoot, "apps", "studio-web"),
    stdio: "ignore",
  });
  await waitForUrl("http://127.0.0.1:5173", webProcess, "Vite");

  browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/")) {
      apiResponses.push({
        method: response.request().method(),
        status: response.status(),
        url: response.url(),
      });
    }
  });

  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.getByText("本地工作区服务已连接").waitFor();
  await page.getByRole("button", { name: "创建第一个项目" }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("浏览器统一纵切验收");
  await page.getByRole("button", { name: "创建项目" }).click();
  await page.getByRole("heading", { name: "浏览器统一纵切验收", exact: true }).waitFor();
  await page.getByLabel("选择 TXT 文件").setInputFiles(novelPath);
  await page.getByText("browser-golden-20000.txt", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "生成 Fake 分镜时间线" }).click();
  await page.getByText("3 个镜头 · REV 1").waitFor();
  await page.getByRole("button", { name: "查看任务记录" }).click();
  await page.getByText("已完成").first().waitFor();
  await page.getByRole("button", { name: "关闭任务中心" }).click();
  await page
    .getByRole("navigation", { name: "制作流程" })
    .getByRole("button", { name: "剪辑 · 剪辑台" })
    .click();
  const timelineHeader = page.locator(".timeline-header");
  await timelineHeader.getByText("REV 1", { exact: true }).waitFor();
  await page.getByRole("option", { name: /fake-shot-01/ }).click();
  await page.getByRole("spinbutton", { name: "源入点（帧）" }).fill("5");
  await page.getByRole("spinbutton", { name: "持续（帧）" }).fill("39");
  const trimResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/timeline/trim"),
  );
  await page.getByRole("button", { name: "应用裁剪" }).click();
  const trimResponse = await trimResponsePromise;
  if (!trimResponse.ok()) throw new Error(`Timeline trim failed with ${trimResponse.status()}`);
  await timelineHeader.getByText("REV 2", { exact: true }).waitFor();

  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("本地工作区服务已连接").waitFor();
  await page.getByRole("button", { name: "任务队列" }).click();
  await page.getByText("已完成").first().waitFor();
  await page.getByRole("button", { name: "关闭任务中心" }).click();
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
    settings: await page.getByRole("button", { name: /打开模型与 API 设置/ }).isVisible(),
    importSource: await page.getByLabel("选择 TXT 文件").isVisible(),
    fakeGenerate: await page.getByRole("button", { name: "生成 Fake 分镜时间线" }).isVisible(),
  };
  await page.getByRole("region", { name: "移动端审阅模式" }).waitFor();
  if (
    mobileViewport.scrollWidth !== mobileViewport.clientWidth ||
    Object.values(mobileVisibility).some(Boolean)
  ) {
    throw new Error("Mobile review shell exposed overflow or a write/edit/generation entry point");
  }
  await page.screenshot({ path: mobileScreenshotPath, fullPage: true });
  const evidence = {
    check: "phase0-web-e2e-skeleton-browser",
    passed: true,
    novelCharacterCount: [...novelText].length,
    apiResponses,
    viewport,
    reviewViewport,
    mobileViewport,
    mobileVisibility,
    diagnostics,
    screenshot: "web-e2e-skeleton-browser-1440x900.png",
    responsiveScreenshots: [
      "production-shell-browser-980x720.png",
      "production-shell-browser-390x844.png",
    ],
  };
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  globalThis.process.stdout.write(
    `${JSON.stringify({ ...evidence, screenshotPath, resultPath }, null, 2)}\n`,
  );
} finally {
  await browser?.close();
  await stopProcess(webProcess);
  await stopProcess(apiProcess);
}
