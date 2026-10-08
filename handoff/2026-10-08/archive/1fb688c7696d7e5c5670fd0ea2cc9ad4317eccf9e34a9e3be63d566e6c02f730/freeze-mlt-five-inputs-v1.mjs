/* Offline five-input freeze; run only after fixed QA01 receipts and MGR02 approval. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const fileSha = (path) => sha(readFileSync(path));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  assert.ok(arg.startsWith('--') && at > 2);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
assert.deepEqual(Object.keys(args).sort(), [
  'four-manifest', 'four-sha256', 'mode', 'output', 'qa01-capture',
  'qa01-capture-sha256', 'qa01-identity', 'qa01-identity-sha256',
]);
assert.ok(['dry-run', 'freeze'].includes(args.mode));
const fourPath = resolve(args['four-manifest']);
const identityPath = resolve(args['qa01-identity']);
const capturePath = resolve(args['qa01-capture']);
const output = resolve(args.output);
const root = resolve('C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa02-mlt-test-20260928');
const relation = relative(root, output);
assert.ok(relation && !relation.startsWith('..') && !isAbsolute(relation));
assert.equal(dirname(output).toLowerCase(), root.toLowerCase(),
  'Five-input output must be a direct QA-root child');
assert.ok(!lstatSync(root).isSymbolicLink());
assert.equal(realpathSync.native(root).toLowerCase(), root.toLowerCase());
assert.ok(!existsSync(output), 'Five-input output must be new');
assert.equal(fileSha(fourPath), args['four-sha256'].toUpperCase());
assert.equal(fileSha(fourPath),
  '211DDD8872F1DE47A569849C7A6AE9763D125DF6BAE9F8416534976C5B83FF78');
assert.equal(fileSha(identityPath), args['qa01-identity-sha256'].toUpperCase());
assert.equal(fileSha(identityPath),
  '67E4DAD955BC59EC573ADE5CD2373678738797CEC22022DFC4B0CC7798B4D32E');
assert.equal(fileSha(capturePath), args['qa01-capture-sha256'].toUpperCase());
assert.equal(fileSha(capturePath),
  '33B1E446820C663126D241F2ADB7C07B3E51E29F565EE02E8FDD429ECDB87F2A');
const four = JSON.parse(readFileSync(fourPath, 'utf8'));
const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
const capture = JSON.parse(readFileSync(capturePath, 'utf8'));
assert.equal(four.kind, 'QA02_MLT_SYNTHETIC_FOUR_MEDIA_MANIFEST');
assert.equal(four.status, 'FOUR_MEDIA_ONLY_NO_SRT_NO_MLT');
assert.equal(four.spec_sha256,
  '4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D');
assert.equal(fileSha(four.lock_path), four.lock_sha256);
assert.equal(fileSha(four.ffmpeg_path), four.ffmpeg_sha256);
assert.equal(fileSha(four.ffprobe_path), four.ffprobe_sha256);
assert.equal(identity.state, 'REOPEN_VERIFIED_WITH_ORIGINAL_EXIT_1');
assert.equal(identity.scope, 'SYNTHETIC_TEST_ONLY');
assert.equal(identity.get_only_reopen, true);
assert.equal(identity.original_run_exit, 1);
assert.equal(capture.scope, 'SYNTHETIC_TEST_ONLY');
assert.equal(capture.mode, 'GET_ONLY_RESTART');
assert.equal(capture.status, 'GET_ONLY_RESTART_PASS');
assert.equal(capture.original_run_exit, 1);
assert.equal(capture.process.exit.code, 0);
assert.equal(capture.db_sha256_before, capture.db_sha256_after);
assert.equal(capture.calls.length, 4);
for (const call of capture.calls) {
  assert.equal(call.method, 'GET');
  assert.equal(call.response.status, 200);
  assert.equal(fileSha(resolve(call.response.file)), call.response.sha256.toUpperCase());
  assert.equal(readFileSync(resolve(call.response.file)).length, call.response.bytes);
}
const exact = capture.calls.find((call) => call.label === 'script-exact-reopen');
const latest = capture.calls.find((call) => call.label === 'script-latest-reopen');
assert.ok(exact && latest);
const exactData = JSON.parse(readFileSync(resolve(exact.response.file), 'utf8')).data;
const latestData = JSON.parse(readFileSync(resolve(latest.response.file), 'utf8')).data;
assert.deepEqual(exactData, latestData);
assert.equal(exactData.project_id, identity.project_id);
assert.equal(exactData.episode_id, identity.episode_id);
assert.equal(exactData.version_id, identity.script_version_id);
assert.equal(exactData.content_hash, identity.script_content_hash);
assert.equal(exactData.content.scenes.length, 1);
assert.equal(exactData.content.scenes[0].scene_id, identity.scene_id);
const blocks = exactData.content.scenes[0].blocks;
assert.equal(blocks.length, 2);
assert.deepEqual(blocks.map((block) => block.block_id), identity.block_ids);
assert.deepEqual(blocks.map((block) => block.text), identity.texts);
assert.ok(blocks.every((block) => block.speaker === identity.speaker
  && block.delivery === identity.delivery && block.kind === 'DIALOGUE'));
assert.equal(identity.delivery, 'OFF_SCREEN');
assert.equal(identity.speaker, 'TEST 提示音（非人声）');
assert.notEqual(identity.block_ids[0], identity.block_ids[1]);
assert.match(identity.script_content_hash, /^sha256:[0-9a-f]{64}$/i);
assert.deepEqual(identity.texts,
  ['TEST 提示音一（非语音）', 'TEST 提示音二（非语音）']);
assert.equal(four.files.length, 4);
const expected = [
  'v1-blue.webm', 'v2-red.webm', 'dialogue-test.wav', 'bgm-test.wav',
];
assert.deepEqual(four.files.map((item) => item.name), expected);
for (const item of four.files) {
  assert.equal(item.usage, 'SYNTHETIC_TEST_ONLY');
  assert.equal(resolve(item.path), join(resolve(four.output_directory), item.name));
  assert.ok(!lstatSync(item.path).isSymbolicLink());
  assert.equal(realpathSync.native(item.path).toLowerCase(),
    resolve(item.path).toLowerCase());
  const bytes = readFileSync(item.path);
  assert.equal(bytes.length, item.bytes);
  assert.equal(sha(bytes), item.sha256.toUpperCase());
}

const srt = `1\n00:00:01,000 --> 00:00:02,000\n${identity.texts[0]}\n\n` +
  `2\n00:00:03,000 --> 00:00:04,000\n${identity.texts[1]}`;
if (args.mode === 'dry-run') {
  process.stdout.write(JSON.stringify({
    status: 'INPUTS_VERIFIED_NO_OUTPUT_WRITTEN',
    fourManifestSha256: fileSha(fourPath),
    qa01IdentitySha256: fileSha(identityPath),
    qa01CaptureSha256: fileSha(capturePath),
    exactScriptResponseSha256: exact.response.sha256.toUpperCase(),
    output, srtSha256: sha(Buffer.from(srt, 'utf8')),
    projectId: identity.project_id, episodeId: identity.episode_id,
    testScriptVersionId: identity.script_version_id,
    blockIds: identity.block_ids,
  }) + '\n');
  process.exit(0);
}

await mkdir(output, { recursive: false });
const files = [];
for (const item of four.files) {
  const path = join(output, item.name);
  await copyFile(item.path, path, constants.COPYFILE_EXCL);
  const bytes = readFileSync(path);
  assert.equal(bytes.length, item.bytes);
  assert.equal(sha(bytes), item.sha256.toUpperCase());
  files.push({ name: item.name, path, bytes: bytes.length,
    sha256: sha(bytes), usage: 'SYNTHETIC_TEST_ONLY' });
}
const srtName = 'subtitle-test.srt';
const srtPath = join(output, srtName);
await writeFile(srtPath, srt, { encoding: 'utf8', flag: 'wx' });
const srtBytes = readFileSync(srtPath);
files.push({ name: srtName, path: srtPath, bytes: srtBytes.length,
  sha256: sha(srtBytes), usage: 'SYNTHETIC_TEST_ONLY' });
const manifest = {
  kind: 'QA02_MLT_SYNTHETIC_FIVE_INPUT_MANIFEST',
  status: 'FIVE_INPUTS_FROZEN_NO_MLT',
  usage: 'SYNTHETIC_TEST_ONLY',
  spec_sha256: four.spec_sha256,
  output_directory: output,
  lock_path: four.lock_path, lock_sha256: four.lock_sha256,
  ffmpeg_path: four.ffmpeg_path, ffmpeg_sha256: four.ffmpeg_sha256,
  ffprobe_path: four.ffprobe_path, ffprobe_sha256: four.ffprobe_sha256,
  project_id: identity.project_id,
  episode_id: identity.episode_id,
  test_script_version_id: identity.script_version_id,
  test_script_content_hash: identity.script_content_hash,
  first_script_block_id: identity.block_ids[0],
  second_script_block_id: identity.block_ids[1],
  files,
};
const manifestPath = join(output, 'five-input-manifest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n',
  { encoding: 'utf8', flag: 'wx' });
const evidence = { kind: 'QA02_MLT_FIVE_INPUT_FREEZE_EVIDENCE',
  manifestPath, manifestSha256: fileSha(manifestPath),
  fourManifestPath: fourPath, fourManifestSha256: fileSha(fourPath),
  qa01CapturePath: capturePath, qa01CaptureSha256: fileSha(capturePath),
  exactScriptResponsePath: resolve(exact.response.file),
  exactScriptResponseSha256: exact.response.sha256.toUpperCase(),
  identityPath, identitySha256: fileSha(identityPath),
  scriptTexts: identity.texts,
  srtSha256: sha(srtBytes) };
await writeFile(join(output, 'freeze-evidence.json'),
  JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: manifest.status,
  manifestPath, manifestSha256: evidence.manifestSha256,
  srtSha256: evidence.srtSha256 }) + '\n');
