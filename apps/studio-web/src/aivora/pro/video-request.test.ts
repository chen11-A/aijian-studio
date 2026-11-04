import { expect, it, vi } from "vitest";
import { awaitVideoResult } from "./video-request";

it("bounds an unresolved video request without resending it or retaining timers", async () => {
  vi.useFakeTimers();
  try {
    const request = vi.fn(() => new Promise<never>(() => undefined));
    const result = awaitVideoResult(request, () => false, 1000).catch(
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("TASK_TIMEOUT");
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it("releases waiting when cancelled and ignores a later provider result", async () => {
  vi.useFakeTimers();
  try {
    let cancelled = false;
    let release!: (value: string) => void;
    const result = awaitVideoResult(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
      () => cancelled,
    ).catch((error: Error) => error.message);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe("VIDEO_CANCELLED");
    release("late video");
    expect(await result).toBe("VIDEO_CANCELLED");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
