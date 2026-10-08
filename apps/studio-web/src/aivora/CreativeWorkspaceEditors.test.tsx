import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceParts } from "./CreativeWorkspaceFrame";
import { EpisodeScriptEditor } from "./EpisodeScriptEditor";
import { StoryboardWorkspaceView } from "./StoryboardWorkspaceView";
import { createStudioTransport } from "../api/studio";
import type { ScriptGateway, ScriptVersion } from "./adapters/episodeScript";
import type { StoryboardGateway, StoryboardVersion } from "./adapters/episodeStoryboard";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
vi.mock("./CreativeWorkspaceFrame", () => ({
  CreativeWorkspaceFrame: (parts: WorkspaceParts) => (
    <>
      <aside>
        {parts.outline}
        {parts.outlineAction}
      </aside>
      <main>{parts.children}</main>
      <aside>{parts.properties}</aside>
      <div>{parts.notice}</div>
      <footer>
        {parts.status}
        {parts.actions}
      </footer>
    </>
  ),
}));
const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const secondEpisode = `ep_${"c".repeat(32)}`;
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const baseVersion: ScriptVersion = {
  version_id: `ver_${"d".repeat(32)}`,
  project_id: project,
  episode_id: episode,
  version_number: 1,
  head_revision: 1,
  parent_version_id: null,
  content: {
    schema_version: "1.0.0",
    project_id: project,
    episode_id: episode,
    production_brief_version_id: `ver_${"e".repeat(32)}`,
    story_bible_version_id: null,
    source_extraction_version_id: null,
    source_proposal_acceptance_id: null,
    scenes: [
      {
        scene_id: `scn_${"f".repeat(32)}`,
        ordinal: 1,
        heading: "桥边 · 日",
        blocks: [
          {
            block_id: `sblk_${"1".repeat(32)}`,
            ordinal: 1,
            kind: "ACTION",
            text: "她停在桥边。",
            speaker: null,
            delivery: null,
          },
        ],
      },
    ],
  },
  content_hash: `sha256:${"2".repeat(64)}`,
  author_actor_id: "local-user",
  change_summary: "初稿",
  created_at: "2026-10-08T05:00:00Z",
};
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("reversible desktop editor presentation", () => {
  it.each([false, true])(
    "retains script identity, guards dirty navigation and reads saved versions (workspace=%s)",
    async (workspace) => {
      let saved = structuredClone(baseVersion);
      let guard: (() => boolean) | null = null;
      const registerGuard = (value: (() => boolean) | null) => {
        guard = value;
      };
      const api: ScriptGateway = {
        getEpisodeScript: vi.fn<ScriptGateway["getEpisodeScript"]>(async (_p, e) =>
          e === episode
            ? { kind: "FOUND" as const, receipt: { data: saved, request_id: requestId } }
            : { kind: "EMPTY" as const },
        ),
        getEpisodeScriptVersion: vi.fn<ScriptGateway["getEpisodeScriptVersion"]>(async () => ({
          kind: "FOUND",
          receipt: { data: saved, request_id: requestId },
        })),
        createEpisodeScriptVersion: vi.fn<ScriptGateway["createEpisodeScriptVersion"]>(
          async (_p, _e, _key, payload) => {
            saved = {
              ...saved,
              version_id: `ver_${"3".repeat(32)}`,
              version_number: 2,
              head_revision: 2,
              content: payload.content,
              parent_version_id: payload.parent_version_id,
            };
            return {
              kind: "CREATED",
              receipt: { data: { version: saved, replayed: false }, request_id: requestId },
            };
          },
        ),
      };
      vi.mocked(createStudioTransport).mockReturnValue(
        api as ReturnType<typeof createStudioTransport>,
      );
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const view = render(
        <EpisodeScriptEditor
          workspace={workspace}
          projectId={project}
          episodeId={episode}
          briefVersionId={null}
          setNavigationGuard={registerGuard}
        />,
      );
      await screen.findByDisplayValue("她停在桥边。");
      fireEvent.change(screen.getByLabelText("动作内容"), {
        target: { value: "她停在桥边，听见脚步。" },
      });
      let allowed = true;
      act(() => {
        allowed = guard?.() ?? true;
      });
      expect(allowed).toBe(false);
      expect(confirm).toHaveBeenCalledOnce();
      expect(screen.getByLabelText("动作内容")).toHaveValue("她停在桥边，听见脚步。");
      fireEvent.click(screen.getByRole("button", { name: "保存草稿版本" }));
      await screen.findByText(/草稿版本 2 已保存并精确读回/);
      expect(saved.content.scenes[0]?.scene_id).toBe(baseVersion.content.scenes[0]?.scene_id);
      expect(saved.content.scenes[0]?.blocks[0]?.block_id).toBe(
        baseVersion.content.scenes[0]?.blocks[0]?.block_id,
      );
      expect(saved.content.scenes[0]?.blocks[0]?.text).toBe("她停在桥边，听见脚步。");
      expect(api.getEpisodeScriptVersion).toHaveBeenCalledWith(project, episode, saved.version_id);
      act(() => {
        allowed = guard?.() ?? false;
      });
      expect(allowed).toBe(true);
      view.unmount();
      render(
        <EpisodeScriptEditor
          workspace={workspace}
          projectId={project}
          episodeId={secondEpisode}
          briefVersionId={null}
          setNavigationGuard={registerGuard}
        />,
      );
      await screen.findByText("此剧集还没有场次。从添加场次开始。");
      expect(screen.queryByDisplayValue("她停在桥边，听见脚步。")).toBeNull();
    },
  );

  it("creates and saves a real storyboard command from the workspace, preserving shot identity on reopen", async () => {
    let saved: StoryboardVersion | null = null;
    const api: StoryboardGateway = {
      getEpisodeStoryboard: vi.fn<StoryboardGateway["getEpisodeStoryboard"]>(async () =>
        saved
          ? { kind: "FOUND", receipt: { data: saved, request_id: requestId } }
          : { kind: "EMPTY" },
      ),
      getEpisodeStoryboardVersion: vi.fn<StoryboardGateway["getEpisodeStoryboardVersion"]>(
        async () =>
          saved
            ? { kind: "FOUND", receipt: { data: saved, request_id: requestId } }
            : { kind: "REMOTE_UNKNOWN" },
      ),
      createEpisodeStoryboardVersion: vi.fn<StoryboardGateway["createEpisodeStoryboardVersion"]>(
        async (_p, _e, _key, payload) => {
          saved = {
            project_id: project,
            episode_id: episode,
            version_id: `ver_${"4".repeat(32)}`,
            version_number: 1,
            head_revision: 1,
            parent_version_id: null,
            content: payload.content,
            content_hash: `sha256:${"5".repeat(64)}`,
            author_actor_id: "local-user",
            change_summary: payload.change_summary,
            created_at: "2026-10-08T05:00:00Z",
          };
          return {
            kind: "CREATED",
            receipt: { data: { version: saved, replayed: false }, request_id: requestId },
          };
        },
      ),
    };
    vi.mocked(createStudioTransport).mockReturnValue(
      api as ReturnType<typeof createStudioTransport>,
    );
    const registerGuard = vi.fn();
    const view = render(
      <StoryboardWorkspaceView
        projectId={project}
        episodeId={episode}
        setNavigationGuard={registerGuard}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "添加镜头" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "添加镜头" }));
    fireEvent.change(screen.getByLabelText("镜头标题"), { target: { value: "桥边相遇" } });
    fireEvent.change(screen.getByLabelText("画面描述"), { target: { value: "两人在桥上相遇。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
    await screen.findByText(/已保存，并已回读核对/);
    const payload = vi.mocked(api.createEpisodeStoryboardVersion).mock.calls[0]?.[3];
    const id = payload?.content.shots[0]?.shot_id;
    expect(id).toMatch(/^shp_[0-9a-f]{32}$/);
    expect(payload?.content.shots[0]?.description).toBe("两人在桥上相遇。");
    expect(api.getEpisodeStoryboardVersion).toHaveBeenCalledOnce();
    view.unmount();
    render(
      <StoryboardWorkspaceView
        projectId={project}
        episodeId={episode}
        setNavigationGuard={registerGuard}
      />,
    );
    await screen.findByDisplayValue("桥边相遇");
    expect(screen.getByLabelText("画面描述")).toHaveValue("两人在桥上相遇。");
    expect(screen.getByText(`镜头身份：${id}`)).toBeInTheDocument();
  });
});
