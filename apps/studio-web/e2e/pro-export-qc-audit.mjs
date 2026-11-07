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
import { progressStates } from "./pro-export-progress-cases.mjs";
import { featureStates } from "./pro-feature-cases.mjs";
import { creationStates } from "./pro-creation-cases.mjs";
import { assemblyStates } from "./pro-assembly-cases.mjs";
import { dialogueSplitStates } from "./pro-dialogue-split-cases.mjs";
import { audioGroupStates } from "./pro-audio-groups-cases.mjs";
import { shotAudioStates } from "./pro-shot-audio-cases.mjs";
import { audioMixStates } from "./pro-audio-mix-cases.mjs";
import { audioLibraryStates, libraryTargetDiagnostic } from "./pro-audio-library-cases.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const viewports = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];
const aspects = ["16:9", "9:16"];

function auditIdentity(kind) {
  if (kind === "assembly")
    return {
      title: "Pro common assembly audit",
      code: "PRO_ASSEMBLY",
      label: "Pro common assembly",
      file: "pro-assembly-audit.mjs",
      directory: "aivora-pro-assembly-audit",
    };
  if (kind === "dialogue-split")
    return {
      title: "Pro dialogue split audit",
      code: "PRO_DIALOGUE_SPLIT",
      label: "Pro dialogue split",
      file: "pro-dialogue-split-audit.mjs",
      directory: "aivora-pro-dialogue-split-audit",
    };
  if (kind === "audio-groups")
    return {
      title: "Pro audio groups audit",
      code: "PRO_AUDIO_GROUPS",
      label: "Pro audio groups",
      file: "pro-audio-groups-audit.mjs",
      directory: "aivora-pro-audio-groups-audit",
    };
  if (kind === "shot-audio")
    return {
      title: "Pro shot audio suggestions audit",
      code: "PRO_SHOT_AUDIO",
      label: "Pro shot audio suggestions",
      file: "pro-shot-audio-audit.mjs",
      directory: "aivora-pro-shot-audio-audit",
    };
  if (kind === "audio-library")
    return {
      title: "Pro audio library audit",
      code: "PRO_AUDIO_LIBRARY",
      label: "Pro audio library",
      file: "pro-audio-library-audit.mjs",
      directory: "aivora-pro-audio-library-audit",
    };
  if (kind === "audio-mix")
    return {
      title: "Pro audio mix audit",
      code: "PRO_AUDIO_MIX",
      label: "Pro audio mix",
      file: "pro-audio-mix-audit.mjs",
      directory: "aivora-pro-audio-mix-audit",
    };
  if (kind === "creation")
    return {
      title: "Pro creation audit",
      code: "PRO_CREATION",
      label: "Pro creation",
      file: "pro-creation-audit.mjs",
      directory: "aivora-pro-creation-audit",
    };
  if (kind === "features")
    return {
      title: "Pro feature audit",
      code: "PRO_FEATURE",
      label: "Pro features",
      file: "pro-feature-audit.mjs",
      directory: "aivora-pro-feature-audit",
    };
  return kind === "progress"
    ? {
        title: "Pro export progress audit",
        code: "EXPORT_PROGRESS",
        label: "Pro export progress",
        file: "pro-export-progress-audit.mjs",
        directory: "aivora-pro-export-progress-audit",
      }
    : {
        title: "Pro export QC audit",
        code: "EXPORT_QC",
        label: "Pro export QC",
        file: "pro-export-qc-audit.mjs",
        directory: "aivora-pro-export-qc-audit",
      };
}

function assemblyReadinessCopy(value) {
  if (!value || typeof value !== "object") return "";
  const count = (n) => (Number.isSafeInteger(n) && n >= 0 && n <= 4096 ? n : "unknown");
  const phase = ["scoped", "scope-changed", "native-changed"].includes(value.phase)
    ? value.phase
    : "unknown";
  return ` assemblyScope=${phase} assemblyGen=${count(value.generation)} saveTimersPending=${count(value.pendingTimers)} unboundSaveTimers=${count(value.unboundTimers)} writesPending=${count(value.pendingWrites)} nativePending=${count(value.pendingNative)} saving=${Number(value.saving === true)}`;
}

