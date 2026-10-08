import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { _electron as electron } from "playwright-core";

import { runDesktopProviderResult } from "./desktop-provider-result.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const desktopDirectory = join(repositoryRoot, "apps", "desktop");
const electronExecutable = join(
  desktopDirectory,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const profileRoot = join(repositoryRoot, ".aijian-dev");
const runId = randomUUID();
const evidenceDirectory = join(profileRoot, "c2-episode-ui", runId);
const resultPath = join(profileRoot, "e2e-results", "desktop-episode-workspace.current.json");
const pythonExecutable =
  process.platform === "win32"
    ? join(repositoryRoot, ".venv", "Scripts", "python.exe")
    : join(repositoryRoot, ".venv", "bin", "python");
const expectedEpisodeBridgeKeys = ["listEpisodes", "getEpisode", "createEpisode"];
const CLOSE_TIMEOUT_MS = 10_000;
const PYTHON_TIMEOUT_MS = 10_000;
const UI_TIMEOUT_MS = 30_000;
const defaultWindowSize = { width: 1440, height: 920, label: "default" };
const minimumWindowSize = { width: 980, height: 680, label: "minimum" };
const runState = {
  app: undefined,
  profile: undefined,
  process: undefined,
  page: undefined,
  closeAttempted: false,
  preserveProfile: false,
  phase: "preflight",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ownsProfile(candidate) {
  const path = relative(profileRoot, candidate);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

async function hashFile(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function hashTree(root) {
  const hashes = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) hashes[relative(repositoryRoot, path)] = await hashFile(path);
    }
  }
  await visit(root);
  return hashes;
}

async function buildInputHashes() {
  const sourceInputs = [
    join(repositoryRoot, "apps", "desktop", "src", "main.ts"),
    join(repositoryRoot, "apps", "desktop", "src", "preload.ts"),
    join(repositoryRoot, "apps", "desktop", "src", "episode-ipc.ts"),
    join(repositoryRoot, "apps", "studio-web", "src", "api", "studio.ts"),
    join(repositoryRoot, "apps", "studio-web", "src", "aivora", "DemoApp.tsx"),
    join(repositoryRoot, "apps", "studio-web", "src", "aivora", "HomePages.tsx"),
    join(repositoryRoot, "apps", "studio-web", "src", "aivora", "model.tsx"),
    join(repositoryRoot, "apps", "studio-web", "src", "aivora", "adapters", "episodeWorkspace.ts"),
    join(
      repositoryRoot,
      "apps",
      "studio-web",
      "src",
      "aivora",
      "adapters",
      "workspaceSelection.ts",
    ),
    join(repositoryRoot, "apps", "studio-web", "src", "main.tsx"),
    join(repositoryRoot, "apps", "studio-web", "src", "aivora", "main.tsx"),
    join(repositoryRoot, "apps", "studio-web", "src", "aivora", "demo.css"),
    join(repositoryRoot, "apps", "studio-web", "src", "aivora", "authority.css"),
    join(repositoryRoot, "apps", "studio-web", "src", "aivora", "v2.css"),
    join(repositoryRoot, "apps", "studio-web", "src", "aivora", "v2-home.css"),
  ];
  const outputs = [
    join(repositoryRoot, "apps", "studio-web", "dist", "index.html"),
    join(repositoryRoot, "apps", "desktop", "dist", "main.js"),
    join(repositoryRoot, "apps", "desktop", "dist", "preload.js"),
    fileURLToPath(import.meta.url),
  ];
  for (const input of [...sourceInputs, ...outputs]) await access(input);
  return {
    sources: Object.fromEntries(
      await Promise.all(
        sourceInputs.map(async (input) => [relative(repositoryRoot, input), await hashFile(input)]),
      ),
    ),
    desktopOutputTree: await hashTree(join(repositoryRoot, "apps", "desktop", "dist")),
    webOutputTree: await hashTree(join(repositoryRoot, "apps", "studio-web", "dist")),
    runner: await hashFile(fileURLToPath(import.meta.url)),
  };
}

async function launch(profile) {
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [desktopDirectory, `--user-data-dir=${profile}`],
    cwd: repositoryRoot,
    env: { ...process.env, AIJIAN_E2E_USER_DATA_DIR: profile },
    timeout: 30_000,
  });
  runState.app = app;
  runState.process = app.process();
  runState.closeAttempted = false;
  const page = await app.firstWindow({ timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  runState.page = page;
  return page;
}

async function normalClose(label) {
  if (!runState.app) return;
  runState.closeAttempted = true;
  await withTimeout(runState.app.close(), CLOSE_TIMEOUT_MS, label);
  if (!runState.process || runState.process.exitCode !== 0)
    throw new Error(`${label} did not exit normally: ${runState.process?.exitCode}`);
  runState.app = undefined;
  runState.process = undefined;
}

async function withTimeout(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeout}ms`)),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function navigateToProjectCenter(page) {
  if (await page.getByRole("button", { name: "进入 UI 演示", exact: true }).count())
    await page.getByRole("button", { name: "进入 UI 演示", exact: true }).click();
  await (await visibleProjectCenterButton(page)).click();
  await page.getByRole("heading", { level: 1, name: "项目中心" }).waitFor();
}

async function visibleProjectCenterButton(page) {
  const candidates = page.getByRole("button", { name: "打开项目中心", exact: true });
  const visibleIndexes = [];
  for (let index = 0; index < (await candidates.count()); index += 1) {
    if (await candidates.nth(index).isVisible()) visibleIndexes.push(index);
  }
  if (visibleIndexes.length === 1) return candidates.nth(visibleIndexes[0]);
  assert(
    visibleIndexes.length === 0 &&
      (await page.getByRole("heading", { level: 1, name: "创作首页" }).isVisible()),
    `Expected one visible header project-center entry, found ${visibleIndexes.length}`,
  );
  const navigationCandidates = page
    .locator("aside[aria-label='主导航']")
    .getByRole("button", { name: "项目中心", exact: true });
  const visibleNavigationIndexes = [];
  for (let index = 0; index < (await navigationCandidates.count()); index += 1) {
    if (await navigationCandidates.nth(index).isVisible()) visibleNavigationIndexes.push(index);
  }
  assert(
    visibleNavigationIndexes.length === 1,
    `Expected one visible global-home project-center navigation entry, found ${visibleNavigationIndexes.length}`,
  );
  return navigationCandidates.nth(visibleNavigationIndexes[0]);
}

async function waitForProjectOption(page, projectName) {
  const select = page.getByLabel("作品选择");
  await select.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await page.waitForFunction(
    (expectedName) => {
      const control = document.querySelector("select[aria-label='作品选择']");
      return (
        control instanceof HTMLSelectElement &&
        [...control.options].some((option) => option.textContent?.trim() === expectedName)
      );
    },
    projectName,
    { timeout: UI_TIMEOUT_MS },
  );
}

async function createProjectThroughUi(page, name) {
  await navigateToProjectCenter(page);
  const connect = page.getByRole("button", { name: "连接本地工作区", exact: true });
  if (await connect.count()) await connect.click();
  await page.getByRole("button", { name: "本地工作区已连接", exact: true }).waitFor();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("作品名称").fill(name);
  await page.getByRole("button", { name: "保存演示修改", exact: true }).click();
  await waitForProjectOption(page, name);
  const project = await page.evaluate(async (projectName) => {
    const bridge = globalThis.aijian;
    if (!bridge || globalThis.top !== globalThis)
      throw new Error("Episode E2E must read the real bridge from the top-level renderer");
    return (await bridge.listProjects()).data.find((candidate) => candidate.name === projectName);
  }, name);
  assert(
    project !== undefined,
    "Project created through the UI was absent from the read-only bridge list",
  );
  return project;
}

async function requireDefaultEpisodeVisibleThroughUi(page) {
  const select = page.getByLabel("剧集选择");
  await select.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  const defaultTitleHandle = await page.waitForFunction(
    () => {
      const control = document.querySelector("select[aria-label='剧集选择']");
      if (!(control instanceof HTMLSelectElement)) return undefined;
      return [...control.options].find((option) => option.value !== "")?.textContent?.trim();
    },
    undefined,
    { timeout: UI_TIMEOUT_MS },
  );
  const defaultTitle = await defaultTitleHandle.jsonValue();
  assert(
    typeof defaultTitle === "string" && defaultTitle.length > 0,
    "A newly created project did not display its backend default episode",
  );
  return defaultTitle;
}

async function returnToProjectHome(page, projectName) {
  const projectHome = page.getByRole("heading", { level: 1, name: "项目创作首页" });
  if (await projectHome.isVisible()) return;
  const creationHome = page.getByRole("button", { name: "创作首页", exact: true });
  await creationHome.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await creationHome.click();
  const globalHome = page.getByRole("heading", { level: 1, name: "创作首页" });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("h1")].some((heading) => {
        const text = heading.textContent?.trim();
        return text === "创作首页" || text === "项目创作首页";
      }),
    undefined,
    { timeout: UI_TIMEOUT_MS },
  );
  if (await projectHome.isVisible()) return;
  await globalHome.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  const projectCard = page.locator(".v2-recent-card", {
    has: page.getByRole("heading", { level: 3, name: projectName, exact: true }),
  });
  await projectCard.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await projectCard.getByRole("button", { name: "打开", exact: true }).click();
  await projectHome.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
}

async function openProjectThroughUi(page, projectName) {
  await page.getByLabel("作品选择").selectOption({ label: projectName });
  await page.getByRole("heading", { level: 1, name: "项目创作首页" }).waitFor();
}

async function createEpisodeThroughUi(page, title) {
  const workspace = page.locator("section[aria-label='真实剧集']");
  await workspace.getByRole("button", { name: "新建剧集", exact: true }).click();
  await page.getByLabel("剧集名称").fill(title);
  await page.getByRole("button", { name: "创建剧集", exact: true }).click();
  await workspace.getByRole("button", { name: title, exact: true }).waitFor();
  await waitForEpisodeOptionTitle(page, title);
}

async function readTopLevelEpisodes(page, projectId, titles) {
  return page.evaluate(
    async ({ projectId, titles, expectedKeys }) => {
      const bridge = globalThis.aijian;
      if (!bridge || globalThis.top !== globalThis)
        throw new Error("The real preload bridge was not present in the top-level renderer");
      const keys = Object.keys(bridge).sort();
      if (!expectedKeys.every((key) => keys.includes(key)))
        throw new Error(`Episode methods absent from actual preload: ${JSON.stringify(keys)}`);
      const listed = await bridge.listEpisodes(projectId);
      const found = titles.map((title) => listed.data.find((episode) => episode.title === title));
      if (found.some((episode) => !episode))
        throw new Error("UI-created episode was absent from the actual preload list result");
      const detailed = await Promise.all(
        found.map((episode) => bridge.getEpisode(projectId, episode.id)),
      );
      return {
        bridgeKeys: keys,
        nodeGlobals: { process: typeof globalThis.process, require: typeof globalThis.require },
        listedEpisodes: listed.data,
        episodes: detailed.map((entry) => entry.data),
      };
    },
    { projectId, titles, expectedKeys: expectedEpisodeBridgeKeys },
  );
}

function runPython(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonExecutable, args, {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`Read-only SQLite inspector timed out after ${PYTHON_TIMEOUT_MS}ms`));
    }, PYTHON_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`Read-only SQLite inspector failed (${code}): ${stderr}`));
    });
  });
}

async function inspectEpisodesReadOnly(databasePath, projectId) {
  const program = [
    "import json, pathlib, sqlite3, sys",
    "db, project_id = sys.argv[1:]",
    "connection = sqlite3.connect(pathlib.Path(db).resolve().as_uri() + '?mode=ro', uri=True)",
    "rows = connection.execute('SELECT id, project_id, position, title, revision FROM episodes WHERE project_id = ? ORDER BY position, id', (project_id,)).fetchall()",
    "print(json.dumps([dict(zip(('id','project_id','position','title','revision'), row)) for row in rows]))",
  ].join("; ");
  return JSON.parse(await runPython(["-c", program, databasePath, projectId]));
}

function assertSameEpisodes(expected, actual, label) {
  const normalized = (entries) =>
    entries
      .map(({ id, project_id, position, title, revision }) => ({
        id,
        project_id,
        position: String(position),
        title,
        revision: String(revision),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  if (JSON.stringify(normalized(expected)) !== JSON.stringify(normalized(actual)))
    throw new Error(`${label} did not match the read-only preload facts`);
}

async function writeEvidence(evidence) {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    join(evidenceDirectory, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

async function captureFailure(error) {
  await mkdir(evidenceDirectory, { recursive: true });
  const state = { phase: runState.phase, profile: runState.profile, error: String(error) };
  await writeFile(
    join(evidenceDirectory, "failure-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
  if (!runState.page) return;
  await runState.page
    .screenshot({ path: join(evidenceDirectory, "failure.png"), fullPage: true })
    .catch(() => undefined);
  await runState.page
    .content()
    .then((html) => writeFile(join(evidenceDirectory, "failure-dom.html"), html, "utf8"))
    .catch(() => undefined);
}

async function visibleEpisodeTitles(page) {
  return page.locator("section[aria-label='真实剧集'] li").allInnerTexts();
}

async function waitForSelectedEpisode(page, episodeId) {
  const select = page.getByLabel("剧集选择");
  await select.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await page.waitForFunction(
    (expectedId) => {
      const control = document.querySelector("select[aria-label='剧集选择']");
      return control instanceof HTMLSelectElement && control.value === expectedId;
    },
    episodeId,
    { timeout: UI_TIMEOUT_MS },
  );
}

async function waitForEpisodeOptionTitle(page, episodeTitle) {
  const select = page.getByLabel("剧集选择");
  await select.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await page.waitForFunction(
    (expectedTitle) => {
      const control = document.querySelector("select[aria-label='剧集选择']");
      return (
        control instanceof HTMLSelectElement &&
        [...control.options].some((option) => option.textContent?.trim() === expectedTitle)
      );
    },
    episodeTitle,
    { timeout: UI_TIMEOUT_MS },
  );
}

async function waitForEpisodeOption(page, episode) {
  const select = page.getByLabel("剧集选择");
  await select.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await page.waitForFunction(
    (expected) => {
      const control = document.querySelector("select[aria-label='剧集选择']");
      return (
        control instanceof HTMLSelectElement &&
        [...control.options].some(
          (option) => option.value === expected.id && option.textContent?.trim() === expected.title,
        )
      );
    },
    episode,
    { timeout: UI_TIMEOUT_MS },
  );
}

async function waitForSelectedEpisodeTitle(page, episodeTitle) {
  const select = page.getByLabel("剧集选择");
  await select.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await page.waitForFunction(
    (expectedTitle) => {
      const control = document.querySelector("select[aria-label='剧集选择']");
      if (!(control instanceof HTMLSelectElement)) return false;
      return (
        [...control.options]
          .find((option) => option.value === control.value)
          ?.textContent?.trim() === expectedTitle
      );
    },
    episodeTitle,
    { timeout: UI_TIMEOUT_MS },
  );
}

function rectanglesOverlap(first, second) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

async function waitForStableInnerWindow(page, expectedContentBounds) {
  const innerWindowHandle = await page.waitForFunction(
    (expected) =>
      new Promise((resolvePromise) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const innerWindow = { width: innerWidth, height: innerHeight };
            resolvePromise(
              innerWindow.width === expected.width && innerWindow.height === expected.height
                ? innerWindow
                : false,
            );
          }),
        );
      }),
    expectedContentBounds,
    { timeout: UI_TIMEOUT_MS },
  );
  return innerWindowHandle.jsonValue();
}

async function setBrowserWindowSize(page, size) {
  const browserWindow = await runState.app.browserWindow(page);
  await browserWindow.evaluate(
    (window, targetSize) => window.setSize(targetSize.width, targetSize.height),
    size,
  );
  const bounds = await browserWindow.evaluate((window) => window.getBounds());
  assert(
    bounds.width === size.width && bounds.height === size.height,
    `BrowserWindow did not resize to ${size.width}x${size.height}`,
  );
  const contentBounds = await browserWindow.evaluate((window) => window.getContentBounds());
  return waitForStableInnerWindow(page, {
    width: contentBounds.width,
    height: contentBounds.height,
  });
}

async function visibleTopbarControlBox(page, name, locator, required) {
  const visible = [];
  for (let index = 0; index < (await locator.count()); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) visible.push(candidate);
  }
  if (required)
    assert(visible.length === 1, `Expected exactly one visible ${name}, found ${visible.length}`);
  else assert(visible.length <= 1, `Expected at most one visible ${name}, found ${visible.length}`);
  if (!visible.length) return undefined;
  const box = await visible[0].boundingBox();
  assert(box !== null, `${name} lacks a bounding box`);
  return { name, box };
}

async function visibleHeadingTextBox(page, name, locator) {
  await locator.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  assert((await locator.count()) === 1, `Expected exactly one ${name}`);
  const box = await locator.evaluate((heading) => {
    const range = document.createRange();
    range.selectNodeContents(heading);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  assert(box.width > 0 && box.height > 0, `${name} has no visible text bounds`);
  return { name, box };
}

async function assertMinimumEpisodeControlsReachable(page, episodeWorkspace, innerWindow) {
  const projectBody = page.locator(".v2-project-home .v2-project-home-body");
  const footer = page.locator(".v2-project-home > .flow-footer");
  const refreshEpisodes = episodeWorkspace.getByRole("button", {
    name: "刷新剧集列表",
    exact: true,
  });
  const createEpisode = episodeWorkspace.getByRole("button", {
    name: "新建剧集",
    exact: true,
  });
  await projectBody.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await footer.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await refreshEpisodes.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await createEpisode.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  const bodyBox = await projectBody.boundingBox();
  const footerBox = await footer.boundingBox();
  assert(bodyBox !== null, "Project body lacks a bounding box at minimum viewport");
  assert(footerBox !== null, "Project footer lacks a bounding box at minimum viewport");
  const beforeScroll = await projectBody.evaluate((body) => ({
    scrollTop: body.scrollTop,
    scrollHeight: body.scrollHeight,
    clientHeight: body.clientHeight,
  }));
  assert(
    beforeScroll.scrollHeight > beforeScroll.clientHeight,
    "Project body has no vertical overflow to reach lower episode controls at minimum viewport",
  );
  await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
  await page.mouse.wheel(0, beforeScroll.clientHeight);
  await page.waitForFunction(
    (previousScrollTop) => {
      const body = document.querySelector(".v2-project-home .v2-project-home-body");
      return body instanceof HTMLElement && body.scrollTop > previousScrollTop;
    },
    beforeScroll.scrollTop,
    { timeout: UI_TIMEOUT_MS },
  );
  const afterScroll = await projectBody.evaluate((body) => body.scrollTop);
  const controls = [
    {
      entry: await visibleTopbarControlBox(page, "refresh episodes", refreshEpisodes, true),
      buttonText: "刷新剧集列表",
    },
    {
      entry: await visibleTopbarControlBox(page, "create episode", createEpisode, true),
      buttonText: "新建剧集",
    },
  ];
  for (const { entry: control, buttonText } of controls) {
    assert(
      control.box.x >= bodyBox.x &&
        control.box.y >= bodyBox.y &&
        control.box.x + control.box.width <= bodyBox.x + bodyBox.width &&
        control.box.y + control.box.height <= bodyBox.y + bodyBox.height,
      `${control.name} is outside the project body at minimum viewport`,
    );
    assert(
      control.box.y + control.box.height <= footerBox.y &&
        !rectanglesOverlap(control.box, footerBox),
      `${control.name} is covered by the footer at minimum viewport`,
    );
    const centerIsClickable = await page.evaluate(
      (box) => {
        const element = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        const button = element?.closest("button");
        return button instanceof HTMLButtonElement && button.textContent?.trim() === box.buttonText;
      },
      { ...control.box, buttonText },
    );
    assert(
      centerIsClickable,
      `${control.name} is not the topmost clickable element at minimum viewport`,
    );
  }
  await createEpisode.click();
  const dialog = page.getByRole("dialog", { name: "新建剧集", exact: true });
  await dialog.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  const createEpisodeDialogScreenshot = join(
    evidenceDirectory,
    "minimum-create-episode-dialog.png",
  );
  await page.screenshot({ path: createEpisodeDialogScreenshot, fullPage: true });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: UI_TIMEOUT_MS });
  assert(
    footerBox.y + footerBox.height <= innerWindow.height,
    "Project footer exceeds the inner viewport at minimum viewport",
  );
  return {
    beforeScroll,
    afterScroll,
    bodyBox,
    footerBox,
    controls,
    createEpisodeDialogScreenshot: relative(repositoryRoot, createEpisodeDialogScreenshot),
  };
}

async function assertViewportControls(page, size, projectName, createdEpisodes) {
  const innerWindow = await setBrowserWindowSize(page, size);
  const projectCenter = await visibleProjectCenterButton(page);
  const episodeSelect = page.getByLabel("剧集选择");
  const projectSelect = page.getByLabel("作品选择");
  await projectCenter.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await episodeSelect.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  await projectSelect.waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
  assert(await projectCenter.isEnabled(), `Project-center entry is disabled at ${size.label}`);
  assert(await episodeSelect.isEnabled(), `Episode selector is disabled at ${size.label}`);
  assert(await projectSelect.isEnabled(), `Project selector is disabled at ${size.label}`);
  await projectSelect.click();
  await page.keyboard.press("Escape");
  await episodeSelect.click();
  await page.keyboard.press("Escape");
  const episodeWorkspace = page.locator("section[aria-label='真实剧集']");
  for (const episode of createdEpisodes) {
    await episodeWorkspace
      .getByRole("button", { name: episode.title, exact: true })
      .waitFor({ state: "visible", timeout: UI_TIMEOUT_MS });
    await waitForEpisodeOption(page, episode);
  }
  await episodeSelect.selectOption(createdEpisodes[0].id);
  await waitForSelectedEpisode(page, createdEpisodes[0].id);
  await episodeSelect.selectOption(createdEpisodes[1].id);
  await waitForSelectedEpisode(page, createdEpisodes[1].id);
  const minimumEpisodeControls =
    size.label === "minimum"
      ? await assertMinimumEpisodeControlsReachable(page, episodeWorkspace, innerWindow)
      : undefined;
  const projectCenterBox = await projectCenter.boundingBox();
  assert(projectCenterBox !== null, `Project-center entry lacks a bounding box at ${size.label}`);
  const projectHeading = page
    .locator(".v2-project-home .v2-home-heading")
    .getByRole("heading", { level: 1, name: "项目创作首页", exact: true });
  const projectSettings = page
    .locator(".v2-project-home .v2-home-heading .actions")
    .getByRole("button", { name: "项目设置", exact: true });
  const controls = [
    await visibleHeadingTextBox(page, "project heading text", projectHeading),
    await visibleTopbarControlBox(page, "project settings", projectSettings, true),
    await visibleTopbarControlBox(page, "project selector", projectSelect, true),
    await visibleTopbarControlBox(page, "episode selector", episodeSelect, true),
    await visibleTopbarControlBox(
      page,
      "demo controls",
      page.locator(".demo-root .topbar .demo-controls"),
      false,
    ),
    await visibleTopbarControlBox(
      page,
      "service indicator",
      page.locator(".demo-root .topbar .service-indicator"),
      false,
    ),
    await visibleTopbarControlBox(
      page,
      "mode switch",
      page.locator(".demo-root .topbar .mode-switch"),
      true,
    ),
    await visibleTopbarControlBox(
      page,
      "user menu",
      page.locator(".demo-root .topbar .user-menu"),
      true,
    ),
  ].filter(Boolean);
  const boxes = [{ name: "project-center entry", box: projectCenterBox }, ...controls];
  for (const entry of boxes) {
    assert(
      entry.box.x >= 0 &&
        entry.box.y >= 0 &&
        entry.box.x + entry.box.width <= innerWindow.width &&
        entry.box.y + entry.box.height <= innerWindow.height,
      `${entry.name} exceeds the inner viewport at ${size.label}`,
    );
  }
  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      assert(
        !rectanglesOverlap(boxes[first].box, boxes[second].box),
        `${boxes[first].name} and ${boxes[second].name} overlap at ${size.label}`,
      );
    }
  }
  assert(
    !rectanglesOverlap(
      projectCenterBox,
      controls.find((entry) => entry.name === "episode selector").box,
    ),
    `Project-center entry and episode selector overlap at ${size.label}`,
  );
  const horizontal = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert(
    horizontal.scrollWidth <= horizontal.clientWidth,
    `Document horizontally overflows at ${size.label}: ${horizontal.scrollWidth} > ${horizontal.clientWidth}`,
  );
  const screenshot = join(evidenceDirectory, `viewport-${size.label}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const serviceIndicator = await page
    .locator(".demo-root .topbar .service-indicator")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        display: getComputedStyle(element).display,
        visibility: getComputedStyle(element).visibility,
      })),
    );
  await projectCenter.click();
  await page.getByRole("heading", { level: 1, name: "项目中心" }).waitFor();
  await returnToProjectHome(page, projectName);
  await waitForSelectedEpisode(page, createdEpisodes[1].id);
  return {
    size: { width: size.width, height: size.height },
    projectCenterBox,
    topbarControls: boxes,
    innerWindow,
    serviceIndicator,
    horizontal,
    minimumEpisodeControls,
    screenshot: relative(repositoryRoot, screenshot),
  };
}

