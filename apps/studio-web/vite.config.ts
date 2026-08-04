import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
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
        "src/components/ProviderSettings/**/*.{ts,tsx}": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/components/TaskQueue/**/*.{ts,tsx}": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
      },
    },
  },
});
