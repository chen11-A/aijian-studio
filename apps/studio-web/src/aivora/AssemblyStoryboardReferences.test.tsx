import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssemblyStoryboardReferences } from "./AssemblyStoryboardReferences";
import type { AssemblyStoryboardGateway } from "./useAssemblyStoryboardSources";
import { bindAssemblyShot } from "./adapters/assemblyStoryboard";
import { splitAssemblySegment, reflowVisual } from "./adapters/assemblyEditing";
import {
  parseAssemblyReceipt,
  staticAnimaticContent,
  type AssemblyContent,
} from "./adapters/episodeMediaAssembly";
import { emptyStoryboardContent, type StoryboardVersion } from "./adapters/episodeStoryboard";

const project = `prj_${"a".repeat(32)}`,
  episode = `ep_${"b".repeat(32)}`;
const shotId = `shp_${"c".repeat(32)}`;
function source(number = 1): StoryboardVersion {
  return {
    project_id: project,
    episode_id: episode,
    version_id: `ver_${String(number).repeat(32)}`,
    version_number: number,
    head_revision: number,
    parent_version_id: null,
    content_hash: `sha256:${"d".repeat(64)}`,
    author_actor_id: "local-user",
    change_summary: "Manual storyboard",
    created_at: "2026-10-08T06:00:00Z",
    content: {
      ...emptyStoryboardContent(project, episode),
      fps: 24,
      shots: [
        {
          shot_id: shotId,
          ordinal: 1,
          duration_frames: 48,
          title: "码头",
          description: "灯火",
          action: "回望",
          dialogue: "",
          camera: "中景",
          script_scene_id: null,
          character_ids: [],
          location_id: null,
        },
      ],
    },
  };
}
const media = {
  asset_id: `asset_${"e".repeat(32)}`,
  asset_version_id: `asv_${"f".repeat(32)}`,
  sha256: "a".repeat(64),
};
function content(bound = false) {
  const value = staticAnimaticContent(project, episode, [{ media, frames: 50 }]);
  return bound
    ? bindAssemblyShot(value, value.visual_segments[0]!.segment_id, {
        storyboard_version_id: source().version_id,
        shot_id: shotId,
      })
    : value;
}
const found = (version: StoryboardVersion) => ({
  kind: "FOUND" as const,
  receipt: { data: version, request_id: "read" },
});
function gateway(latest = source()): AssemblyStoryboardGateway {
  return {
    getEpisodeStoryboard: vi.fn().mockResolvedValue(found(latest)),
    getEpisodeStoryboardVersion: vi.fn().mockResolvedValue(found(source())),
  };
}
function Harness({
  initial = content(),
  api = gateway(),
  edit = vi.fn(),
}: {
  initial?: AssemblyContent;
  api?: AssemblyStoryboardGateway;
  edit?: (value: AssemblyContent) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AssemblyStoryboardReferences
      content={value}
      selectedId={value.visual_segments[0]!.segment_id}
      locked={false}
      gateway={api}
      onEdit={(next) => {
        edit(next);
        setValue(next);
        return true;
      }}
    />
  );
}
function expand() {
  fireEvent.click(screen.getByText(/^分镜来源 ·/, { selector: "summary" }));
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("exact storyboard source for imported assembly visuals", () => {
  it("keeps the inspector compact until opened and rejects inconsistent immutable source reads", async () => {
    const latest = source();
    latest.content.shots[0]!.title = "unexpected mutation";
    const edit = vi.fn();
    render(<Harness initial={content(true)} api={gateway(latest)} edit={edit} />);
    expect(screen.getByLabelText("画面片段分镜来源")).not.toHaveAttribute("open");
    expand();
    await screen.findByText(/最新分镜读取未完成/);
    expect(screen.queryByLabelText("本集已保存分镜镜头")).not.toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
  });
  it("links only a saved version and shot, without changing media or timebase", async () => {
    const edit = vi.fn();
    const api = gateway();
    const initial = content();
    render(<Harness initial={initial} api={api} edit={edit} />);
    expand();
    await screen.findByLabelText("本集已保存分镜镜头");
    expect(edit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("本集已保存分镜镜头"), { target: { value: shotId } });
    fireEvent.click(screen.getByRole("button", { name: "关联所选镜头" }));
    const next = edit.mock.calls[0]![0] as AssemblyContent;
    expect(next.visual_segments[0]!.storyboard_ref).toEqual({
      storyboard_version_id: source().version_id,
      shot_id: shotId,
    });
    expect(next.visual_segments[0]!.media).toEqual(media);
    expect(next.total_frames).toBe(initial.total_frames);
    expect(next.sequence_timebase).toEqual(initial.sequence_timebase);
    expect(await screen.findByText(/来源标记不会改变剪辑时长或帧率/)).toBeInTheDocument();
    expect(screen.getByText(/不代表镜头完成或审片通过/)).toBeInTheDocument();
  });
  it("retains old links when a new storyboard removes the shot and refresh never edits", async () => {
    const latest = source(2);
    latest.content.shots = [];
    const edit = vi.fn();
    const api = gateway(latest);
    render(<Harness initial={content(true)} api={api} edit={edit} />);
    expand();
    await screen.findByText(/最新分镜已不含此镜头/);
    expect(screen.getByText(`固定来源：${source().version_id} / ${shotId}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "核对最新分镜" }));
    await waitFor(() => expect(api.getEpisodeStoryboard).toHaveBeenCalledTimes(2));
    expect(edit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "将所选片段改绑到此镜头" })).toBeDisabled();
  });
  it("warns about upstream changes and requires explicit confirmation to rebind", async () => {
    const latest = source(2);
    latest.content.shots[0]!.action = "起身";
    const edit = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness initial={content(true)} api={gateway(latest)} edit={edit} />);
    expand();
    await screen.findByText(/这个镜头或其上游版本已变化/);
    fireEvent.click(screen.getByRole("button", { name: "将所选片段改绑到此镜头" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(edit).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "将所选片段改绑到此镜头" }));
    expect(edit.mock.calls[0]![0].visual_segments[0].storyboard_ref.storyboard_version_id).toBe(
      latest.version_id,
    );
  });
  it("preserves unreadable fixed references and rejects wrong-scope/latest identities", async () => {
    const api = gateway();
    const edit = vi.fn();
    vi.mocked(api.getEpisodeStoryboardVersion!).mockResolvedValue(found(source(2)));
    render(<Harness initial={content(true)} api={api} edit={edit} />);
    expand();
    await screen.findByText(/固定分镜尚未可靠读回/);
    expect(screen.getByRole("button", { name: "将所选片段改绑到此镜头" })).toBeDisabled();
    expect(edit).not.toHaveBeenCalled();
    cleanup();
    const foreign = source();
    foreign.episode_id = `ep_${"f".repeat(32)}`;
    render(<Harness api={gateway(foreign)} />);
    expand();
    await screen.findByText(/最新分镜读取未完成/);
    expect(screen.queryByLabelText("本集已保存分镜镜头")).not.toBeInTheDocument();
  });
  it("discards a late source read after scope change", async () => {
    let resolve!: (result: ReturnType<typeof found>) => void;
    const api: AssemblyStoryboardGateway = {
      getEpisodeStoryboard: vi
        .fn()
        .mockReturnValueOnce(
          new Promise((done) => {
            resolve = done;
          }),
        )
        .mockResolvedValue({ kind: "EMPTY" }),
    };
    const first = content();
    const edit = vi.fn();
    const view = render(
      <AssemblyStoryboardReferences
        content={first}
        selectedId={first.visual_segments[0]!.segment_id}
        locked={false}
        onEdit={edit}
        gateway={api}
      />,
    );
    expand();
    const second = { ...first, episode_id: `ep_${"e".repeat(32)}` };
    view.rerender(
      <AssemblyStoryboardReferences
        content={second}
        selectedId={first.visual_segments[0]!.segment_id}
        locked={false}
        onEdit={edit}
        gateway={api}
      />,
    );
    await screen.findByText(/本集还没有已保存分镜/);
    await act(async () => {
      resolve(found(source()));
    });
    expect(screen.queryByLabelText("本集已保存分镜镜头")).not.toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
  });
  it("removes only an explicitly confirmed segment link and preserves split/trim/reorder provenance", async () => {
    const original = content(true);
    const id = original.visual_segments[0]!.segment_id;
    const split = splitAssemblySegment(original, id, 25, "seg_split")!;
    expect(split.visual_segments.every((item) => item.storyboard_ref?.shot_id === shotId)).toBe(
      true,
    );
    const reordered = reflowVisual(split, [...split.visual_segments].reverse());
    expect(reordered.visual_segments[0]!.storyboard_ref).toEqual(
      original.visual_segments[0]!.storyboard_ref,
    );
    expect(bindAssemblyShot(split, id, null).visual_segments[1]!.storyboard_ref).toEqual(
      original.visual_segments[0]!.storyboard_ref,
    );
    const edit = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness initial={original} edit={edit} />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "移除所选片段的分镜引用" }));
    expect(edit).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "移除所选片段的分镜引用" }));
    expect(edit.mock.calls[0]![0].visual_segments[0]).not.toHaveProperty("storyboard_ref");
    expect(original.visual_segments[0]!.storyboard_ref).toBeDefined();
  });
  it("rejects malformed reference fields on a renderer receipt", () => {
    const initial = content(true);
    const receipt = {
      request_id: "test",
      data: {
        artifact_id: `art_${"a".repeat(32)}`,
        version_id: source().version_id,
        content_hash: source().content_hash,
        head_revision: 1,
        parent_version_id: null,
        content: initial,
        media_checks: [
          {
            media,
            kind: "image",
            availability: "VERIFIED",
            technical_status: "STILL_HEADER_ONLY",
            rights_status: "PENDING_REVIEW",
          },
        ],
        playback_status: "DRAFT_STATIC_ANIMATIC",
        export_status: "NO_EXPORT_CLAIM",
      },
    };
    expect(parseAssemblyReceipt(receipt, project, episode)).not.toBeNull();
    const malformed = structuredClone(receipt);
    Object.assign(malformed.data.content.visual_segments[0]!.storyboard_ref!, { fulfilled: true });
    expect(parseAssemblyReceipt(malformed, project, episode)).toBeNull();
  });
});
