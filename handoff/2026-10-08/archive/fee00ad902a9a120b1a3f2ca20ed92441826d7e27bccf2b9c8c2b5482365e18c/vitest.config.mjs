const root = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
export default {
  root: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  resolve: { alias: [
    { find: "@qa-project", replacement: root + "/apps/studio-web/src/aivora" },
    { find: "@testing-library/react", replacement: root + "/apps/studio-web/node_modules/@testing-library/react" },
    { find: "react", replacement: root + "/apps/studio-web/node_modules/react" },
  ] },
  test: { globals: true, environment: "jsdom", include: ["**/*.test.mjs"],
    coverage: { enabled: false } },
};
