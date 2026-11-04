import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Editor } from "./model";
import type { EpisodeCreateResult } from "../api/studio";
import { CreativeWorkspaceNavigation } from "./CreativeWorkspaceNavigation";

function model() {
  return {
    value: () => "1",
    projects: [
      { id: 1, name: "First" },
      { id: 2, name: "Second" },
    ],
    episodes: [
      { id: "ep1", title: "One" },
      { id: "ep2", title: "Two" },
    ],
    selectedEpisodeId: "ep1",
    episodeState: "ready",
    episodeCreateInFlight: false,
    episodeCreateMarker: null as string | null,
    episodeAcknowledgementReady: false,
    selectRealProject: vi.fn(),
    selectRealEpisode: vi.fn(),
    refreshRealEpisodes: vi.fn(),
    acknowledgeEpisodeCreation: vi.fn(),
    notify: vi.fn(),
    setEditor: vi.fn<(editor: Editor) => void>(),
    createRealEpisode: vi
      .fn<() => Promise<Pick<EpisodeCreateResult, "kind">>>()
      .mockResolvedValue({ kind: "SUCCEEDED" }),
  };
}
let view = model();
vi.mock("./model", () => ({ useDemo: () => view }));
beforeEach(() => {
  view = model();
});
afterEach(cleanup);
describe("creative navigation uses guarded model commands", () => {
  test("project and episode selections delegate once; active or unknown selections do nothing", () => {
    render(<CreativeWorkspaceNavigation />);
    fireEvent.change(screen.getByRole("combobox", { name: "作品选择" }), {
      target: { value: "2" },
    });
    expect(view.selectRealProject).toHaveBeenCalledExactlyOnceWith(2);
    fireEvent.change(screen.getByRole("combobox", { name: "作品选择" }), {
      target: { value: "missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "01One" }));
    expect(view.selectRealEpisode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "02Two" }));
    expect(view.selectRealEpisode).toHaveBeenCalledExactlyOnceWith("ep2");
    expect(view.selectRealProject).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "01One" })).toHaveAttribute("aria-current", "true");
  });
  test.each(["loading", "storage-error", "inflight", "unknown"])("%s blocks creation", (state) => {
    if (state === "inflight") view.episodeCreateInFlight = true;
    else if (state === "unknown") view.episodeCreateMarker = "UNKNOWN";
    else view.episodeState = state;
    render(<CreativeWorkspaceNavigation />);
    fireEvent.click(screen.getByRole("button", { name: "新建剧集" }));
    expect(view.setEditor).not.toHaveBeenCalled();
    if (state === "loading") expect(screen.getByRole("button", { name: "02Two" })).toBeDisabled();
  });
  test.each(["SUCCEEDED", "REMOTE_UNKNOWN", "UNAVAILABLE"] as const)(
    "creation %s does not repeat an uncertain command",
    async (kind) => {
      // UNAVAILABLE is a model-level outcome, outside the transport result union.
      const create = vi.fn().mockResolvedValue({ kind });
      view.createRealEpisode = create;
      render(<CreativeWorkspaceNavigation />);
      fireEvent.click(screen.getByRole("button", { name: "新建剧集" }));
      const editor = view.setEditor.mock.calls[0]![0];
      await act(async () => {
        expect(await editor.save?.({ title: " " })).toBe(false);
      });
      expect(create).not.toHaveBeenCalled();
      await act(async () => {
        expect(await editor.save?.({ title: " New " })).toBe(
          kind === "SUCCEEDED" ? undefined : false,
        );
      });
      expect(create).toHaveBeenCalledExactlyOnceWith({ title: "New" });
      expect(view.notify).toHaveBeenCalledWith(
        kind === "SUCCEEDED"
          ? "剧集已创建并读回，可以开始编写。"
          : kind === "REMOTE_UNKNOWN"
            ? "创建结果待确认，请刷新剧集列表核对。"
            : "剧集未创建，请核对名称和工作区连接后重试。",
      );
    },
  );
  test("unknown recovery exposes a read and requires explicit acknowledgement readiness", () => {
    view.episodeCreateMarker = "UNKNOWN";
    const { rerender } = render(<CreativeWorkspaceNavigation />);
    fireEvent.click(screen.getByRole("button", { name: "刷新剧集列表" }));
    expect(view.refreshRealEpisodes).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "我已核对结果，允许新建" }));
    expect(view.acknowledgeEpisodeCreation).not.toHaveBeenCalled();
    view.episodeAcknowledgementReady = true;
    rerender(<CreativeWorkspaceNavigation />);
    fireEvent.click(screen.getByRole("button", { name: "我已核对结果，允许新建" }));
    expect(view.acknowledgeEpisodeCreation).toHaveBeenCalledTimes(1);
    expect(view.createRealEpisode).not.toHaveBeenCalled();
  });
  test("empty and error states remain distinguishable", () => {
    view.episodes = [];
    const { rerender } = render(<CreativeWorkspaceNavigation />);
    expect(screen.getByText("新建一集开始创作。")).toBeVisible();
    view.episodeState = "error";
    rerender(<CreativeWorkspaceNavigation />);
    expect(screen.getByText("剧集读取未完成")).toBeVisible();
    expect(screen.queryByText("新建一集开始创作。")).not.toBeInTheDocument();
  });
});
