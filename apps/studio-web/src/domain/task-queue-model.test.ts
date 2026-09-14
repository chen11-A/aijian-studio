import { describe, expect, test } from "vitest";

import type { TaskQueueItem } from "./task-queue-model";
import { formatTime, matchesFilter, nodeLabels, shortHash, toneFor } from "./task-queue-model";

function item(nodeStatus: string, attemptStatus: string): TaskQueueItem {
  return {
    node: { status: nodeStatus },
    attempt: { status: attemptStatus },
  } as TaskQueueItem;
}

describe("task queue presentation model", () => {
  test("names the deterministic timeline task in film-team language", () => {
    expect(nodeLabels["timeline.assemble.fake"]).toBe("Fake 分镜时间线");
  });

  test("maps technical states to stable visual tones", () => {
    expect(toneFor(item("RECONCILIATION_REQUIRED", "READY"))).toBe("attention");
    expect(toneFor(item("RUNNING", "REMOTE_UNKNOWN"))).toBe("attention");
    expect(toneFor(item("RUNNING", "FAILED"))).toBe("attention");
    expect(toneFor(item("RUNNING", "NOT_SUBMITTED"))).toBe("attention");
    expect(toneFor(item("SUCCEEDED", "SUCCEEDED"))).toBe("done");
    expect(toneFor(item("PENDING", "READY"))).toBe("working");
    expect(toneFor(item("RUNNING", "LEASED"))).toBe("working");
    expect(toneFor(item("RUNNING", "RUNNING"))).toBe("working");
    expect(toneFor(item("RUNNING", "WAITING_REMOTE"))).toBe("working");
    expect(toneFor(item("CANCELLED", "CANCELLED"))).toBe("quiet");
  });

  test("matches each user-facing filter against the derived tone", () => {
    const working = item("RUNNING", "RUNNING");
    const attention = item("RUNNING", "FAILED");
    const done = item("SUCCEEDED", "SUCCEEDED");
    expect(matchesFilter(working, "active")).toBe(true);
    expect(matchesFilter(attention, "attention")).toBe(true);
    expect(matchesFilter(done, "completed")).toBe(true);
    expect(matchesFilter(done, "all")).toBe(true);
    expect(matchesFilter(done, "active")).toBe(false);
  });

  test("formats hashes and optional checkpoints without inventing data", () => {
    expect(shortHash(`sha256:${"a".repeat(64)}`)).toBe("sha256:aaaaaaaa…aaaaaaaa");
    expect(formatTime(null)).toBe("尚无检查点");
    expect(formatTime("2026-08-04T09:31:00Z")).toBe("2026/08/04 17:31:00");
  });
});
