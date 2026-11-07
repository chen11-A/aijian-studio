import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FilmRiskTrialDecision, FilmRiskTrialReady } from "@aijian/contracts/film-risk-trial";
import { ActualRiskTrialReview, type ActualTrialViewState } from "./ActualRiskTrialReview";
afterEach(cleanup);
const ready: FilmRiskTrialReady = {
  kind: "READY",
  projectId: "film_actualtrial00001",
  projectHash: "a".repeat(64),
  reviewId: `rtr_${"a".repeat(32)}`,
  shotId: "shot-main",
  takeId: "take-main",
  label: "第 7 场 · 镜头 4",
  versionLabel: "第 3 版",
  durationSeconds: 2.25,
  batchShotCount: 6,
  inputFingerprint: "b".repeat(64),
  existingDecision: null,
  limitations: [
    "这是所选版本的画面素材，不是最终混音与字幕成片。",
    "接受是人工决定，不证明已经观看、试听或技术验收通过。",
  ],
};
const record: FilmRiskTrialDecision = {
  schemaVersion: 1,
  id: `rtd_${"a".repeat(32)}`,
  projectId: ready.projectId,
  shotId: ready.shotId,
  takeId: ready.takeId,
  inputFingerprint: ready.inputFingerprint,
  decision: "accepted",
  note: "人工观察后的原样说明",
  recordedAt: "2026-11-07T11:00:00.000Z",
};
const loaded: ActualTrialViewState = {
  kind: "ready",
  ready,
  mediaSrc: "blob:synthetic-actual-video",
  mediaFailed: false,
};
function props() {
  return {
    state: loaded,
    busy: false,
    stale: false,
    pending: false,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onRecord: vi.fn(),
    onMediaError: vi.fn(),
    onCheckPending: vi.fn(),
    onContinue: vi.fn(),
  };
}
it("never infers acceptance or a saved decision from metadata, playing or reaching the end", () => {
  const p = props();
  const { container } = render(<ActualRiskTrialReview {...p} />);
  const video = container.querySelector("video")!;
  fireEvent.loadedMetadata(video);
  fireEvent.play(video);
  fireEvent.ended(video);
  expect(screen.getAllByRole("radio").every((input) => !(input as HTMLInputElement).checked)).toBe(
    true,
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "保存本次人工决定" })).toBeDisabled();
  expect(p.onRecord).not.toHaveBeenCalled();
  expect(p.onContinue).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain(ready.reviewId);
  expect(container.textContent).not.toContain(ready.inputFingerprint);
  expect(container.textContent).not.toContain(ready.takeId);
});
it("requires explicit decision and human acceptance, preserves exact note text, and obeys the busy lock", () => {
  const p = props();
  const { rerender } = render(<ActualRiskTrialReview {...p} />);
  const note = "  原样说明\n保留换行与网址 https://example.test/  ";
  fireEvent.change(screen.getByRole("textbox"), { target: { value: note } });
  fireEvent.click(screen.getByRole("radio", { name: "接受这个实际版本" }));
  expect(screen.getByRole("button", { name: "保存本次人工决定" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "保存本次人工决定" }));
  expect(p.onRecord).toHaveBeenCalledExactlyOnceWith("accepted", note);
  rerender(<ActualRiskTrialReview {...p} busy />);
  fireEvent.click(screen.getByRole("button", { name: "保存本次人工决定" }));
  expect(p.onRecord).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox")).toHaveValue(note);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(p.onClose).toHaveBeenCalledOnce();
});
it("keeps over-limit Unicode input intact and resets decision/attestation for a new actual review without submitting it", () => {
  const p = props();
  const { rerender } = render(<ActualRiskTrialReview {...p} />);
  const note = "😀".repeat(251);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: note } });
  fireEvent.click(screen.getByRole("radio", { name: "这个实际版本需要修改" }));
  expect(screen.getByRole("textbox")).toHaveValue(note);
  expect(screen.getByRole("button", { name: "保存本次人工决定" })).toBeDisabled();
  expect(p.onRecord).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "新的说明" } });
  expect(screen.getByRole("button", { name: "保存本次人工决定" })).toBeEnabled();
  rerender(
    <ActualRiskTrialReview
      {...p}
      state={{ ...loaded, kind: "ready", ready: { ...ready, reviewId: `rtr_${"b".repeat(32)}` } }}
    />,
  );
  expect(screen.getAllByRole("radio").every((input) => !(input as HTMLInputElement).checked)).toBe(
    true,
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("textbox")).toHaveValue("新的说明");
  expect(screen.getByRole("button", { name: "保存本次人工决定" })).toBeDisabled();
});
it("does not retry unknown writes, keeps review closeable, and only explicitly opens recovery", () => {
  const p = props();
  render(<ActualRiskTrialReview {...p} pending />);
  fireEvent.click(screen.getByRole("radio", { name: "这个实际版本需要修改" }));
  expect(screen.getByRole("button", { name: "保存本次人工决定" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "重新核对实际素材" })).toBeDisabled();
  expect(p.onCheckPending).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "核对试片保存结果" }));
  expect(p.onCheckPending).toHaveBeenCalledOnce();
  expect(p.onRecord).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(p.onClose).toHaveBeenCalledOnce();
});
it("does not turn an old or unverified human fact into continuation; a verified current saved record still needs explicit action", () => {
  const p = props();
  const { rerender } = render(
    <ActualRiskTrialReview
      {...p}
      canContinue
      state={{ ...loaded, kind: "ready", ready: { ...ready, existingDecision: record } }}
    />,
  );
  expect(screen.queryByRole("button", { name: "核对决定后继续本批" })).not.toBeInTheDocument();
  rerender(
    <ActualRiskTrialReview
      {...p}
      canContinue
      state={{ ...loaded, kind: "ready", recorded: { value: record, verified: false } }}
    />,
  );
  expect(screen.queryByRole("button", { name: "核对决定后继续本批" })).not.toBeInTheDocument();
  rerender(
    <ActualRiskTrialReview
      {...p}
      canContinue
      stale
      state={{ ...loaded, kind: "ready", recorded: { value: record, verified: true } }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "核对决定后继续本批" }));
  expect(p.onContinue).not.toHaveBeenCalled();
  rerender(
    <ActualRiskTrialReview
      {...p}
      canContinue
      state={{ ...loaded, kind: "ready", recorded: { value: record, verified: true } }}
    />,
  );
  expect(p.onContinue).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "核对决定后继续本批" }));
  expect(p.onContinue).toHaveBeenCalledExactlyOnceWith(record.id);
});
it("keeps every main limitation visible and refuses recording after an actual media error", () => {
  const p = props(),
    long = "人工仍需核对画面和声音。".repeat(60);
  const { container, rerender } = render(
    <ActualRiskTrialReview
      {...p}
      state={{
        ...loaded,
        kind: "ready",
        ready: { ...ready, limitations: [...ready.limitations, long] },
      }}
    />,
  );
  expect(screen.getByText(long)).toBeInTheDocument();
  fireEvent.error(container.querySelector("video")!);
  expect(p.onMediaError).toHaveBeenCalledOnce();
  rerender(
    <ActualRiskTrialReview {...p} state={{ ...loaded, kind: "ready", mediaFailed: true }} />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "接受这个实际版本" }));
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "保存本次人工决定" })).toBeDisabled();
  expect(p.onRecord).not.toHaveBeenCalled();
});
