import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deepStrictEqual } from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { _electron as electron } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const developmentRoot = join(repositoryRoot, ".aijian-dev");
const evidenceRoot = join(developmentRoot, "r04-a2-evidence");
const expectedBaseline = globalThis.process.env.AIJIAN_E2E_EXPECTED_HEAD ?? null;
if (expectedBaseline !== null && !/^[0-9a-f]{40}$/i.test(expectedBaseline)) {
  throw new Error("AIJIAN_E2E_EXPECTED_HEAD must be a 40-character Git SHA");
}
const evidenceFlag = globalThis.process.argv.indexOf("--evidence-dir");
const evidenceDirectory = resolve(
  evidenceFlag >= 0 && globalThis.process.argv[evidenceFlag + 1]
    ? globalThis.process.argv[evidenceFlag + 1]
    : join(evidenceRoot, `electron-${Date.now()}-${globalThis.process.pid}`),
);
const developmentPrefix = `${evidenceRoot.toLowerCase()}${globalThis.process.platform === "win32" ? "\\" : "/"}`;
if (!evidenceDirectory.toLowerCase().startsWith(developmentPrefix)) {
  throw new Error(
    "--evidence-dir must stay below this repository's .aijian-dev/r04-a2-evidence directory",
  );
}
const electronExecutable = join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
  globalThis.process.platform === "win32" ? "electron.exe" : "electron",
);
const appRequire = createRequire(join(repositoryRoot, "apps", "studio-web", "package.json"));
const viteBin = join(dirname(appRequire.resolve("vite/package.json")), "bin", "vite.js");
const PORT = 5173;
const DIAGNOSTIC_TAIL_BYTES = 8 * 1024;
const CLEANUP_TIMEOUT_MS = 5_000;
const DEFAULT_SEEDER_TIMEOUT_MS = 30_000;
const configuredSeederTimeout = Number(
  globalThis.process.env.AIJIAN_E2E_SEEDER_TIMEOUT_MS ?? DEFAULT_SEEDER_TIMEOUT_MS,
);
if (!Number.isSafeInteger(configuredSeederTimeout) || configuredSeederTimeout < 50) {
  throw new Error("AIJIAN_E2E_SEEDER_TIMEOUT_MS must be a safe integer of at least 50ms");
}
const SEEDER_TIMEOUT_MS = configuredSeederTimeout;

function seederTimeout(command) {
  const fault = globalThis.process.env.AIJIAN_E2E_SEEDER_FAULT;
  return fault?.endsWith("-timeout") && fault !== `${command}-timeout`
    ? DEFAULT_SEEDER_TIMEOUT_MS
    : SEEDER_TIMEOUT_MS;
}

function boundedTail(value) {
  const redacted = String(value)
    .replace(/\b(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(bearer|token)\s*[:=]?\s*[^\s,;]+/gi, "$1=[REDACTED]");
  const bytes = Buffer.from(redacted, "utf8");
  return bytes.length <= DIAGNOSTIC_TAIL_BYTES
    ? redacted
    : bytes.subarray(bytes.length - DIAGNOSTIC_TAIL_BYTES).toString("utf8");
}

function appendDiagnostic(diagnostics, key, chunk) {
  const combined = `${diagnostics[key]}${chunk}`;
  if (Buffer.byteLength(combined, "utf8") > DIAGNOSTIC_TAIL_BYTES) {
    diagnostics.truncated = true;
  }
  diagnostics[key] = boundedTail(combined);
}

function attachProcessDiagnostics(processHandle) {
  const diagnostics = { stdout: "", stderr: "", truncated: false };
  processHandle.stdout?.setEncoding("utf8");
  processHandle.stderr?.setEncoding("utf8");
  processHandle.stdout?.on("data", (chunk) => {
    appendDiagnostic(diagnostics, "stdout", chunk);
  });
  processHandle.stderr?.on("data", (chunk) => {
    appendDiagnostic(diagnostics, "stderr", chunk);
  });
  return diagnostics;
}

function withTimeout(promise, label, timeoutMs = CLEANUP_TIMEOUT_MS) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => globalThis.clearTimeout(timeoutId));
}

function seederCommand(command, workspaceDirectory) {
  const fault = globalThis.process.env.AIJIAN_E2E_SEEDER_FAULT;
  if (fault === `${command}-timeout`) {
    return { executable: globalThis.process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] };
  }
  if (fault === `${command}-start-error`) {
    return { executable: "aijian-missing-seeder-executable", args: [] };
  }
  return {
    executable: join(
      repositoryRoot,
      ".venv",
      globalThis.process.platform === "win32" ? "Scripts" : "bin",
      globalThis.process.platform === "win32" ? "python.exe" : "python",
    ),
    args: [
      join(scriptDirectory, "seed_invalidation_operation_workspace.py"),
      command,
      workspaceDirectory,
    ],
  };
}

async function runBoundedProcess({ label, start, timeoutMs, terminate }) {
  let processHandle;
  try {
    processHandle = start();
  } catch (error) {
    throw new Error(`${label} failed to start: ${boundedTail(error.message)}`, { cause: error });
  }
  const diagnostics = attachProcessDiagnostics(processHandle);
  const closeState = waitForClose(processHandle);
  const startupState = new Promise((resolveStartup) =>
    processHandle.once("error", (error) => resolveStartup({ type: "startup-error", error })),
  );
  let outcome;
  try {
    outcome = await withTimeout(
      Promise.race([closeState.promise.then(() => ({ type: "closed" })), startupState]),
      label,
      timeoutMs,
    );
  } catch (timeoutError) {
    try {
      await terminate(processHandle, label);
    } catch (cleanupError) {
      const timeoutFailure = new Error(
        `${label} timed out; stdout=${boundedTail(diagnostics.stdout)}; stderr=${boundedTail(diagnostics.stderr)}`,
        { cause: timeoutError },
      );
      throw new AggregateError(
        [timeoutFailure, cleanupError],
        `${label} timed out during cleanup`,
        { cause: cleanupError },
      );
    }
    throw new Error(
      `${label} timed out; stdout=${boundedTail(diagnostics.stdout)}; stderr=${boundedTail(diagnostics.stderr)}`,
      { cause: timeoutError },
    );
  }
  if (outcome.type === "startup-error") {
    throw new Error(`${label} failed to start: ${boundedTail(outcome.error.message)}`, {
      cause: outcome.error,
    });
  }
  if (diagnostics.truncated) {
    throw new Error(
      `${label} exceeded the ${DIAGNOSTIC_TAIL_BYTES}-byte diagnostic output limit; stdout=${boundedTail(diagnostics.stdout)}; stderr=${boundedTail(diagnostics.stderr)}`,
    );
  }
  if (processHandle.exitCode !== 0) {
    throw new Error(
      `${label} failed: stdout=${boundedTail(diagnostics.stdout)}; stderr=${boundedTail(diagnostics.stderr)}`,
    );
  }
  return diagnostics;
}