async function verifyViewportControlsThenRestoreDefault(page, projectName, createdEpisodes) {
  const checks = [];
  for (const size of [defaultWindowSize, minimumWindowSize]) {
    checks.push(await assertViewportControls(page, size, projectName, createdEpisodes));
  }
  await setBrowserWindowSize(page, defaultWindowSize);
  return checks;
}

async function cleanup() {
  let closeError;
  try {
    if (!runState.closeAttempted) await normalClose("Electron cleanup normal close");
  } catch (error) {
    closeError = String(error);
  }
  if (!runState.profile) return;
  await mkdir(evidenceDirectory, { recursive: true });
  if (closeError || runState.preserveProfile) {
    await writeFile(
      join(evidenceDirectory, "cleanup.json"),
      `${JSON.stringify({ profileRemoved: false, profileRetained: true, closeError, preservedForBodyFailure: runState.preserveProfile }, null, 2)}\n`,
      "utf8",
    );
    if (closeError) throw new Error(closeError);
    return;
  }
  if (!ownsProfile(resolve(runState.profile)))
    throw new Error("Owned Electron profile escaped the controlled root");
  await rm(runState.profile, { recursive: true, force: false });
  await writeFile(
    join(evidenceDirectory, "cleanup.json"),
    `${JSON.stringify({ profileRemoved: true, profileRetained: false }, null, 2)}\n`,
    "utf8",
  );
}

