const c19 = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
export default {
  root: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  resolve: { alias: [
    { find: "@qa-desktop", replacement: c19 + "/apps/desktop/src" },
    { find: "@qa-web", replacement: c19 + "/apps/studio-web/src/aivora" },
  ] },
  test: { globals: true, environment: "node", include: ["**/*.test.mjs"],
    coverage: { enabled: false } },
};
