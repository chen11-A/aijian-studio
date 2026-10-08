// Self-contained so Playwright can serialize this function into the renderer.
export async function playbackProbeInPage(element, options = {}) {
  const eventMs = options.eventMs ?? 10000;
  const playMs = options.playMs ?? 10000;
  const endedMs = options.endedMs ?? 7000;
  const sampleMs = options.sampleMs ?? 300;
  const seekPoints = options.seekPoints ?? [0, 7, 13];
  const waitEvent = (name, timeoutMs, start = null, readyNow = null) =>
    new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener(name, onEvent);
      element.removeEventListener('error', onError);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const onEvent = () => finish(null);
    const onError = () => finish(new Error(`video ${name} error`));
    element.addEventListener(name, onEvent, { once: true });
    element.addEventListener('error', onError, { once: true });
    timer = setTimeout(() => finish(new Error(`video ${name} timeout`)), timeoutMs);
    try {
      if (readyNow?.()) { finish(null); return; }
      const started = start?.();
      if (started && typeof started.then === 'function')
        started.catch((error) => finish(error));
    } catch (error) { finish(error); }
  });
  const boundedPromise = (promise, timeoutMs, label) => new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`video ${label} timeout`));
    }, timeoutMs);
    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
  const seek = async (at) => {
    if (Math.abs(element.currentTime - at) >= 0.05 || element.readyState < 2)
      await waitEvent('seeked', eventMs, () => { element.currentTime = at; });
    if (element.readyState < 2)
      await waitEvent('loadeddata', eventMs, null, () => element.readyState >= 2);
    if (Math.abs(element.currentTime - at) >= 0.2 || element.readyState < 2)
      throw new Error('video seek/decode position mismatch');
  };
  const playToEnd = () => new Promise((resolve, reject) => {
    let ended = false;
    let playResolved = false;
    let settled = false;
    let eventTimer;
    let playTimer;
    const cleanup = () => {
      clearTimeout(eventTimer);
      clearTimeout(playTimer);
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('error', onError);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const onEnded = () => { ended = true; if (playResolved) finish(null); };
    const onError = () => finish(new Error('video ended error'));
    element.addEventListener('ended', onEnded, { once: true });
    element.addEventListener('error', onError, { once: true });
    eventTimer = setTimeout(() => finish(new Error('video ended timeout')), endedMs);
    playTimer = setTimeout(() => finish(new Error('video play timeout')), playMs);
    try {
      Promise.resolve(element.play()).then(() => {
        playResolved = true;
        clearTimeout(playTimer);
        if (ended) finish(null);
      }, (error) => finish(error));
    } catch (error) { finish(error); }
  });
  try {
    if (element.readyState < 1)
      await waitEvent('loadedmetadata', eventMs, null, () => element.readyState >= 1);
    const metadata = { duration: element.duration,
      width: element.videoWidth, height: element.videoHeight };
    if (!Number.isFinite(metadata.duration) || Math.abs(metadata.duration - 15) > 0.1 ||
      metadata.width !== 1080 || metadata.height !== 1920)
      throw new Error('video metadata mismatch');
    const samples = [];
    for (const at of seekPoints) {
      await seek(at);
      await boundedPromise(element.play(), playMs, 'play');
      await new Promise((resolve) => setTimeout(resolve, sampleMs));
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('video frame canvas unavailable');
      context.drawImage(element, 0, 0, 1, 1);
      const pixel = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      samples.push({ requested: at, time: element.currentTime,
        readyState: element.readyState, width: element.videoWidth,
        height: element.videoHeight, center_rgb: pixel });
      element.pause();
    }
    await seek(14.5);
    await playToEnd();
    return { metadata, samples, ended: element.ended, finalTime: element.currentTime };
  } finally { element.pause(); }
}
