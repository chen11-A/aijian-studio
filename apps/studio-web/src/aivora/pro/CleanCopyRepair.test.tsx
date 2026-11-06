import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CleanCopyRepair } from "./CleanCopyRepair";

describe("4B-U09 clean copy repair display", () => {
  it("shows no offer when every selected version already has its clean copy", () => {
    render(<CleanCopyRepair mode="shot" count={0} busy={false} onRepair={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("dispatches a single explicit repair and explains that it reuses the assembly", () => {
    const onRepair = vi.fn();
    render(<CleanCopyRepair mode="shot" count={1} busy={false} onRepair={onRepair} />);
    expect(onRepair).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "补做不带字幕的版本" }));
    expect(onRepair).toHaveBeenCalledTimes(1);
    expect(screen.getByText("使用原来的合成记录，不重新生成视频。")).toBeInTheDocument();
  });
  it("updates remaining export repairs and requires another explicit export", () => {
    const onRepair = vi.fn();
    const view = render(
      <CleanCopyRepair mode="export" count={3} busy={false} onRepair={onRepair} />,
    );
    expect(screen.getByText(/有 3 个镜头/)).toHaveTextContent("补好后，请再点导出。");
    view.rerender(<CleanCopyRepair mode="export" count={1} busy={true} onRepair={onRepair} />);
    expect(screen.getByRole("button", { name: "正在补做无字幕版本…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(onRepair).not.toHaveBeenCalled();
    view.rerender(<CleanCopyRepair mode="export" count={1} busy={false} onRepair={onRepair} />);
    fireEvent.click(screen.getByRole("button", { name: "一键补做这 1 镜" }));
    expect(onRepair).toHaveBeenCalledTimes(1);
    view.rerender(<CleanCopyRepair mode="export" count={0} busy={false} onRepair={onRepair} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
