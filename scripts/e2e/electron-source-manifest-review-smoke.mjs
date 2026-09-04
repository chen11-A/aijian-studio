import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "playwright-core";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (
  args.length !== 2 ||
  args[0] !== "--expected-baseline" ||
  args[1].length !== 40 ||
  !/^[0-9a-f]{40}$/.test(args[1])
) {
  throw new Error(
    "Usage: node scripts/e2e/electron-source-manifest-review-smoke.mjs --expected-baseline <40-character lowercase Git SHA>",
  );
}
const baseline = args[1];
if (process.platform !== "win32")
  throw new Error("This native cancellation smoke requires Windows");
const powershell = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const electronExecutable = join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);
const python = join(repositoryRoot, ".venv", "Scripts", "python.exe");
const webRequire = createRequire(join(repositoryRoot, "apps", "studio-web", "package.json"));
const viteModule = pathToFileURL(
  join(dirname(webRequire.resolve("vite/package.json")), "dist", "node", "index.js"),
).href;
const evidence = {
  status: "RUNNING",
  expectedBaseline: baseline,
  startedAt: new Date().toISOString(),
  runnerPid: process.pid,
  steps: [],
  commands: [],
  rendererDiagnostics: [],
  screenshots: [],
  cleanupErrors: [],
  nativeVisualAccepted: false,
  automatedAffirmativeInput: false,
  externalHumanInputObserved: "not-observed",
};
const started = Date.now();
let evidenceDirectory;
let profileDirectory;
let application;
let window;
let vite;
let electronProcess;
let ownedProcesses = [];
const knownRoots = new Map();
let ownedPorts = [];
let primaryError;

function within(parent, candidate) {
  const tail = relative(parent, candidate);
  if (!tail || tail.startsWith("..") || isAbsolute(tail))
    throw new Error("Temporary path escaped its assigned parent");
  return candidate;
}
function safe(value) {
  return String(value)
    .replace(/\b(authorization|bearer|token)\s*[:=]?\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(-8000);
}
function step(name) {
  if (Date.now() - started > 570_000) throw new Error("Total workflow deadline exceeded");
  evidence.steps.push({ name, elapsedMs: Date.now() - started });
  console.log(`[C1 ${Math.round((Date.now() - started) / 1000)}s] ${name}`);
}
function bounded(promise, label, timeout = 10_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}
function closed(child) {
  return child.exitCode !== null || child.signalCode !== null;
}
function sameIdentity(left, right) {
  return (
    left.pid === right.pid && left.created === right.created && left.executable === right.executable
  );
}
function knownSurvivors(known, current) {
  return current.filter((item) => known.some((old) => sameIdentity(old, item)));
}
function verifiedDescendants(root, snapshot) {
  const verified = [root];
  for (let index = 0; index < verified.length; index += 1) {
    const parent = verified[index];
    for (const child of snapshot) {
      if (
        child.parentPid === parent.pid &&
        child.executable &&
        Number.isFinite(Date.parse(child.created)) &&
        child.created >= parent.created &&
        !verified.some((item) => item.pid === child.pid)
      )
        verified.push(child);
    }
  }
  return verified;
}
async function rememberRunningTree(child) {
  if (closed(child)) throw new Error("Cannot establish ownership after root exit");
  const tree = await processInventory([child.pid]);
  const root = tree.find((item) => item.pid === child.pid);
  if (closed(child) || !root || root.parentPid !== process.pid || !root.executable) {
    throw new Error("Cannot establish live runner-child identity");
  }
  const previous = knownRoots.get(child.pid);
  if (previous && !sameIdentity(previous, root))
    throw new Error("Root identity changed; ownership not extended");
  if (!previous) knownRoots.set(child.pid, Object.freeze({ ...root }));
  for (const item of verifiedDescendants(root, tree)) {
    if (!ownedProcesses.some((old) => sameIdentity(old, item)))
      ownedProcesses.push(Object.freeze({ ...item }));
  }
}
async function stopExactOwnedProcess(item) {
  // Keep an OS process handle open across identity verification and termination.
  // A reused numeric PID must never confer authority to stop the new process.
  const created = item.created.replace(/(\.\d{6})\d*Z$/, "$1Z");
  const executable = item.executable.replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $p = [System.Diagnostics.Process]::GetProcessById(${item.pid}); try { $null = $p.Handle; if ($p.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ') -ne '${created}' -or $p.MainModule.FileName -ne '${executable}') { throw 'Owned process identity changed; refusing termination' }; $p.Kill(); if (-not $p.WaitForExit(10000)) { throw 'Exact owned process did not exit' } } finally { $p.Dispose() }`;
  await command(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", script],
    "forced-exact-owned-process-cleanup",
  );
}
async function awaitClose(child, label) {
  if (closed(child)) return;
  await bounded(new Promise((resolveClose) => child.once("close", resolveClose)), label);
}
async function command(executable, commandArgs, label, timeout = 20_000) {
  const child = spawn(executable, commandArgs, {
    cwd: repositoryRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PYTHONPATH: join(repositoryRoot, "services", "api", "src"),
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr = safe(stderr + chunk);
  });
  const result = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code));
  });
  try {
    const code = await bounded(result, label, timeout);
    evidence.commands.push({ label, pid: child.pid, exitCode: code });
    if (code !== 0) throw new Error(`${label} exit ${code}: ${stderr}`);
    return stdout.trim();
  } catch (error) {
    if (!closed(child)) {
      try {
        child.kill();
        await awaitClose(child, `${label} failed child cleanup`);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `${label} and its cleanup failed`);
      }
    }
    throw error;
  }
}

