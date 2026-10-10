import "@testing-library/jest-dom/vitest";
import { createHash, webcrypto } from "node:crypto";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssemblyDialogueAudioEditor } from "./AssemblyDialogueAudioEditor";
import { bindAssemblyDialogue } from "./adapters/assemblyDialogue";
import { splitAssemblySegment } from "./adapters/assemblyEditing";
import { staticAnimaticContent, type AssemblyContent } from "./adapters/episodeMediaAssembly";
import type { ScriptVersion } from "./adapters/episodeScript";
import type { AssemblyScriptGateway } from "./useAssemblyScriptSources";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const blockId = `sblk_${"c".repeat(32)}`;
const media = {
  asset_id: `asset_${"d".repeat(32)}`,
  asset_version_id: `asv_${"e".repeat(32)}`,
  sha256: "f".repeat(64),
};
function source(number = 1): ScriptVersion {
  return {
    project_id: project,
    episode_id: episode,
    version_id: `ver_${String(number).repeat(32)}`,
    version_number: number,
    head_revision: number,
    parent_version_id: null,
    content_hash: `sha256:${String(number).repeat(64)}`,
    author_actor_id: "local-user",
    change_summary: "Saved dialogue",
    created_at: "2026-10-09T00:00:00Z",
    content: {
      schema_version: "1.0.0",
      project_id: project,
      episode_id: episode,
      scenes: [
        {
          scene_id: `scn_${"1".repeat(32)}`,
          ordinal: 1,
          heading: "码头 · 夜",
          blocks: [
            {
              block_id: blockId,
              ordinal: 1,
              kind: "DIALOGUE",
              speaker: "阿岚 🎙",
              text: "这场雨终于停了。",
              delivery: "OFF_SCREEN",
            },
          ],
        },
      ],
    },
  };
}
function binding(version = source()) {
  const speaker = version.content.scenes[0]!.blocks[0]!.speaker!;
  return {
    script_version_id: version.version_id,
    script_block_id: blockId,
    speaker_id: `spk_${createHash("sha256")
      .update(JSON.stringify([project, episode, version.version_id, speaker]), "utf8")
      .digest("hex")
      .slice(0, 32)}`,
    delivery: "OFF_SCREEN" as const,
  };
}
function content(bound = false): AssemblyContent {
  const value = staticAnimaticContent(project, episode, [{ media, frames: 50 }]);
  value.audio_segments = [
    {
      segment_id: "seg_recording",
      media,
      track_kind: "BGM",
      start_frame: 5,
      end_frame: 30,
      source_in_sample: 960,
      script_version_id: null,
      script_block_id: null,
      speaker_id: null,
      delivery: null,
    },
  ];
  return bound ? bindAssemblyDialogue(value, "seg_recording", binding()) : value;
}
const found = (version: ScriptVersion) => ({
  kind: "FOUND" as const,
  receipt: { data: version, request_id: "script-read" },
});
function gateway(latest = source()): AssemblyScriptGateway {
  return {
    getEpisodeScript: vi.fn().mockResolvedValue(found(latest)),
    getEpisodeScriptVersion: vi.fn().mockResolvedValue(found(source())),
  };
}
function Harness({
  initial = content(),
  api = gateway(),
  edit = vi.fn(),
  locked = false,
}: {
  initial?: AssemblyContent;
  api?: AssemblyScriptGateway;
  edit?: (value: AssemblyContent) => void;
  locked?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AssemblyDialogueAudioEditor
      content={value}
      selectedId="seg_recording"
      locked={locked}
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
  fireEvent.click(screen.getByText(/^对白轨 ·/, { selector: "summary" }));
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("imported dialogue audio binding", () => {
  it("binds only the selected saved dialogue with exact speaker and delivery, preserving original media and timing", async () => {
    const initial = content();
    const edit = vi.fn();
    render(<Harness initial={initial} edit={edit} />);
    expect(screen.getByLabelText("导入音频对白绑定")).not.toHaveAttribute("open");
    expand();
    const select = await screen.findByLabelText("本集已保存剧本对白");
    expect(edit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "绑定所选音频为对白轨" })).toBeDisabled();
    fireEvent.change(select, { target: { value: blockId } });
    fireEvent.click(screen.getByRole("button", { name: "绑定所选音频为对白轨" }));
    const next = edit.mock.calls[0]![0] as AssemblyContent;
    expect(next.audio_segments[0]).toEqual({
      ...initial.audio_segments[0],
      track_kind: "DIALOGUE",
      ...binding(),
    });
    expect(next.visual_segments).toBe(initial.visual_segments);
    expect(initial.audio_segments[0]!.track_kind).toBe("BGM");
    await screen.findByText(`固定对白：${source().version_id} / ${blockId}`);
    expect(await screen.findByText(/说话者 spk_/)).toHaveTextContent(binding().speaker_id);
    expect(screen.getByText(/绑定不证明录音说出了该对白或已完成口型同步/)).toBeInTheDocument();
  });
  it("preserves pinned old dialogue and requires confirmation before rebinding to a newer script", async () => {
    const latest = source(2);
    latest.content.scenes[0]!.blocks[0]!.text = "我们明天再出发。";
    const edit = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness initial={content(true)} api={gateway(latest)} edit={edit} />);
    expand();
    await screen.findByText(/剧本已有新版本/);
    expect(screen.getByText(/剧本 v1 · 码头 · 夜 · 阿岚 🎙：这场雨终于停了/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "将所选音频改绑到此对白" });
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledOnce();
    expect(edit).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(button);
    expect(edit.mock.calls[0]![0].audio_segments[0]).toMatchObject({
      ...binding(latest),
      track_kind: "DIALOGUE",
    });
  });
  it("keeps removed or unreadable fixed sources and refresh never edits", async () => {
    const latest = source(2);
    latest.content.scenes[0]!.blocks = [];
    const api = gateway(latest);
    const edit = vi.fn();
    render(<Harness initial={content(true)} api={api} edit={edit} />);
    expand();
    await screen.findByText(/最新剧本已没有此可绑定对白段落/);
    expect(screen.getByRole("button", { name: "将所选音频改绑到此对白" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "核对已保存剧本" }));
    expect(edit).not.toHaveBeenCalled();
    cleanup();
    vi.mocked(api.getEpisodeScriptVersion!).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    render(<Harness initial={content(true)} api={api} edit={edit} />);
    expand();
    await screen.findByText(/固定对白尚未可靠读回或身份不符/);
    expect(screen.getByText(`固定对白：${source().version_id} / ${blockId}`)).toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
  });
  it("rejects a speaker or delivery mismatch on the pinned source and keeps its binding", async () => {
    const initial = content(true);
    initial.audio_segments[0]!.speaker_id = `spk_${"0".repeat(32)}`;
    const edit = vi.fn();
    render(<Harness initial={initial} api={gateway(source(2))} edit={edit} />);
    expand();
    await screen.findByText(/固定对白尚未可靠读回或身份不符/);
    expect(screen.getByLabelText("本集已保存剧本对白")).toBeDisabled();
    expect(screen.getByRole("button", { name: "将所选音频改绑到此对白" })).toBeDisabled();
    expect(edit).not.toHaveBeenCalled();
  });
  it("offers no invented dialogue for empty, failed or legacy saved scripts", async () => {
    const api = gateway();
    vi.mocked(api.getEpisodeScript!).mockResolvedValue({ kind: "EMPTY" });
    const view = render(<Harness api={api} />);
    expand();
    await screen.findByText(/本集还没有已保存剧本/);
    expect(screen.queryByLabelText("本集已保存剧本对白")).not.toBeInTheDocument();
    view.unmount();
    vi.mocked(api.getEpisodeScript!).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    render(<Harness initial={content(true)} api={api} />);
    expand();
    await screen.findByText(/已保存剧本读取未完成/);
    expect(screen.getByText(`固定对白：${source().version_id} / ${blockId}`)).toBeInTheDocument();
    cleanup();
    const legacy = source();
    delete legacy.content.scenes[0]!.blocks[0]!.delivery;
    render(<Harness api={gateway(legacy)} />);
    expand();
    await screen.findByText(/没有带明确呈现方式的对白/);
    expect(screen.getByRole("button", { name: "绑定所选音频为对白轨" })).toBeDisabled();
  });
  it("disables binding while locked and clears pending choices when the selected audio changes", async () => {
    const initial = content();
    initial.audio_segments.push({ ...initial.audio_segments[0]!, segment_id: "seg_other" });
    const edit = vi.fn().mockReturnValue(true);
    const api = gateway();
    const view = render(
      <AssemblyDialogueAudioEditor
        content={initial}
        selectedId="seg_recording"
        locked={false}
        gateway={api}
        onEdit={edit}
      />,
    );
    expand();
    const select = await screen.findByLabelText("本集已保存剧本对白");
    fireEvent.change(select, { target: { value: blockId } });
    view.rerender(
      <AssemblyDialogueAudioEditor
        content={initial}
        selectedId="seg_other"
        locked={false}
        gateway={api}
        onEdit={edit}
      />,
    );
    expect(screen.getByLabelText("本集已保存剧本对白")).toHaveValue("");
    expect(screen.getByRole("button", { name: "绑定所选音频为对白轨" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("本集已保存剧本对白"), { target: { value: blockId } });
    view.rerender(
      <AssemblyDialogueAudioEditor
        content={initial}
        selectedId="seg_other"
        locked
        gateway={api}
        onEdit={edit}
      />,
    );
    expect(screen.getByRole("button", { name: "绑定所选音频为对白轨" })).toBeDisabled();
    expect(edit).not.toHaveBeenCalled();
  });
  it("removes only an explicitly confirmed binding and audio split preserves provenance", async () => {
    const initial = content(true);
    const split = splitAssemblySegment(initial, "seg_recording", 20, "seg_second", 48000)!;
    expect(split.audio_segments.map((item) => item.script_version_id)).toEqual([
      source().version_id,
      source().version_id,
    ]);
    const edit = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness initial={initial} edit={edit} />);
    expand();
    const button = screen.getByRole("button", { name: "改为 BGM 并移除对白绑定" });
    fireEvent.click(button);
    expect(edit).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(button);
    expect(edit.mock.calls[0]![0].audio_segments[0]).toEqual({
      ...initial.audio_segments[0],
      track_kind: "BGM",
      script_version_id: null,
      script_block_id: null,
      speaker_id: null,
      delivery: null,
    });
    expect(initial.audio_segments[0]!.track_kind).toBe("DIALOGUE");
  });
});
