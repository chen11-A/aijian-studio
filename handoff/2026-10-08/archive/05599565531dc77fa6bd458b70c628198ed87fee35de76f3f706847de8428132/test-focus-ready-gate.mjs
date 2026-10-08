import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { waitForWindowVisible } from '../../focus-capability-proposal-20260924/focus-ready-gate.mjs';

const output = process.argv[2];
assert.ok(output, 'output path required');
const base = { pid: 123, hwnd: 456, title: 'AIVORA', visible: false, loading: true };
const cases = [];
async function check(name, run) {
  try { await run(); cases.push({ name, pass: true }); }
  catch (error) { cases.push({ name, pass: false, error: String(error) }); }
}
function harness(readings, options = {}) {
  let time = 0;
  let position = 0;
  const rows = [];
  return {
    rows,
    options: {
      expectedPid: 123, expectedHwnd: 456, timeoutMs: options.timeoutMs ?? 1000,
      pollMs: options.pollMs ?? 100,
      now: () => time,
      sleep: async (ms) => { time += ms; },
      record: async (row) => { rows.push(row); },
      sample: async () => readings[Math.min(position++, readings.length - 1)],
    },
  };
}
await check('delayed_visible_and_loaded', async () => {
  const h = harness([base, { ...base, loading: false }, { ...base, visible: true, loading: false }]);
  const result = await waitForWindowVisible(h.options);
  assert.equal(result.attempt, 3);
  assert.equal(result.elapsed_ms, 200);
  assert.equal(h.rows.length, 3);
});
await check('immediate_ready', async () => {
  const h = harness([{ ...base, visible: true, loading: false }]);
  const result = await waitForWindowVisible(h.options);
  assert.equal(result.attempt, 1);
  assert.equal(h.rows.length, 1);
});
await check('bounded_timeout', async () => {
  const h = harness([base], { timeoutMs: 250 });
  await assert.rejects(() => waitForWindowVisible(h.options), /WINDOW_READY_TIMEOUT/);
  assert.equal(h.rows.at(-1).elapsed_ms, 250);
  assert.equal(h.rows.length, 4);
});
await check('identity_drift_rejects', async () => {
  const h = harness([{ ...base, pid: 999, visible: true, loading: false }]);
  await assert.rejects(() => waitForWindowVisible(h.options), /WINDOW_READY_IDENTITY_CHANGED/);
  assert.equal(h.rows.length, 1);
});
await check('sample_failure_is_recorded', async () => {
  const rows = [];
  await assert.rejects(() => waitForWindowVisible({
    expectedPid: 123, expectedHwnd: 456, timeoutMs: 1000, pollMs: 100,
    now: () => 0, sleep: async () => {},
    record: async (row) => { rows.push(row); },
    sample: async () => { throw new Error('sample failed'); },
  }), /sample failed/);
  assert.match(rows[0].error, /sample failed/);
});
await check('hung_sample_times_out', async () => {
  const rows = [];
  await assert.rejects(() => waitForWindowVisible({
    expectedPid: 123, expectedHwnd: 456, timeoutMs: 1000, pollMs: 100,
    sampleTimeoutMs: 10, now: () => 0, sleep: async () => {},
    record: async (row) => { rows.push(row); },
    sample: async () => new Promise(() => {}),
  }), /WINDOW_READY_SAMPLE_TIMEOUT/);
  assert.match(rows[0].error, /WINDOW_READY_SAMPLE_TIMEOUT/);
});
const passed = cases.filter((item) => item.pass).length;
const receipt = { checked_utc: new Date().toISOString(), case_count: cases.length,
  passed_count: passed, cases };
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`PASS=${passed}/${cases.length}\n`);
if (passed !== cases.length) process.exitCode = 1;
