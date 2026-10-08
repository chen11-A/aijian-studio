/* Read-only c19 inventory after CSS build and isolated media-route fix. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923');
const work = resolve(import.meta.dirname);
const cssPath = 'apps/studio-web/src/aivora/v2-story.css';
const cssTarget = 'D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E';
const cssSnapshotPath = resolve('C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-source-preview-low-height-css-1/SNAPSHOT.json');
const cssSyncReceiptPath = resolve('C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-source-preview-low-height-css-c19-sync-1/SYNC-RECEIPT.json');
const cssSnapshotSha256 = '673497C7AAEA3C5B836CD2F1B991C6298E606D42809D084F4DE2E782C696EA9E';
const cssSyncReceiptSha256 = '6F76ABAFEE75BFFE219F3E1646A17296989B39D96D7D59D7F56B48F3955E0EE8';
const oldRedResultPath = join(work, 'evidence',
  'qa02-source-preview-20260928T013557Z-qa02a', 'result.json');
const oldRedResultSha256 = 'DBB542BAC58350589C71E8A46E687BE3E7D95ABB49490956CD38225C427FCEEA';
const routePath = 'services/api/src/aijian_api/media_asset_routes.py';
const routeOldSha256 = '02F85E078A0C3C9450342E7064A7524CA0EC51135D746EEC253A21CBAE283D13';
const routeTargetSha256 = '931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770';
const routeTargetBytes = 11056;
const routeSnapshotPath = resolve('C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-rel03-media-asset-route-startup-fix-1/SNAPSHOT.json');
const routeSnapshotSha256 = '30224B29FC5321E0ABA52BAAA58A4C31D40908046098C228B571CCEE2E067E9B';
const routeSyncReceiptPath = resolve('C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-rel03-route-startup-fix-c19-sync-1/SYNC-RECEIPT.json');
const routeSyncReceiptSha256 = '25348454B033D4DA8021CFFC8A7CDC18B2AAFE2721010F6F95AC9E6F56D7A78B';
const qa01RegressionPath = resolve('C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa01-sidecar-diag-20260928/FIXED-REGRESSION.md');
const qa01RegressionSha256 = 'EE5917C6FEFFE789ECD23E4308E1CA039FFF57838E072BC9C19478670514C3EE';
const oldStartupResultPath = join(work, 'evidence',
  'qa02-source-preview-20260928T020208Z-qa02a', 'result.json');
const oldStartupResultSha256 = '83F099E9406AC4613297BDB3EC1C95C65258FB038C7A8D483D889009D5BA0538';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
assert.equal(sha(readFileSync(cssSnapshotPath)), cssSnapshotSha256);
assert.equal(sha(readFileSync(cssSyncReceiptPath)), cssSyncReceiptSha256);
const cssSnapshot = JSON.parse(readFileSync(cssSnapshotPath, 'utf8'));
const cssSyncReceipt = JSON.parse(readFileSync(cssSyncReceiptPath, 'utf8'));
assert.equal(cssSnapshot.newSha256, cssTarget);
assert.equal(cssSyncReceipt.newSha256, cssTarget);
assert.equal(cssSyncReceipt.snapshotSha256, cssSnapshotSha256);
assert.equal(cssSyncReceipt.state, 'SYNCED_NOT_VISUAL_QA_ACCEPTED');
assert.equal(sha(readFileSync(oldRedResultPath)), oldRedResultSha256);
assert.equal(sha(readFileSync(routeSnapshotPath)), routeSnapshotSha256);
assert.equal(sha(readFileSync(routeSyncReceiptPath)), routeSyncReceiptSha256);
assert.equal(sha(readFileSync(qa01RegressionPath)), qa01RegressionSha256);
assert.equal(sha(readFileSync(oldStartupResultPath)), oldStartupResultSha256);
const routeReceipt = JSON.parse(readFileSync(routeSyncReceiptPath, 'utf8'));
assert.equal(routeReceipt.oldSha256, routeOldSha256);
assert.equal(routeReceipt.newSha256, routeTargetSha256);
assert.equal(routeReceipt.sourceSnapshotSha256, routeSnapshotSha256);
assert.equal(routeReceipt.state, 'SYNCED_NOT_QA_ACCEPTED');
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
assert.equal(buildManifestSha256,
  '0BE9ED4DA07E85BBBB959B2FFE6BDEFB5B031D0C8F67A0746532FEFD708F9291');
assert.equal(webHtmlSha256,
  '6D997E0C719E218B906ED733E39D7E3679272E034741D6033B6987EB1D2BDE62');
const build = JSON.parse(readFileSync(buildManifestPath, 'utf8'));
assert.ok(build.sourceCount >= 90 && build.distCount >= 78,
  'Final build inventory incomplete');
assert.equal(build.sourceCount, build.source.length);
assert.equal(build.distCount, build.dist.length);
assert.notEqual(webHtmlSha256,
  'C6CDCEF5805AD58B3333E63B7B9D14291D14816B624A51E4FB9FCD99DACF9319',
  'Old QA03 Web dist is not the low-height CSS build');
assert.notEqual(webHtmlSha256,
  '97B5FA2976B03160D64E63F4AE7484C604286C6BDD35CF19799E95B1DFC7999F',
  'Old September 24 Web dist is not a final CSS build');
assert.equal(sha(readFileSync(join(root, 'apps/studio-web/dist/index.html'))),
  webHtmlSha256, 'Final Web dist SHA differs from released build');
assert.equal(sha(readFileSync(join(root,
  'apps/studio-web/dist/assets/index-jsEG3DHn.css'))),
  '8B8AA7581262D68B1737A61C5587C4D545020C8C9AB73C211FC317555004ED0A',
  'Low-height CSS asset differs from QA03 build');
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
  if (expected.path === routePath) {
    assert.equal(expected.sha256, routeOldSha256,
      'Pre-route QA03 manifest has unexpected route baseline');
    assert.equal(current?.bytes, routeTargetBytes,
      'Only route fix should change its byte count');
    assert.equal(current?.sha256, routeTargetSha256,
      'Protected route fix not present in c19');
    continue;
  }
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
  cssSnapshotPath, cssSnapshotSha256, cssSyncReceiptPath, cssSyncReceiptSha256,
  oldRedResultPath, oldRedResultSha256,
  routePath, routeOldSha256, routeTargetSha256, routeTargetBytes,
  routeSnapshotPath, routeSnapshotSha256,
  routeSyncReceiptPath, routeSyncReceiptSha256,
  qa01RegressionPath, qa01RegressionSha256,
  oldStartupResultPath, oldStartupResultSha256,
  buildManifestPath, buildManifestSha256,
  sizes: [
    { width: 1424, height: 720, label: 'lower' },
    { width: 1424, height: 881, label: 'reported' },
    { width: 1024, height: 881, label: 'narrow' },
  ],
  projectName: 'QA02 来源预览布局 ' + runId,
  sourceText: Array.from({ length: 70 }, (_, i) =>
    '第 ' + (i + 1) + ' 行：虚构测试城的纸船缓缓驶过河面，供本地来源预览滚动与布局复验。')
    .join('\n'),
  layoutAcceptance: {
    lowerExcerptMinPx: 120,
    actions: ['刷新来源状态', '确认来源审核基线', '审核来源版本'],
    saveRawBeforeAssertions: true,
    reopenAllSizes: true,
  },
  nativeSubmit: {
    action: 'submit',
    gate: 'G1',
    title: '送审来源版本',
    button: '确认送审来源版本',
    maxAttempts: 1,
    maxFocusAttempts: 1,
    minIdleBeforeFocusMs: 5000,
    helperSha256: 'FC9C7AF49529C9ED002B2CF9266519922D011802399E3C1A35155182D40FFF65',
  },
  prohibitedActions: [
    'providerCall', 'sourceBaselineApproval', 'sourceSignoff', 'sourceDecision',
    'uploadUserContent', 'mediaGeneration',
  ],
  files,
};
assert.equal(Buffer.byteLength(plan.sourceText, 'utf8'), 7270);
assert.equal(sha(Buffer.from(plan.sourceText, 'utf8')).toLowerCase(),
  '85bcb2992bbb609acac6e23fc29c8c320ce10350873cba9d690b7e28b370b789');
const output = join(work, 'native-source-preview-plan-' + runId + '.json');
assert.ok(!existsSync(output));
writeFileSync(output, JSON.stringify(plan, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ output, sha256: sha(readFileSync(output)),
  runId, cssTargetSha256: cssTarget, webHtmlSha256, buildManifestSha256,
  routeTargetSha256, qa01RegressionSha256,
  distFiles: dist.length, boundFiles: files.length,
  dirtyPaths: dirty.length, profile, evidenceDir }) + '\n');
