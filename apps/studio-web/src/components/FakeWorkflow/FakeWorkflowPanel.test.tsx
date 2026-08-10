import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { ProjectData, TimelineResponse } from "../../api/studio";
import { FakeWorkflowPanel } from "./FakeWorkflowPanel";

const project = {
  id: `prj_${"a".repeat(32)}`,
  name: "雾城来信",
} as ProjectData;
const timeline = {
  data: {
    project_id: project.id,
    version_id: `ver_${"b".repeat(32)}`,
    content_hash: `sha256:${"c".repeat(64)}`,
    created_at: "2026-08-10T09:00:00Z",
    total_duration_frames: 150,
    timeline: {
      schema_version: 1,
      timeline_id: "preview-golden",
      revision: 1,
      sequence_timebase: {
        frame_rate: { num: 25, den: 1 },
        timecode_mode: "NON_DROP_FRAME",
      },
      width: 1080,
      height: 1920,
      assets: [
        {
          schema_version: 1,
          asset_id: "fake-asset-01",
          source_asset_sha256: `sha256:${"d".repeat(64)}`,
          source_frame_count: 100,
          proxy: null,
        },
      ],
      clips: [
        {
          schema_version: 1,
          clip_id: "fake-shot-01",
          asset_id: "fake-asset-01",
          source_in_frame: 0,
          duration_frames: 50,
        },
      ],
    },
  },
  request_id: "9e049ad6-2b22-4e2d-8d48-e5bd78ee0e11",
} satisfies TimelineResponse;

test("runs the deterministic preview and opens its recorded outputs", async () => {
  const startWorkflow = vi.fn().mockResolvedValue(timeline);
  const openQueue = vi.fn();
  const openTimeline = vi.fn();
  render(
    <FakeWorkflowPanel
      project={project}
      sourceFilename="golden.txt"
      startWorkflow={startWorkflow}
      onOpenQueue={openQueue}
      onOpenTimeline={openTimeline}
    />,
  );

  expect(screen.getByText(/不调用付费 API/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "生成 Fake 分镜时间线" }));

  await waitFor(() => expect(startWorkflow).toHaveBeenCalledWith(project.id));
  expect(await screen.findByRole("status")).toHaveTextContent("1 个镜头");
  fireEvent.click(screen.getByRole("button", { name: "查看任务记录" }));
  fireEvent.click(screen.getByRole("button", { name: "进入剪辑台" }));
  expect(openQueue).toHaveBeenCalledOnce();
  expect(openTimeline).toHaveBeenCalledOnce();
});

test("keeps a failed preview launch recoverable", async () => {
  const startWorkflow = vi.fn().mockRejectedValue(new Error("conflict"));
  render(
    <FakeWorkflowPanel
      project={project}
      sourceFilename="golden.txt"
      startWorkflow={startWorkflow}
      onOpenQueue={vi.fn()}
      onOpenTimeline={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "生成 Fake 分镜时间线" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("原文和已有时间线都没有被覆盖");
  expect(screen.getByRole("button", { name: "重新生成 Fake 分镜时间线" })).toBeEnabled();
});
