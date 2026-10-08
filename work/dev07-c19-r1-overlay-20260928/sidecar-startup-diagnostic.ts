const BUSY_LINE = Buffer.from("AIVORA_STARTUP_WORKSPACE_BUSY", "ascii");
const MAX_STDERR_BYTES = 16 * 1024;

export type SidecarStartupClassification = "WORKSPACE_BUSY" | "STARTUP_UNKNOWN";
export type SidecarStartupCompletion = {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawn_failed: boolean;
  timed_out: boolean;
};

// This collects only a bounded pre-handshake stderr window. The caller must classify
// after the child's close event, when its stderr pipe is fully closed.
export function createSidecarStartupDiagnosticCollector() {
  let stderr = Buffer.alloc(0);
  let truncated = false;

  return {
    append(chunk: Buffer): void {
      if (truncated) return;
      if (stderr.length + chunk.length > MAX_STDERR_BYTES) {
        truncated = true;
        stderr = Buffer.alloc(0);
        return;
      }
      stderr = Buffer.concat([stderr, chunk]);
    },
    classify(completion: SidecarStartupCompletion): SidecarStartupClassification {
      if (truncated || completion.spawn_failed || completion.timed_out ||
          completion.code !== 73 || completion.signal !== null) return "STARTUP_UNKNOWN";

      let lineStart = 0;
      for (let index = 0; index < stderr.length; index += 1) {
        if (stderr[index] !== 10) continue;
        const lineEnd = index > lineStart && stderr[index - 1] === 13 ? index - 1 : index;
        if (stderr.subarray(lineStart, lineEnd).equals(BUSY_LINE)) return "WORKSPACE_BUSY";
        lineStart = index + 1;
      }
      return "STARTUP_UNKNOWN";
    },
  };
}