function assemblyInteractionCopy(row, profile) {
  if (profile.kind !== "assembly" || !row.assemblyInteraction) return "";
  const value = row.assemblyInteraction;
  const count = (n) => (Number.isSafeInteger(n) && n >= 0 && n <= 4096 ? n : "unknown");
  const flag = (v) => Number(v === true);
  return ` rangeEntered=${count(row.interactions?.entered?.range)} rangeBeforeMark=${count(row.interactions?.beforeMark?.range)} rangeAfterMark=${count(row.interactions?.afterMark?.range)} rangeNow=${count(value.range)} projectMenu=${flag(value.menu)} comparison=${flag(value.comparison)} monitorCurrent=${flag(value.currentMatched)} monitorAttribute=${flag(value.attributeMatched)} mediaCalls=${count(value.mediaCalls)} mediaCurrent=${flag(value.mediaCurrentMatched)} mediaAttribute=${flag(value.mediaAttributeMatched)} playRequests=${count(value.playRequests)} pauseRequests=${count(value.pauseRequests)} playing=${flag(value.playing)}`;
}

function emitGitHubErrors(report, profile) {
  const identity = auditIdentity(profile.kind);
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
    console.error(`::error title=${identity.title}::${identity.code}_SETUP_${phase}`);
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
    const states =
      profile.kind === "assembly"
        ? assemblyStates
        : profile.kind === "dialogue-split"
          ? dialogueSplitStates
          : profile.kind === "audio-groups"
            ? audioGroupStates
            : profile.kind === "shot-audio"
              ? shotAudioStates
              : profile.kind === "audio-library"
                ? audioLibraryStates
                : profile.kind === "audio-mix"
                  ? audioMixStates
                  : profile.kind === "creation"
                    ? creationStates
                    : profile.kind === "features"
                      ? featureStates
                      : profile.kind === "progress"
                        ? progressStates
                        : qcStates;
    const state = states.includes(row.page) ? row.page : "unknown";
    const safeCombination =
      /^(1280x800|1920x1080)-(16x9|9x16)-/.test(row.combination) &&
      states.some(
        (name) => row.combination === `${row.combination.split("-").slice(0, 2).join("-")}-${name}`,
      );
    const combination = safeCombination ? row.combination : "unknown";
    const found = [
      ...new Set(
        (row.geometry?.issues ?? []).map((issue) =>
          kinds.has(issue.kind) ? issue.kind : "unknown",
        ),
      ),
    ];
    const controls = new Set([
      "timeline-play",
      "timeline-pause",
      "timeline-mark-in",
      "timeline-mark-out",
      "timeline-video",
      "dialogue-split-open",
      "dialogue-split-refresh",
      "dialogue-split-apply",
      "dialogue-split-accept",
      "dialogue-split-recover",
      "dialogue-split-conflict",
      "dialogue-split-adopt",
      "dialogue-split-memo",
      "dialogue-split-copy",
      "dialogue-split-pending",
      "shot-audio-open",
      "shot-audio-refresh",
      "shot-audio-apply",
      "shot-audio-lane-ambience",
      "shot-audio-lane-sfx",
      "shot-audio-lane-score",
      "shot-audio-remove-group",
      "library-open",
      "library-add",
      "library-target-refresh",
      "library-search",
      "library-lane",
      "library-duration",
      "library-start",
      "library-offset",
      "library-gain",
      "library-loop",
      "library-recover",
      "library-conflict",
      "library-adopt-saved",
      "library-draft-memo",
      "library-remove",
      "library-pending",
      "library-asset",
      "mix-dialogue-volume",
      "mix-dialogue-mute",
      "mix-dialogue-solo",
      "mix-ambience-volume",
      "mix-ambience-mute",
      "mix-ambience-solo",
      "mix-sfx-volume",
      "mix-sfx-mute",
      "mix-sfx-solo",
      "mix-score-volume",
      "mix-score-mute",
      "mix-score-solo",
      "mix-preview-retry",
      "video-organize",
      "video-confirm",
      "video-review-close",
      "video-prompt-text",
      "archive-export",
      "archive-import",
      "archive-open-menu",
      "archive-export-menu",
      "work-menu",
      "work-other-episode",
      "video-picture",

      "review-publish",
      "review-cancel",
      "dialog-close",
      "prepare-check",
      "cover-edit",
      "advanced",
      "subtitle-burn",
      "subtitle-srt",
      "subtitle-none",
      "request-stop",
      "request-pending",
      "export-quality",
      "export-aspect",
      "export-dir",
      "waveform-refresh",
      "waveform-loading",
      "timeline-regenerate",
      "timeline-voice",
      "timeline-cut",
      "timeline-clear-selection",
      "timeline-zoom-in",
      "timeline-zoom-out",
      "shot-description",
      "music-import",
    ]);
    const tags = new Set([
      "BUTTON",
      "INPUT",
      "SELECT",
      "TEXTAREA",
      "SUMMARY",
      "DIV",
      "SPAN",
      "P",
      "SECTION",
      "ASIDE",
      "FOOTER",
      "HEADER",
      "MAIN",
      "LABEL",
      "H1",
      "H2",
      "H3",
      "PROGRESS",
      "BODY",
      "HTML",
    ]);
    const classes = new Set([
      "shot-audio-suggestions",
      "shot-audio-lane",
      "shot-audio-envelope",
      "shot-audio-groups",
      "dialogue-split-dialog",
      "dialogue-split-actions",
      "bundled-audio-dialog",
      "bundled-audio-list",
      "bundled-audio-body",
      "nx-video-review",
      "nx-video-model",
      "nx-video-facts",
      "project-archive",
      "pgroup",
      "acts",
      "dialog",
      "export",
      "dialog-back",
      "nx-export-foot",
      "nx-export",
      "nx-export-cols",
      "nx-export-side",
      "nx-panel",
      "nx-panel-body",
      "nx-panel-head",
      "nx-export-issues",
      "nx-export-state",
      "nx-export-progress",
      "nx-primary",
      "nx-btn",
      "btn",
      "primary",
      "sp",
      "nx-adv",
      "nx-scroll",
      "nx-export-facts",
      "ws",
      "fix",
      "edit",
      "pane",
      "pb",
      "sheet",
      "field",
      "monitor",
      "timeline",
      "ttool",
      "tbody",
      "tracks",
      "bin",
    ]);
    const number = (value) =>
      typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000
        ? String(Math.round(value * 10) / 10)
        : "unknown";
    const rect = (value) => [value?.x, value?.y, value?.width, value?.height].map(number).join(",");
    const details = (row.geometry?.issues ?? [])
      .filter(
        (issue) =>
          issue.kind === "covered-center" ||
          ([
            "features",
            "creation",
            "audio-mix",
            "audio-library",
            "shot-audio",
            "audio-groups",
            "dialogue-split",
            "assembly",
          ].includes(profile.kind) &&
            issue.kind === "control-clipped-without-scroll"),
      )
      .slice(0, 2)
      .map((issue, index) => {
        const d = issue.diagnostic ?? {};
        const safeControl = controls.has(d.control) ? d.control : "other";
        const safeTag = tags.has(d.tag) ? d.tag : "OTHER";
        const hitTag = tags.has(d.hitTag) ? d.hitTag : "OTHER";
        const hitClasses = Array.isArray(d.hitClasses)
          ? d.hitClasses
              .filter((name) => classes.has(name))
              .slice(0, 3)
              .join(".")
          : "";
        if (issue.kind === "control-clipped-without-scroll") {
          const clipTag = tags.has(d.clipTag) ? d.clipTag : "OTHER";
          const clipClasses = Array.isArray(d.clipClasses)
            ? d.clipClasses
                .filter((name) => classes.has(name))
                .slice(0, 3)
                .join(".")
            : "";
          return ` control${index + 1}=${safeControl} tag${index + 1}=${safeTag} clip${index + 1}=${clipTag}.${clipClasses || "other"} box${index + 1}=${rect(issue.box)} clipBox${index + 1}=${rect(d.clipBox)} scroll${index + 1}=${Number(d.scrollX === true)},${Number(d.scrollY === true)}`;
        }
        return ` control${index + 1}=${safeControl} tag${index + 1}=${safeTag} hit${index + 1}=${hitTag}.${hitClasses || "other"} box${index + 1}=${rect(issue.box)} visible${index + 1}=${rect(d.visible)} hitBox${index + 1}=${rect(d.hitBox)} point${index + 1}=${number(d.point?.x)},${number(d.point?.y)} scroll${index + 1}=${Number(d.scrollX === true)},${Number(d.scrollY === true)}`;
      })
      .join("");
    const metrics = row.geometry?.scopeMetrics;
    const scopeScroll = metrics
      ? ` scopeScroll=${number(metrics.scrollTop)},${number(metrics.clientHeight)},${number(metrics.scrollHeight)}`
      : "";
    const checkLine = [
      "features",
      "creation",
      "audio-mix",
      "audio-library",
      "shot-audio",
      "audio-groups",
      "dialogue-split",
      "assembly",
    ].includes(profile.kind)
      ? ` checkLine=${Number.isSafeInteger(row.checkLine) && row.checkLine >= 1 && row.checkLine <= 100000 ? row.checkLine : "unknown"}`
      : "";
    const reach =
      ["creation", "audio-library"].includes(profile.kind) && controls.has(row.failedControl)
        ? ` reachControl=${row.failedControl} reachBox=${rect(row.reachability?.at(-1)?.box)}`
        : "";
    console.error(
      `::error title=${identity.title}::${identity.code}_AUDIT combination=${combination} state=${state} reached=${Number(row.reached)} kinds=${found.join(",") || "assertion"}${checkLine}${details}${reach}${scopeScroll}${assemblyReadinessCopy(row.assemblyReadiness)}${assemblyInteractionCopy(row, profile)}${profile.kind === "audio-library" ? libraryTargetDiagnostic(row.targetReadiness) : ""}`,
    );
  }
}

