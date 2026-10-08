const candidate = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
export default {
  root: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  resolve: { alias: [
    { find: "electron", replacement: new URL("./electron-fake.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1") },
    { find: "@qa-project", replacement: candidate + "/apps/studio-web/src/aivora" },
    { find: "@qa-desktop", replacement: candidate + "/apps/desktop/src" },
    { find: "@testing-library/react", replacement: candidate + "/apps/studio-web/node_modules/@testing-library/react" },
    { find: "react", replacement: candidate + "/apps/studio-web/node_modules/react" },
  ] },
  test: { globals: true, environment: "jsdom", include: ["**/*.test.mjs"],
    coverage: { enabled: false } },
};
