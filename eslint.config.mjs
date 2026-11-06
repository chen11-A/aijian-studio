import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      ".aijian-dev/**",
      ".cache/**",
      "downloads/**",
      // Historical source receipts are immutable archives, not build inputs.
      "handoff/**",
      "work/**",
      "packages/contracts/src/generated.ts",
      "upstreams/**",
      // gpt/aivora-modules 原样合入、自带 vitest/tsc，还没接进主程序 [M-02]
      "packages/aivora-modules/**",
      "assets/audio-library/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/studio-web/e2e/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        window: "readonly",
        document: "readonly",
        Element: "readonly",
        HTMLElement: "readonly",
        Node: "readonly",
        getComputedStyle: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
