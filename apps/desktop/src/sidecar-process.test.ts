import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, expect, test } from "vitest";

import { createLocalApiClient } from "./api-client";
import { startSidecar, type SidecarHandle } from "./sidecar-process";

let activeSidecar: SidecarHandle | null = null;
const repositoryRoot = resolve(__dirname, "../../..");
const token = "s".repeat(43);

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
  await activeSidecar?.stop();
  activeSidecar = null;
});

test("starts the real Python sidecar, authenticates health, and stops on stdin EOF", async () => {
  const python =
    process.platform === "win32"
      ? join(repositoryRoot, ".venv", "Scripts", "python.exe")
      : join(repositoryRoot, ".venv", "bin", "python");
  expect(existsSync(python)).toBe(true);

  activeSidecar = await startSidecar({
    command: python,
    args: ["-m", "aijian_api.sidecar"],
    cwd: repositoryRoot,
    env: { PYTHONPATH: join(repositoryRoot, "services", "api", "src") },
    startupTimeoutMs: 10_000,
    shutdownTimeoutMs: 5_000,
  });

  expect(activeSidecar.session.port).toBeGreaterThan(0);
  expect(activeSidecar.session.port).not.toBe(8000);
  expect(activeSidecar.session.token).toHaveLength(43);

  const client = createLocalApiClient(fetch, activeSidecar.session);
  await expect(client.getHealth()).resolves.toMatchObject({ data: { status: "ok" } });

  await activeSidecar.stop();
  await expect(activeSidecar.exited).resolves.toMatchObject({ code: 0, signal: null });
  activeSidecar = null;
});

test("rejects malformed startup output and terminates the child without exposing it", async () => {
  await expect(
    startSidecar({
      command: process.execPath,
      args: ["-e", nodeHandshakeScript({ line: "not-json", remainAlive: true })],
      cwd: repositoryRoot,
      startupTimeoutMs: 1_000,
      shutdownTimeoutMs: 25,
    }),
  ).rejects.toThrow(new Error("Sidecar failed to start"));
});

test("force-stops a child that ignores parent-pipe EOF", async () => {
  activeSidecar = await startSidecar({
    command: process.execPath,
    args: ["-e", nodeHandshakeScript({ remainAlive: true })],
    cwd: repositoryRoot,
    shutdownTimeoutMs: 25,
  });

  await expect(activeSidecar.stop()).resolves.toBeUndefined();
  await expect(activeSidecar.stop()).resolves.toBeUndefined();
  await expect(activeSidecar.exited).resolves.toMatchObject({ code: null });
  activeSidecar = null;
});
