/** Actual ProWorkspace export-review gate with synthetic QC IPC; no real files or providers. */
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { runQcCases, qcStates } from "./pro-export-qc-cases.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const viewports = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];
const aspects = ["16:9", "9:16"];

function emitGitHubErrors(report) {
  if (process.env.GITHUB_ACTIONS !== "true" || report.exitCode === 0) return;
  if (report.exitCode === 2) {
    const allowed = new Set([
      "FIXTURE",
      "SERVER",
      "BROWSER_DISCOVERY",
      "BROWSER_LAUNCH",
      "CLEANUP",
    ]);
    const phase = allowed.has(report.setupPhase) ? report.setupPhase : "ENVIRONMENT";
    console.error(`::error title=Pro export QC audit::EXPORT_QC_SETUP_${phase}`);
    return;
  }
  const kinds = new Set([
    "control-clipped-without-scroll",
    "offscreen-control",
    "covered-center",
    "button-content-overflow",
    "document-overflow",
  ]);
  for (const row of report.results.filter((item) => !item.passed).slice(0, 8)) {
    const combination =
      /^(1280x800|1920x1080)-(16x9|9x16)-(?:clean|warn-long|block|other-block|failed|stale|prepare-busy|publish-busy)$/.test(
        row.combination,
      )
        ? row.combination
        : "unknown";
    const state = qcStates.includes(row.page) ? row.page : "unknown";
    const found = [
      ...new Set(
        (row.geometry?.issues ?? []).map((issue) =>
          kinds.has(issue.kind) ? issue.kind : "unknown",
        ),
      ),
    ];
    console.error(
      `::error title=Pro export QC audit::EXPORT_QC_AUDIT combination=${combination} state=${state} reached=${Number(row.reached)} kinds=${found.join(",") || "assertion"}`,
    );
  }
}

function options() {
  const value = {
    url: process.env.AIVORA_AUDIT_URL,
    browser: process.env.AIVORA_CHROMIUM,
    out: process.env.AIVORA_AUDIT_OUT ?? path.join(tmpdir(), "aivora-pro-export-qc-audit"),
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--help") return null;
    if (
      !["--url", "--browser", "--out"].includes(key) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    )
      throw new Error(`Invalid option: ${key}; use --help`);
    value[key.slice(2)] = args[++index];
  }
  if (value.url) {
    const url = new URL(value.url);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw new Error("--url must be a local HTTP Vite server");
    value.url = url.origin + "/";
  }
  value.out = path.resolve(value.out);
  const within = (base) => {
    const relative = path.relative(base, value.out);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  };
  if (!within(tmpdir()) && !within(path.join(repoRoot, ".aijian-dev")))
    throw new Error("--out must be under the system temp directory or repository .aijian-dev");
  return value;
}

