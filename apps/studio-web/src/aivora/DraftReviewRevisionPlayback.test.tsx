import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftReviewRevisionPlayback } from "./DraftReviewRevisionPlayback";
import type { DraftExportPreviewResult } from "./adapters/draftExport";
import type { DraftReviewRevisionExportGateway } from "./adapters/draftReviewRevision";
import { candidate, candidateJob, requestId } from "./adapters/draftReviewRevision.testFixtures";
const target = candidate.target;
const identity = {
  project_id: target.project_id,
  episode_id: target.episode_id,
  operation_id: target.operation_id,
  output_sha256: target.output_sha256,
  output_bytes: target.output_bytes,
};
const ready = (): DraftExportPreviewResult => ({
  kind: "READY",
  bytes: new Uint8Array(target.output_bytes),
  mime_type: "video/mp4",
  identity,
});
function setup(): DraftReviewRevisionExportGateway {
  return {
    get: vi.fn(async () => ({
      kind: "FOUND" as const,
      receipt: { data: candidateJob, request_id: requestId },
    })),
    list: vi.fn(async () => ({
      kind: "LISTED" as const,
      receipt: { data: { items: [candidateJob] }, request_id: requestId },
    })),
    preview: vi.fn(async () => ready()),
    reveal: vi.fn(async () => ({ kind: "REVEALED" as const, identity })),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:revision");
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("revision exact output comparison playback", () => {
  it("re-reads exact candidate identity before verified playback and revokes on close", async () => {
    const exports = setup();
    render(
      <DraftReviewRevisionPlayback target={target} exports={exports} label="候选版" verified />,
    );
    fireEvent.click(screen.getByRole("button", { name: "播放候选版草稿" }));
    const video = await screen.findByLabelText("候选版精确 DRAFT 草稿");
    expect(exports.get).toHaveBeenCalledWith(
      target.project_id,
      target.episode_id,
      target.operation_id,
    );
    expect(exports.preview).toHaveBeenCalledWith(
      target.project_id,
      target.episode_id,
      target.operation_id,
    );
    expect(video).toHaveAttribute("src", "blob:revision");
    expect(video).not.toHaveAttribute("autoplay");
    expect(screen.queryByText(candidateJob.output_path!)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭候选版预览" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:revision");
  });
  it("rejects changed task identities before reading bytes or exposing paths", async () => {
    const exports = setup();
    vi.mocked(exports.get).mockResolvedValue({
      kind: "FOUND",
      receipt: { data: { ...candidateJob, output_sha256: "f".repeat(64) }, request_id: requestId },
    });
    render(
      <DraftReviewRevisionPlayback target={target} exports={exports} label="候选版" verified />,
    );
    fireEvent.click(screen.getByRole("button", { name: "播放候选版草稿" }));
    await screen.findByText(/草稿任务与此精确文件证据不符/);
    expect(exports.preview).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("rejects wrong byte count or identity and stops missing-output actions", async () => {
    const exports = setup();
    vi.mocked(exports.preview!).mockResolvedValue({
      kind: "READY",
      bytes: new Uint8Array(1),
      mime_type: "video/mp4",
      identity,
    });
    const view = render(
      <DraftReviewRevisionPlayback target={target} exports={exports} label="候选版" verified />,
    );
    fireEvent.click(screen.getByRole("button", { name: "播放候选版草稿" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "播放候选版草稿" })).toBeEnabled(),
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    view.rerender(
      <DraftReviewRevisionPlayback
        target={target}
        exports={exports}
        label="候选版"
        verified={false}
      />,
    );
    expect(screen.getByRole("button", { name: "播放候选版草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "打开候选版草稿所在文件夹" })).toBeDisabled();
  });
  it("single-flight and close discard a pending preview without constructing a player", async () => {
    const exports = setup();
    const flight = deferred<DraftExportPreviewResult>();
    vi.mocked(exports.preview!).mockReturnValue(flight.promise);
    render(
      <DraftReviewRevisionPlayback target={target} exports={exports} label="候选版" verified />,
    );
    fireEvent.click(screen.getByRole("button", { name: "播放候选版草稿" }));
    await waitFor(() => expect(exports.preview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "播放候选版草稿" }));
    expect(exports.preview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "关闭候选版预览" }));
    await act(async () => {
      flight.resolve(ready());
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("候选版精确 DRAFT 草稿")).not.toBeInTheDocument();
  });
  it("reveal uses exact verified identity and never passes a filesystem path", async () => {
    const exports = setup();
    render(
      <DraftReviewRevisionPlayback target={target} exports={exports} label="候选版" verified />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开候选版草稿所在文件夹" }));
    await screen.findByText("已请求系统打开此精确草稿所在文件夹。");
    expect(exports.reveal).toHaveBeenCalledWith(
      target.project_id,
      target.episode_id,
      target.operation_id,
    );
  });
});
