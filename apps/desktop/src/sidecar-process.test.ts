import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import type * as childProcess from "node:child_process";

import { afterEach, expect, test, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const phaseCapture = vi.hoisted(() => ({ current: null as Phase[] | null }));
const realSpawnWrapper = vi.hoisted(() => ({
  value: null as
    | ((...args: Parameters<typeof childProcess.spawn>) => ReturnType<typeof childProcess.spawn>)
    | null,
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  const instrumentedSpawn = (
    ...args: Parameters<typeof childProcess.spawn>
  ): ReturnType<typeof childProcess.spawn> => {
    const child = actual.spawn(...args);
    const phases = phaseCapture.current;
    if (!phases || !child.stdin) return child;
    const originalEnd = child.stdin.end.bind(child.stdin);
    child.stdin.end = ((...endArgs: Parameters<typeof child.stdin.end>) => {
      mark(phases, "stdin.end.call");
      const result = originalEnd(...endArgs);
      mark(phases, "stdin.end.return", { returned: true });
      return result;
    }) as typeof child.stdin.end;
    const originalKill = child.kill.bind(child);
    child.kill = ((...killArgs: Parameters<typeof child.kill>) => {
      mark(phases, "kill.call");
      const returned = originalKill(...killArgs);
      mark(phases, "kill.return", { returned });
      return returned;
    }) as typeof child.kill;
    child.once("exit", (code, signal) => mark(phases, "exit", { code, signal }));
    child.once("close", (code, signal) => mark(phases, "close", { code, signal }));
    return child;
  };
  realSpawnWrapper.value = instrumentedSpawn;
  spawnMock.mockImplementation(instrumentedSpawn);
  return { ...actual, spawn: spawnMock };
});

import { createLocalApiClient } from "./api-client";
import { SidecarStartupError, startSidecar, type SidecarHandle } from "./sidecar-process";

let activeSidecar: SidecarHandle | null = null;
const repositoryRoot = resolve(__dirname, "../../..");
const token = "s".repeat(43);
type Phase = {
  name: string;
  at: number;
  details?: Record<string, number | string | boolean | null>;
};

function mark(phases: Phase[], name: string, details?: Phase["details"]): void {
  phases.push({ name, at: performance.now(), details });
}

function printPhases(label: string, phases: Phase[]): void {
  console.log(`SIDECAR_PHASE ${label} ${JSON.stringify(phases)}`);
}

function assertMonotonic(phases: Phase[]): void {
  expect(phases.every((phase, index) => index === 0 || phase.at >= phases[index - 1]!.at)).toBe(
    true,
  );
}

function boundedHealthFetcher(phases: Phase[], timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      mark(phases, "health.abort");
      controller.abort();
    }, timeoutMs);
    mark(phases, "health.request");
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      mark(phases, "health.headers", { status: response.status });
      if (!response.body) {
        clearTimeout(timer);
        timer = undefined;
        mark(phases, "health.body.close");
        return response;
      }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              clearTimeout(timer);
              timer = undefined;
              mark(phases, "health.body.close");
              stream.close();
            } else {
              stream.enqueue(chunk.value);
            }
          } catch (error) {
            clearTimeout(timer);
            timer = undefined;
            stream.error(error);
          }
        },
        async cancel(reason) {
          clearTimeout(timer);
          timer = undefined;
          controller.abort();
          await reader.cancel(reason);
        },
      });
      return new Response(body, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    } catch (error) {
      clearTimeout(timer);
      timer = undefined;
      throw error;
    }
  };
}

function mockChildThatIgnoresEof(phases: Phase[]) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const originalEnd = child.stdin.end.bind(child.stdin);
  child.stdin.end = ((...args: Parameters<typeof child.stdin.end>) => {
    mark(phases, "stdin.end.call");
    const result = originalEnd(...args);
    mark(phases, "stdin.end.return", { returned: true });
    return result;
  }) as typeof child.stdin.end;
  child.kill = vi.fn(() => {
    mark(phases, "kill.call");
    const returned = true;
    mark(phases, "kill.return", { returned });
    setTimeout(() => {
      mark(phases, "exit", { code: null, signal: "SIGTERM" });
      child.emit("exit", null, "SIGTERM");
      mark(phases, "close", { code: null, signal: "SIGTERM" });
      child.emit("close", null, "SIGTERM");
    }, 1);
    return returned;
  });
  setTimeout(
    () =>
      child.stdout.write(
        `${JSON.stringify({
          event: "ready",
          host: "127.0.0.1",
          pid: 7654,
          port: 43123,
          protocol_version: 1,
          token,
        })}\n`,
      ),
    0,
  );
  return child;
}

function nodeHandshakeScript(options: { line?: string; remainAlive?: boolean } = {}): string {
  const line =
    options.line ??
    JSON.stringify({
      event: "ready",
      host: "127.0.0.1",
      pid: 7654,
      port: 43123,
      protocol_version: 1,
      token,
    });
  const remainAlive = options.remainAlive ? "setInterval(() => {}, 1000);" : "";
  return `process.stdout.write(${JSON.stringify(`${line}\n`)});${remainAlive}`;
}

afterEach(async () => {
  const sidecar = activeSidecar;
  activeSidecar = null;
  const phases = phaseCapture.current;
  try {
    if (sidecar) {
      mark(phases ?? [], "cleanup.start");
      await sidecar.stop();
      mark(phases ?? [], "cleanup.end");
    }
  } finally {
    if (phases) {
      mark(phases, "test.afterEach");
      printPhases("test-final", phases);
      assertMonotonic(phases);
    }
    phaseCapture.current = null;
  }
});

