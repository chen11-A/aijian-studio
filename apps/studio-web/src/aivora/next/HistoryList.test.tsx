import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistoryList, type HistoryEntry } from "./HistoryList";

const ENTRIES: HistoryEntry[] = [
  {
    id: "b",
    when: "今天 14:32",
    why: "批量生成前自动存的",
    summary: "3 场 · 28 个镜头 · 12 个做好了",
  },
  { id: "a", when: "今天 10:05", why: "批量生成前自动存的" },
];

describe("HistoryList", () => {
  it("says plainly when there is no history, instead of an empty list", () => {
    const { rerender } = render(<HistoryList entries={null} onRestore={() => {}} />);
    expect(screen.getByText(/还不能看历史版本/)).toBeInTheDocument();
    rerender(<HistoryList entries={[]} onRestore={() => {}} />);
    expect(screen.getByText(/还没有存过的版本/)).toBeInTheDocument();
    rerender(<HistoryList entries={ENTRIES} loading onRestore={() => {}} />);
    expect(screen.getByText("正在读历史版本…")).toBeInTheDocument();
  });

  it("asks once more before restoring, and says what happens to the work now", () => {
    const restore = vi.fn();
    render(<HistoryList entries={ENTRIES} onRestore={restore} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "恢复到这里" })[0]!);
    expect(screen.getByRole("group", { name: "确认恢复" })).toHaveTextContent(
      "恢复到「今天 14:32」？作品会回到那时的样子；现在的样子会另存一份",
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "恢复到这里" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect(restore).toHaveBeenCalledWith("a");
  });

  it("holds every other restore while one is running", () => {
    render(<HistoryList entries={ENTRIES} restoring="b" onRestore={() => {}} />);
    expect(screen.getByRole("button", { name: "正在恢复" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "恢复到这里" })).toBeDisabled();
  });
});
