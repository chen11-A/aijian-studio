import { describe, expect, it } from "vitest";
import type { BatchProgress, TaskItem } from "@aijian/contracts/task-progress";
import { portraitFeed } from "./portraitFeed";

const task = (id: string, status: TaskItem["status"], reason?: string): TaskItem => ({
  id,
  kind: "image",
  status,
  attempt: 1,
  ...(reason ? { reason } : {}),
});
const batch = (batchId: string, running: boolean, done = 0): BatchProgress => ({
  batchId,
  label: "定妆照",
  done,
  total: 8,
  failed: 0,
  running,
});

describe("portraitFeed", () => {
  it("reads each slot of this film from GPT's task ids, the latest state winning", () => {
    const feed = portraitFeed(
      {
        tasks: [
          task("portraits:film-1:run-a:cast-1:正面", "failed", "Grok 拒绝了这张图"),
          task("portraits:film-1:run-b:cast-1:正面", "running"),
          task("portraits:film-1:run-b:cast-1:侧面", "queued"),
          task("portraits:film-1:run-b:cast:2:背面", "done"),
          task("portraits:film-2:run-c:cast-1:正面", "done"),
          task("scene-1-shot-1-take-1", "running"),
        ],
        batches: [],
      },
      "film-1",
    );
    expect(feed.slots).toEqual({
      "cast-1:正面": { state: "running", reason: "" },
      "cast-1:侧面": { state: "queued", reason: "" },
      "cast:2:背面": { state: "done", reason: "" },
    });
  });

  it("keeps the failure reason for the retry button", () => {
    const feed = portraitFeed(
      { tasks: [task("portraits:film-1:run:cast-1:脸部", "failed", "超时")], batches: [] },
      "film-1",
    );
    expect(feed.slots["cast-1:脸部"]).toEqual({ state: "failed", reason: "超时" });
  });

  it("shows the running batch of this film, or else the last one that ended", () => {
    const tasks: TaskItem[] = [];
    expect(
      portraitFeed(
        {
          tasks,
          batches: [
            batch("portraits:film-1:a", false, 8),
            batch("portraits:film-1:b", true, 3),
            batch("portraits:film-2:c", true, 1),
          ],
        },
        "film-1",
      ).batch?.batchId,
    ).toBe("portraits:film-1:b");
    expect(
      portraitFeed(
        { tasks, batches: [batch("portraits:film-1:a", false), batch("export:film-1", true)] },
        "film-1",
      ).batch?.batchId,
    ).toBe("portraits:film-1:a");
    expect(portraitFeed({ tasks, batches: [] }, "film-1").batch).toBeNull();
  });
});