async function observeSidecarExit() {
  const identities = ownedProcesses
    .filter((item) => /python\.exe$/i.test(item.executable ?? ""))
    .map((item) => ({ ...item, created: item.created.replace(/(\.\d{6})\d*Z$/, "$1Z") }));
  if (identities.length === 0) return null;
  const encoded = JSON.stringify(identities).replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $expected = ConvertFrom-Json '${encoded}'; $handles = @($expected | ForEach-Object { $identity = $_; $p = [System.Diagnostics.Process]::GetProcessById($identity.pid); $null = $p.Handle; if ($p.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ') -ne $identity.created -or $p.MainModule.FileName -ne $identity.executable) { $p.Dispose(); throw 'Sidecar identity changed; refusing exit evidence' }; $p }); Write-Output 'READY'; $result = @($handles | ForEach-Object { try { if (-not $_.WaitForExit(20000)) { throw 'Sidecar exit timeout' }; [pscustomobject]@{ pid=$_.Id; exitCode=$_.ExitCode } } finally { $_.Dispose() } }); ConvertTo-Json -InputObject $result -Compress`;
  const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let ready;
  const readyPromise = new Promise((resolveReady) => {
    ready = resolveReady;
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("READY")) ready();
  });
  child.stderr.on("data", (chunk) => {
    stderr = safe(stderr + chunk);
  });
  const completed = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      evidence.commands.push({ label: "sidecar-exit-observer", pid: child.pid, exitCode: code });
      if (code !== 0) reject(new Error(`Sidecar exit observer failed: ${stderr}`));
      else {
        try {
          resolveExit(JSON.parse(stdout.replace(/^READY\s*/, "")));
        } catch (error) {
          reject(error);
        }
      }
    });
  });
  completed.catch(() => {});
  try {
    await bounded(
      Promise.race([
        readyPromise,
        completed.then(() => {
          throw new Error("Sidecar observer exited before ready");
        }),
      ]),
      "sidecar observer startup",
    );
  } catch (error) {
    if (!closed(child)) {
      child.kill();
      await awaitClose(child, "sidecar observer cleanup");
    }
    throw error;
  }
  return { child, completed };
}
async function snapshot() {
  // Only this read-only subcommand is allowed. Never seed a Gate or approval.
  return JSON.parse(
    await command(
      python,
      [
        join(repositoryRoot, "scripts", "e2e", "seed_invalidation_operation_workspace.py"),
        "snapshot",
        join(profileDirectory, "workspace"),
      ],
      "readonly-snapshot",
    ),
  );
}
async function processInventory(roots) {
  assert(roots.every((pid) => Number.isSafeInteger(pid) && pid > 0));
  const script = `$all = @(Get-CimInstance Win32_Process); $ids = @(${roots.join(",")}); do { $new = @($all | Where-Object { $ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId }); $ids += $new } while ($new.Count -gt 0); @($all | Where-Object { $ids -contains [int]$_.ProcessId } | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; executable=$_.ExecutablePath; created=$_.CreationDate.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress`;
  const output = await command(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", script],
    "owned-process-inventory",
  );
  return output ? [JSON.parse(output)].flat() : [];
}
async function portsFor(processes) {
  const ids = processes.map((item) => item.pid);
  const output = await command(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ids = @(${ids.join(",")}); @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains [int]$_.OwningProcess } | ForEach-Object { [pscustomobject]@{ pid=[int]$_.OwningProcess; port=[int]$_.LocalPort; address=$_.LocalAddress } }) | ConvertTo-Json -Compress`,
    ],
    "owned-port-inventory",
  );
  return output ? [JSON.parse(output)].flat() : [];
}
async function assertUnused(port) {
  const socket = createConnection({ host: "127.0.0.1", port });
  try {
    await bounded(
      new Promise((resolveFree, reject) => {
        socket.once("connect", () => reject(new Error(`Port ${port} already has a listener`)));
        socket.once("error", (error) =>
          error.code === "ECONNREFUSED" ? resolveFree() : reject(error),
        );
      }),
      "port probe",
    );
  } finally {
    socket.destroy();
  }
}
async function assertRebind(port) {
  await bounded(
    new Promise((resolveFree, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () =>
        server.close((error) => (error ? reject(error) : resolveFree())),
      );
    }),
    "port rebind",
  );
}
async function waitUntil(check, label, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`${label} timed out`);
}

async function workflow() {
  step("baseline and isolated paths");
  evidence.actualBaseline = await command("git", ["rev-parse", "HEAD"], "baseline");
  assert.equal(evidence.actualBaseline, baseline);
  const repositoryReal = await realpath(repositoryRoot);
  const developmentRoot = join(repositoryRoot, ".aijian-dev");
  await mkdir(developmentRoot, { recursive: true });
  assert.equal(
    (await realpath(developmentRoot)).toLowerCase(),
    join(repositoryReal, ".aijian-dev").toLowerCase(),
  );
  const evidenceRoot = join(developmentRoot, "m3-g1-c1");
  await mkdir(evidenceRoot, { recursive: true });
  within(await realpath(developmentRoot), await realpath(evidenceRoot));
  evidenceDirectory = await mkdtemp(join(evidenceRoot, "runtime-"));
  profileDirectory = join(evidenceDirectory, "profile");
  await mkdir(profileDirectory);
  within(await realpath(evidenceDirectory), await realpath(profileDirectory));
  evidence.evidenceDirectory = evidenceDirectory;
  evidence.profileDirectory = profileDirectory;
  evidence.runnerSha256 = createHash("sha256")
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest("hex");
  const syntheticPath = join(profileDirectory, "synthetic-source.txt");
  await writeFile(
    syntheticPath,
    "第一章 合成来源\n这是仅用于原生取消验收的合成文本。小舟停在纸上港口，风把一张空白地图翻到下一页。\n",
    "utf8",
  );
  await assertUnused(5173);
  step("start isolated Vite and Electron");
  // An IPC-owned Vite process permits graceful server.close() on Windows.
  const viteCode = `import { createServer } from ${JSON.stringify(viteModule)};
    const server = await createServer({ root: ${JSON.stringify(join(repositoryRoot, "apps", "studio-web"))}, server: { host: '127.0.0.1', port: 5173, strictPort: true } });
    process.on('message', async message => { if (message === 'close') { await server.close(); process.disconnect(); } });
    await server.listen(); process.send('ready');`;
  vite = spawn(process.execPath, ["--input-type=module", "-e", viteCode], {
    cwd: repositoryRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  evidence.vitePid = vite.pid;
  let viteDiagnostics = "";
  vite.stdout.on("data", (chunk) => {
    viteDiagnostics = safe(viteDiagnostics + chunk);
  });
  vite.stderr.on("data", (chunk) => {
    viteDiagnostics = safe(viteDiagnostics + chunk);
  });
  await bounded(
    new Promise((resolveReady, reject) => {
      vite.once("message", (message) =>
        message === "ready" ? resolveReady() : reject(new Error("Unexpected Vite startup")),
      );
      vite.once("error", reject);
      vite.once("exit", () => reject(new Error(`Vite startup failed: ${viteDiagnostics}`)));
    }),
    "Vite startup",
    30_000,
  );
  await rememberRunningTree(vite);
  application = await electron.launch({
    executablePath: electronExecutable,
    args: [join(repositoryRoot, "apps", "desktop"), `--user-data-dir=${profileDirectory}`],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      AIJIAN_E2E_USER_DATA_DIR: profileDirectory,
      AIJIAN_E2E_PROPOSAL_RUN_RESPONSE_FAULT: "",
      AIJIAN_E2E_FAKE_TIMELINE_RUN_RESPONSE_FAULT: "",
    },
    timeout: 30_000,
  });
  electronProcess = application.process();
  await rememberRunningTree(electronProcess);
  evidence.electronPid = electronProcess.pid;
  evidence.versions = await application.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }));
  assert.equal(evidence.versions.electron, "43.2.0");
  window = await application.firstWindow({ timeout: 30_000 });
  window.setDefaultTimeout(15_000);
  window.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      evidence.rendererDiagnostics.push({ type: message.type(), text: safe(message.text()) });
  });
  window.on("pageerror", (error) =>
    evidence.rendererDiagnostics.push({ type: "pageerror", text: safe(error.message) }),
  );
  await window.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  evidence.launchedLayout = await window.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  evidence.layout = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.deepEqual(evidence.layout, { width: 1440, height: 900 });
  step("normal UI creates project and imports synthetic TXT");
  await window.getByRole("button", { name: "创建第一个项目" }).click();
  await window.getByRole("textbox", { name: "项目名称" }).fill("C1 原生取消合成验收");
  await window.getByRole("button", { name: "创建项目", exact: true }).click();
  await window.getByRole("heading", { name: "C1 原生取消合成验收", exact: true }).waitFor();
  await window.getByLabel("选择 TXT 文件").setInputFiles(syntheticPath);
  await window.getByText("synthetic-source.txt", { exact: true }).first().waitFor();
  evidence.identity = await window.evaluate(async () => {
    const projects = await globalThis.aijian.listProjects();
    if (projects.data.length !== 1) throw new Error("Expected one isolated synthetic project");
    const project = projects.data[0];
    const manifest = await globalThis.aijian.getSourceManifest(project.id);
    if (!manifest) throw new Error("Synthetic source manifest missing");
    return {
      project_id: project.id,
      version_id: manifest.data.latest_version.id,
      content_hash: manifest.data.latest_version.content_hash,
      expected_revision: manifest.data.head.revision,
    };
  });
  await window.screenshot({
    path: join(evidenceDirectory, "renderer-imported-1440x900.png"),
    timeout: 5_000,
  });
  evidence.screenshots.push({
    file: "renderer-imported-1440x900.png",
    scope: "Renderer page only, not Windows native dialog",
  });
  await rememberRunningTree(vite);
  await rememberRunningTree(electronProcess);
  evidence.ownedProcesses = ownedProcesses.slice();
  assert(
    ownedProcesses.some((item) => /python\.exe$/i.test(item.executable ?? "")),
    "Owned Sidecar process must be visible",
  );
  ownedPorts = await portsFor(ownedProcesses);
  evidence.ownedPorts = ownedPorts;
  step("install transparent native dialog observation and invoke actual preload");
  await application.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    const state = {
      calls: [],
      restore: () => {
        dialog.showMessageBox = original;
      },
    };
    globalThis.__c1NativeObservation = state;
    dialog.showMessageBox = function (parent, options) {
      const call = {
        startedAt: Date.now(),
        parentId: parent.id,
        defaultId: options.defaultId,
        cancelId: options.cancelId,
        title: options.title,
        message: options.message,
        detail: options.detail,
        hasSignal: options.signal instanceof AbortSignal,
        abortedAt: null,
        completedAt: null,
        response: null,
      };
      state.calls.push(call);
      options.signal?.addEventListener(
        "abort",
        () => {
          call.abortedAt = Date.now();
        },
        { once: true },
      );
      const promise = original.call(dialog, parent, options);
      promise.then(
        (answer) => {
          call.completedAt = Date.now();
          call.response = answer.response;
        },
        () => {
          call.completedAt = Date.now();
          call.failed = true;
        },
      );
      return promise;
    };
  });
  const pendingReview = window.evaluate(
    (input) => globalThis.aijian.submitSourceManifest(input),
    evidence.identity,
  );
  pendingReview.catch(() => {});
  await waitUntil(
    () => application.evaluate(() => globalThis.__c1NativeObservation.calls.length === 1),
    "real native dialog start",
    30_000,
  );
  step("native dialog started; capture post-prepare read-only baseline");
  evidence.beforeCancel = await snapshot();
  const heartbeat = setInterval(
    () =>
      console.log(
        `[C1 ${Math.round((Date.now() - started) / 1000)}s] Waiting for unchanged production confirmation deadline; no approval input`,
      ),
    30_000,
  );
  try {
    evidence.operationResult = await bounded(
      pendingReview,
      "production native cancellation",
      320_000,
    );
  } finally {
    clearInterval(heartbeat);
  }
  await waitUntil(
    () =>
      application.evaluate(() => globalThis.__c1NativeObservation.calls[0].completedAt !== null),
    "native promise cancellation completion",
    10_000,
  );
  evidence.native = await application.evaluate(() => globalThis.__c1NativeObservation.calls);
  assert.equal(evidence.native.length, 1);
  assert.equal(evidence.native[0].defaultId, 0);
  assert.equal(evidence.native[0].cancelId, 0);
  assert.equal(evidence.native[0].hasSignal, true);
  assert.equal(evidence.native[0].response, 0);
  assert(evidence.native[0].abortedAt !== null);
  assert.equal(evidence.operationResult.kind, "EXPIRED");
  assert.equal(evidence.operationResult.phase, "confirm_submit");
  assert.deepEqual(evidence.operationResult.completed_actions, []);
  assert.deepEqual(evidence.operationResult.receipts, []);
  step("native cancellation completed; compare read-only logical database snapshot");
  evidence.afterCancel = await snapshot();
  assert.deepEqual(evidence.afterCancel, evidence.beforeCancel);
  evidence.consumeStateUnchanged = true;
  await window.screenshot({
    path: join(evidenceDirectory, "renderer-after-expiry-1440x900.png"),
    timeout: 5_000,
  });
  evidence.screenshots.push({
    file: "renderer-after-expiry-1440x900.png",
    scope: "Renderer page only, not Windows native dialog",
  });
  assert.equal(
    evidence.rendererDiagnostics.filter(
      (item) => item.type === "pageerror" || item.type === "error",
    ).length,
    0,
  );
  await application.evaluate(() => globalThis.__c1NativeObservation.restore());
}

try {
  await bounded(workflow(), "total C1 workflow", 570_000);
} catch (error) {
  primaryError = error;
  evidence.primaryError = safe(error.stack ?? error);
} finally {
  console.log("[C1] cleanup: normal application quit and Vite server.close");
  let sidecarObserver;
  try {
    sidecarObserver = await observeSidecarExit();
  } catch (error) {
    evidence.cleanupErrors.push(safe(error.message));
  }
  if (application) {
    try {
      await bounded(application.close(), "normal Electron quit", 15_000);
      await awaitClose(electronProcess, "Electron process exit");
      evidence.electronExitCode = electronProcess.exitCode;
      assert.equal(electronProcess.exitCode, 0);
    } catch (error) {
      evidence.cleanupErrors.push(safe(error.message));
    }
  }
  if (sidecarObserver) {
    try {
      evidence.sidecarExits = await bounded(
        sidecarObserver.completed,
        "Sidecar normal exits",
        25_000,
      );
      assert(evidence.sidecarExits.every((item) => item.exitCode === 0));
    } catch (error) {
      evidence.cleanupErrors.push(safe(error.message));
      if (!closed(sidecarObserver.child)) {
        sidecarObserver.child.kill();
        await awaitClose(sidecarObserver.child, "sidecar observer forced cleanup").catch(
          (cleanupError) => evidence.cleanupErrors.push(safe(cleanupError.message)),
        );
      }
    }
  }
  if (vite && !closed(vite)) {
    try {
      vite.send("close");
      await awaitClose(vite, "normal Vite close");
      assert.equal(vite.exitCode, 0);
      evidence.viteExitCode = vite.exitCode;
    } catch (error) {
      evidence.cleanupErrors.push(safe(error.message));
    }
  }
  try {
    if (ownedProcesses.length) {
      // Never add ownership after shutdown. A root PID can already have been reused.
      const survivors = knownSurvivors(
        ownedProcesses,
        await processInventory(ownedProcesses.map((item) => item.pid)),
      );
      for (const item of survivors) {
        evidence.cleanupErrors.push(
          `Owned process ${item.pid} required forced cleanup; normal exit not accepted`,
        );
        const current = await processInventory([item.pid]);
        if (knownSurvivors([item], current).length) await stopExactOwnedProcess(item);
      }
      const remaining = await processInventory(ownedProcesses.map((item) => item.pid));
      evidence.remainingOwnedProcesses = knownSurvivors(ownedProcesses, remaining);
      assert.equal(evidence.remainingOwnedProcesses.length, 0);
    }
    for (const port of new Set([5173, ...ownedPorts.map((item) => item.port)]))
      await assertRebind(port);
    evidence.portsReleased = true;
  } catch (error) {
    evidence.cleanupErrors.push(safe(error.message));
  }
  if (!primaryError && evidence.cleanupErrors.length === 0 && profileDirectory) {
    try {
      const actual = await realpath(profileDirectory);
      within(await realpath(evidenceDirectory), actual);
      assert.equal(actual.toLowerCase(), profileDirectory.toLowerCase());
      await rm(actual, { recursive: true, force: false });
      evidence.temporaryProfileRemoved = true;
    } catch (error) {
      evidence.cleanupErrors.push(safe(error.message));
    }
  }
  evidence.status = primaryError || evidence.cleanupErrors.length ? "FAIL" : "PASS";
  evidence.elapsedMs = Date.now() - started;
  evidence.finishedAt = new Date().toISOString();
  if (evidenceDirectory)
    await writeFile(
      join(evidenceDirectory, "result.json"),
      JSON.stringify(evidence, null, 2),
      "utf8",
    );
  console.log(
    JSON.stringify(
      {
        status: evidence.status,
        evidenceDirectory,
        elapsedMs: evidence.elapsedMs,
        primaryError: evidence.primaryError,
        cleanupErrors: evidence.cleanupErrors,
      },
      null,
      2,
    ),
  );
  if (evidence.status !== "PASS") process.exitCode = 1;
}
