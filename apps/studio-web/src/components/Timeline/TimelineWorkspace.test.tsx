import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { ProjectData, TimelineResponse } from "../../api/studio";
import { TimelineWorkspace } from "./TimelineWorkspace";

const requestId = "00000000-0000-4000-8000-000000000001";
const project = {
  id: "prj_11111111111111111111111111111111",
  name: "雾城来信",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  source_language: "zh-CN",
  status: "active",
  revision: 1,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
} satisfies ProjectData;

function timeline(revision = 1): TimelineResponse {
  return {
    request_id: requestId,
    data: {
      project_id: project.id,
      version_id: `ver_${String(revision).repeat(32)}`,
      content_hash: `sha256:${"a".repeat(64)}`,
      created_at: "2026-08-10T00:00:00Z",
      total_duration_frames: 84,
      timeline: {
        schema_version: 1,
        timeline_id: "episode-01-main",
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
            asset_id: "shot-rain",
            source_asset_sha256: `sha256:${"a".repeat(64)}`,
            source_frame_count: 120,
            proxy: null,
          },
          {
            schema_version: 1,
            asset_id: "shot-letter",
            source_asset_sha256: `sha256:${"b".repeat(64)}`,
            source_frame_count: 96,
            proxy: null,
          },
        ],
        clips: [
          {
            schema_version: 1,
            clip_id: "clip-rain",
            asset_id: "shot-rain",
            source_in_frame: 0,
            duration_frames: 48,
          },
          {
            schema_version: 1,
            clip_id: "clip-letter",
            asset_id: "shot-letter",
            source_in_frame: 12,
            duration_frames: 36,
          },
        ],
      },
    },
  };
}

describe("TimelineWorkspace", () => {
  test("shows an honest empty state when no timeline has been generated", async () => {
    render(
      <TimelineWorkspace
        project={project}
        loadTimeline={vi.fn().mockResolvedValue(null)}
        trimClip={vi.fn()}
        reorderClip={vi.fn()}
        replaceClip={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "时间线尚未生成" })).toBeInTheDocument();
    expect(screen.getByText("先完成分镜与素材生成")).toBeInTheDocument();
  });

  test("selects, trims and reorders clips using the server revision", async () => {
    const trimClip = vi.fn().mockResolvedValue(timeline(2));
    const reorderClip = vi.fn().mockResolvedValue(timeline(2));
    render(
      <TimelineWorkspace
        project={project}
        loadTimeline={vi.fn().mockResolvedValue(timeline())}
        trimClip={trimClip}
        reorderClip={reorderClip}
        replaceClip={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("option", { name: /clip-letter/ }));
    expect(screen.getByRole("option", { name: /clip-letter/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.change(screen.getByLabelText("源入点（帧）"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("持续（帧）"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "应用裁剪" }));
    await waitFor(() =>
      expect(trimClip).toHaveBeenCalledWith(project.id, {
        clip_id: "clip-letter",
        new_source_in_frame: 16,
        new_duration_frames: 30,
        expected_revision: 1,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "镜头前移" }));
    await waitFor(() =>
      expect(reorderClip).toHaveBeenCalledWith(project.id, {
        clip_id: "clip-letter",
        new_index: 0,
        expected_revision: 2,
      }),
    );
  });

  test("reloads after a rejected stale edit and announces the conflict", async () => {
    const loadTimeline = vi
      .fn()
      .mockResolvedValueOnce(timeline())
      .mockResolvedValueOnce(timeline(2));
    const trimClip = vi.fn().mockRejectedValue(new Error("status 409"));
    render(
      <TimelineWorkspace
        project={project}
        loadTimeline={loadTimeline}
        trimClip={trimClip}
        reorderClip={vi.fn()}
        replaceClip={vi.fn()}
      />,
    );

    await screen.findByRole("option", { name: /clip-rain/ });
    fireEvent.click(screen.getByRole("button", { name: "应用裁剪" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("已重新载入最新版本");
    expect(loadTimeline).toHaveBeenCalledTimes(2);
  });

  test("replaces the selected clip asset without changing its duration", async () => {
    const replaceClip = vi.fn().mockResolvedValue(timeline(2));
    render(
      <TimelineWorkspace
        project={project}
        loadTimeline={vi.fn().mockResolvedValue(timeline())}
        trimClip={vi.fn()}
        reorderClip={vi.fn()}
        replaceClip={replaceClip}
      />,
    );

    await screen.findByRole("option", { name: /clip-rain/ });
    fireEvent.change(screen.getByLabelText("替换素材"), {
      target: { value: "shot-letter" },
    });
    fireEvent.click(screen.getByRole("button", { name: "替换当前素材" }));

    await waitFor(() =>
      expect(replaceClip).toHaveBeenCalledWith(project.id, {
        clip_id: "clip-rain",
        replacement_asset_id: "shot-letter",
        replacement_source_in_frame: 0,
        expected_revision: 1,
      }),
    );
  });

  test("offers a retry after the initial timeline read fails", async () => {
    const loadTimeline = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(null);
    render(
      <TimelineWorkspace
        project={project}
        loadTimeline={loadTimeline}
        trimClip={vi.fn()}
        reorderClip={vi.fn()}
        replaceClip={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "无法读取时间线" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
    expect(await screen.findByRole("heading", { name: "时间线尚未生成" })).toBeInTheDocument();
  });
});
