import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../desktop/src/visual-bible.testFixtures.json";
import type { VisualHistoryEntry, VisualHistoryPage } from "@aijian/contracts/visual-bible";
import type { AijianDesktopBridge } from "../api/studio";
import { VisualBibleHistory } from "./VisualBibleHistory";
const p = fixture.project_id,
  id = (n: number) => "ver_" + n.toString(16).padStart(32, "0");
function entry(n: number): VisualHistoryEntry {
  const v = fixture.saved.version;
  return {
    id: id(n),
    artifact_id: v.artifact_id,
    version_number: n,
    content_hash: v.content_hash,
    parent_version_id: n > 1 ? id(n - 1) : null,
    creative_library_version_id: v.content.creative_library_version_id,
    creative_library_content_hash: v.content.creative_library_content_hash,
    author_actor_id: v.author_actor_id,
    change_summary: `人工候选 ${n}`,
    change_reason: v.content.change_reason,
    created_at: v.created_at,
  };
}
function page(cursor: string | null = null): VisualHistoryPage {
  return {
    project_id: p,
    head: {
      ...fixture.saved.head,
      latest_version_id: id(21),
      revision: 21,
      accepted_version_id: id(1),
    },
    cursor,
    limit: 20,
    items: cursor === null ? Array.from({ length: 20 }, (_, i) => entry(21 - i)) : [entry(1)],
    next_cursor: cursor === null ? id(2) : null,
  };
}
const found = (data: VisualHistoryPage) => ({
  kind: "FOUND" as const,
  data,
  request_id: fixture.request_id,
});
function gateway() {
  const g = vi.fn().mockImplementation(async (_p, cursor) => found(page(cursor)));
  window.aijian = { listVisualBibleVersions: g } as unknown as AijianDesktopBridge;
  return g;
}
afterEach(() => {
  cleanup();
  delete window.aijian;
});
describe("read-only precise visual history picker", () => {
  it("loads earlier records with the same cursor and selects the exact immutable metadata", async () => {
    const g = gateway(),
      select = vi.fn().mockResolvedValue(undefined);
    render(<VisualBibleHistory projectId={p} locked={false} select={select} />);
    fireEvent.click(await screen.findByRole("button", { name: "读取更早版本" }));
    const old = await screen.findByRole("button", { name: "打开视觉 v1 · 人工候选 1" });
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(old);
    await waitFor(() => expect(select).toHaveBeenCalledWith(id(1), entry(1)));
    expect(g.mock.calls).toEqual([
      [p, null],
      [p, id(2)],
    ]);
    expect(screen.getByText(/批准指针（有效性另行核对）/)).toBeInTheDocument();
  });
  it("pending editor inputs block selecting but read-only refresh never discards them", async () => {
    const g = gateway(),
      select = vi.fn();
    render(<VisualBibleHistory projectId={p} locked select={select} />);
    expect(
      await screen.findByRole("button", { name: "打开视觉 v21 · 人工候选 21" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "刷新历史目录" }));
    await waitFor(() => expect(g).toHaveBeenCalledTimes(2));
    expect(select).not.toHaveBeenCalled();
  });
  it.each(["head", "cursor", "duplicate", "scope"])(
    "refuses %s continuation without losing prior records",
    async (fault) => {
      const g = gateway(),
        bad = page(id(2));
      if (fault === "head") bad.head = { ...bad.head, revision: 22 };
      if (fault === "cursor") bad.cursor = null;
      if (fault === "duplicate") bad.items = [entry(3)];
      if (fault === "scope") bad.project_id = "prj_" + "0".repeat(32);
      g.mockResolvedValueOnce(found(page())).mockResolvedValueOnce(found(bad));
      const select = vi.fn();
      render(<VisualBibleHistory projectId={p} locked={false} select={select} />);
      fireEvent.click(await screen.findByRole("button", { name: "读取更早版本" }));
      await screen.findByText(/历史目录未通过核对/);
      expect(screen.getByRole("button", { name: "打开视觉 v21 · 人工候选 21" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "打开视觉 v1 · 人工候选 1" })).toBe(null);
      expect(select).not.toHaveBeenCalled();
    },
  );
  it("old A→B→A directory replies cannot replace the current directory", async () => {
    const g = gateway();
    let resolve!: (v: ReturnType<typeof found>) => void;
    g.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const select = vi.fn(),
      view = render(<VisualBibleHistory projectId={p} locked={false} select={select} />);
    const other = "prj_" + "0".repeat(32);
    g.mockResolvedValueOnce(found({ ...page(), project_id: other }));
    view.rerender(<VisualBibleHistory projectId={other} locked={false} select={select} />);
    await screen.findByRole("button", { name: "打开视觉 v21 · 人工候选 21" });
    view.rerender(<VisualBibleHistory projectId={p} locked={false} select={select} />);
    await screen.findByRole("button", { name: "打开视觉 v21 · 人工候选 21" });
    const old = page();
    old.items[0] = { ...old.items[0]!, change_summary: "旧异步回复" };
    await act(async () => resolve(found(old)));
    expect(screen.queryByRole("button", { name: /旧异步回复/ })).toBe(null);
    expect(select).not.toHaveBeenCalled();
  });
});
