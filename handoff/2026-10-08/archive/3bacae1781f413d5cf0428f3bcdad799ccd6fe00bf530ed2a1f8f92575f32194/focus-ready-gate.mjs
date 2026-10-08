import assert from 'node:assert/strict';

// Polls observed Electron state. It never changes window visibility or focus.
export async function waitForWindowVisible({ sample, record, sleep, now,
  expectedPid, expectedHwnd, timeoutMs = 15000, pollMs = 100, sampleTimeoutMs = 2000 }) {
  assert.ok(typeof sample === 'function' && typeof record === 'function');
  assert.ok(typeof sleep === 'function' && typeof now === 'function');
  assert.ok(Number.isSafeInteger(expectedPid) && expectedPid > 0);
  assert.ok(Number.isSafeInteger(expectedHwnd) && expectedHwnd > 0);
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0);
  assert.ok(Number.isInteger(pollMs) && pollMs > 0);
  assert.ok(Number.isInteger(sampleTimeoutMs) && sampleTimeoutMs > 0);
  const start = now();
  const maxSamples = Math.ceil(timeoutMs / pollMs) + 2;
  for (let attempt = 1; attempt <= maxSamples; attempt++) {
    let reading;
    let timer;
    try {
      reading = await Promise.race([
        sample(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('WINDOW_READY_SAMPLE_TIMEOUT')), sampleTimeoutMs);
        }),
      ]);
    }
    catch (error) {
      await record({ attempt, elapsed_ms: now() - start, error: String(error) });
      throw error;
    } finally { clearTimeout(timer); }
    const elapsedMs = now() - start;
    await record({ attempt, elapsed_ms: elapsedMs, reading });
    if (reading.pid !== expectedPid || reading.hwnd !== expectedHwnd ||
        reading.title !== 'AIVORA') {
      throw new Error('WINDOW_READY_IDENTITY_CHANGED');
    }
    if (reading.visible === true && reading.loading === false) {
      return { attempt, elapsed_ms: elapsedMs, reading };
    }
    if (elapsedMs >= timeoutMs) throw new Error('WINDOW_READY_TIMEOUT');
    await sleep(Math.min(pollMs, timeoutMs - elapsedMs));
  }
  throw new Error('WINDOW_READY_SAMPLE_LIMIT');
}
