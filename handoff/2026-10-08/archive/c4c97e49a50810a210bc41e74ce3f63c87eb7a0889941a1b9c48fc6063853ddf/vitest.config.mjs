const c19 = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
const webModules = c19 + "/apps/studio-web/node_modules";
export default {
  root: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  resolve: { alias: [
    { find: "@qa-desktop", replacement: c19 + "/apps/desktop/src" },
    { find: "@qa-web", replacement: c19 + "/apps/studio-web/src/aivora" },
    { find: /^react(?=\/|$)/, replacement: webModules + "/react" },
    { find: /^react-dom(?=\/|$)/, replacement: webModules + "/react-dom" },
    { find: "@testing-library/react", replacement: webModules + "/@testing-library/react" },
    { find: "vitest", replacement: webModules + "/vitest" },
  ] },
  test: { globals: true, environment: "node", include: ["**/*.test.mjs"],
    coverage: { enabled: false } },
};
