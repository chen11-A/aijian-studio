"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const qa = __dirname;
const run = path.join(qa, "run-01");
const dist = path.join(run, "dist");
const tempRoot = "C:\\Users\\Administrator\\AppData\\Local\\Temp\\Q3R1";
const profile = path.join(tempRoot, "profile");
const local = path.join(profile, "AppData", "Local");
const {createSidecarExtractionTemp} = require(path.join(dist, "sidecar-extraction-temp.js"));
const {startSidecar, SidecarStartupError} = require(path.join(dist, "sidecar-process.js"));
const results = [];
function record(name, details) {
  results.push({name, ...details});
  fs.writeFileSync(path.join(run, "runtime-progress.json"), JSON.stringify(results, null, 2) + "\n");
}
async function main() {
  assert.equal(fs.existsSync(tempRoot), false, "short QA temp must be fresh");
  fs.mkdirSync(local, {recursive: true});
  const first = createSidecarExtractionTemp(local, profile);
  const second = createSidecarExtractionTemp(local, profile);
  assert.notEqual(first.directory, second.directory);
  assert.equal(fs.existsSync(first.directory), true);
  assert.equal(fs.existsSync(second.directory), true);
  assert.equal(fs.existsSync(path.join(first.directory, "probe")), false);
  first.cleanupAfterClose();
  assert.equal(fs.existsSync(first.directory), false);
  assert.equal(fs.existsSync(second.directory), true);
  second.cleanupAfterClose();
  assert.equal(fs.existsSync(second.directory), false);
  record("two_unique_wrappers_and_empty_cleanup", {pass:true, first:first.directory, second:second.directory});

  for (const [name, badLocal, badProfile] of [
    ["relative_rejected", "relative", profile],
    ["unc_rejected", "\\\\server\\share\\temp", profile],
    ["outside_profile_rejected", "C:\\outside", profile],
    ["long_parent_rejected", path.join(profile, "AppData", "Local", "x".repeat(70)), profile],
  ]) {
    assert.throws(() => createSidecarExtractionTemp(badLocal, badProfile));
    record(name, {pass:true});
  }

  const normal = createSidecarExtractionTemp(local, profile);
  const report = path.join(run, "child-env.json");
  const childScript = path.join(qa, "fake-child.cjs");
  const handle = await startSidecar({
    command: process.execPath,
    args: [childScript],
    cwd: qa,
    env: {TEMP: normal.directory, TMP: normal.directory, QA_REPORT_PATH: report},
    cleanupAfterClose: normal.cleanupAfterClose,
    startupTimeoutMs: 5000,
    shutdownTimeoutMs: 5000,
  });
  let env;
  let exited;
  try {
    env = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(env.TEMP, normal.directory);
    assert.equal(env.TMP, normal.directory);
    assert.equal(handle.session.pid, env.pid);
  } finally {
    await handle.stop();
    exited = await handle.exited;
  }
  assert.equal(exited.code, 0);
  assert.equal(fs.existsSync(normal.directory), false);
  record("child_env_eof_close_cleanup", {pass:true, pid:env.pid, exit:exited, directory:normal.directory});

  const bad = createSidecarExtractionTemp(local, profile);
  let startupError;
  try {
    await startSidecar({
      command: path.join(tempRoot, "missing-qa-child.exe"),
      args: [],
      cwd: qa,
      env: {TEMP:bad.directory,TMP:bad.directory},
      cleanupAfterClose: bad.cleanupAfterClose,
      startupTimeoutMs: 3000,
      shutdownTimeoutMs: 3000,
    });
    assert.fail("missing executable unexpectedly started");
  } catch (error) {
    startupError = error;
  }
  assert.equal(startupError instanceof SidecarStartupError, true);
  assert.equal(startupError.classification, "STARTUP_UNKNOWN");
  assert.equal(fs.existsSync(bad.directory), false);
  record("spawn_error_cleanup", {pass:true, classification:startupError.classification, directory:bad.directory});
  process.stdout.write(JSON.stringify({state:"PASS", results}) + "\n");
}
main().catch(error => {
  process.stderr.write(String(error?.stack || error) + "\n");
  process.exitCode = 1;
});



