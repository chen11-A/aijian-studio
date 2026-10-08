const candidate = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";

export default {
  root: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  resolve: {
    alias: [
      { find: "@qa-desktop", replacement: `${candidate}/apps/desktop/src` },
      { find: "@qa-h87", replacement: `${candidate}/apps/studio-web/src/aivora` },
      { find: "@qa-studio", replacement: `${candidate}/apps/studio-web/src/api` },
      { find: "@testing-library/react", replacement: `${candidate}/apps/studio-web/node_modules/@testing-library/react` },
      { find: "react", replacement: `${candidate}/apps/studio-web/node_modules/react` },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.mjs"],
    coverage: { enabled: false },
  },
};
