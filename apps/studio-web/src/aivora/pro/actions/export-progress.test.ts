import { describe, expect, it } from "vitest";
import { acceptExportProgress } from "./export-progress";
import type { FilmExportProgressEvent } from "@aijian/contracts/film-export-qc";
const scope = { operationId: "op-new", projectId: "film-one", key: "review-key" };
const event: FilmExportProgressEvent = {
  operationId: scope.operationId,
  projectId: scope.projectId,
  seq: 3,
  phase: "rendering",
  cancelState: "available",
  published: [],
};
describe("scoped export event admission", () => {
  it.each([
    { operationId: "op-old" },
    { projectId: "film-other" },
    { seq: 2 },
    { seq: 3 },
    { phase: "invented" },
    { cancelState: "done" },
  ])("rejects stale, reordered or malformed events: %j", (change) => {
    expect(acceptExportProgress({ ...event, ...change }, event, scope, scope.key)).toBeNull();
  });
  it("rejects old review keys even for the same project and execution", () =>
    expect(acceptExportProgress({ ...event, seq: 4 }, event, scope, "changed-key")).toBeNull());
  it("accepts an ACK snapshot once and refuses a late available event without changing execution identity", () => {
    const ack = acceptExportProgress(
      { ...event, seq: 5, cancelState: "requested" },
      event,
      scope,
      scope.key,
    )!;
    expect(ack.operationId).toBe(scope.operationId);
    expect(acceptExportProgress({ ...event, seq: 4 }, ack, scope, scope.key)).toBeNull();
    expect(acceptExportProgress({ ...event, seq: 5 }, ack, scope, scope.key)).toBeNull();
  });
  it("passes only real valid phase measurements and generated public aspect labels", () => {
    const next = acceptExportProgress(
      {
        ...event,
        seq: 4,
        progress: { kind: "units", completed: 1, total: 2, unit: "画幅" },
        published: [{ aspectRatio: "16:9", label: "/private/secret.mp4" }],
      },
      event,
      scope,
      scope.key,
    )!;
    expect(next.progress).toEqual({ kind: "units", completed: 1, total: 2, unit: "画幅" });
    expect(JSON.stringify(next)).not.toContain("private");
    expect(
      acceptExportProgress(
        {
          ...event,
          seq: 5,
          progress: { kind: "media-time", outTimeSeconds: 10, durationSeconds: 2 },
        },
        next,
        scope,
        scope.key,
      )?.progress,
    ).toBeUndefined();
  });
});
