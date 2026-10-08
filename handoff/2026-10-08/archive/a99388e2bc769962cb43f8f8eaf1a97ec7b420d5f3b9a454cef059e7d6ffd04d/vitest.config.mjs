const candidate = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
export default {
  root: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  resolve: { alias: [
    { find: "@qa-form", replacement: candidate + "/apps/studio-web/src/aivora" },
    { find: "@testing-library/react", replacement: candidate + "/apps/studio-web/node_modules/@testing-library/react" },
    { find: "react", replacement: candidate + "/apps/studio-web/node_modules/react" },
  ] },
  test: { globals: true, environment: "jsdom", include: ["**/*.test.mjs"],
    coverage: { enabled: false } },
};