function options(profile) {
  const value = {
    url: process.env.AIVORA_AUDIT_URL,
    browser: process.env.AIVORA_CHROMIUM,
    out: process.env.AIVORA_AUDIT_OUT ?? path.join(tmpdir(), auditIdentity(profile.kind).directory),
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

async function run(config, profile) {
  await checkOutputTarget(config.out);
  await mkdir(config.out, { recursive: true });
  const report = {
    scope:
      profile.kind === "assembly"
        ? "Real ProWorkspace shared assembly, actual-clock calculations, retained partial, cancellation/revision and missing-session-clock guards with synthetic native ABI and controlled DOM media metadata/request spies; no codec, actual file/mixing/listening or Electron assertion"
        : profile.kind === "dialogue-split"
          ? "Real ProWorkspace complete native-plan review, explicit structural acceptance and global unknown/backup guards with synthetic native ABI; no actual filesystem/history-byte/decoding/provider/listening/Electron assertion"
          : profile.kind === "audio-groups"
            ? "Real ProWorkspace complete-lane explicit selection, group-reference removal and global unknown recovery with synthetic native ABI; no filesystem, decoding, listening, paid provider or Electron assertion"
            : profile.kind === "shot-audio"
              ? "Real ProWorkspace read-only shot audio suggestions with complete synthetic native segments, envelopes and notes; no copy/apply/filesystem/decoding/listening/Electron assertion"
              : profile.kind === "audio-library"
                ? "Real ProWorkspace local catalog selection, target clock, add/remove and global save recovery with real public catalog metadata and synthetic native ABI; no filesystem/decoding/listening/Electron assertion"
                : profile.kind === "audio-mix"
                  ? "Real ProWorkspace four-lane settings, solo/QC input and preview admission with synthetic native metadata and PCM silence; no provider, real export/mixing or listening-quality assertion"
                  : profile.kind === "creation"
                    ? "Real ProWorkspace seven-part text confirmation and project-archive menus with synthetic native ABI; no provider, real ZIP/file or Electron assertion"
                    : profile.kind === "features"
                      ? "Real ProWorkspace Cast field proposals, edit source-waveform and persistent-history UI with synthetic text/IPC metadata; no provider, decode, file or Electron assertion"
                      : profile.kind === "progress"
                        ? "Real ProWorkspace export progress/cancellation with synthetic events; no PID/file/provider/Electron assertion"
                        : "Real ProWorkspace export→QC review with synthetic IPC; no real export/provider/Electron assertion",
    expectedStates: profile.states,
    ...([
      "creation",
      "audio-mix",
      "audio-library",
      "shot-audio",
      "audio-groups",
      "dialogue-split",
      "assembly",
    ].includes(profile.kind)
      ? {
          expectedResults:
            (profile.kind === "assembly"
              ? assemblyStates
              : profile.kind === "dialogue-split"
                ? dialogueSplitStates
                : profile.kind === "audio-groups"
                  ? audioGroupStates
                  : profile.kind === "shot-audio"
                    ? shotAudioStates
                    : profile.kind === "audio-library"
                      ? audioLibraryStates
                      : profile.kind === "audio-mix"
                        ? audioMixStates
                        : creationStates
            ).length *
            viewports.length *
            aspects.length,
        }
      : {}),
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
          "apps/studio-web/e2e/pro-assembly-fixture.mjs",
          "apps/studio-web/e2e/pro-assembly-assertions.mjs",
          "apps/studio-web/src/aivora/pro/assembly.ts",
          "apps/studio-web/src/aivora/pro/workflow.ts",
          "apps/studio-web/src/aivora/pro/edit-timeline.ts",
          "apps/studio-web/src/aivora/pro/use-audio-mix-preview.ts",
          "apps/studio-web/src/aivora/pro/audio-mix-preview-key.ts",
          "apps/studio-web/src/aivora/pro/use-audio-waveforms.ts",
          "apps/studio-web/src/api/studio.ts",
          "apps/desktop/src/film-assembly-ipc.ts",
          "apps/desktop/src/preload.ts",
          "apps/desktop/src/film-audio-mix-sources.ts",
          "apps/desktop/src/film-audio-mix.ts",
          "packages/aivora-media/media.mjs",
          "apps/desktop/src/film-assembly.ts",
          "packages/contracts/src/film-assembly.ts",
          ...(profile.kind === "assembly"
            ? [
                "apps/studio-web/e2e/pro-assembly-audit.mjs",
                "apps/studio-web/e2e/pro-assembly-cases.mjs",
              ]
            : []),
          ...(profile.kind === "features"
            ? [
                "apps/studio-web/src/aivora/pro/actions/art-style-field-rows.ts",
                "apps/studio-web/src/aivora/next/SuggestionFieldDiff.tsx",
                "apps/studio-web/src/aivora/next/SuggestionFieldDiff.css",
                "apps/studio-web/src/aivora/next/SuggestionCard.tsx",
                "apps/studio-web/src/aivora/next/SuggestionCard.css",
                "apps/studio-web/src/aivora/pro/use-audio-waveforms.ts",
                "apps/studio-web/src/aivora/pro/actions/audio-waveforms.ts",
                "apps/studio-web/src/aivora/film/audio.ts",
                "apps/studio-web/src/aivora/film/audio-waveform-data.ts",
                "packages/contracts/src/film-audio-waveform.ts",
                "apps/studio-web/src/aivora/next/HistoryList.tsx",
                "apps/studio-web/src/aivora/next/HistoryList.css",
                "apps/studio-web/src/aivora/pro/actions/persistent-history.ts",
                "packages/contracts/src/film-history.ts",
              ]
            : []),
          ...(profile.kind === "creation"
            ? [
                "apps/studio-web/src/aivora/film/seven-part-video.ts",
                "apps/studio-web/src/aivora/film/operations.ts",
                "apps/studio-web/src/aivora/film/project.ts",
                "apps/studio-web/src/aivora/next/SevenPartVideoReview.tsx",
                "apps/studio-web/src/aivora/next/SevenPartVideoReview.css",
                "apps/studio-web/src/aivora/next/SuggestionFieldDiff.tsx",
                "apps/studio-web/src/aivora/next/SuggestionFieldDiff.css",
                "apps/studio-web/src/aivora/pro/actions/editor-host.ts",
                "apps/studio-web/src/aivora/pro/actions/editor-changes.ts",
                "apps/studio-web/src/aivora/pro/actions/video-prompt-review.ts",
                "apps/studio-web/src/aivora/pro/actions/project-archive.ts",
                "apps/studio-web/src/aivora/pro/ProjectArchiveDialog.tsx",
                "apps/studio-web/src/aivora/pro/ProjectArchiveDialog.css",
                "apps/studio-web/src/api/studio.ts",
                "apps/desktop/src/film-project-archive.ts",
                "apps/desktop/src/main.ts",
                "apps/desktop/src/preload.ts",
                "packages/aivora-media/archive.mjs",
                "apps/studio-web/src/aivora/pro/film-persistence.ts",
                "apps/desktop/src/film-project-archive-runtime.ts",
                "packages/contracts/src/film-project-archive.ts",
                "apps/studio-web/e2e/pro-creation-cases.mjs",
                "apps/studio-web/e2e/pro-creation-fixture.mjs",
              ]
            : []),
          ...(["shot-audio", "audio-groups"].includes(profile.kind)
            ? [
                "apps/desktop/src/main.ts",
                "apps/desktop/src/preload.ts",
                "apps/desktop/src/film-audio-library.ts",
                "apps/desktop/src/film-audio-library-runtime.ts",
                "apps/desktop/src/film-shot-audio-suggestions.ts",
                "packages/contracts/src/film-audio-library.ts",
                "packages/contracts/src/film-audio-mix-plan.js",
                "apps/studio-web/src/aivora/pro/AudioSuggestionGroups.tsx",
                "apps/studio-web/src/aivora/pro/actions/shot-audio-apply.ts",
                "apps/studio-web/src/aivora/pro/actions/audio-suggestion-proof.ts",
                "apps/studio-web/src/aivora/pro/actions/audio-library.ts",
                "apps/studio-web/src/aivora/pro/use-bundled-audio-library.tsx",
                "packages/contracts/src/film-audio-suggestion-group.js",
                "apps/studio-web/src/aivora/pro/ShotAudioSuggestionDialog.tsx",
                "apps/studio-web/src/aivora/pro/ShotAudioSuggestionDialog.css",
                "apps/studio-web/src/aivora/pro/use-shot-audio-suggestions.tsx",
                "apps/studio-web/src/aivora/pro/actions/shot-audio-suggestions.ts",
                "apps/studio-web/src/aivora/pro/actions/persistent-history.ts",
                "apps/studio-web/src/aivora/pro/film-persistence.ts",
                "assets/audio-library/manifest.json",
                "apps/studio-web/e2e/pro-shot-audio-audit.mjs",
                "apps/studio-web/e2e/pro-export-qc-audit.mjs",
                "apps/studio-web/e2e/pro-layout-probe.mjs",
                "apps/studio-web/e2e/pro-shot-audio-cases.mjs",
                "apps/studio-web/e2e/pro-shot-audio-fixture.mjs",
              ]
            : []),
          ...(profile.kind === "dialogue-split"
            ? [
                "apps/studio-web/e2e/pro-dialogue-split-audit.mjs",
                "apps/studio-web/e2e/pro-dialogue-split-cases.mjs",
                "apps/studio-web/e2e/pro-dialogue-split-fixture.mjs",
                "apps/studio-web/e2e/pro-dialogue-split-browser-helper.mjs",
                "apps/studio-web/src/aivora/pro/DialogueSplitDialog.tsx",
                "apps/studio-web/src/aivora/pro/DialogueSplitDialog.css",
                "apps/studio-web/src/aivora/pro/use-dialogue-split.tsx",
                "apps/studio-web/src/aivora/pro/actions/dialogue-split-native.ts",
                "apps/studio-web/src/aivora/pro/actions/dialogue-split.ts",
                "apps/studio-web/src/aivora/pro/actions/dialogue-limit-session.ts",
                "apps/studio-web/src/aivora/pro/film-persistence.ts",
                "apps/studio-web/src/aivora/pro/actions/persistent-history.ts",
                "apps/desktop/src/film-dialogue-split.ts",
                "apps/desktop/src/film-dialogue-split-ipc.ts",
                "apps/desktop/src/film-history.ts",
                "apps/desktop/src/film-library.ts",
                "apps/desktop/src/main.ts",
                "apps/desktop/src/preload.ts",
                "packages/contracts/src/film-dialogue-split-plan.js",
                "packages/contracts/src/film-dialogue-split-plan.d.ts",
                "packages/contracts/src/film-dialogue-split.ts",
                "packages/contracts/src/film-history.ts",
              ]
            : []),
          ...(profile.kind === "audio-groups"
            ? [
                "apps/studio-web/e2e/pro-audio-groups-audit.mjs",
                "apps/studio-web/e2e/pro-audio-groups-cases.mjs",
                "apps/studio-web/e2e/pro-audio-groups-fixture.mjs",
                "apps/studio-web/e2e/pro-audio-groups-browser-helper.mjs",
              ]
            : []),
          ...(profile.kind === "audio-library"
            ? [
                "apps/desktop/src/main.ts",
                "apps/desktop/src/preload.ts",
                "apps/studio-web/src/aivora/pro/use-audio-mix-preview.ts",
                "packages/contracts/src/film-audio-mix.ts",
                "packages/contracts/src/film-audio-mix-plan.js",
                "apps/studio-web/src/aivora/pro/BundledAudioDialog.tsx",
                "apps/studio-web/src/aivora/pro/BundledAudioDialog.css",
                "apps/studio-web/src/aivora/pro/use-bundled-audio-library.tsx",
                "apps/studio-web/src/aivora/pro/actions/audio-library.ts",
                "apps/studio-web/src/aivora/pro/actions/persistent-history.ts",
                "apps/studio-web/src/aivora/pro/film-persistence.ts",
                "apps/studio-web/src/aivora/film/audio.ts",
                "apps/desktop/src/film-audio-library.ts",
                "apps/desktop/src/film-audio-library-runtime.ts",
                "packages/contracts/src/film-audio-library.ts",
                "assets/audio-library/manifest.json",
                "apps/studio-web/e2e/pro-audio-library-cases.mjs",
                "apps/studio-web/e2e/pro-audio-library-fixture.mjs",
              ]
            : []),
          ...(profile.kind === "audio-mix"
            ? [
                "apps/desktop/src/main.ts",
                "apps/desktop/src/preload.ts",
                "apps/studio-web/src/aivora/pro/workflow.ts",
                "apps/studio-web/src/aivora/film/operations.ts",
                "apps/studio-web/src/aivora/pro/AudioLaneControls.tsx",
                "apps/studio-web/src/aivora/pro/AudioMixPreview.tsx",
                "apps/studio-web/src/aivora/pro/use-audio-mix-preview.ts",
                "apps/studio-web/src/aivora/pro/audio-mix-timeline.ts",
                "apps/studio-web/src/aivora/pro/actions/persistent-history.ts",
                "apps/studio-web/src/aivora/pro/film-persistence.ts",
                "apps/studio-web/src/aivora/film/audio.ts",
                "apps/desktop/src/film-audio-mix.ts",
                "apps/desktop/src/film-audio-mix-sources.ts",
                "packages/contracts/src/film-audio-mix.ts",
                "packages/contracts/src/film-audio-mix-plan.js",
                "apps/studio-web/e2e/pro-audio-mix-cases.mjs",
                "apps/studio-web/e2e/pro-audio-mix-fixture.mjs",
              ]
            : []),
          ...(profile.kind === "progress"
            ? [
                "apps/studio-web/src/aivora/next/ExportProgress.tsx",
                "apps/studio-web/src/aivora/next/ExportProgress.css",
                "apps/studio-web/src/aivora/pro/actions/export-progress.ts",
              ]
            : []),
        ].map(async (name) => [
          name,
          createHash("sha256")
            .update(await readFile(path.join(repoRoot, name)))
            .digest("hex"),
        ]),
      ),
    );
    const returnedExpected = await profile.runCases({ browser, config, report, media, persist });
    const expected =
      profile.kind === "assembly"
        ? assemblyStates.length * viewports.length * aspects.length
        : profile.kind === "dialogue-split"
          ? dialogueSplitStates.length * viewports.length * aspects.length
          : profile.kind === "audio-groups"
            ? audioGroupStates.length * viewports.length * aspects.length
            : profile.kind === "shot-audio"
              ? shotAudioStates.length * viewports.length * aspects.length
              : profile.kind === "audio-library"
                ? audioLibraryStates.length * viewports.length * aspects.length
                : profile.kind === "audio-mix"
                  ? audioMixStates.length * viewports.length * aspects.length
                  : profile.kind === "creation"
                    ? creationStates.length * viewports.length * aspects.length
                    : returnedExpected;
    report.expectedResults = expected;
    report.exitCode =
      returnedExpected === expected &&
      report.results.length === expected &&
      report.results.every((row) => row.passed)
        ? 0
        : 1;
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
    `${auditIdentity(profile.kind).label}: ${report.results.filter((row) => row.passed).length}/${report.results.length}; report ${path.join(config.out, "report.json")}`,
  );
  emitGitHubErrors(report, profile);
  return report.exitCode;
}

