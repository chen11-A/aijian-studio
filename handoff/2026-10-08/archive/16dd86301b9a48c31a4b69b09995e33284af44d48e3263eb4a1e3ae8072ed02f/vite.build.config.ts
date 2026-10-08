import { join } from "node:path";
import authorConfig from "C:/Users/Administrator/Documents/Codex/2026-09-23/qa03-local-sub2api-native-source-v4-01/source/apps/studio-web/vite.config.ts";

const source = "C:/Users/Administrator/Documents/Codex/2026-09-23/qa03-local-sub2api-native-source-v4-01/source";
const app = join(source, "apps/studio-web");
const run = "C:/Users/Administrator/Documents/Codex/2026-09-23/mgr04-v4-web-desktop-build-packet-20261008/run-01";

export default {
  ...authorConfig,
  root: app,
  cacheDir: join(run, "vite-cache"),
  server: { fs: { allow: [source, run] }, proxy: {} },
  build: {
    ...authorConfig.build,
    outDir: join(app, "dist"),
    emptyOutDir: true,
  },
};
