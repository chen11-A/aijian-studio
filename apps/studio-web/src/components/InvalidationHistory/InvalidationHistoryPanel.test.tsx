import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { isInvalidationOperationResponse } from "@aijian/contracts/invalidation-operation";
import type {
  InvalidationOperationPageResponse,
  InvalidationOperationResponse,
  ProjectData,
} from "../../api/studio";
import { InvalidationHistoryPanel } from "./InvalidationHistoryPanel";

const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const project: ProjectData = {
  id: `prj_${"a".repeat(32)}`,
  name: "雾城来信",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  source_language: "zh-CN",
  status: "active",
  revision: 1,
  created_at: "2026-08-03T03:00:00Z",
  updated_at: "2026-08-03T03:00:00Z",
};
const operationId = `ivo_${"b".repeat(32)}`;
const secondOperationId = `ivo_${"c".repeat(32)}`;
const summary = (id = operationId) => ({
  operation_id: id,
  project_id: project.id,
  changed_artifact_id: `art_${"d".repeat(32)}`,
  old_accepted_version_id: `ver_${"e".repeat(32)}`,
  new_accepted_version_id: `ver_${"f".repeat(32)}`,
  gate_decision_id: `dec_${"1".repeat(32)}`,
  assessment_hash: `sha256:${"2".repeat(64)}`,
  created_at: "2026-08-03T03:00:00Z",
  reason_path_count: 1,
});
const page = (items = [summary()], nextCursor: string | null = null) =>
  ({
    data: { items, next_cursor: nextCursor },
    request_id: requestId,
  }) satisfies InvalidationOperationPageResponse;
const fullPage = (firstValue: number, hasNext: boolean) => {
  const items = Array.from({ length: 20 }, (_, index) =>
    summary(`ivo_${(firstValue - index).toString(16).padStart(32, "0")}`),
  );
  return page(items, hasNext ? items.at(-1)!.operation_id : null);
};
const detail = (id = operationId, paths: InvalidationOperationResponse["data"]["paths"] = []) => {
  const { reason_path_count: _reasonPathCount, ...operation } = summary(id);
  void _reasonPathCount;
  return {
    data: {
      ...operation,
      paths: paths.map((path) => ({ ...path, operation_id: id, project_id: project.id })),
    },
    request_id: requestId,
  } satisfies InvalidationOperationResponse;
};
const reasonPath: InvalidationOperationResponse["data"]["paths"][number] = {
  path_id: `ivp_${"3".repeat(32)}`,
  operation_id: operationId,
  project_id: project.id,
  affected_artifact_id: `art_${"4".repeat(32)}`,
  affected_version_id: `ver_${"5".repeat(32)}`,
  classification: "INVALIDATE",
  aggregate_impact: "blocking",
  dependency_ids: [`dep_${"6".repeat(32)}`, `dep_${"7".repeat(32)}`],
  relationships: ["derived_from", "renders"],
  edge_impacts: ["blocking", "render_only"],
  effective_impact: "blocking",
  ordinal: 0,
  created_at: "2026-08-03T03:00:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("builds detail fixtures accepted by the published contract", () => {
  expect(
    isInvalidationOperationResponse(detail(operationId, [reasonPath]), project.id, operationId),
  ).toBe(true);
  expect(
    isInvalidationOperationResponse(
      detail(secondOperationId, [reasonPath]),
      project.id,
      secondOperationId,
    ),
  ).toBe(true);
});

test("loads the first project page with its fixed limit, and presents loading and empty states", async () => {
  const listOperations = vi.fn().mockResolvedValue(page([]));
  render(
    <InvalidationHistoryPanel
      project={project}
      listOperations={listOperations}
      getOperation={vi.fn()}
    />,
  );
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(await screen.findByText("暂无影响报告")).toBeInTheDocument();
  expect(listOperations).toHaveBeenCalledWith(project.id, { limit: 20 });
});

