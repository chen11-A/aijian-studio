/* Read-only check of QA02's pinned synthetic media bytes and decoded content. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

assert.equal(process.argv.length, 3, 'Usage: node verifier.mjs manifest.json');
const manifestPath = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.kind, 'QA02_MLT_SYNTHETIC_FOUR_MEDIA_MANIFEST');
assert.equal(manifest.status, 'FOUR_MEDIA_ONLY_NO_SRT_NO_MLT');
assert.equal(manifest.spec_sha256,
  '4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
assert.equal(sha(readFileSync(manifest.ffmpeg_path)), manifest.ffmpeg_sha256);
const files = Object.fromEntries(manifest.files.map((entry) => {
  const bytes = readFileSync(entry.path);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(sha(bytes), entry.sha256);
  assert.equal(entry.usage, 'SYNTHETIC_TEST_ONLY');
  assert.equal(resolve(entry.path), join(resolve(manifest.output_directory), entry.name));
  return [entry.name, bytes];
}));
assert.deepEqual(Object.keys(files).sort(),
  ['bgm-test.wav', 'dialogue-test.wav', 'v1-blue.webm', 'v2-red.webm']);
const rgbAt = (frame, x, y) => {
  const offset = (y * 320 + x) * 3;
  return [...frame.subarray(offset, offset + 3)];
};
const picture = {};
for (const name of ['v1-blue.webm', 'v2-red.webm']) {
  const decoded = spawnSync(manifest.ffmpeg_path,
    ['-v', 'error', '-i', join(manifest.output_directory, name),
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { encoding: null, maxBuffer: 1024 * 1024 });
  assert.equal(decoded.status, 0, `First frame decode failed: ${name}`);
  assert.equal(decoded.stdout.length, 320 * 568 * 3);
  picture[name] = {
    center: rgbAt(decoded.stdout, 160, 284),
    leftStripe: rgbAt(decoded.stdout, 12, 284),
    rightStripe: rgbAt(decoded.stdout, 300, 284),
  };
}
const blue = picture['v1-blue.webm'];
const red = picture['v2-red.webm'];
assert.ok(blue.center[2] > 150 && blue.center[0] < 100);
assert.ok(red.center[0] > 150 && red.center[2] < 100);
assert.ok(blue.leftStripe.every((value) => value > 180));
assert.ok(red.rightStripe.every((value) => value > 180));
const sounds = {};
for (const [name, count, expectedHz] of [
  ['dialogue-test.wav', 48000, 1000], ['bgm-test.wav', 240000, 220],
]) {
  const bytes = files[name];
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let offset = 12;
  let data;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset + 4);
    if (bytes.toString('ascii', offset, offset + 4) === 'data') {
      data = bytes.subarray(offset + 8, offset + 8 + length);
      break;
    }
    offset += 8 + length + length % 2;
  }
  assert.ok(data && data.length === count * 2);
  let peak = 0;
  let risingCrossings = 0;
  let previous = data.readInt16LE(0);
  for (let i = 0; i < count; i++) {
    const sample = data.readInt16LE(i * 2);
    peak = Math.max(peak, Math.abs(sample));
    if (i > 0 && previous < 0 && sample >= 0) risingCrossings++;
    previous = sample;
  }
  const hz = risingCrossings / (count / 48000);
  assert.ok(Math.abs(hz - expectedHz) <= 1, `${name}: frequency ${hz}`);
  const peakDbfs = 20 * Math.log10(peak / 32768);
  const targetDbfs = name === 'dialogue-test.wav' ? -12 : -30;
  assert.ok(Math.abs(peakDbfs - targetDbfs) < 0.2,
    `${name}: peak ${peakDbfs}`);
  sounds[name] = { samples: count, peak, peakDbfs, frequencyHz: hz };
}
process.stdout.write(JSON.stringify({
  kind: 'QA02_MLT_FOUR_MEDIA_DECODED_CONTENT_CHECK',
  manifestSha256: sha(readFileSync(manifestPath)),
  status: 'INPUT_CONTENT_PASS', picture, sounds,
}, null, 2) + '\n');
