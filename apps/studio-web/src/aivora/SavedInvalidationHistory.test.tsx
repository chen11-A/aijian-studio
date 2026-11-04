import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SavedInvalidationHistory } from "./SavedInvalidationHistory";
import { useInvalidationHistory } from "../domain/use-invalidation-history";
import type { InvalidationHistoryGateway } from "../domain/invalidation-history-controller";
import type { InvalidationOperationResponse } from "../api/studio";
const p = "prj_" + "a".repeat(32),
  other = "prj_" + "b".repeat(32),
  op = "ivo_" + "c".repeat(32);
const summary = (project = p) => ({
  project_id: project,
  operation_id: op,
  changed_artifact_id: "art_" + "d".repeat(32),
  old_accepted_version_id: "ver_" + "e".repeat(32),
  new_accepted_version_id: "ver_" + "f".repeat(32),
  gate_decision_id: "dec_" + "0".repeat(32),
  assessment_hash: "sha256:" + "1".repeat(64),
  created_at: "2026-10-11T04:00:00Z",
  reason_path_count: 2,
});
const detail = (): InvalidationOperationResponse => {
  const { reason_path_count: count, ...s } = summary();
  return {
    request_id: "12345678-abcd-1234-1234-123456789012",
    data: {
      ...s,
      paths: Array.from({ length: count }, (_, i) => String(i + 2)).map((n) => ({
        path_id: "ivp_" + n.repeat(32),
        project_id: p,
        operation_id: op,
        affected_artifact_id: "art_" + n.repeat(32),
        affected_version_id: "ver_" + n.repeat(32),
        classification: "INVALIDATE",
        aggregate_impact: "blocking",
        effective_impact: "blocking",
        dependency_ids: ["dep_" + n.repeat(32)],
        relationships: ["derived_from", "references"],
        edge_impacts: ["blocking", "blocking"],
        ordinal: Number(n),
        created_at: s.created_at,
      })),
    },
  };
};
function gateway() {
  return {
    list: vi.fn().mockResolvedValue({
      request_id: detail().request_id,
      data: { items: [summary()], next_cursor: null },
    }),
    get: vi.fn().mockResolvedValue(detail()),
  };
}
function Harness({ g, project = p }: { g: InvalidationHistoryGateway; project?: string }) {
  const [controller, history] = useInvalidationHistory(g, project);
  return <SavedInvalidationHistory projectId={project} history={history} controller={controller} />;
}
afterEach(cleanup);
describe("shared saved approval replacement impact report", () => {
  it("shows exact old/new approvals, both affected versions and graph paths using reads only", async () => {
    const g = gateway();
    render(<Harness g={g} />);
    const row = await screen.findByRole("button", { name: "内容版本发生变更 · 2 条影响路径" });
    fireEvent.click(row);
    await screen.findByText(/批准替代/);
    expect(screen.getByText(/批准替代/).textContent).toContain(summary().old_accepted_version_id);
    expect(screen.getByText(/批准替代/).textContent).toContain(summary().new_accepted_version_id);
    for (const path of detail().data.paths)
      expect(screen.getByText(new RegExp(path.affected_version_id)).textContent).toContain(
        "blocking",
      );
    expect(screen.getAllByText("查看依赖传播路径")).toHaveLength(2);
    expect(g.get).toHaveBeenCalledWith(p, op);
    expect(g.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "返回影响报告" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /内容版本发生变更/ })).toBe(document.activeElement),
    );
  });
  it("a bad detail preserves the selected operation and explicitly rereads that same identity", async () => {
    const g = gateway(),
      bad = detail();
    bad.data.paths[0]!.project_id = other;
    g.get.mockResolvedValueOnce(bad);
    render(<Harness g={g} />);
    fireEvent.click(await screen.findByRole("button", { name: /内容版本发生变更/ }));
    await screen.findByText(/报告作用域未通过核对/);
    expect(screen.queryByText(/精确受影响版本/)).toBe(null);
    fireEvent.click(screen.getByRole("button", { name: "重新核对此报告" }));
    await screen.findByText(/批准替代/);
    expect(g.get.mock.calls).toEqual([
      [p, op],
      [p, op],
    ]);
  });
  it("wrong-project rows remain unknown rather than being rendered as no impact", async () => {
    const g = gateway();
    g.list.mockResolvedValue({
      request_id: detail().request_id,
      data: { items: [summary(other)], next_cursor: null },
    });
    render(<Harness g={g} />);
    await screen.findByText(/报告列表作用域未通过核对/);
    expect(screen.queryByText("暂无影响报告")).toBe(null);
    expect(screen.queryByRole("button", { name: /内容版本发生变更/ })).toBe(null);
  });
  it("late A→B→A detail replies do not replace the current project report", async () => {
    const g = gateway();
    let resolve!: (v: InvalidationOperationResponse) => void;
    g.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = render(<Harness g={g} />);
    fireEvent.click(await screen.findByRole("button", { name: /内容版本发生变更/ }));
    g.list.mockResolvedValueOnce({
      request_id: detail().request_id,
      data: { items: [summary(other)], next_cursor: null },
    });
    view.rerender(<Harness g={g} project={other} />);
    await screen.findByRole("button", { name: /内容版本发生变更/ });
    view.rerender(<Harness g={g} />);
    await screen.findByRole("button", { name: /内容版本发生变更/ });
    await act(async () => resolve(detail()));
    expect(screen.queryByText(/批准替代：/)).toBe(null);
    expect(screen.queryByText(/精确受影响版本/)).toBe(null);
    expect(g.get).toHaveBeenCalledTimes(1);
  });
});
