import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStudioTransport } from "../api/studio";
import { EpisodeScriptEditor } from "./EpisodeScriptEditor";
import type { WorkspaceParts } from "./CreativeWorkspaceFrame";
import type { AcceptedSummary } from "./adapters/acceptedSourceSummary";
import type { ScriptGateway, ScriptVersion, SourceBindingGateway } from "./adapters/episodeScript";
vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
vi.mock("./CreativeWorkspaceFrame", () => ({
  CreativeWorkspaceFrame: (parts: WorkspaceParts) => (
    <>
      {parts.outline}
      {parts.outlineAction}
      {parts.children}
      {parts.properties}
      {parts.notice}
      {parts.actions}
    </>
  ),
}));
vi.mock("./AcceptedSourceSummarySeed", () => ({
  AcceptedSourceSummarySeed: ({
    disabled,
    onImport,
  }: {
    disabled: boolean;
    onImport: (value: AcceptedSummary) => boolean;
  }) => (
    <button
      disabled={disabled}
      onClick={() =>
        onImport({
          summary: "人工接纳摘要",
          contentHash: `sha256:${"a".repeat(64)}`,
          binding: {
            sourceVersionId: `ver_${"b".repeat(32)}`,
            acceptanceId: `pda_${"c".repeat(32)}`,
          },
        })
      }
    >
      导入已核对摘要
    </button>
  ),
}));
const project = `prj_${"d".repeat(32)}`,
  episode = `ep_${"e".repeat(32)}`;
function setup() {
  let saved: ScriptVersion | null = null;
  const api: ScriptGateway & SourceBindingGateway = {
    getEpisodeScript: vi.fn<ScriptGateway["getEpisodeScript"]>(async () =>
      saved ? { kind: "FOUND", receipt: { data: saved, request_id: "test" } } : { kind: "EMPTY" },
    ),
    getEpisodeScriptVersion: vi.fn<ScriptGateway["getEpisodeScriptVersion"]>(async () =>
      saved
        ? { kind: "FOUND", receipt: { data: saved, request_id: "test" } }
        : { kind: "REMOTE_UNKNOWN" },
    ),
    createEpisodeScriptVersion: vi.fn<ScriptGateway["createEpisodeScriptVersion"]>(
      async (_p, _e, _id, payload) => {
        saved = {
          version_id: `ver_${"f".repeat(32)}`,
          project_id: project,
          episode_id: episode,
          version_number: 1,
          head_revision: 1,
          parent_version_id: null,
          content: payload.content,
          content_hash: `sha256:${"1".repeat(64)}`,
          author_actor_id: "local-user",
          change_summary: payload.change_summary,
          created_at: "2026-10-08T00:00:00Z",
        };
        return {
          kind: "CREATED",
          receipt: { data: { version: saved, replayed: false }, request_id: "test" },
        };
      },
    ),
    getSourceExtraction: vi
      .fn<SourceBindingGateway["getSourceExtraction"]>()
      .mockResolvedValue({ kind: "NOT_FOUND" }),
    getSourceProposalAcceptanceForVersion: vi.fn(),
  };
  vi.mocked(createStudioTransport).mockReturnValue(api as ReturnType<typeof createStudioTransport>);
  return api;
}
beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);
describe("approved summary to editable script binding", () => {
  it.each([false, true])(
    "pins the imported source through editing/save even if an older read resolves later (workspace=%s)",
    async (workspace) => {
      const api = setup();
      let finish: (value: { kind: "NOT_FOUND" }) => void = () => undefined;
      vi.mocked(api.getSourceExtraction).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      render(
        <EpisodeScriptEditor
          projectId={project}
          episodeId={episode}
          briefVersionId={null}
          workspace={workspace}
        />,
      );
      const button = await screen.findByRole("button", { name: "导入已核对摘要" });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      expect(await screen.findByDisplayValue("人工接纳摘要")).toBeVisible();
      await act(async () => finish({ kind: "NOT_FOUND" }));
      const sourceRefresh = screen.getByRole("button", {
        name: "重新核对已采纳来源",
        hidden: true,
      });
      expect(sourceRefresh).toBeDisabled();
      fireEvent.change(screen.getByDisplayValue("人工接纳摘要"), {
        target: { value: "人工改编后动作内容" },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存草稿版本" }));
      await waitFor(() => expect(api.createEpisodeScriptVersion).toHaveBeenCalledTimes(1));
      const payload = vi.mocked(api.createEpisodeScriptVersion).mock.calls[0]?.[3];
      expect(payload?.content.source_extraction_version_id).toBe(`ver_${"b".repeat(32)}`);
      expect(payload?.content.source_proposal_acceptance_id).toBe(`pda_${"c".repeat(32)}`);
      expect(payload?.content.scenes[0]?.blocks[0]?.text).toBe("人工改编后动作内容");
      await waitFor(() => expect(screen.getByText(/草稿版本 1 已保存并精确读回/)).toBeVisible());
    },
  );
  it("releases the pin only after explicit discard and authoritative empty read", async () => {
    setup();
    render(<EpisodeScriptEditor projectId={project} episodeId={episode} briefVersionId={null} />);
    const button = await screen.findByRole("button", { name: "导入已核对摘要" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "舍弃草稿并读取" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导入已核对摘要" })).toBeEnabled(),
    );
    expect(screen.queryByDisplayValue("人工接纳摘要")).toBeNull();
    expect(screen.getByRole("button", { name: "重新核对已采纳来源" })).toBeEnabled();
    expect(screen.getByText("此稿已采纳来源：当前未绑定")).toBeVisible();
  });
});