async function runBoundedJsonProcess(options) {
  const diagnostics = await runBoundedProcess(options);
  try {
    return JSON.parse(diagnostics.stdout);
  } catch (parseError) {
    throw new Error(`${options.label} returned invalid JSON`, { cause: parseError });
  }
}

async function runSeeder(command, workspaceDirectory) {
  const processCommand = seederCommand(command, workspaceDirectory);
  return runBoundedJsonProcess({
    label: `invalidation smoke ${command}`,
    start: () =>
      spawn(processCommand.executable, processCommand.args, {
        cwd: repositoryRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...globalThis.process.env,
          PYTHONPATH: join(repositoryRoot, "services", "api", "src"),
        },
      }),
    timeoutMs: seederTimeout(command),
    terminate: (processHandle, label) => stopProcess(processHandle, label),
  });
}

function fakeProcess({ stdout = "", stderr = "", exitCode = 0, startupError, close = true }) {
  const processHandle = new EventEmitter();
  processHandle.stdout = new PassThrough();
  processHandle.stderr = new PassThrough();
  processHandle.exitCode = null;
  processHandle.signalCode = null;
  processHandle.kill = () => true;
  globalThis.queueMicrotask(() => {
    processHandle.stdout.end(stdout);
    processHandle.stderr.end(stderr);
    if (startupError) {
      processHandle.emit("error", startupError);
      return;
    }
    if (close) {
      processHandle.exitCode = exitCode;
      processHandle.emit("close", exitCode, null);
    }
  });
  return processHandle;
}

async function expectRunnerFailure(label, action, verify) {
  let failure;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  if (!failure) throw new Error(`${label} unexpectedly succeeded`);
  verify(failure);
}

async function runProcessRunnerSelfTests() {
  const result = await runBoundedJsonProcess({
    label: "runner success",
    start: () => fakeProcess({ stdout: '{"ok":true}' }),
    timeoutMs: 50,
    terminate: async () => {},
  });
  deepStrictEqual(result, { ok: true });

  const startupError = new Error("ENOENT fixture");
  await expectRunnerFailure(
    "runner startup error",
    () =>
      runBoundedJsonProcess({
        label: "runner startup",
        start: () => fakeProcess({ startupError }),
        timeoutMs: 50,
        terminate: async () => {},
      }),
    (error) => {
      if (!error.message.includes("failed to start") || error.cause !== startupError) {
        throw new Error("runner startup error did not preserve its cause");
      }
    },
  );

  let timeoutTerminationCount = 0;
  await expectRunnerFailure(
    "runner timeout",
    () =>
      runBoundedJsonProcess({
        label: "runner timeout",
        start: () => fakeProcess({ close: false }),
        timeoutMs: 50,
        terminate: async () => {
          timeoutTerminationCount += 1;
        },
      }),
    (error) => {
      if (!error.message.includes("timed out")) throw new Error("runner timeout was not reported");
    },
  );
  if (timeoutTerminationCount !== 1)
    throw new Error("runner timeout did not terminate exactly once");

  const terminationError = new Error("fixture termination failed");
  await expectRunnerFailure(
    "runner timeout cleanup failure",
    () =>
      runBoundedJsonProcess({
        label: "runner double failure",
        start: () => fakeProcess({ close: false }),
        timeoutMs: 50,
        terminate: async () => {
          throw terminationError;
        },
      }),
    (error) => {
      if (
        !(error instanceof AggregateError) ||
        error.errors.length !== 2 ||
        error.errors[1] !== terminationError
      ) {
        throw new Error("runner timeout cleanup failure did not retain both errors");
      }
    },
  );

  await expectRunnerFailure(
    "runner nonzero exit",
    () =>
      runBoundedJsonProcess({
        label: "runner nonzero",
        start: () => fakeProcess({ stdout: "failure", exitCode: 1 }),
        timeoutMs: 50,
        terminate: async () => {},
      }),
    (error) => {
      if (!error.message.includes("failed"))
        throw new Error("runner nonzero exit was not reported");
    },
  );

  await expectRunnerFailure(
    "runner invalid JSON",
    () =>
      runBoundedJsonProcess({
        label: "runner invalid JSON",
        start: () => fakeProcess({ stdout: "not-json" }),
        timeoutMs: 50,
        terminate: async () => {},
      }),
    (error) => {
      if (!error.message.includes("invalid JSON"))
        throw new Error("runner invalid JSON was not reported");
    },
  );

  await expectRunnerFailure(
    "runner bounded output",
    () =>
      runBoundedJsonProcess({
        label: "runner output",
        start: () => fakeProcess({ stdout: "x".repeat(DIAGNOSTIC_TAIL_BYTES + 1) }),
        timeoutMs: 50,
        terminate: async () => {},
      }),
    (error) => {
      if (!error.message.includes("diagnostic output limit")) {
        throw new Error("runner output limit was not reported");
      }
    },
  );

  const redacted = boundedTail(
    "Authorization: Bearer fixture-secret token=other-secret bearer third-secret",
  );
  if (/fixture-secret|other-secret|third-secret/.test(redacted)) {
    throw new Error("runner diagnostics did not fully redact credentials");
  }

  const signaledProcess = fakeProcess({ close: false });
  signaledProcess.signalCode = "SIGTERM";
  if (!waitForClose(signaledProcess).closed()) {
    throw new Error("runner did not treat a signalCode as closed");
  }

  const taskkillStartupError = new Error("ENOENT taskkill fixture");
  await expectRunnerFailure(
    "taskkill startup error",
    () =>
      runTaskkill(123, "taskkill startup", {
        start: () => fakeProcess({ startupError: taskkillStartupError }),
        timeoutMs: 50,
        terminate: async () => {},
      }),
    (error) => {
      if (!error.message.includes("failed to start") || error.cause !== taskkillStartupError) {
        throw new Error("taskkill startup error did not preserve its cause");
      }
    },
  );

  await expectRunnerFailure(
    "taskkill nonzero exit",
    () =>
      runTaskkill(123, "taskkill nonzero", {
        start: () => fakeProcess({ stderr: "taskkill fixture failure", exitCode: 1 }),
        timeoutMs: 50,
        terminate: async () => {},
      }),
    (error) => {
      if (!error.message.includes("failed"))
        throw new Error("taskkill nonzero exit was not reported");
    },
  );

  const hangingTaskkill = fakeProcess({ close: false });
  let taskkillTerminationCount = 0;
  await expectRunnerFailure(
    "taskkill timeout",
    () =>
      runTaskkill(123, "taskkill timeout", {
        start: () => hangingTaskkill,
        timeoutMs: 50,
        terminate: async (processHandle) => {
          taskkillTerminationCount += 1;
          processHandle.exitCode = 1;
          processHandle.emit("close", 1, null);
        },
      }),
    (error) => {
      if (!error.message.includes("timed out"))
        throw new Error("taskkill timeout was not reported");
    },
  );
  if (taskkillTerminationCount !== 1 || !waitForClose(hangingTaskkill).closed()) {
    throw new Error("taskkill timeout did not terminate and await its own process");
  }

  if (globalThis.process.platform === "win32") {
    await runWindowsProcessTreeFixture();
    await expectRunnerFailure(
      "Windows process-tree fixture parent-only regression",
      () => runWindowsProcessTreeFixture({ parentOnlyKill: true }),
      (error) => {
        if (!error.message.includes("child")) {
          throw new Error(
            "Windows process-tree fixture did not report the original child-process regression",
          );
        }
      },
    );
  }
}