const completed = await runDesktopProviderResult({
  writePath: resultPath,
  runId,
  body: async () => {
    try {
      const buildInputs = await buildInputHashes();
      await mkdir(profileRoot, { recursive: true });
      await mkdir(evidenceDirectory, { recursive: true });
      runState.profile = await mkdtemp(join(profileRoot, "c2-episode-ui-"));
      const suffix = runId.slice(0, 8);
      const projectAName = `C2 UI Project A ${suffix}`;
      const projectBName = `C2 UI Project B ${suffix}`;
      const episodeOneTitle = `C2 Episode One ${suffix}`;
      const episodeTwoTitle = `C2 Episode Two ${suffix}`;

      runState.phase = "launch-project-a";
      let page = await launch(runState.profile);
      const projectA = await createProjectThroughUi(page, projectAName);
      runState.phase = "verify-new-project-default";
      const defaultEpisodeTitle = await requireDefaultEpisodeVisibleThroughUi(page);
      const initialA = await readTopLevelEpisodes(page, projectA.id, []);
      assert(
        initialA.listedEpisodes.length === 1,
        "New project did not expose exactly its backend default episode before reselection",
      );
      assert(
        initialA.listedEpisodes[0]?.title === defaultEpisodeTitle,
        "UI default episode and preload default episode disagreed",
      );
      runState.phase = "create-project-a-episodes";
      await openProjectThroughUi(page, projectAName);
      await createEpisodeThroughUi(page, episodeOneTitle);
      await createEpisodeThroughUi(page, episodeTwoTitle);
      await page.getByLabel("剧集选择").selectOption({ label: episodeTwoTitle });
      await waitForSelectedEpisodeTitle(page, episodeTwoTitle);
      const beforeClose = await readTopLevelEpisodes(page, projectA.id, [
        episodeOneTitle,
        episodeTwoTitle,
      ]);
      assert(
        beforeClose.nodeGlobals.process === "undefined" &&
          beforeClose.nodeGlobals.require === "undefined",
        "Renderer exposed Node globals",
      );
      const secondEpisode = beforeClose.episodes.find(
        (episode) => episode.title === episodeTwoTitle,
      );
      assert(
        secondEpisode !== undefined,
        "Second UI-created episode was not readable before close",
      );
      assert(
        beforeClose.listedEpisodes.length === 3,
        "Project A did not contain one default and two uniquely created episodes",
      );
      assert(
        new Set(beforeClose.listedEpisodes.map((episode) => episode.id)).size === 3,
        "Project A episode list contains duplicate IDs",
      );
      const firstEpisode = beforeClose.episodes.find(
        (episode) => episode.title === episodeOneTitle,
      );
      assert(
        firstEpisode !== undefined,
        "First UI-created episode was not readable before viewport checks",
      );
      runState.phase = "verify-created-episodes-at-default-and-minimum-viewports";
      const viewportChecks = await verifyViewportControlsThenRestoreDefault(page, projectAName, [
        firstEpisode,
        secondEpisode,
      ]);
      await waitForSelectedEpisode(page, secondEpisode.id);

      runState.phase = "first-normal-close";
      await normalClose("Electron first normal close");
      const databaseRows = await inspectEpisodesReadOnly(
        join(runState.profile, "workspace", "workspace.sqlite3"),
        projectA.id,
      );
      assertSameEpisodes(beforeClose.listedEpisodes, databaseRows, "SQLite rows");

      runState.phase = "same-profile-reopen";
      page = await launch(runState.profile);
      await waitForProjectOption(page, projectAName);
      await waitForSelectedEpisode(page, secondEpisode.id);
      assert(
        (await page.getByLabel("剧集选择").inputValue()) === secondEpisode.id,
        "Same-profile reopen did not restore the exact second episode ID",
      );
      const afterReopen = await readTopLevelEpisodes(page, projectA.id, [
        episodeOneTitle,
        episodeTwoTitle,
      ]);
      assertSameEpisodes(
        beforeClose.listedEpisodes,
        afterReopen.listedEpisodes,
        "Same-profile reopen episodes",
      );
      assert(
        afterReopen.episodes.some(
          (episode) => episode.id === secondEpisode.id && episode.title === episodeTwoTitle,
        ),
        "Second episode identity did not survive reopen",
      );

      runState.phase = "create-project-b";
      await returnToProjectHome(page, projectAName);
      const projectB = await createProjectThroughUi(page, projectBName);
      await openProjectThroughUi(page, projectBName);
      await createEpisodeThroughUi(page, `C2 Episode B ${suffix}`);
      const projectBEpisodes = await readTopLevelEpisodes(page, projectB.id, [
        `C2 Episode B ${suffix}`,
      ]);
      assert(
        !projectBEpisodes.episodes.some((episode) => episode.project_id === projectA.id),
        "Project B displayed an episode from project A",
      );
      assert(
        projectBEpisodes.listedEpisodes.length === 2,
        "Project B did not retain one default and one created episode",
      );
      assert(
        !(await visibleEpisodeTitles(page)).some(
          (title) => title.includes(episodeOneTitle) || title.includes(episodeTwoTitle),
        ),
        "Project B UI leaked a Project A episode title",
      );

      runState.phase = "switch-back-project-a";
      await returnToProjectHome(page, projectBName);
      await openProjectThroughUi(page, projectAName);
      await page.getByRole("button", { name: episodeOneTitle, exact: true }).waitFor();
      await page.getByRole("button", { name: episodeTwoTitle, exact: true }).waitFor();
      const projectAAfterSwitch = await readTopLevelEpisodes(page, projectA.id, [
        episodeOneTitle,
        episodeTwoTitle,
      ]);
      assert(
        !projectAAfterSwitch.episodes.some((episode) => episode.project_id === projectB.id),
        "Project A displayed an episode from project B",
      );
      assert(
        !(await visibleEpisodeTitles(page)).some((title) =>
          title.includes(`C2 Episode B ${suffix}`),
        ),
        "Project A UI leaked a Project B episode title",
      );
      await page.getByLabel("剧集选择").selectOption(secondEpisode.id);
      await waitForSelectedEpisode(page, secondEpisode.id);

      const buildInputsAfter = await buildInputHashes();
      assert(
        JSON.stringify(buildInputs.sources) === JSON.stringify(buildInputsAfter.sources),
        "Production source hashes changed during the native run",
      );
      assert(
        JSON.stringify(buildInputs.desktopOutputTree) ===
          JSON.stringify(buildInputsAfter.desktopOutputTree),
        "Desktop output tree changed during the native run",
      );
      assert(
        JSON.stringify(buildInputs.webOutputTree) ===
          JSON.stringify(buildInputsAfter.webOutputTree),
        "Web output tree changed during the native run",
      );
      assert(
        buildInputs.runner === buildInputsAfter.runner,
        "Runner hash changed during the native run",
      );

      const evidence = {
        check: "desktop-episode-workspace-recovery",
        passed: true,
        buildInputs,
        isolatedProfile: true,
        realUiWritesOnly: true,
        actualTopLevelPreloadMethods: expectedEpisodeBridgeKeys,
        projectA: { id: projectA.id, name: projectAName },
        projectB: { id: projectB.id, name: projectBName },
        createdEpisodes: beforeClose.episodes,
        defaultEpisodeTitle,
        viewportChecks,
        sourceHashesUnchangedAfterNativeRun: true,
        sourceHashesAfterNativeRun: buildInputsAfter.sources,
        desktopOutputTreeUnchangedAfterNativeRun: true,
        webOutputTreeUnchangedAfterNativeRun: true,
        runnerHashUnchangedAfterNativeRun: true,
        databaseRows,
        restoredSecondEpisode: { id: secondEpisode.id, title: episodeTwoTitle },
        projectSwitchNoLeak: true,
        boundedNormalCloseEachPhase: true,
      };
      await writeEvidence(evidence);
      return evidence;
    } catch (error) {
      runState.preserveProfile = true;
      await captureFailure(error);
      throw error;
    }
  },
  cleanup,
});

process.stdout.write(
  `${JSON.stringify({ ...completed, resultPath, evidenceDirectory }, null, 2)}\n`,
);
