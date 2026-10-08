/* External AC05 queue-only candidate inventory. Does not launch or modify c19. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923');
const work = resolve(import.meta.dirname);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  assert.ok(arg.startsWith('--') && at > 2, `Invalid argument: ${arg}`);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
assert.deepEqual(Object.keys(options).sort(), ['qa03-manifest', 'qa03-sha256']);
assert.match(options['qa03-sha256'], /^[0-9a-f]{64}$/i);
const qa03ManifestPath = resolve(options['qa03-manifest']);
const qa03Bytes = readFileSync(qa03ManifestPath);
const qa03ManifestSha256 = sha(qa03Bytes);
assert.equal(qa03ManifestSha256, options['qa03-sha256'].toUpperCase(),
  'QA03 manifest SHA changed');
const qa03 = JSON.parse(qa03Bytes.toString('utf8'));
assert.ok(qa03.sourceCount >= 90 && qa03.distCount >= 78,
  'AC05 requires the current, complete QA03 source and dist inventory');
assert.equal(qa03.sourceCount, qa03.source.length);
assert.equal(qa03.distCount, qa03.dist.length);

const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' }).trim();
assert.equal(head, '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2');
assert.equal(qa03.head, head);
const gitStatus = execFileSync('git', ['-C', root, 'status', '--short', '--untracked-files=all'],
  { encoding: 'utf8' });
const statusLines = gitStatus.trimEnd().split(/\r?\n/).filter(Boolean);
assert.deepEqual(qa03.status, statusLines, 'QA03 manifest does not match c19 Git status');
const dirty = statusLines.map((line) => line.slice(3).replaceAll('\\', '/'));

const listFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap(
  (entry) => entry.isDirectory() ? listFiles(join(directory, entry.name))
    : [join(directory, entry.name)]);
const dist = ['apps/desktop/dist', 'apps/studio-web/dist'].flatMap((directory) =>
  listFiles(join(root, directory)).map((file) => relative(root, file).replaceAll('\\', '/')));
assert.equal(dist.length, qa03.distCount, 'Current dist file count differs from QA03');

const cleanRuntimeSources = [
  'apps/desktop/src/e2e-user-data.ts',
  'apps/studio-web/src/aivora/Common.tsx',
  'apps/studio-web/src/aivora/SourceExtractionPanel.tsx',
  'apps/studio-web/src/aivora/data.ts',
  'services/api/src/aijian_api/credential_vault.py',
];
const paths = [...new Set([
  ...qa03.source.map((item) => item.path), ...dist, ...cleanRuntimeSources,
])].sort();
assert.ok(dirty.every((path) => paths.includes(path)),
  'Dirty c19 path not bound by AC05 plan');
const files = paths.map((path) => {
  const bytes = readFileSync(join(root, path));
  return { path, bytes: bytes.length, sha256: sha(bytes) };
});
for (const expected of [...qa03.source, ...qa03.dist]) {
  const current = files.find((item) => item.path === expected.path);
  assert.equal(current?.bytes, expected.bytes, `${expected.path}: QA03 bytes differ`);
  assert.equal(current?.sha256, expected.sha256, `${expected.path}: QA03 SHA differs`);
}

const iso = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').slice(0, 15) + 'Z';
const runId = `qa02-ac05-native-${iso}-qa02a`;
const profile = join(root, '.aijian-dev', runId);
const evidenceDir = join(work, 'evidence', runId);
assert.ok(!existsSync(profile) && !existsSync(evidenceDir),
  'AC05 profile or evidence directory already exists');
const plan = {
  kind: 'QA02_AC05_NATIVE_QUEUE_PLAN',
  scope: 'SYNTHETIC_LOCAL_SOURCE_SUB2API_QUEUE_READBACK_NO_CALL_APPROVAL',
  maxLaunches: 2,
  runId, root, profile, evidenceDir, head, gitStatus,
  qa03ManifestPath, qa03ManifestSha256,
  projectName: `QA02 AC05 本地队列 ${runId}`,
  syntheticSourceText: '在虚构的测试城中，阿甲把纸船交给阿乙。此段仅用于本地自动化验证，不含真实作品内容。',
  origin: 'https://qa-native-ac05.invalid',
  connectionName: 'QA02 AC05 合成文本连接',
  modelId: 'qa-text-only',
  prohibitedActions: [
    'approveSub2APISourceExtractCall',
    'explicitOneCallApproval',
    'providerProbe',
    'mediaGeneration',
    'uploadUserContent',
  ],
  files,
};
const output = join(work, `native-ac05-plan-candidate-${runId}.json`);
assert.ok(!existsSync(output));
writeFileSync(output, JSON.stringify(plan, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ output, sha256: sha(readFileSync(output)), runId,
  qa03ManifestSha256, sourceFiles: qa03.sourceCount, distFiles: qa03.distCount,
  boundFiles: files.length, dirtyPaths: dirty.length, profile, evidenceDir }) + '\n');
