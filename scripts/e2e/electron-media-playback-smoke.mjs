import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const developmentRoot = join(repositoryRoot, ".aijian-dev");
const evidencePath = join(
  repositoryRoot,
  "docs",
  "quality",
  "evidence",
  "media-playback-electron.json",
);
const proxyPath = join(
  repositoryRoot,
  "services",
  "api",
  "tests",
  "fixtures",
  "media",
  "vfr-pattern-25fps-proxy.webm",
);
const proxyManifestPath = join(dirname(proxyPath), "proxy-manifest.json");
const electronExecutable = join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
  globalThis.process.platform === "win32" ? "electron.exe" : "electron",
);

async function closeElectronApplication(runningApplication) {
  if (!runningApplication) {
    return;
  }
  let timeout;
  try {
    await Promise.race([
      runningApplication.close(),
      new Promise((_, rejectClose) => {
        timeout = globalThis.setTimeout(
          () => rejectClose(new Error("Electron close timeout")),
          10_000,
        );
      }),
    ]);
  } catch (error) {
    runningApplication.process().kill();
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

await mkdir(developmentRoot, { recursive: true });
await rm(evidencePath, { force: true });
const profileDirectory = await mkdtemp(join(developmentRoot, "electron-media-profile-"));
const rendererDiagnostics = [];
let application;
let playbackFailure;
let closeFailure;
let profileCleanupFailure;
let evidence;
try {
  const proxyBytes = await readFile(proxyPath);
  const proxySha256 = createHash("sha256").update(proxyBytes).digest("hex");
  const proxyManifest = JSON.parse(await readFile(proxyManifestPath, "utf8"));
  if (proxySha256 !== proxyManifest.proxy_sha256) {
    throw new Error("Electron playback fixture hash differs from its manifest");
  }
  const verifiedProxyPath = join(profileDirectory, "verified-proxy.webm");
  const playbackHarnessPath = join(profileDirectory, "electron-media-playback.html");
  await writeFile(verifiedProxyPath, proxyBytes, { flag: "wx" });
  await chmod(verifiedProxyPath, 0o444);
  await writeFile(
    playbackHarnessPath,
    await readFile(join(scriptDirectory, "electron-media-playback.html")),
    { flag: "wx" },
  );
  const electronEnvironment = { ...globalThis.process.env };
  delete electronEnvironment.NODE_OPTIONS;
  delete electronEnvironment.NODE_PATH;
  delete electronEnvironment.ELECTRON_RUN_AS_NODE;
  electronEnvironment.AIJIAN_PLAYBACK_HARNESS_PATH = playbackHarnessPath;
  electronEnvironment.AIJIAN_PLAYBACK_PROFILE_ROOT = profileDirectory;
  application = await electron.launch({
    executablePath: electronExecutable,
    args: [
      join(scriptDirectory, "electron-media-playback-main.mjs"),
      `--user-data-dir=${profileDirectory}`,
    ],
    cwd: repositoryRoot,
    env: electronEnvironment,
    timeout: 30_000,
  });
  const page = await application.firstWindow({ timeout: 30_000 });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      rendererDiagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => rendererDiagnostics.push(`pageerror: ${error.message}`));

  await page.locator("#proxy").evaluate(async (video) => {
    if (!(video instanceof globalThis.HTMLVideoElement)) {
      throw new Error("proxy element is not a video");
    }
    if (video.readyState >= globalThis.HTMLMediaElement.HAVE_FUTURE_DATA) {
      return;
    }
    await new Promise((resolveCanPlay, rejectCanPlay) => {
      const timeout = globalThis.setTimeout(
        () => rejectCanPlay(new Error("canplay timeout")),
        15_000,
      );
      video.addEventListener(
        "canplay",
        () => {
          globalThis.clearTimeout(timeout);
          resolveCanPlay();
        },
        { once: true },
      );
      video.addEventListener(
        "error",
        () => {
          globalThis.clearTimeout(timeout);
          rejectCanPlay(new Error(`media error ${video.error?.code ?? "unknown"}`));
        },
        { once: true },
      );
    });
  });

  const beforePlayback = await page.locator("#proxy").evaluate(async (video) => {
    if (!(video instanceof globalThis.HTMLVideoElement)) {
      throw new Error("proxy element is not a video");
    }
    await video.play();
    return video.currentTime;
  });
  await page.waitForFunction(
    (start) => {
      const video = globalThis.document.querySelector("#proxy");
      return (
        video instanceof globalThis.HTMLVideoElement &&
        video.currentTime >= Math.max(start + 0.25, 1.45)
      );
    },
    beforePlayback,
    { timeout: 15_000 },
  );
  const firstAdvancedTime = await page
    .locator("#proxy")
    .evaluate((video) => (video instanceof globalThis.HTMLVideoElement ? video.currentTime : -1));

  const seekedTime = await page.locator("#proxy").evaluate(async (video) => {
    if (!(video instanceof globalThis.HTMLVideoElement)) {
      throw new Error("proxy element is not a video");
    }
    video.pause();
    const seeked = new Promise((resolveSeek, rejectSeek) => {
      const timeout = globalThis.setTimeout(() => rejectSeek(new Error("seeked timeout")), 15_000);
      video.addEventListener(
        "seeked",
        () => {
          globalThis.clearTimeout(timeout);
          resolveSeek();
        },
        { once: true },
      );
    });
    video.currentTime = 1.2;
    await seeked;
    if (!video.paused || Math.abs(video.currentTime - 1.2) > 0.05) {
      throw new Error(`seek validation failed at ${video.currentTime}`);
    }
    return video.currentTime;
  });
  await page.locator("#proxy").evaluate(async (video) => {
    if (!(video instanceof globalThis.HTMLVideoElement)) {
      throw new Error("proxy element is not a video");
    }
    await video.play();
  });
  await page.waitForFunction(
    (start) => {
      const video = globalThis.document.querySelector("#proxy");
      return video instanceof globalThis.HTMLVideoElement && video.currentTime >= start + 0.25;
    },
    seekedTime,
    { timeout: 15_000 },
  );

  const mediaState = await page.locator("#proxy").evaluate((video) => {
    if (!(video instanceof globalThis.HTMLVideoElement)) {
      throw new Error("proxy element is not a video");
    }
    return {
      currentTime: video.currentTime,
      duration: video.duration,
      readyState: video.readyState,
      networkState: video.networkState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      errorCode: video.error?.code ?? null,
    };
  });
  const versions = await application.evaluate(() => ({
    electron: globalThis.process.versions.electron,
    chrome: globalThis.process.versions.chrome,
  }));
  const stableProxySha256 = createHash("sha256")
    .update(await readFile(verifiedProxyPath))
    .digest("hex");
  const sourceProxySha256AfterPlayback = createHash("sha256")
    .update(await readFile(proxyPath))
    .digest("hex");
  if (
    mediaState.errorCode !== null ||
    mediaState.readyState < 3 ||
    mediaState.currentTime < Math.max(seekedTime + 0.25, 1.45) ||
    firstAdvancedTime < beforePlayback + 0.25 ||
    mediaState.videoWidth !== 160 ||
    mediaState.videoHeight !== 90 ||
    rendererDiagnostics.length !== 0
  ) {
    throw new Error(`Electron media playback validation failed: ${JSON.stringify(mediaState)}`);
  }
  if (stableProxySha256 !== proxySha256 || sourceProxySha256AfterPlayback !== proxySha256) {
    throw new Error("Electron playback fixture changed during playback");
  }

  evidence = {
    check: "phase0-electron-proxy-playback",
    passed: true,
    electronVersion: versions.electron,
    chromiumVersion: versions.chrome,
    canPlayReached: true,
    playbackAdvanced: true,
    seekAndResumePassed: true,
    verifiedStableCopyPlayed: true,
    postPlaybackHashVerified: true,
    playbackAdvanceThresholdSeconds: 0.25,
    seekTargetSeconds: 1.2,
    seekResumeThresholdSeconds: 1.45,
    seekResumeAdvanceThresholdSeconds: 0.25,
    durationSeconds: mediaState.duration,
    readyStateAtLeastHaveFutureData: true,
    mediaNetworkErrorFree: true,
    videoWidth: mediaState.videoWidth,
    videoHeight: mediaState.videoHeight,
    postWindowRendererDiagnostics: rendererDiagnostics,
    proxyFixture: "vfr-pattern-25fps-proxy.webm",
    proxyAssetSha256: `sha256:${proxySha256}`,
  };
} catch (error) {
  playbackFailure = error;
} finally {
  try {
    await closeElectronApplication(application);
  } catch (error) {
    closeFailure = error;
  }
  try {
    await rm(profileDirectory, { recursive: true, force: true });
  } catch (error) {
    profileCleanupFailure = error;
  }
}

const failures = [playbackFailure, closeFailure, profileCleanupFailure].filter(Boolean);
if (failures.length === 1) {
  throw failures[0];
}
if (failures.length > 1) {
  throw new AggregateError(failures, "Electron playback smoke and cleanup failed");
}
if (!evidence) {
  throw new Error("Electron playback smoke produced no evidence");
}
await mkdir(dirname(evidencePath), { recursive: true });
const temporaryEvidence = `${evidencePath}.${globalThis.process.pid}.tmp`;
try {
  await writeFile(temporaryEvidence, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryEvidence, evidencePath);
} finally {
  await rm(temporaryEvidence, { force: true });
}
globalThis.console.log(JSON.stringify(evidence));
