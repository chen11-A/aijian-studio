import { realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const requestedOutput = process.env.AIJIAN_APP_UI_OUTPUT;
const dependencies = process.env.AIJIAN_APP_UI_DEPENDENCIES;
if (!requestedOutput || !dependencies) {
  throw new Error("Explicit existing dependencies and owned App UI output are required");
}
const output = realpathSync(requestedOutput);
if (
  relative(resolve(root, "../../.aijian-dev"), dirname(output)) !== "" ||
  !basename(output).startsWith("app-ui-e1-")
) {
  throw new Error("App UI output must be a unique owned candidate .aijian-dev/app-ui-e1-* directory");
}
const react = realpathSync(join(dependencies, "react@19.2.8/node_modules/react"));
const reactDom = realpathSync(
  join(dependencies, "react-dom@19.2.8_react@19.2.8/node_modules/react-dom"),
);

export default {
  root,
  base: "./",
  publicDir: false,
  envFile: false,
  cacheDir: join(output, "cache", "vite"),
  resolve: {
    alias: [
      { find: /^react(\/.*)?$/, replacement: react.replaceAll("\\", "/") + "$1" },
      { find: /^react-dom(\/.*)?$/, replacement: reactDom.replaceAll("\\", "/") + "$1" },
    ],
  },
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  build: {
    outDir: join(output, "build", "renderer"),
    emptyOutDir: false,
    target: "es2022",
    modulePreload: { polyfill: false },
    rollupOptions: { input: join(root, "app-ui", "index.html") },
  },
};
