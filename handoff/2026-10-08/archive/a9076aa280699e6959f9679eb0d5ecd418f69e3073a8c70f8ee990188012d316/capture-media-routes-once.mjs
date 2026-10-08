import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = 'C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923';
const script = join(import.meta.dirname, 'capture-media-routes-after-fix.py');
const run = process.argv[2];
if (!run || existsSync(run)) throw new Error('A new, absent run directory is required');
mkdirSync(run);
const output = join(run, 'suite');
const command = join(repo, '.venv', 'Scripts', 'python.exe');
const args = ['-B', script, output];
const env = { ...process.env, QA_MEDIA_ROUTE_REPO: repo, PYTHONDONTWRITEBYTECODE: '1' };
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const child = spawn(command, args, {
  cwd: run, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
const stdoutPath = join(run, 'stdout.raw');
const stderrPath = join(run, 'stderr.raw');
const stdout = createWriteStream(stdoutPath);
const stderr = createWriteStream(stderrPath);
let error = null;
child.stdout.pipe(stdout);
child.stderr.pipe(stderr);
child.on('error', (e) => { error = { name: e.name, message: e.message, code: e.code }; });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30000);
const exit = await new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
clearTimeout(timer);
await Promise.all([stdout, stderr].map((stream) => stream.writableFinished
  ? Promise.resolve()
  : new Promise((resolve) => stream.once('finish', resolve))));
const result = {
  command, args, cwd: run, pid: child.pid ?? null, exit, error, timed_out: timedOut,
  script_sha256: hash(script),
  route_sha256: hash(join(repo, 'services', 'api', 'src', 'aijian_api', 'media_asset_routes.py')),
  stdout: { bytes: readFileSync(stdoutPath).length, sha256: hash(stdoutPath) },
  stderr: { bytes: readFileSync(stderrPath).length, sha256: hash(stderrPath) },
};
writeFileSync(join(run, 'invocation.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
