import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { buildTrialReview } from "./actions/risk-trial-review";
import { RiskTrialReview } from "./RiskTrialReview";
it("defaults to no choice and lets the person inspect full text safely without submitting or changing data", () => {
  const film = sampleFilm();
  film.shots[0]!.picture = "完整画面正文".repeat(300) + "<img src=x onerror=secret>";
  const review = buildTrialReview(film),
    before = structuredClone(review),
    onInspect = vi.fn(),
    onRefresh = vi.fn(),
    onClose = vi.fn();
  const ui = render(
    <RiskTrialReview
      review={review}
      stale={false}
      onInspect={onInspect}
      onRefresh={onRefresh}
      onClose={onClose}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "试片候选审阅" });
  const backgroundShortcut = vi.fn();
  window.addEventListener("keydown", backgroundShortcut);
  try {
    fireEvent.keyDown(dialog, { key: "i" });
    expect(backgroundShortcut).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("keydown", backgroundShortcut);
  }
  expect(
    within(dialog)
      .getAllByRole("radio")
      .every((el) => !(el as HTMLInputElement).checked),
  ).toBe(true);
  expect(within(dialog).getByRole("button", { name: "在分镜查看" })).toBeDisabled();
  fireEvent.click(within(dialog).getAllByRole("radio")[0]!);
  const detail = within(dialog).getByRole("region", { name: "候选详情" });
  expect(detail).toHaveTextContent(review.candidates[0]!.picture);
  expect(detail.querySelector("img")).toBeNull();
  expect(onInspect).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "在分镜查看" }));
  expect(onInspect).toHaveBeenCalledExactlyOnceWith(review.candidates[0]!.id);
  ui.rerender(
    <RiskTrialReview
      review={review}
      stale
      onInspect={onInspect}
      onRefresh={onRefresh}
      onClose={onClose}
    />,
  );
  expect(within(dialog).getByRole("alert")).toHaveTextContent("已变化");
  fireEvent.click(within(dialog).getByRole("button", { name: "在分镜查看" }));
  expect(onInspect).toHaveBeenCalledOnce();
  fireEvent.click(within(dialog).getByRole("button", { name: "刷新候选" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  expect(review).toEqual(before);
});
