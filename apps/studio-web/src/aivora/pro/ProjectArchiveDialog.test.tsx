import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectArchiveDialog } from "./ProjectArchiveDialog";
import type { FilmProjectArchiveImport } from "@aijian/contracts/film-project-archive";
describe("project package explicit native actions", () => {
  it("does not dispatch on open, locks duplicate requests and only reports a completed export", async () => {
    let finish!: (value: { kind: "EXPORTED"; mediaCount: number }) => void;
    const run = vi.fn(
      () =>
        new Promise<{ kind: "EXPORTED"; mediaCount: number }>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <ProjectArchiveDialog
        mode="export"
        projectId="film1"
        onExport={run}
        onImport={vi.fn()}
        onImported={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(run).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "选择保存位置并打包" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(run).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
    expect(screen.queryByText(/已写入所选位置/)).toBeNull();
    await act(async () => finish({ kind: "EXPORTED", mediaCount: 3 }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "工程包已写入所选位置，包含 3 份引用素材。",
    );
  });
  it("keeps cancellation and unsafe failures local, without showing raw error paths", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ kind: "CANCELLED" })
      .mockRejectedValueOnce(Error("TOKEN /private/database.sqlite"));
    render(
      <ProjectArchiveDialog
        mode="import"
        projectId={null}
        onExport={vi.fn()}
        onImport={run}
        onImported={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "选择工程包" }));
    expect(await screen.findByText("已取消，原作品没有改动。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择工程包" }));
    expect(
      await screen.findByText("工程包操作没有完成，原作品仍保留，请重试。"),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/TOKEN|database.sqlite/);
  });
  it("ignores a late result from the old work rather than opening its imported project", async () => {
    let finish!: (value: FilmProjectArchiveImport) => void;
    const run = vi.fn(
        () =>
          new Promise<FilmProjectArchiveImport>((resolve) => {
            finish = resolve;
          }),
      ),
      opened = vi.fn();
    const props = {
      mode: "import" as const,
      onExport: vi.fn(),
      onImport: run,
      onImported: opened,
      onClose: vi.fn(),
    };
    const view = render(<ProjectArchiveDialog {...props} projectId="old" />);
    fireEvent.click(screen.getByRole("button", { name: "选择工程包" }));
    view.rerender(<ProjectArchiveDialog {...props} projectId="new" />);
    await act(async () => finish({ kind: "IMPORTED", projectId: "imported-old", mediaCount: 2 }));
    expect(opened).not.toHaveBeenCalled();
    expect(screen.queryByText("工程包已导入为独立新作品。")).toBeNull();
  });
});
