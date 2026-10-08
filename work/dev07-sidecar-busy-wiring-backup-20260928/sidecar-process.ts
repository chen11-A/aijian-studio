import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { parseSidecarHandshake, type SidecarSession } from "./sidecar-protocol";

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

  let exitResult: SidecarExit | undefined;
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
      const timer = setTimeout(rejectStartup, startupTimeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        child.off("error", rejectStartup);
        child.off("exit", rejectStartup);
      };

      child.once("error", rejectStartup);
      child.once("exit", rejectStartup);
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
    child.stdin.end();
    if (!(await settlesWithin(exited, shutdownTimeoutMs))) {
      child.kill();
      await settlesWithin(exited, shutdownTimeoutMs);
    }
    throw new Error("Sidecar failed to start");
  }

  output.close();
  child.stdout.resume();
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
