/* C3 normal-path native evidence runner.  Authoring is intentionally static-only. */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import {
  lstat,
  realpath,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rename,
} from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { _electron as electron } from "playwright-core";

const runnerRequire = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const runId = `c3-native-normal-${Date.now()}-${process.pid}-${randomUUID()}`;
const evidence = join(root, ".aijian-dev", "c3-native-normal", runId);
const desktop = join(root, "apps", "desktop");
const web = join(root, "apps", "studio-web");
const electronPath = join(desktop, "node_modules", "electron", "dist", "electron.exe");
const python = join(root, ".venv", "Scripts", "python.exe");
const pwsh =
  "C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe";
const CLOSE_TIMEOUT_MS = 10_000;
const controllerAudit =
  "C:/Users/Administrator/.codex/worktrees/fb64/sp/.aijian-dev/controller-audit-20260910";
const nodeExecutable = "C:/Program Files/nodejs/node.exe";
const sourceDirectories = [
  ["apps/desktop/src", [".ts"]],
  ["apps/studio-web/src", [".ts", ".tsx", ".css"]],
  ["services/api/src/aijian_api", [".py"]],
];
const requiredSourceInputs = [
  "apps/desktop/package.json",
  "apps/desktop/tsconfig.json",
  "apps/studio-web/package.json",
  "apps/studio-web/tsconfig.json",
  "apps/studio-web/index.html",
  "apps/studio-web/tsconfig.app.json",
  "apps/studio-web/tsconfig.node.json",
  "apps/studio-web/vite.config.ts",
  "packages/contracts/src/generated.ts",
  "packages/contracts/openapi.json",
  "scripts/e2e/electron-c3-native-readiness.mjs",
];
const sha = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
function rejectUnsafeEnvironment(env) {
  for (const [key, value] of Object.entries(env))
    if (
      (/^AIJIAN_E2E_.*FAULT/i.test(key) && String(value).trim()) ||
      /aivora-app-ui/i.test(String(value))
    )
      throw new Error("unsafe inherited mode: " + key);
  assert(!process.argv.some((arg) => /aivora-app-ui/i.test(arg)), "demo bypass forbidden");
}
async function launchProfile(profile, lifecycle) {
  rejectUnsafeEnvironment(process.env);
  assert(
    resolve(profile).startsWith(resolve(root, ".aijian-dev") + "/") ||
      resolve(profile).startsWith(resolve(root, ".aijian-dev") + "\\"),
  );
  const args = [desktop, "--user-data-dir=" + profile];
  lifecycle.launch = {
    profile,
    args,
    executablePath: electronPath,
    cwd: root,
    started: new Date().toISOString(),
  };
  const app = await electron.launch({
    executablePath: electronPath,
    args,
    cwd: root,
    env: { ...process.env, AIJIAN_E2E_USER_DATA_DIR: profile },
    timeout: 30000,
  });
  lifecycle.launcherPid = app.process().pid;
  assert(Number.isInteger(lifecycle.launcherPid) && lifecycle.launcherPid > 0);
  return app;
}
async function write(name, value) {
  await writeFile(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
}
async function hashes(path) {
  const entries = await readdir(path, { recursive: true, withFileTypes: true });
  const output = {};
  for (const entry of entries)
    if (entry.isFile()) {
      const absolute = join(entry.parentPath, entry.name);
      output[absolute.slice(path.length + 1).replaceAll("\\", "/")] = await sha(absolute);
    }
  return output;
}
async function sourceSnapshot(paths) {
  const result = {};
  for (const path of [...paths].sort()) result[path] = await sha(join(root, path));
  return result;
}
function freezeDeep(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}
async function recordedCommand(label, command, args, cwd) {
  const begun = new Date().toISOString();
  let result;
  try {
    result = await child(command, args, cwd);
  } catch (error) {
    result = { code: null, stdout: "", stderr: String(error.stack ?? error) };
  }
  await writeFile(join(evidence, label + ".stdout.txt"), result.stdout);
  await writeFile(join(evidence, label + ".stderr.txt"), result.stderr);
  await write(label + ".command.json", {
    runId,
    begun,
    ended: new Date().toISOString(),
    command,
    args,
    cwd,
    exit: result.code,
  });
  assert.equal(result.code, 0, label + " failed; raw output preserved");
  return result;
}
async function verifyAcceptedSourcesAndBuild() {
  rejectUnsafeEnvironment(process.env);
  const manifests = [
    {
      path: join(controllerAudit, "c3-g1-final-combined-20260915/root-thirteen-hashes.json"),
      sha256: "C9D87199A4E3ED433657A3A0DD236AEFFC7B9C71515CB331F798997CB7EAC1D2",
      count: 13,
      field: "sha256",
    },
    {
      path: join(
        controllerAudit,
        "c6-e3-coverage-behavior-20260915/root-pre-freeze-23-hashes.json",
      ),
      sha256: "A0C752BDFB4D3C4B4723E55CB9FC51144322F4311C1C04D001B98B994ECF60CC",
      count: 23,
      field: "current",
    },
  ];
  const expected = new Map();
  for (const manifest of manifests) {
    assert.equal(
      (await sha(manifest.path)).toUpperCase(),
      manifest.sha256,
      "acceptance manifest changed",
    );
    const rows = JSON.parse((await readFile(manifest.path, "utf8")).replace(/^\uFEFF/, ""));
    assert(Array.isArray(rows));
    assert.equal(rows.length, manifest.count);
    assert.equal(new Set(rows.map((row) => row.path)).size, manifest.count);
    for (const row of rows) {
      assert(
        typeof row.path === "string" &&
          !row.path.includes("..") &&
          !/^[\\/]|^[A-Za-z]:/.test(row.path),
      );
      assert.match(row[manifest.field], /^[0-9a-f]{64}$/i);
      assert(!expected.has(row.path), "duplicate across accepted source sets");
      expected.set(row.path, row[manifest.field].toLowerCase());
    }
  }
  const paths = new Set([...expected.keys(), ...requiredSourceInputs]);
  for (const [directory, extensions] of sourceDirectories) {
    for (const entry of await readdir(join(root, directory), {
      recursive: true,
      withFileTypes: true,
    }))
      if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)))
        paths.add(
          join(entry.parentPath, entry.name)
            .slice(root.length + 1)
            .replaceAll("\\", "/"),
        );
  }
  const sources = await sourceSnapshot(paths);
  for (const [path, expectedHash] of expected)
    assert.equal(sources[path], expectedHash, "accepted source drift: " + path);
  const head = (
    await recordedCommand("git-head-before", "git", ["rev-parse", "HEAD"], root)
  ).stdout.trim();
  const runtimes = {
    node: (
      await recordedCommand("node-version", nodeExecutable, ["--version"], root)
    ).stdout.trim(),
    python: (await recordedCommand("python-version", python, ["--version"], root)).stdout.trim(),
    electron: JSON.parse(
      await readFile(join(desktop, "node_modules/electron/package.json"), "utf8"),
    ).version,
    playwright: JSON.parse(
      await readFile(runnerRequire.resolve("playwright-core/package.json"), "utf8"),
    ).version,
    playwrightResolvedFromRunner: await realpath(runnerRequire.resolve("playwright-core")),
    playwrightCoreBundle: {
      path: await realpath(
        join(dirname(runnerRequire.resolve("playwright-core")), "lib/coreBundle.js"),
      ),
      sha256: await sha(
        await realpath(
          join(dirname(runnerRequire.resolve("playwright-core")), "lib/coreBundle.js"),
        ),
      ),
    },
    runnerNode: { executable: process.execPath, version: process.version },
    typescript: JSON.parse(
      await readFile(join(web, "node_modules/typescript/package.json"), "utf8"),
    ).version,
    vite: JSON.parse(await readFile(join(web, "node_modules/vite/package.json"), "utf8")).version,
    executable: nodeExecutable,
    platform: process.platform,
    arch: process.arch,
  };
  await write("sources-before-build.json", { runId, head, runtimes, manifests, sources });
  await recordedCommand(
    "web-tsc",
    nodeExecutable,
    [join(web, "node_modules/typescript/bin/tsc"), "-b"],
    web,
  );
  await recordedCommand(
    "web-vite",
    nodeExecutable,
    [join(web, "node_modules/vite/bin/vite.js"), "build"],
    web,
  );
  await recordedCommand(
    "desktop-tsc",
    nodeExecutable,
    [join(desktop, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    desktop,
  );
  const postSources = await sourceSnapshot(paths);
  await write("sources-after-build.json", postSources);
  assert.deepEqual(postSources, sources, "source changed during build");
  const baseline = {
    runId,
    head,
    runtimes,
    manifests,
    sources,
    webDist: await hashes(join(web, "dist")),
    desktopDist: await hashes(join(desktop, "dist")),
  };
  assert(Object.keys(baseline.webDist).length && Object.keys(baseline.desktopDist).length);
  await write("accepted-source-and-build.json", baseline);
  return freezeDeep(baseline);
}
async function compareBaseline(baseline, label) {
  const current = {
    playwrightCoreBundle: {
      path: await realpath(
        join(dirname(runnerRequire.resolve("playwright-core")), "lib/coreBundle.js"),
      ),
      sha256: await sha(
        await realpath(
          join(dirname(runnerRequire.resolve("playwright-core")), "lib/coreBundle.js"),
        ),
      ),
    },
    sources: await sourceSnapshot(Object.keys(baseline.sources)),
    webDist: await hashes(join(web, "dist")),
    desktopDist: await hashes(join(desktop, "dist")),
    head: (
      await recordedCommand(label + "-git-head", "git", ["rev-parse", "HEAD"], root)
    ).stdout.trim(),
  };
  await write(label + "-hashes.json", current);
  assert.equal(current.head, baseline.head);
  assert.deepEqual(
    current.playwrightCoreBundle,
    baseline.runtimes.playwrightCoreBundle,
    "Playwright implementation changed",
  );
  for (const key of ["sources", "webDist", "desktopDist"])
    assert.deepEqual(current[key], baseline[key], label + ": " + key + " changed");
  for (const manifest of baseline.manifests)
    assert.equal((await sha(manifest.path)).toUpperCase(), manifest.sha256);
}
function normalMaterial() {
  const unit = [..."星夜 C3 original / 原创\n😀\u{1F680}\n"];
  const material = Array.from({ length: 20050 }, (_, index) => unit[index % unit.length]);
  material.splice(0, 12, ...[..."HEAD-C3-START"]);
  material.splice(10000, 13, ...[..."MIDDLE-C3-MK"]);
  material.splice(-11, 11, ...[..."TAIL-C3-END"]);
  const text = material.join("");
  const points = [...text].length;
  assert(points >= 19900 && points <= 20100);
  return text;
}
function child(command, args, cwd) {
  return new Promise((resolveResult, rejectResult) => {
    const taskChild = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    taskChild.stdout.setEncoding("utf8");
    taskChild.stderr.setEncoding("utf8");
    taskChild.stdout.on("data", (x) => (stdout += x));
    taskChild.stderr.on("data", (x) => (stderr += x));
    taskChild.on("error", rejectResult);
    taskChild.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}
function errorData(error) {
  return {
    name: error?.name ?? typeof error,
    message: String(error?.message ?? error),
    stack: error?.stack,
    errors: error instanceof AggregateError ? [...error.errors].map(errorData) : undefined,
  };
}
function throwCollected(errors, message) {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message, { cause: errors[0] });
}
function timeoutValue(value) {
  if (!Number.isInteger(value) || value < 1 || value > 30000)
    throw new TypeError("timeoutMs must be an integer in 1..30000");
}
function strictChild(parent, candidate) {
  const rel = relative(parent, candidate);
  return (
    !!rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../")
  );
}
async function ownedRunDirectory(root, evidenceDirectory) {
  if (!isAbsolute(root) || !isAbsolute(evidenceDirectory))
    throw new Error("root and evidenceDirectory must be absolute");
  const base = await realpath(root);
  const dev = join(base, ".aijian-dev");
  const run = resolve(evidenceDirectory);
  if (!strictChild(dev, run))
    throw new Error("evidenceDirectory must be this run directory below root/.aijian-dev");
  // Reject junction/symlink redirection at every directory below the verified root.
  for (let current = run; relative(base, current) !== ""; current = dirname(current)) {
    if (!strictChild(base, current))
      throw new Error("Evidence path escaped root during validation");
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`unowned evidence directory: ${current}`);
    if (relative(current, await realpath(current)) !== "")
      throw new Error(`redirected evidence directory: ${current}`);
  }
  return { root: base, run };
}

/** Pure script construction, also used by STATIC Parser.ParseInput validation. */
function buildNativeDialogScript(config) {
  const literal = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  return String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$cfg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${literal}')) | ConvertFrom-Json
$watch = [Diagnostics.Stopwatch]::StartNew()
$utf8 = [Text.UTF8Encoding]::new($false)
$observationWritten = $false
$record = [ordered]@{
  pid = $cfg.pid; title = $cfg.title; button = $cfg.button; identity = $cfg.identity
  observationPath = $cfg.observationPath; resultPath = $cfg.resultPath
  observedAt = [DateTime]::UtcNow.ToString('o'); windowCount = 0; windows = @()
  match = [ordered]@{ project_id = $false; version_id = $false; content_hash = $false; buttonCount = 0; invokePattern = $false }
  readyToInvoke = $false; invoked = $false; invocationAttempted = $false
  invocationOutcome = 'NOT_ATTEMPTED'; errors = @(); fullC3NativeAccepted = $false
}
function Row($element) {
  $current = $element.Current
  return [ordered]@{
    Name = $current.Name; ControlType = $current.ControlType.ProgrammaticName
    AutomationId = $current.AutomationId; PID = $current.ProcessId
    RuntimeId = @($element.GetRuntimeId()); IsEnabled = $current.IsEnabled
  }
}
function Persist($path, $value) {
  if ([IO.File]::Exists($path)) { throw "Evidence path already exists: $path" }
  $json = ConvertTo-Json -InputObject $value -Depth 32 -Compress
  [IO.File]::WriteAllText($path, $json, $utf8)
  if ([IO.File]::ReadAllText($path, $utf8) -cne $json) { throw 'Evidence readback mismatch' }
}
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $processCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$cfg.pid)
  $titleCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, [string]$cfg.title)
  $condition = [Windows.Automation.AndCondition]::new($processCondition, $titleCondition)
  do {
    $found = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition)
    $windows = @($found | Where-Object { $_.Current.ProcessId -eq $cfg.pid -and $_.Current.Name -ceq $cfg.title })
    if ($windows.Count -ne 0) { break }
    $remaining = [int]$cfg.timeoutMs - [int]$watch.ElapsedMilliseconds
    if ($remaining -le 0) { break }
    Start-Sleep -Milliseconds ([Math]::Min(100, $remaining))
  } while ($watch.ElapsedMilliseconds -lt $cfg.timeoutMs)
  $record.windowCount = $windows.Count
  foreach ($window in $windows) {
    $windowRecord = [ordered]@{ tree = @(); observationError = $null }
    $record.windows += $windowRecord
    try {
      $windowRecord.tree += (Row $window)
      $nodes = $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
      foreach ($node in $nodes) { $windowRecord.tree += (Row $node) }
    } catch {
      $windowRecord.observationError = $_.Exception.ToString()
      throw
    }
  }
  if ($windows.Count -ne 1) { throw "Expected exactly one owned dialog, found $($windows.Count)" }
  $window = $windows[0]
  $nodes = $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
  # Match labelled detail lines, not a substring of another project's/version's ID.
  $lines = @($record.windows[0].tree | Where-Object { $_.PID -eq $cfg.pid } | ForEach-Object { $_.Name -split '\r?\n' })
  $record.match.project_id = $lines -ccontains ('项目：' + $cfg.identity.project_id)
  $record.match.version_id = $lines -ccontains ('版本：' + $cfg.identity.version_id)
  $record.match.content_hash = $lines -ccontains ('来源内容 hash：' + $cfg.identity.content_hash)
  $buttons = @($nodes | Where-Object {
    $_.Current.ProcessId -eq $cfg.pid -and $_.Current.Name -ceq $cfg.button -and
    $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button
  })
  $record.match.buttonCount = $buttons.Count
  if (-not ($record.match.project_id -and $record.match.version_id -and $record.match.content_hash)) { throw 'Dialog identity mismatch' }
  if ($buttons.Count -ne 1) { throw "Expected exactly one owned Button, found $($buttons.Count)" }
  $patternObject = $null
  $supported = $buttons[0].TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$patternObject)
  $record.match.invokePattern = $supported -and ($patternObject -is [Windows.Automation.InvokePattern])
  if (-not $record.match.invokePattern -or -not $buttons[0].Current.IsEnabled) { throw 'Button lacks an enabled InvokePattern' }
  $record.readyToInvoke = $true
  $record.observedAt = [DateTime]::UtcNow.ToString('o')
  # The unique path was validated/allocated by JS. Failed write/readback aborts before Invoke.
  Persist $cfg.observationPath $record
  $observationWritten = $true
  if ($watch.ElapsedMilliseconds -ge $cfg.timeoutMs) { throw 'Native dialog deadline expired before Invoke' }
  if ($window.Current.ProcessId -ne $cfg.pid -or $window.Current.Name -cne $cfg.title -or
      $buttons[0].Current.ProcessId -ne $cfg.pid -or $buttons[0].Current.Name -cne $cfg.button -or
      $buttons[0].Current.ControlType -ne [Windows.Automation.ControlType]::Button) { throw 'Dialog changed after evidence persistence' }
  $freshNodes = $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
  $freshRows = @((Row $window)) + @($freshNodes | ForEach-Object { Row $_ })
  if ((ConvertTo-Json -InputObject $freshRows -Depth 16 -Compress) -cne
      (ConvertTo-Json -InputObject $record.windows[0].tree -Depth 16 -Compress)) { throw 'Dialog tree changed after evidence persistence' }
  $freshWindows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition)
  if ($freshWindows.Count -ne 1) { throw 'Dialog uniqueness changed after evidence persistence' }
  if ($watch.ElapsedMilliseconds -ge $cfg.timeoutMs) { throw 'Native dialog deadline expired before Invoke' }
  $record.invocationAttempted = $true
  $record.invocationOutcome = 'UNKNOWN'
  ([Windows.Automation.InvokePattern]$patternObject).Invoke()
  $record.invoked = $true
  $record.invocationOutcome = 'INVOKE_RETURNED'
} catch {
  $record.errors += [ordered]@{ phase = 'observe-or-invoke'; message = $_.Exception.ToString() }
} finally {
  $record.elapsedMs = $watch.ElapsedMilliseconds
  if (-not $observationWritten) {
    try { Persist $cfg.observationPath $record; $observationWritten = $true }
    catch { $record.errors += [ordered]@{ phase = 'write-observation'; message = $_.Exception.ToString() } }
  }
  try { Persist $cfg.resultPath $record }
  catch { $record.errors += [ordered]@{ phase = 'write-result'; message = $_.Exception.ToString() } }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $record -Depth 32 -Compress))
}
if ($record.errors.Count -gt 0 -or -not $record.invoked) { exit 1 }
exit 0
`;
}

function runPowerShell(pwsh, root, script, timeoutMs) {
  return new Promise((done) => {
    const child = spawn(
      pwsh,
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        cwd: root,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "",
      finished = false;
    const finish = (details) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done({ helperPid: child.pid, stdout, stderr, ...details });
    };
    // UIA can hang outside the poll. Kill ONLY this newly spawned PS helper on watchdog
    // expiry, never Electron. Invoke may already have started, so its outcome is unknown.
    const timer = setTimeout(() => {
      let helperTermination;
      try {
        helperTermination = child.kill();
      } catch (error) {
        helperTermination = errorData(error);
      }
      finish({ code: null, timedOut: true, invocationOutcome: "UNKNOWN", helperTermination });
    }, timeoutMs + 5000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", (error) => finish({ code: null, spawnError: errorData(error) }));
    child.on("close", (code, signal) => finish({ code, signal }));
  });
}

async function nativeDialog({
  pwsh,
  root,
  pid,
  title,
  button,
  identity,
  evidenceDirectory,
  writeEvidence,
  timeoutMs = 30000,
}) {
  timeoutValue(timeoutMs);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !isAbsolute(pwsh))
    throw new TypeError("Invalid PID or pwsh path");
  if (typeof title !== "string" || !title || typeof button !== "string" || !button)
    throw new TypeError("Exact title and button are required");
  if (
    !/^prj_[0-9a-f]{32}$/.test(identity?.project_id ?? "") ||
    !/^ver_[0-9a-f]{32}$/.test(identity?.version_id ?? "") ||
    !/^sha256:[0-9a-f]{64}$/.test(identity?.content_hash ?? "")
  )
    throw new TypeError("Three valid identity fields are required");
  if (typeof writeEvidence !== "function") throw new TypeError("writeEvidence is required");
  const owned = await ownedRunDirectory(root, evidenceDirectory);
  const callDirectory = await mkdtemp(join(owned.run, "native-dialog-"));
  await ownedRunDirectory(owned.root, callDirectory);
  const observationPath = join(callDirectory, "observation.json");
  const resultPath = join(callDirectory, "result.json");
  const request = {
    pid,
    title,
    button,
    identity: {
      project_id: identity.project_id,
      version_id: identity.version_id,
      content_hash: identity.content_hash,
    },
    timeoutMs,
    observationPath,
    resultPath,
  };
  await writeFile(join(callDirectory, "request.json"), JSON.stringify(request, null, 2), {
    flag: "wx",
  });
  const errors = [];
  let transport, result, observationSha256;
  // A durable pre-invoke snapshot cannot prove that Invoke never started.
  // Keep every unverified post-spawn failure UNKNOWN, including abnormal exit.
  let invocationOutcome = "UNKNOWN";
  try {
    transport = await runPowerShell(pwsh, owned.root, buildNativeDialogScript(request), timeoutMs);
    if (transport.code !== 0)
      throw new Error(`Native dialog failed; see ${callDirectory}`, { cause: transport });
    await ownedRunDirectory(owned.root, callDirectory);
    const bytes = await readFile(observationPath);
    const observation = JSON.parse(bytes.toString("utf8"));
    result = JSON.parse(await readFile(resultPath, "utf8"));
    const stdoutResult = JSON.parse(transport.stdout.trim());
    if (JSON.stringify(stdoutResult) !== JSON.stringify(result))
      throw new Error("PowerShell result file/stdout mismatch");
    if (
      observation.observationPath !== observationPath ||
      result.resultPath !== resultPath ||
      observation.pid !== pid ||
      observation.title !== title ||
      observation.button !== button ||
      JSON.stringify(observation.identity) !== JSON.stringify(request.identity) ||
      observation.windowCount !== 1 ||
      !observation.readyToInvoke ||
      observation.invoked ||
      !observation.match.project_id ||
      !observation.match.version_id ||
      !observation.match.content_hash ||
      observation.match.buttonCount !== 1 ||
      !observation.match.invokePattern ||
      result.invoked !== true ||
      result.invocationOutcome !== "INVOKE_RETURNED" ||
      result.errors.length !== 0 ||
      result.fullC3NativeAccepted !== false
    )
      throw new Error("Native dialog evidence failed JS verification");
    observationSha256 = createHash("sha256").update(bytes).digest("hex");
    invocationOutcome = "INVOKE_RETURNED";
  } catch (error) {
    errors.push(error);
  }
  const summary = {
    request,
    callDirectory,
    transport,
    result,
    observationSha256,
    invocationOutcome,
    errors: errors.map(errorData),
    fullC3NativeAccepted: false,
  };
  try {
    await writeFile(join(callDirectory, "transport.json"), JSON.stringify(summary, null, 2), {
      flag: "wx",
    });
  } catch (error) {
    errors.push(error);
  }
  try {
    await writeEvidence(`native-dialog-${randomUUID()}.json`, {
      ...summary,
      errors: errors.map(errorData),
    });
  } catch (error) {
    errors.push(error);
  }
  throwCollected(errors, "Native dialog and evidence failures");
  return {
    invoked: true,
    invocationOutcome,
    observationPath,
    resultPath,
    observationSha256,
    fullC3NativeAccepted: false,
  };
}

/** Caller passes its caught phase error; it is rethrown after cleanup. */
async function normalClose(
  app,
  label,
  lifecycle,
  { timeoutMs = 10000, writeEvidence, priorError, processIdentity, mainObserver } = {},
) {
  const errors = priorError ? [priorError] : [],
    closeFailures = [];
  const record = {
    label,
    startedAt: new Date().toISOString(),
    outcome: "CLOSING",
    priorError: priorError && errorData(priorError),
    processIdentity,
  };
  let child,
    timer,
    detach = () => {};
  const track = (promise) =>
    promise.catch((error) => {
      closeFailures.push(error);
      throw error;
    });
  try {
    timeoutValue(timeoutMs);
    child = app.process(); // This is the real launcher ChildProcess, captured before close.
    record.pid = child.pid;
    record.launcherPid = child.pid;
    record.exitCodeMeaning = "launcher";
    record.mainPid = processIdentity?.mainPid;
    const exited = new Promise((done, fail) => {
      const onExit = (code, signal) => done({ code, signal });
      const onError = (error) => fail(error);
      child.once("exit", onExit);
      child.once("error", onError);
      detach = () => {
        child.removeListener("exit", onExit);
        child.removeListener("error", onError);
      };
      if (child.exitCode !== null || child.signalCode !== null)
        done({ code: child.exitCode, signal: child.signalCode });
    }).then((exit) => {
      record.exitCode = exit.code;
      record.launcherExitCode = exit.code;
      record.signal = exit.signal;
      assert.equal(exit.code, 0, "launcher exit must be 0");
      assert.equal(exit.signal, null);
      assert.equal(child.exitCode, 0);
      if (processIdentity)
        assert.equal(child.pid, processIdentity.launcherPid, "captured launcher identity");
      return exit;
    });
    const observedMain = Promise.resolve().then(async () => {
      if (!mainObserver)
        throw new Error("Main exit observer missing; launcher exit cannot prove main exit");
      const terminal = await mainObserver.observeExit();
      record.mainExit = terminal;
      record.mainExitCode = terminal?.exitCode;
      return validateMainProcessExit(processIdentity, terminal);
    });
    const closed = Promise.resolve().then(() => app.close());
    const work = Promise.allSettled([track(closed), track(exited), track(observedMain)]);
    const deadline = new Promise((_, fail) => {
      timer = setTimeout(() => {
        record.outcome = "TIMEOUT";
        record.retainedLauncherPid = child.exitCode === null ? child.pid : undefined;
        if (record.mainExit?.hasExited !== true) record.retainedMainPid = processIdentity?.mainPid;
        fail(
          new Error(
            label +
              ": normal close timed out; unresolved process identities retained, no kill sent",
          ),
        );
      }, timeoutMs);
    });
    await Promise.race([work, deadline]);
    throwCollected(closeFailures, label + ": launcher/main close failures");
    record.outcome = "CLOSED_LAUNCHER_AND_MAIN_EXIT_0";
  } catch (error) {
    for (const failure of closeFailures) if (!errors.includes(failure)) errors.push(failure);
    if (
      !errors.includes(error) &&
      !(error instanceof AggregateError && error.errors.every((item) => errors.includes(item)))
    )
      errors.push(error);
    record.closeError = errorData(error);
    if (record.outcome !== "TIMEOUT") record.outcome = "CLOSE_FAILED";
    if (child && child.exitCode === null && child.signalCode === null)
      record.retainedLauncherPid = child.pid;
    if (record.mainExit?.hasExited !== true) record.retainedMainPid = processIdentity?.mainPid;
  } finally {
    clearTimeout(timer);
    detach();
    record.finishedAt = new Date().toISOString();
    record.errors = errors.map(errorData);
    lifecycle.closes ??= [];
    lifecycle.closes.push(record);
    lifecycle.close = record;
    if (typeof writeEvidence !== "function") {
      const error = new TypeError("Cannot persist lifecycle without writeEvidence");
      errors.push(error);
      record.evidenceError = errorData(error);
      record.errors = errors.map(errorData);
    } else {
      try {
        await writeEvidence("lifecycle-" + randomUUID() + ".json", lifecycle);
      } catch (error) {
        errors.push(error);
        record.evidenceError = errorData(error);
        record.errors = errors.map(errorData);
      }
    }
  }
  throwCollected(
    errors,
    label + ": phase, launcher/main close and/or lifecycle persistence failed",
  );
  return record;
}

async function poll(read, label, timeout = 30000) {
  const end = Date.now() + timeout;
  do {
    const value = await read();
    if (value) return value;
    await wait(100);
  } while (Date.now() < end);
  throw new Error(label + " timed out");
}
async function uniqueVisible(locator, label) {
  const visible = [];
  for (let index = 0; index < (await locator.count()); index += 1)
    if (await locator.nth(index).isVisible()) visible.push(locator.nth(index));
  assert.equal(visible.length, 1, label + " must have one visible control");
  return visible[0];
}
async function assertSelectedProject(page, projectId) {
  const name = await page
    .getByLabel("作品选择", { exact: true })
    .locator("option:checked")
    .textContent();
  const listed = await page.evaluate(() => globalThis.aijian.listProjects());
  const found = listed.data.filter((project) => project.name === name?.trim());
  assert.equal(found.length, 1);
  assert.equal(found[0].id, projectId);
}
async function createProjectThroughUi(page, name) {
  const enter = page.getByRole("button", { name: "进入 UI 演示", exact: true });
  if (await enter.isVisible()) await enter.click();
  const direct = page.getByRole("button", { name: "打开项目中心", exact: true });
  const visible = [];
  for (let i = 0; i < (await direct.count()); i += 1)
    if (await direct.nth(i).isVisible()) visible.push(direct.nth(i));
  assert(visible.length <= 1, "ambiguous project center control");
  if (visible.length) await visible[0].click();
  else
    await (
      await uniqueVisible(
        page
          .locator("aside[aria-label='主导航']")
          .getByRole("button", { name: "项目中心", exact: true }),
        "project center",
      )
    ).click();
  await page.getByRole("heading", { level: 1, name: "项目中心", exact: true }).waitFor();
  const connect = page.getByRole("button", { name: "连接本地工作区", exact: true });
  if (await connect.isVisible()) await connect.click();
  await page.getByRole("button", { name: "本地工作区已连接", exact: true }).waitFor();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("作品名称", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "保存演示修改", exact: true }).click();
  await poll(
    async () =>
      (await page.getByLabel("作品选择").locator("option").allTextContents()).includes(name),
    "new project option",
  );
  await page.locator(".demo-root[data-page='source']").waitFor();
  const project = await poll(async () => {
    const response = await page.evaluate(() => globalThis.aijian.listProjects());
    const matches = response.data.filter((item) => item.name === name);
    assert(matches.length <= 1);
    return matches[0];
  }, "new project readback");
  await assertSelectedProject(page, project.id);
  return project;
}
async function navigateSource(page, projectId) {
  await assertSelectedProject(page, projectId);
  if (!(await page.locator(".demo-root[data-page='source']").isVisible())) {
    const backToSource = page.getByRole("button", { name: "返回来源审核", exact: true });
    if (await backToSource.isVisible()) await backToSource.click();
    else {
      await page.getByRole("button", { name: "AIVORA 启动页", exact: true }).click();
      await page.getByRole("button", { name: "进入 UI 演示", exact: true }).click();
      await page
        .getByRole("button", { name: "继续已有的演示项目，或从一段故事开始。", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "从已有内容开始", exact: true });
      await dialog.getByLabel("下一步", { exact: true }).selectOption("从灵感模板开始");
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
    }
  }
  await page.locator(".demo-root[data-page='source']").waitFor();
  await assertSelectedProject(page, projectId);
}
function normalizedFixture(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC");
}
function expectedBlocks(text) {
  let byteCursor = 0;
  const blocks = [];
  for (const lineWithEnd of normalizedFixture(text).match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const line = lineWithEnd.replace(/\n$/, "");
    const blockText = line.trim();
    if (blockText) {
      const start =
        byteCursor + Buffer.byteLength(line.slice(0, line.length - line.trimStart().length));
      blocks.push({
        ordinal: blocks.length,
        kind: "paragraph",
        chapter_index: 1,
        text: blockText,
        normalized_start_byte: start,
        normalized_end_byte: start + Buffer.byteLength(blockText),
        content_sha256: createHash("sha256").update(blockText).digest("hex"),
      });
    }
    byteCursor += Buffer.byteLength(lineWithEnd);
  }
  return blocks;
}
function assertSource(source, projectId, text) {
  assert.equal(source.data.project_id, projectId);
  assert.equal(source.data.raw_sha256, createHash("sha256").update(text).digest("hex"));
  assert.equal(source.data.byte_size, Buffer.byteLength(text));
  const expected = expectedBlocks(text);
  assert.equal(source.data.block_count, expected.length);
  assert.equal(source.data.blocks.length, expected.length);
  const normalized = Buffer.from(normalizedFixture(text));
  source.data.blocks.forEach((block, index) => {
    const { id, ...rest } = block;
    assert.match(id, /^srcb_[0-9a-f]{32}$/);
    assert.deepEqual(rest, expected[index]);
    assert.equal(
      normalized.subarray(block.normalized_start_byte, block.normalized_end_byte).toString("utf8"),
      block.text,
    );
  });
  const joined = source.data.blocks.map((block) => block.text).join("\n");
  for (const sentinel of ["HEAD-C3-START", "MIDDLE-C3-MK", "TAIL-C3-END"])
    assert(joined.includes(sentinel), "source sentinel lost: " + sentinel);
}
async function importSourceThroughUi(page, projectId, text, filename, mode) {
  await navigateSource(page, projectId);
  assert(["file", "paste"].includes(mode));
  if (mode === "file")
    await page
      .getByLabel("替换原文文件", { exact: true })
      .setInputFiles({ name: filename, mimeType: "text/plain", buffer: Buffer.from(text) });
  else {
    await page.getByRole("button", { name: "粘贴故事", exact: true }).click();
    const textarea = page.getByLabel("外部原文正文", { exact: true });
    await textarea.fill(text);
    assert.equal(await textarea.inputValue(), text);
    await page.getByRole("button", { name: "作为外部原文导入", exact: true }).click();
  }
  const rawHash = createHash("sha256").update(text).digest("hex");
  const source = await poll(async () => {
    const listed = await page.evaluate((id) => globalThis.aijian.listSources(id), projectId);
    const candidate = listed.data.find(
      (item) => item.raw_sha256 === rawHash && item.byte_size === Buffer.byteLength(text),
    );
    return candidate
      ? await page.evaluate(({ projectId, id }) => globalThis.aijian.getSource(projectId, id), {
          projectId,
          id: candidate.id,
        })
      : null;
  }, "source import complete readback");
  assertSource(source, projectId, text);
  const manifest = await poll(async () => {
    const value = await page.evaluate((id) => globalThis.aijian.getSourceManifest(id), projectId);
    return value?.data.latest_version.content.documents.some(
      (item) => item.source_document_id === source.data.id,
    )
      ? value
      : null;
  }, "source manifest import membership");
  assert.equal(manifest.data.project_id, projectId);
  assert.equal(manifest.data.head.accepted_version_id, null);
  assert.equal(manifest.data.head.review_version_id, null);
  assert.equal(manifest.data.head.latest_version_id, manifest.data.latest_version.id);
  const member = manifest.data.latest_version.content.documents.find(
    (item) => item.source_document_id === source.data.id,
  );
  assert.equal(member.raw_sha256, source.data.raw_sha256);
  assert.equal(member.byte_size, source.data.byte_size);
  assert.equal(
    member.normalized_sha256,
    createHash("sha256").update(normalizedFixture(text)).digest("hex"),
  );
  assert.equal(member.filename, source.data.filename);
  assert.deepEqual(
    member.blocks,
    source.data.blocks.map((block) => ({
      source_block_id: block.id,
      ordinal: block.ordinal,
      kind: block.kind,
      chapter_index: block.chapter_index,
      start_byte: block.normalized_start_byte,
      end_byte: block.normalized_end_byte,
      content_sha256: block.content_sha256,
    })),
  );
  await assertSelectedProject(page, projectId);
  await poll(
    async () =>
      (await page.locator(".v2-source-excerpt").textContent()) ===
      source.data.blocks.map((block) => block.text).join("\n\n"),
    "complete source UI preview",
  );
  await write("source-" + mode + "-readback.json", { source, manifest });
  return { source, manifest };
}
async function reviewAndApproveThroughUi(page, processIdentity, identity) {
  const imported = await page.evaluate(
    (id) => globalThis.aijian.getSourceManifest(id),
    identity.project_id,
  );
  assert.equal(imported.data.project_id, identity.project_id);
  assert.equal(imported.data.latest_version.id, identity.version_id);
  assert.equal(imported.data.latest_version.content_hash, identity.content_hash);
  await page.getByRole("button", { name: "开始理解故事", exact: true }).click();
  const review = page.getByRole("dialog", { name: /来源审核 · v/ });
  await review.getByRole("button", { name: "提交真实来源审核", exact: true }).click();
  await nativeDialog({
    pwsh,
    root,
    pid: processIdentity.mainPid,
    title: "送审来源版本",
    button: "确认送审来源版本",
    identity,
    evidenceDirectory: evidence,
    writeEvidence: write,
  });
  await page.locator(".demo-root[data-page='story']").waitFor();
  await page.getByRole("button", { name: "返回来源审核", exact: true }).click();
  await page.locator(".demo-root[data-page='source']").waitFor();
  const fresh = await poll(async () => {
    const value = await page.evaluate(
      (id) => globalThis.aijian.getSourceManifest(id),
      identity.project_id,
    );
    return value?.data.head.review_version_id === identity.version_id ? value : null;
  }, "submitted source review head");
  assert.equal(fresh.data.project_id, identity.project_id);
  assert.equal(fresh.data.latest_version.id, identity.version_id);
  assert.equal(fresh.data.latest_version.content_hash, identity.content_hash);
  assert.deepEqual(fresh.data.latest_version.content, imported.data.latest_version.content);
  assert.equal(fresh.data.head.accepted_version_id, null);
  const captured = { ...identity, expected_revision: fresh.data.head.revision };
  await write("g1-fresh-preflight.json", { imported, fresh, captured });
  const open = page.getByRole("button", { name: "确认来源审核基线", exact: true });
  await poll(async () => await open.isEnabled(), "G1 baseline available");
  await open.click();
  const baseline = page.getByRole("dialog", { name: "确认来源审核基线", exact: true });
  const description = await baseline.locator(".dialog-description").textContent();
  for (const value of [
    captured.project_id,
    captured.version_id,
    captured.content_hash,
    String(captured.expected_revision),
  ])
    assert(description.includes(value));
  await baseline
    .getByLabel("确认理由（1 至 1000 个字符）", { exact: true })
    .fill("C3 normal native signoff");
  await baseline.getByRole("button", { name: "确认来源审核基线", exact: true }).click();
  for (const [title, button] of [
    ["签署来源基线", "确认签署来源基线"],
    ["批准来源基线", "确认批准来源基线"],
  ])
    await nativeDialog({
      pwsh,
      root,
      pid: processIdentity.mainPid,
      title,
      button,
      identity: captured,
      evidenceDirectory: evidence,
      writeEvidence: write,
    });
  const result = await poll(async () => {
    const value = await page.evaluate(
      (id) => globalThis.aijian.getSourceManifest(id),
      identity.project_id,
    );
    return value?.data.head.accepted_version_id === identity.version_id ? value : null;
  }, "accepted source readback");
  const data = result.data;
  assert.equal(data.project_id, captured.project_id);
  assert.equal(data.head.latest_version_id, captured.version_id);
  assert.equal(data.head.review_version_id, null);
  assert.equal(data.head.review_submission_id, null);
  for (const version of [data.latest_version, data.accepted_version]) {
    assert.equal(version.id, captured.version_id);
    assert.equal(version.content_hash, captured.content_hash);
    assert.equal(version.artifact_id, fresh.data.head.artifact_id);
    assert.deepEqual(version.content, fresh.data.latest_version.content);
  }
  assert.equal(data.head.artifact_id, fresh.data.head.artifact_id);
  await write("g1-accepted-readback.json", { captured, submittedHead: fresh.data.head, result });
  return { ...data, submittedHead: fresh.data.head };
}

async function assertBriefUi(page, receipt) {
  const content = receipt.data.version.content;
  const details = page.locator("details.v2-source-support");
  await details.waitFor({ state: "visible" });
  await details.locator("summary").waitFor({ state: "visible" });
  await poll(
    async () =>
      (await details.locator("summary").innerText()).includes(
        "V" + receipt.data.version.version_number + "：",
      ),
    "UI brief version readback",
  );
  const values = details.locator("dd");
  assert((await values.count()) > 0, "brief must render value elements");
  for (const value of await values.all()) await value.waitFor({ state: "visible" });
  const fieldText = async (label) => {
    const term = details.locator("dt").filter({ hasText: new RegExp("^" + label + "$") });
    assert.equal(await term.count(), 1, "one brief field required: " + label);
    await term.waitFor({ state: "visible" });
    const value = term.locator("xpath=following-sibling::dd[1]");
    await value.waitFor({ state: "visible" });
    return (await value.innerText()).replace(/\s+/g, " ").trim();
  };
  const delivery = await fieldText("交付");
  const aspect = content.delivery.display_aspect_ratio;
  assert(
    delivery.includes("画幅 " + aspect.num + "/" + aspect.den + "，"),
    "visible display aspect ratio",
  );
  const duration = await fieldText("时长");
  assert(
    duration.startsWith("整部：" + (content.duration_intent.work_seconds ?? "尚未确认") + " 秒；"),
    "visible whole-work duration",
  );
  const text = (await details.innerText()).replace(/\s+/g, " ");
  for (const expected of [
    content.creative.premise,
    content.creative.intent,
    content.creative.audience,
    content.creative.genre,
    content.creative.style,
    ...content.creative.constraints,
    content.delivery.language,
    content.delivery.width_px + " × " + content.delivery.height_px,
    content.delivery.frame_rate.num + "/" + content.delivery.frame_rate.den,
  ])
    assert(text.includes(String(expected)), "brief UI field missing: " + expected);
  if (content.creative_entry.kind === "original_idea") {
    assert(text.includes(content.creative_entry.origin_statement));
    for (const reference of content.creative_entry.references)
      assert(text.includes(reference.description));
    const kinds = { inspiration: "灵感", research: "研究", other: "其他" };
    const expectedReferences = content.creative_entry.references.map((reference) => {
      assert(Object.hasOwn(kinds, reference.reference_kind), "known reference kind");
      return kinds[reference.reference_kind] + "：" + reference.description;
    });
    assert.equal(await fieldText("参考资料"), expectedReferences.join("；") || "无");
    assert(!text.includes("来源焦点"));
  } else {
    for (const expected of [
      content.creative_entry.adaptation_statement,
      content.creative_entry.source_document_id,
      content.creative_entry.source_manifest_version_id,
      ...content.creative_entry.source_block_ids,
    ])
      assert(text.includes(expected), "adaptation UI identity missing");
  }
  if (content.budget_intent.state === "unknown") assert(text.includes("预算尚未确认"));
  else assert(text.includes(content.budget_intent.currency) && text.includes("12.345678"));
  if (content.rights_declaration.state === "unknown") assert(text.includes("权利尚未确认"));
  else assert(text.includes(content.rights_declaration.statement));
  if (content.duration_intent.episode_mode === "unspecified")
    assert(text.includes("单集时长未指定"));
  else assert(text.includes("按单集：" + content.duration_intent.episode_seconds + " 秒"));
}

async function saveOriginalThroughUi(page, projectId, declared) {
  const before = await page.evaluate((id) => globalThis.aijian.getProductionBrief(id), projectId);
  if (before) assert.equal(before.data.project_id, projectId);
  await page.getByRole("button", { name: "原创灵感", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "保存原创灵感草稿", exact: true });
  const values = {
    原创来源说明: "C3 original",
    核心设定: "memory city",
    创作意图: "test normal path",
    "目标受众（可选）": "adult",
    "类型（可选）": "drama",
    "风格（可选）": "noir",
    "创作约束（每行一项，可选）": "constraint",
    "参考说明（可选）": "research",
    交付宽度: "1280",
    交付高度: "720",
    交付语言: "zh-CN",
    帧率分子: "30000",
    帧率分母: "1001",
    "整部时长（秒，可选）": "180",
    "单集时长（秒）": "60",
    预算金额: "12.345678",
    预算币种: "CNY",
    权利声明: "synthetic rights",
  };
  for (const [label, value] of Object.entries(values))
    await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByLabel("参考类型（可选）").selectOption("研究");
  await dialog.getByLabel("单集时长模式").selectOption(declared ? "按单集" : "未指定");
  await dialog.getByLabel("预算状态").selectOption(declared ? "已声明" : "未知");
  await dialog.getByLabel("权利状态").selectOption(declared ? "用户声明" : "尚未确认");
  // Values intentionally remain nonempty while the state selects switch to unknown.
  const expectedContent = {
    schema_version: "1.0.0",
    creative_entry: {
      kind: "original_idea",
      origin_statement: values["原创来源说明"],
      references: [{ reference_kind: "research", description: values["参考说明（可选）"] }],
    },
    creative: {
      premise: values["核心设定"],
      intent: values["创作意图"],
      audience: "adult",
      genre: "drama",
      style: "noir",
      constraints: ["constraint"],
    },
    delivery: {
      width_px: 1280,
      height_px: 720,
      language: "zh-CN",
      display_aspect_ratio: { num: 16, den: 9 },
      frame_rate: { num: 30000, den: 1001 },
    },
    duration_intent: {
      episode_mode: declared ? "per_episode" : "unspecified",
      work_seconds: 180,
      episode_seconds: declared ? 60 : null,
    },
    budget_intent: {
      state: declared ? "declared" : "unknown",
      amount_micros: declared ? 12345678 : null,
      currency: declared ? "CNY" : null,
    },
    rights_declaration: {
      state: declared ? "user_declared" : "unknown",
      statement: declared ? "synthetic rights" : null,
    },
  };
  if (!declared) {
    await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page
      .getByText("请填写有效的交付信息；已声明预算还需要金额和币种。", { exact: true })
      .waitFor();
    assert(await dialog.isVisible(), "invalid duration must keep the draft open");
    const unchanged = await page.evaluate(
      (id) => globalThis.aijian.getProductionBrief(id),
      projectId,
    );
    assert.deepEqual(unchanged.data, before.data, "local validation must not create a version");
    await write("original-expected-local-validation.json", {
      outcome: "EXPECTED_LOCAL_VALIDATION",
      newWriteExpected: false,
      before,
      unchanged,
      staleEpisodeSeconds: await dialog.getByLabel("单集时长（秒）", { exact: true }).inputValue(),
    });
    await dialog.getByLabel("单集时长（秒）", { exact: true }).fill("");
    assert.equal(await dialog.getByLabel("预算金额", { exact: true }).inputValue(), "12.345678");
    assert.equal(await dialog.getByLabel("预算币种", { exact: true }).inputValue(), "CNY");
    assert.equal(
      await dialog.getByLabel("权利声明", { exact: true }).inputValue(),
      "synthetic rights",
    );
  }
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  const current = await poll(async () => {
    const receipt = await page.evaluate(
      (id) => globalThis.aijian.getProductionBrief(id),
      projectId,
    );
    return receipt?.data.version.id && receipt.data.version.id !== before?.data.version.id
      ? receipt
      : null;
  }, "original brief new version");
  assert.equal(current.data.project_id, projectId);
  assert.equal(current.data.version.parent_version_id, before?.data.version.id ?? null);
  assert.equal(current.data.head.revision, (before?.data.head.revision ?? 0) + 1);
  assert.equal(current.data.head.latest_version_id, current.data.version.id);
  assert.equal(current.data.head.artifact_id, current.data.version.artifact_id);
  assert.deepEqual(current.data.version.content, expectedContent);
  for (const key of ["source_manifest_version_id", "source_document_id", "source_block_ids"])
    assert(!Object.hasOwn(current.data.version.content.creative_entry, key));
  await assertBriefUi(page, current);
  await write(`original-${declared ? "declared" : "unknown"}-receipt.json`, {
    before,
    current,
    expectedContent,
  });
  return current;
}
async function saveAdaptationThroughUi(page, projectId, sourceA, acceptedA) {
  const accepted = acceptedA.accepted_version;
  assert.equal(acceptedA.project_id, projectId);
  assert.equal(acceptedA.head.accepted_version_id, accepted.id);
  const member = accepted.content.documents.find(
    (document) => document.source_document_id === sourceA.source.data.id,
  );
  assert(member, "source document must be an accepted manifest member");
  const blocks = member.blocks.slice(0, 3);
  assert(blocks.length >= 1 && blocks.length <= 100);
  assert.equal(new Set(blocks.map((block) => block.ordinal)).size, blocks.length);
  for (const block of blocks) {
    assert(Number.isSafeInteger(block.ordinal) && block.ordinal >= 0);
    assert(
      sourceA.source.data.blocks.some(
        (actual) => actual.id === block.source_block_id && actual.ordinal === block.ordinal,
      ),
    );
  }
  const before = await page.evaluate((id) => globalThis.aijian.getProductionBrief(id), projectId);
  if (before) assert.equal(before.data.project_id, projectId);
  const expectedContent = {
    schema_version: "1.0.0",
    creative_entry: {
      kind: "source_adaptation",
      adaptation_statement: "C3 adaptation",
      source_document_id: member.source_document_id,
      source_manifest_version_id: accepted.id,
      source_block_ids: blocks.map((block) => block.source_block_id),
    },
    creative: {
      premise: "adapted city",
      intent: "adapt intent",
      audience: "adult",
      genre: "drama",
      style: "noir",
      constraints: ["respect source", "retain chronology"],
    },
    delivery: {
      width_px: 1280,
      height_px: 720,
      language: "zh-CN",
      display_aspect_ratio: { num: 16, den: 9 },
      frame_rate: { num: 30000, den: 1001 },
    },
    duration_intent: { episode_mode: "per_episode", work_seconds: 180, episode_seconds: 60 },
    budget_intent: { state: "declared", amount_micros: 12345678, currency: "CNY" },
    rights_declaration: { state: "user_declared", statement: "synthetic adaptation rights" },
  };
  await page.getByRole("button", { name: "基于已批准来源改编", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "保存来源改编草稿", exact: true });
  const fields = {
    改编说明: expectedContent.creative_entry.adaptation_statement,
    "焦点区块序号（逗号分隔，1 至 100 个）": blocks.map((block) => block.ordinal).join(","),
    核心设定: "adapted city",
    创作意图: "adapt intent",
    "目标受众（可选）": "adult",
    "类型（可选）": "drama",
    "风格（可选）": "noir",
    "创作约束（每行一项，可选）": "respect source\nretain chronology",
    交付宽度: "1280",
    交付高度: "720",
    交付语言: "zh-CN",
    帧率分子: "30000",
    帧率分母: "1001",
    "整部时长（秒，可选）": "180",
    "单集时长（秒）": "60",
    "预算金额（最多 6 位小数）": "12.345678",
    "预算币种（ISO 3 位大写）": "CNY",
    权利声明: "synthetic adaptation rights",
  };
  for (const [label, value] of Object.entries(fields))
    await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByLabel("单集时长模式", { exact: true }).selectOption("按单集");
  await dialog.getByLabel("预算状态", { exact: true }).selectOption("已声明");
  await dialog.getByLabel("权利状态", { exact: true }).selectOption("用户声明");
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const current = await page.evaluate(
      (id) => globalThis.aijian.getProductionBrief(id),
      projectId,
    );
    if (current?.data.version.id && current.data.version.id !== before?.data.version.id) {
      assert.equal(current.data.project_id, projectId);
      assert.equal(current.data.version.parent_version_id, before?.data.version.id ?? null);
      assert.equal(current.data.head.revision, (before?.data.head.revision ?? 0) + 1);
      assert.equal(current.data.head.latest_version_id, current.data.version.id);
      assert.equal(current.data.head.artifact_id, current.data.version.artifact_id);
      assert.deepEqual(current.data.version.content, expectedContent);
      const stillAccepted = await page.evaluate(
        (id) => globalThis.aijian.getSourceManifest(id),
        projectId,
      );
      assert.deepEqual(stillAccepted.data.accepted_version, accepted);
      await assertBriefUi(page, current);
      await write(`adaptation-${current.data.version.id}-receipt.json`, {
        before,
        current,
        expectedContent,
        capturedMember: member,
        stillAccepted,
      });
      return current;
    }
    await wait(100);
  }
  throw new Error("timed out waiting for adaptation brief");
}

async function selectProjectThroughUi(page, project) {
  await page.getByLabel("作品选择", { exact: true }).selectOption({ label: project.name });
  await page.locator(".demo-root[data-page='project']").waitFor();
  await assertSelectedProject(page, project.id);
}
async function createEpisodeThroughUi(page, projectId, title) {
  await assertSelectedProject(page, projectId);
  const header = page.locator("header.topbar");
  await header.getByRole("button", { name: "新建剧集", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建剧集", exact: true });
  await dialog.getByLabel("剧集名称", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "创建剧集", exact: true }).click();
  const episode = await poll(async () => {
    const response = await page.evaluate((id) => globalThis.aijian.listEpisodes(id), projectId);
    const matches = response.data.filter((item) => item.title === title);
    assert(matches.length <= 1);
    return matches[0];
  }, "UI-created episode");
  assert.match(episode.id, /^ep_[0-9a-f]{32}$/);
  assert.equal(episode.project_id, projectId);
  await poll(
    async () =>
      (
        await header
          .getByLabel("剧集选择")
          .locator("option")
          .evaluateAll((options) => options.map((option) => option.value))
      ).includes(episode.id),
    "episode option",
  );
  return episode;
}
async function selectEpisodeThroughUi(page, projectId, episode) {
  await assertSelectedProject(page, projectId);
  const control = page.locator("header.topbar").getByLabel("剧集选择", { exact: true });
  await poll(async () => await control.isEnabled(), "episode selector ready");
  await control.selectOption(episode.id);
  await poll(
    async () => (await control.isEnabled()) && (await control.inputValue()) === episode.id,
    "episode selected",
  );
  const readback = await page.evaluate(
    ({ projectId, id }) => globalThis.aijian.getEpisode(projectId, id),
    { projectId, id: episode.id },
  );
  assert.equal(readback.data.project_id, projectId);
  assert.equal(readback.data.title, episode.title);
  assert.equal(readback.data.id, episode.id);
  return readback;
}
async function assertWorkspace(
  page,
  projectA,
  projectB,
  sourceA,
  sourceB,
  acceptedA,
  briefA,
  briefB,
) {
  const state = await page.evaluate(
    async ({ a, b }) => ({
      a: {
        source: await globalThis.aijian.getSourceManifest(a),
        brief: await globalThis.aijian.getProductionBrief(a),
        episodes: await globalThis.aijian.listEpisodes(a),
      },
      b: {
        source: await globalThis.aijian.getSourceManifest(b),
        brief: await globalThis.aijian.getProductionBrief(b),
        episodes: await globalThis.aijian.listEpisodes(b),
      },
    }),
    { a: projectA.id, b: projectB.id },
  );
  assert.notEqual(sourceA.source.data.id, sourceB.source.data.id);
  assert.deepEqual(state.a.source.data.accepted_version, acceptedA.accepted_version);
  assert.equal(state.b.source.data.head.accepted_version_id, null);
  assert.equal(state.b.source.data.latest_version.id, sourceB.manifest.data.latest_version.id);
  assert.deepEqual(state.a.brief.data, briefA.data);
  assert.deepEqual(state.b.brief.data, briefB.data);
  assert.notEqual(briefA.data.version.artifact_id, briefB.data.version.artifact_id);
  for (const [key, project] of [
    ["a", projectA],
    ["b", projectB],
  ]) {
    assert.equal(state[key].source.data.project_id, project.id);
    assert.equal(state[key].brief.data.project_id, project.id);
    for (const ep of state[key].episodes.data) assert.equal(ep.project_id, project.id);
  }
  return state;
}
async function restoredEpisodeThroughUi(page, project, episode) {
  await poll(async () => {
    const selection = await page.evaluate(() =>
      JSON.parse(globalThis.localStorage.getItem("aivora.c2b.workspace-selection.v1") ?? "null"),
    );
    return selection?.selection?.projectId === project.id ? selection : null;
  }, "persisted project restored");
  const persisted = await page.evaluate(() =>
    JSON.parse(globalThis.localStorage.getItem("aivora.c2b.workspace-selection.v1")),
  );
  assert.equal(persisted.selection.episodeId, episode.id);
  await poll(
    async () =>
      (await page.getByLabel("作品选择").locator("option").allTextContents()).includes(
        project.name,
      ),
    "restored project option",
  );
  await assertSelectedProject(page, project.id);
  // The initial launch page hides the episode header. Reopening the selected project preserves its persisted episode.
  if (!(await page.locator("header.topbar").getByLabel("剧集选择").isVisible()))
    await selectProjectThroughUi(page, project);
  const control = page.locator("header.topbar").getByLabel("剧集选择");
  await poll(async () => await control.isEnabled(), "restored episode ready");
  assert.equal(await control.inputValue(), episode.id);
  await navigateSource(page, project.id);
  assert.equal(await control.inputValue(), episode.id);
}
async function measureSourceControls(page, app, label) {
  await page.locator(".demo-root[data-page='source']").waitFor();
  const window = await app.browserWindow(page);
  for (const size of [
    { width: 1440, height: 920 },
    { width: 980, height: 680 },
  ]) {
    await window.evaluate(
      (nativeWindow, viewport) => nativeWindow.setContentSize(viewport.width, viewport.height),
      size,
    );
    await poll(
      async () =>
        await page.evaluate(
          ({ width, height }) =>
            globalThis.innerWidth === width && globalThis.innerHeight === height,
          size,
        ),
      "actual inner viewport",
    );
    const controls = [
      page.getByRole("button", { name: "粘贴故事", exact: true }),
      page.getByRole("button", { name: "基于已批准来源改编", exact: true }),
      page.getByRole("button", { name: "刷新来源状态", exact: true }),
    ];
    const geometry = [];
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded();
      const measurement = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const scroll = globalThis.document.getElementById("demo-scroll");
        const x = rect.left + rect.width / 2,
          y = rect.top + rect.height / 2;
        const hit = globalThis.document.elementFromPoint(x, y);
        return {
          name: element.textContent,
          innerWidth: globalThis.innerWidth,
          innerHeight: globalThis.innerHeight,
          rect: rect.toJSON(),
          reachable: !!hit && (hit === element || element.contains(hit)),
          hit: hit?.tagName,
          documentWidth: globalThis.document.documentElement.scrollWidth,
          scroll: scroll
            ? {
                scrollTop: scroll.scrollTop,
                scrollHeight: scroll.scrollHeight,
                clientHeight: scroll.clientHeight,
                scrollWidth: scroll.scrollWidth,
                clientWidth: scroll.clientWidth,
                rect: scroll.getBoundingClientRect().toJSON(),
              }
            : null,
        };
      });
      geometry.push(measurement);
      assert(measurement.reachable, "real StoryPages control obscured");
      assert(measurement.rect.width > 0 && measurement.rect.height > 0);
      assert(measurement.documentWidth <= measurement.innerWidth);
      assert(
        measurement.scroll && measurement.scroll.scrollWidth <= measurement.scroll.clientWidth,
      );
    }
    await write(label + "-" + size.width + "x" + size.height + "-geometry.json", geometry);
    await page.screenshot({
      path: join(evidence, label + "-" + size.width + "x" + size.height + ".png"),
    });
  }
  await window.dispose();
}
const SQLITE_INSPECTION = String.raw`
import json, pathlib, sqlite3, sys
database, expected_file = sys.argv[1:]
expected = json.loads(pathlib.Path(expected_file).read_text(encoding="utf-8"))
connection = sqlite3.connect(pathlib.Path(database).resolve().as_uri() + "?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
def rows(sql, args):
    return [dict(row) for row in connection.execute(sql, args)]
output = {"sources": [], "versions": [], "heads": [], "writes": [], "episodes": [], "briefCounts": [], "review": {}}
for source in expected["sources"]:
    sid, project = source["data"]["id"], source["data"]["project_id"]
    output["sources"].append({
        "document": rows("SELECT * FROM source_documents WHERE id=? AND project_id=?", (sid, project)),
        "blocks": rows("SELECT * FROM source_blocks WHERE source_document_id=? AND project_id=? ORDER BY ordinal", (sid, project))
    })
for receipt in expected["briefs"]:
    data = receipt["data"]
    project, aid, vid = data["project_id"], data["version"]["artifact_id"], data["version"]["id"]
    output["versions"].extend(rows("SELECT v.*, a.project_id, a.artifact_type FROM artifact_versions v JOIN artifacts a USING(artifact_id) WHERE a.project_id=? AND v.artifact_id=? AND v.version_id=?", (project, aid, vid)))
    output["writes"].extend(rows("SELECT project_id, idempotency_key_hash, artifact_id, version_id, request_hash, created_at FROM production_brief_write_requests WHERE project_id=? AND artifact_id=? AND version_id=?", (project, aid, vid)))
for receipt in expected["latestBriefs"]:
    data = receipt["data"]
    output["heads"].extend(rows("SELECT h.*, a.project_id, a.artifact_type FROM artifact_heads h JOIN artifacts a USING(artifact_id) WHERE a.project_id=? AND h.artifact_id=?", (data["project_id"], data["version"]["artifact_id"])))
for receipt in expected["latestBriefs"]:
    data = receipt["data"]
    key = (data["project_id"], data["version"]["artifact_id"])
    output["briefCounts"].append({"project_id": key[0], "artifact_id": key[1],
        "versions": rows("SELECT COUNT(*) AS count FROM artifact_versions v JOIN artifacts a USING(artifact_id) WHERE a.project_id=? AND v.artifact_id=?", key)[0]["count"],
        "writes": rows("SELECT COUNT(*) AS count FROM production_brief_write_requests WHERE project_id=? AND artifact_id=?", key)[0]["count"]})
for episode in expected["episodes"]:
    output["episodes"].extend(rows("SELECT * FROM episodes WHERE project_id=? AND id=?", (episode["project_id"], episode["id"])))
a = expected["accepted"]
key = (a["head"]["artifact_id"], a["accepted_version"]["id"])
output["review"]["head"] = rows("SELECT * FROM artifact_heads WHERE artifact_id=?", key[:1])
output["review"]["version"] = rows("SELECT * FROM artifact_versions WHERE artifact_id=? AND version_id=?", key)
output["review"]["submissions"] = rows("SELECT * FROM review_submissions WHERE artifact_id=? AND version_id=? AND gate='G1'", key)
output["review"]["signoffs"] = rows("SELECT * FROM role_signoffs WHERE artifact_id=? AND version_id=? AND gate='G1'", key)
output["review"]["decisions"] = rows("SELECT * FROM gate_decisions WHERE artifact_id=? AND version_id=? AND gate='G1'", key)
output["review"]["reports"] = rows("SELECT * FROM gate_readiness_reports WHERE artifact_id=? AND version_id=? AND gate='G1'", key)
connection.close()
print(json.dumps(output, ensure_ascii=False))
`;
async function inspectSqlite(profile, state, label) {
  const expected = {
    sources: [state.sourceA.source, state.sourceB.source],
    briefs: state.briefs,
    latestBriefs: [state.briefA, state.briefB],
    episodes: state.episodes,
    accepted: state.acceptedA,
  };
  const expectedFile = join(evidence, label + "-sqlite-input.json");
  await writeFile(expectedFile, JSON.stringify(expected));
  const result = await recordedCommand(
    label + "-sqlite-readonly",
    python,
    [
      "-X",
      "utf8",
      "-c",
      SQLITE_INSPECTION,
      join(profile, "workspace/workspace.sqlite3"),
      expectedFile,
    ],
    root,
  );
  const actual = JSON.parse(result.stdout);
  await write(label + "-sqlite-snapshot.json", actual);
  actual.sources.forEach((row, index) => {
    const source = expected.sources[index];
    assert.equal(row.document.length, 1);
    const document = row.document[0];
    assert.equal(document.normalized_text, normalizedFixture(state.text));
    for (const key of ["id", "project_id", "raw_sha256", "byte_size", "filename"])
      assert.equal(document[key], source.data[key]);
    assert.deepEqual(
      row.blocks.map(({ source_document_id, project_id, ...block }) => {
        assert.equal(source_document_id, source.data.id);
        assert.equal(project_id, source.data.project_id);
        return block;
      }),
      source.data.blocks,
    );
  });
  for (const receipt of expected.briefs) {
    const data = receipt.data;
    const rows = actual.versions.filter((row) => row.version_id === data.version.id);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.project_id, data.project_id);
    assert.equal(row.artifact_type, "production_brief");
    assert.equal(row.artifact_id, data.version.artifact_id);
    assert.equal(row.parent_version_id, data.version.parent_version_id);
    assert.equal(row.content_hash, data.version.content_hash);
    assert.deepEqual(JSON.parse(row.content_json), data.version.content);
    const writes = actual.writes.filter((item) => item.version_id === row.version_id);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].project_id, data.project_id);
    assert.equal(writes[0].artifact_id, data.version.artifact_id);
    assert.match(writes[0].request_hash, /^sha256:[0-9a-f]{64}$/);
  }
  for (const receipt of expected.latestBriefs) {
    const head = actual.heads.find((row) => row.artifact_id === receipt.data.head.artifact_id);
    assert(head);
    for (const [key, value] of Object.entries(receipt.data.head))
      assert.equal(
        key === "updated_at" ? Date.parse(head[key]) : head[key],
        key === "updated_at" ? Date.parse(value) : value,
        "persisted head " + key,
      );
  }
  for (const counts of actual.briefCounts) {
    const expectedCount = expected.briefs.filter(
      (receipt) => receipt.data.version.artifact_id === counts.artifact_id,
    ).length;
    assert.equal(counts.versions, expectedCount, "unexpected brief version persisted");
    assert.equal(counts.writes, expectedCount, "unexpected brief write persisted");
  }
  for (const episode of expected.episodes) {
    const rows = actual.episodes.filter((row) => row.id === episode.id);
    assert.equal(rows.length, 1);
    const row = rows[0];
    for (const key of ["id", "project_id", "title"]) assert.equal(row[key], episode[key]);
    for (const key of ["position", "revision"])
      assert.equal(String(row[key]), String(episode[key]));
  }
  const review = actual.review;
  assert.equal(review.head.length, 1);
  assert.equal(review.version.length, 1);
  assert.equal(review.head[0].accepted_version_id, state.acceptedA.accepted_version.id);
  assert.equal(review.head[0].latest_version_id, state.acceptedA.latest_version.id);
  assert.deepEqual(
    JSON.parse(review.version[0].content_json),
    state.acceptedA.accepted_version.content,
  );
  assert.equal(review.version[0].content_hash, state.acceptedA.accepted_version.content_hash);
  assert.equal(review.submissions.length, 1);
  assert.equal(review.decisions.length, 1);
  const submission = review.submissions[0],
    decision = review.decisions[0];
  assert.equal(submission.submission_id, state.acceptedA.submittedHead.review_submission_id);
  assert.equal(review.head[0].review_version_id, null);
  assert.equal(review.head[0].review_submission_id, null);
  assert.equal(submission.submitted_by_actor_id, "local-user");
  assert.equal(decision.submission_id, submission.submission_id);
  assert.equal(decision.decision, "approved");
  assert.equal(decision.actor_id, "local-user");
  assert.equal(decision.actor_role, "producer");
  assert.equal(decision.rationale, "C3 normal native signoff");
  assert.equal(
    decision.self_review,
    Number(review.version[0].author_actor_id === decision.actor_id),
  );
  assert.deepEqual([...new Set(review.signoffs.map((item) => item.role))].sort(), [
    "producer",
    "writer",
  ]);
  for (const signoff of review.signoffs) {
    assert.equal(signoff.actor_id, "local-user");
    assert.equal(signoff.submission_id, submission.submission_id);
    assert.equal(
      signoff.self_review,
      Number(review.version[0].author_actor_id === signoff.actor_id),
    );
    // source-manifest-review.ts explicitly reuses the signed report for prepare/commit decision.
    assert.equal(signoff.readiness_report_id, decision.readiness_report_id);
  }
  for (const action of [submission, ...review.signoffs, decision]) {
    const report = review.reports.find((item) => item.report_id === action.readiness_report_id);
    assert(report);
    assert.match(report.report_hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(report.version_id, state.acceptedA.accepted_version.id);
    assert(report.head_revision <= state.acceptedA.head.revision);
  }
  await write(label + "-sqlite-assertions.json", {
    passed: true,
    sameLocalUserRoles: true,
    independentHumansClaimed: false,
  });
  return actual;
}

function processPathKey(value) {
  assert.equal(typeof value, "string", "process path must be a string");
  assert(isAbsolute(value), "process path must be absolute");
  return resolve(value).toLowerCase();
}
function validateProcessIdentity(raw, expected) {
  const { inspector, os } = raw;
  for (const pid of [expected.launcherPid, expected.observerPid, inspector?.pid])
    assert(Number.isSafeInteger(pid) && pid > 0, "positive process identity required");
  assert.equal(inspector.type, "browser", "main inspector process type");
  assert.equal(inspector.ppid, expected.launcherPid, "main inspector parent");
  assert.notEqual(
    inspector.pid,
    expected.launcherPid,
    "Windows main must be distinct from shell launcher",
  );
  assert.equal(os?.state, "READY");
  assert.equal(os.observerPid, expected.observerPid);
  assert.equal(os.launcherPid, expected.launcherPid);
  assert.equal(os.mainPid, inspector.pid);
  assert(Array.isArray(os.processes));
  const launchers = os.processes.filter((row) => row.ProcessId === expected.launcherPid);
  const mains = os.processes.filter((row) => row.ProcessId === inspector.pid);
  assert.equal(launchers.length, 1, "one OS launcher identity required");
  assert.equal(mains.length, 1, "one OS main identity required");
  const main = mains[0],
    launcher = launchers[0];
  assert.equal(main.ParentProcessId, expected.launcherPid, "main parent must be this launcher");
  const exe = processPathKey(expected.executable);
  assert.equal(processPathKey(main.ExecutablePath), exe, "main executable");
  assert.equal(processPathKey(inspector.execPath), exe, "inspector executable");
  assert.equal(
    processPathKey(inspector.userData),
    processPathKey(expected.profile),
    "inspector profile",
  );
  const candidates = os.processes.filter(
    (row) =>
      row.ParentProcessId === expected.launcherPid &&
      row.ExecutablePath &&
      processPathKey(row.ExecutablePath) === exe,
  );
  assert.equal(candidates.length, 1, "one Electron child under this launcher required");
  for (const argv of [main.argv, inspector.argv]) {
    assert(
      Array.isArray(argv) && argv.every((arg) => typeof arg === "string"),
      "real parsed argv required",
    );
    assert.equal(processPathKey(argv[0]), exe, "argv executable");
    assert.equal(
      argv.filter(
        (arg) => isAbsolute(arg) && processPathKey(arg) === processPathKey(expected.desktop),
      ).length,
      1,
      "owned desktop entry argument",
    );
    const profiles = argv.filter((arg) => /^--user-data-dir(?:=|$)/i.test(arg));
    assert.equal(profiles.length, 1, "one owned profile argument");
    assert(profiles[0].startsWith("--user-data-dir="), "explicit profile argument");
    assert.equal(
      processPathKey(profiles[0].slice("--user-data-dir=".length)),
      processPathKey(expected.profile),
      "argv profile",
    );
    assert(
      !argv.some((arg) => /^--type(?:=|$)/i.test(arg) || /aivora-app-ui/i.test(arg)),
      "main process mode",
    );
  }
  assert.equal(os.handle?.pid, inspector.pid, "retained OS handle PID");
  assert.equal(processPathKey(os.handle.executable), exe, "retained handle executable");
  const creation = Date.parse(main.CreationDate),
    handleCreation = Date.parse(os.handle.startUtc);
  assert(Number.isFinite(creation) && Number.isFinite(handleCreation));
  assert(Math.abs(creation - handleCreation) <= 1, "handle creation identity mismatch");
  assert(
    Number.isFinite(Date.parse(launcher.CreationDate)) &&
      creation >= Date.parse(launcher.CreationDate),
    "main created after launcher",
  );
  return Object.freeze({
    launcherPid: expected.launcherPid,
    mainPid: inspector.pid,
    observerPid: expected.observerPid,
    startUtc: os.handle.startUtc,
    executable: expected.executable,
    profile: expected.profile,
  });
}
function validateMainProcessExit(identity, terminal) {
  assert(identity, "verified main identity missing at close");
  assert.equal(
    terminal?.outcome,
    "MAIN_EXIT_OBSERVED",
    "main exit must be observed through retained handle",
  );
  for (const key of ["mainPid", "launcherPid", "observerPid", "startUtc"])
    assert.equal(terminal[key], identity[key], "main exit bound identity: " + key);
  assert.equal(terminal.hasExited, true, "main exit not established");
  assert.equal(terminal.exitCode, 0, "Electron main exit must be 0");
  return terminal;
}
function buildMainProcessObserverScript(config) {
  const literal = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  return String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$cfg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${literal}')) | ConvertFrom-Json
$utf8 = [Text.UTF8Encoding]::new($false)
$target = $null
$raw = [ordered]@{state='STARTING';observerPid=[Diagnostics.Process]::GetCurrentProcess().Id;launcherPid=$cfg.launcherPid;mainPid=$cfg.mainPid;handle=$null;processes=@();error=$null}
$terminal = [ordered]@{outcome='UNKNOWN';observerPid=$raw.observerPid;launcherPid=$cfg.launcherPid;mainPid=$cfg.mainPid;startUtc=$null;hasExited=$false;exitCode=$null;error=$null}
function SaveRecord($path, $record) {
  $temporary = $path + '.writing'
  $json = ConvertTo-Json -InputObject $record -Depth 16 -Compress
  [IO.File]::WriteAllText($temporary, $json, $utf8)
  [IO.File]::Move($temporary, $path)
  if ([IO.File]::ReadAllText($path, $utf8) -cne $json) { throw 'Process evidence readback mismatch' }
}
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class C3ProcessArguments {
  [DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  public static string[] Parse(string commandLine) {
    int count; IntPtr pointer = CommandLineToArgvW(commandLine, out count);
    if (pointer == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    try {
      string[] result = new string[count];
      for (int index=0; index<count; index++) result[index] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer, index*IntPtr.Size));
      return result;
    } finally { LocalFree(pointer); }
  }
}
'@
  $target = [Diagnostics.Process]::GetProcessById([int]$cfg.mainPid)
  $boundHandle = $target.Handle
  if ($boundHandle -eq [IntPtr]::Zero -or $target.HasExited) { throw 'Main handle unavailable or already exited' }
  $raw.handle = [ordered]@{pid=$target.Id;executable=$target.MainModule.FileName;startUtc=$target.StartTime.ToUniversalTime().ToString('o')}
  $terminal.startUtc = $raw.handle.startUtc
  $filter = 'ProcessId = ' + [int]$cfg.launcherPid + ' OR ProcessId = ' + [int]$cfg.mainPid + ' OR ParentProcessId = ' + [int]$cfg.launcherPid
  $rows = @(Get-CimInstance Win32_Process -Filter $filter)
  foreach ($row in $rows) {
    $raw.processes += [ordered]@{ProcessId=[int]$row.ProcessId;ParentProcessId=[int]$row.ParentProcessId;ExecutablePath=$row.ExecutablePath;CommandLine=$row.CommandLine;CreationDate=$row.CreationDate.ToUniversalTime().ToString('o');argv=@([C3ProcessArguments]::Parse($row.CommandLine))}
  }
  $raw.state = 'READY'
  SaveRecord $cfg.readyPath $raw
  $commandWatch = [Diagnostics.Stopwatch]::StartNew()
  while (-not [IO.File]::Exists($cfg.commandPath)) {
    if ($commandWatch.ElapsedMilliseconds -ge 900000) { throw 'Main observer session command timeout' }
    Start-Sleep -Milliseconds 50
  }
  if ([IO.File]::ReadAllText($cfg.commandPath, $utf8) -cne 'observe-exit') { throw 'Main observer close command mismatch' }
  if (-not $target.WaitForExit([int]$cfg.timeoutMs)) {
    $terminal.outcome = 'MAIN_EXIT_TIMEOUT'
    throw 'Electron main did not exit before observer deadline; process retained'
  }
  $terminal.hasExited = $target.HasExited
  $terminal.exitCode = $target.ExitCode
  $terminal.outcome = 'MAIN_EXIT_OBSERVED'
} catch {
  $raw.error = $_.Exception.ToString()
  $terminal.error = $raw.error
  if ($raw.state -ne 'READY') { $raw.state = 'FAILED' }
} finally {
  if (-not [IO.File]::Exists($cfg.readyPath)) { SaveRecord $cfg.readyPath $raw }
  SaveRecord $cfg.terminalPath $terminal
  if ($null -ne $target) { $target.Dispose() }
}
if ($terminal.outcome -ne 'MAIN_EXIT_OBSERVED') { exit 1 }
exit 0
`;
}
function startMainProcessObserver(script, paths, label) {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
  const observer = spawn(pwsh, args, {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    spawnError,
    finished = false;
  observer.stdout.setEncoding("utf8");
  observer.stderr.setEncoding("utf8");
  observer.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  observer.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((complete) => {
    observer.once("error", (error) => {
      spawnError = error;
    });
    observer.once("close", (code, signal) => {
      finished = true;
      complete({ code, signal });
    });
  }).then(async (result) => {
    await writeFile(join(evidence, label + "-main-observer.stdout.txt"), stdout);
    await writeFile(join(evidence, label + "-main-observer.stderr.txt"), stderr);
    await write(label + "-main-observer-command.json", {
      command: pwsh,
      args,
      cwd: root,
      observerPid: observer.pid,
      ...result,
      spawnError: spawnError && errorData(spawnError),
    });
    return result;
  });
  // Every completion is handled, including failure before caller requests exit observation.
  done.catch(() => {});
  async function readRecord(path) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  return {
    pid: observer.pid,
    async ready() {
      const end = Date.now() + 30000;
      do {
        const raw = await readRecord(paths.readyPath);
        if (raw) return raw;
        if (finished) throw new Error("Main observer exited before identity evidence");
        await wait(50);
      } while (Date.now() < end);
      throw new Error("Main observer identity timeout; no main ownership accepted");
    },
    async observeExit() {
      let timer;
      const errors = [];
      try {
        await writeFile(paths.commandPath + ".writing", "observe-exit", { flag: "wx" });
        await rename(paths.commandPath + ".writing", paths.commandPath);
        const result = await Promise.race([
          done,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Main exit observer transport timeout; processes retained")),
              CLOSE_TIMEOUT_MS + 3000,
            );
          }),
        ]);
        const terminal = await readRecord(paths.terminalPath);
        await write(label + "-main-exit-raw.json", {
          terminal,
          transport: result,
          observerPid: observer.pid,
        });
        if (spawnError) errors.push(spawnError);
        if (result.code !== 0 || result.signal !== null)
          errors.push(new Error("Main exit observer failed: " + JSON.stringify(result)));
        if (!terminal) errors.push(new Error("Main exit evidence missing"));
        throwCollected(errors, "Main exit observation errors");
        return terminal;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
async function captureProcessIdentity(app, profile, label, lifecycle, context) {
  const inspector = await app.evaluate(({ app: nativeApp }) => ({
    userData: nativeApp.getPath("userData"),
    versions: process.versions,
    pid: process.pid,
    type: process.type,
    ppid: process.ppid,
    execPath: process.execPath,
    argv: process.argv,
  }));
  context.inspector = inspector;
  await write(label + "-process-inspector-raw.json", {
    launcherPid: context.launcherPid,
    inspector,
  });
  assert(Number.isSafeInteger(inspector.pid) && inspector.pid > 0, "main inspector PID required");
  const owned = await ownedRunDirectory(root, evidence);
  const directory = await mkdtemp(join(owned.run, "main-process-"));
  const paths = {
    readyPath: join(directory, "identity.json"),
    terminalPath: join(directory, "exit.json"),
    commandPath: join(directory, "close-request.txt"),
  };
  const script = buildMainProcessObserverScript({
    launcherPid: context.launcherPid,
    mainPid: inspector.pid,
    ...paths,
    timeoutMs: CLOSE_TIMEOUT_MS,
  });
  await writeFile(join(directory, "observer.ps1"), script);
  context.mainObserver = startMainProcessObserver(script, paths, label);
  lifecycle.processIdentity = {
    launcherPid: context.launcherPid,
    inspectorMainPid: inspector.pid,
    observerPid: context.mainObserver.pid,
    paths,
    status: "UNVERIFIED",
  };
  await write(label + "-process-observer-start.json", lifecycle.processIdentity);
  const os = await context.mainObserver.ready();
  await write(label + "-process-identity-raw.json", { inspector, os });
  const canonicalPath = async (path) => await realpath(path);
  const canonicalArgs = async (argv) =>
    await Promise.all(
      argv.map(async (arg) => {
        if (arg.startsWith("--user-data-dir="))
          return "--user-data-dir=" + (await canonicalPath(arg.slice("--user-data-dir=".length)));
        return isAbsolute(arg) ? await canonicalPath(arg) : arg;
      }),
    );
  const expected = {
    launcherPid: context.launcherPid,
    observerPid: context.mainObserver.pid,
    executable: await canonicalPath(electronPath),
    desktop: await canonicalPath(desktop),
    profile: await canonicalPath(profile),
  };
  const normalized = {
    inspector: {
      ...inspector,
      execPath: await canonicalPath(inspector.execPath),
      userData: await canonicalPath(inspector.userData),
      argv: await canonicalArgs(inspector.argv),
    },
    os: {
      ...os,
      handle: os.handle && { ...os.handle, executable: await canonicalPath(os.handle.executable) },
      processes: await Promise.all(
        os.processes.map(async (row) => ({
          ...row,
          ExecutablePath: row.ExecutablePath
            ? await canonicalPath(row.ExecutablePath)
            : row.ExecutablePath,
          argv: row.ProcessId === inspector.pid ? await canonicalArgs(row.argv) : row.argv,
        })),
      ),
    },
  };
  await write(label + "-process-identity-canonical.json", { expected, normalized });
  context.identity = validateProcessIdentity(normalized, expected);
  lifecycle.processIdentity = {
    ...lifecycle.processIdentity,
    status: "VERIFIED",
    ...context.identity,
  };
  await write(label + "-process-identity-verified.json", lifecycle.processIdentity);
  return context.identity;
}

function validatePreloadObservation(observation, expected) {
  assert.equal(
    observation.electronVersion,
    "43.2.0",
    "Electron private preload observer is pinned to 43.2.0",
  );
  assert.equal(observation.methodType, "function", "Electron 43.2.0 _getPreloadScript unavailable");
  assert.equal(observation.methodError, null, "Electron preload observation failed");
  assert.equal(observation.preferences.contextIsolation, true);
  assert.equal(observation.preferences.nodeIntegration, false);
  assert.equal(observation.preferences.sandbox, true);
  const preload = observation.preload;
  assert(preload && typeof preload === "object", "runtime preload result missing");
  assert.equal(typeof preload.filePath, "string");
  assert(isAbsolute(preload.filePath), "runtime preload path must be absolute");
  assert.equal(preload.filePath, expected.preloadPath, "runtime preload path");
  assert.equal(preload.type, "frame", "runtime preload type");
  assert.equal(preload.id, "", "Electron 43.2.0 WebContents preload id");
  assert.equal(observation.session.methodType, "function", "session preload observer unavailable");
  assert.equal(observation.session.error, null, "session preload observation failed");
  assert(Array.isArray(observation.session.scripts), "session preload result must be an array");
  for (const script of observation.session.scripts) {
    assert(script && typeof script === "object");
    assert.equal(typeof script.type, "string");
    if (script.type === "frame")
      throw new Error("unexplained additional session frame preload: " + String(script.filePath));
  }
  return preload;
}

async function captureRuntime(app, page, profile, label, processContext) {
  assert.equal(resolve(fileURLToPath(page.url().split("#")[0])), resolve(web, "dist/index.html"));
  const renderer = await page.evaluate(async () => ({
    url: globalThis.location.href,
    origin: globalThis.location.origin,
    topLevel: globalThis.top === globalThis,
    process: typeof globalThis.process,
    require: typeof globalThis.require,
    bridgeMethods: Object.keys(globalThis.aijian),
    health: await globalThis.aijian.health(),
  }));
  assert(renderer.topLevel);
  assert.equal(renderer.process, "undefined");
  assert.equal(renderer.require, "undefined");
  for (const method of [
    "listProjects",
    "listSources",
    "getSource",
    "getSourceManifest",
    "getProductionBrief",
    "getProductionBriefVersion",
    "listEpisodes",
    "getEpisode",
  ])
    assert(renderer.bridgeMethods.includes(method), "secure bridge read method missing: " + method);
  assert.equal(renderer.health.data.status, "ok");
  assert.equal(renderer.health.data.service, "aijian-api");
  const mainRuntime = processContext.inspector;
  const processIdentity = processContext.identity;
  assert(processIdentity, "validated main identity required before runtime checks");
  assert.equal(mainRuntime.pid, processIdentity.mainPid);
  assert.equal(resolve(mainRuntime.userData), resolve(profile));
  const nativeWindow = await app.browserWindow(page);
  let runtimePreloadObservation;
  try {
    runtimePreloadObservation = await nativeWindow.evaluate((window) => {
      const webContents = window.webContents;
      const observation = {
        electronVersion: process.versions.electron,
        preferences: webContents.getLastWebPreferences(),
        methodType: typeof webContents._getPreloadScript,
        methodError: null,
        preload: null,
        session: {
          methodType: typeof webContents.session?.getPreloadScripts,
          error: null,
          scripts: null,
        },
      };
      try {
        if (observation.electronVersion !== "43.2.0")
          observation.methodError = "Electron version guard: " + observation.electronVersion;
        else if (observation.methodType === "function")
          observation.preload = webContents._getPreloadScript();
      } catch (error) {
        observation.methodError = String(error?.stack ?? error);
      }
      try {
        if (observation.session.methodType === "function")
          observation.session.scripts = webContents.session.getPreloadScripts();
      } catch (error) {
        observation.session.error = String(error?.stack ?? error);
      }
      return observation;
    });
  } catch (error) {
    runtimePreloadObservation = {
      electronVersion: null,
      preferences: null,
      methodType: null,
      methodError: String(error?.stack ?? error),
      preload: null,
      session: { methodType: null, error: null, scripts: null },
    };
  }
  await write(label + "-runtime-preload-raw.json", {
    renderer,
    mainRuntime,
    processIdentity,
    runtimePreloadObservation,
  });
  const canonicalPreloadPath = await realpath(join(desktop, "dist/preload.js"));
  const rawPreloadPath = runtimePreloadObservation.preload?.filePath;
  assert(
    typeof rawPreloadPath === "string" && isAbsolute(rawPreloadPath),
    "runtime preload path must be absolute before canonicalization",
  );
  const canonicalPreloadObservation = {
    ...runtimePreloadObservation,
    preload:
      runtimePreloadObservation.preload &&
      typeof runtimePreloadObservation.preload.filePath === "string"
        ? {
            ...runtimePreloadObservation.preload,
            filePath: await realpath(runtimePreloadObservation.preload.filePath),
          }
        : runtimePreloadObservation.preload,
    session: {
      ...runtimePreloadObservation.session,
      scripts: Array.isArray(runtimePreloadObservation.session.scripts)
        ? await Promise.all(
            runtimePreloadObservation.session.scripts.map(async (script) =>
              script && typeof script.filePath === "string"
                ? { ...script, filePath: await realpath(script.filePath) }
                : script,
            ),
          )
        : runtimePreloadObservation.session.scripts,
    },
  };
  const runtimePreload = validatePreloadObservation(canonicalPreloadObservation, {
    preloadPath: canonicalPreloadPath,
  });
  await write(label + "-runtime-preload-verified.json", {
    electronVersion: canonicalPreloadObservation.electronVersion,
    preload: runtimePreload,
    sessionScripts: canonicalPreloadObservation.session.scripts,
  });
  assert.equal(canonicalPreloadObservation.preferences.contextIsolation, true);
  assert.equal(canonicalPreloadObservation.preferences.nodeIntegration, false);
  assert.equal(canonicalPreloadObservation.preferences.sandbox, true);
  await nativeWindow.dispose();
  const childScript =
    "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter 'ParentProcessId = " +
    processIdentity.mainPid +
    "' | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Depth 4";
  const processes = await recordedCommand(
    label + "-child-processes",
    pwsh,
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(childScript, "utf16le").toString("base64"),
    ],
    root,
  );
  const children = JSON.parse(processes.stdout);
  const childList = Array.isArray(children) ? children : [children];
  const sidecars = childList.filter(
    (item) => item && /aijian_api\.sidecar/.test(item.CommandLine ?? ""),
  );
  assert.equal(sidecars.length, 1, "one actual Python sidecar child required");
  assert.equal(resolve(sidecars[0].ExecutablePath).toLowerCase(), resolve(python).toLowerCase());
  await write(label + "-runtime.json", {
    renderer,
    mainRuntime,
    processIdentity,
    preferences: canonicalPreloadObservation.preferences,
    sidecar: sidecars[0],
  });
  return { renderer, mainRuntime, processIdentity, sidecar: sidecars[0] };
}
async function runSession(profile, baseline, label, body) {
  await compareBaseline(baseline, label + "-prelaunch");
  const lifecycle = { runId, profile, label };
  const app = await launchProfile(profile, lifecycle);
  const phaseErrors = [];
  const processContext = { launcherPid: app.process().pid };
  let value;
  try {
    await captureProcessIdentity(app, profile, label, lifecycle, processContext);
    const page = await app.firstWindow({ timeout: 30000 });
    page.setDefaultTimeout(30000);
    await page.waitForLoadState("domcontentloaded");
    await captureRuntime(app, page, profile, label, processContext);
    value = await body(app, page, processContext.identity);
  } catch (error) {
    phaseErrors.push(error);
    try {
      const page = app.windows()[0];
      if (page) await page.screenshot({ path: join(evidence, label + "-failure.png") });
    } catch (captureError) {
      phaseErrors.push(captureError);
      try {
        await write(label + "-capture-error.json", {
          error: String(captureError.stack ?? captureError),
        });
      } catch (writeError) {
        phaseErrors.push(writeError);
      }
    }
    try {
      await write(label + "-phase-error.json", { error: String(error.stack ?? error) });
    } catch (writeError) {
      phaseErrors.push(writeError);
    }
  }
  const priorError =
    phaseErrors.length > 1
      ? new AggregateError(phaseErrors, label + ": phase and diagnostic failures", {
          cause: phaseErrors[0],
        })
      : phaseErrors[0];
  const terminalErrors = [];
  try {
    await normalClose(app, label, lifecycle, {
      timeoutMs: CLOSE_TIMEOUT_MS,
      writeEvidence: write,
      priorError,
      processIdentity: processContext.identity,
      mainObserver: processContext.mainObserver,
    });
  } catch (error) {
    terminalErrors.push(error);
  }
  // Read-only failure-finalization must run even when close rethrows the phase error.
  try {
    await compareBaseline(baseline, label + "-postclose");
  } catch (error) {
    terminalErrors.push(error);
  }
  try {
    await write(label + "-session-terminal.json", {
      processIdentity: lifecycle.processIdentity ?? {
        launcherPid: processContext.launcherPid,
        status: "UNVERIFIED",
      },
      close: lifecycle.close,
      errors: terminalErrors.map(errorData),
      fullC3NativeAccepted: false,
    });
  } catch (error) {
    terminalErrors.push(error);
  }
  throwCollected(terminalErrors, label + ": phase/close and readonly finalization failures");
  return value;
}
async function main() {
  await mkdir(evidence, { recursive: true });
  const baseline = await verifyAcceptedSourcesAndBuild();
  const text = normalMaterial();
  const material = {
    codePoints: [...text].length,
    bytes: Buffer.byteLength(text),
    raw_sha256: createHash("sha256").update(text).digest("hex"),
    normalized_sha256: createHash("sha256").update(normalizedFixture(text)).digest("hex"),
    sentinels: ["HEAD-C3-START", "MIDDLE-C3-MK", "TAIL-C3-END"],
  };
  assert(material.codePoints >= 19900 && material.codePoints <= 20100);
  assert(material.bytes < 5 * 1024 * 1024);
  for (const marker of material.sentinels) assert(text.includes(marker));
  await writeFile(join(evidence, "original-material.txt"), text);
  await write("material.json", material);
  const profile = await mkdtemp(join(root, ".aijian-dev", "c3-native-profile-"));
  await write("owned-profile.json", {
    runId,
    profile,
    retainedOnSuccess: true,
    retainedOnFailure: true,
  });
  const state = { text, episodes: [], briefs: [] };
  await runSession(profile, baseline, "session-1", async (app, page, processIdentity) => {
    state.projectA = await createProjectThroughUi(page, "C3 原作 A " + runId);
    await measureSourceControls(page, app, "source-before-import");
    state.sourceA = await importSourceThroughUi(
      page,
      state.projectA.id,
      text,
      "c3-original-a.txt",
      "file",
    );
    state.acceptedA = await reviewAndApproveThroughUi(page, processIdentity, {
      project_id: state.projectA.id,
      version_id: state.sourceA.manifest.data.latest_version.id,
      content_hash: state.sourceA.manifest.data.latest_version.content_hash,
      expected_revision: state.sourceA.manifest.data.head.revision,
    });
    const first = await createEpisodeThroughUi(page, state.projectA.id, "C3 first episode");
    const second = await createEpisodeThroughUi(page, state.projectA.id, "C3 second episode");
    assert.notEqual(first.id, second.id);
    state.episodes = [first, second];
    await selectEpisodeThroughUi(page, state.projectA.id, first);
    const firstBrief = await saveAdaptationThroughUi(
      page,
      state.projectA.id,
      state.sourceA,
      state.acceptedA,
    );
    state.briefs.push(firstBrief);
    await selectEpisodeThroughUi(page, state.projectA.id, second);
    const shared = await page.evaluate(
      (id) => globalThis.aijian.getProductionBrief(id),
      state.projectA.id,
    );
    assert.deepEqual(shared.data, firstBrief.data);
    state.briefA = await saveAdaptationThroughUi(
      page,
      state.projectA.id,
      state.sourceA,
      state.acceptedA,
    );
    assert.equal(state.briefA.data.version.artifact_id, firstBrief.data.version.artifact_id);
    state.briefs.push(state.briefA);
    await measureSourceControls(page, app, "source-approved");
    state.projectB = await createProjectThroughUi(page, "C3 原作 B " + runId);
    state.sourceB = await importSourceThroughUi(
      page,
      state.projectB.id,
      text,
      "c3-original-b.txt",
      "paste",
    );
    assert.notEqual(state.sourceB.source.data.id, state.sourceA.source.data.id);
    state.declaredBrief = await saveOriginalThroughUi(page, state.projectB.id, true);
    state.briefB = await saveOriginalThroughUi(page, state.projectB.id, false);
    state.briefs.push(state.declaredBrief, state.briefB);
    const immutableDeclared = await page.evaluate(
      ({ projectId, versionId }) =>
        globalThis.aijian.getProductionBriefVersion(projectId, versionId),
      { projectId: state.projectB.id, versionId: state.declaredBrief.data.version.id },
    );
    assert.deepEqual(immutableDeclared.data.version, state.declaredBrief.data.version);
    await write("original-version-immutability.json", {
      declared: state.declaredBrief,
      unknown: state.briefB,
      immutableDeclared,
    });
    await assertWorkspace(
      page,
      state.projectA,
      state.projectB,
      state.sourceA,
      state.sourceB,
      state.acceptedA,
      state.briefA,
      state.briefB,
    );
    await selectProjectThroughUi(page, state.projectA);
    await selectEpisodeThroughUi(page, state.projectA.id, first);
    await navigateSource(page, state.projectA.id);
    await write("before-first-close.json", state);
  });
  await inspectSqlite(profile, state, "after-first-close");
  await runSession(profile, baseline, "session-2", async (app, page) => {
    await restoredEpisodeThroughUi(page, state.projectA, state.episodes[0]);
    await assertBriefUi(page, state.briefA);
    await assertWorkspace(
      page,
      state.projectA,
      state.projectB,
      state.sourceA,
      state.sourceB,
      state.acceptedA,
      state.briefA,
      state.briefB,
    );
    await selectEpisodeThroughUi(page, state.projectA.id, state.episodes[1]);
    const shared = await page.evaluate(
      (id) => globalThis.aijian.getProductionBrief(id),
      state.projectA.id,
    );
    assert.deepEqual(shared.data, state.briefA.data);
    await measureSourceControls(page, app, "source-first-reopen");
    await write("before-second-close.json", { selectedEpisode: state.episodes[1], shared });
  });
  await inspectSqlite(profile, state, "after-second-close");
  await runSession(profile, baseline, "session-3", async (app, page) => {
    await restoredEpisodeThroughUi(page, state.projectA, state.episodes[1]);
    await assertBriefUi(page, state.briefA);
    await assertWorkspace(
      page,
      state.projectA,
      state.projectB,
      state.sourceA,
      state.sourceB,
      state.acceptedA,
      state.briefA,
      state.briefB,
    );
    await selectProjectThroughUi(page, state.projectB);
    await navigateSource(page, state.projectB.id);
    await page.getByRole("button", { name: "粘贴故事", exact: true }).click();
    const original = await page.evaluate(
      (id) => globalThis.aijian.getProductionBrief(id),
      state.projectB.id,
    );
    assert.deepEqual(original.data.version.content, state.briefB.data.version.content);
    await assertBriefUi(page, original);
    await measureSourceControls(page, app, "original-second-reopen");
    await selectProjectThroughUi(page, state.projectA);
    await selectEpisodeThroughUi(page, state.projectA.id, state.episodes[1]);
    await navigateSource(page, state.projectA.id);
    const source = await page.evaluate(
      ({ projectId, id }) => globalThis.aijian.getSource(projectId, id),
      { projectId: state.projectA.id, id: state.sourceA.source.data.id },
    );
    assertSource(source, state.projectA.id, text);
  });
  await inspectSqlite(profile, state, "after-final-close");
  await compareBaseline(baseline, "postrun");
  await write("result.json", {
    runId,
    profile,
    normalPathPassed: true,
    normalCloseSessions: 3,
    reopenCycles: 2,
    recoveryFaultCases: {
      productionBriefUnknown: "NOT_EXECUTED",
      sourceManifestReadError: "NOT_EXECUTED",
      interruptedWritesAndRecovery: "NOT_EXECUTED",
    },
    fullC3NativeAccepted: false,
    independentHumansClaimed: false,
  });
}
main().catch(async (error) => {
  try {
    await mkdir(evidence, { recursive: true });
    await write("failure.json", {
      runId,
      message: String(error?.stack ?? error),
      errors:
        error instanceof AggregateError
          ? error.errors.map((item) => String(item.stack ?? item))
          : undefined,
      normalPathPassed: false,
      fullC3NativeAccepted: false,
      profilesRetained: true,
    });
  } finally {
    process.exitCode = 1;
  }
});
