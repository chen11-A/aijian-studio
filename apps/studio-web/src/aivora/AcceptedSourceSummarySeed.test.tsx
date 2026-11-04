import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SummaryAdapter from "./adapters/acceptedSourceSummary";
import { AcceptedSourceSummarySeed } from "./AcceptedSourceSummarySeed";
import { readAcceptedSummary, type SummaryRead } from "./adapters/acceptedSourceSummary";
vi.mock("../api/studio", () => ({
  createStudioTransport: () => ({
    getSourceExtraction: vi.fn(),
    getSourceProposalAcceptanceForVersion: vi.fn(),
  }),
}));
vi.mock("./adapters/acceptedSourceSummary", async (original) => ({
  ...(await original<typeof SummaryAdapter>()),
  readAcceptedSummary: vi.fn(),
}));
const value = {
  summary: "经人工接纳的真实摘要。",
  contentHash: `sha256:${"a".repeat(64)}`,
  binding: { sourceVersionId: `ver_${"b".repeat(32)}`, acceptanceId: `pda_${"c".repeat(32)}` },
};
beforeEach(() => {
  vi.mocked(readAcceptedSummary).mockReset().mockResolvedValue({ kind: "FOUND", value });
});
afterEach(cleanup);
describe("accepted summary import", () => {
  it("requires explicit review and fresh read before filling an editable draft", async () => {
    const onImport = vi.fn().mockReturnValue(true);
    render(<AcceptedSourceSummarySeed projectId="project" disabled={false} onImport={onImport} />);
    expect(readAcceptedSummary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "读取已采纳摘要" }));
    expect(await screen.findByText(value.summary)).toBeVisible();
    expect(onImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "导入摘要为可编辑起稿" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚未保存");
    expect(readAcceptedSummary).toHaveBeenCalledTimes(2);
    expect(onImport).toHaveBeenCalledExactlyOnceWith(value);
  });
  it("requires another review when accepted content changes", async () => {
    const onImport = vi.fn();
    render(<AcceptedSourceSummarySeed projectId="project" disabled={false} onImport={onImport} />);
    fireEvent.click(screen.getByRole("button", { name: "读取已采纳摘要" }));
    await screen.findByText(value.summary);
    vi.mocked(readAcceptedSummary).mockResolvedValue({
      kind: "FOUND",
      value: { ...value, summary: "新版摘要" },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入摘要为可编辑起稿" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已变化，未导入");
    expect(onImport).not.toHaveBeenCalled();
  });
  it("does not overwrite a draft that changed during read", async () => {
    const onImport = vi.fn().mockReturnValue(false);
    render(<AcceptedSourceSummarySeed projectId="project" disabled={false} onImport={onImport} />);
    fireEvent.click(screen.getByRole("button", { name: "读取已采纳摘要" }));
    await screen.findByText(value.summary);
    fireEvent.click(screen.getByRole("button", { name: "导入摘要为可编辑起稿" }));
    expect(await screen.findByRole("status")).toHaveTextContent("未覆盖任何内容");
  });
  it.each(["EMPTY", "UNKNOWN"] as const)("keeps %s read unimportable", async (kind) => {
    vi.mocked(readAcceptedSummary).mockResolvedValue({ kind });
    render(<AcceptedSourceSummarySeed projectId="project" disabled={false} onImport={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "读取已采纳摘要" }));
    await screen.findByRole("status");
    expect(screen.queryByRole("button", { name: "导入摘要为可编辑起稿" })).toBeNull();
  });
  it("deduplicates clicks and discards response after unmount", async () => {
    let finish: (value: SummaryRead) => void = () => undefined;
    vi.mocked(readAcceptedSummary).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onImport = vi.fn();
    const view = render(
      <AcceptedSourceSummarySeed projectId="project" disabled={false} onImport={onImport} />,
    );
    const button = screen.getByRole("button", { name: "读取已采纳摘要" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(readAcceptedSummary).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => finish({ kind: "FOUND", value }));
    expect(onImport).not.toHaveBeenCalled();
  });
});