test("retries a first-page failure without inventing severity in the summary", async () => {
  const listOperations = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(page());
  render(
    <InvalidationHistoryPanel
      project={project}
      listOperations={listOperations}
      getOperation={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  expect(await screen.findByRole("button", { name: /内容版本发生变更/ })).toBeInTheDocument();
  expect(screen.queryByText("阻塞下游")).not.toBeInTheDocument();
});

test("reads the exact operation detail and pairs reason-chain arrays by index", async () => {
  const getOperation = vi.fn().mockResolvedValue(detail(operationId, [reasonPath]));
  render(
    <InvalidationHistoryPanel
      project={project}
      listOperations={vi.fn().mockResolvedValue(page())}
      getOperation={getOperation}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /内容版本发生变更/ }));
  await waitFor(() => expect(getOperation).toHaveBeenCalledWith(project.id, operationId));
  expect(await screen.findByText("失效")).toBeInTheDocument();
  const reasonRows = screen.getAllByRole("listitem");
  expect(within(reasonRows[0]!).getByText("derived_from")).toBeInTheDocument();
  expect(within(reasonRows[0]!).getByText("阻塞下游")).toBeInTheDocument();
  expect(within(reasonRows[1]!).getByText("renders")).toBeInTheDocument();
  expect(within(reasonRows[1]!).getByText("仅重新渲染")).toBeInTheDocument();
});

test("appends with the server cursor and retries a failed next page without clearing rows", async () => {
  const firstPage = fullPage(40, true);
  const secondPage = fullPage(20, false);
  const cursor = firstPage.data.items.at(-1)!.operation_id;
  const listOperations = vi
    .fn()
    .mockResolvedValueOnce(firstPage)
    .mockRejectedValueOnce(new Error("page offline"))
    .mockResolvedValueOnce(secondPage);
  render(
    <InvalidationHistoryPanel
      project={project}
      listOperations={listOperations}
      getOperation={vi.fn()}
    />,
  );
  await screen.findAllByRole("button", { name: /内容版本发生变更/ });
  fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("page offline");
  expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /内容版本发生变更/ })).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "重新加载更多" }));
  await waitFor(() =>
    expect(listOperations).toHaveBeenLastCalledWith(project.id, { limit: 20, cursor }),
  );
  expect(await screen.findAllByRole("button", { name: /内容版本发生变更/ })).toHaveLength(40);
});

test("ignores late detail responses, reports detail errors, and treats zero paths as valid", async () => {
  const first = deferred<InvalidationOperationResponse>();
  const second = deferred<InvalidationOperationResponse>();
  const getOperation = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockRejectedValueOnce(new Error("detail offline"))
    .mockResolvedValueOnce(detail(secondOperationId));
  render(
    <InvalidationHistoryPanel
      project={project}
      listOperations={vi
        .fn()
        .mockResolvedValue(page([summary(secondOperationId), summary(operationId)]))}
      getOperation={getOperation}
    />,
  );
  const rows = await screen.findAllByRole("button", { name: /内容版本发生变更/ });
  fireEvent.click(rows[0]!);
  fireEvent.click(rows[1]!);
  await act(async () => {
    second.resolve(detail(operationId));
    await second.promise;
  });
  expect(await screen.findByText("本次没有下游影响路径")).toBeInTheDocument();
  await act(async () => {
    first.resolve(detail(secondOperationId, [reasonPath]));
    await first.promise;
  });
  expect(screen.queryByText("derived_from")).not.toBeInTheDocument();
  fireEvent.click(rows[0]!);
  expect(await screen.findByRole("alert")).toHaveTextContent("detail offline");
  fireEvent.click(screen.getByRole("button", { name: "重新读取报告" }));
  expect(await screen.findByText("本次没有下游影响路径")).toBeInTheDocument();
});