/** Shared safe server/browser lifecycle. Importing this module does not launch an audit. */
export async function runAuditCli(
  profile = { kind: "qc", states: qcStates, runCases: runQcCases },
) {
  const identity = auditIdentity(profile.kind);
  try {
    const config = options(profile);
    if (!config)
      console.log(
        `Usage: node apps/studio-web/e2e/${identity.file} [--url http://127.0.0.1:5173/] [--browser /path/to/chromium] [--out temp-or-.aijian-dev-directory]\n${profile.kind === "assembly" ? "Shared assembly native host" : profile.kind === "dialogue-split" ? "Dialogue split native-review host" : profile.kind === "audio-groups" ? "Audio groups execution host" : profile.kind === "shot-audio" ? "Shot audio suggestions host" : profile.kind === "audio-library" ? "Audio library host" : profile.kind === "audio-mix" ? "Audio mix host" : profile.kind === "creation" ? "Creation host" : profile.kind === "features" ? "Feature host" : profile.kind === "progress" ? "Progress host" : "QC host"}: ${profile.states.length} states × 4 viewport/aspect combinations (${profile.states.length * 4} expected). Without --url, starts and closes an in-process Vite server. Exit: 0 passed; 1 audit regression; 2 setup/usage error. Chromium sandbox is always enabled.`,
      );
    else process.exitCode = await run(config, profile);
  } catch (error) {
    if (process.env.GITHUB_ACTIONS === "true")
      console.error(`::error title=${identity.title}::${identity.code}_CONFIGURATION`);
    else console.error(error.message);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runAuditCli();
