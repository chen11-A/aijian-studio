/* Read-only c19 inventory; writes one external candidate plan and never launches Electron. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923');
const work = resolve(import.meta.dirname);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  assert.ok(arg.startsWith('--') && at > 2, `Invalid argument: ${arg}`);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
assert.ok(args['qa03-manifest'] && args['qa03-sha256'],
  'New QA03 manifest path and SHA are required');
assert.match(args['qa03-sha256'], /^[0-9a-f]{64}$/i);
const qa03ManifestPath = resolve(args['qa03-manifest']);
const qa03Bytes = readFileSync(qa03ManifestPath);
const qa03ManifestSha256 = sha(qa03Bytes);
assert.equal(qa03ManifestSha256, args['qa03-sha256'].toUpperCase(),
  'QA03 build manifest SHA changed');
const qa03 = JSON.parse(qa03Bytes.toString('utf8'));
const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(head, '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2');
const gitStatus = execFileSync('git', ['-C', root, 'status', '--short', '--untracked-files=all'],
  { encoding: 'utf8' });
const dirty = gitStatus.trimEnd().split(/\r?\n/).filter(Boolean)
  .map((line) => line.slice(3).replaceAll('\\', '/'));
assert.equal(dirty.length, 66, `Expected PROJECT pre-AC05 status66, got ${dirty.length}`);
assert.equal(qa03.head, head);
assert.equal(qa03.sourceCount, 69);
assert.equal(qa03.distCount, 76);
assert.deepEqual(qa03.status, gitStatus.trimEnd().split(/\r?\n/));
const listFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap(
  (entry) => entry.isDirectory() ? listFiles(join(directory, entry.name))
    : [join(directory, entry.name)]);
const dist = ['apps/desktop/dist', 'apps/studio-web/dist'].flatMap((directory) =>
  listFiles(join(root, directory)).map((path) => relative(root, path).replaceAll('\\', '/')));
assert.equal(dist.length, 76, `Expected QA03 PROJECT dist76, got ${dist.length}`);
const extraRuntimeSource = 'apps/desktop/src/e2e-user-data.ts';
assert.ok(!qa03.source.some((file) => file.path === extraRuntimeSource));
const paths = [...new Set([...qa03.source.map((file) => file.path), extraRuntimeSource, ...dist])].sort();
assert.equal(paths.length, 146, `Expected QA03 PROJECT source69 + dist76 + runtime source1, got ${paths.length}`);
assert.ok(dirty.every((path) => paths.includes(path)), 'Current dirty path not bound by QA03 manifest');
const files = paths.map((path) => {
  const bytes = readFileSync(join(root, path));
  return { path, sha256: sha(bytes), bytes: bytes.length };
});
for (const expected of [...qa03.source, ...qa03.dist]) {
  const current = files.find((file) => file.path === expected.path);
  assert.equal(current?.bytes, expected.bytes, `${expected.path} bytes differ from QA03`);
  assert.equal(current?.sha256, expected.sha256, `${expected.path} SHA differs from QA03`);
}
const iso = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').slice(0, 15) + 'Z';
const runId = `qa02-project-native-${iso}-qa02a`;
const profile = join(root, '.aijian-dev', runId);
const evidenceDir = join(work, 'evidence', runId);
assert.ok(!existsSync(profile) && !existsSync(evidenceDir), 'Candidate path already exists');
const plan = {
  kind: 'QA02_PROJECT_NATIVE_PLAN',
  buildScope: 'PROJECT01_QA03_BUILD_BEFORE_ANY_AC05_SYNC',
  qa03ManifestPath, qa03ManifestSha256,
  runId, root, profile, evidenceDir, head, gitStatus,
  origin: 'https://qa-native-project.invalid',
  connectionName: 'QA02 Sub2API 本地保存测试',
  modelId: 'qa-text-only',
  files,
};
const output = join(work, `native-project-plan-candidate-${runId}.json`);
assert.ok(!existsSync(output));
writeFileSync(output, JSON.stringify(plan, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ output, sha256: sha(readFileSync(output)),
  runId, dirtyPaths: dirty.length, distFiles: dist.length, boundFiles: files.length,
  profile, evidenceDir }) + '\n');
