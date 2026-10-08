const c19 = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
export default {
  root: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  resolve: { alias: [
    { find: "@qa-web", replacement: c19 + "/apps/studio-web/src/aivora" },
    { find: "@testing-library/react", replacement: c19 + "/apps/studio-web/node_modules/@testing-library/react" },
    { find: "react", replacement: c19 + "/apps/studio-web/node_modules/react" },
  ] },
  test: { globals: true, environment: "jsdom", include: ["**/*.panel.test.mjs"],
    coverage: { enabled: false } },
};
