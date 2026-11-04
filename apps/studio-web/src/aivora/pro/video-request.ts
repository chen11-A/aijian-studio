/** Bound renderer waiting even when IPC/the provider never settles. Never retries a video. */
export async function awaitVideoResult<T>(
  request: () => Promise<T>,
  cancelled: () => boolean,
  timeoutMs = 300_000,
): Promise<T> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let cancellation: ReturnType<typeof setInterval> | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(() => reject(new Error("TASK_TIMEOUT")), timeoutMs);
    cancellation = setInterval(() => {
      if (cancelled()) reject(new Error("VIDEO_CANCELLED"));
    }, 100);
  });
  try {
    if (cancelled()) throw new Error("VIDEO_CANCELLED");
    return await Promise.race([request(), stopped]);
  } finally {
    clearTimeout(deadline);
    clearInterval(cancellation);
  }
}
