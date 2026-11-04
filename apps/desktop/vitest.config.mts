import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

const windowsCi = process.env.RUNNER_OS === "Windows";

export default defineConfig({
  test: {
    // pnpm runs desktop and renderer suites together; share CPU capacity.
    // https://v4.vitest.dev/config/maxworkers
    // Windows CI has been killing the OAuth worker when several files run at once.
    maxWorkers: windowsCi ? 1 : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))),
    fileParallelism: windowsCi ? false : true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/chatgpt-auth-{oauth,callback,http,inference,storage,ipc,runtime,generation}.ts",
        "src/api-client.ts",
        "src/official-director-{client,contract,ipc}.ts",
        "src/api-contract-guards.ts",
        "src/health-contract.ts",
        "src/provider-connection-contract.ts",
        "src/sidecar-origin.ts",
        "src/sidecar-process.ts",
        "src/sidecar-protocol.ts",
        "src/task-queue-contract.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
        "src/official-director-{client,contract,ipc}.ts": {
          lines: 100,
          functions: 100,
          branches: 95,
        },
        "src/{api-contract-guards,health-contract,provider-connection-contract,sidecar-origin,task-queue-contract}.ts":
          {
            lines: 100,
            functions: 100,
          },
      },
    },
  },
});
