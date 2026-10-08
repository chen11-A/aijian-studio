import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { developmentCoreAssets } from "./build/developmentCoreAssets.ts";

const buildProfile =
  process.env.AIVORA_BUILD_PROFILE === "development-core" ? "development-core" : "production";

export default defineConfig({
  base: "./",
  plugins: [react(), ...(buildProfile === "development-core" ? [developmentCoreAssets()] : [])],
  define: { __AIVORA_BUILD_PROFILE__: JSON.stringify(buildProfile) },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173; img-src 'self' data:; media-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90,
        "src/aivora/ProviderConnectionForm.tsx": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/domain/use-provider-connection-form.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/aivora/AssistantPanel.tsx": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/domain/use-task-queue.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/domain/task-queue-model.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
      },
    },
  },
});
