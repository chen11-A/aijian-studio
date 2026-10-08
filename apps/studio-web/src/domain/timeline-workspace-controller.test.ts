import { expect, test, vi } from "vitest";
import type { TimelineResponse } from "../api/studio";
import {
  TimelineWorkspaceController,
  createTimelineWorkspaceGateway,
} from "./timeline-workspace-controller";

const projectA = `prj_${"a".repeat(32)}`;
const projectB = `prj_${"b".repeat(32)}`;
const response = (
  projectId = projectA,
  revision = 1,
  timelineId = "episode-main",
): TimelineResponse => ({
  request_id: "00000000-0000-4000-8000-000000000001",
  data: {
    project_id: projectId,
    version_id: `ver_${"1".repeat(32)}`,
    content_hash: `sha256:${"2".repeat(64)}`,
    created_at: "2026-08-10T00:00:00Z",
    total_duration_frames: 84,
    timeline: {
      schema_version: 1,
      timeline_id: timelineId,
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
          source_frame_count: 120,
          proxy: null,
        },
        {
          schema_version: 1,
          asset_id: "asset-b",
          source_asset_sha256: `sha256:${"b".repeat(64)}`,
          source_frame_count: 96,
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
        {
          schema_version: 1,
          clip_id: "clip-b",
          asset_id: "asset-b",
          source_in_frame: 12,
          duration_frames: 36,
        },
      ],
    },
  },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const gateway = (overrides: Partial<ReturnType<typeof gatewayDefaults>> = {}) => ({
  ...gatewayDefaults(),
  ...overrides,
});
const gatewayDefaults = () => ({
  load: vi.fn().mockResolvedValue(response()),
  trim: vi.fn().mockResolvedValue(response(undefined, 2)),
  reorder: vi.fn().mockResolvedValue(response(undefined, 2)),
  replace: vi.fn().mockResolvedValue(response(undefined, 2)),
});

test("adapts the stable transport's four actual operations without a stub", async () => {
  const studio = {
    getProjectTimeline: vi.fn().mockResolvedValue(response()),
    trimTimelineClip: vi.fn(),
    reorderTimelineClip: vi.fn(),
    replaceTimelineClip: vi.fn(),
  };
  const adapter = createTimelineWorkspaceGateway(studio);
  await adapter.load(projectA);
  expect(studio.getProjectTimeline).toHaveBeenCalledWith(projectA);
  expect(adapter.trim).toBe(studio.trimTimelineClip);
  expect(adapter.reorder).toBe(studio.reorderTimelineClip);
  expect(adapter.replace).toBe(studio.replaceTimelineClip);
});
test("handles empty and initial read failure honestly", async () => {
  const empty = new TimelineWorkspaceController(
    gateway({ load: vi.fn().mockResolvedValue(null) }),
    projectA,
  );
  await empty.reload();
  expect(empty.getState()).toMatchObject({
    kind: "empty",
    projectId: projectA,
  });
  const broken = new TimelineWorkspaceController(
    gateway({ load: vi.fn().mockRejectedValue(new Error("offline")) }),
    projectA,
  );
  await broken.reload();
  expect(broken.getState()).toMatchObject({
    kind: "error",
    projectId: projectA,
  });
});
test("preserves selected timeline and clip identity across trim, reorder and replace", async () => {
  const trim = vi.fn().mockResolvedValue(response(projectA, 2));
  const reorder = vi.fn().mockResolvedValue(response(projectA, 3));
  const replace = vi.fn().mockResolvedValue(response(projectA, 4));
  const controller = new TimelineWorkspaceController(gateway({ trim, reorder, replace }), projectA);
  await controller.reload();
  controller.selectClip("clip-b");
  await controller.trim({
    clip_id: "clip-b",
    new_source_in_frame: 16,
    new_duration_frames: 30,
    expected_revision: 1,
  });
  await controller.reorder({
    clip_id: "clip-b",
    new_index: 0,
    expected_revision: 2,
  });
  await controller.replace({
    clip_id: "clip-b",
    replacement_asset_id: "asset-a",
    replacement_source_in_frame: 16,
    expected_revision: 3,
  });
  expect(trim).toHaveBeenCalledWith(
    projectA,
    expect.objectContaining({ clip_id: "clip-b", expected_revision: 1 }),
  );
  expect(reorder).toHaveBeenCalledWith(
    projectA,
    expect.objectContaining({ new_index: 0, expected_revision: 2 }),
  );
  expect(replace).toHaveBeenCalledWith(
    projectA,
    expect.objectContaining({
      replacement_asset_id: "asset-a",
      expected_revision: 3,
    }),
  );
  expect(controller.getState()).toMatchObject({
    kind: "ready",
    timelineId: "episode-main",
    selectedClipId: "clip-b",
  });
});
test("does not resend an unknown write and only reloads", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response(projectA, 2));
  const trim = vi.fn().mockRejectedValue(new Error("network uncertain"));
  const controller = new TimelineWorkspaceController(gateway({ load, trim }), projectA);
  await controller.reload();
  await controller.trim({
    clip_id: "clip-a",
    new_source_in_frame: 1,
    new_duration_frames: 40,
    expected_revision: 1,
  });
  expect(trim).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(2);
  expect(controller.getState()).toMatchObject({
    kind: "ready",
    notice: "修改结果未知；已重新读取最新时间线。",
  });
});
test("drops late old-project reads and concurrent commands", async () => {
  const old = deferred<TimelineResponse | null>();
  const command = deferred<TimelineResponse>();
  const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(projectB));
  const trim = vi.fn().mockReturnValue(command.promise);
  const controller = new TimelineWorkspaceController(gateway({ load, trim }), projectA);
  const first = controller.reload();
  controller.setProject(projectB);
  await controller.reload();
  old.resolve(response(projectA));
  await first;
  expect(controller.getState()).toMatchObject({
    kind: "ready",
    projectId: projectB,
    timelineId: "episode-main",
  });
  const second = controller.trim({
    clip_id: "clip-a",
    new_source_in_frame: 2,
    new_duration_frames: 40,
    expected_revision: 1,
  });
  const duplicate = controller.trim({
    clip_id: "clip-a",
    new_source_in_frame: 3,
    new_duration_frames: 39,
    expected_revision: 1,
  });
  expect(trim).toHaveBeenCalledTimes(1);
  command.resolve(response(projectB, 2));
  await Promise.all([second, duplicate]);
  expect(controller.getState()).toMatchObject({
    kind: "ready",
    projectId: projectB,
  });
});
test("does not accept a write result for a different timeline identity", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response(projectA, 2, "episode-main"));
  const trim = vi.fn().mockResolvedValue(response(projectA, 2, "other-timeline"));
  const controller = new TimelineWorkspaceController(gateway({ load, trim }), projectA);
  await controller.reload();
  await controller.trim({
    clip_id: "clip-a",
    new_source_in_frame: 1,
    new_duration_frames: 40,
    expected_revision: 1,
  });
  expect(load).toHaveBeenCalledTimes(2);
  expect(controller.getState()).toMatchObject({
    kind: "ready",
    timelineId: "episode-main",
  });
});
test("makes saving observable and rejects a reload while a write is pending", async () => {
  const pendingWrite = deferred<TimelineResponse>();
  const pendingRead = deferred<TimelineResponse | null>();
  const load = vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(pendingRead.promise);
  const trim = vi
    .fn()
    .mockReturnValueOnce(pendingWrite.promise)
    .mockResolvedValue(response(projectA, 3));
  const controller = new TimelineWorkspaceController(gateway({ load, trim }), projectA);
  await controller.reload();
  const saving = controller.trim({
    clip_id: "clip-a",
    new_source_in_frame: 1,
    new_duration_frames: 40,
    expected_revision: 1,
  });
  expect(controller.getState()).toMatchObject({ kind: "ready", saving: true });
  const reload = controller.reload();
  pendingWrite.resolve(response(projectA, 2));
  pendingRead.resolve(response(projectA, 3));
  await Promise.all([saving, reload]);
  expect(controller.getState()).toMatchObject({
    kind: "ready",
    saving: false,
    response: { data: { timeline: { revision: 2 } } },
  });
});
test("fails closed for a nonselected clip or wrong-project read", async () => {
  const trim = vi.fn();
  const controller = new TimelineWorkspaceController(gateway({ trim }), projectA);
  await controller.reload();
  await controller.trim({
    clip_id: "clip-b",
    new_source_in_frame: 1,
    new_duration_frames: 40,
    expected_revision: 1,
  });
  expect(trim).not.toHaveBeenCalled();
  const wrong = new TimelineWorkspaceController(
    gateway({ load: vi.fn().mockResolvedValue(response(projectB)) }),
    projectA,
  );
  await wrong.reload();
  expect(wrong.getState()).toMatchObject({
    kind: "error",
    projectId: projectA,
  });
});
test("keeps the remote write lock across an attempted reload until unknown recovery settles", async () => {
  const pendingWrite = deferred<TimelineResponse>();
  const recovery = deferred<TimelineResponse | null>();
  const load = vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(recovery.promise);
  const trim = vi.fn().mockReturnValue(pendingWrite.promise);
  const controller = new TimelineWorkspaceController(gateway({ load, trim }), projectA);
  await controller.reload();
  const first = controller.trim({
    clip_id: "clip-a",
    new_source_in_frame: 1,
    new_duration_frames: 40,
    expected_revision: 1,
  });
  const ignoredReload = controller.reload();
  await controller.trim({
    clip_id: "clip-a",
    new_source_in_frame: 2,
    new_duration_frames: 39,
    expected_revision: 1,
  });
  expect(load).toHaveBeenCalledTimes(1);
  expect(trim).toHaveBeenCalledTimes(1);
  pendingWrite.reject(new Error("remote unknown"));
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  recovery.resolve(response(projectA, 2));
  await first;
  await ignoredReload;
  expect(controller.getState()).toMatchObject({
    kind: "ready",
    saving: false,
    notice: "修改结果未知；已重新读取最新时间线。",
  });
  await controller.trim({
    clip_id: "clip-a",
    new_source_in_frame: 2,
    new_duration_frames: 39,
    expected_revision: 2,
  });
  expect(trim).toHaveBeenCalledTimes(2);
});
test("accepts a normal same-project timeline generation change and resets selection", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response(projectA, 2, "episode-next"));
  const controller = new TimelineWorkspaceController(gateway({ load }), projectA);
  await controller.reload();
  controller.selectClip("clip-b");
  await controller.reload();
  expect(controller.getState()).toMatchObject({
    kind: "ready",
    timelineId: "episode-next",
    selectedClipId: "clip-a",
  });
});
