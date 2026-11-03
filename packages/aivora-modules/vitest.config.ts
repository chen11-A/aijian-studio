import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  testTimeout: 120000, hookTimeout: 120000,
  maxWorkers: 2,
  coverage: {provider:'v8', include:['*/**/*.ts'], exclude:['**/*.test.ts','**/*.spec.ts','node_modules/**','coverage/**'], reporter:['text','json-summary','html'], thresholds:{perFile:true,lines:85,functions:85,branches:85,statements:85}}
}});
