/* QA02 diagnostic-only Electron main preload. No product source is modified. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const directory = process.env.QA02_DIAG_DIR;
if (directory && (process.type === 'browser' || process.type === undefined)) {
  const limit = 16 * 1024 * 1024;
  const eventsPath = path.join(directory, 'main-startup-events.jsonl');
  const record = (kind, fields = {}) => {
    try {
      fs.appendFileSync(eventsPath, JSON.stringify({
        utc: new Date().toISOString(), pid: process.pid, kind, ...fields,
      }) + '\n');
    } catch { /* Do not alter the application if diagnostic storage fails. */ }
  };
  record('MAIN_PRELOAD_STARTED', {
    processType: process.type ?? null,
    electronVersion: process.versions.electron ?? null,
    nodeVersion: process.versions.node,
  });

  process.on('uncaughtExceptionMonitor', (_error, origin) =>
    record('MAIN_UNCAUGHT_EXCEPTION', { origin }));
  process.on('warning', (warning) =>
    record('MAIN_WARNING', { name: warning.name }));
  process.on('exit', (code) => record('MAIN_EXIT', { code }));

  try {
    const electron = require('electron');
    if (electron?.app) {
      for (const name of ['ready', 'browser-window-created', 'before-quit',
        'will-quit', 'quit']) {
        electron.app.on(name, (_event, window) => record('APP_' + name, {
          windowId: name === 'browser-window-created' ? window?.id ?? null : null,
        }));
      }
      // This run diagnoses startup only. End a successful launch through app.quit().
      electron.app.once('browser-window-created', () => {
        setTimeout(() => {
          record('DIAGNOSTIC_QUIT_AFTER_FIRST_WINDOW');
          electron.app.quit();
        }, 2000);
      });
    } else record('ELECTRON_APP_UNAVAILABLE');
  } catch {
    record('ELECTRON_REQUIRE_FAILED');
  }

  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  let count = 0;
  childProcess.spawn = function (command, args, options) {
    const child = originalSpawn.call(this, command, args, options);
    if (!/python(?:\.exe)?$/i.test(path.basename(String(command)))) return child;
    const index = ++count;
    const stream = (name, source) => {
      const file = path.join(directory, `sidecar-${index}.${name}.raw`);
      let fd;
      let written = 0;
      let truncated = false;
      try { fd = fs.openSync(file, 'wx', 0o600); }
      catch { record('SIDECAR_CAPTURE_OPEN_FAILED', { index, stream: name }); }
      source?.on('data', (chunk) => {
        if (fd === undefined) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const available = Math.max(0, limit - written);
        if (available) {
          try { fs.writeSync(fd, bytes.subarray(0, available)); }
          catch { record('SIDECAR_CAPTURE_WRITE_FAILED', { index, stream: name }); }
          written += Math.min(bytes.length, available);
        }
        if (bytes.length > available && !truncated) {
          truncated = true;
          record('SIDECAR_CAPTURE_TRUNCATED', { index, stream: name, limit });
        }
      });
      child.once('close', () => {
        if (fd !== undefined) try { fs.closeSync(fd); } catch { /* Already closed. */ }
      });
    };
    record('SIDECAR_SPAWN', { index, pid: child.pid ?? null,
      executableBase: path.basename(String(command)),
      argvCount: Array.isArray(args) ? args.length : null });
    stream('stdout', child.stdout);
    stream('stderr', child.stderr);
    child.on('error', (error) =>
      record('SIDECAR_SPAWN_ERROR', { index, name: error.name, code: error.code ?? null }));
    child.on('exit', (code, signal) =>
      record('SIDECAR_EXIT', { index, code, signal }));
    child.on('close', (code, signal) =>
      record('SIDECAR_CLOSE', { index, code, signal }));
    return child;
  };
}