test(
  "starts the real Python sidecar, authenticates health, and stops on stdin EOF",
  { timeout: 30_000 },
  async () => {
    const phases: Phase[] = [];
    phaseCapture.current = phases;
    try {
      const python =
        process.platform === "win32"
          ? join(repositoryRoot, ".venv", "Scripts", "python.exe")
          : join(repositoryRoot, ".venv", "bin", "python");
      expect(existsSync(python)).toBe(true);

      mark(phases, "spawn.start");
      activeSidecar = await startSidecar({
        command: python,
        args: ["-m", "aijian_api.sidecar"],
        cwd: repositoryRoot,
        env: { PYTHONPATH: join(repositoryRoot, "services", "api", "src") },
        startupTimeoutMs: 10_000,
        shutdownTimeoutMs: 5_000,
      });
      mark(phases, "ready", { pid: activeSidecar.session.pid, port: activeSidecar.session.port });

      expect(activeSidecar.session.port).toBeGreaterThan(0);
      expect(activeSidecar.session.port).not.toBe(8000);
      expect(activeSidecar.session.token).toHaveLength(43);

      const client = createLocalApiClient(
        boundedHealthFetcher(phases, 5_000),
        activeSidecar.session,
      );
      mark(phases, "health.start");
      await expect(client.getHealth()).resolves.toMatchObject({ data: { status: "ok" } });
      mark(phases, "health.end");

      mark(phases, "stop.start");
      await activeSidecar.stop();
      mark(phases, "stop.resolve");
      await expect(activeSidecar.exited).resolves.toMatchObject({ code: 0, signal: null });
      mark(phases, "close.observed", { code: 0, signal: null });
      activeSidecar = null;
    } finally {
      mark(phases, "test.finally");
    }
  },
);

test("rejects malformed startup output and terminates the child without exposing it", async () => {
  const startup = startSidecar({
    command: process.execPath,
    args: ["-e", nodeHandshakeScript({ line: "not-json", remainAlive: true })],
    cwd: repositoryRoot,
    startupTimeoutMs: 1_000,
    shutdownTimeoutMs: 25,
  });
  await expect(startup).rejects.toThrow(SidecarStartupError);
  await expect(startup).rejects.toMatchObject({ message: "Sidecar failed to start" });
});

test("force-stops a controlled mock child that ignores parent-pipe EOF", async () => {
  const phases: Phase[] = [];
  phaseCapture.current = phases;
  const child = mockChildThatIgnoresEof(phases);
  spawnMock.mockImplementation(() => child);
  try {
    activeSidecar = await startSidecar({
      command: process.execPath,
      args: [],
      cwd: repositoryRoot,
      shutdownTimeoutMs: 25,
    });

    await expect(activeSidecar.stop()).resolves.toBeUndefined();
    await expect(activeSidecar.stop()).resolves.toBeUndefined();
    await expect(activeSidecar.exited).resolves.toMatchObject({ code: null });
    const names = phases.map((phase) => phase.name);
    expect(names.indexOf("stdin.end.return")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("kill.return")).toBeGreaterThan(names.indexOf("stdin.end.return"));
    expect(names.indexOf("exit")).toBeGreaterThan(names.indexOf("kill.return"));
    expect(names.indexOf("close")).toBeGreaterThan(names.indexOf("exit"));
    expect(child.kill).toHaveBeenCalledOnce();
    expect(phases.filter((phase) => phase.name === "kill.call")).toHaveLength(1);
    expect(phases.find((phase) => phase.name === "kill.return")?.details?.returned).toBe(true);
    activeSidecar = null;
  } finally {
    spawnMock.mockImplementation(realSpawnWrapper.value!);
    mark(phases, "test.finally");
    printPhases("force-stop-controlled-mock", phases);
    phaseCapture.current = null;
  }
});

test("force-stops a real child that ignores parent-pipe EOF", async () => {
  const phases: Phase[] = [];
  phaseCapture.current = phases;
  try {
    activeSidecar = await startSidecar({
      command: process.execPath,
      args: ["-e", nodeHandshakeScript({ remainAlive: true })],
      cwd: repositoryRoot,
      // A real Windows process can report close later than a 25 ms scheduler slice.
      // It still ignores EOF, so stop must force-kill and observe the actual exit.
      shutdownTimeoutMs: 250,
    });

    await expect(activeSidecar.stop()).resolves.toBeUndefined();
    await expect(activeSidecar.stop()).resolves.toBeUndefined();
    await expect(activeSidecar.exited).resolves.toMatchObject({ code: null });
    const names = phases.map((phase) => phase.name);
    expect(names.indexOf("stdin.end.return")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("kill.return")).toBeGreaterThan(names.indexOf("stdin.end.return"));
    expect(names.indexOf("exit")).toBeGreaterThan(names.indexOf("kill.return"));
    expect(names.indexOf("close")).toBeGreaterThan(names.indexOf("exit"));
    expect(phases.filter((phase) => phase.name === "kill.call")).toHaveLength(1);
    expect(phases.find((phase) => phase.name === "kill.return")?.details?.returned).toBe(true);
    assertMonotonic(phases);
    activeSidecar = null;
  } finally {
    mark(phases, "test.finally");
  }
});
