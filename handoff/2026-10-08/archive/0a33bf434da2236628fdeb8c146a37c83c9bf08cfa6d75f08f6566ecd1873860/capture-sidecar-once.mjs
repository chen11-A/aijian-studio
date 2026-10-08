import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const repo = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const run = process.argv[2];
if (!run || existsSync(run)) throw new Error('A new, absent run directory is required');
mkdirSync(run);
const profile = join(run, 'profile');
for (const directory of ['workspace', 'appdata', 'localappdata', 'home', 'temp']) {
  mkdirSync(join(profile, directory), { recursive: true });
}
const command = join(repo, '.venv', 'Scripts', 'python.exe');
const args = ['-m', 'aijian_api.sidecar'];
const paths = {
  main: join(repo, 'apps', 'desktop', 'src', 'main.ts'),
  process: join(repo, 'apps', 'desktop', 'src', 'sidecar-process.ts'),
  sidecar: join(repo, 'services', 'api', 'src', 'aijian_api', 'sidecar.py'),
  lock: join(repo, 'config', 'media-toolchain-lock.json'),
  python: command,
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function snapshot(root) {
  const files = {};
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const s = statSync(path);
      const key = relative(root, path).replaceAll('\\', '/');
      files[key] = entry.isDirectory()
        ? { type: 'dir', mtimeMs: s.mtimeMs }
        : { type: 'file', size: s.size, mtimeMs: s.mtimeMs, sha256: hash(readFileSync(path)) };
      if (entry.isDirectory()) visit(path);
    }
  }
  visit(root);
  return files;
}
const allowed = new Set(['APPDATA', 'HOME', 'LANG', 'LC_ALL', 'LOCALAPPDATA', 'PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR']);
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (allowed.has(key.toUpperCase()) && value !== undefined) env[key] = value;
}
Object.assign(env, {
  APPDATA: join(profile, 'appdata'),
  LOCALAPPDATA: join(profile, 'localappdata'),
  HOME: join(profile, 'home'),
  USERPROFILE: profile,
  TEMP: join(profile, 'temp'),
  TMP: join(profile, 'temp'),
  AIJIAN_DATA_DIR: join(profile, 'workspace'),
  AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME: '1',
  PYTHONPATH: join(repo, 'services', 'api', 'src'),
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
  PYTHONDONTWRITEBYTECODE: '1',
});
const before = snapshot(profile);
const started = new Date().toISOString();
const child = spawn(command, args, { cwd: repo, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const stdoutFile = join(run, 'stdout.raw');
const stderrFile = join(run, 'stderr.raw');
const stdout = createWriteStream(stdoutFile);
const stderr = createWriteStream(stderrFile);
let firstLine = null;
let handshake = null;
let stdoutBytes = 0;
let stderrBytes = 0;
let error = null;
let stopReason = null;
let lineBuffer = Buffer.alloc(0);
let endedStdin = false;
function endStdin(reason) {
  if (endedStdin) return;
  endedStdin = true;
  stopReason = reason;
  child.stdin.end();
}
child.stdout.on('data', (chunk) => {
  stdout.write(chunk);
  stdoutBytes += chunk.length;
  if (firstLine !== null) return;
  lineBuffer = Buffer.concat([lineBuffer, chunk]);
  if (lineBuffer.length > 65536) {
    firstLine = '<first line exceeds 64 KiB>';
    endStdin('oversize-first-line');
    return;
  }
  const end = lineBuffer.indexOf(10);
  if (end < 0) return;
  firstLine = lineBuffer.subarray(0, end).toString('utf8').trim();
  try {
    const parsed = JSON.parse(firstLine);
    handshake = {
      event: parsed.event, host: parsed.host, pid: parsed.pid,
      port: parsed.port, protocol_version: parsed.protocol_version,
      token_length: typeof parsed.token === 'string' ? parsed.token.length : null,
    };
  } catch {
    handshake = { parse_error: true };
  }
  setTimeout(() => endStdin('handshake-observed'), 1000).unref();
});
child.stderr.on('data', (chunk) => { stderr.write(chunk); stderrBytes += chunk.length; });
child.on('error', (err) => { error = { name: err.name, message: err.message, code: err.code }; });
const startupTimer = setTimeout(() => endStdin('startup-20s-timeout'), 20000);
const hardTimer = setTimeout(() => { stopReason = 'hard-27s-kill'; child.kill(); }, 27000);
const exit = await new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
clearTimeout(startupTimer);
clearTimeout(hardTimer);
await Promise.all([new Promise((resolve) => stdout.end(resolve)), new Promise((resolve) => stderr.end(resolve))]);
const result = {
  started, finished: new Date().toISOString(), command, args, cwd: repo,
  pid: child.pid ?? null, env, source_sha256: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, hash(readFileSync(value))])),
  before, after: snapshot(profile), handshake, first_line_present: firstLine !== null,
  stdout: { file: stdoutFile, bytes: stdoutBytes, sha256: hash(readFileSync(stdoutFile)) },
  stderr: { file: stderrFile, bytes: stderrBytes, sha256: hash(readFileSync(stderrFile)) },
  exit, error, stop_reason: stopReason,
};
writeFileSync(join(run, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pid: result.pid, handshake, exit, error, stop_reason: stopReason, stdout_bytes: stdoutBytes, stderr_bytes: stderrBytes }));
