import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssemblyScriptProvenance } from "./AssemblyScriptProvenance";
import { AssemblySubtitleEditor } from "./AssemblySubtitleEditor";
import { useConfirmedAssemblyScript } from "./useConfirmedAssemblyScript";
import {
  staticAnimaticContent,
  type AssemblyContent,
  type AssemblyTextSubtitleSegment,
} from "./adapters/episodeMediaAssembly";
import type { ScriptConfirmationStatus, ScriptVersion } from "./adapters/episodeScript";
import type { AssemblyScriptGateway } from "./useAssemblyScriptSources";

const project = `prj_${"1".repeat(32)}`,
  episode = `ep_${"2".repeat(32)}`,
  block = `sblk_${"3".repeat(32)}`;
const media = {
  asset_id: `asset_${"4".repeat(32)}`,
  asset_version_id: `asv_${"5".repeat(32)}`,
  sha256: "6".repeat(64),
};
function script(n = 1, p = project, e = episode, text = "明天出发。", head = n): ScriptVersion {
  return {
    project_id: p,
    episode_id: e,
    version_id: `ver_${String(n).repeat(32)}`,
    version_number: n,
    head_revision: head,
    parent_version_id: null,
    content_hash: `sha256:${String(n).repeat(64)}`,
    author_actor_id: "local-user",
    change_summary: "Saved script",
    created_at: "2026-10-11T00:00:00Z",
    content: {
      schema_version: "1.0.0",
      project_id: p,
      episode_id: e,
      scenes: [
        {
          scene_id: `scn_${"7".repeat(32)}`,
          ordinal: 1,
          heading: "码头",
          blocks: [
            {
              block_id: block,
              ordinal: 1,
              kind: "DIALOGUE",
              speaker: "阿岚",
              delivery: "ON_SCREEN",
              text,
            },
          ],
        },
      ],
    },
  };
}
function status(
  s = script(),
  { latest = s.version_id, head = s.head_revision, digit = "8" } = {},
): ScriptConfirmationStatus {
  return {
    project_id: s.project_id,
    episode_id: s.episode_id,
    latest_version_id: latest,
    latest_head_revision: head,
    current: latest === s.version_id,
    confirmation: {
      confirmation_id: `esc_${digit.repeat(32)}`,
      project_id: s.project_id,
      episode_id: s.episode_id,
      artifact_id: `art_${"9".repeat(32)}`,
      version_id: s.version_id,
      content_hash: s.content_hash,
      head_revision: s.version_number,
      actor_id: "local-user",
      confirmed_at: "2026-10-11T00:00:00Z",
    },
  };
}
function gateway(s = script(), st = status(s)): AssemblyScriptGateway {
  return {
    getEpisodeScriptConfirmation: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: st, request_id: "confirmation-read" } }),
    getEpisodeScriptVersion: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: s, request_id: "source-read" } }),
  };
}
function content(
  s = script(),
  confirmed = false,
): AssemblyContent & { subtitle_segments: AssemblyTextSubtitleSegment[] } {
  const c = staticAnimaticContent(s.project_id, s.episode_id, [{ media, frames: 100 }]);
  c.subtitle_segments = [
    {
      segment_id: "seg_subtitle",
      start_frame: 10,
      end_frame: 30,
      text: s.content.scenes[0]!.blocks[0]!.text,
      render_profile: "noto-cjk-sc-bottom-v1",
      script_ref: {
        script_version_id: s.version_id,
        script_block_id: block,
        script_content_hash: s.content_hash,
      },
    },
  ];
  c.script_provenance = confirmed
    ? {
        mode: "CONFIRMED",
        confirmation_id: status(s).confirmation!.confirmation_id,
        script_version_id: s.version_id,
        script_content_hash: s.content_hash,
      }
    : { mode: "DRAFT" };
  return c as AssemblyContent & { subtitle_segments: AssemblyTextSubtitleSegment[] };
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exact confirmed sound/subtitle source workflow", () => {
  it("explicit adoption preserves media, exact cues and frames; reading never edits", async () => {
    const initial = content(),
      edit = vi.fn(),
      blocked = vi.fn();
    render(
      <AssemblyScriptProvenance
        content={initial}
        savedVersion={null}
        locked={false}
        onEdit={edit}
        onSaveBlocked={blocked}
        gateway={gateway()}
      />,
    );
    const adopt = await screen.findByRole("button", { name: "采用此已确认剧本来源" });
    await waitFor(() => expect(adopt).toBeEnabled());
    expect(edit).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(adopt);
    expect(edit).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(adopt);
    expect(edit).toHaveBeenCalledOnce();
    expect(edit.mock.calls[0]![0]).toMatchObject({
      script_provenance: {
        mode: "CONFIRMED",
        script_version_id: script().version_id,
        script_content_hash: script().content_hash,
      },
    });
    expect(edit.mock.calls[0]![0].subtitle_segments).toBe(initial.subtitle_segments);
    expect(edit.mock.calls[0]![0].visual_segments).toBe(initial.visual_segments);
  });
  it("a newer unconfirmed draft and duplicate same-source receipt keep adopted source usable", async () => {
    const old = script(1, project, episode, "明天出发。", 2),
      st = status(old, { latest: script(2).version_id, head: 2, digit: "a" }),
      blocked = vi.fn();
    render(
      <AssemblyScriptProvenance
        content={content(script(), true)}
        savedVersion={null}
        locked={false}
        onEdit={vi.fn()}
        onSaveBlocked={blocked}
        gateway={gateway(old, st)}
      />,
    );
    await screen.findByText(/已有未确认的新草稿/);
    expect(screen.getByRole("button", { name: "采用此已确认剧本来源" })).toBeDisabled();
    await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false));
    expect(screen.queryByText(/确认来源已替换或片段尚未对齐/)).not.toBeInTheDocument();
  });
  it("new confirmation lists precise old cues, blocks save and preserves old pin during repair", async () => {
    const edit = vi.fn(),
      blocked = vi.fn();
    const view = render(
      <AssemblyScriptProvenance
        content={content(script(), true)}
        savedVersion={null}
        locked={false}
        onEdit={edit}
        onSaveBlocked={blocked}
        gateway={gateway(script(2))}
      />,
    );
    await screen.findByText(/确认来源已替换或片段尚未对齐/);
    expect(screen.getByLabelText("待核对声音字幕片段")).toHaveTextContent("seg_subtitle");
    expect(blocked).toHaveBeenLastCalledWith(true);
    expect(edit).not.toHaveBeenCalled();
    view.rerender(
      <AssemblyScriptProvenance
        content={{
          ...content(script(2)),
          script_provenance: content(script(), true).script_provenance,
        }}
        savedVersion={null}
        locked={false}
        onEdit={edit}
        onSaveBlocked={blocked}
        gateway={gateway(script(2))}
      />,
    );
    const button = await screen.findByRole("button", { name: "采用此已确认剧本来源" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(edit.mock.calls[0]![0].script_provenance.script_version_id).toBe(script(2).version_id);
  });
  it("unknown confirmation cannot clear an existing pin or enable saving", async () => {
    const api = gateway(),
      edit = vi.fn(),
      blocked = vi.fn();
    vi.mocked(api.getEpisodeScriptConfirmation!).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    render(
      <AssemblyScriptProvenance
        content={content(script(), true)}
        savedVersion={null}
        locked={false}
        onEdit={edit}
        onSaveBlocked={blocked}
        gateway={api}
      />,
    );
    await screen.findByText(/确认来源未可靠读回/);
    expect(blocked).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("button", { name: "转回未确认 草稿 来源" })).not.toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
  });
  it("empty/mixed/incorrect hash sources cannot be adopted", async () => {
    const c = content();
    c.subtitle_segments[0]!.script_ref!.script_content_hash = `sha256:${"0".repeat(64)}`;
    render(
      <AssemblyScriptProvenance
        content={c}
        savedVersion={null}
        locked={false}
        onEdit={vi.fn()}
        onSaveBlocked={vi.fn()}
        gateway={gateway()}
      />,
    );
    await screen.findByText(/^最近确认：/);
    expect(screen.getByRole("button", { name: "采用此已确认剧本来源" })).toBeDisabled();
    cleanup();
    c.subtitle_segments = [];
    render(
      <AssemblyScriptProvenance
        content={c}
        savedVersion={null}
        locked={false}
        onEdit={vi.fn()}
        onSaveBlocked={vi.fn()}
        gateway={gateway()}
      />,
    );
    await screen.findByText(/^最近确认：/);
    expect(screen.getByRole("button", { name: "采用此已确认剧本来源" })).toBeDisabled();
  });
  it("fences A-B-A including an already completed cached A snapshot and late B reads", async () => {
    const pB = `prj_${"b".repeat(32)}`,
      eB = `ep_${"c".repeat(32)}`;
    const pendingB =
      deferred<
        Awaited<ReturnType<NonNullable<AssemblyScriptGateway["getEpisodeScriptConfirmation"]>>>
      >();
    const pendingA =
      deferred<
        Awaited<ReturnType<NonNullable<AssemblyScriptGateway["getEpisodeScriptConfirmation"]>>>
      >();
    const api = gateway();
    vi.mocked(api.getEpisodeScriptConfirmation!)
      .mockResolvedValueOnce({ kind: "FOUND", receipt: { data: status(), request_id: "A" } })
      .mockReturnValueOnce(pendingB.promise)
      .mockReturnValueOnce(pendingA.promise);
    const { result, rerender } = renderHook(({ p, e }) => useConfirmedAssemblyScript(p, e, api), {
      initialProps: { p: project, e: episode },
    });
    await waitFor(() => expect(result.current.source.state).toBe("ready"));
    rerender({ p: pB, e: eB });
    expect(result.current.source.state).toBe("loading");
    rerender({ p: project, e: episode });
    expect(result.current.source.state).toBe("loading");
    await act(async () =>
      pendingB.resolve({
        kind: "FOUND",
        receipt: { data: status(script(2, pB, eB)), request_id: "B" },
      }),
    );
    expect(result.current.source.state).toBe("loading");
    await act(async () =>
      pendingA.resolve({ kind: "FOUND", receipt: { data: status(), request_id: "A2" } }),
    );
    await waitFor(() => expect(result.current.source.state).toBe("ready"));
    expect(result.current.source.version!.project_id).toBe(project);
  });
  it.each(["scope", "hash", "version", "revision"])(
    "rejects inconsistent exact source %s",
    async (kind) => {
      const api = gateway();
      const bad = script();
      if (kind === "scope") bad.episode_id = `ep_${"b".repeat(32)}`;
      if (kind === "hash") bad.content_hash = `sha256:${"b".repeat(64)}`;
      if (kind === "version") bad.version_id = script(2).version_id;
      if (kind === "revision") bad.head_revision = 2;
      vi.mocked(api.getEpisodeScriptVersion!).mockResolvedValue({
        kind: "FOUND",
        receipt: { data: bad, request_id: "bad" },
      });
      const { result } = renderHook(() => useConfirmedAssemblyScript(project, episode, api));
      await waitFor(() => expect(result.current.source.state).toBe("error"));
      expect(result.current.status).toBeUndefined();
    },
  );
  it("a rollback of a verified confirmation snapshot cannot re-enable old source adoption", async () => {
    const s2 = script(2),
      api = gateway(s2),
      { result } = renderHook(() => useConfirmedAssemblyScript(project, episode, api));
    await waitFor(() => expect(result.current.source.state).toBe("ready"));
    vi.mocked(api.getEpisodeScriptConfirmation!).mockResolvedValue({
      kind: "FOUND",
      receipt: { data: status(script()), request_id: "rolled-back" },
    });
    vi.mocked(api.getEpisodeScriptVersion!).mockResolvedValue({
      kind: "FOUND",
      receipt: { data: script(), request_id: "old-exact" },
    });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.source.state).toBe("error"));
    expect(result.current.status).toBeUndefined();
  });
});

