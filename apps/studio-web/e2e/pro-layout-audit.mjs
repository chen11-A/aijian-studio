/** Real ProWorkspace geometry/selection gate. No fixture/hash-shell navigation or provider calls. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { installProAuditBridge, seedProProject } from "./pro-layout-fixture.mjs";
import { probeProLayout } from "./pro-layout-probe.mjs";

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
    const environmentCodes = new Set([
      "PRO_LAYOUT_SETUP_FIXTURE",
      "PRO_LAYOUT_SETUP_SERVER",
      "PRO_LAYOUT_SETUP_BROWSER_DISCOVERY",
      "PRO_LAYOUT_SETUP_BROWSER_LAUNCH",
      "PRO_LAYOUT_BROWSER_SANDBOX",
      "PRO_LAYOUT_CLEANUP",
    ]);
    const code = environmentCodes.has(report.setupCode)
      ? report.setupCode
      : "PRO_LAYOUT_ENVIRONMENT";
    console.error(`::error title=Pro layout audit::${code}`);
    return;
  }
  const kinds = new Set([
    "control-clipped-without-scroll",
    "offscreen-control",
    "covered-center",
    "button-content-overflow",
    "picker-not-full-width",
    "picker-count-wraps",
    "candidate-content-outside-card",
    "candidate-control-outside-viewport",
    "document-overflow",
  ]);
  const pages = new Set(["script", "board", "edit", "single", "navigation-failed"]);
  const failed = report.results.filter((row) => !row.passed).slice(0, 8);
  for (const row of failed) {
    const combination = /^(1280x800|1920x1080)-(16x9|9x16)-[123]versions$/.test(row.combination)
      ? row.combination
      : "unknown";
    const page = pages.has(row.page) ? row.page : "unknown";
    const found = [
      ...new Set(
        (row.geometry?.issues ?? []).map((issue) =>
          kinds.has(issue.kind) ? issue.kind : "unknown",
        ),
      ),
    ];
    const code = found.length
      ? "PRO_LAYOUT_GEOMETRY"
      : row.screenshotError
        ? "PRO_LAYOUT_SCREENSHOT"
        : "PRO_LAYOUT_ASSERTION";
    const width = row.geometry?.pickerMetrics?.width;
    const numeric = Number.isFinite(width) ? ` pickerWidth=${Math.round(width)}` : "";
    console.error(
      `::error title=Pro layout audit::${code} combination=${combination} page=${page} kinds=${found.join(",") || "none"}${numeric}`,
    );
  }
  if (!failed.length) console.error("::error title=Pro layout audit::PRO_LAYOUT_INCOMPLETE");
}

function options() {
  const value = {
    url: process.env.AIVORA_AUDIT_URL,
    browser: process.env.AIVORA_CHROMIUM,
    out: process.env.AIVORA_AUDIT_OUT ?? path.join(tmpdir(), "aivora-pro-layout-audit"),
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

const takeSignature = (film) => film.shots.map((shot) => ({ id: shot.id, takes: shot.takes }));

async function run(config) {
  await checkOutputTarget(config.out);
  await mkdir(config.out, { recursive: true });
  const report = {
    scope: "ProWorkspace script/board/edit and 1/2/3-version selection; synthetic IPC",
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
    const libraryModuleUrl = new URL("/src/aivora/film/library.ts", config.url).href;
    const projectModuleUrl = new URL("/src/aivora/film/project.ts", config.url).href;
    const mediaUrl = new URL("/__pro-layout__/shot-a.mp4", config.url).href;
    for (const viewport of viewports)
      for (const aspect of aspects)
        for (const versions of [1, 2, 3]) {
          const combination = `${viewport.width}x${viewport.height}-${aspect.replace(":", "x")}-${versions}versions`;
          const dir = path.join(config.out, combination);
          await mkdir(dir, { recursive: true });
          const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
          const page = await context.newPage();
          page.setDefaultTimeout(10000);
          const pageerrors = [];
          const blockedRequests = [];
          page.on("pageerror", (error) => pageerrors.push(error.message));
          await page.route("**/*", (route) => {
            const url = new URL(route.request().url());
            if (
              /^https?:$/.test(url.protocol) &&
              (url.origin !== new URL(config.url).origin ||
                url.pathname === "/api" ||
                url.pathname.startsWith("/api/"))
            ) {
              blockedRequests.push(url.origin + url.pathname);
              return route.abort();
            }
            if (url.href === mediaUrl)
              return route.fulfill({ contentType: "video/mp4", body: media });
            return route.continue();
          });
          await page.addInitScript(installProAuditBridge);
          const nav = (name) =>
            page.locator("nav.tabs").getByRole("button", { name: new RegExp(name) });
          const readSaved = () =>
            page.evaluate(async (url) => {
              const library = await import(url);
              return library.readSaved(library.activeFilmId());
            }, libraryModuleUrl);
          async function snapshot(name, arrive) {
            const result = {
              combination,
              page: name,
              reached: false,
              screenshot: path.join(combination, `${name}.png`),
            };
            try {
              await arrive();
              result.reached = true;
              await page.evaluate(async () => {
                await document.fonts.ready;
                await new Promise((resolve) =>
                  window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
                );
              });
              result.geometry = await page.evaluate(probeProLayout);
              assert.deepEqual(
                result.geometry.issues,
                [],
                "Layout probe found inaccessible, covered or overflowing content",
              );
              assert.deepEqual(pageerrors, [], "Page raised an uncaught error");
              assert.deepEqual(
                blockedRequests,
                [],
                "App attempted external/API access during a local-only layout audit",
              );
              result.passed = true;
            } catch (error) {
              result.passed = false;
              result.error = error.message;
            }
            await page
              .screenshot({ path: path.join(config.out, result.screenshot) })
              .catch((error) => {
                result.passed = false;
                result.screenshotError = error.message;
              });
            result.pageerrors = [...pageerrors];
            result.blockedRequests = [...blockedRequests];
            report.results.push(result);
            console.log(`${result.passed ? "PASS" : "FAIL"} ${combination} ${name}`);
            await persist();
            return result;
          }
          try {
            await page.goto(config.url, { waitUntil: "domcontentloaded" });
            await page.evaluate(seedProProject, {
              projectModuleUrl,
              aspect,
              versions,
              videoUrl: mediaUrl,
            });
            await page.reload({ waitUntil: "domcontentloaded" });
            await page.locator("nav.tabs").waitFor();
            if (versions === 3) {
              await snapshot("script", async () => {
                await nav("剧本").click();
                await page.getByLabel("这一场", { exact: true }).waitFor();
                assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "script");
              });
              await snapshot("board", async () => {
                await nav("分镜").click();
                assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "board");
                assert.equal(await page.locator(".grid .card").count(), 6);
              });
              await snapshot("edit", async () => {
                await nav("剪辑").click();
                assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "edit");
                await page.locator(".preview-player").waitFor();
                assert.equal(await page.locator(".clip.v").count(), 6);
              });
            }
            await snapshot("single", async () => {
              await nav("分镜").click();
              assert.equal(await page.locator(".pro-root").getAttribute("data-stage"), "board");
              await page.getByRole("button", { name: "单个镜头", exact: true }).click();
              await page.locator(".cands > .nx-takes").waitFor();
              assert.equal(await page.locator(".nx-take").count(), versions);
              const before = await readSaved();
              const originalTakes = takeSignature(before);
              if (versions === 1) await page.locator(".nx-take").click();
              for (let index = 2; index <= versions; index += 1) {
                await page.getByRole("button", { name: `用第 ${index} 版`, exact: true }).click();
                // Poll the serialized save synchronously: older Playwright versions treat a
                // Promise-returning predicate as truthy before the save has completed.
                await page.waitForFunction(
                  ({ key, id, label }) => {
                    const raw = window.localStorage.getItem(key);
                    const saved = raw ? JSON.parse(raw) : null;
                    return (
                      saved?.shots?.[0]?.selectedTakeId === id &&
                      document.querySelector(".nx-take.nx-in-use")?.getAttribute("aria-label") ===
                        label
                    );
                  },
                  {
                    key: `aivora.film.v1.${before.id}`,
                    id: before.shots[0].takes[index - 1].id,
                    label: `第 ${index} 版`,
                  },
                );
                assert.equal(
                  await page.locator(".nx-take.nx-in-use").getAttribute("aria-label"),
                  `第 ${index} 版`,
                );
              }
              const after = await readSaved();
              assert.equal(after.shots[0].selectedTakeId, before.shots[0].takes[versions - 1].id);
              assert.deepEqual(
                takeSignature(after),
                originalTakes,
                "Selecting a version changed take metadata",
              );
              assert.deepEqual(
                after.shots.slice(1).map((shot) => shot.selectedTakeId),
                before.shots.slice(1).map((shot) => shot.selectedTakeId),
              );
              assert.deepEqual(await page.evaluate(() => window.__proLayoutCalls), []);
            });
          } catch (error) {
            await snapshot("navigation-failed", () => {
              throw error;
            });
          } finally {
            await context.close();
          }
        }
    report.exitCode =
      report.results.length === 24 && report.results.every((row) => row.passed) ? 0 : 1;
  } catch (error) {
    report.setupError = error.message;
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
      report.exitCode = 2;
    }
    await persist();
  }
  console.log(
    `Pro layout: ${report.results.filter((row) => row.passed).length}/${report.results.length}; report ${path.join(config.out, "report.json")}`,
  );
  emitGitHubErrors(report);
  return report.exitCode;
}

try {
  const config = options();
  if (!config)
    console.log(
      "Usage: node apps/studio-web/e2e/pro-layout-audit.mjs [--url http://127.0.0.1:5173/] [--browser /path/to/chromium] [--out temp-or-.aijian-dev-directory]\nWithout --url, starts and closes an in-process Vite server. Exit: 0 passed; 1 audit regression; 2 setup/usage error. Chromium sandbox is always enabled.",
    );
  else process.exitCode = await run(config);
} catch (error) {
  if (process.env.GITHUB_ACTIONS === "true")
    console.error("::error title=Pro layout audit::PRO_LAYOUT_CONFIGURATION");
  else console.error(error.message);
  process.exitCode = 2;
}
