import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const developmentRoot = join(repositoryRoot, ".aijian-dev");
const evidenceRoot = join(repositoryRoot, "docs", "quality", "evidence");
const screenshotPath = join(evidenceRoot, "proposal-run-electron-1440x920.png");
const resultPath = join(evidenceRoot, "proposal-run-electron-smoke.json");
const electronExecutable = join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
  globalThis.process.platform === "win32" ? "electron.exe" : "electron",
);
const python = join(
  repositoryRoot,
  ".venv",
  globalThis.process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const evidenceHelper = join(repositoryRoot, "scripts", "e2e", "proposal_run_evidence.py");
const appRequire = createRequire(join(repositoryRoot, "apps", "studio-web", "package.json"));
const viteBin = join(dirname(appRequire.resolve("vite/package.json")), "bin", "vite.js");

async function waitForUrl(url, processHandle, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode !== null) throw new Error(`${label} exited before becoming ready`);
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return;
    } catch {
      // Local service is still starting.
    }
    await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 100));
  }
  throw new Error(`${label} did not become ready`);
}

async function waitForValue(read, accept, label) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 100));
  }
  throw new Error(`${label} did not reach the expected state`);
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

function runEvidenceHelper(args) {
  const result = spawnSync(python, [evidenceHelper, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`proposal evidence helper failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim());
}

try {
  await globalThis.fetch("http://127.0.0.1:5173");
  throw new Error("Vite is already running; this isolated smoke owns port 5173");
} catch (error) {
  if (error instanceof Error && error.message.includes("already running")) throw error;
}

await mkdir(developmentRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
const profileDirectory = await mkdtemp(join(developmentRoot, "proposal-run-profile-"));
const databasePath = join(profileDirectory, "workspace", "workspace.sqlite3");
const seeded = runEvidenceHelper(["seed", "--database", databasePath]);
const rendererDiagnostics = [];
let application;
let appWindow;
let webProcess;

try {
  webProcess = spawn(globalThis.process.execPath, [viteBin, "--host", "127.0.0.1"], {
    cwd: join(repositoryRoot, "apps", "studio-web"),
    stdio: "ignore",
  });
  await waitForUrl("http://127.0.0.1:5173", webProcess, "Vite");
  application = await electron.launch({
    executablePath: electronExecutable,
    args: [join(repositoryRoot, "apps", "desktop"), `--user-data-dir=${profileDirectory}`],
    cwd: repositoryRoot,
    env: { ...globalThis.process.env, AIJIAN_E2E_USER_DATA_DIR: profileDirectory },
    timeout: 30_000,
  });
  appWindow = await application.firstWindow({ timeout: 30_000 });
  appWindow.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      rendererDiagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  appWindow.on("pageerror", (error) => rendererDiagnostics.push(`pageerror: ${error.message}`));

  await appWindow.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  await appWindow.getByRole("heading", { name: "来源提取纵切验收", exact: true }).waitFor();
  await appWindow.getByText("source-extract-evidence.txt", { exact: true }).first().waitFor();
  await appWindow.getByRole("button", { name: "启动来源提取" }).click();
  await appWindow.getByText("来源提取已进入任务队列").waitFor();

  const reviewTask = await waitForValue(
    () =>
      appWindow.evaluate(async (projectId) => {
        const response = await globalThis.aijian.listProjectTasks(projectId);
        const task = response.data.tasks.find((item) => item.proposal_id !== null);
        return task
          ? {
              proposalId: task.proposal_id,
              taskStatus: task.task.status,
              nodeStatus: task.node.status,
              attemptStatus: task.attempt.status,
            }
          : null;
      }, seeded.project_id),
    (value) => value?.nodeStatus === "NEEDS_REVIEW",
    "source.extract proposal",
  );

  await appWindow.getByRole("button", { name: "刷新提案" }).click();
  await appWindow.getByRole("heading", { name: "来源提取提案" }).waitFor();
  await appWindow.getByText("local-fake.no-semantic-extraction").waitFor();
  await appWindow.getByRole("button", { name: "接受为 DRAFT" }).click();
  await appWindow.getByRole("button", { name: "确认创建 DRAFT" }).click();
  await appWindow.getByText("已创建不可变 DRAFT").waitFor();

  const rendererState = await appWindow.evaluate(
    (projectId) => ({
      viewport: {
        innerWidth: globalThis.innerWidth,
        innerHeight: globalThis.innerHeight,
        scrollWidth: globalThis.document.documentElement.scrollWidth,
        clientWidth: globalThis.document.documentElement.clientWidth,
      },
      pendingJournalKeys: Object.keys(globalThis.localStorage).filter((key) =>
        key.startsWith(`aijian.proposal-run.pending.v1:${projectId}`),
      ),
    }),
    seeded.project_id,
  );
  if (rendererState.viewport.scrollWidth !== rendererState.viewport.clientWidth) {
    throw new Error("proposal run workspace has horizontal overflow");
  }
  if (rendererState.pendingJournalKeys.length !== 0) {
    throw new Error("definite proposal run creation did not clear its operation journal");
  }
  if (rendererDiagnostics.length > 0) {
    throw new Error(`Electron renderer diagnostics: ${rendererDiagnostics.join(" | ")}`);
  }
  await appWindow.screenshot({ path: screenshotPath });
  await application.close();
  application = undefined;

  const persisted = runEvidenceHelper([
    "inspect",
    "--database",
    databasePath,
    "--project-id",
    seeded.project_id,
  ]);
  if (
    persisted.workflow_status !== "SUCCEEDED" ||
    persisted.node_status !== "SUCCEEDED" ||
    persisted.attempt_status !== "SUCCEEDED" ||
    persisted.task_status !== "COMPLETED" ||
    persisted.agent_status !== "SUCCEEDED" ||
    persisted.skill_status !== "SUCCEEDED" ||
    persisted.proposal_id !== reviewTask.proposalId ||
    persisted.acceptance_count !== 1 ||
    persisted.draft_version_id !== persisted.latest_version_id ||
    persisted.accepted_version_id !== null ||
    persisted.gate_decision_count !== 0
  ) {
    throw new Error(`proposal run terminal state is invalid: ${JSON.stringify(persisted)}`);
  }

  const evidence = {
    check: "phase0-proposal-run-electron",
    passed: true,
    seeded,
    reviewTask,
    persisted,
    rendererState,
    rendererDiagnostics,
    screenshot: "proposal-run-electron-1440x920.png",
  };
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  globalThis.process.stdout.write(
    `${JSON.stringify({ ...evidence, screenshotPath, resultPath })}\n`,
  );
} catch (error) {
  if (appWindow) {
    const failure = await appWindow
      .evaluate(() => ({ body: globalThis.document.body.innerText.slice(0, 2_000) }))
      .catch(() => null);
    globalThis.process.stderr.write(`${JSON.stringify({ failure, rendererDiagnostics })}\n`);
  }
  throw error;
} finally {
  try {
    if (application) await application.close();
  } finally {
    try {
      await stopProcess(webProcess);
    } finally {
      await rm(profileDirectory, { recursive: true, force: true });
    }
  }
}