async function assertPortUnusedBeforeVite() {
  const socket = createConnection({ host: "127.0.0.1", port: PORT });
  const closed = new Promise((resolveClose) => socket.once("close", resolveClose));
  try {
    await withTimeout(
      new Promise((resolveAvailable, rejectUnavailable) => {
        socket.once("connect", () =>
          rejectUnavailable(new Error(`port ${PORT} already has a listener`)),
        );
        socket.once("error", (error) => {
          if (error.code === "ECONNREFUSED") {
            resolveAvailable();
            return;
          }
          rejectUnavailable(
            new Error(
              `port ${PORT} probe failed: ${String(error.code)} ${boundedTail(error.message)}`,
            ),
          );
        });
      }),
      "port probe",
    );
  } finally {
    socket.destroy();
    await withTimeout(closed, "port probe socket cleanup");
  }
}

async function assertPortRebindAfterCleanup() {
  await withTimeout(
    new Promise((resolveAvailable, rejectUnavailable) => {
      const server = createServer();
      server.once("error", (error) =>
        rejectUnavailable(
          new Error(`port ${PORT} could not rebind: ${boundedTail(error.message)}`),
        ),
      );
      server.listen(PORT, "127.0.0.1", () =>
        server.close((error) => (error ? rejectUnavailable(error) : resolveAvailable())),
      );
    }),
    "port rebind cleanup",
  );
}

function viteFailure(message, processHandle, diagnostics) {
  return new Error(
    `${message}; exitCode=${String(processHandle.exitCode)}; stdout=${boundedTail(diagnostics.stdout)}; stderr=${boundedTail(diagnostics.stderr)}`,
  );
}

async function waitForUrl(url, processHandle, diagnostics) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw viteFailure("Vite exited before becoming ready", processHandle, diagnostics);
    }
    try {
      if ((await globalThis.fetch(url)).ok) return;
    } catch {
      // Retry only while the isolated Vite process remains alive.
    }
    await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 500));
  }
  throw viteFailure("Vite did not become ready", processHandle, diagnostics);
}

function waitForClose(processHandle) {
  let closed =
    (processHandle.exitCode !== undefined && processHandle.exitCode !== null) ||
    (processHandle.signalCode !== undefined && processHandle.signalCode !== null);
  const promise = closed
    ? Promise.resolve()
    : new Promise((resolveClose) =>
        processHandle.once("close", () => {
          closed = true;
          resolveClose();
        }),
      );
  return { closed: () => closed, promise };
}

async function stopProcess(processHandle, label) {
  if (!processHandle) return;
  const closeState = waitForClose(processHandle);
  if (globalThis.process.platform === "win32") {
    if (!closeState.closed()) await forceKillProcessTree(processHandle, label);
    await withTimeout(closeState.promise, `${label} tree shutdown`);
    if (!closeState.closed()) throw new Error(`${label} remained alive after tree cleanup`);
    return;
  }
  if (!closeState.closed() && !processHandle.kill()) {
    throw new Error(`${label} did not accept a normal termination signal`);
  }
  try {
    await withTimeout(closeState.promise, `${label} normal shutdown`);
  } catch (normalError) {
    if (!closeState.closed()) {
      try {
        await forceKillProcessTree(processHandle, label);
      } catch (forceError) {
        if (!closeState.closed()) {
          throw new AggregateError(
            [normalError, forceError],
            `${label} resisted forced termination`,
            {
              cause: forceError,
            },
          );
        }
      }
    }
    try {
      await withTimeout(closeState.promise, `${label} forced shutdown`);
    } catch (forcedError) {
      throw new AggregateError(
        [normalError, forcedError],
        `${label} did not close after forced termination`,
        {
          cause: forcedError,
        },
      );
    }
    throw new AggregateError([normalError], `${label} required forced termination`, {
      cause: normalError,
    });
  }
  if (!closeState.closed()) throw new Error(`${label} remained alive after cleanup`);
}

async function forceKillProcessTree(processHandle, label) {
  if (globalThis.process.platform !== "win32") {
    if (!processHandle.kill("SIGKILL"))
      throw new Error(`${label} did not accept forced termination`);
    return;
  }
  if (processHandle.pid === undefined) throw new Error(`${label} has no process id for taskkill`);
  await runTaskkill(processHandle.pid, label);
}

