/* Read-only c19 inventory after MGR04's CSS sync and Web build. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923');
const work = resolve(import.meta.dirname);
const cssPath = 'apps/studio-web/src/aivora/v2-story.css';
const cssTarget = 'FCCB6ACC0476641B0BFBE0D47028D008CF2C0FBCA35956F2B053C5D49EA16523';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  assert.ok(arg.startsWith('--') && at > 2, 'Invalid option');
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
assert.deepEqual(Object.keys(options).sort(),
  ['build-manifest', 'build-sha256', 'web-html-sha256']);
assert.match(options['build-sha256'], /^[0-9a-f]{64}$/i);
assert.match(options['web-html-sha256'], /^[0-9a-f]{64}$/i);
const webHtmlSha256 = options['web-html-sha256'].toUpperCase();
const buildManifestPath = resolve(options['build-manifest']);
const buildManifestSha256 = sha(readFileSync(buildManifestPath));
assert.equal(buildManifestSha256, options['build-sha256'].toUpperCase(),
  'QA03 final build manifest changed');
const build = JSON.parse(readFileSync(buildManifestPath, 'utf8'));
assert.ok(build.sourceCount >= 90 && build.distCount >= 78,
  'Final build inventory incomplete');
assert.equal(build.sourceCount, build.source.length);
assert.equal(build.distCount, build.dist.length);
assert.notEqual(webHtmlSha256,
  '97B5FA2976B03160D64E63F4AE7484C604286C6BDD35CF19799E95B1DFC7999F',
  'Old September 24 Web dist is not a final CSS build');
assert.equal(sha(readFileSync(join(root, 'apps/studio-web/dist/index.html'))),
  webHtmlSha256, 'Final Web dist SHA differs from released build');
assert.equal(sha(readFileSync(join(root, cssPath))), cssTarget,
  'DEV04 source CSS not yet synchronized into c19');
const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' }).trim();
assert.equal(head, '211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2');
assert.equal(build.head, head);
const gitStatus = execFileSync('git',
  ['-C', root, 'status', '--short', '--untracked-files=all'],
  { encoding: 'utf8' });
assert.deepEqual(build.status, gitStatus.trimEnd().split(/\r?\n/).filter(Boolean),
  'Current c19 status differs from QA03 final build');
const dirty = gitStatus.trimEnd().split(/\r?\n/).filter(Boolean)
  .map((line) => line.slice(3).replaceAll('\\', '/'));
const listFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap(
  (entry) => entry.isDirectory() ? listFiles(join(directory, entry.name))
    : [join(directory, entry.name)]);
const dist = ['apps/desktop/dist', 'apps/studio-web/dist'].flatMap((directory) =>
  listFiles(join(root, directory))
    .map((file) => relative(root, file).replaceAll('\\', '/')));
assert.ok(dist.length >= 78, 'Final Web/Desktop dist is incomplete');
assert.equal(dist.length, build.distCount, 'Current dist count differs from QA03 final build');
assert.deepEqual(dist.slice().sort(), build.dist.map((item) => item.path).sort(),
  'Current dist paths differ from QA03 final build');
const runtime = [
  cssPath,
  'apps/desktop/src/main.ts',
  'apps/desktop/src/e2e-user-data.ts',
  'apps/studio-web/src/aivora/DemoApp.tsx',
  'apps/studio-web/src/aivora/StoryPages.tsx',
  'apps/studio-web/src/aivora/HomePages.tsx',
  'apps/studio-web/src/aivora/Common.tsx',
  'apps/studio-web/src/aivora/model.tsx',
  'services/api/src/aijian_api/sidecar.py',
];
const paths = [...new Set([
  ...build.source.map((item) => item.path), ...dirty, ...runtime, ...dist,
])].sort();
const files = paths.map((path) => {
  const bytes = readFileSync(join(root, path));
  return { path, bytes: bytes.length, sha256: sha(bytes) };
});
for (const expected of [...build.source, ...build.dist]) {
  const current = files.find((item) => item.path === expected.path);
  assert.equal(current?.bytes, expected.bytes,
    expected.path + ': QA03 final byte count differs');
  assert.equal(current?.sha256, expected.sha256,
    expected.path + ': QA03 final SHA differs');
}
const iso = new Date().toISOString().replaceAll('-', '').replaceAll(':', '')
  .slice(0, 15) + 'Z';
const runId = 'qa02-source-preview-' + iso + '-qa02a';
const profile = join(root, '.aijian-dev', runId);
const evidenceDir = join(work, 'evidence', runId);
assert.ok(!existsSync(profile) && !existsSync(evidenceDir),
  'Visual QA profile or evidence dir already exists');
const plan = {
  kind: 'QA02_SOURCE_PREVIEW_NATIVE_VISUAL_G1_SUBMIT_PLAN',
  scope: 'SYNTHETIC_LOCAL_SOURCE_G1_SUBMIT_ONCE_LAYOUT_ONLY',
  maxLaunches: 2, runId, root, profile, evidenceDir, head, gitStatus,
  cssPath, cssTargetSha256: cssTarget, webHtmlSha256,
  buildManifestPath, buildManifestSha256,
  sizes: [
    { width: 1424, height: 881, label: 'reported' },
    { width: 1424, height: 720, label: 'lower' },
    { width: 1024, height: 881, label: 'narrow' },
  ],
  projectName: 'QA02 来源预览布局 ' + runId,
  sourceText: Array.from({ length: 70 }, (_, i) =>
    '第 ' + (i + 1) + ' 行：虚构测试城的纸船缓缓驶过河面，供本地来源预览滚动与布局复验。')
    .join('\n'),
  nativeSubmit: {
    action: 'submit',
    gate: 'G1',
    title: '送审来源版本',
    button: '确认送审来源版本',
    maxAttempts: 1,
    helperSha256: '505ED8FF34B2F625C7CA2C88CEA0985B768AD00712726338B728BEACF8756495',
  },
  prohibitedActions: [
    'providerCall', 'sourceBaselineApproval', 'sourceSignoff', 'sourceDecision',
    'uploadUserContent', 'mediaGeneration',
  ],
  files,
};
const output = join(work, 'native-source-preview-plan-' + runId + '.json');
assert.ok(!existsSync(output));
writeFileSync(output, JSON.stringify(plan, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ output, sha256: sha(readFileSync(output)),
  runId, cssTargetSha256: cssTarget, webHtmlSha256, buildManifestSha256,
  distFiles: dist.length, boundFiles: files.length,
  dirtyPaths: dirty.length, profile, evidenceDir }) + '\n');