test("ignores late list data after project changes and hides load-more without a cursor", async () => {
  const late = deferred<InvalidationOperationPageResponse>();
  const listOperations = vi.fn().mockReturnValueOnce(late.promise).mockResolvedValueOnce(page([]));
  const { rerender } = render(
    <InvalidationHistoryPanel
      project={project}
      listOperations={listOperations}
      getOperation={vi.fn()}
    />,
  );
  const nextProject = { ...project, id: `prj_${"9".repeat(32)}`, name: "另一项目" };
  rerender(
    <InvalidationHistoryPanel
      project={nextProject}
      listOperations={listOperations}
      getOperation={vi.fn()}
    />,
  );
  await act(async () => {
    late.resolve(page());
    await late.promise;
  });
  expect(await screen.findByText("暂无影响报告")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
});

test("does not show load more for a non-empty terminal page", async () => {
  render(
    <InvalidationHistoryPanel
      project={project}
      listOperations={vi.fn().mockResolvedValue(page([summary()]))}
      getOperation={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: /内容版本发生变更/ });
  expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
});

test("source-level contract preserves the read-only responsive history layout", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/components/InvalidationHistory/invalidation-history.css"),
    "utf8",
  );
  expect(css).toMatch(
    /\.task-drawer\.production-control-drawer\s*\{(?=[^}]*max-height:\s*min\(820px, calc\(100vh - 32px\)\);)(?=[^}]*overflow:\s*hidden;)(?=[^}]*background:\s*var\(--panel\);)[^}]*\}/,
  );
  expect(css).toMatch(
    /@media \(max-width: 680px\)\s*\{\s*\.task-drawer\.production-control-drawer\s*\{(?=[^}]*width:\s*100vw;)(?=[^}]*max-height:\s*100vh;)(?=[^}]*border-radius:\s*0;)[^}]*\}/,
  );
  expect(css).toMatch(
    /\.history-technical-details summary\s*\{(?=[^}]*min-height:\s*44px;)(?=[^}]*font-size:\s*var\(--font-ui\);)[^}]*\}/,
  );
});

test("returns from a detail to the focused report row without read-write actions", async () => {
  render(
    <InvalidationHistoryPanel
      project={project}
      listOperations={vi.fn().mockResolvedValue(page())}
      getOperation={vi.fn().mockResolvedValue(detail())}
    />,
  );
  const row = await screen.findByRole("button", { name: /内容版本发生变更/ });
  fireEvent.click(row);
  await waitFor(() => expect(screen.getByRole("heading", { name: /art_/ })).toHaveFocus());
  const back = await screen.findByRole("button", { name: "返回影响报告" });
  expect(
    screen.queryByRole("button", { name: /批准|生成|修复|编辑|导出/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(back);
  await waitFor(() => expect(row).toHaveFocus());
});

test("keeps the list state and restored row focus when a returned detail resolves or rejects late", async () => {
  const lateResolve = deferred<InvalidationOperationResponse>();
  const lateReject = deferred<InvalidationOperationResponse>();
  const getOperation = vi
    .fn()
    .mockReturnValueOnce(lateResolve.promise)
    .mockReturnValueOnce(lateReject.promise);
  render(
    <InvalidationHistoryPanel
      project={project}
      listOperations={vi.fn().mockResolvedValue(page())}
      getOperation={getOperation}
    />,
  );
  const row = await screen.findByRole("button", { name: /内容版本发生变更/ });
  fireEvent.click(row);
  fireEvent.click(await screen.findByRole("button", { name: "返回影响报告" }));
  await waitFor(() => expect(row).toHaveFocus());
  await act(async () => {
    lateResolve.resolve(detail(operationId, [reasonPath]));
    await lateResolve.promise;
  });
  expect(screen.queryByText("derived_from")).not.toBeInTheDocument();
  expect(row).toHaveFocus();

  fireEvent.click(row);
  fireEvent.click(await screen.findByRole("button", { name: "返回影响报告" }));
  await act(async () => {
    lateReject.reject(new Error("late failure"));
    await lateReject.promise.catch(() => undefined);
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(row).toHaveFocus();
});

test("does not let a late detail from the old project pollute the new project", async () => {
  const lateDetail = deferred<InvalidationOperationResponse>();
  const nextProject = { ...project, id: `prj_${"9".repeat(32)}`, name: "新项目" };
  const { rerender } = render(
    <InvalidationHistoryPanel
      project={project}
      listOperations={vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(page([]))}
      getOperation={vi.fn().mockReturnValue(lateDetail.promise)}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /内容版本发生变更/ }));
  rerender(
    <InvalidationHistoryPanel
      project={nextProject}
      listOperations={vi.fn().mockResolvedValue(page([]))}
      getOperation={vi.fn()}
    />,
  );
  await act(async () => {
    lateDetail.resolve(detail(operationId, [reasonPath]));
    await lateDetail.promise;
  });
  expect(await screen.findByText("暂无影响报告")).toBeInTheDocument();
  expect(screen.queryByText("derived_from")).not.toBeInTheDocument();
});