async function canonicalPath(value) {
  const tail = [];
  let ancestor = path.resolve(value);
  for (;;) {
    try {
      return path.resolve(await realpath(ancestor), ...tail.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      tail.push(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

async function checkOutputTarget(out) {
  const target = await canonicalPath(out);
  const allowed = await Promise.all(
    [tmpdir(), path.join(repoRoot, ".aijian-dev")].map(canonicalPath),
  );
  if (
    !allowed.some((base) => {
      const relative = path.relative(base, target);
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    })
  )
    throw new Error("--out resolves outside the allowed temp/ignored directories");
}

async function browserPath(explicit) {
  if (explicit) {
    await access(explicit);
    return explicit;
  }
  for (const candidate of [
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    chromium.executablePath(),
  ]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* Try the next installed browser. */
    }
  }
  throw new Error("No Chromium/Chrome found; use --browser or AIVORA_CHROMIUM");
}

async function run(config) {
  await checkOutputTarget(config.out);
  await mkdir(config.out, { recursive: true });
  const report = {
    scope:
      "Real ProWorkspace export→QC review with synthetic IPC; no real export/provider/Electron assertion",
    expectedStates: qcStates,
    viewports,
    aspects,
    chromiumSandbox: true,
    results: [],
    exitCode: 2,
  };
  try {
    report.commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    report.workingTreeDirty = Boolean(
      execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    );
  } catch {
    report.commit = null;
  }
  let server;
  let httpServer;
  let browser;
  let setupPhase = "FIXTURE";
  const persist = () =>
    writeFile(path.join(config.out, "report.json"), JSON.stringify(report, null, 2));
  try {
    const mediaPath = path.join(repoRoot, "apps/desktop/fixtures/shot-a.mp4");
    const media = await readFile(mediaPath);
    report.fixture = {
      path: "apps/desktop/fixtures/shot-a.mp4",
      sha256: createHash("sha256").update(media).digest("hex"),
    };
    if (!config.url) {
      setupPhase = "SERVER";
      server = await createServer({
        root: appRoot,
        configFile: path.join(appRoot, "vite.config.ts"),
        cacheDir: path.join(config.out, "vite-cache"),
        logLevel: "warn",
        server: { host: "127.0.0.1", middlewareMode: true, open: false, hmr: false },
      });
      // Vite 8 treats listen(0) as its default port. Own the HTTP listener so the OS
      // actually assigns an ephemeral port, while Vite supplies all app middleware.
      httpServer = createHttpServer(server.middlewares);
      await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(0, "127.0.0.1", () => {
          httpServer.off("error", reject);
          resolve();
        });
      });
      const address = httpServer.address();
      config.url = `http://127.0.0.1:${address.port}/`;
    }
    report.server = config.url;
    setupPhase = "BROWSER_DISCOVERY";
    report.browserPath = await browserPath(config.browser);
    setupPhase = "BROWSER_LAUNCH";
    browser = await chromium.launch({
      executablePath: report.browserPath,
      headless: true,
      chromiumSandbox: true,
    });
    report.browserVersion = browser.version();
    report.sourceHashes = Object.fromEntries(
      await Promise.all(
        [
          "apps/studio-web/src/aivora/pro/ProWorkspace.tsx",
          "apps/studio-web/src/aivora/pro/pro.css",
          "apps/studio-web/src/aivora/next/ExportCheck.tsx",
          "apps/studio-web/src/aivora/next/ExportCheck.css",
          "packages/contracts/src/film-export-qc.ts",
        ].map(async (name) => [
          name,
          createHash("sha256")
            .update(await readFile(path.join(repoRoot, name)))
            .digest("hex"),
        ]),
      ),
    );
    const expected = await runQcCases({ browser, config, report, media, persist });
    report.expectedResults = expected;
    report.exitCode =
      report.results.length === expected && report.results.every((row) => row.passed) ? 0 : 1;
  } catch (error) {
    report.setupError = error.message;
    report.setupPhase = setupPhase;
    report.setupCode = /sandbox/i.test(error.message)
      ? "PRO_LAYOUT_BROWSER_SANDBOX"
      : `PRO_LAYOUT_SETUP_${setupPhase}`;
    report.exitCode = 2;
  } finally {
    const cleanup = await Promise.allSettled([
      browser ? browser.close() : Promise.resolve(),
      server ? server.close() : Promise.resolve(),
      httpServer
        ? new Promise((resolve, reject) => {
            httpServer.closeAllConnections();
            httpServer.close((error) => (error ? reject(error) : resolve()));
          })
        : Promise.resolve(),
    ]);
    const cleanupErrors = cleanup.filter((result) => result.status === "rejected");
    if (cleanupErrors.length) {
      report.cleanupErrorCount = cleanupErrors.length;
      report.setupCode = "PRO_LAYOUT_CLEANUP";
      report.setupPhase = "CLEANUP";
      report.exitCode = 2;
    }
    await persist();
  }
  console.log(
    `Pro export QC: ${report.results.filter((row) => row.passed).length}/${report.results.length}; report ${path.join(config.out, "report.json")}`,
  );
  emitGitHubErrors(report);
  return report.exitCode;
}

try {
  const config = options();
  if (!config)
    console.log(
      "Usage: node apps/studio-web/e2e/pro-export-qc-audit.mjs [--url http://127.0.0.1:5173/] [--browser /path/to/chromium] [--out temp-or-.aijian-dev-directory]\nQC host: 8 states × 4 viewport/aspect combinations (32 expected). Without --url, starts and closes an in-process Vite server. Exit: 0 passed; 1 audit regression; 2 setup/usage error. Chromium sandbox is always enabled.",
    );
  else process.exitCode = await run(config);
} catch (error) {
  if (process.env.GITHUB_ACTIONS === "true")
    console.error("::error title=Pro export QC audit::EXPORT_QC_CONFIGURATION");
  else console.error(error.message);
  process.exitCode = 2;
}