function taskkillExecutable() {
  return join(globalThis.process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
}

async function terminateSingleProcess(processHandle, label) {
  const closeState = waitForClose(processHandle);
  if (closeState.closed()) return;
  if (!processHandle.kill("SIGKILL")) {
    throw new Error(`${label} did not accept termination`);
  }
  await withTimeout(closeState.promise, `${label} termination`);
  if (!closeState.closed()) throw new Error(`${label} remained alive after termination`);
}

async function runTaskkill(processId, label, options = {}) {
  const executable = options.executable ?? taskkillExecutable();
  return runBoundedProcess({
    label: `${label} taskkill`,
    start:
      options.start ??
      (() =>
        spawn(executable, ["/pid", String(processId), "/t", "/f"], {
          stdio: ["ignore", "pipe", "pipe"],
        })),
    timeoutMs: options.timeoutMs ?? CLEANUP_TIMEOUT_MS,
    terminate: options.terminate ?? terminateSingleProcess,
  });
}

async function waitForFixtureReady(processHandle) {
  let stdout = "";
  const ready = new Promise((resolveReady, rejectReady) => {
    processHandle.stdout?.setEncoding("utf8");
    processHandle.stdout?.on("data", (chunk) => {
      stdout = boundedTail(`${stdout}${chunk}`);
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      try {
        resolveReady(JSON.parse(stdout.slice(0, newline)));
      } catch (error) {
        rejectReady(
          new Error("Windows process-tree fixture returned invalid JSON", { cause: error }),
        );
      }
    });
    processHandle.once("error", (error) =>
      rejectReady(
        new Error(`Windows process-tree fixture failed to start: ${boundedTail(error.message)}`, {
          cause: error,
        }),
      ),
    );
    processHandle.once("close", () =>
      rejectReady(
        new Error(
          `Windows process-tree fixture closed before becoming ready; stdout=${boundedTail(stdout)}`,
        ),
      ),
    );
  });
  return withTimeout(ready, "Windows process-tree fixture startup");
}

function pidIsGone(processId, label) {
  try {
    globalThis.process.kill(processId, 0);
  } catch (error) {
    if (error.code === "ESRCH") return true;
    throw new Error(`${label} PID probe failed: ${boundedTail(error.message)}`, { cause: error });
  }
  return false;
}

function assertPidGone(processId, label) {
  if (pidIsGone(processId, label)) return;
  throw new Error(`${label} process ${processId} remained alive after tree cleanup`);
}

async function assertPortCanRebind(port, label) {
  const server = createServer();
  await withTimeout(
    new Promise((resolveListen, rejectListen) => {
      server.once("error", (error) =>
        rejectListen(
          new Error(`${label} could not bind port ${port}: ${boundedTail(error.message)}`, {
            cause: error,
          }),
        ),
      );
      server.listen(port, "127.0.0.1", resolveListen);
    }),
    `${label} bind`,
  );
  await withTimeout(
    new Promise((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    ),
    `${label} close`,
  );
}

async function cleanupWindowsProcessTreeFixtureChild(ready) {
  let terminationError;
  if (!pidIsGone(ready.childPid, "Windows process-tree fixture child cleanup")) {
    try {
      await runTaskkill(ready.childPid, "Windows process-tree fixture child cleanup");
    } catch (error) {
      terminationError = error;
    }
  }
  let verificationError;
  try {
    assertPidGone(ready.childPid, "Windows process-tree fixture child cleanup");
    await assertPortCanRebind(ready.port, "Windows process-tree fixture child cleanup");
  } catch (error) {
    verificationError = error;
  }
  if (terminationError && verificationError) {
    throw new AggregateError(
      [terminationError, verificationError],
      "Windows process-tree fixture child cleanup failed",
      { cause: verificationError },
    );
  }
  if (verificationError) throw verificationError;
}

async function runWindowsProcessTreeFixture({ parentOnlyKill = false } = {}) {
  const childProgram = [
    "const { createServer } = require('node:net');",
    "const server = createServer();",
    "server.listen(0, '127.0.0.1', () => {",
    "  process.stdout.write(JSON.stringify({ childPid: process.pid, port: server.address().port }) + '\\n');",
    "});",
    "setInterval(() => {}, 1_000);",
  ].join("\n");
  const parentProgram = [
    "const { spawn } = require('node:child_process');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });`,
    "child.stdout.once('data', (chunk) => {",
    "  process.stdout.write(JSON.stringify({ parentPid: process.pid, ...JSON.parse(chunk.toString()) }) + '\\n');",
    "});",
    "child.once('error', (error) => { process.stderr.write(error.message); process.exit(1); });",
    "setInterval(() => {}, 1_000);",
  ].join("\n");
  const fixture = spawn(globalThis.process.execPath, ["-e", parentProgram], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closeState = waitForClose(fixture);
  let ready;
  let primaryError;
  try {
    ready = await waitForFixtureReady(fixture);
    if (parentOnlyKill) {
      await terminateSingleProcess(
        fixture,
        "Windows process-tree fixture injected parent-only kill",
      );
    } else {
      await stopProcess(fixture, "Windows process-tree fixture");
    }
    await withTimeout(closeState.promise, "Windows process-tree fixture shutdown");
    assertPidGone(ready.parentPid, "Windows process-tree fixture parent");
    assertPidGone(ready.childPid, "Windows process-tree fixture child");
    await assertPortCanRebind(ready.port, "Windows process-tree fixture child");
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = [];
  if (!closeState.closed()) {
    try {
      await forceKillProcessTree(fixture, "Windows process-tree fixture cleanup");
      await withTimeout(closeState.promise, "Windows process-tree fixture cleanup shutdown");
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  if (ready) {
    try {
      await cleanupWindowsProcessTreeFixtureChild(ready);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      "Windows process-tree fixture and cleanup both failed",
      { cause: cleanupErrors[0] },
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Windows process-tree fixture cleanup failed", {
      cause: cleanupErrors[0],
    });
  }
}

async function closeApplication(applicationHandle) {
  if (!applicationHandle) return;
  const processHandle = applicationHandle.process();
  try {
    await withTimeout(applicationHandle.close(), "Electron normal shutdown");
  } catch (normalError) {
    try {
      await stopProcess(processHandle, "Electron");
    } catch (forcedError) {
      throw new AggregateError([normalError, forcedError], "Electron cleanup failed", {
        cause: forcedError,
      });
    }
    throw new AggregateError([normalError], "Electron required forced termination", {
      cause: normalError,
    });
  }
}

// Observe React/rAF completion without repairing focus or changing DOM state.
async function waitForAssertion(label, read, verify) {
  const deadline = Date.now() + 5_000;
  let lastError;
  do {
    const actual = await read();
    try {
      verify(actual);
      return actual;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 50));
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${boundedTail(lastError?.message)}`, { cause: lastError });
}

async function assertFocus(locator, label, keyboardEvidence) {
  const focused = await waitForAssertion(
    label,
    () => locator.evaluate((element) => element === globalThis.document.activeElement),
    (value) => deepStrictEqual(value, true),
  );
  keyboardEvidence.push({ label, focused });
}

async function assertTabs(drawer, activeIndex, label, keyboardEvidence, requireFocus = true) {
  const state = await waitForAssertion(
    label,
    () =>
      drawer.evaluate((root) => {
        const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
        const panels = Array.from(root.querySelectorAll('[role="tabpanel"]'));
        return {
          tabs: tabs.map((tab) => ({
            id: tab.id,
            selected: tab.getAttribute("aria-selected"),
            tabIndex: tab.tabIndex,
            focused: tab === globalThis.document.activeElement,
            controls: tab.getAttribute("aria-controls"),
          })),
          panels: panels.map((panel) => ({
            id: panel.id,
            labelledBy: panel.getAttribute("aria-labelledby"),
          })),
        };
      }),
    ({ tabs, panels }) => {
      deepStrictEqual(tabs.length, 2);
      deepStrictEqual(panels.length, 1);
      tabs.forEach((tab, index) => {
        deepStrictEqual(tab.selected, String(index === activeIndex));
        deepStrictEqual(tab.tabIndex, index === activeIndex ? 0 : -1);
        if (requireFocus) deepStrictEqual(tab.focused, index === activeIndex);
      });
      deepStrictEqual(panels[0].labelledBy, tabs[activeIndex].id);
      deepStrictEqual(panels[0].id, tabs[activeIndex].controls);
    },
  );
  keyboardEvidence.push({ label, ...state });
}

async function assertTaskContent(drawer, label, keyboardEvidence) {
  await drawer
    .getByRole("heading", { name: "制作任务总览", exact: true })
    .waitFor({ state: "visible" });
  const reports = await waitForAssertion(
    label,
    () => drawer.locator(".invalidation-history").count(),
    (count) => deepStrictEqual(count, 0),
  );
  keyboardEvidence.push({ label, taskHeadingVisible: true, reportPanelCount: reports });
}

async function measureLayout(drawer) {
  return drawer.evaluate((root) => {
    const rect = (element) => {
      const { x, y, width, height, top, right, bottom, left } = element.getBoundingClientRect();
      return { x, y, width, height, top, right, bottom, left };
    };
    const visible = (element) => {
      const style = globalThis.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return (
        style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
      );
    };
    const business = [
      ".history-operation strong",
      ".history-path header span",
      ".history-path header strong",
      ".history-technical-details summary",
      '[role="tab"]',
      ".task-drawer-heading button",
      ".history-mobile-back",
    ];
    const metadata = [
      ".history-operation time",
      ".history-operation span",
      ".history-operation small",
      ".history-reasons li",
      ".history-reasons code",
      ".history-reasons span",
      ".history-reasons em",
      ".history-technical-details dt",
      ".history-technical-details dd",
    ];
    const fonts = [
      ...business.map((selector) => ({ selector, minimum: 14 })),
      ...metadata.map((selector) => ({ selector, minimum: 12 })),
    ].map((group) => ({
      ...group,
      elements: Array.from(root.querySelectorAll(group.selector))
        .filter(visible)
        .map((element) => ({
          text: element.textContent?.trim(),
          fontSize: Number.parseFloat(globalThis.getComputedStyle(element).fontSize),
          rect: rect(element),
        })),
    }));
    const controls = ["button", "summary"].map((selector) => ({
      selector,
      elements: Array.from(root.querySelectorAll(selector))
        .filter(visible)
        .map((element) => ({ text: element.textContent?.trim(), rect: rect(element) })),
    }));
    const overflow = [
      { selector: "document", elements: [globalThis.document.documentElement] },
      { selector: "drawer", elements: [root] },
      ...['[role="tabpanel"]', ".invalidation-history", ".history-list", ".history-detail"].map(
        (selector) => ({ selector, elements: Array.from(root.querySelectorAll(selector)) }),
      ),
    ].map((group) => ({
      selector: group.selector,
      elements: group.elements.map((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        rect: rect(element),
      })),
    }));
    const backdrop = root.closest(".task-drawer-backdrop");
    return {
      viewport: {
        width: globalThis.innerWidth,
        height: globalThis.innerHeight,
        clientWidth: globalThis.document.documentElement.clientWidth,
      },
      backdrop: backdrop ? { rect: rect(backdrop), clientWidth: backdrop.clientWidth } : null,
      drawer: rect(root),
      fonts,
      controls,
      overflow,
    };
  });
}

function verifyLayout(layout) {
  deepStrictEqual(
    { width: layout.viewport.width, height: layout.viewport.height },
    { width: 1440, height: 900 },
  );
  const box = layout.drawer;
  const tolerance = 0.5;
  const backdrop = layout.backdrop;
  // Windows' classic vertical scrollbar is outside the usable layout viewport.
  if (
    !backdrop ||
    Math.abs(backdrop.rect.left) > tolerance ||
    Math.abs(backdrop.rect.right - layout.viewport.clientWidth) > tolerance ||
    Math.abs(backdrop.clientWidth - layout.viewport.clientWidth) > tolerance
  ) {
    throw new Error(`backdrop does not cover the layout viewport: ${JSON.stringify(backdrop)}`);
  }
  if (
    Math.abs(box.width - 1120) > tolerance ||
    Math.abs((box.left + box.right) / 2 - (backdrop.rect.left + backdrop.rect.right) / 2) >
      tolerance ||
    box.height <= 0 ||
    box.height > 820 + tolerance ||
    box.left < -tolerance ||
    box.top < -tolerance ||
    box.right > 1440 + tolerance ||
    box.bottom > 900 + tolerance
  ) {
    throw new Error(`drawer geometry failed: ${JSON.stringify(box)}`);
  }
  for (const group of layout.fonts) {
    if (!group.elements.length) throw new Error(`empty font group: ${group.selector}`);
    for (const element of group.elements) {
      if (!Number.isFinite(element.fontSize) || element.fontSize < group.minimum)
        throw new Error(
          `font below ${group.minimum}px: ${group.selector} ${JSON.stringify(element)}`,
        );
    }
  }
  for (const group of layout.controls) {
    if (!group.elements.length) throw new Error(`empty control group: ${group.selector}`);
    for (const element of group.elements) {
      if (element.rect.width < 44 - tolerance || element.rect.height < 44 - tolerance)
        throw new Error(`control below 44px: ${JSON.stringify(element)}`);
    }
  }
  for (const group of layout.overflow) {
    if (!group.elements.length) throw new Error(`empty overflow group: ${group.selector}`);
    for (const element of group.elements) {
      if (element.scrollWidth > element.clientWidth + tolerance)
        throw new Error(`horizontal overflow: ${group.selector} ${JSON.stringify(element)}`);
    }
  }
}

async function assessmentGeometry(assessment) {
  return assessment.evaluate((element) => {
    const target = element.getBoundingClientRect();
    const intersection = {
      left: 0,
      top: 0,
      right: globalThis.innerWidth,
      bottom: globalThis.innerHeight,
    };
    const ancestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = globalThis.getComputedStyle(parent);
      const clipX = /auto|scroll|hidden|clip/.test(style.overflowX);
      const clipY = /auto|scroll|hidden|clip/.test(style.overflowY);
      if (!clipX && !clipY) continue;
      const box = parent.getBoundingClientRect();
      const clip = {
        left: box.left + parent.clientLeft,
        top: box.top + parent.clientTop,
        right: box.left + parent.clientLeft + parent.clientWidth,
        bottom: box.top + parent.clientTop + parent.clientHeight,
      };
      ancestors.push({
        tag: parent.tagName,
        className: parent.className,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollTop: parent.scrollTop,
        clip,
      });
      if (clipX) {
        intersection.left = Math.max(intersection.left, clip.left);
        intersection.right = Math.min(intersection.right, clip.right);
      }
      if (clipY) {
        intersection.top = Math.max(intersection.top, clip.top);
        intersection.bottom = Math.min(intersection.bottom, clip.bottom);
      }
    }
    const rect = {
      left: target.left,
      top: target.top,
      right: target.right,
      bottom: target.bottom,
      width: target.width,
      height: target.height,
    };
    const fullyReachable =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left >= intersection.left - 0.5 &&
      rect.top >= intersection.top - 0.5 &&
      rect.right <= intersection.right + 0.5 &&
      rect.bottom <= intersection.bottom + 0.5;
    return { rect, intersection, ancestors, fullyReachable };
  });
}

async function scrollAssessmentIntoView(window, assessment, scrollEvidence) {
  // A locator's visibility or scrollIntoView would not prove wheel reachability.
  for (let attempt = 0; attempt <= 12; attempt += 1) {
    await window.evaluate(
      () =>
        new Promise((done) =>
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(done)),
        ),
    );
    const sample = await assessmentGeometry(assessment);
    scrollEvidence.push({ attempt, ...sample });
    if (sample.fullyReachable && attempt > 0) return;
    if (attempt === 12) break;
    const clip = sample.intersection;
    if (clip.right <= clip.left || clip.bottom <= clip.top)
      throw new Error("Assessment has no visible scrolling area");
    await window.mouse.move((clip.left + clip.right) / 2, (clip.top + clip.bottom) / 2);
    const wheelDeltaY = sample.fullyReachable || sample.rect.bottom > clip.bottom ? 450 : -450;
    await window.mouse.wheel(0, wheelDeltaY);
    scrollEvidence.at(-1).wheelDeltaY = wheelDeltaY;
    await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 100));
  }
  throw new Error(
    "Assessment did not fully enter the viewport and every clipping ancestor after 12 real wheel events",
  );
}

async function main() {
  await mkdir(developmentRoot, { recursive: true });
  await mkdir(dirname(evidenceDirectory), { recursive: true });
  // Refuse reuse: no screenshots or JSON from an earlier run can be overwritten.
  await mkdir(evidenceDirectory);
  let profileDirectory;
  let workspaceDirectory;
  let application;
  let window;
  let viteProcess;
  let viteDiagnostics;
  let viteClosed = false;
  let primaryError;
  let passResult;
  const rendererDiagnostics = [];
  const requestFailures = [];
  const evidence = {
    status: "RUNNING",
    baseline: {
      expected: expectedBaseline,
      actual: null,
      mode: expectedBaseline === null ? "record-only" : "exact-match",
      verified: false,
    },
    runner: { path: "scripts/e2e/electron-invalidation-operation-smoke.mjs", sha256: null },
    electronVersion: null,
    evidenceDirectory,
    startedAt: new Date().toISOString(),
    stages: [],
    uiDetail: null,
    layout: null,
    keyboard: [],
    scroll: [],
    database: {
      representation: "canonical-logical-database-sha256-and-counts",
      before: null,
      after: null,
      unchanged: null,
    },
    screenshots: [],
    diagnostics: {
      renderer: rendererDiagnostics,
      requestFailures,
      networkScope:
        "Renderer requestfailed events only; Electron main-process network was not directly observed. No renderer failures is not an end-to-end network acceptance.",
    },
  };
  const stage = (name) => {
    const previous = evidence.stages.at(-1);
    if (previous?.status === "RUNNING") previous.status = "PASS";
    evidence.stages.push({ name, status: "RUNNING" });
  };
  const screenshot = async (name, fullPage = false) => {
    await window.screenshot({ path: join(evidenceDirectory, name), fullPage, timeout: 5_000 });
    evidence.screenshots.push({ name, fullPage });
  };

  try {
    stage("baseline-and-profile");
    evidence.runner.sha256 = createHash("sha256")
      .update(await readFile(fileURLToPath(import.meta.url)))
      .digest("hex");
    const baseline = await runBoundedProcess({
      label: "baseline",
      start: () =>
        spawn("git", ["rev-parse", "HEAD"], {
          cwd: repositoryRoot,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      timeoutMs: 5_000,
      terminate: stopProcess,
    });
    evidence.baseline.actual = baseline.stdout.trim();
    if (expectedBaseline !== null)
      deepStrictEqual(evidence.baseline.actual, expectedBaseline.toLowerCase());
    evidence.baseline.verified = expectedBaseline !== null;
    profileDirectory = await mkdtemp(join(developmentRoot, "electron-invalidation-profile-"));
    workspaceDirectory = join(profileDirectory, "workspace");
    stage("seed-and-launch");
    const seeded = await runSeeder("seed", workspaceDirectory);
    // Do not bind here: on Windows, a probe listen/close can race Vite strictPort.
    await assertPortUnusedBeforeVite();
    viteProcess = spawn(
      globalThis.process.execPath,
      [viteBin, "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
      {
        cwd: join(repositoryRoot, "apps", "studio-web"),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    viteDiagnostics = attachProcessDiagnostics(viteProcess);
    await waitForUrl(`http://127.0.0.1:${PORT}`, viteProcess, viteDiagnostics);
    application = await electron.launch({
      executablePath: electronExecutable,
      args: [join(repositoryRoot, "apps", "desktop"), `--user-data-dir=${profileDirectory}`],
      cwd: repositoryRoot,
      env: { ...globalThis.process.env, AIJIAN_E2E_USER_DATA_DIR: profileDirectory },
      timeout: 30_000,
    });
    const electronVersion = await application.evaluate(() => globalThis.process.versions.electron);
    evidence.electronVersion = electronVersion;
    if (electronVersion !== "43.2.0") {
      throw new Error(`Electron runtime version mismatch: ${String(electronVersion)}`);
    }
    window = await application.firstWindow({ timeout: 30_000 });
    window.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        rendererDiagnostics.push(`${message.type()}: ${boundedTail(message.text())}`);
        if (rendererDiagnostics.length > 32) rendererDiagnostics.shift();
      }
    });
    window.on("pageerror", (error) => {
      rendererDiagnostics.push(`pageerror: ${boundedTail(error.message)}`);
      if (rendererDiagnostics.length > 32) rendererDiagnostics.shift();
    });
    window.on("requestfailed", (request) => {
      // Do not read headers, cookies, request bodies, or credential-bearing URL queries.
      const url = new globalThis.URL(request.url());
      requestFailures.push(
        boundedTail(
          `${request.method()} ${url.protocol}//${url.host}${url.pathname}: ${request.failure()?.errorText}`,
        ),
      );
      if (requestFailures.length > 32) requestFailures.shift();
    });
    await window.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });

    stage("database-before");
    const before = await runSeeder("snapshot", workspaceDirectory);
    evidence.database.before = before;
    stage("drawer-tabs");
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getFocusedWindow()?.setContentSize(1440, 900),
    );
    const taskTrigger = window.getByRole("button", { name: /打开制作控制中心/ });
    await taskTrigger.click();
    const drawer = window.getByRole("dialog", { name: "制作控制中心" });
    await drawer.waitFor();
    const closeButton = drawer.getByRole("button", { name: "关闭制作控制中心" });
    await closeButton.waitFor({ state: "visible" });
    const taskTab = drawer.getByRole("tab", { name: "制作任务" });
    const reportTab = drawer.getByRole("tab", { name: "影响报告" });
    await assertTabs(drawer, 0, "default tabs", evidence.keyboard, false);
    await assertFocus(closeButton, "drawer initial focus", evidence.keyboard);
    await assertTaskContent(drawer, "default task content", evidence.keyboard);
    await taskTab.focus();
    for (const [key, activeIndex] of [
      ["ArrowLeft", 1],
      ["ArrowRight", 0],
      ["ArrowRight", 1],
      ["ArrowLeft", 0],
      ["End", 1],
      ["Home", 0],
      ["End", 1],
    ]) {
      await window.keyboard.press(key);
      await assertTabs(drawer, activeIndex, `tab keyboard ${key}`, evidence.keyboard);
      if (activeIndex === 0)
        await assertTaskContent(drawer, `task content after ${key}`, evidence.keyboard);
    }
    stage("report-detail-and-focus-trap");
    const operationRow = await drawer.getByRole("button", { name: /内容版本发生变更/ }).first();
    await operationRow.click();
    await drawer.locator(".history-technical-details").waitFor();
    await assertFocus(
      drawer.locator(".history-detail-heading h3"),
      "detail ready focus",
      evidence.keyboard,
    );
    const technicalSummary = drawer.locator("summary").filter({ hasText: "技术详情" });
    await closeButton.focus();
    for (const [key, target, label] of [
      ["Shift+Tab", technicalSummary, "close to summary reverse wrap"],
      ["Tab", closeButton, "summary to close wrap"],
      ["Tab", reportTab, "close to active report tab skips inactive task tab"],
      ["Shift+Tab", closeButton, "report tab back to close"],
    ]) {
      await window.keyboard.press(key);
      await assertFocus(target, label, evidence.keyboard);
      await assertTabs(drawer, 1, `${label} tab state`, evidence.keyboard, target === reportTab);
    }
    await technicalSummary.click();
    const uiDetail = await drawer.evaluate((root) => ({
      paths: Array.from(root.querySelectorAll(".history-path")).map((path) => ({
        classification: path.querySelector(":scope > header > span")?.textContent?.trim(),
        effectiveImpact: path.querySelector("strong")?.textContent?.trim(),
        ids: Array.from(path.querySelectorAll("p code")).map((code) => code.getAttribute("title")),
        visibleIds: Array.from(path.querySelectorAll("p code")).map((code) =>
          code.textContent?.trim(),
        ),
        reasons: Array.from(path.querySelectorAll(".history-reasons li")).map((reason) => ({
          dependency: reason.querySelector("code")?.getAttribute("title"),
          dependencyText: reason.querySelector("code")?.textContent?.trim(),
          relationship: reason.querySelector("span")?.textContent?.trim(),
          impact: reason.querySelector("em")?.textContent?.trim(),
        })),
      })),
      technical: Object.fromEntries(
        Array.from(root.querySelectorAll(".history-technical-details dt")).map((dt) => [
          dt.textContent?.trim(),
          dt.nextElementSibling?.textContent?.trim(),
        ]),
      ),
    }));
    evidence.uiDetail = uiDetail;
    const impactText = { blocking: "阻塞下游", render_only: "仅重新渲染", advisory: "建议复核" };
    const shortId = (value) => `${value.slice(0, 14)}…${value.slice(-6)}`;
    deepStrictEqual(
      uiDetail.paths,
      seeded.expected_data.paths.map((path) => ({
        classification: path.classification === "INVALIDATE" ? "失效" : "待复核",
        effectiveImpact: impactText[path.effective_impact],
        ids: [path.affected_artifact_id, path.affected_version_id],
        visibleIds: [path.affected_artifact_id, path.affected_version_id].map(shortId),
        reasons: path.dependency_ids.map((dependency, index) => ({
          dependency,
          dependencyText: shortId(dependency),
          relationship: path.relationships[index],
          impact: impactText[path.edge_impacts[index]],
        })),
      })),
    );
    deepStrictEqual(uiDetail.technical, {
      Operation: seeded.operation_id,
      Gate: seeded.expected_data.gate_decision_id,
      旧版本: seeded.expected_data.old_accepted_version_id,
      新版本: seeded.expected_data.new_accepted_version_id,
      Assessment: seeded.expected_data.assessment_hash,
    });
    stage("computed-layout-fonts-and-wheel-reachability");
    evidence.layout = await measureLayout(drawer);
    verifyLayout(evidence.layout);
    const assessmentRow = drawer.locator(".history-technical-details dl > div:last-child");
    deepStrictEqual((await assessmentRow.locator("dt").textContent())?.trim(), "Assessment");
    const assessment = assessmentRow.locator("dd");
    deepStrictEqual(await assessment.count(), 1);
    await scrollAssessmentIntoView(window, assessment, evidence.scroll);
    await screenshot("electron-invalidation-detail-fullpage.png", true);
    await screenshot("electron-invalidation-detail-viewport-1440x900.png");
    stage("return-reentry-and-escape");
    await window.getByRole("button", { name: "返回影响报告" }).click();
    await drawer.locator(".history-technical-details").waitFor({ state: "hidden" });
    await assertFocus(operationRow, "return to report row", evidence.keyboard);
    await screenshot("electron-invalidation-list-fullpage.png", true);
    await screenshot("electron-invalidation-list-viewport-1440x900.png");
    await operationRow.click();
    await drawer.locator(".history-technical-details").waitFor();
    await assertFocus(
      drawer.locator(".history-detail-heading h3"),
      "reentry ready focus",
      evidence.keyboard,
    );
    await window.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    await assertFocus(taskTrigger, "Escape restores entry focus", evidence.keyboard);
    await taskTrigger.click();
    await drawer.waitFor();
    await assertTabs(drawer, 0, "reopened default tabs", evidence.keyboard, false);
    await assertTaskContent(drawer, "reopened default task content", evidence.keyboard);
    await assertFocus(closeButton, "reopened drawer initial focus", evidence.keyboard);
    await window.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    await assertFocus(taskTrigger, "reopened Escape restores entry focus", evidence.keyboard);
    stage("existing-bridge-contract");
    const result = await window.evaluate(
      async ({ project_id: projectId, operation_id: operationId }) => {
        const bridge = globalThis.aijian;
        const first = await bridge.getInvalidationOperation(projectId, operationId);
        const repeated = await bridge.getInvalidationOperation(projectId, operationId);
        let missingMessage = "";
        try {
          await bridge.getInvalidationOperation(projectId, `ivo_${"f".repeat(32)}`);
        } catch (error) {
          missingMessage = error instanceof Error ? error.message : String(error);
        }
        return {
          first,
          repeated,
          missingMessage,
          bridge: {
            getInvalidationOperation: typeof bridge.getInvalidationOperation,
            process: typeof globalThis.process,
            require: typeof globalThis.require,
            token: typeof bridge.token,
            origin: typeof bridge.origin,
            fetch: typeof bridge.fetch,
            invoke: typeof bridge.invoke,
          },
        };
      },
      seeded,
    );
    const after = await runSeeder("snapshot", workspaceDirectory);
    evidence.database.after = after;

    deepStrictEqual(result.first.data, seeded.expected_data);
    deepStrictEqual(result.repeated.data, seeded.expected_data);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        result.first.request_id,
      )
    ) {
      throw new Error("detail response request_id was not a UUID");
    }
    if (
      !result.missingMessage.includes("status 404") ||
      !result.missingMessage.includes("INVALIDATION_OPERATION_NOT_FOUND")
    ) {
      throw new Error("missing operation did not preserve the expected 404 error");
    }
    if (
      result.bridge.getInvalidationOperation !== "function" ||
      result.bridge.process !== "undefined" ||
      result.bridge.require !== "undefined" ||
      result.bridge.token !== "undefined" ||
      result.bridge.origin !== "undefined" ||
      result.bridge.fetch !== "undefined" ||
      result.bridge.invoke !== "undefined"
    ) {
      throw new Error("Electron bridge did not preserve the privileged boundary");
    }
    deepStrictEqual(after, before);
    evidence.database.unchanged = true;
    if (rendererDiagnostics.length > 0 || requestFailures.length > 0) {
      throw new Error(
        `renderer diagnostics: ${boundedTail([...rendererDiagnostics, ...requestFailures].join(" | "))}`,
      );
    }
    passResult = {
      status: "PASS",
      project_id: seeded.project_id,
      operation_id: seeded.operation_id,
      paths: seeded.expected_data.paths.length,
    };
    await screenshot("electron-before-cleanup-viewport-1440x900.png");
    evidence.stages.at(-1).status = "PASS";
  } catch (error) {
    primaryError = error;
    if (evidence.stages.length) evidence.stages.at(-1).status = "FAIL";
    if (window && !window.isClosed()) {
      try {
        await screenshot("electron-failure-before-cleanup-viewport.png");
      } catch (screenshotError) {
        evidence.diagnostics.screenshotError = boundedTail(screenshotError.message);
      }
    }
  }

  // Also retain the post-failure database state before shutting down/removing the profile.
  if (
    !evidence.database.after &&
    workspaceDirectory &&
    existsSync(join(workspaceDirectory, "workspace.sqlite3"))
  ) {
    try {
      evidence.database.after = await runSeeder("snapshot", workspaceDirectory);
      if (evidence.database.before) {
        deepStrictEqual(evidence.database.after, evidence.database.before);
        evidence.database.unchanged = true;
      }
    } catch (error) {
      evidence.diagnostics.databaseAfterError = boundedTail(error.message);
      primaryError ??= error;
    }
  }
  const cleanupErrors = [];
  try {
    await closeApplication(application);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await stopProcess(viteProcess, "Vite");
    viteClosed = true;
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (!primaryError && cleanupErrors.length === 0) {
    try {
      if (viteProcess && !viteClosed) throw new Error("Vite remained alive after cleanup");
      await assertPortRebindAfterCleanup();
      if (profileDirectory && existsSync(profileDirectory))
        throw new Error("Electron profile remained after cleanup");
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  evidence.stages.push({ name: "cleanup", status: cleanupErrors.length ? "FAIL" : "PASS" });
  // Listeners remain active through screenshots and Electron close: include late events too.
  const diagnosticFailure = rendererDiagnostics.length > 0 || requestFailures.length > 0;
  evidence.stages.push({
    name: "renderer-diagnostics-through-close",
    status: diagnosticFailure ? "FAIL" : "PASS",
  });
  if (diagnosticFailure)
    primaryError ??= new Error(
      `renderer diagnostics through close: ${boundedTail([...rendererDiagnostics, ...requestFailures].join(" | "))}`,
    );
  evidence.status = primaryError || cleanupErrors.length ? "FAIL" : "PASS";
  evidence.finishedAt = new Date().toISOString();
  evidence.diagnostics.vite = viteDiagnostics ?? null;
  evidence.diagnostics.primaryError = primaryError
    ? boundedTail(primaryError.stack ?? primaryError.message)
    : null;
  evidence.diagnostics.cleanupErrors = cleanupErrors.map((error) =>
    boundedTail(error.stack ?? error.message),
  );
  await writeFile(
    join(evidenceDirectory, "result.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" },
  );
  globalThis.process.stdout.write(
    `${JSON.stringify({ ...passResult, status: evidence.status, evidenceDirectory })}\n`,
  );
  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], "smoke and cleanup both failed");
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "smoke cleanup failed");
}

if (globalThis.process.env.AIJIAN_E2E_RUNNER_SELF_TEST === "1") {
  await runProcessRunnerSelfTests();
  globalThis.process.stdout.write('{"status":"PASS","runner_self_test":true}\n');
} else {
  await main();
}
