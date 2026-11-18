import { freemem } from "node:os";
import { onTestFailed } from "vitest";

const stages = [
  "fixture",
  "suggest",
  "linkBundle",
  "apply",
  "beforeCommit",
  "after-beforeCommit",
  "assert",
  "done",
] as const;
const notSampled = ["recompile", "load", "hash", "cas", "cleanup"] as const;
type Stage = (typeof stages)[number];
type Mark = "not-reached" | "in-progress" | "reached" | "not-applicable";
export type MutationPhaseProbes = {
  open: number;
  closed: number;
  failed: number;
  last: "none" | "ffmpeg" | "ffprobe" | "other";
};

/** Test-visible boundaries only. Production recompile, load, hash, CAS and cleanup stay unsampled. */
export function openMutationPhase(options: {
  mode: string;
  linksBundle: boolean;
  nearMs?: number;
  probes?: () => MutationPhaseProbes;
  write?: (line: string) => void;
}) {
  const started = performance.now();
  let stage = "not-started";
  let stageAt = started;
  const reached = new Set<string>();
  const completed: { stage: string; elapsedMs: number }[] = [];
  let frozen: ReturnType<typeof take> | undefined;
  let closed = false;
  const timer = setTimeout(() => {
    frozen = take("near-deadline");
  }, options.nearMs ?? 4900);
  timer.unref?.();

  function boundary(): Record<Stage, Mark> {
    const marks = {} as Record<Stage, Mark>;
    for (const name of stages) {
      if (name === "linkBundle" && !options.linksBundle) marks[name] = "not-applicable";
      else if (name === stage) marks[name] = "in-progress";
      else if (reached.has(name)) marks[name] = "reached";
      else marks[name] = "not-reached";
    }
    return marks;
  }
  function take(sample: "near-deadline" | "at-failure") {
    return {
      v: 1 as const,
      mode: options.mode,
      stage,
      sample,
      elapsedMs: Math.round(performance.now() - started),
      monoMs: Math.round(performance.now()),
      boundary: boundary(),
      notSampled: [...notSampled],
      completed: completed.map((row) => ({ ...row })),
      probes: options.probes?.() ?? ("not-sampled" as const),
      heapMb: Math.min(65536, Math.round(process.memoryUsage().heapUsed / 1048576)),
      freeMb: Math.min(1048576, Math.round(freemem() / 1048576)),
    };
  }
  onTestFailed(() => {
    try {
      clearTimeout(timer);
      const row = frozen ?? take("at-failure");
      (options.write ?? ((line: string) => process.stderr.write(line)))(
        `CI_LIBRARY_MUTATION_PHASE ${JSON.stringify(row)}\n`,
      );
    } catch {
      // A diagnostic failure must not become a second test error.
    }
  });
  return {
    enter(next: Stage) {
      const now = performance.now();
      if (stage !== "not-started") {
        if (completed.length < 12) completed.push({ stage, elapsedMs: Math.round(now - stageAt) });
        reached.add(stage);
      }
      stage = next;
      stageAt = now;
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
    },
  };
}
