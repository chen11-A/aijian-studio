import { resolve } from "node:path";

export default {
  root: resolve(import.meta.dirname, "headless-harness"),
  build: {
    outDir: resolve(import.meta.dirname, "../../.aijian-dev/c20-headless-harness"),
    emptyOutDir: true,
  },
};
