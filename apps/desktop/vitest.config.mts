import { defineConfig } from "vitest/config";

const windowsCi = process.env.RUNNER_OS === "Windows";

export default defineConfig({
  test: {
    // The OAuth file binds loopback servers. On a Windows runner it shares the
    // machine with the renderer suite and has been killed mid-file. One worker
    // keeps that process inside the runner memory limit.
    maxWorkers: windowsCi ? 1 : undefined,
    fileParallelism: windowsCi ? false : undefined,
  },
});
