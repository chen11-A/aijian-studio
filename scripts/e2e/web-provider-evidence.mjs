import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const evidenceDirectory = join(repositoryRoot, "docs", "quality", "evidence");
const profileDirectory = join(repositoryRoot, ".aijian-dev", "web-evidence-profile");
const browserExecutable =
  globalThis.process.env.AIJIAN_BROWSER_EXECUTABLE ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const resultPath = join(evidenceDirectory, "provider-settings-web-smoke.json");
const taskResultPath = join(evidenceDirectory, "task-queue-web-smoke.json");
const evidenceConnectionName = "界面验收 · 本地 Ollama";
const evidenceProjectName = "Aijian Studio · 自动化验收专用";

await Promise.all([
  mkdir(evidenceDirectory, { recursive: true }),
  mkdir(profileDirectory, { recursive: true }),
]);
const browserContext = await chromium.launchPersistentContext(profileDirectory, {
  executablePath: browserExecutable,
  headless: true,
  viewport: { width: 1920, height: 1080 },
});
const page = browserContext.pages()[0] ?? (await browserContext.newPage());
page.setDefaultTimeout(20_000);
const rendererErrors = [];

page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    rendererErrors.push(`${message.type()}: ${message.text()}`);
  }
});

async function layoutEvidence() {
  return page.evaluate(() => ({
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    clientWidth: globalThis.document.documentElement.clientWidth,
  }));
}

async function deleteEvidenceConnections() {
  await page.evaluate(async (displayName) => {
    const response = await globalThis.fetch("/api/v1/provider-connections");
    if (!response.ok) throw new Error("Could not list provider evidence fixtures");
    const payload = await response.json();
    for (const connection of payload.data) {
      if (connection.display_name === displayName) {
        const deleted = await globalThis.fetch(`/api/v1/provider-connections/${connection.id}`, {
          method: "DELETE",
        });
        if (!deleted.ok) throw new Error("Could not remove provider evidence fixture");
      }
    }
  }, evidenceConnectionName);
}

const layouts = {};
const taskLayouts = {};
try {
  await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  await page.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "模型与 API" }).click();
  await page.getByRole("heading", { level: 2, name: "统一模型连接" }).waitFor();
  await deleteEvidenceConnections();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "模型与 API" }).click();

  await page.getByRole("button", { name: /Ollama 本地/ }).click();
  await page.getByLabel("连接名称").fill(evidenceConnectionName);
  await page.getByLabel("剧本 / 提示词").fill("qwen3:8b");
  await page.getByRole("button", { name: "保存连接" }).click();
  await page.getByText(evidenceConnectionName).waitFor();

  const screenshots = [
    { width: 1920, height: 1080, file: "provider-settings-1920x1080.png" },
    { width: 1440, height: 900, file: "provider-settings-1440x900.png" },
    { width: 390, height: 844, file: "provider-settings-390x844.png" },
  ];
  for (const screenshot of screenshots) {
    await page.setViewportSize({ width: screenshot.width, height: screenshot.height });
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    const layout = await layoutEvidence();
    if (layout.scrollWidth !== layout.clientWidth) {
      throw new Error(`Provider settings overflowed at ${screenshot.width}x${screenshot.height}`);
    }
    await page.screenshot({ path: join(evidenceDirectory, screenshot.file) });
    layouts[`${screenshot.width}x${screenshot.height}`] = layout;
  }

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "01 项目", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "项目与原文" }).waitFor();
  const evidenceProject = page.getByRole("button").filter({ hasText: evidenceProjectName });
  await evidenceProject.waitFor();
  await evidenceProject.click();
  await page.getByRole("heading", { level: 2, name: evidenceProjectName }).waitFor();
  await page.locator(".drop-zone:not(.loading)").waitFor();
  await page.screenshot({ path: join(evidenceDirectory, "project-workspace-1920x1080.png") });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "06 任务队列", exact: true }).click();
  await page.getByRole("heading", { level: 2, name: "制作任务总览" }).waitFor();
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  taskLayouts["1440x900"] = await layoutEvidence();
  if (taskLayouts["1440x900"].scrollWidth !== taskLayouts["1440x900"].clientWidth) {
    throw new Error("Task queue overflowed at 1440x900");
  }
  await page.screenshot({ path: join(evidenceDirectory, "task-queue-1440x900.png") });

  const firstTask = page.locator(".queue-card").first();
  await firstTask.waitFor();
  const taskCount = await page.locator(".queue-card").count();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  taskLayouts["390x844"] = await layoutEvidence();
  if (taskLayouts["390x844"].scrollWidth !== taskLayouts["390x844"].clientWidth) {
    throw new Error("Task queue overflowed at 390x844");
  }
  await page.screenshot({ path: join(evidenceDirectory, "task-queue-390x844.png") });
  await firstTask.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidenceDirectory, "task-queue-card-390x844.png") });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "模型与 API" }).click();
  await deleteEvidenceConnections();

  if (rendererErrors.length > 0) {
    throw new Error(`Web renderer console was not clean: ${rendererErrors.join(" | ")}`);
  }
  const evidence = {
    check: "web-provider-evidence",
    passed: true,
    browser: "Microsoft Edge Chromium",
    connectionCreatedThroughUi: true,
    connectionRemovedAfterEvidence: true,
    layouts,
    rendererConsoleErrors: rendererErrors,
    screenshots: [
      "provider-settings-1920x1080.png",
      "provider-settings-1440x900.png",
      "provider-settings-390x844.png",
      "project-workspace-1920x1080.png",
    ],
  };
  const taskEvidence = {
    check: "web-task-queue-evidence",
    passed: true,
    browser: "Microsoft Edge Chromium",
    taskCount,
    listRequestCompleted: true,
    layouts: taskLayouts,
    horizontalOverflow: false,
    rendererConsoleErrors: rendererErrors,
    screenshots: [
      "task-queue-1440x900.png",
      "task-queue-390x844.png",
      "task-queue-card-390x844.png",
    ],
  };
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(taskResultPath, `${JSON.stringify(taskEvidence, null, 2)}\n`, "utf8");
  globalThis.process.stdout.write(
    `${JSON.stringify({ ...evidence, resultPath, taskEvidence, taskResultPath }, null, 2)}\n`,
  );
} finally {
  await deleteEvidenceConnections().catch(() => undefined);
  await browserContext.close();
}
