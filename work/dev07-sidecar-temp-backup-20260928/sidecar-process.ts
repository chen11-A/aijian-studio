import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { parseSidecarHandshake, type SidecarSession } from "./sidecar-protocol";
import {
  createSidecarStartupDiagnosticCollector,
  type SidecarStartupClassification,
} from "./sidecar-startup-diagnostic";

const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const PASSTHROUGH_ENVIRONMENT = new Set([
  "APPDATA",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "PATH",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
]);

export interface StartSidecarOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export interface SidecarExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface SidecarHandle {
  session: SidecarSession;
  exited: Promise<SidecarExit>;
  stop(): Promise<void>;
}

export class SidecarStartupError extends Error {
  constructor(readonly classification: SidecarStartupClassification) {
    super("Sidecar failed to start");
    this.name = "SidecarStartupError";
  }
}

function childEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (PASSTHROUGH_ENVIRONMENT.has(key.toUpperCase()) && value !== undefined) {
      environment[key] = value;
    }
  }
  return {
    ...environment,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    ...overrides,
  };
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });
  const settled = promise.then(() => true);
  const result = await Promise.race([settled, timedOut]);
  if (timeout !== undefined) clearTimeout(timeout);
  return result;
}

export async function startSidecar(options: StartSidecarOptions): Promise<SidecarHandle> {
  const startupTimeoutMs = positiveTimeout(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS);
  const shutdownTimeoutMs = positiveTimeout(options.shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS);
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: childEnvironment(options.env),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const diagnostic = createSidecarStartupDiagnosticCollector();
  const onStderrData = (chunk: Buffer): void => diagnostic.append(chunk);
  child.stderr.on("data", onStderrData);

  let exitResult: SidecarExit | undefined;
  let spawnFailed = false;
  let timedOut = false;
  const exited = new Promise<SidecarExit>((resolve) => {
    child.once("close", (code, signal) => {
      exitResult = { code, signal };
      resolve(exitResult);
    });
  });

  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let session: SidecarSession;
  try {
    session = await new Promise<SidecarSession>((resolve, reject) => {
      const rejectStartup = (): void => reject(new Error("Sidecar failed to start"));
      const timer = setTimeout(() => {
        timedOut = true;
        rejectStartup();
      }, startupTimeoutMs);
      const onSpawnError = (): void => {
        spawnFailed = true;
        clearTimeout(timer);
        rejectStartup();
      };
      const onExit = (): void => {
        clearTimeout(timer);
        rejectStartup();
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        child.off("error", onSpawnError);
        child.off("exit", onExit);
      };

      child.once("error", onSpawnError);
      child.once("exit", onExit);
      output.once("line", (line) => {
        cleanup();
        try {
          resolve(parseSidecarHandshake(line));
        } catch {
          rejectStartup();
        }
      });
    });
  } catch {
    output.close();
    child.stdout.resume();
    child.stdin.end();
    if (!(await settlesWithin(exited, shutdownTimeoutMs))) {
      timedOut = true;
      child.kill();
      await settlesWithin(exited, shutdownTimeoutMs);
    }
    child.stderr.off("data", onStderrData);
    child.stderr.resume();
    throw new SidecarStartupError(diagnostic.classify({
      code: exitResult?.code ?? null,
      signal: exitResult?.signal ?? null,
      spawn_failed: spawnFailed,
      timed_out: timedOut,
    }));
  }

  output.close();
  child.stdout.resume();
  child.stderr.off("data", onStderrData);
  child.stderr.resume();

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      if (exitResult !== undefined) return;
      child.stdin.end();
      if (await settlesWithin(exited, shutdownTimeoutMs)) return;
      child.kill();
      if (!(await settlesWithin(exited, shutdownTimeoutMs))) {
        throw new Error("Sidecar failed to stop");
      }
    })();
    return stopping;
  };

  return { session, exited, stop };
}
