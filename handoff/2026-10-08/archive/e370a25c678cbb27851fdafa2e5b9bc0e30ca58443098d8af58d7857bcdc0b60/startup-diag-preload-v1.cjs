/* QA02 startup diagnostics only. Loaded before the Electron main entry. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const directory = process.env.QA02_DIAG_DIR;
if (directory && (process.type === 'browser' || process.type === undefined)) {
  const eventsPath = path.join(directory, 'main-startup-events.jsonl');
  const mainOut = fs.openSync(path.join(directory, 'main.stdout.raw'), 'wx');
  const mainErr = fs.openSync(path.join(directory, 'main.stderr.raw'), 'wx');
  const record = (kind, data = {}) => {
    try {
      fs.appendFileSync(eventsPath, JSON.stringify({
        utc: new Date().toISOString(), kind, pid: process.pid, ...data,
      }) + '\n');
    } catch { /* Diagnostics must not alter product behavior. */ }
  };
  const raw = (fd, chunk, encoding) => {
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(
        String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
      fs.writeSync(fd, bytes);
    } catch { /* Preserve original stream behavior on diagnostic IO failure. */ }
  };
  const tee = (stream, fd) => {
    const original = stream.write;
    stream.write = function (chunk, encoding, callback) {
      raw(fd, chunk, encoding);
      return original.call(this, chunk, encoding, callback);
    };
  };
  tee(process.stdout, mainOut);
  tee(process.stderr, mainErr);
  record('MAIN_PRELOAD_STARTED', { processType: process.type ?? null,
    electron: process.versions.electron ?? null, node: process.versions.node,
    cwd: process.cwd() });

  process.on('uncaughtExceptionMonitor', (error, origin) =>
    record('UNCAUGHT_EXCEPTION_MONITOR', { origin, stack: String(error?.stack ?? error) }));
  process.on('warning', (warning) =>
    record('NODE_WARNING', { stack: String(warning?.stack ?? warning) }));
  process.on('exit', (code) => {
    record('MAIN_PROCESS_EXIT', { code });
    try { fs.closeSync(mainOut); } catch { /* Already closed. */ }
    try { fs.closeSync(mainErr); } catch { /* Already closed. */ }
  });

  try {
    const electron = require('electron');
    if (electron?.app) {
      for (const event of ['ready', 'browser-window-created', 'before-quit',
        'will-quit', 'quit']) {
        electron.app.on(event, (_event, window) => record('APP_' + event, {
          windowId: window?.id ?? null,
        }));
      }
    } else record('ELECTRON_APP_UNAVAILABLE');
  } catch (error) {
    record('ELECTRON_REQUIRE_ERROR', { stack: String(error?.stack ?? error) });
  }

  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  let spawnIndex = 0;
  childProcess.spawn = function (command, args, options) {
    const child = originalSpawn.call(this, command, args, options);
    if (!/python(?:\.exe)?$/i.test(path.basename(String(command)))) return child;
    const index = ++spawnIndex;
    const prefix = 'sidecar-' + index;
    const out = fs.openSync(path.join(directory, prefix + '.stdout.raw'), 'wx');
    const err = fs.openSync(path.join(directory, prefix + '.stderr.raw'), 'wx');
    record('SIDECAR_SPAWN', { index, pid: child.pid ?? null,
      executable: String(command), argvCount: Array.isArray(args) ? args.length : null });
    child.stdout?.on('data', (bytes) => raw(out, bytes));
    child.stderr?.on('data', (bytes) => raw(err, bytes));
    child.on('error', (error) => record('SIDECAR_SPAWN_ERROR',
      { index, stack: String(error?.stack ?? error) }));
    child.on('exit', (code, signal) => record('SIDECAR_EXIT', { index, code, signal }));
    child.on('close', (code, signal) => {
      record('SIDECAR_CLOSE', { index, code, signal });
      try { fs.closeSync(out); } catch { /* Already closed. */ }
      try { fs.closeSync(err); } catch { /* Already closed. */ }
    });
    return child;
  };
}
