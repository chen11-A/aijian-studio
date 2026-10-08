const c19 = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
const modules = c19 + "/apps/studio-web/node_modules";
export default {
  root: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  resolve: { alias: [
    { find: "@qa-source", replacement: c19 + "/apps/studio-web/src/aivora" },
    { find: "@testing-library/jest-dom/vitest", replacement: modules + "/@testing-library/jest-dom/vitest" },
    { find: "@testing-library/react", replacement: modules + "/@testing-library/react" },
    { find: /^react(?=\/|$)/, replacement: modules + "/react" },
    { find: /^react-dom(?=\/|$)/, replacement: modules + "/react-dom" },
    { find: "vitest", replacement: modules + "/vitest" },
  ] },
  test: { globals: true, environment: "jsdom", include: ["p23-settings.test.mjs"],
    coverage: { enabled: false } },
};
