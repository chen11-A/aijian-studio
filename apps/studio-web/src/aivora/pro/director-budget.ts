import type { AgentRequestControl } from "./workflow";

export const DIRECTOR_SCENE_BUDGET_MS = 240_000;

/** One wall-clock budget includes headers, retries and all optional enrichment. */
export function directorBudget(options: {
  current: () => boolean;
  control?: AgentRequestControl;
  progress?: (message: string) => void;
}) {
  const started = Date.now();
  const deadlineAt = Math.min(
    started + DIRECTOR_SCENE_BUDGET_MS,
    options.control?.deadlineAt ?? Infinity,
  );
  const controller = new AbortController();
  let reason = "";
  let phase = "";
  let reject!: (error: Error) => void;
  const stopped = new Promise<never>((_, no) => {
    reject = no;
  });
  // Aborting before the first awaited request must not produce an unhandled rejection.
  void stopped.catch(() => undefined);
  const stop = (code: string) => {
    if (controller.signal.aborted) return;
    reason = code;
    controller.abort();
    reject(Object.assign(new Error(code), { code }));
  };
  const cancel = () => stop("TEXT_CANCELLED");
  const current = () => {
    if (!options.current()) stop("REQUEST_STALE");
    else if (options.control?.signal.aborted) cancel();
    else if (Date.now() >= deadlineAt) stop("TEXT_TIMEOUT");
    return !controller.signal.aborted;
  };
  const timer = setTimeout(() => stop("TEXT_TIMEOUT"), Math.max(0, deadlineAt - started));
  const watch = setInterval(current, 100);
  const heartbeat = setInterval(() => {
    if (current() && phase)
      options.progress?.(`${phase}（已等待 ${Math.floor((Date.now() - started) / 1000)} 秒）`);
  }, 15_000);
  options.control?.signal.addEventListener("abort", cancel, { once: true });
  return {
    control: { deadlineAt, signal: controller.signal },
    current,
    reason: () => reason,
    progress(message: string) {
      phase = message;
      if (current()) options.progress?.(message);
    },
    async run<T>(work: () => Promise<T>): Promise<T> {
      if (!current()) return stopped;
      const result = await Promise.race([work(), stopped]);
      if (!current()) return stopped;
      return result;
    },
    dispose() {
      clearTimeout(timer);
      clearInterval(watch);
      clearInterval(heartbeat);
      options.control?.signal.removeEventListener("abort", cancel);
    },
  };
}
