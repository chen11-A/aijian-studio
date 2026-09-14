import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { TimelineResponse } from "../api/studio";
import type { TimelineWorkspaceGateway } from "./timeline-workspace-controller";
import { useTimelineWorkspace } from "./use-timeline-workspace";
const projectA = `prj_${"a".repeat(32)}`;
const response = (projectId = projectA, revision = 1): TimelineResponse => ({
  request_id: "00000000-0000-4000-8000-000000000001",
  data: {
    project_id: projectId,
    version_id: `ver_${"1".repeat(32)}`,
    content_hash: `sha256:${"2".repeat(64)}`,
    created_at: "2026-08-10T00:00:00Z",
    total_duration_frames: 48,
    timeline: {
      schema_version: 1,
      timeline_id: "episode-main",
      revision,
      sequence_timebase: {
        frame_rate: { num: 24, den: 1 },
        timecode_mode: "NON_DROP_FRAME",
      },
      width: 1080,
      height: 1920,
      assets: [
        {
          schema_version: 1,
          asset_id: "asset-a",
          source_asset_sha256: `sha256:${"a".repeat(64)}`,
          source_frame_count: 48,
          proxy: null,
        },
      ],
      clips: [
        {
          schema_version: 1,
          clip_id: "clip-a",
          asset_id: "asset-a",
          source_in_frame: 0,
          duration_frames: 48,
        },
      ],
    },
  },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const gateway = (load: TimelineWorkspaceGateway["load"]): TimelineWorkspaceGateway => ({
  load,
  trim: vi.fn(),
  reorder: vi.fn(),
  replace: vi.fn(),
});
test("reports async timeline state to renderHook subscribers", async () => {
  const g = gateway(vi.fn().mockResolvedValue(response()));
  const { result } = renderHook(() => useTimelineWorkspace(g, projectA));
  await waitFor(() =>
    expect(result.current[1]).toMatchObject({
      kind: "ready",
      projectId: projectA,
      saving: false,
    }),
  );
});
test("switches gateway identity and drops the former late result", async () => {
  const old = deferred<TimelineResponse | null>();
  const g1 = gateway(vi.fn().mockReturnValue(old.promise));
  const g2 = gateway(vi.fn().mockResolvedValue(response(projectA, 2)));
  const { result, rerender } = renderHook(({ g }) => useTimelineWorkspace(g, projectA), {
    initialProps: { g: g1 },
  });
  rerender({ g: g2 });
  await waitFor(() =>
    expect(result.current[1]).toMatchObject({
      kind: "ready",
      response: { data: { timeline: { revision: 2 } } },
    }),
  );
  old.resolve(response(projectA, 1));
  await act(async () => {
    await old.promise;
  });
  expect(result.current[1]).toMatchObject({
    kind: "ready",
    response: { data: { timeline: { revision: 2 } } },
  });
});
test("unmount invalidates late reads without extra request", async () => {
  const late = deferred<TimelineResponse | null>();
  const load = vi.fn().mockReturnValue(late.promise);
  const g = gateway(load);
  const { result, unmount } = renderHook(() => useTimelineWorkspace(g, projectA));
  const controller = result.current[0];
  unmount();
  late.resolve(response());
  await act(async () => {
    await late.promise;
  });
  expect(load).toHaveBeenCalledTimes(1);
  expect(controller.getState()).toMatchObject({
    kind: "loading",
    projectId: projectA,
  });
});