function SubtitleHarness({
  initial = { ...content(), subtitle_segments: [] },
  api = gateway(),
  edit = vi.fn(),
  pending = vi.fn(),
}: {
  initial?: AssemblyContent;
  api?: AssemblyScriptGateway;
  edit?: (c: AssemblyContent) => void;
  pending?: (p: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AssemblySubtitleEditor
      content={value}
      frame={5}
      locked={false}
      onEdit={(next) => {
        edit(next);
        setValue(next);
        return true;
      }}
      onPendingInput={pending}
      gateway={api}
    />
  );
}
describe("real script-derived literal subtitles", () => {
  it("adds exact confirmed dialogue and frame source only after Apply; refresh preserves dirty input", async () => {
    const edit = vi.fn(),
      pending = vi.fn();
    render(<SubtitleHarness edit={edit} pending={pending} />);
    const select = await screen.findByLabelText("已确认剧本字幕对白");
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: block } });
    fireEvent.click(screen.getByRole("button", { name: "将所选剧本对白设为字幕" }));
    expect(edit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("字幕文字")).toHaveValue("明天出发。");
    fireEvent.change(screen.getByLabelText("字幕出点（不含此帧）"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "核对字幕剧本确认" }));
    await waitFor(() => expect(select).toBeEnabled());
    expect(screen.getByLabelText("字幕出点（不含此帧）")).toHaveValue(40);
    expect(pending).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
    expect(edit).toHaveBeenCalledOnce();
    const cue = edit.mock.calls[0]![0].subtitle_segments[0];
    expect(cue).toMatchObject({
      text: "明天出发。",
      start_frame: 5,
      end_frame: 40,
      script_ref: {
        script_version_id: script().version_id,
        script_block_id: block,
        script_content_hash: script().content_hash,
      },
    });
    expect(edit.mock.calls[0]![0].script_provenance).toEqual({ mode: "DRAFT" });
  });
  it("frame edits preserve provenance; text edits require explicit manual conversion", async () => {
    const edit = vi.fn();
    render(<SubtitleHarness initial={content()} edit={edit} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑字幕" }));
    fireEvent.change(screen.getByLabelText("字幕入点（帧）"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
    expect(edit.mock.calls[0]![0].subtitle_segments[0].script_ref).toEqual(
      content().subtitle_segments[0]!.script_ref,
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑字幕" }));
    fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "手工修改。" } });
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
    expect(edit).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("字幕文字")).toHaveValue("手工修改。");
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
    expect(edit.mock.calls[1]![0].subtitle_segments[0]).not.toHaveProperty("script_ref");
  });
  it("explicitly replaces old script source without changing frame range", async () => {
    const s2 = script(2, project, episode, "新对白。"),
      edit = vi.fn();
    render(<SubtitleHarness initial={content()} api={gateway(s2)} edit={edit} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑字幕" }));
    const select = screen.getByLabelText("已确认剧本字幕对白");
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: block } });
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "将所选剧本对白设为字幕" }));
    expect(screen.getByLabelText("字幕文字")).toHaveValue("明天出发。");
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "将所选剧本对白设为字幕" }));
    fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
    expect(edit.mock.calls[0]![0].subtitle_segments[0]).toMatchObject({
      start_frame: 10,
      end_frame: 30,
      text: "新对白。",
      script_ref: { script_version_id: s2.version_id, script_content_hash: s2.content_hash },
    });
  });
  it.each(["字".repeat(57), "不能替代😀"])(
    "unsupported script text stays blocked without truncation: %s",
    async (text) => {
      const edit = vi.fn();
      render(<SubtitleHarness api={gateway(script(1, project, episode, text))} edit={edit} />);
      const select = screen.getByLabelText("已确认剧本字幕对白");
      await waitFor(() => expect(select).toBeEnabled());
      fireEvent.change(select, { target: { value: block } });
      fireEvent.click(screen.getByRole("button", { name: "将所选剧本对白设为字幕" }));
      expect(screen.getByRole("alert")).toHaveTextContent("没有截断或替换");
      expect(screen.queryByLabelText("字幕文字")).not.toBeInTheDocument();
      expect(edit).not.toHaveBeenCalled();
    },
  );
});
